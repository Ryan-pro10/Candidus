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
