-- =====================================================================
-- CANDIDUS — FASE 3: GESTÃO DE CUSTOS
--   1. Centro de custo padrão na categoria (preenche sozinho nos lançamentos)
--   2. Rateio de um título entre vários centros de custo (ex.: 60% / 40%)
--   3. custos_por_cc(): realizado por competência por centro de custo e categoria
--      (com rateio aplicado e categoria-pai), base dos relatórios novos
-- Rode UMA vez no SQL Editor (pode rodar de novo sem quebrar).
-- FUNÇÕES: NOVAS salvar_rateio, custos_por_cc, trg_categoria_cc_valida.
--          Nenhuma função existente foi alterada.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Centro de custo padrão da categoria
-- ---------------------------------------------------------------------
alter table public.categories add column if not exists default_cost_center_id uuid
  references public.cost_centers(id) on delete set null;

create or replace function public.trg_categoria_cc_valida() returns trigger language plpgsql as $$
begin
  if new.default_cost_center_id is not null
     and (select company_id from public.cost_centers where id = new.default_cost_center_id) is distinct from new.company_id then
    raise exception 'O centro de custo padrão precisa ser da mesma empresa da categoria';
  end if;
  return new;
end $$;
drop trigger if exists trg_categoria_cc_valida on public.categories;
create trigger trg_categoria_cc_valida before insert or update of default_cost_center_id, company_id on public.categories
  for each row execute function public.trg_categoria_cc_valida();

-- ---------------------------------------------------------------------
-- 2. Rateio por título (soma dos % = 100). Sem rateio = vale o centro de custo do título.
-- ---------------------------------------------------------------------
create table if not exists public.rateio_centro_custo (
  id              uuid primary key default gen_random_uuid(),
  company_id      uuid not null references public.companies(id) on delete cascade,
  tipo            text not null check (tipo in ('pagar','receber')),
  payable_id      uuid references public.payables(id)    on delete cascade,
  receivable_id   uuid references public.receivables(id) on delete cascade,
  cost_center_id  uuid not null references public.cost_centers(id) on delete restrict,
  percentual      numeric(7,4) not null check (percentual > 0 and percentual <= 100),
  created_at      timestamptz not null default now(),
  constraint rateio_titulo_ck check (
    (tipo='pagar'   and payable_id    is not null and receivable_id is null) or
    (tipo='receber' and receivable_id is not null and payable_id    is null))
);
create unique index if not exists ux_rateio_pag on public.rateio_centro_custo(payable_id, cost_center_id)    where payable_id is not null;
create unique index if not exists ux_rateio_rec on public.rateio_centro_custo(receivable_id, cost_center_id) where receivable_id is not null;

alter table public.rateio_centro_custo enable row level security;
drop policy if exists rateio_rls on public.rateio_centro_custo;
create policy rateio_rls on public.rateio_centro_custo for all to authenticated
  using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
grant all on public.rateio_centro_custo to anon, authenticated;

-- Grava o rateio inteiro de um título (substitui o anterior). Lista vazia = remove o rateio.
-- p_itens = [{"cost_center_id":"uuid","percentual":60}, ...]
create or replace function public.salvar_rateio(p_tipo text, p_titulo_id uuid, p_itens jsonb)
returns int language plpgsql as $$
declare v_co uuid; v_it jsonb; v_soma numeric := 0; v_n int := 0; v_cc uuid; v_pct numeric;
begin
  if p_tipo not in ('pagar','receber') then raise exception 'Tipo inválido'; end if;
  if p_tipo = 'pagar' then select company_id into v_co from public.payables where id = p_titulo_id;
  else select company_id into v_co from public.receivables where id = p_titulo_id; end if;
  if v_co is null then raise exception 'Título não encontrado ou sem acesso'; end if;
  if p_itens is null or jsonb_typeof(p_itens) <> 'array' then raise exception 'Formato inválido'; end if;

  if jsonb_array_length(p_itens) > 0 then
    if (select count(distinct x->>'cost_center_id') from jsonb_array_elements(p_itens) x) <> jsonb_array_length(p_itens) then
      raise exception 'O mesmo centro de custo aparece mais de uma vez'; end if;
    for v_it in select * from jsonb_array_elements(p_itens) loop
      v_cc := nullif(v_it->>'cost_center_id','')::uuid; v_pct := round(nullif(v_it->>'percentual','')::numeric, 4);
      if v_cc is null then raise exception 'Escolha o centro de custo em todas as linhas'; end if;
      if v_pct is null or v_pct <= 0 or v_pct > 100 then raise exception 'Percentual inválido'; end if;
      if (select company_id from public.cost_centers where id = v_cc) is distinct from v_co then
        raise exception 'Centro de custo não encontrado ou de outra empresa'; end if;
      v_soma := v_soma + v_pct;
    end loop;
    if abs(v_soma - 100) > 0.01 then raise exception 'Os percentuais somam %, precisam somar 100%%', round(v_soma,2)||'%'; end if;
  end if;

  if p_tipo = 'pagar' then delete from public.rateio_centro_custo where payable_id = p_titulo_id;
  else delete from public.rateio_centro_custo where receivable_id = p_titulo_id; end if;

  for v_it in select * from jsonb_array_elements(p_itens) loop
    insert into public.rateio_centro_custo(company_id, tipo, payable_id, receivable_id, cost_center_id, percentual)
    values (v_co, p_tipo, case when p_tipo='pagar' then p_titulo_id end, case when p_tipo='receber' then p_titulo_id end,
            (v_it->>'cost_center_id')::uuid, round((v_it->>'percentual')::numeric, 4));
    v_n := v_n + 1;
  end loop;

  insert into public.audit_logs(company_id, user_id, acao, tabela, registro_id, valor_novo)
  values (v_co, auth.uid(), 'rateio', case when p_tipo='pagar' then 'payables' else 'receivables' end, p_titulo_id, p_itens);
  return v_n;
