-- =====================================================================
-- CANDIDUS — ATUALIZAÇÃO DO BANCO: etapas 04 a 17 de uma vez
-- Gerado em 20/10/2026 para o banco que o diagnostico.sql mostrou parado na etapa 03.
-- É só a junção, em ordem, de supabase/historico/04..17 (nada foi alterado neles).
--
-- TUDO OU NADA: está dentro de uma transação. Se qualquer parte der erro,
-- nada é aplicado e o banco continua como estava (na etapa 03).
--
-- MEXE EM FUNÇÕES: recria criar_conta_*, baixar_*_installment, conciliação, DRE etc.
-- e remove as versões antigas duplicadas (etapa 10).
--
-- Depois de rodar com sucesso, rode o diagnostico.sql de novo: tudo deve estar ✓.
-- Este arquivo serve só para esta atualização; pode apagar depois.
-- =====================================================================
begin;


-- ############################ 04_candidus_cartoes.sql ############################
-- =====================================================================
-- CANDIDUS — CARTÃO DE CRÉDITO (fatura)
-- Rode no SQL Editor depois do banco já existir. Roda uma vez.
-- =====================================================================

-- 1) Adiciona "cartão de crédito" como tipo de conta financeira + fechamento/vencimento
alter table public.financial_accounts drop constraint if exists financial_accounts_tipo_check;
alter table public.financial_accounts add constraint financial_accounts_tipo_check
  check (tipo in ('conta_corrente','poupanca','investimento','caixa','cartao_credito'));
alter table public.financial_accounts add column if not exists dia_fechamento int;
alter table public.financial_accounts add column if not exists dia_vencimento int;

-- 2) criar_conta_pagar passa a aceitar competência opcional.
--    (No cartão, a competência da despesa = mês da COMPRA, não do vencimento da fatura.)
create or replace function public.criar_conta_pagar(
  p_company_id           uuid,
  p_supplier_id          uuid,
  p_descricao            text,
  p_valor_total          numeric,
  p_primeiro_vencimento  date,
  p_qtd_parcelas         int  default 1,
  p_intervalo_meses      int  default 1,
  p_categoria_id         uuid default null,
  p_cost_center_id       uuid default null,
  p_financial_account_id uuid default null,
  p_documento            text default null,
  p_forma_pagamento      text default null,
  p_data_emissao         date default null,
  p_competencia          date default null
) returns uuid
language plpgsql as $$
declare
  v_id    uuid;
  v_tipo  text;
  v_parc  numeric(14,2);
  v_acum  numeric(14,2) := 0;
  v_valor numeric(14,2);
  v_venc  date;
  i       int;
begin
  if coalesce(p_qtd_parcelas,1) < 1 then raise exception 'Quantidade de parcelas deve ser >= 1'; end if;
  if p_valor_total <= 0 then raise exception 'Valor total deve ser positivo'; end if;

  v_tipo := case when p_qtd_parcelas > 1 then 'parcelado' else 'a_vista' end;

  insert into public.payables(
    company_id, supplier_id, descricao, documento, categoria_id, cost_center_id,
    financial_account_id, data_emissao, forma_pagamento, tipo, valor_total, status
  ) values (
    p_company_id, p_supplier_id, p_descricao, p_documento, p_categoria_id, p_cost_center_id,
    p_financial_account_id, coalesce(p_data_emissao, current_date), p_forma_pagamento,
    v_tipo, p_valor_total, 'aberto'
  ) returning id into v_id;

  v_parc := round(p_valor_total / p_qtd_parcelas, 2);

  for i in 1..p_qtd_parcelas loop
    v_venc := (p_primeiro_vencimento + (((i-1) * p_intervalo_meses) * interval '1 month'))::date;
    if i < p_qtd_parcelas then v_valor := v_parc; v_acum := v_acum + v_valor;
    else v_valor := p_valor_total - v_acum; end if;

    insert into public.payable_installments(
      payable_id, company_id, numero, total_parcelas, competencia, vencimento, valor
    ) values (
      v_id, p_company_id, i, p_qtd_parcelas,
      coalesce(p_competencia, date_trunc('month', v_venc)::date), v_venc, v_valor
    );
  end loop;

  insert into public.audit_logs(company_id, user_id, acao, tabela, registro_id, valor_novo)
  values (p_company_id, auth.uid(), 'insert', 'payables', v_id,
          jsonb_build_object('descricao', p_descricao, 'valor_total', p_valor_total, 'parcelas', p_qtd_parcelas));
  return v_id;
end;
$$;


-- ############################ 05_candidus_fatura_fix.sql ############################
-- =====================================================================
-- CANDIDUS — ajuste: descrição do pagamento (p/ fatura de cartão no fluxo)
-- Rode uma vez no SQL Editor.
-- =====================================================================
create or replace function public.baixar_payable_installment(
  p_installment_id       uuid,
  p_valor                numeric,
  p_financial_account_id uuid,
  p_data                 date default current_date,
  p_forma                text default null,
  p_observacao           text default null,
  p_descricao            text default null
) returns void
language plpgsql as $$
declare
  v_inst   public.payable_installments%rowtype;
  v_novo   numeric(14,2);
  v_status text;
begin
  select * into v_inst from public.payable_installments where id = p_installment_id for update;
  if not found then raise exception 'Parcela não encontrada ou sem acesso'; end if;
  if v_inst.status = 'cancelado' then raise exception 'Parcela cancelada não recebe baixa'; end if;
  if p_valor <= 0 then raise exception 'Valor da baixa deve ser positivo'; end if;
  if p_financial_account_id is null then raise exception 'Informe a conta financeira do pagamento'; end if;

  v_novo := v_inst.valor_pago + p_valor;
  if v_novo > v_inst.valor + 0.005 then
    raise exception 'Valor pago (%) excede o valor da parcela (%)', v_novo, v_inst.valor;
  end if;
  v_status := case when v_novo >= v_inst.valor then 'pago' else 'pago_parcial' end;

  update public.payable_installments set valor_pago = v_novo, status = v_status where id = p_installment_id;

  insert into public.bank_transactions(
    company_id, financial_account_id, tipo, descricao, valor, data,
    payable_installment_id, forma, observacao
  ) values (
    v_inst.company_id, p_financial_account_id, 'saida',
    coalesce(p_descricao, 'Pagamento parcela '||v_inst.numero||'/'||v_inst.total_parcelas),
    p_valor, p_data, p_installment_id, p_forma, p_observacao
  );

  update public.payables p set status = case
    when not exists (select 1 from public.payable_installments i where i.payable_id = p.id and i.status not in ('pago','cancelado'))
    then 'quitado' else 'aberto' end
  where p.id = v_inst.payable_id;

  insert into public.audit_logs(company_id, user_id, acao, tabela, registro_id, valor_anterior, valor_novo)
  values (v_inst.company_id, auth.uid(), 'baixa', 'payable_installments', p_installment_id,
    jsonb_build_object('valor_pago', v_inst.valor_pago, 'status', v_inst.status),
    jsonb_build_object('valor_pago', v_novo, 'status', v_status));
end;
$$;


-- ############################ 06_candidus_fase3_import.sql ############################
-- =====================================================================
-- CANDIDUS — FASE 3 (bloco 1): IMPORTAÇÃO DE EXTRATO (OFX/CSV) + dedup
-- Rode uma vez no SQL Editor.
-- =====================================================================

