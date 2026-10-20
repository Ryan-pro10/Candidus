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
