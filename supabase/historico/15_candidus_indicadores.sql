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