-- Rastreia a origem do movimento bancário (manual x importado)
alter table public.bank_transactions add column if not exists origem text not null default 'manual';
alter table public.bank_transactions add column if not exists imported_transaction_id uuid;

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  financial_account_id uuid not null references public.financial_accounts(id) on delete cascade,
  origem text not null check (origem in ('ofx','csv')),
  nome_arquivo text,
  periodo_inicio date,
  periodo_fim date,
  qtd_total int not null default 0,
  qtd_importadas int not null default 0,
  qtd_duplicadas int not null default 0,
  status text not null default 'concluido' check (status in ('conferindo','concluido','cancelado')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.imported_transactions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  financial_account_id uuid not null references public.financial_accounts(id) on delete cascade,
  data date not null,
  descricao text,
  documento text,
  valor numeric(14,2) not null,        -- sempre positivo
  tipo text not null check (tipo in ('entrada','saida')),
  fit_id text,                          -- id único do OFX (quando houver)
  hash text,                            -- conta|data|valor|descrição (p/ dedup)
  status text not null default 'nova'
    check (status in ('nova','possivel_duplicada','duplicada','importada','ignorada')),
  bank_transaction_id uuid references public.bank_transactions(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_batches_company on public.import_batches(company_id);
create index idx_imptx_company on public.imported_transactions(company_id, status);
create index idx_imptx_hash on public.imported_transactions(financial_account_id, hash);
create index idx_imptx_fit on public.imported_transactions(financial_account_id, fit_id);

alter table public.import_batches        enable row level security;
alter table public.imported_transactions enable row level security;

create policy batches_rls on public.import_batches        for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy imptx_rls   on public.imported_transactions for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());

grant all on public.import_batches        to anon, authenticated;
grant all on public.imported_transactions to anon, authenticated;

-- =====================================================================
-- FIM bloco 1. Próximo: conciliação inteligente.
-- =====================================================================


-- ############################ 07_candidus_fase3_conciliacao.sql ############################
-- =====================================================================
-- CANDIDUS — FASE 3: CONCILIAÇÃO
-- Vincula um movimento bancário (já importado) a uma conta a pagar/receber,
-- dando baixa SEM criar novo lançamento de caixa (o movimento já é o caixa).
-- =====================================================================
create or replace function public.conciliar_movimento(
  p_bank_transaction_id uuid,
  p_installment_id uuid,
  p_tipo text          -- 'receber' | 'pagar'
) returns void
language plpgsql as $$
declare
  v_bt    public.bank_transactions%rowtype;
  v_rinst public.receivable_installments%rowtype;
  v_pinst public.payable_installments%rowtype;
  v_valor numeric(14,2);
begin
  select * into v_bt from public.bank_transactions where id=p_bank_transaction_id for update;
  if not found then raise exception 'Movimento não encontrado'; end if;
  if v_bt.receivable_installment_id is not null or v_bt.payable_installment_id is not null then
    raise exception 'Movimento já conciliado'; end if;

  if p_tipo='receber' then
    select * into v_rinst from public.receivable_installments where id=p_installment_id for update;
    if not found then raise exception 'Parcela não encontrada'; end if;
    v_valor := least(v_bt.valor, v_rinst.saldo);
    update public.receivable_installments
      set valor_recebido = valor_recebido + v_valor,
          status = case when valor_recebido + v_valor >= valor then 'recebido' else 'recebido_parcial' end
      where id = p_installment_id;
    update public.bank_transactions set receivable_installment_id = p_installment_id where id = p_bank_transaction_id;
    update public.receivables r set status = case
      when not exists (select 1 from public.receivable_installments i where i.receivable_id=r.id and i.status not in ('recebido','cancelado'))
      then 'quitado' else 'aberto' end where r.id = v_rinst.receivable_id;

  elsif p_tipo='pagar' then
    select * into v_pinst from public.payable_installments where id=p_installment_id for update;
    if not found then raise exception 'Parcela não encontrada'; end if;
    v_valor := least(v_bt.valor, v_pinst.saldo);
    update public.payable_installments
      set valor_pago = valor_pago + v_valor,
          status = case when valor_pago + v_valor >= valor then 'pago' else 'pago_parcial' end
      where id = p_installment_id;
    update public.bank_transactions set payable_installment_id = p_installment_id where id = p_bank_transaction_id;
    update public.payables p set status = case
      when not exists (select 1 from public.payable_installments i where i.payable_id=p.id and i.status not in ('pago','cancelado'))
      then 'quitado' else 'aberto' end where p.id = v_pinst.payable_id;
  else
    raise exception 'Tipo inválido';
  end if;

  insert into public.audit_logs(company_id,user_id,acao,tabela,registro_id,valor_novo)
  values (v_bt.company_id, auth.uid(), 'conciliacao', 'bank_transactions', p_bank_transaction_id,
          jsonb_build_object('installment', p_installment_id, 'valor', v_valor, 'tipo', p_tipo));
end;
$$;

create or replace function public.desconciliar_movimento(p_bank_transaction_id uuid)
returns void language plpgsql as $$
declare
  v_bt    public.bank_transactions%rowtype;
  v_rinst public.receivable_installments%rowtype;
  v_pinst public.payable_installments%rowtype;
  v_valor numeric(14,2);
begin
  select * into v_bt from public.bank_transactions where id=p_bank_transaction_id for update;
  if not found then raise exception 'Movimento não encontrado'; end if;

  if v_bt.receivable_installment_id is not null then
    select * into v_rinst from public.receivable_installments where id=v_bt.receivable_installment_id for update;
    v_valor := least(v_bt.valor, v_rinst.valor_recebido);
    update public.receivable_installments
      set valor_recebido = valor_recebido - v_valor,
          status = case when valor_recebido - v_valor <= 0 then 'a_receber'
                        when valor_recebido - v_valor >= valor then 'recebido' else 'recebido_parcial' end
      where id = v_rinst.id;
    update public.bank_transactions set receivable_installment_id = null where id = p_bank_transaction_id;
    update public.receivables r set status = case
      when not exists (select 1 from public.receivable_installments i where i.receivable_id=r.id and i.status not in ('recebido','cancelado'))
      then 'quitado' else 'aberto' end where r.id = v_rinst.receivable_id;

  elsif v_bt.payable_installment_id is not null then
    select * into v_pinst from public.payable_installments where id=v_bt.payable_installment_id for update;
    v_valor := least(v_bt.valor, v_pinst.valor_pago);
    update public.payable_installments
      set valor_pago = valor_pago - v_valor,
          status = case when valor_pago - v_valor <= 0 then 'a_pagar'
                        when valor_pago - v_valor >= valor then 'pago' else 'pago_parcial' end
      where id = v_pinst.id;
    update public.bank_transactions set payable_installment_id = null where id = p_bank_transaction_id;
    update public.payables p set status = case
      when not exists (select 1 from public.payable_installments i where i.payable_id=p.id and i.status not in ('pago','cancelado'))
      then 'quitado' else 'aberto' end where p.id = v_pinst.payable_id;
  else
    raise exception 'Movimento não está conciliado';
  end if;

  insert into public.audit_logs(company_id,user_id,acao,tabela,registro_id,valor_anterior)
  values (v_bt.company_id, auth.uid(), 'desconciliacao', 'bank_transactions', p_bank_transaction_id,
          jsonb_build_object('valor', v_valor));
end;
$$;

grant execute on function public.conciliar_movimento(uuid,uuid,text) to anon, authenticated;
grant execute on function public.desconciliar_movimento(uuid) to anon, authenticated;


-- ############################ 08_candidus_fase2_op.sql ############################
-- =====================================================================
-- CANDIDUS — FASE 2 (operação): juros, multa, desconto na baixa + estorno
-- Rode uma vez no SQL Editor.
-- =====================================================================

-- Garante a coluna origem (usada pelo estorno; normalmente já criada na Fase 3)
alter table public.bank_transactions add column if not exists origem text not null default 'manual';

-- Colunas de ajuste financeiro no movimento bancário
alter table public.bank_transactions add column if not exists juros    numeric(14,2) not null default 0;
alter table public.bank_transactions add column if not exists multa    numeric(14,2) not null default 0;
alter table public.bank_transactions add column if not exists desconto numeric(14,2) not null default 0;

-- BAIXA DE RECEBIMENTO (com juros/multa/desconto)
-- p_valor = principal que quita a parcela; caixa = valor + juros + multa - desconto
create or replace function public.baixar_receivable_installment(
  p_installment_id       uuid,
  p_valor                numeric,
  p_financial_account_id uuid,
  p_data                 date default current_date,
  p_forma                text default null,
  p_observacao           text default null,
  p_juros                numeric default 0,
  p_multa                numeric default 0,
  p_desconto             numeric default 0
) returns void language plpgsql as $$
declare v_inst public.receivable_installments%rowtype; v_novo numeric(14,2); v_status text; v_cash numeric(14,2);
begin
  select * into v_inst from public.receivable_installments where id=p_installment_id for update;
  if not found then raise exception 'Parcela não encontrada ou sem acesso'; end if;
  if v_inst.status='cancelado' then raise exception 'Parcela cancelada não recebe baixa'; end if;
  if p_valor <= 0 then raise exception 'Valor da baixa deve ser positivo'; end if;
  if p_financial_account_id is null then raise exception 'Informe a conta financeira do recebimento'; end if;
  v_novo := v_inst.valor_recebido + p_valor;
  if v_novo > v_inst.valor + 0.005 then raise exception 'Valor recebido (%) excede o valor da parcela (%)', v_novo, v_inst.valor; end if;
  v_status := case when v_novo >= v_inst.valor then 'recebido' else 'recebido_parcial' end;
  v_cash := p_valor + coalesce(p_juros,0) + coalesce(p_multa,0) - coalesce(p_desconto,0);

  update public.receivable_installments set valor_recebido=v_novo, status=v_status where id=p_installment_id;
  insert into public.bank_transactions(company_id,financial_account_id,tipo,descricao,valor,data,receivable_installment_id,forma,observacao,juros,multa,desconto)
    values (v_inst.company_id,p_financial_account_id,'entrada','Recebimento parcela '||v_inst.numero||'/'||v_inst.total_parcelas,v_cash,p_data,p_installment_id,p_forma,p_observacao,coalesce(p_juros,0),coalesce(p_multa,0),coalesce(p_desconto,0));
  update public.receivables r set status=case when not exists(select 1 from public.receivable_installments i where i.receivable_id=r.id and i.status not in('recebido','cancelado')) then 'quitado' else 'aberto' end where r.id=v_inst.receivable_id;

  insert into public.audit_logs(company_id,user_id,acao,tabela,registro_id,valor_anterior,valor_novo)
  values (v_inst.company_id, auth.uid(), 'baixa', 'receivable_installments', p_installment_id,
    jsonb_build_object('valor_recebido',v_inst.valor_recebido,'status',v_inst.status),
    jsonb_build_object('valor_recebido',v_novo,'status',v_status,'juros',p_juros,'multa',p_multa,'desconto',p_desconto,'caixa',v_cash));
end; $$;

-- BAIXA DE PAGAMENTO (com juros/multa/desconto; mantém p_descricao da fatura)
create or replace function public.baixar_payable_installment(
  p_installment_id       uuid,
  p_valor                numeric,
  p_financial_account_id uuid,
  p_data                 date default current_date,
  p_forma                text default null,
  p_observacao           text default null,
  p_descricao            text default null,
  p_juros                numeric default 0,
  p_multa                numeric default 0,
  p_desconto             numeric default 0
) returns void language plpgsql as $$
declare v_inst public.payable_installments%rowtype; v_novo numeric(14,2); v_status text; v_cash numeric(14,2);
begin
  select * into v_inst from public.payable_installments where id=p_installment_id for update;
  if not found then raise exception 'Parcela não encontrada ou sem acesso'; end if;
  if v_inst.status='cancelado' then raise exception 'Parcela cancelada não recebe baixa'; end if;
  if p_valor <= 0 then raise exception 'Valor da baixa deve ser positivo'; end if;
  if p_financial_account_id is null then raise exception 'Informe a conta financeira do pagamento'; end if;
  v_novo := v_inst.valor_pago + p_valor;
  if v_novo > v_inst.valor + 0.005 then raise exception 'Valor pago (%) excede o valor da parcela (%)', v_novo, v_inst.valor; end if;
  v_status := case when v_novo >= v_inst.valor then 'pago' else 'pago_parcial' end;
  v_cash := p_valor + coalesce(p_juros,0) + coalesce(p_multa,0) - coalesce(p_desconto,0);

  update public.payable_installments set valor_pago=v_novo, status=v_status where id=p_installment_id;
  insert into public.bank_transactions(company_id,financial_account_id,tipo,descricao,valor,data,payable_installment_id,forma,observacao,juros,multa,desconto)
    values (v_inst.company_id,p_financial_account_id,'saida',coalesce(p_descricao,'Pagamento parcela '||v_inst.numero||'/'||v_inst.total_parcelas),v_cash,p_data,p_installment_id,p_forma,p_observacao,coalesce(p_juros,0),coalesce(p_multa,0),coalesce(p_desconto,0));
  update public.payables p set status=case when not exists(select 1 from public.payable_installments i where i.payable_id=p.id and i.status not in('pago','cancelado')) then 'quitado' else 'aberto' end where p.id=v_inst.payable_id;

  insert into public.audit_logs(company_id,user_id,acao,tabela,registro_id,valor_anterior,valor_novo)
  values (v_inst.company_id, auth.uid(), 'baixa', 'payable_installments', p_installment_id,
    jsonb_build_object('valor_pago',v_inst.valor_pago,'status',v_inst.status),
    jsonb_build_object('valor_pago',v_novo,'status',v_status,'juros',p_juros,'multa',p_multa,'desconto',p_desconto,'caixa',v_cash));
end; $$;

-- ESTORNO: desfaz TODAS as baixas manuais de uma parcela (volta a em aberto)
create or replace function public.estornar_baixa(p_installment_id uuid, p_tipo text)
returns void language plpgsql as $$
declare v_rinst public.receivable_installments%rowtype; v_pinst public.payable_installments%rowtype; v_imp int;
begin
  if p_tipo='receber' then
    select * into v_rinst from public.receivable_installments where id=p_installment_id for update;
    if not found then raise exception 'Parcela não encontrada'; end if;
    select count(*) into v_imp from public.bank_transactions where receivable_installment_id=p_installment_id and origem='importado';
    if v_imp>0 then raise exception 'Parcela conciliada com extrato. Use Desfazer na Conciliação.'; end if;
    delete from public.bank_transactions where receivable_installment_id=p_installment_id;
    update public.receivable_installments set valor_recebido=0, status='a_receber' where id=p_installment_id;
    update public.receivables r set status=case when not exists(select 1 from public.receivable_installments i where i.receivable_id=r.id and i.status not in('recebido','cancelado')) then 'quitado' else 'aberto' end where r.id=v_rinst.receivable_id;
    insert into public.audit_logs(company_id,user_id,acao,tabela,registro_id) values (v_rinst.company_id,auth.uid(),'estorno','receivable_installments',p_installment_id);
  elsif p_tipo='pagar' then
    select * into v_pinst from public.payable_installments where id=p_installment_id for update;
    if not found then raise exception 'Parcela não encontrada'; end if;
    select count(*) into v_imp from public.bank_transactions where payable_installment_id=p_installment_id and origem='importado';
    if v_imp>0 then raise exception 'Parcela conciliada com extrato. Use Desfazer na Conciliação.'; end if;
    delete from public.bank_transactions where payable_installment_id=p_installment_id;
    update public.payable_installments set valor_pago=0, status='a_pagar' where id=p_installment_id;
    update public.payables p set status=case when not exists(select 1 from public.payable_installments i where i.payable_id=p.id and i.status not in('pago','cancelado')) then 'quitado' else 'aberto' end where p.id=v_pinst.payable_id;
    insert into public.audit_logs(company_id,user_id,acao,tabela,registro_id) values (v_pinst.company_id,auth.uid(),'estorno','payable_installments',p_installment_id);
  else raise exception 'Tipo inválido'; end if;
end; $$;

grant execute on function public.estornar_baixa(uuid,text) to anon, authenticated;


-- ############################ 09_candidus_recorrentes.sql ############################
-- =====================================================================
-- CANDIDUS — FASE 2: LANÇAMENTOS RECORRENTES (contas fixas)
-- Modelo que gera contas a pagar/receber automaticamente por período.
-- Rode uma vez no SQL Editor.
-- =====================================================================
create table public.recurring_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tipo text not null check (tipo in ('receber','pagar')),
  customer_id uuid references public.customers(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  descricao text not null,
  categoria_id uuid references public.categories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  financial_account_id uuid references public.financial_accounts(id) on delete set null,
  forma text,
  valor numeric(14,2) not null,
  periodicidade text not null check (periodicidade in ('semanal','quinzenal','mensal','trimestral','anual')),
  data_inicio date not null,
  data_fim date,
  proxima date not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_recur_updated before update on public.recurring_entries for each row execute function public.set_updated_at();
create index idx_recur_company on public.recurring_entries(company_id, ativo);

alter table public.recurring_entries enable row level security;
create policy recur_rls on public.recurring_entries for all to authenticated
  using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
grant all on public.recurring_entries to anon, authenticated;

-- Gera as contas pendentes de cada recorrência até a data informada (padrão: hoje).
-- O ponteiro "proxima" avança a cada geração, então rodar de novo NÃO duplica.
create or replace function public.gerar_recorrencias(p_company uuid default null, p_ate date default current_date)
returns int language plpgsql as $$
declare r record; v_count int := 0; v_prox date; guard int;
begin
  for r in select * from public.recurring_entries
           where ativo and proxima <= p_ate and (p_company is null or company_id = p_company) loop
    v_prox := r.proxima; guard := 0;
    while v_prox <= p_ate and (r.data_fim is null or v_prox <= r.data_fim) and guard < 120 loop
      if r.tipo='receber' then
        perform public.criar_conta_receber(r.company_id, r.customer_id, r.descricao, r.valor, v_prox, 1, 1,
                 r.categoria_id, r.cost_center_id, r.financial_account_id, null, r.forma, v_prox);
      else
        perform public.criar_conta_pagar(r.company_id, r.supplier_id, r.descricao, r.valor, v_prox, 1, 1,
                 r.categoria_id, r.cost_center_id, r.financial_account_id, null, r.forma, v_prox, null);
      end if;
      v_count := v_count + 1;
      v_prox := (case r.periodicidade
        when 'semanal'    then v_prox + interval '7 days'
        when 'quinzenal'  then v_prox + interval '15 days'
        when 'mensal'     then v_prox + interval '1 month'
        when 'trimestral' then v_prox + interval '3 months'
        when 'anual'      then v_prox + interval '1 year' end)::date;
      guard := guard + 1;
    end loop;
    update public.recurring_entries set proxima = v_prox where id = r.id;
  end loop;
  return v_count;
end; $$;

grant execute on function public.gerar_recorrencias(uuid,date) to anon, authenticated;


-- ############################ 10_candidus_fix_funcoes.sql ############################
-- =====================================================================
-- CANDIDUS — CORREÇÃO: remove versões duplicadas (overloads) das funções
-- e deixa só a versão final de cada uma. Rode uma vez no SQL Editor.
-- (Resolve o erro de baixa individual/lote por função ambígua.)
-- =====================================================================

-- 1) Remove TODAS as versões existentes destas 4 funções
do $$
declare r record;
begin
  for r in select oid::regprocedure as sig from pg_proc
           where proname in ('criar_conta_receber','criar_conta_pagar','baixar_receivable_installment','baixar_payable_installment')
  loop execute 'drop function '||r.sig||' cascade'; end loop;
end $$;

-- 2) Recria a versão FINAL de cada uma
create or replace function public.criar_conta_receber(
  p_company_id           uuid,
  p_customer_id          uuid,
  p_descricao            text,
  p_valor_total          numeric,
  p_primeiro_vencimento  date,
  p_qtd_parcelas         int  default 1,
  p_intervalo_meses      int  default 1,
  p_categoria_id         uuid default null,
  p_cost_center_id       uuid default null,
  p_financial_account_id uuid default null,
  p_documento            text default null,
  p_forma_recebimento    text default null,
  p_data_emissao         date default null
) returns uuid
language plpgsql as $$
declare
  v_id        uuid;
  v_tipo      text;
  v_parc      numeric(14,2);
  v_acum      numeric(14,2) := 0;
  v_valor     numeric(14,2);
  v_venc      date;
  i           int;
