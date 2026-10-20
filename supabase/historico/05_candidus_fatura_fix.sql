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
