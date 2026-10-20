-- =====================================================================
-- CANDIDUS — FASE 2: CONCILIAÇÃO 1↔N
--   • 1 movimento  → várias contas  (ex.: cliente paga 3 boletos num PIX)
--   • vários movimentos → 1 conta   (ex.: boleto pago em 2 PIX)
--   • diferença tratada como juros/multa, desconto ou baixa parcial
-- Rode UMA vez no SQL Editor (pode rodar de novo sem quebrar).
--
-- FUNÇÕES:
--   NOVAS:   conciliar_movimento_multi, conciliar_varios_movimentos, _aplicar_parcela
--   ALTERADAS (MESMA assinatura → sem overload):
--            conciliar_movimento, desconciliar_movimento, estornar_baixa
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Flag "conciliado" no movimento (derivada: vínculo antigo OU itens)
-- ---------------------------------------------------------------------
alter table public.bank_transactions add column if not exists conciliado boolean not null default false;

-- ---------------------------------------------------------------------
-- 2. Itens de conciliação (quanto de cada movimento foi pra cada parcela)
-- ---------------------------------------------------------------------
create table if not exists public.conciliacao_itens (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies(id) on delete restrict,
  bank_transaction_id       uuid not null references public.bank_transactions(id) on delete cascade,
  tipo                      text not null check (tipo in ('receber','pagar')),
  receivable_installment_id uuid references public.receivable_installments(id) on delete restrict,
  payable_installment_id    uuid references public.payable_installments(id) on delete restrict,
  valor                     numeric(14,2) not null check (valor > 0),
  created_by                uuid default auth.uid(),
  created_at                timestamptz not null default now(),
  constraint conc_itens_parcela_ck check (
    (tipo='receber' and receivable_installment_id is not null and payable_installment_id is null) or
    (tipo='pagar'   and payable_installment_id    is not null and receivable_installment_id is null))
);
create index if not exists idx_conc_itens_bt  on public.conciliacao_itens(bank_transaction_id);
create index if not exists idx_conc_itens_rec on public.conciliacao_itens(receivable_installment_id);
create index if not exists idx_conc_itens_pag on public.conciliacao_itens(payable_installment_id);
create index if not exists idx_bt_conciliado  on public.bank_transactions(company_id, conciliado);

alter table public.conciliacao_itens enable row level security;
drop policy if exists conc_itens_rls on public.conciliacao_itens;
create policy conc_itens_rls on public.conciliacao_itens for all to authenticated
  using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
grant all on public.conciliacao_itens to anon, authenticated;

-- Trigger: mantém "conciliado" sempre coerente
create or replace function public.trg_bt_conciliado() returns trigger language plpgsql as $$
begin
  new.conciliado := (new.receivable_installment_id is not null or new.payable_installment_id is not null)
                 or exists (select 1 from public.conciliacao_itens ci where ci.bank_transaction_id = new.id);
  return new;
end $$;
drop trigger if exists trg_bt_conciliado on public.bank_transactions;
create trigger trg_bt_conciliado before insert or update on public.bank_transactions
  for each row execute function public.trg_bt_conciliado();

-- Backfill dos movimentos já conciliados/baixados
update public.bank_transactions set conciliado = conciliado;