begin
  if coalesce(p_qtd_parcelas,1) < 1 then
    raise exception 'Quantidade de parcelas deve ser >= 1';
  end if;
  if p_valor_total <= 0 then
    raise exception 'Valor total deve ser positivo';
  end if;

  v_tipo := case when p_qtd_parcelas > 1 then 'parcelado' else 'a_vista' end;

  insert into public.receivables(
    company_id, customer_id, descricao, documento, categoria_id, cost_center_id,
    financial_account_id, data_emissao, forma_recebimento, tipo, valor_total, status
  ) values (
    p_company_id, p_customer_id, p_descricao, p_documento, p_categoria_id, p_cost_center_id,
    p_financial_account_id, coalesce(p_data_emissao, current_date), p_forma_recebimento,
    v_tipo, p_valor_total, 'aberto'
  ) returning id into v_id;

  v_parc := round(p_valor_total / p_qtd_parcelas, 2);

  for i in 1..p_qtd_parcelas loop
    v_venc := (p_primeiro_vencimento + (((i-1) * p_intervalo_meses) * interval '1 month'))::date;
    if i < p_qtd_parcelas then
      v_valor := v_parc;
      v_acum  := v_acum + v_valor;
    else
      v_valor := p_valor_total - v_acum;   -- última parcela absorve o arredondamento
    end if;

    insert into public.receivable_installments(
      receivable_id, company_id, numero, total_parcelas, competencia, vencimento, valor
    ) values (
      v_id, p_company_id, i, p_qtd_parcelas,
      date_trunc('month', v_venc)::date, v_venc, v_valor
    );
  end loop;

  insert into public.audit_logs(company_id, user_id, acao, tabela, registro_id, valor_novo)
  values (p_company_id, auth.uid(), 'insert', 'receivables', v_id,
          jsonb_build_object('descricao', p_descricao, 'valor_total', p_valor_total,
                             'parcelas', p_qtd_parcelas));
  return v_id;
