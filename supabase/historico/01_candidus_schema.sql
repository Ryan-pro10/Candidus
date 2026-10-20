-- =====================================================================
-- CANDIDUS GESTÃO FINANCEIRA
-- Schema base + RLS multiempresa (PostgreSQL / Supabase)
-- Cole no SQL Editor do Supabase e rode de uma vez.
-- =====================================================================

-- gen_random_uuid() já existe no PG13+; pgcrypto é seguro deixar.
create extension if not exists pgcrypto;

-- =====================================================================
-- 0. FUNÇÃO GENÉRICA DE updated_at
-- =====================================================================
create or replace function public.set_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- =====================================================================
-- 1. PERFIS E PERMISSÕES
-- =====================================================================
create table public.roles (
  key         text primary key,        -- 'administrador', 'gestor', ...
  nome        text not null,
  descricao   text
);

insert into public.roles (key, nome) values
  ('administrador','Administrador'),
  ('gestor','Gestor'),
  ('financeiro','Financeiro'),
  ('bpo','BPO'),
  ('contador','Contador'),
  ('visualizacao','Visualização');

create table public.permissions (
  key   text primary key,              -- 'financeiro.contas_receber', ...
  nome  text not null
);

insert into public.permissions (key, nome) values
  ('dashboard','Dashboard'),
  ('financeiro.contas_receber','Contas a receber'),
  ('financeiro.contas_pagar','Contas a pagar'),
  ('financeiro.fluxo_caixa','Fluxo de caixa'),
  ('cadastros.clientes','Clientes'),
  ('cadastros.fornecedores','Fornecedores'),
  ('cadastros.categorias','Categorias'),
  ('cadastros.centros_custo','Centros de custo'),
  ('cadastros.contas_financeiras','Contas financeiras'),
  ('cadastros.empresas','Empresas'),
  ('controladoria','Controladoria'),
  ('bpo','BPO'),
  ('configuracoes','Configurações');

create table public.role_permissions (
  role_key        text references public.roles(key) on delete cascade,
  permission_key  text references public.permissions(key) on delete cascade,
  can_view    boolean not null default true,
  can_create  boolean not null default false,
  can_edit    boolean not null default false,
  can_delete  boolean not null default false,
  primary key (role_key, permission_key)
);

-- Administrador recebe tudo. Os outros perfis você ajusta pela tela de config.
insert into public.role_permissions (role_key, permission_key, can_view, can_create, can_edit, can_delete)
select 'administrador', key, true, true, true, true from public.permissions;

-- =====================================================================
-- 2. USUÁRIOS  (a senha fica em auth.users do Supabase; aqui é o "perfil")
-- =====================================================================
create table public.profiles (
  id          uuid primary key references auth.users(id) on delete cascade,
  nome        text not null default '',
  email       text not null,
  role        text not null default 'visualizacao' references public.roles(key),
  status      text not null default 'ativo' check (status in ('ativo','inativo')),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create trigger trg_profiles_updated before update on public.profiles
  for each row execute function public.set_updated_at();

-- Cria automaticamente o profile quando um usuário se cadastra no Auth.
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, nome, email)
  values (new.id, coalesce(new.raw_user_meta_data->>'nome',''), new.email)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- =====================================================================
-- 3. EMPRESAS  +  VÍNCULO USUÁRIO ↔ EMPRESAS  (coração do multiempresa)
-- =====================================================================
create table public.companies (
  id                 uuid primary key default gen_random_uuid(),
  razao_social       text not null,
  nome_fantasia      text,
  cnpj               text,
  inscricao_estadual text,
  email              text,
  telefone           text,
  cep                text,
  endereco           text,
  numero             text,
  complemento        text,
  bairro             text,
  cidade             text,
  estado             text,
  status             text not null default 'ativo' check (status in ('ativo','inativo')),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);
create trigger trg_companies_updated before update on public.companies
  for each row execute function public.set_updated_at();

create table public.user_companies (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, company_id)
);

-- =====================================================================
-- 4. FUNÇÕES DE ACESSO (usadas pelo RLS)
--    SECURITY DEFINER = ignoram RLS por dentro -> evita recursão.
-- =====================================================================
create or replace function public.has_company_access(target_company uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.user_companies uc
    where uc.user_id = auth.uid()
      and uc.company_id = target_company
  );
