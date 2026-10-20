-- =====================================================================
-- CANDIDUS — FASE 1 (fechamento): parcelamento + baixas + empresa demo
-- Rode DEPOIS do candidus_schema.sql, no mesmo banco.
-- =====================================================================

-- =====================================================================
-- 1. CRIAR CONTA A RECEBER (gera título + parcelas 1/n .. n/n)
--    SECURITY INVOKER (padrão): respeita o RLS de quem chama.
-- =====================================================================
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

-- =====================================================================
-- 2. CRIAR CONTA A PAGAR (espelho da de receber)
-- =====================================================================
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
  p_data_emissao         date default null
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
  if coalesce(p_qtd_parcelas,1) < 1 then
    raise exception 'Quantidade de parcelas deve ser >= 1';
  end if;
  if p_valor_total <= 0 then
    raise exception 'Valor total deve ser positivo';
  end if;

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
    if i < p_qtd_parcelas then
      v_valor := v_parc;
      v_acum  := v_acum + v_valor;
    else
      v_valor := p_valor_total - v_acum;
    end if;

    insert into public.payable_installments(
      payable_id, company_id, numero, total_parcelas, competencia, vencimento, valor
    ) values (
      v_id, p_company_id, i, p_qtd_parcelas,
      date_trunc('month', v_venc)::date, v_venc, v_valor
    );
  end loop;

  insert into public.audit_logs(company_id, user_id, acao, tabela, registro_id, valor_novo)
  values (p_company_id, auth.uid(), 'insert', 'payables', v_id,
          jsonb_build_object('descricao', p_descricao, 'valor_total', p_valor_total,
                             'parcelas', p_qtd_parcelas));
  return v_id;
end;
$$;

-- =====================================================================
-- 3. BAIXA DE RECEBIMENTO (permite parcial) — regras 2, 5, 6, 11
--    Gera movimento bancário (entrada) e auditoria.
-- =====================================================================
create or replace function public.baixar_receivable_installment(
  p_installment_id       uuid,
  p_valor                numeric,
  p_financial_account_id uuid,
  p_data                 date default current_date,
  p_forma                text default null,
  p_observacao           text default null
) returns void
language plpgsql as $$
declare
  v_inst   public.receivable_installments%rowtype;
  v_novo   numeric(14,2);
  v_status text;
begin
  select * into v_inst from public.receivable_installments
    where id = p_installment_id for update;
  if not found then
    raise exception 'Parcela não encontrada ou sem acesso';
  end if;
  if v_inst.status = 'cancelado' then
    raise exception 'Parcela cancelada não recebe baixa';
  end if;
  if p_valor <= 0 then
    raise exception 'Valor da baixa deve ser positivo';
  end if;
  if p_financial_account_id is null then
    raise exception 'Informe a conta financeira do recebimento';
  end if;

  v_novo := v_inst.valor_recebido + p_valor;
  if v_novo > v_inst.valor + 0.005 then
    raise exception 'Valor recebido (%) excede o valor da parcela (%)', v_novo, v_inst.valor;
  end if;

  v_status := case when v_novo >= v_inst.valor then 'recebido' else 'recebido_parcial' end;

  update public.receivable_installments
     set valor_recebido = v_novo, status = v_status
   where id = p_installment_id;

  insert into public.bank_transactions(
    company_id, financial_account_id, tipo, descricao, valor, data,
    receivable_installment_id, forma, observacao
  ) values (
    v_inst.company_id, p_financial_account_id, 'entrada',
    'Recebimento parcela '||v_inst.numero||'/'||v_inst.total_parcelas,
    p_valor, p_data, p_installment_id, p_forma, p_observacao
  );

  -- título vira 'quitado' quando não sobra parcela em aberto
  update public.receivables r set status = case
    when not exists (
      select 1 from public.receivable_installments i
      where i.receivable_id = r.id and i.status not in ('recebido','cancelado')
    ) then 'quitado' else 'aberto' end
  where r.id = v_inst.receivable_id;

  insert into public.audit_logs(company_id, user_id, acao, tabela, registro_id, valor_anterior, valor_novo)
  values (v_inst.company_id, auth.uid(), 'baixa', 'receivable_installments', p_installment_id,
    jsonb_build_object('valor_recebido', v_inst.valor_recebido, 'status', v_inst.status),
    jsonb_build_object('valor_recebido', v_novo, 'status', v_status));