end;
$$;

create or replace function public.criar_conta_pagar(
  p_company_id           uuid,
  p_supplier_id          uuid,
  p_descricao            text,
  p_valor_total          numeric,
  p_primeiro_vencimento  date,
  p_qtd_parcelas         int  default 1,
  p_intervalo_meses      int  default 1,
  p_categoria_id         uuid default null,
  p_cost_center_id       uuid default null,
  p_financial_account_id uuid default null,
  p_documento            text default null,
  p_forma_pagamento      text default null,
  p_data_emissao         date default null,
  p_competencia          date default null
) returns uuid
language plpgsql as $$
declare
  v_id    uuid;
  v_tipo  text;
  v_parc  numeric(14,2);
  v_acum  numeric(14,2) := 0;
  v_valor numeric(14,2);
  v_venc  date;
  i       int;
begin
  if coalesce(p_qtd_parcelas,1) < 1 then raise exception 'Quantidade de parcelas deve ser >= 1'; end if;
  if p_valor_total <= 0 then raise exception 'Valor total deve ser positivo'; end if;

  v_tipo := case when p_qtd_parcelas > 1 then 'parcelado' else 'a_vista' end;

  insert into public.payables(
    company_id, supplier_id, descricao, documento, categoria_id, cost_center_id,
    financial_account_id, data_emissao, forma_pagamento, tipo, valor_total, status
  ) values (
    p_company_id, p_supplier_id, p_descricao, p_documento, p_categoria_id, p_cost_center_id,
    p_financial_account_id, coalesce(p_data_emissao, current_date), p_forma_pagamento,
    v_tipo, p_valor_total, 'aberto'
  ) returning id into v_id;

  v_parc := round(p_valor_total / p_qtd_parcelas, 2);

  for i in 1..p_qtd_parcelas loop
    v_venc := (p_primeiro_vencimento + (((i-1) * p_intervalo_meses) * interval '1 month'))::date;
    if i < p_qtd_parcelas then v_valor := v_parc; v_acum := v_acum + v_valor;
    else v_valor := p_valor_total - v_acum; end if;

    insert into public.payable_installments(
      payable_id, company_id, numero, total_parcelas, competencia, vencimento, valor
    ) values (
      v_id, p_company_id, i, p_qtd_parcelas,
      coalesce(p_competencia, date_trunc('month', v_venc)::date), v_venc, v_valor
    );
  end loop;

  insert into public.audit_logs(company_id, user_id, acao, tabela, registro_id, valor_novo)
  values (p_company_id, auth.uid(), 'insert', 'payables', v_id,
          jsonb_build_object('descricao', p_descricao, 'valor_total', p_valor_total, 'parcelas', p_qtd_parcelas));
  return v_id;
end;
$$;

create or replace function public.baixar_receivable_installment(
  p_installment_id       uuid,
  p_valor                numeric,
  p_financial_account_id uuid,
  p_data                 date default current_date,
  p_forma                text default null,
  p_observacao           text default null,
  p_juros                numeric default 0,
  p_multa                numeric default 0,
  p_desconto             numeric default 0
) returns void language plpgsql as $$
declare v_inst public.receivable_installments%rowtype; v_novo numeric(14,2); v_status text; v_cash numeric(14,2);
begin
  select * into v_inst from public.receivable_installments where id=p_installment_id for update;
  if not found then raise exception 'Parcela não encontrada ou sem acesso'; end if;
  if v_inst.status='cancelado' then raise exception 'Parcela cancelada não recebe baixa'; end if;
  if p_valor <= 0 then raise exception 'Valor da baixa deve ser positivo'; end if;
  if p_financial_account_id is null then raise exception 'Informe a conta financeira do recebimento'; end if;
  v_novo := v_inst.valor_recebido + p_valor;
  if v_novo > v_inst.valor + 0.005 then raise exception 'Valor recebido (%) excede o valor da parcela (%)', v_novo, v_inst.valor; end if;
  v_status := case when v_novo >= v_inst.valor then 'recebido' else 'recebido_parcial' end;
  v_cash := p_valor + coalesce(p_juros,0) + coalesce(p_multa,0) - coalesce(p_desconto,0);

  update public.receivable_installments set valor_recebido=v_novo, status=v_status where id=p_installment_id;
  insert into public.bank_transactions(company_id,financial_account_id,tipo,descricao,valor,data,receivable_installment_id,forma,observacao,juros,multa,desconto)
    values (v_inst.company_id,p_financial_account_id,'entrada','Recebimento parcela '||v_inst.numero||'/'||v_inst.total_parcelas,v_cash,p_data,p_installment_id,p_forma,p_observacao,coalesce(p_juros,0),coalesce(p_multa,0),coalesce(p_desconto,0));
  update public.receivables r set status=case when not exists(select 1 from public.receivable_installments i where i.receivable_id=r.id and i.status not in('recebido','cancelado')) then 'quitado' else 'aberto' end where r.id=v_inst.receivable_id;

  insert into public.audit_logs(company_id,user_id,acao,tabela,registro_id,valor_anterior,valor_novo)
  values (v_inst.company_id, auth.uid(), 'baixa', 'receivable_installments', p_installment_id,
    jsonb_build_object('valor_recebido',v_inst.valor_recebido,'status',v_inst.status),
    jsonb_build_object('valor_recebido',v_novo,'status',v_status,'juros',p_juros,'multa',p_multa,'desconto',p_desconto,'caixa',v_cash));
end; $$;

