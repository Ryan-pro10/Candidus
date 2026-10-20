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