end;
$$;

-- =====================================================================
-- 4. BAIXA DE PAGAMENTO (permite parcial) — regras 4, 5, 11
-- =====================================================================
create or replace function public.baixar_payable_installment(
  p_installment_id       uuid,
  p_valor                numeric,
  p_financial_account_id uuid,
  p_data                 date default current_date,
  p_forma                text default null,
  p_observacao           text default null
) returns void
language plpgsql as $$
declare
  v_inst   public.payable_installments%rowtype;
  v_novo   numeric(14,2);
  v_status text;
begin
  select * into v_inst from public.payable_installments
    where id = p_installment_id for update;
  if not found then
    raise exception 'Parcela não encontrada ou sem acesso';
  end if;
  if v_inst.status = 'cancelado' then
    raise exception 'Parcela cancelada não recebe baixa';
  end if;
  if p_valor <= 0 then
    raise exception 'Valor da baixa deve ser positivo';
  end if;
  if p_financial_account_id is null then
    raise exception 'Informe a conta financeira do pagamento';
  end if;

  v_novo := v_inst.valor_pago + p_valor;
  if v_novo > v_inst.valor + 0.005 then
    raise exception 'Valor pago (%) excede o valor da parcela (%)', v_novo, v_inst.valor;
  end if;

  v_status := case when v_novo >= v_inst.valor then 'pago' else 'pago_parcial' end;

  update public.payable_installments
     set valor_pago = v_novo, status = v_status
   where id = p_installment_id;

  insert into public.bank_transactions(
    company_id, financial_account_id, tipo, descricao, valor, data,
    payable_installment_id, forma, observacao
  ) values (
    v_inst.company_id, p_financial_account_id, 'saida',
    'Pagamento parcela '||v_inst.numero||'/'||v_inst.total_parcelas,
    p_valor, p_data, p_installment_id, p_forma, p_observacao
  );

  update public.payables p set status = case
    when not exists (
      select 1 from public.payable_installments i
      where i.payable_id = p.id and i.status not in ('pago','cancelado')
    ) then 'quitado' else 'aberto' end
  where p.id = v_inst.payable_id;

  insert into public.audit_logs(company_id, user_id, acao, tabela, registro_id, valor_anterior, valor_novo)
  values (v_inst.company_id, auth.uid(), 'baixa', 'payable_installments', p_installment_id,
    jsonb_build_object('valor_pago', v_inst.valor_pago, 'status', v_inst.status),
    jsonb_build_object('valor_pago', v_novo, 'status', v_status));
end;
$$;

-- =====================================================================
-- 5. EMPRESA DE DEMONSTRAÇÃO (idempotente: não duplica se já existir)
-- =====================================================================
create or replace function public.criar_empresa_demo()
returns uuid
language plpgsql as $$
declare
  v_co        uuid;
  v_cli       uuid[];
  v_for       uuid[];
  v_acc_caixa uuid;
  v_acc_cc    uuid;
  v_acc_inv   uuid;
  v_cc_adm    uuid;
  v_cat_serv  uuid;
  v_cat_venda uuid;
  v_cat_comb  uuid;
  v_cat_alug  uuid;
  v_cat_pess  uuid;
  v_par       uuid;
  v_rid       uuid;
  v_pid       uuid;
  v_inst      uuid;