create or replace function public.baixar_payable_installment(
  p_installment_id       uuid,
  p_valor                numeric,
  p_financial_account_id uuid,
  p_data                 date default current_date,
  p_forma                text default null,
  p_observacao           text default null,
  p_descricao            text default null,
  p_juros                numeric default 0,
  p_multa                numeric default 0,
  p_desconto             numeric default 0
) returns void language plpgsql as $$
declare v_inst public.payable_installments%rowtype; v_novo numeric(14,2); v_status text; v_cash numeric(14,2);
begin
  select * into v_inst from public.payable_installments where id=p_installment_id for update;
  if not found then raise exception 'Parcela não encontrada ou sem acesso'; end if;
  if v_inst.status='cancelado' then raise exception 'Parcela cancelada não recebe baixa'; end if;
  if p_valor <= 0 then raise exception 'Valor da baixa deve ser positivo'; end if;
  if p_financial_account_id is null then raise exception 'Informe a conta financeira do pagamento'; end if;
  v_novo := v_inst.valor_pago + p_valor;
  if v_novo > v_inst.valor + 0.005 then raise exception 'Valor pago (%) excede o valor da parcela (%)', v_novo, v_inst.valor; end if;
  v_status := case when v_novo >= v_inst.valor then 'pago' else 'pago_parcial' end;
  v_cash := p_valor + coalesce(p_juros,0) + coalesce(p_multa,0) - coalesce(p_desconto,0);

  update public.payable_installments set valor_pago=v_novo, status=v_status where id=p_installment_id;
  insert into public.bank_transactions(company_id,financial_account_id,tipo,descricao,valor,data,payable_installment_id,forma,observacao,juros,multa,desconto)
    values (v_inst.company_id,p_financial_account_id,'saida',coalesce(p_descricao,'Pagamento parcela '||v_inst.numero||'/'||v_inst.total_parcelas),v_cash,p_data,p_installment_id,p_forma,p_observacao,coalesce(p_juros,0),coalesce(p_multa,0),coalesce(p_desconto,0));
  update public.payables p set status=case when not exists(select 1 from public.payable_installments i where i.payable_id=p.id and i.status not in('pago','cancelado')) then 'quitado' else 'aberto' end where p.id=v_inst.payable_id;

  insert into public.audit_logs(company_id,user_id,acao,tabela,registro_id,valor_anterior,valor_novo)
  values (v_inst.company_id, auth.uid(), 'baixa', 'payable_installments', p_installment_id,
    jsonb_build_object('valor_pago',v_inst.valor_pago,'status',v_inst.status),
    jsonb_build_object('valor_pago',v_novo,'status',v_status,'juros',p_juros,'multa',p_multa,'desconto',p_desconto,'caixa',v_cash));
end; $$;


grant execute on function public.criar_conta_receber(uuid,uuid,text,numeric,date,int,int,uuid,uuid,uuid,text,text,date) to anon, authenticated;
grant execute on function public.criar_conta_pagar(uuid,uuid,text,numeric,date,int,int,uuid,uuid,uuid,text,text,date,date) to anon, authenticated;
grant execute on function public.baixar_receivable_installment(uuid,numeric,uuid,date,text,text,numeric,numeric,numeric) to anon, authenticated;
grant execute on function public.baixar_payable_installment(uuid,numeric,uuid,date,text,text,text,numeric,numeric,numeric) to anon, authenticated;


-- ############################ 11_candidus_conciliacao_multi.sql ############################
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


-- ############################ 12_candidus_regras_conciliacao.sql ############################
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


-- ############################ 13_candidus_lancamento_lote.sql ############################
-- =====================================================================
-- CANDIDUS — FASE 2: LANÇAMENTO EM LOTE
--   Cria várias contas a pagar/receber de uma vez, numa transação só:
--   se UMA linha falhar, NADA é gravado e o erro diz qual linha.
-- Rode UMA vez no SQL Editor (pode rodar de novo sem quebrar).
--
-- FUNÇÕES:
--   NOVA: criar_contas_lote(p_tipo, p_itens)
--   Nenhuma função existente foi alterada.
--
-- p_itens = [{
--   "company_id":"uuid", "contraparte_id":"uuid|null", "descricao":"...", "valor":123.45,
--   "vencimento":"2026-10-20", "qtd_parcelas":1, "intervalo_meses":1,
--   "categoria_id":null, "cost_center_id":null, "financial_account_id":null,
--   "documento":null, "forma":null, "data_emissao":null, "competencia":null
-- }, ...]
-- =====================================================================

create or replace function public.criar_contas_lote(p_tipo text, p_itens jsonb)
returns jsonb language plpgsql as $$
declare
  v_it jsonb; v_i int := 0; v_id uuid; v_ids uuid[] := '{}'; v_total numeric(14,2) := 0;
  v_co uuid; v_contra uuid; v_cat uuid; v_cc uuid; v_acc uuid; v_val numeric(14,2);
  v_venc date; v_qtd int; v_int int; v_emis date; v_comp date; v_desc text; v_cats text;
  v_cos uuid[] := '{}';
begin
  if p_tipo not in ('pagar','receber') then raise exception 'Tipo inválido (use pagar ou receber)'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' or jsonb_array_length(p_itens) = 0 then
    raise exception 'Nenhuma linha para lançar'; end if;
  if jsonb_array_length(p_itens) > 500 then raise exception 'Máximo de 500 linhas por lote'; end if;

  for v_it in select * from jsonb_array_elements(p_itens) loop
    v_i := v_i + 1;
    begin
      v_co     := nullif(v_it->>'company_id','')::uuid;
      v_contra := nullif(v_it->>'contraparte_id','')::uuid;
      v_cat    := nullif(v_it->>'categoria_id','')::uuid;
      v_cc     := nullif(v_it->>'cost_center_id','')::uuid;
      v_acc    := nullif(v_it->>'financial_account_id','')::uuid;
      v_desc   := nullif(trim(v_it->>'descricao'),'');
      v_val    := round(nullif(v_it->>'valor','')::numeric, 2);
      v_venc   := nullif(v_it->>'vencimento','')::date;
      v_qtd    := coalesce(nullif(v_it->>'qtd_parcelas','')::int, 1);
      v_int    := coalesce(nullif(v_it->>'intervalo_meses','')::int, 1);
      v_emis   := nullif(v_it->>'data_emissao','')::date;
      v_comp   := nullif(v_it->>'competencia','')::date;

      if v_co is null then raise exception 'empresa não informada'; end if;
      if not (public.has_company_access(v_co) or public.is_admin()) then raise exception 'sem acesso a essa empresa'; end if;
      if v_desc is null then raise exception 'descrição vazia'; end if;
      if v_val is null or v_val <= 0 then raise exception 'valor inválido'; end if;
      if v_venc is null then raise exception 'vencimento vazio'; end if;
      if v_qtd < 1 or v_qtd > 360 then raise exception 'quantidade de parcelas inválida'; end if;
      if v_int < 1 or v_int > 12 then raise exception 'intervalo entre parcelas inválido'; end if;

      -- tudo tem que ser da mesma empresa
      if v_cat is not null then
        select case when company_id = v_co then tipo end into v_cats from public.categories where id = v_cat;
        if v_cats is null then raise exception 'categoria não encontrada ou de outra empresa'; end if;
        if p_tipo = 'pagar'   and v_cats <> 'despesa' then raise exception 'conta a pagar precisa de categoria de despesa'; end if;
        if p_tipo = 'receber' and v_cats <> 'receita' then raise exception 'conta a receber precisa de categoria de receita'; end if;
      end if;
      if v_cc is not null and (select company_id from public.cost_centers where id = v_cc) is distinct from v_co then
        raise exception 'centro de custo não encontrado ou de outra empresa'; end if;
      if v_acc is not null and (select company_id from public.financial_accounts where id = v_acc) is distinct from v_co then
        raise exception 'conta financeira não encontrada ou de outra empresa'; end if;
      if v_contra is not null then
        if p_tipo = 'pagar' and (select company_id from public.suppliers where id = v_contra) is distinct from v_co then
          raise exception 'fornecedor não encontrado ou de outra empresa'; end if;
        if p_tipo = 'receber' and (select company_id from public.customers where id = v_contra) is distinct from v_co then
          raise exception 'cliente não encontrado ou de outra empresa'; end if;
      end if;

      if p_tipo = 'pagar' then
        v_id := public.criar_conta_pagar(v_co, v_contra, v_desc, v_val, v_venc, v_qtd, v_int, v_cat, v_cc, v_acc,
                  nullif(v_it->>'documento',''), nullif(v_it->>'forma',''), coalesce(v_emis, current_date), v_comp);
      else
        v_id := public.criar_conta_receber(v_co, v_contra, v_desc, v_val, v_venc, v_qtd, v_int, v_cat, v_cc, v_acc,
                  nullif(v_it->>'documento',''), nullif(v_it->>'forma',''), coalesce(v_emis, current_date));
      end if;
    exception when others then
      raise exception 'Linha %: %', v_i, sqlerrm;   -- desfaz o lote inteiro
    end;
    v_ids := v_ids || v_id;
    v_total := v_total + v_val;
    if not v_co = any(v_cos) then v_cos := v_cos || v_co; end if;
  end loop;

  insert into public.audit_logs(company_id, user_id, acao, tabela, registro_id, valor_novo)
  select c, auth.uid(), 'lancamento_lote', case when p_tipo='pagar' then 'payables' else 'receivables' end, null,
         jsonb_build_object('linhas', v_i, 'total', v_total)
  from unnest(v_cos) c;

  return jsonb_build_object('criadas', v_i, 'total', v_total, 'ids', to_jsonb(v_ids));