-- ---------------------------------------------------------------------
-- 3. Helper: soma/subtrai valor numa parcela e recalcula status
--    p_delta > 0 = baixa ; p_delta < 0 = reversão
-- ---------------------------------------------------------------------
create or replace function public._aplicar_parcela(p_tipo text, p_inst uuid, p_delta numeric)
returns void language plpgsql as $$
declare v_r public.receivable_installments%rowtype; v_p public.payable_installments%rowtype; v_novo numeric(14,2);
begin
  if p_tipo='receber' then
    select * into v_r from public.receivable_installments where id=p_inst for update;
    if not found then raise exception 'Parcela não encontrada ou sem acesso'; end if;
    if v_r.status='cancelado' and p_delta>0 then raise exception 'Parcela cancelada não recebe baixa'; end if;
    v_novo := v_r.valor_recebido + p_delta;
    if v_novo > v_r.valor + 0.005 then raise exception 'Valor (%) excede o saldo da parcela (%)', p_delta, v_r.saldo; end if;
    if v_novo < -0.005 then raise exception 'Reversão maior que o valor recebido da parcela'; end if;
    update public.receivable_installments set valor_recebido = v_novo,
      status = case when status='cancelado' then 'cancelado' when v_novo<=0 then 'a_receber'
                    when v_novo>=valor then 'recebido' else 'recebido_parcial' end
      where id=p_inst;
    update public.receivables r set status = case
      when not exists (select 1 from public.receivable_installments i where i.receivable_id=r.id and i.status not in ('recebido','cancelado'))
      then 'quitado' else 'aberto' end
      where r.id=v_r.receivable_id and r.status<>'cancelado';
  elsif p_tipo='pagar' then
    select * into v_p from public.payable_installments where id=p_inst for update;
    if not found then raise exception 'Parcela não encontrada ou sem acesso'; end if;
    if v_p.status='cancelado' and p_delta>0 then raise exception 'Parcela cancelada não recebe baixa'; end if;
    v_novo := v_p.valor_pago + p_delta;
    if v_novo > v_p.valor + 0.005 then raise exception 'Valor (%) excede o saldo da parcela (%)', p_delta, v_p.saldo; end if;
    if v_novo < -0.005 then raise exception 'Reversão maior que o valor pago da parcela'; end if;
    update public.payable_installments set valor_pago = v_novo,
      status = case when status='cancelado' then 'cancelado' when v_novo<=0 then 'a_pagar'
                    when v_novo>=valor then 'pago' else 'pago_parcial' end
      where id=p_inst;
    update public.payables p set status = case
      when not exists (select 1 from public.payable_installments i where i.payable_id=p.id and i.status not in ('pago','cancelado'))
      then 'quitado' else 'aberto' end
      where p.id=v_p.payable_id and p.status<>'cancelado';
  else
    raise exception 'Tipo inválido';
  end if;
end $$;

-- ---------------------------------------------------------------------
-- 4. 1 movimento → N parcelas
--    p_itens = [{"installment_id":"uuid","valor":123.45}, ...]
--    Regra: soma(valor) + juros + multa − desconto = valor do movimento
-- ---------------------------------------------------------------------
create or replace function public.conciliar_movimento_multi(
  p_bank_transaction_id uuid,
  p_itens               jsonb,
  p_juros               numeric default 0,
  p_multa               numeric default 0,
  p_desconto            numeric default 0
) returns int language plpgsql as $$
declare
  v_bt public.bank_transactions%rowtype; v_tipo text; v_it jsonb; v_inst uuid; v_val numeric(14,2);
  v_soma numeric(14,2) := 0; v_co uuid; v_n int := 0;
  v_j numeric(14,2) := round(coalesce(p_juros,0),2);
  v_m numeric(14,2) := round(coalesce(p_multa,0),2);
  v_d numeric(14,2) := round(coalesce(p_desconto,0),2);
