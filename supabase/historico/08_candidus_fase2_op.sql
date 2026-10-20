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
