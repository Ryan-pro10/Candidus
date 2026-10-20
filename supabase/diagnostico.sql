-- =====================================================================
-- CANDIDUS — DIAGNÓSTICO: quais etapas do supabase/historico já estão no banco?
-- SÓ LÊ, não altera nada. Supabase -> SQL Editor -> New query -> cole tudo -> Run.
-- Cada etapa é conferida por algo que só ela cria (tabela, coluna ou parâmetro de função).
-- =====================================================================
with fn as (
  select p.proname, p.proargnames
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public'
    -- ignora funções de extensões (pgcrypto etc.), que têm várias versões normalmente
    and not exists (select 1 from pg_depend d where d.objid = p.oid and d.deptype = 'e')
),
col as (
  select table_name, column_name from information_schema.columns where table_schema = 'public'
),
etapas(ordem, arquivo, aplicada) as (values
  (1,  '01_candidus_schema.sql',             to_regclass('public.companies') is not null),
  (2,  '02_candidus_phase1_functions.sql',   exists(select 1 from fn where proname = 'criar_empresa_demo')),
  (3,  '03_candidus_phase2_schema.sql',      to_regclass('public.pending_items') is not null),
  (4,  '04_candidus_cartoes.sql',            exists(select 1 from col where table_name = 'financial_accounts' and column_name = 'dia_fechamento')),
  (5,  '05_candidus_fatura_fix.sql',         exists(select 1 from fn where proname = 'baixar_payable_installment' and 'p_descricao' = any(proargnames))),
  (6,  '06_candidus_fase3_import.sql',       to_regclass('public.import_batches') is not null),
  (7,  '07_candidus_fase3_conciliacao.sql',  exists(select 1 from fn where proname = 'conciliar_movimento')),
  (8,  '08_candidus_fase2_op.sql',           exists(select 1 from col where table_name = 'bank_transactions' and column_name = 'juros')
                                             and exists(select 1 from fn where proname = 'estornar_baixa')),
  (9,  '09_candidus_recorrentes.sql',        to_regclass('public.recurring_entries') is not null),
  (10, '10_candidus_fix_funcoes.sql',        (select count(*) from fn where proname in ('criar_conta_receber','criar_conta_pagar',
                                               'baixar_receivable_installment','baixar_payable_installment')) = 4
                                             and exists(select 1 from fn where proname = 'baixar_receivable_installment' and 'p_juros' = any(proargnames))),
  (11, '11_candidus_conciliacao_multi.sql',  to_regclass('public.conciliacao_itens') is not null),
  (12, '12_candidus_regras_conciliacao.sql', to_regclass('public.conciliation_rules') is not null),
  (13, '13_candidus_lancamento_lote.sql',    exists(select 1 from fn where proname = 'criar_contas_lote')),
  (14, '14_candidus_controladoria.sql',      exists(select 1 from fn where proname = 'dre_realizado')),
  (15, '15_candidus_indicadores.sql',        exists(select 1 from fn where proname = 'resumo_financeiro')),
  (16, '16_candidus_custos.sql',             to_regclass('public.rateio_centro_custo') is not null),
  (17, '17_candidus_fixo_variavel.sql',      exists(select 1 from col where table_name = 'categories' and column_name = 'comportamento')
                                             and exists(select 1 from fn where proname = 'dre_realizado' and 'comportamento' = any(proargnames))),
  (99, 'bucket "documentos" (seção 11 do completo)', exists(select 1 from storage.buckets where id = 'documentos'))
)
select ordem, arquivo, case when aplicada then '✓ já está' else '✗ FALTA' end as situacao
from etapas
union all
select 100, 'função duplicada (overload): ' || proname, '⚠ ' || count(*) || ' versões'
from fn group by proname having count(*) > 1
order by 1;