begin
  select * into v_bt from public.bank_transactions where id=p_bank_transaction_id for update;
  if not found then raise exception 'Movimento não encontrado'; end if;
  if v_bt.tipo not in ('entrada','saida') then raise exception 'Transferência não se concilia com contas'; end if;
  if v_bt.conciliado then raise exception 'Movimento já conciliado'; end if;
  if p_itens is null or jsonb_typeof(p_itens)<>'array' or jsonb_array_length(p_itens)=0 then
    raise exception 'Informe ao menos uma conta'; end if;
  if v_j<0 or v_m<0 or v_d<0 then raise exception 'Juros, multa e desconto não podem ser negativos'; end if;
  if (select count(distinct x->>'installment_id') from jsonb_array_elements(p_itens) x) <> jsonb_array_length(p_itens) then
    raise exception 'A mesma conta aparece mais de uma vez'; end if;

  v_tipo := case when v_bt.tipo='entrada' then 'receber' else 'pagar' end;

  select coalesce(sum(round((x->>'valor')::numeric,2)),0) into v_soma from jsonb_array_elements(p_itens) x;
  if abs(v_soma + v_j + v_m - v_d - v_bt.valor) > 0.005 then
    raise exception 'Não fecha: contas % + juros % + multa % − desconto % = %, mas o movimento é %',
      v_soma, v_j, v_m, v_d, v_soma + v_j + v_m - v_d, v_bt.valor;
  end if;

  for v_it in select * from jsonb_array_elements(p_itens) loop
    v_inst := (v_it->>'installment_id')::uuid;
    v_val  := round((v_it->>'valor')::numeric,2);
    if v_val is null or v_val <= 0 then raise exception 'Valor de cada conta deve ser positivo'; end if;
    if v_tipo='receber' then select company_id into v_co from public.receivable_installments where id=v_inst;
    else                     select company_id into v_co from public.payable_installments    where id=v_inst; end if;
    if v_co is null then raise exception 'Parcela não encontrada ou sem acesso'; end if;
    if v_co <> v_bt.company_id then raise exception 'A conta é de outra empresa'; end if;

    perform public._aplicar_parcela(v_tipo, v_inst, v_val);
    insert into public.conciliacao_itens(company_id, bank_transaction_id, tipo, receivable_installment_id, payable_installment_id, valor)
      values (v_bt.company_id, v_bt.id, v_tipo,
              case when v_tipo='receber' then v_inst end,
              case when v_tipo='pagar'   then v_inst end, v_val);
    v_n := v_n + 1;
  end loop;

  update public.bank_transactions set juros=v_j, multa=v_m, desconto=v_d where id=v_bt.id; -- trigger marca conciliado

  insert into public.audit_logs(company_id,user_id,acao,tabela,registro_id,valor_novo)
  values (v_bt.company_id, auth.uid(), 'conciliacao', 'bank_transactions', v_bt.id,
          jsonb_build_object('itens', p_itens, 'juros', v_j, 'multa', v_m, 'desconto', v_d, 'tipo', v_tipo));
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 5. N movimentos → 1 parcela
--    p_diferenca: null/'parcial' (padrão) | 'desconto' (quita a conta) | 'juros' (excedente)
-- ---------------------------------------------------------------------
create or replace function public.conciliar_varios_movimentos(
  p_bank_transaction_ids uuid[],
  p_installment_id       uuid,
  p_diferenca            text default null
) returns int language plpgsql as $$
declare
  v_bts public.bank_transactions[]; v_bt public.bank_transactions; v_tipo text; v_co uuid; v_saldo numeric(14,2);
  v_total numeric(14,2); v_rest numeric(14,2); v_alloc numeric(14,2); v_i int; v_n int;
