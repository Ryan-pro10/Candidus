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
