-- =====================================================================
-- CANDIDUS — FASE 2: REGRAS AUTOMÁTICAS DE CONCILIAÇÃO (tarifas etc.)
--   "descrição contém X" (+ tipo e faixa de valor) →
--      • lançar conta (categoria/fornecedor/CC) e já conciliar, ou
--      • marcar como transferência
--   Aplica manual (botão na Conciliação) ou automático após importar extrato.
-- Rode UMA vez no SQL Editor (pode rodar de novo sem quebrar).
-- Requer: candidus_conciliacao_multi.sql já rodado.
--
-- FUNÇÕES:
--   NOVAS:    _norm_txt, simular_regras_conciliacao, aplicar_regras_conciliacao,
--             trg_regra_valida
--   ALTERADA (MESMA assinatura → sem overload): desconciliar_movimento
--             (só passa a limpar regra_id)
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Tabela de regras
-- ---------------------------------------------------------------------
create table if not exists public.conciliation_rules (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete cascade,
  nome                 text not null,
  texto                text not null,                 -- trecho da descrição do extrato
  tipo_movimento       text not null default 'saida' check (tipo_movimento in ('entrada','saida','ambos')),
  valor_min            numeric(14,2),
  valor_max            numeric(14,2),
  acao                 text not null default 'lancar' check (acao in ('lancar','transferencia')),
  categoria_id         uuid references public.categories(id)   on delete set null,
  cost_center_id       uuid references public.cost_centers(id) on delete set null,
  supplier_id          uuid references public.suppliers(id)    on delete set null,
  customer_id          uuid references public.customers(id)    on delete set null,
  descricao_lancamento text,                          -- vazio = usa a descrição do extrato
  aplicar_auto         boolean not null default true, -- roda sozinho ao importar extrato
  prioridade           int not null default 100,      -- menor = testa primeiro
  ativo                boolean not null default true,
  qtd_aplicada         int not null default 0,
  ultima_aplicacao     timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint regra_texto_ck  check (length(trim(texto)) >= 2),
  constraint regra_faixa_ck  check (valor_min is null or valor_max is null or valor_min <= valor_max),
  constraint regra_acao_ck   check ((acao='lancar' and tipo_movimento in ('entrada','saida')) or acao='transferencia')
);
create index if not exists idx_regras_company on public.conciliation_rules(company_id, ativo, prioridade);

drop trigger if exists trg_regras_updated on public.conciliation_rules;
create trigger trg_regras_updated before update on public.conciliation_rules
  for each row execute function public.set_updated_at();

alter table public.conciliation_rules enable row level security;
drop policy if exists regras_rls on public.conciliation_rules;
create policy regras_rls on public.conciliation_rules for all to authenticated
  using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
grant all on public.conciliation_rules to anon, authenticated;

-- Qual regra lançou/marcou o movimento
alter table public.bank_transactions add column if not exists regra_id uuid
  references public.conciliation_rules(id) on delete set null;

-- ---------------------------------------------------------------------
-- 2. Validação da regra (categoria/fornecedor/cliente da mesma empresa e do tipo certo)
-- ---------------------------------------------------------------------
create or replace function public.trg_regra_valida() returns trigger language plpgsql as $$
declare v_co uuid; v_tipo text;
begin
  new.texto := trim(new.texto);
  if new.acao = 'lancar' then
    if new.categoria_id is null then raise exception 'Regra de lançamento precisa de categoria'; end if;
    select company_id, tipo into v_co, v_tipo from public.categories where id = new.categoria_id;
    if v_co is distinct from new.company_id then raise exception 'Categoria é de outra empresa'; end if;
    if new.tipo_movimento='saida'   and v_tipo<>'despesa' then raise exception 'Saída precisa de categoria de despesa'; end if;
    if new.tipo_movimento='entrada' and v_tipo<>'receita' then raise exception 'Entrada precisa de categoria de receita'; end if;
    if new.cost_center_id is not null and (select company_id from public.cost_centers where id=new.cost_center_id) is distinct from new.company_id
      then raise exception 'Centro de custo é de outra empresa'; end if;
    if new.tipo_movimento='saida' then new.customer_id := null; else new.supplier_id := null; end if;
    if new.supplier_id is not null and (select company_id from public.suppliers where id=new.supplier_id) is distinct from new.company_id
      then raise exception 'Fornecedor é de outra empresa'; end if;
    if new.customer_id is not null and (select company_id from public.customers where id=new.customer_id) is distinct from new.company_id
      then raise exception 'Cliente é de outra empresa'; end if;
  else
    -- transferência não lança nada
    new.categoria_id := null; new.cost_center_id := null; new.supplier_id := null; new.customer_id := null;
    new.descricao_lancamento := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_regra_valida on public.conciliation_rules;