end $$;

grant execute on function public.criar_contas_lote(text, jsonb) to anon, authenticated;

notify pgrst, 'reload schema';


-- ############################ 14_candidus_controladoria.sql ############################
-- =====================================================================
-- CANDIDUS — FASE 3: CONTROLADORIA AVANÇADA (base de dados da DRE)
--   dre_realizado(): soma o realizado por competência NO BANCO, agrupado por
--   mês + categoria + natureza da DRE. Substitui o "baixar todas as parcelas
--   pro navegador", que o Supabase corta em 1.000 linhas sem avisar.
--   Usada por: DRE, Realizado x Orçado e Indicadores.
--
--   Também traz pro resultado financeiro os juros/multa/descontos gravados
--   nas baixas e conciliações (antes nunca entravam na DRE).
--
-- Rode UMA vez no SQL Editor (pode rodar de novo sem quebrar).
-- FUNÇÕES: NOVA dre_realizado. Nenhuma função existente foi alterada.
-- =====================================================================

-- Índices pra consulta por competência / data ficar rápida
create index if not exists idx_rec_inst_comp on public.receivable_installments(company_id, competencia);
create index if not exists idx_pag_inst_comp on public.payable_installments(company_id, competencia);
create index if not exists idx_bt_company_data on public.bank_transactions(company_id, data);

-- Período: sempre MESES INTEIROS, do mês de p_ini ao mês de p_fim (o dia é ignorado).
-- Retorno (1 linha por mês x categoria):
--   mes          primeiro dia do mês (competência; nas baixas, a data do movimento)
--   categoria_id null = juros/multa/desconto das baixas
--   categoria    nome da categoria (ou 'Sem categoria')
--   natureza     natureza da linha da DRE (null = categoria SEM mapeamento)
--   origem       'receber' | 'pagar' | 'baixa'
--   valor        receber/pagar: soma positiva das parcelas
--                baixa: já com sinal (juros/multa recebidos + ; pagos − ; desconto concedido − ; obtido +)
--   qtd          quantidade de parcelas (0 nas baixas)
create or replace function public.dre_realizado(p_company uuid, p_ini date, p_fim date)
returns table (mes date, categoria_id uuid, categoria text, natureza text, origem text, valor numeric, qtd int)
language sql stable as $$
  with base as (
    select i.company_id, date_trunc('month', i.competencia)::date as mes, r.categoria_id, i.valor, 'receber'::text as origem
      from public.receivable_installments i
      join public.receivables r on r.id = i.receivable_id
     where i.status <> 'cancelado'
       and i.competencia >= date_trunc('month', p_ini) and i.competencia < date_trunc('month', p_fim) + interval '1 month'
       and (p_company is null or i.company_id = p_company)
    union all
    select i.company_id, date_trunc('month', i.competencia)::date, p.categoria_id, i.valor, 'pagar'
      from public.payable_installments i
      join public.payables p on p.id = i.payable_id
     where i.status <> 'cancelado'
       and i.competencia >= date_trunc('month', p_ini) and i.competencia < date_trunc('month', p_fim) + interval '1 month'
       and (p_company is null or i.company_id = p_company)
  )
  select b.mes, b.categoria_id, coalesce(c.nome, 'Sem categoria'), s.natureza, b.origem,
         sum(b.valor)::numeric, count(*)::int
    from base b
    left join public.categories c on c.id = b.categoria_id
    left join public.dre_category_mappings m on m.categoria_id = b.categoria_id and m.company_id = b.company_id
    left join public.dre_structure_items s on s.id = m.dre_item_id and s.tipo = 'linha'
   group by b.mes, b.categoria_id, c.nome, s.natureza, b.origem
  union all
  select date_trunc('month', bt.data)::date, null::uuid, 'Juros, multas e descontos (baixas)', 'resultado_financeiro', 'baixa',
         sum(case when bt.tipo = 'entrada' then bt.juros + bt.multa - bt.desconto
                  else bt.desconto - bt.juros - bt.multa end)::numeric, 0
    from public.bank_transactions bt
   where bt.tipo in ('entrada','saida')
     and bt.data >= date_trunc('month', p_ini) and bt.data < date_trunc('month', p_fim) + interval '1 month'
     and (p_company is null or bt.company_id = p_company)
     and (bt.juros <> 0 or bt.multa <> 0 or bt.desconto <> 0)
   group by date_trunc('month', bt.data)
$$;

grant execute on function public.dre_realizado(uuid, date, date) to anon, authenticated;

notify pgrst, 'reload schema';


-- ############################ 15_candidus_indicadores.sql ############################
-- =====================================================================
-- CANDIDUS — FASE 3: INDICADORES + FIM DO LIMITE DE 1.000 LINHAS
--   Dashboard, Fluxo de caixa e Indicadores baixavam TODOS os movimentos e
--   parcelas pro navegador; o Supabase corta em 1.000 linhas sem avisar e o
--   saldo saía errado. Agora a soma é feita no banco.
--
--   resumo_financeiro()      saldo + aberto/vencido/previsto 30d por empresa
--   fluxo_mensal()           entradas/saídas realizadas e previstas por mês
--   contar_titulos_receber() nº de títulos a receber no período (ticket médio)
--   + KPIs novos na tabela financial_indicators (pra aceitar meta)
--
-- Rode UMA vez no SQL Editor (pode rodar de novo sem quebrar).
-- FUNÇÕES: 3 NOVAS. Nenhuma função existente foi alterada.
-- Requer: candidus_controladoria.sql (dre_realizado) já rodado.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Resumo por empresa (mesmas regras que o front usava)
--    saldo = Σ saldo inicial das contas + Σ entradas − Σ saídas (transferência não conta)
--    aberto = situação diferente de recebido/pago/cancelado (inclui vencido e parcial)
--    previsto 30d = situação 'a_vencer' com vencimento até hoje + 30
-- ---------------------------------------------------------------------
create or replace function public.resumo_financeiro(p_company uuid default null)
returns table (company_id uuid, saldo numeric, receber_aberto numeric, receber_vencido numeric,
               pagar_aberto numeric, pagar_vencido numeric, receber_30d numeric, pagar_30d numeric)
language sql stable as $$
  with co as (select id from public.companies where p_company is null or id = p_company),
  acc as (select a.company_id, sum(a.saldo_inicial) v from public.financial_accounts a
           where a.company_id in (select id from co) group by 1),
  tx  as (select b.company_id, sum(case when b.tipo='entrada' then b.valor when b.tipo='saida' then -b.valor else 0 end) v
            from public.bank_transactions b where b.company_id in (select id from co) group by 1),
  rc  as (select r.company_id,
                 sum(r.saldo) filter (where r.situacao not in ('recebido','cancelado')) ab,
                 sum(r.saldo) filter (where r.situacao = 'vencido') ve,
                 sum(r.saldo) filter (where r.situacao = 'a_vencer' and r.vencimento <= current_date + 30) p30
            from public.vw_contas_receber r where r.company_id in (select id from co) group by 1),
  pg  as (select p.company_id,
                 sum(p.saldo) filter (where p.situacao not in ('pago','cancelado')) ab,
                 sum(p.saldo) filter (where p.situacao = 'vencido') ve,
                 sum(p.saldo) filter (where p.situacao = 'a_vencer' and p.vencimento <= current_date + 30) p30
            from public.vw_contas_pagar p where p.company_id in (select id from co) group by 1)
  select co.id,
         coalesce(acc.v,0) + coalesce(tx.v,0),
         coalesce(rc.ab,0), coalesce(rc.ve,0), coalesce(pg.ab,0), coalesce(pg.ve,0),
         coalesce(rc.p30,0), coalesce(pg.p30,0)
    from co
    left join acc on acc.company_id = co.id
    left join tx  on tx.company_id  = co.id
    left join rc  on rc.company_id  = co.id
    left join pg  on pg.company_id  = co.id
$$;