begin
  select id into v_co from public.companies
    where razao_social = 'Candidus Demonstração Ltda.' limit 1;
  if v_co is not null then
    raise notice 'Empresa demo já existe: %', v_co;
    return v_co;
  end if;

  insert into public.companies(razao_social, nome_fantasia, cnpj, cidade, estado, status)
  values ('Candidus Demonstração Ltda.', 'Candidus Demo', '00.000.000/0001-00', 'Curitiba', 'PR', 'ativo')
  returning id into v_co;

  -- Contas financeiras
  insert into public.financial_accounts(company_id, nome, tipo, saldo_inicial, data_saldo_inicial)
    values (v_co, 'Caixa', 'caixa', 5000, current_date) returning id into v_acc_caixa;
  insert into public.financial_accounts(company_id, nome, tipo, banco, saldo_inicial, data_saldo_inicial)
    values (v_co, 'Conta Corrente BB', 'conta_corrente', 'Banco do Brasil', 20000, current_date) returning id into v_acc_cc;
  insert into public.financial_accounts(company_id, nome, tipo, saldo_inicial, data_saldo_inicial)
    values (v_co, 'Investimento CDB', 'investimento', 15000, current_date) returning id into v_acc_inv;

  -- Centros de custo
  insert into public.cost_centers(company_id, nome) values (v_co, 'Administrativo') returning id into v_cc_adm;
  insert into public.cost_centers(company_id, nome) values (v_co, 'Comercial'), (v_co, 'Operacional');

  -- Categorias (hierárquicas)
  insert into public.categories(company_id, nome, tipo) values (v_co, 'Receita operacional', 'receita') returning id into v_par;
  insert into public.categories(company_id, parent_id, nome, tipo) values (v_co, v_par, 'Serviços', 'receita') returning id into v_cat_serv;
  insert into public.categories(company_id, parent_id, nome, tipo) values (v_co, v_par, 'Venda', 'receita') returning id into v_cat_venda;

  insert into public.categories(company_id, nome, tipo) values (v_co, 'Despesas operacionais', 'despesa') returning id into v_par;
  insert into public.categories(company_id, parent_id, nome, tipo) values (v_co, v_par, 'Combustível', 'despesa') returning id into v_cat_comb;
  insert into public.categories(company_id, parent_id, nome, tipo) values (v_co, v_par, 'Aluguel', 'despesa') returning id into v_cat_alug;
  insert into public.categories(company_id, nome, tipo) values (v_co, 'Despesas com pessoal', 'despesa') returning id into v_cat_pess;

  -- 5 clientes / 5 fornecedores
  with ins as (
    insert into public.customers(company_id, razao_social) values
      (v_co,'Cliente Alfa Ltda'), (v_co,'Cliente Beta ME'), (v_co,'Cliente Gama SA'),
      (v_co,'Cliente Delta Ltda'), (v_co,'Cliente Épsilon ME')
    returning id
  ) select array_agg(id) into v_cli from ins;

  with ins as (
    insert into public.suppliers(company_id, razao_social) values
      (v_co,'Posto São Jorge'), (v_co,'Imobiliária Central'), (v_co,'Energisa'),
      (v_co,'Distribuidora XPTO'), (v_co,'Contabilidade Prime')
    returning id
  ) select array_agg(id) into v_for from ins;

  -- ================= 10 CONTAS A RECEBER (vencimentos variados) =========
  -- R1: vencida, será RECEBIDA total
  v_rid := public.criar_conta_receber(v_co, v_cli[1], 'Serviço mensal - Alfa', 1500, current_date - 20, 1, 1, v_cat_serv, v_cc_adm, v_acc_cc);
  select id into v_inst from public.receivable_installments where receivable_id = v_rid order by numero limit 1;
  perform public.baixar_receivable_installment(v_inst, 1500, v_acc_cc, current_date - 18, 'pix', 'demo');

  -- R2: vencida, recebimento PARCIAL
  v_rid := public.criar_conta_receber(v_co, v_cli[2], 'Consultoria - Beta', 3000, current_date - 5, 1, 1, v_cat_serv, v_cc_adm, v_acc_cc);
  select id into v_inst from public.receivable_installments where receivable_id = v_rid order by numero limit 1;
  perform public.baixar_receivable_installment(v_inst, 1000, v_acc_cc, current_date - 3, 'boleto', 'demo parcial');

  -- R3: parcelado 3x, a vencer
  perform public.criar_conta_receber(v_co, v_cli[3], 'Projeto - Gama', 2400, current_date + 10, 3, 1, v_cat_serv, v_cc_adm, v_acc_cc);
  -- R4..R10
  perform public.criar_conta_receber(v_co, v_cli[4], 'Venda de produto - Delta', 800,  current_date + 3,  1, 1, v_cat_venda, v_cc_adm, v_acc_cc);
  perform public.criar_conta_receber(v_co, v_cli[5], 'Serviço - Épsilon',        5000, current_date - 2,  1, 1, v_cat_serv,  v_cc_adm, v_acc_cc);
  perform public.criar_conta_receber(v_co, v_cli[1], 'Serviço extra - Alfa',      1200, current_date + 15, 1, 1, v_cat_serv,  v_cc_adm, v_acc_cc);
  perform public.criar_conta_receber(v_co, v_cli[2], 'Mensalidade - Beta',        900,  current_date + 25, 1, 1, v_cat_serv,  v_cc_adm, v_acc_cc);
  perform public.criar_conta_receber(v_co, v_cli[3], 'Venda - Gama',              2100, current_date + 5,  1, 1, v_cat_venda, v_cc_adm, v_acc_cc);
  perform public.criar_conta_receber(v_co, v_cli[4], 'Serviço - Delta',           1750, current_date + 40, 1, 1, v_cat_serv,  v_cc_adm, v_acc_cc);
  perform public.criar_conta_receber(v_co, v_cli[5], 'Consultoria - Épsilon',     4300, current_date - 10, 1, 1, v_cat_serv,  v_cc_adm, v_acc_cc);

  -- ================= 10 CONTAS A PAGAR ==================================
  -- P1: vencida, PAGA total
  v_pid := public.criar_conta_pagar(v_co, v_for[1], 'Combustível frota', 2200, current_date - 15, 1, 1, v_cat_comb, v_cc_adm, v_acc_cc);
  select id into v_inst from public.payable_installments where payable_id = v_pid order by numero limit 1;
  perform public.baixar_payable_installment(v_inst, 2200, v_acc_cc, current_date - 14, 'pix', 'demo');

  -- P2: aluguel, pagamento PARCIAL
  v_pid := public.criar_conta_pagar(v_co, v_for[2], 'Aluguel do galpão', 4000, current_date - 3, 1, 1, v_cat_alug, v_cc_adm, v_acc_cc);
  select id into v_inst from public.payable_installments where payable_id = v_pid order by numero limit 1;
  perform public.baixar_payable_installment(v_inst, 2500, v_acc_cc, current_date - 2, 'transferencia', 'demo parcial');

  -- P3: parcelado 4x, a vencer
  perform public.criar_conta_pagar(v_co, v_for[4], 'Compra de material', 4800, current_date + 7, 4, 1, v_cat_comb, v_cc_adm, v_acc_cc);
  -- P4..P10
  perform public.criar_conta_pagar(v_co, v_for[3], 'Energia elétrica',  1300, current_date + 2,  1, 1, v_cat_comb, v_cc_adm, v_acc_cc);
  perform public.criar_conta_pagar(v_co, v_for[5], 'Honorários contábeis', 900, current_date + 10, 1, 1, v_cat_pess, v_cc_adm, v_acc_cc);
  perform public.criar_conta_pagar(v_co, v_for[1], 'Combustível extra',   700, current_date - 4,  1, 1, v_cat_comb, v_cc_adm, v_acc_cc);
  perform public.criar_conta_pagar(v_co, v_for[2], 'Condomínio',          600, current_date + 12, 1, 1, v_cat_alug, v_cc_adm, v_acc_cc);
  perform public.criar_conta_pagar(v_co, v_for[4], 'Insumos',            1500, current_date + 20, 1, 1, v_cat_comb, v_cc_adm, v_acc_cc);
  perform public.criar_conta_pagar(v_co, v_for[3], 'Internet/telefonia',  350, current_date - 1,  1, 1, v_cat_comb, v_cc_adm, v_acc_cc);
  perform public.criar_conta_pagar(v_co, v_for[5], 'Serviço terceirizado',2800, current_date + 30, 1, 1, v_cat_pess, v_cc_adm, v_acc_cc);

  raise notice 'Empresa demo criada: %', v_co;
  return v_co;
end;
$$;

-- Cria a empresa demo agora (rode só uma vez; a função não duplica).
select public.criar_empresa_demo();