create trigger trg_regra_valida before insert or update on public.conciliation_rules
  for each row execute function public.trg_regra_valida();

-- ---------------------------------------------------------------------
-- 3. Normalização de texto (minúsculo, sem acento, espaços únicos)
-- ---------------------------------------------------------------------
create or replace function public._norm_txt(p text) returns text language sql immutable as $$
  select regexp_replace(
           translate(lower(coalesce(p,'')),
             'áàâãäåéèêëíìîïóòôõöúùûüçñ', 'aaaaaaeeeeiiiiooooouuuucn'),
           '\s+', ' ', 'g')
$$;

-- ---------------------------------------------------------------------
-- 4. Simulação: qual regra pega cada movimento pendente (não altera nada)
-- ---------------------------------------------------------------------
create or replace function public.simular_regras_conciliacao(p_company uuid default null)
returns table (bank_transaction_id uuid, regra_id uuid, regra_nome text, acao text, aplicar_auto boolean)
language sql stable as $$
  select b.id, r.id, r.nome, r.acao, r.aplicar_auto
  from public.bank_transactions b
  cross join lateral (
    select r.* from public.conciliation_rules r
    where r.company_id = b.company_id and r.ativo
      and (r.tipo_movimento = 'ambos' or r.tipo_movimento = b.tipo)
      and position(public._norm_txt(r.texto) in public._norm_txt(b.descricao)) > 0
      and (r.valor_min is null or b.valor >= r.valor_min)
      and (r.valor_max is null or b.valor <= r.valor_max)
    order by r.prioridade, length(r.texto) desc, r.created_at
    limit 1
  ) r
  where b.conciliado = false and b.tipo in ('entrada','saida')
    and (p_company is null or b.company_id = p_company)
$$;

-- ---------------------------------------------------------------------
-- 5. Aplicação
--    p_bank_transaction_ids: só esses movimentos (null = todos pendentes)
--    p_somente_auto: só regras marcadas "aplicar automaticamente" (usado na importação)
--    Retorna {"aplicados":n,"erros":n,"mensagens":[...]} — um erro não trava os outros.
-- ---------------------------------------------------------------------
create or replace function public.aplicar_regras_conciliacao(
  p_company              uuid    default null,
  p_bank_transaction_ids uuid[]  default null,
  p_somente_auto         boolean default false
) returns jsonb language plpgsql as $$
declare
  s record; v_bt public.bank_transactions%rowtype; v_r public.conciliation_rules%rowtype;
  v_tid uuid; v_inst uuid; v_desc text; v_ok int := 0; v_err int := 0; v_msgs text[] := '{}';