$$;

create or replace function public.is_admin()
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.profiles p
    where p.id = auth.uid() and p.role = 'administrador'
  );
$$;

-- =====================================================================
-- 5. CADASTROS  (todos com company_id -> isolamento por empresa)
-- =====================================================================
create table public.customers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  razao_social  text not null,
  nome_fantasia text,
  cpf_cnpj      text,
  email         text,
  telefone      text,
  cep text, endereco text, numero text, complemento text,
  bairro text, cidade text, estado text,
  observacoes   text,
  status        text not null default 'ativo' check (status in ('ativo','inativo')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_customers_updated before update on public.customers
  for each row execute function public.set_updated_at();

create table public.suppliers (
  id            uuid primary key default gen_random_uuid(),
  company_id    uuid not null references public.companies(id) on delete restrict,
  razao_social  text not null,
  nome_fantasia text,
  cpf_cnpj      text,
  email         text,
  telefone      text,
  cep text, endereco text, numero text, complemento text,
  bairro text, cidade text, estado text,
  observacoes   text,
  status        text not null default 'ativo' check (status in ('ativo','inativo')),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_suppliers_updated before update on public.suppliers
  for each row execute function public.set_updated_at();

create table public.categories (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  parent_id  uuid references public.categories(id) on delete set null,
  nome       text not null,
  tipo       text not null check (tipo in ('receita','despesa')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_categories_updated before update on public.categories
  for each row execute function public.set_updated_at();

create table public.cost_centers (
  id         uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete restrict,
  nome       text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_cost_centers_updated before update on public.cost_centers
  for each row execute function public.set_updated_at();

create table public.financial_accounts (
  id                  uuid primary key default gen_random_uuid(),
  company_id          uuid not null references public.companies(id) on delete restrict,
  nome                text not null,
  tipo                text not null check (tipo in ('conta_corrente','poupanca','investimento','caixa')),
  banco   text, agencia text, numero text,
  saldo_inicial       numeric(14,2) not null default 0,
  data_saldo_inicial  date,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);
create trigger trg_fin_accounts_updated before update on public.financial_accounts
  for each row execute function public.set_updated_at();

-- =====================================================================
-- 6. CONTAS A RECEBER  (título + parcelas)
-- =====================================================================
create table public.receivables (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete restrict,
  customer_id          uuid references public.customers(id) on delete set null,
  descricao            text not null,
  documento            text,
  categoria_id         uuid references public.categories(id) on delete set null,
  cost_center_id       uuid references public.cost_centers(id) on delete set null,
  financial_account_id uuid references public.financial_accounts(id) on delete set null,
  data_emissao         date,
  forma_recebimento    text check (forma_recebimento in ('pix','boleto','transferencia','cartao','dinheiro','outro')),
  tipo                 text not null default 'a_vista' check (tipo in ('a_vista','parcelado','recorrente')),
  valor_total          numeric(14,2) not null default 0,
  status               text not null default 'aberto' check (status in ('aberto','quitado','cancelado')),
  observacao           text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_receivables_updated before update on public.receivables
  for each row execute function public.set_updated_at();

create table public.receivable_installments (
  id             uuid primary key default gen_random_uuid(),
  receivable_id  uuid not null references public.receivables(id) on delete cascade,
  company_id     uuid not null references public.companies(id) on delete restrict, -- desnormalizado p/ RLS e dashboard
  numero         int not null default 1,
  total_parcelas int not null default 1,
  competencia    date,
  vencimento     date not null,
  valor          numeric(14,2) not null,
  valor_recebido numeric(14,2) not null default 0,
  saldo          numeric(14,2) generated always as (valor - valor_recebido) stored,
  status         text not null default 'a_receber'
                 check (status in ('a_receber','recebido','recebido_parcial','cancelado')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_rec_inst_updated before update on public.receivable_installments
  for each row execute function public.set_updated_at();

-- =====================================================================
-- 7. CONTAS A PAGAR  (título + parcelas)
-- =====================================================================
create table public.payables (
  id                   uuid primary key default gen_random_uuid(),
  company_id           uuid not null references public.companies(id) on delete restrict,
  supplier_id          uuid references public.suppliers(id) on delete set null,
  descricao            text not null,
  documento            text,
  categoria_id         uuid references public.categories(id) on delete set null,
  cost_center_id       uuid references public.cost_centers(id) on delete set null,
  financial_account_id uuid references public.financial_accounts(id) on delete set null,
  data_emissao         date,
  forma_pagamento      text check (forma_pagamento in ('pix','boleto','transferencia','cartao','dinheiro','outro')),
  tipo                 text not null default 'a_vista' check (tipo in ('a_vista','parcelado','recorrente')),
  valor_total          numeric(14,2) not null default 0,
  status               text not null default 'aberto' check (status in ('aberto','quitado','cancelado')),
  observacao           text,
  anexo_url            text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_payables_updated before update on public.payables
  for each row execute function public.set_updated_at();

create table public.payable_installments (
  id             uuid primary key default gen_random_uuid(),
  payable_id     uuid not null references public.payables(id) on delete cascade,
  company_id     uuid not null references public.companies(id) on delete restrict,
  numero         int not null default 1,
  total_parcelas int not null default 1,
  competencia    date,
  vencimento     date not null,
  valor          numeric(14,2) not null,
  valor_pago     numeric(14,2) not null default 0,
  saldo          numeric(14,2) generated always as (valor - valor_pago) stored,
  status         text not null default 'a_pagar'
                 check (status in ('a_pagar','pago','pago_parcial','cancelado')),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_pay_inst_updated before update on public.payable_installments
  for each row execute function public.set_updated_at();

-- =====================================================================
-- 8. MOVIMENTO BANCÁRIO (extrato / caixa realizado)
--    tipo 'transferencia' NÃO entra como receita/despesa nos relatórios.
-- =====================================================================
create table public.bank_transactions (
  id                        uuid primary key default gen_random_uuid(),
  company_id                uuid not null references public.companies(id) on delete restrict,
  financial_account_id      uuid not null references public.financial_accounts(id) on delete restrict,
  tipo                      text not null check (tipo in ('entrada','saida','transferencia')),
  descricao                 text,
  valor                     numeric(14,2) not null,
  data                      date not null,
  receivable_installment_id uuid references public.receivable_installments(id) on delete set null,
  payable_installment_id    uuid references public.payable_installments(id) on delete set null,
  forma                     text,
  observacao                text,
  created_at                timestamptz not null default now()
);

-- =====================================================================
-- 9. FAVORITOS (por usuário)  e  AUDITORIA
-- =====================================================================
create table public.favorites (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  modulo     text not null,
  created_at timestamptz not null default now(),
  unique (user_id, modulo)
);

create table public.audit_logs (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid references public.companies(id) on delete set null,
  user_id         uuid references public.profiles(id) on delete set null,
  acao            text not null,          -- insert | update | delete | baixa | cancelamento
  tabela          text not null,
  registro_id     uuid,
  valor_anterior  jsonb,
  valor_novo      jsonb,
  created_at      timestamptz not null default now()
);

-- =====================================================================
-- 10. ÍNDICES úteis
-- =====================================================================
create index idx_customers_company           on public.customers(company_id);
create index idx_suppliers_company           on public.suppliers(company_id);
create index idx_categories_company          on public.categories(company_id);
create index idx_cost_centers_company        on public.cost_centers(company_id);
create index idx_fin_accounts_company        on public.financial_accounts(company_id);
create index idx_receivables_company         on public.receivables(company_id);
create index idx_rec_inst_company_venc       on public.receivable_installments(company_id, vencimento);
create index idx_payables_company            on public.payables(company_id);
create index idx_pay_inst_company_venc       on public.payable_installments(company_id, vencimento);
create index idx_bank_tx_company_data        on public.bank_transactions(company_id, data);
create index idx_user_companies_user         on public.user_companies(user_id);

-- =====================================================================
-- 11. RLS  (Row Level Security)
-- =====================================================================
alter table public.roles                   enable row level security;
alter table public.permissions             enable row level security;
alter table public.role_permissions        enable row level security;
alter table public.profiles                enable row level security;
alter table public.companies               enable row level security;
alter table public.user_companies          enable row level security;
alter table public.customers               enable row level security;
alter table public.suppliers               enable row level security;
alter table public.categories              enable row level security;
alter table public.cost_centers            enable row level security;
alter table public.financial_accounts      enable row level security;
alter table public.receivables             enable row level security;
alter table public.receivable_installments enable row level security;
alter table public.payables                enable row level security;
alter table public.payable_installments    enable row level security;
alter table public.bank_transactions       enable row level security;
alter table public.favorites               enable row level security;
alter table public.audit_logs              enable row level security;

-- ---- Tabelas de referência: todo autenticado lê; só admin escreve ----
create policy roles_read   on public.roles           for select to authenticated using (true);
create policy roles_admin  on public.roles           for all    to authenticated using (is_admin()) with check (is_admin());
create policy perms_read   on public.permissions     for select to authenticated using (true);
create policy perms_admin  on public.permissions     for all    to authenticated using (is_admin()) with check (is_admin());
create policy rp_read      on public.role_permissions for select to authenticated using (true);
create policy rp_admin     on public.role_permissions for all    to authenticated using (is_admin()) with check (is_admin());

-- ---- Profiles: vê o próprio ou admin; atualiza o próprio ou admin ----
create policy profiles_select on public.profiles for select to authenticated
  using (id = auth.uid() or is_admin());
create policy profiles_update on public.profiles for update to authenticated
  using (id = auth.uid() or is_admin()) with check (id = auth.uid() or is_admin());
create policy profiles_admin_write on public.profiles for insert to authenticated
  with check (is_admin() or id = auth.uid());

-- ---- Empresas: vê as que tem acesso (ou admin); só admin cria/edita ----
create policy companies_select on public.companies for select to authenticated
  using (has_company_access(id) or is_admin());
create policy companies_admin on public.companies for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---- Vínculo usuário-empresa: vê o próprio ou admin; só admin gerencia ----
create policy uc_select on public.user_companies for select to authenticated
  using (user_id = auth.uid() or is_admin());
create policy uc_admin on public.user_companies for all to authenticated
  using (is_admin()) with check (is_admin());

-- ---- Tabelas por empresa: quem tem acesso àquela empresa (admin vê tudo) ----
create policy customers_rls        on public.customers               for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy suppliers_rls        on public.suppliers               for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy categories_rls       on public.categories              for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy cost_centers_rls     on public.cost_centers            for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy fin_accounts_rls     on public.financial_accounts      for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy receivables_rls      on public.receivables             for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy rec_inst_rls         on public.receivable_installments for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy payables_rls         on public.payables                for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy pay_inst_rls         on public.payable_installments    for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy bank_tx_rls          on public.bank_transactions       for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());

-- ---- Favoritos: cada um vê/edita os seus ----
create policy favorites_rls on public.favorites for all to authenticated
  using (user_id = auth.uid()) with check (user_id = auth.uid());

-- ---- Auditoria: lê quem tem acesso à empresa (ou admin); insere qualquer autenticado ----
create policy audit_select on public.audit_logs for select to authenticated
  using (company_id is null or has_company_access(company_id) or is_admin());
create policy audit_insert on public.audit_logs for insert to authenticated
  with check (true);

-- =====================================================================
-- 12. VIEWS que já calculam a situação (inclui "vencido" pela data)
--     security_invoker = respeita o RLS de quem consulta.
-- =====================================================================
create or replace view public.vw_contas_receber with (security_invoker = true) as
select
  i.*,
  r.customer_id,
  r.descricao,
  r.documento,
  case
    when i.status = 'cancelado'                     then 'cancelado'
    when i.status = 'recebido'                      then 'recebido'
    when i.vencimento < current_date                then 'vencido'
    when i.status = 'recebido_parcial'              then 'recebido_parcial'
    else 'a_vencer'
  end as situacao
from public.receivable_installments i
join public.receivables r on r.id = i.receivable_id;

create or replace view public.vw_contas_pagar with (security_invoker = true) as
select
  i.*,
  p.supplier_id,
  p.descricao,
  p.documento,
  case
    when i.status = 'cancelado'                     then 'cancelado'
    when i.status = 'pago'                          then 'pago'
    when i.vencimento < current_date                then 'vencido'
    when i.status = 'pago_parcial'                  then 'pago_parcial'
    else 'a_vencer'
  end as situacao
from public.payable_installments i
join public.payables p on p.id = i.payable_id;

-- =====================================================================
-- FIM. Próximo passo: funções de baixa (receber/pagar parcial),
-- geração de parcelas e seed da empresa de demonstração.
-- =====================================================================
