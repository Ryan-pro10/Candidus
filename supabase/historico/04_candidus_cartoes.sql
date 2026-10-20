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