-- ---------------------------------------------------------------------
-- 2. Fluxo mensal: realizado (movimentos) e previsto (saldo em aberto por vencimento)
-- ---------------------------------------------------------------------
create or replace function public.fluxo_mensal(p_company uuid default null)
returns table (ym text, real_e numeric, real_s numeric, prev_e numeric, prev_s numeric)
language sql stable as $$
  with r as (
    select to_char(b.data,'YYYY-MM') ym,
           coalesce(sum(b.valor) filter (where b.tipo='entrada'),0) e,
           coalesce(sum(b.valor) filter (where b.tipo='saida'),0)   s
      from public.bank_transactions b
     where b.tipo in ('entrada','saida') and (p_company is null or b.company_id = p_company)
     group by 1),
  pr as (
    select to_char(v.vencimento,'YYYY-MM') ym, sum(v.saldo) e
      from public.vw_contas_receber v
     where v.situacao not in ('recebido','cancelado') and v.saldo > 0
       and (p_company is null or v.company_id = p_company)
     group by 1),
  pp as (
    select to_char(v.vencimento,'YYYY-MM') ym, sum(v.saldo) s
      from public.vw_contas_pagar v
     where v.situacao not in ('pago','cancelado') and v.saldo > 0
       and (p_company is null or v.company_id = p_company)
     group by 1),
  k as (select ym from r union select ym from pr union select ym from pp)
  select k.ym, coalesce(r.e,0), coalesce(r.s,0), coalesce(pr.e,0), coalesce(pp.s,0)
    from k left join r using (ym) left join pr using (ym) left join pp using (ym)
   order by k.ym
$$;

-- ---------------------------------------------------------------------
-- 3. Nº de títulos a receber com parcela de competência no período (ticket médio)
-- ---------------------------------------------------------------------
create or replace function public.contar_titulos_receber(p_company uuid, p_ini date, p_fim date)
returns int language sql stable as $$
  select count(distinct i.receivable_id)::int
    from public.receivable_installments i
   where i.status <> 'cancelado'
     and i.competencia >= date_trunc('month', p_ini) and i.competencia < date_trunc('month', p_fim) + interval '1 month'
     and (p_company is null or i.company_id = p_company)
$$;

create index if not exists idx_bt_company_tipo on public.bank_transactions(company_id, tipo);

-- ---------------------------------------------------------------------
-- 4. KPIs novos (metas usam esta tabela como referência)
-- ---------------------------------------------------------------------
insert into public.financial_indicators (key, nome, unidade) values
  ('margem_bruta',       'Margem bruta',                     'percent'),
  ('margem_operacional', 'Margem operacional',               'percent'),
  ('crescimento',        'Crescimento da receita',           'percent'),
  ('ponto_equilibrio',   'Ponto de equilíbrio (estimado)',   'moeda'),
  ('liquidez',           'Liquidez corrente (simplificada)', 'indice'),
  ('folego_caixa',       'Fôlego de caixa',                  'dias')
on conflict (key) do nothing;

grant execute on function public.resumo_financeiro(uuid)                  to anon, authenticated;
grant execute on function public.fluxo_mensal(uuid)                       to anon, authenticated;
grant execute on function public.contar_titulos_receber(uuid, date, date) to anon, authenticated;

notify pgrst, 'reload schema';


-- ############################ 16_candidus_custos.sql ############################
-- =====================================================================
-- CANDIDUS — FASE 3: GESTÃO DE CUSTOS
--   1. Centro de custo padrão na categoria (preenche sozinho nos lançamentos)
--   2. Rateio de um título entre vários centros de custo (ex.: 60% / 40%)
--   3. custos_por_cc(): realizado por competência por centro de custo e categoria
--      (com rateio aplicado e categoria-pai), base dos relatórios novos
-- Rode UMA vez no SQL Editor (pode rodar de novo sem quebrar).
-- FUNÇÕES: NOVAS salvar_rateio, custos_por_cc, trg_categoria_cc_valida.
--          Nenhuma função existente foi alterada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Centro de custo padrão da categoria
-- ---------------------------------------------------------------------
alter table public.categories add column if not exists default_cost_center_id uuid
  references public.cost_centers(id) on delete set null;

create or replace function public.trg_categoria_cc_valida() returns trigger language plpgsql as $$
begin
  if new.default_cost_center_id is not null
     and (select company_id from public.cost_centers where id = new.default_cost_center_id) is distinct from new.company_id then
    raise exception 'O centro de custo padrão precisa ser da mesma empresa da categoria';
  end if;
  return new;
end $$;
drop trigger if exists trg_categoria_cc_valida on public.categories;
create trigger trg_categoria_cc_valida before insert or update of default_cost_center_id, company_id on public.categories
  for each row execute function public.trg_categoria_cc_valida();

-- ---------------------------------------------------------------------
-- 2. Rateio por título (soma dos % = 100). Sem rateio = vale o centro de custo do título.
-- ---------------------------------------------------------------------
create table if not exists public.rateio_centro_custo (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  tipo            text not null check (tipo in ('pagar','receber')),
  payable_id      uuid references public.payables(id)    on delete cascade,
  receivable_id   uuid references public.receivables(id) on delete cascade,
  cost_center_id  uuid not null references public.cost_centers(id) on delete restrict,
  percentual      numeric(7,4) not null check (percentual > 0 and percentual <= 100),
  created_at      timestamptz not null default now(),
  constraint rateio_titulo_ck check (
    (tipo='pagar'   and payable_id    is not null and receivable_id is null) or
    (tipo='receber' and receivable_id is not null and payable_id    is null))
);
create unique index if not exists ux_rateio_pag on public.rateio_centro_custo(payable_id, cost_center_id)    where payable_id is not null;
create unique index if not exists ux_rateio_rec on public.rateio_centro_custo(receivable_id, cost_center_id) where receivable_id is not null;

alter table public.rateio_centro_custo enable row level security;
drop policy if exists rateio_rls on public.rateio_centro_custo;
create policy rateio_rls on public.rateio_centro_custo for all to authenticated
  using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
grant all on public.rateio_centro_custo to anon, authenticated;

-- Grava o rateio inteiro de um título (substitui o anterior). Lista vazia = remove o rateio.
-- p_itens = [{"cost_center_id":"uuid","percentual":60}, ...]
create or replace function public.salvar_rateio(p_tipo text, p_titulo_id uuid, p_itens jsonb)
returns int language plpgsql as $$
declare v_co uuid; v_it jsonb; v_soma numeric := 0; v_n int := 0; v_cc uuid; v_pct numeric;
begin
  if p_tipo not in ('pagar','receber') then raise exception 'Tipo inválido'; end if;
  if p_tipo = 'pagar' then select company_id into v_co from public.payables where id = p_titulo_id;
  else select company_id into v_co from public.receivables where id = p_titulo_id; end if;
  if v_co is null then raise exception 'Título não encontrado ou sem acesso'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Formato inválido'; end if;

  if jsonb_array_length(p_itens) > 0 then
    if (select count(distinct x->>'cost_center_id') from jsonb_array_elements(p_itens) x) <> jsonb_array_length(p_itens) then
      raise exception 'O mesmo centro de custo aparece mais de uma vez'; end if;
    for v_it in select * from jsonb_array_elements(p_itens) loop
      v_cc := nullif(v_it->>'cost_center_id','')::uuid; v_pct := round(nullif(v_it->>'percentual','')::numeric, 4);
      if v_cc is null then raise exception 'Escolha o centro de custo em todas as linhas'; end if;
      if v_pct is null or v_pct <= 0 or v_pct > 100 then raise exception 'Percentual inválido'; end if;
      if (select company_id from public.cost_centers where id = v_cc) is distinct from v_co then
        raise exception 'Centro de custo não encontrado ou de outra empresa'; end if;
      v_soma := v_soma + v_pct;
    end loop;
    if abs(v_soma - 100) > 0.01 then raise exception 'Os percentuais somam %, precisam somar 100%%', round(v_soma,2)||'%'; end if;
  end if;

  if p_tipo = 'pagar' then delete from public.rateio_centro_custo where payable_id = p_titulo_id;
  else delete from public.rateio_centro_custo where receivable_id = p_titulo_id; end if;

  for v_it in select * from jsonb_array_elements(p_itens) loop
    insert into public.rateio_centro_custo(company_id, tipo, payable_id, receivable_id, cost_center_id, percentual)
    values (v_co, p_tipo, case when p_tipo='pagar' then p_titulo_id end, case when p_tipo='receber' then p_titulo_id end,
            (v_it->>'cost_center_id')::uuid, round((v_it->>'percentual')::numeric, 4));
    v_n := v_n + 1;
  end loop;

  insert into public.audit_logs(company_id, user_id, acao, tabela, registro_id, valor_novo)
  values (v_co, auth.uid(), 'rateio', case when p_tipo='pagar' then 'payables' else 'receivables' end, p_titulo_id, p_itens);
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 3. Realizado por centro de custo x categoria (competência, meses inteiros)
--    Com rateio: o valor da parcela é dividido pelos % do título.
--    Sem rateio: vai pro centro de custo do título (null = "sem centro de custo").
-- ---------------------------------------------------------------------
create or replace function public.custos_por_cc(p_company uuid, p_ini date, p_fim date)
returns table (mes date, cost_center_id uuid, centro_custo text, categoria_id uuid, categoria text,
               categoria_pai_id uuid, categoria_pai text, origem text, valor numeric)