end $$;

-- ---------------------------------------------------------------------
-- 3. Realizado por centro de custo x categoria (competência, meses inteiros)
--    Com rateio: o valor da parcela é dividido pelos % do título.
--    Sem rateio: vai pro centro de custo do título (null = "sem centro de custo").
-- ---------------------------------------------------------------------
create or replace function public.custos_por_cc(p_company uuid, p_ini date, p_fim date)
returns table (mes date, cost_center_id uuid, centro_custo text, categoria_id uuid, categoria text,
               categoria_pai_id uuid, categoria_pai text, origem text, valor numeric)
language sql stable as $$
  with base as (
    select date_trunc('month', i.competencia)::date as mes, 'receber'::text as origem, r.id as titulo_id,
           r.categoria_id, r.cost_center_id, i.valor
      from public.receivable_installments i join public.receivables r on r.id = i.receivable_id
     where i.status <> 'cancelado'
       and i.competencia >= date_trunc('month', p_ini) and i.competencia < date_trunc('month', p_fim) + interval '1 month'
       and (p_company is null or i.company_id = p_company)
    union all
    select date_trunc('month', i.competencia)::date, 'pagar', p.id, p.categoria_id, p.cost_center_id, i.valor
      from public.payable_installments i join public.payables p on p.id = i.payable_id
     where i.status <> 'cancelado'
       and i.competencia >= date_trunc('month', p_ini) and i.competencia < date_trunc('month', p_fim) + interval '1 month'
       and (p_company is null or i.company_id = p_company)
  ),
  rat as (
    select b.mes, b.origem, b.categoria_id,
           coalesce(rr.cost_center_id, rp.cost_center_id, b.cost_center_id) as cc,
           b.valor * coalesce(rr.percentual, rp.percentual, 100) / 100 as v
      from base b
      left join public.rateio_centro_custo rr on b.origem = 'receber' and rr.receivable_id = b.titulo_id
      left join public.rateio_centro_custo rp on b.origem = 'pagar'   and rp.payable_id    = b.titulo_id
  )
  select r.mes, r.cc, coalesce(cc.nome, 'Sem centro de custo'), r.categoria_id, coalesce(c.nome, 'Sem categoria'),
         c.parent_id, cp.nome, r.origem, round(sum(r.v), 2)
    from rat r
    left join public.cost_centers cc on cc.id = r.cc
    left join public.categories   c  on c.id  = r.categoria_id
    left join public.categories   cp on cp.id = c.parent_id
   group by r.mes, r.cc, cc.nome, r.categoria_id, c.nome, c.parent_id, cp.nome, r.origem
$$;

create index if not exists idx_rateio_pag_t on public.rateio_centro_custo(payable_id);
create index if not exists idx_rateio_rec_t on public.rateio_centro_custo(receivable_id);

grant execute on function public.salvar_rateio(text, uuid, jsonb)  to anon, authenticated;
grant execute on function public.custos_por_cc(uuid, date, date)   to anon, authenticated;

notify pgrst, 'reload schema';