begin
  for s in select * from public.simular_regras_conciliacao(p_company) x
           where (p_bank_transaction_ids is null or x.bank_transaction_id = any(p_bank_transaction_ids))
             and (not p_somente_auto or x.aplicar_auto)
  loop
    begin
      select * into v_bt from public.bank_transactions where id = s.bank_transaction_id for update;
      if v_bt.conciliado or v_bt.tipo not in ('entrada','saida') then continue; end if;
      select * into v_r from public.conciliation_rules where id = s.regra_id;

      if v_r.acao = 'transferencia' then
        update public.bank_transactions set tipo='transferencia', regra_id=v_r.id where id=v_bt.id;
      else
        v_desc := coalesce(nullif(trim(v_r.descricao_lancamento),''), v_bt.descricao, v_r.nome);
        if v_bt.tipo = 'saida' then
          v_tid := public.criar_conta_pagar(v_bt.company_id, v_r.supplier_id, v_desc, v_bt.valor, v_bt.data, 1, 1,
                     v_r.categoria_id, v_r.cost_center_id, v_bt.financial_account_id, null, null, v_bt.data, null);
          select id into v_inst from public.payable_installments where payable_id = v_tid;
        else
          v_tid := public.criar_conta_receber(v_bt.company_id, v_r.customer_id, v_desc, v_bt.valor, v_bt.data, 1, 1,
                     v_r.categoria_id, v_r.cost_center_id, v_bt.financial_account_id, null, null, v_bt.data);
          select id into v_inst from public.receivable_installments where receivable_id = v_tid;
        end if;
        perform public.conciliar_movimento_multi(v_bt.id,
          jsonb_build_array(jsonb_build_object('installment_id', v_inst, 'valor', v_bt.valor)), 0, 0, 0);
        update public.bank_transactions set regra_id = v_r.id where id = v_bt.id;
      end if;

      update public.conciliation_rules set qtd_aplicada = qtd_aplicada + 1, ultima_aplicacao = now() where id = v_r.id;
      insert into public.audit_logs(company_id,user_id,acao,tabela,registro_id,valor_novo)
      values (v_bt.company_id, auth.uid(), 'regra_conciliacao', 'bank_transactions', v_bt.id,
              jsonb_build_object('regra', v_r.nome, 'regra_id', v_r.id, 'acao', v_r.acao, 'valor', v_bt.valor));
      v_ok := v_ok + 1;
    exception when others then
      v_err := v_err + 1;
      v_msgs := v_msgs || (coalesce(s.regra_nome,'regra') || ': ' || sqlerrm);
    end;
  end loop;
  return jsonb_build_object('aplicados', v_ok, 'erros', v_err, 'mensagens', to_jsonb(v_msgs));
end $$;

-- ---------------------------------------------------------------------
-- 6. desconciliar_movimento — MESMA assinatura; agora também limpa regra_id.
--    (A conta criada pela regra continua existindo, em aberto — igual ao
--     "Criar lançamento". Dá pra cancelar em Contas a pagar/receber.)
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
    update public.bank_transactions set juros=0, multa=0, desconto=0, regra_id=null where id=v_bt.id;

  elsif v_bt.receivable_installment_id is not null then
    select valor_recebido into v_rec from public.receivable_installments where id=v_bt.receivable_installment_id;
    v_val := least(v_bt.valor - v_bt.juros - v_bt.multa + v_bt.desconto, coalesce(v_rec,0));
    if v_val > 0 then perform public._aplicar_parcela('receber', v_bt.receivable_installment_id, -v_val); end if;
    update public.bank_transactions set receivable_installment_id=null, regra_id=null where id=v_bt.id;
    v_n := 1;
  elsif v_bt.payable_installment_id is not null then
    select valor_pago into v_rec from public.payable_installments where id=v_bt.payable_installment_id;
    v_val := least(v_bt.valor - v_bt.juros - v_bt.multa + v_bt.desconto, coalesce(v_rec,0));
    if v_val > 0 then perform public._aplicar_parcela('pagar', v_bt.payable_installment_id, -v_val); end if;
    update public.bank_transactions set payable_installment_id=null, regra_id=null where id=v_bt.id;
    v_n := 1;
  else
    raise exception 'Movimento não está conciliado';
  end if;

  insert into public.audit_logs(company_id,user_id,acao,tabela,registro_id,valor_anterior)
  values (v_bt.company_id, auth.uid(), 'desconciliacao', 'bank_transactions', v_bt.id,
          jsonb_build_object('itens', v_n, 'valor', v_bt.valor));
end $$;

grant execute on function public.simular_regras_conciliacao(uuid)               to anon, authenticated;
grant execute on function public.aplicar_regras_conciliacao(uuid,uuid[],boolean) to anon, authenticated;
grant execute on function public.desconciliar_movimento(uuid)                    to anon, authenticated;

notify pgrst, 'reload schema';
