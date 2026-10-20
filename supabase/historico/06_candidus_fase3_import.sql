-- =====================================================================
-- CANDIDUS — FASE 3 (bloco 1): IMPORTAÇÃO DE EXTRATO (OFX/CSV) + dedup
-- Rode uma vez no SQL Editor.
-- =====================================================================

-- Rastreia a origem do movimento bancário (manual x importado)
alter table public.bank_transactions add column if not exists origem text not null default 'manual';
alter table public.bank_transactions add column if not exists imported_transaction_id uuid;

create table public.import_batches (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  financial_account_id uuid not null references public.financial_accounts(id) on delete cascade,
  origem text not null check (origem in ('ofx','csv')),
  nome_arquivo text,
  periodo_inicio date,
  periodo_fim date,
  qtd_total int not null default 0,
  qtd_importadas int not null default 0,
  qtd_duplicadas int not null default 0,
  status text not null default 'concluido' check (status in ('conferindo','concluido','cancelado')),
  created_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now()
);

create table public.imported_transactions (
  id uuid primary key default gen_random_uuid(),
  batch_id uuid not null references public.import_batches(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  financial_account_id uuid not null references public.financial_accounts(id) on delete cascade,
  data date not null,
  descricao text,
  documento text,
  valor numeric(14,2) not null,        -- sempre positivo
  tipo text not null check (tipo in ('entrada','saida')),
  fit_id text,                          -- id único do OFX (quando houver)
  hash text,                            -- conta|data|valor|descrição (p/ dedup)
  status text not null default 'nova'
    check (status in ('nova','possivel_duplicada','duplicada','importada','ignorada')),
  bank_transaction_id uuid references public.bank_transactions(id) on delete set null,
  created_at timestamptz not null default now()
);

create index idx_batches_company on public.import_batches(company_id);
create index idx_imptx_company on public.imported_transactions(company_id, status);
create index idx_imptx_hash on public.imported_transactions(financial_account_id, hash);
create index idx_imptx_fit on public.imported_transactions(financial_account_id, fit_id);

alter table public.import_batches        enable row level security;
alter table public.imported_transactions enable row level security;

create policy batches_rls on public.import_batches        for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy imptx_rls   on public.imported_transactions for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());

grant all on public.import_batches        to anon, authenticated;
grant all on public.imported_transactions to anon, authenticated;

-- =====================================================================
-- FIM bloco 1. Próximo: conciliação inteligente.
-- =====================================================================