language sql stable as $$
  with base as (
    select date_trunc('month', i.competencia)::date as mes, 'receber'::text as origem, r.id as titulo_id,
           r.categoria_id, r.cost_center_id, i.valor
      from public.receivable_installments i join public.receivables r on r.id = i.receivable_id
     where i.status <> 'cancelado'
       and i.competencia >= date_trunc('month', p_ini) and i.competencia < date_trunc('month', p_fim) + interval '1 month'
       and (p_company is null or i.company_id = p_company)
    union all
    select date_trunc('month', i.competencia)::date, 'pagar', p.id, p.categoria_id, p.cost_center_id, i.valor
      from public.payable_installments i join public.payables p on p.id = i.payable_id
     where i.status <> 'cancelado'
       and i.competencia >= date_trunc('month', p_ini) and i.competencia < date_trunc('month', p_fim) + interval '1 month'
       and (p_company is null or i.company_id = p_company)
  ),
  rat as (
    select b.mes, b.origem, b.categoria_id,
           coalesce(rr.cost_center_id, rp.cost_center_id, b.cost_center_id) as cc,
           b.valor * coalesce(rr.percentual, rp.percentual, 100) / 100 as v
      from base b
      left join public.rateio_centro_custo rr on b.origem = 'receber' and rr.receivable_id = b.titulo_id
      left join public.rateio_centro_custo rp on b.origem = 'pagar'   and rp.payable_id    = b.titulo_id
  )
  select r.mes, r.cc, coalesce(cc.nome, 'Sem centro de custo'), r.categoria_id, coalesce(c.nome, 'Sem categoria'),
         c.parent_id, cp.nome, r.origem, round(sum(r.v), 2)
    from rat r
    left join public.cost_centers cc on cc.id = r.cc
    left join public.categories   c  on c.id  = r.categoria_id
    left join public.categories   cp on cp.id = c.parent_id
   group by r.mes, r.cc, cc.nome, r.categoria_id, c.nome, c.parent_id, cp.nome, r.origem
$$;

create index if not exists idx_rateio_pag_t on public.rateio_centro_custo(payable_id);
create index if not exists idx_rateio_rec_t on public.rateio_centro_custo(receivable_id);

grant execute on function public.salvar_rateio(text, uuid, jsonb)  to anon, authenticated;
grant execute on function public.custos_por_cc(uuid, date, date)   to anon, authenticated;

notify pgrst, 'reload schema';


-- ############################ 17_candidus_fixo_variavel.sql ############################
-- =====================================================================
-- CANDIDUS — FASE 3: CUSTO FIXO × VARIÁVEL
--   • categories.comportamento: 'fixo' | 'variavel' (só despesa; em branco = herda do pai)
--   • salvar_comportamento_categorias(): classifica várias categorias de uma vez
--   • dre_realizado() ganha a coluna "comportamento" (já resolvida com o pai)
--     → margem de contribuição, custos fixos, ponto de equilíbrio exato e margem de segurança
-- Rode UMA vez no SQL Editor (pode rodar de novo sem quebrar).
-- Requer: candidus_controladoria.sql e candidus_indicadores.sql já rodados.
--
-- FUNÇÕES:
--   NOVAS: salvar_comportamento_categorias, trg_categoria_comportamento
--   RECRIADA: dre_realizado(uuid,date,date) — MESMOS parâmetros, só ganha 1 coluna no retorno.
--             (mudar o retorno exige DROP + CREATE; não fica versão duplicada)
-- =====================================================================

alter table public.categories add column if not exists comportamento text;
do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'categories_comportamento_ck') then
    alter table public.categories add constraint categories_comportamento_ck check (comportamento in ('fixo','variavel'));
  end if;
end $$;

-- receita não tem comportamento de custo
create or replace function public.trg_categoria_comportamento() returns trigger language plpgsql as $$
begin
  if new.tipo = 'receita' then new.comportamento := null; end if;
  return new;
end $$;
drop trigger if exists trg_categoria_comportamento on public.categories;
create trigger trg_categoria_comportamento before insert or update of comportamento, tipo on public.categories
  for each row execute function public.trg_categoria_comportamento();

-- classifica em lote: p_itens = [{"id":"uuid","comportamento":"fixo"|"variavel"|null}, ...]
create or replace function public.salvar_comportamento_categorias(p_itens jsonb)
returns int language plpgsql as $$
declare v_it jsonb; v_c text; v_n int := 0; v_tipo text;
begin
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Formato inválido'; end if;
  for v_it in select * from jsonb_array_elements(p_itens) loop
    v_c := nullif(v_it->>'comportamento','');
    if v_c is not null and v_c not in ('fixo','variavel') then raise exception 'Comportamento inválido: %', v_c; end if;
    select tipo into v_tipo from public.categories where id = (v_it->>'id')::uuid;
    if v_tipo is null then raise exception 'Categoria não encontrada ou sem acesso'; end if;
    if v_tipo = 'receita' and v_c is not null then raise exception 'Categoria de receita não é fixa nem variável'; end if;
    update public.categories set comportamento = v_c where id = (v_it->>'id')::uuid and comportamento is distinct from v_c;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end $$;

-- dre_realizado com a coluna comportamento (efetivo: da categoria ou, se vazio, do pai)
drop function if exists public.dre_realizado(uuid, date, date);
create function public.dre_realizado(p_company uuid, p_ini date, p_fim date)
returns table (mes date, categoria_id uuid, categoria text, natureza text, origem text, valor numeric, qtd int, comportamento text)
language sql stable as $$
  with base as (
    select i.company_id, date_trunc('month', i.competencia)::date as mes, r.categoria_id, i.valor, 'receber'::text as origem
      from public.receivable_installments i
      join public.receivables r on r.id = i.receivable_id
     where i.status <> 'cancelado'
       and i.competencia >= date_trunc('month', p_ini) and i.competencia < date_trunc('month', p_fim) + interval '1 month'
       and (p_company is null or i.company_id = p_company)
    union all
    select i.company_id, date_trunc('month', i.competencia)::date, p.categoria_id, i.valor, 'pagar'
      from public.payable_installments i
      join public.payables p on p.id = i.payable_id
     where i.status <> 'cancelado'
       and i.competencia >= date_trunc('month', p_ini) and i.competencia < date_trunc('month', p_fim) + interval '1 month'
       and (p_company is null or i.company_id = p_company)
  )
  select b.mes, b.categoria_id, coalesce(c.nome, 'Sem categoria'), s.natureza, b.origem,
         sum(b.valor)::numeric, count(*)::int, coalesce(c.comportamento, cp.comportamento)
    from base b
    left join public.categories c on c.id = b.categoria_id
    left join public.categories cp on cp.id = c.parent_id
    left join public.dre_category_mappings m on m.categoria_id = b.categoria_id and m.company_id = b.company_id
    left join public.dre_structure_items s on s.id = m.dre_item_id and s.tipo = 'linha'
   group by b.mes, b.categoria_id, c.nome, s.natureza, b.origem, coalesce(c.comportamento, cp.comportamento)
  union all
  select date_trunc('month', bt.data)::date, null::uuid, 'Juros, multas e descontos (baixas)', 'resultado_financeiro', 'baixa',
         sum(case when bt.tipo = 'entrada' then bt.juros + bt.multa - bt.desconto
                  else bt.desconto - bt.juros - bt.multa end)::numeric, 0, null::text
    from public.bank_transactions bt
   where bt.tipo in ('entrada','saida')
     and bt.data >= date_trunc('month', p_ini) and bt.data < date_trunc('month', p_fim) + interval '1 month'
     and (p_company is null or bt.company_id = p_company)
     and (bt.juros <> 0 or bt.multa <> 0 or bt.desconto <> 0)
   group by date_trunc('month', bt.data)
$$;

grant execute on function public.dre_realizado(uuid, date, date) to anon, authenticated;


insert into public.financial_indicators (key, nome, unidade) values
  ('margem_contribuicao',     'Margem de contribuição',     'moeda'),
  ('margem_contribuicao_pct', 'Margem de contribuição (%)', 'percent'),
  ('custos_fixos',            'Custos e despesas fixos',    'moeda'),
  ('margem_seguranca',        'Margem de segurança',        'percent')
on conflict (key) do nothing;
update public.financial_indicators set nome = 'Ponto de equilíbrio' where key = 'ponto_equilibrio';

grant execute on function public.salvar_comportamento_categorias(jsonb) to anon, authenticated;

notify pgrst, 'reload schema';


commit;
