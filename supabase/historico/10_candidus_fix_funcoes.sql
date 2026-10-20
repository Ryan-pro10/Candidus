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