begin
  if p_bank_transaction_ids is null or cardinality(p_bank_transaction_ids)=0 then raise exception 'Selecione os movimentos'; end if;
  if p_diferenca is not null and p_diferenca not in ('parcial','desconto','juros') then raise exception 'Tratamento de diferença inválido'; end if;

  perform 1 from public.bank_transactions where id = any(p_bank_transaction_ids) order by id for update;
  select array_agg(t order by t.data, t.id) into v_bts from public.bank_transactions t where t.id = any(p_bank_transaction_ids);
  v_n := coalesce(cardinality(v_bts),0);
  if v_n <> (select count(distinct x) from unnest(p_bank_transaction_ids) x) then raise exception 'Movimento não encontrado ou repetido'; end if;

  foreach v_bt in array v_bts loop
    if v_bt.conciliado then raise exception 'Movimento de % (%) já está conciliado', v_bt.data, v_bt.valor; end if;
    if v_bt.tipo not in ('entrada','saida') then raise exception 'Transferência não se concilia com contas'; end if;
    if v_bt.tipo <> v_bts[1].tipo then raise exception 'Misture só entradas ou só saídas'; end if;
    if v_bt.company_id <> v_bts[1].company_id then raise exception 'Movimentos de empresas diferentes'; end if;
  end loop;

  v_tipo := case when v_bts[1].tipo='entrada' then 'receber' else 'pagar' end;
  if v_tipo='receber' then select company_id, saldo into v_co, v_saldo from public.receivable_installments where id=p_installment_id and status<>'cancelado';
  else                     select company_id, saldo into v_co, v_saldo from public.payable_installments    where id=p_installment_id and status<>'cancelado'; end if;
  if v_co is null then raise exception 'Parcela não encontrada, cancelada ou sem acesso'; end if;
  if v_co <> v_bts[1].company_id then raise exception 'A conta é de outra empresa'; end if;
  if v_saldo <= 0 then raise exception 'Parcela já está quitada'; end if;

  select sum(b.valor) into v_total from unnest(v_bts) b;
  if v_total > v_saldo + 0.005 and coalesce(p_diferenca,'') <> 'juros' then
    raise exception 'Os movimentos somam % e o saldo da conta é %. Informe o excedente como juros.', v_total, v_saldo;
  end if;

  v_rest := v_saldo;
  for v_i in 1..v_n loop
    v_bt := v_bts[v_i];
    v_alloc := least(v_bt.valor, v_rest);
    if v_alloc <= 0 then raise exception 'O movimento de % (%) sobra inteiro — tire ele da seleção', v_bt.data, v_bt.valor; end if;
    if v_i = v_n and p_diferenca='desconto' and v_total < v_saldo then
      -- último movimento quita a conta com desconto
      perform public.conciliar_movimento_multi(v_bt.id,
        jsonb_build_array(jsonb_build_object('installment_id',p_installment_id,'valor',v_rest)), 0, 0, v_rest - v_bt.valor);
    else
      perform public.conciliar_movimento_multi(v_bt.id,
        jsonb_build_array(jsonb_build_object('installment_id',p_installment_id,'valor',v_alloc)), v_bt.valor - v_alloc, 0, 0);
    end if;
    v_rest := v_rest - v_alloc;
  end loop;
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 6. conciliar_movimento (1↔1) — MESMA assinatura, agora grava itens.
--    Se o movimento for maior que o saldo, o excedente vira juros
--    (antes ele simplesmente sumia).
-- ---------------------------------------------------------------------
create or replace function public.conciliar_movimento(
  p_bank_transaction_id uuid,
  p_installment_id uuid,
  p_tipo text          -- 'receber' | 'pagar'
) returns void language plpgsql as $$
declare v_bt public.bank_transactions%rowtype; v_saldo numeric(14,2); v_val numeric(14,2);
begin
  select * into v_bt from public.bank_transactions where id=p_bank_transaction_id for update;
  if not found then raise exception 'Movimento não encontrado'; end if;
  if p_tipo not in ('receber','pagar') then raise exception 'Tipo inválido'; end if;
  if (p_tipo='receber' and v_bt.tipo<>'entrada') or (p_tipo='pagar' and v_bt.tipo<>'saida') then
    raise exception 'Tipo da conta não bate com o movimento'; end if;
  if p_tipo='receber' then select saldo into v_saldo from public.receivable_installments where id=p_installment_id;
  else                     select saldo into v_saldo from public.payable_installments    where id=p_installment_id; end if;
  if v_saldo is null then raise exception 'Parcela não encontrada'; end if;
  if v_saldo <= 0 then raise exception 'Parcela já está quitada'; end if;
  v_val := least(v_bt.valor, v_saldo);
  perform public.conciliar_movimento_multi(p_bank_transaction_id,
    jsonb_build_array(jsonb_build_object('installment_id',p_installment_id,'valor',v_val)),
    v_bt.valor - v_val, 0, 0);
end $$;

-- ---------------------------------------------------------------------
-- 7. desconciliar_movimento — MESMA assinatura.
--    Reverte exatamente o valor gravado em cada item.
--    Vínculos antigos (antes deste SQL) continuam desfazendo pelo jeito antigo,
--    agora descontando juros/multa/desconto do principal.
-- ---------------------------------------------------------------------
create or replace function public.desconciliar_movimento(p_bank_transaction_id uuid)
returns void language plpgsql as $$
declare v_bt public.bank_transactions%rowtype; v_it record; v_val numeric(14,2); v_rec numeric(14,2); v_n int := 0;
begin
  select * into v_bt from public.bank_transactions where id=p_bank_transaction_id for update;
  if not found then raise exception 'Movimento não encontrado'; end if;

  if exists (select 1 from public.conciliacao_itens where bank_transaction_id=v_bt.id) then
    for v_it in select * from public.conciliacao_itens where bank_transaction_id=v_bt.id loop
      perform public._aplicar_parcela(v_it.tipo, coalesce(v_it.receivable_installment_id, v_it.payable_installment_id), -v_it.valor);
      v_n := v_n + 1;
    end loop;
    delete from public.conciliacao_itens where bank_transaction_id=v_bt.id;
    update public.bank_transactions set juros=0, multa=0, desconto=0 where id=v_bt.id; -- trigger desmarca

  elsif v_bt.receivable_installment_id is not null then
    select valor_recebido into v_rec from public.receivable_installments where id=v_bt.receivable_installment_id;
    v_val := least(v_bt.valor - v_bt.juros - v_bt.multa + v_bt.desconto, coalesce(v_rec,0));
    if v_val > 0 then perform public._aplicar_parcela('receber', v_bt.receivable_installment_id, -v_val); end if;
    update public.bank_transactions set receivable_installment_id=null where id=v_bt.id;
    v_n := 1;
  elsif v_bt.payable_installment_id is not null then
    select valor_pago into v_rec from public.payable_installments where id=v_bt.payable_installment_id;
    v_val := least(v_bt.valor - v_bt.juros - v_bt.multa + v_bt.desconto, coalesce(v_rec,0));
    if v_val > 0 then perform public._aplicar_parcela('pagar', v_bt.payable_installment_id, -v_val); end if;
    update public.bank_transactions set payable_installment_id=null where id=v_bt.id;
    v_n := 1;
  else
    raise exception 'Movimento não está conciliado';
  end if;

  insert into public.audit_logs(company_id,user_id,acao,tabela,registro_id,valor_anterior)
  values (v_bt.company_id, auth.uid(), 'desconciliacao', 'bank_transactions', v_bt.id,
          jsonb_build_object('itens', v_n, 'valor', v_bt.valor));
