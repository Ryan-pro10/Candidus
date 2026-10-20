-- =====================================================================
-- CANDIDUS — FASE 2: LANÇAMENTOS RECORRENTES (contas fixas)
-- Modelo que gera contas a pagar/receber automaticamente por período.
-- Rode uma vez no SQL Editor.
-- =====================================================================
create table public.recurring_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tipo text not null check (tipo in ('receber','pagar')),
  customer_id uuid references public.customers(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  descricao text not null,
  categoria_id uuid references public.categories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  financial_account_id uuid references public.financial_accounts(id) on delete set null,
  forma text,
  valor numeric(14,2) not null,
  periodicidade text not null check (periodicidade in ('semanal','quinzenal','mensal','trimestral','anual')),
  data_inicio date not null,
  data_fim date,
  proxima date not null,
  ativo boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_recur_updated before update on public.recurring_entries for each row execute function public.set_updated_at();
create index idx_recur_company on public.recurring_entries(company_id, ativo);

alter table public.recurring_entries enable row level security;
create policy recur_rls on public.recurring_entries for all to authenticated
  using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
grant all on public.recurring_entries to anon, authenticated;

-- Gera as contas pendentes de cada recorrência até a data informada (padrão: hoje).
-- O ponteiro "proxima" avança a cada geração, então rodar de novo NÃO duplica.
create or replace function public.gerar_recorrencias(p_company uuid default null, p_ate date default current_date)
returns int language plpgsql as $$
declare r record; v_count int := 0; v_prox date; guard int;
begin
  for r in select * from public.recurring_entries
           where ativo and proxima <= p_ate and (p_company is null or company_id = p_company) loop
    v_prox := r.proxima; guard := 0;
    while v_prox <= p_ate and (r.data_fim is null or v_prox <= r.data_fim) and guard < 120 loop
      if r.tipo='receber' then
        perform public.criar_conta_receber(r.company_id, r.customer_id, r.descricao, r.valor, v_prox, 1, 1,
                 r.categoria_id, r.cost_center_id, r.financial_account_id, null, r.forma, v_prox);
      else
        perform public.criar_conta_pagar(r.company_id, r.supplier_id, r.descricao, r.valor, v_prox, 1, 1,
                 r.categoria_id, r.cost_center_id, r.financial_account_id, null, r.forma, v_prox, null);
      end if;
      v_count := v_count + 1;
      v_prox := (case r.periodicidade
        when 'semanal'    then v_prox + interval '7 days'
        when 'quinzenal'  then v_prox + interval '15 days'
        when 'mensal'     then v_prox + interval '1 month'
        when 'trimestral' then v_prox + interval '3 months'
        when 'anual'      then v_prox + interval '1 year' end)::date;
      guard := guard + 1;
    end loop;
    update public.recurring_entries set proxima = v_prox where id = r.id;
  end loop;
  return v_count;
end; $$;

grant execute on function public.gerar_recorrencias(uuid,date) to anon, authenticated;