end $$;

-- ---------------------------------------------------------------------
-- 8. estornar_baixa — MESMA assinatura. Agora também bloqueia parcela
--    conciliada pelos itens (1↔N).
-- ---------------------------------------------------------------------
create or replace function public.estornar_baixa(p_installment_id uuid, p_tipo text)
returns void language plpgsql as $$
declare v_rinst public.receivable_installments%rowtype; v_pinst public.payable_installments%rowtype; v_imp int;
begin
  if p_tipo='receber' then
    select * into v_rinst from public.receivable_installments where id=p_installment_id for update;
    if not found then raise exception 'Parcela não encontrada'; end if;
    select count(*) into v_imp from public.bank_transactions where receivable_installment_id=p_installment_id and origem='importado';
    v_imp := v_imp + (select count(*) from public.conciliacao_itens where receivable_installment_id=p_installment_id);
    if v_imp>0 then raise exception 'Parcela conciliada com extrato. Use Desfazer na Conciliação.'; end if;
    delete from public.bank_transactions where receivable_installment_id=p_installment_id;
    update public.receivable_installments set valor_recebido=0, status='a_receber' where id=p_installment_id;
    update public.receivables r set status=case when not exists(select 1 from public.receivable_installments i where i.receivable_id=r.id and i.status not in('recebido','cancelado')) then 'quitado' else 'aberto' end where r.id=v_rinst.receivable_id;
    insert into public.audit_logs(company_id,user_id,acao,tabela,registro_id) values (v_rinst.company_id,auth.uid(),'estorno','receivable_installments',p_installment_id);
  elsif p_tipo='pagar' then
    select * into v_pinst from public.payable_installments where id=p_installment_id for update;
    if not found then raise exception 'Parcela não encontrada'; end if;
    select count(*) into v_imp from public.bank_transactions where payable_installment_id=p_installment_id and origem='importado';
    v_imp := v_imp + (select count(*) from public.conciliacao_itens where payable_installment_id=p_installment_id);
    if v_imp>0 then raise exception 'Parcela conciliada com extrato. Use Desfazer na Conciliação.'; end if;
    delete from public.bank_transactions where payable_installment_id=p_installment_id;
    update public.payable_installments set valor_pago=0, status='a_pagar' where id=p_installment_id;
    update public.payables p set status=case when not exists(select 1 from public.payable_installments i where i.payable_id=p.id and i.status not in('pago','cancelado')) then 'quitado' else 'aberto' end where p.id=v_pinst.payable_id;
    insert into public.audit_logs(company_id,user_id,acao,tabela,registro_id) values (v_pinst.company_id,auth.uid(),'estorno','payable_installments',p_installment_id);
  else raise exception 'Tipo inválido'; end if;
end $$;

grant execute on function public.conciliar_movimento_multi(uuid,jsonb,numeric,numeric,numeric) to anon, authenticated;
grant execute on function public.conciliar_varios_movimentos(uuid[],uuid,text)               to anon, authenticated;
grant execute on function public.conciliar_movimento(uuid,uuid,text)                          to anon, authenticated;
grant execute on function public.desconciliar_movimento(uuid)                                 to anon, authenticated;
grant execute on function public.estornar_baixa(uuid,text)                                    to anon, authenticated;

-- PostgREST recarrega o schema (nova tabela/funções aparecem na hora)
notify pgrst, 'reload schema';
