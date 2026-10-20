-- =====================================================================
-- CANDIDUS — FASE 2: BPO FINANCEIRO + CONTROLADORIA
-- Rode DEPOIS do candidus_schema.sql (e do phase1_functions), no mesmo banco.
-- Aproveita as tabelas existentes; não recria nada da Fase 1.
-- =====================================================================

-- =====================================================================
-- REFERÊNCIAS (globais, sem company_id)
-- =====================================================================
create table public.pending_item_types (
  key text primary key, nome text not null
);
insert into public.pending_item_types (key,nome) values
  ('financeiro','Financeiro'),('conciliacao','Conciliação'),('documento','Documento'),
  ('cliente','Cliente'),('fornecedor','Fornecedor'),('contrato','Contrato'),
  ('fiscal','Fiscal'),('operacional','Operacional'),('outros','Outros');

create table public.financial_indicators (
  key text primary key, nome text not null, unidade text not null default 'moeda'  -- moeda|percent|dias
);
insert into public.financial_indicators (key,nome,unidade) values
  ('faturamento','Faturamento','moeda'),('receita_liquida','Receita líquida','moeda'),
  ('despesas','Despesas','moeda'),('custos','Custos','moeda'),('lucro','Lucro','moeda'),
  ('margem_liquida','Margem líquida','percent'),('inadimplencia','Inadimplência','percent'),
  ('ticket_medio','Ticket médio','moeda'),('pmr','Prazo médio de recebimento','dias'),
  ('pmp','Prazo médio de pagamento','dias'),('saldo','Saldo','moeda'),('fluxo_caixa','Fluxo de caixa','moeda');

-- =====================================================================
-- BPO
-- =====================================================================
create table public.bpo_company_assignments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  assigned_user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (company_id, assigned_user_id)
);

create table public.pending_items (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  tipo text not null default 'outros' references public.pending_item_types(key),
  titulo text not null,
  descricao text,
  prioridade text not null default 'media' check (prioridade in ('baixa','media','alta','critica')),
  assigned_user_id uuid references public.profiles(id) on delete set null,
  prazo date,
  status text not null default 'aberta'
    check (status in ('aberta','em_andamento','aguardando_cliente','aguardando_documento','resolvida','cancelada')),
  origem text not null default 'manual' check (origem in ('manual','automatica')),
  dedupe_key text,
  source_table text,
  source_id uuid,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_pending_updated before update on public.pending_items for each row execute function public.set_updated_at();

-- =====================================================================
-- TAREFAS
-- =====================================================================
create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  titulo text not null,
  descricao text,
  categoria text,
  assigned_user_id uuid references public.profiles(id) on delete set null,
  prioridade text not null default 'media' check (prioridade in ('baixa','media','alta','critica')),
  data_inicial date,
  prazo date,
  status text not null default 'a_fazer'
    check (status in ('a_fazer','em_andamento','aguardando','concluida','cancelada')),
  recorrencia text not null default 'nenhuma'
    check (recorrencia in ('nenhuma','diaria','semanal','quinzenal','mensal','trimestral','anual')),
  recurrence_parent_id uuid references public.tasks(id) on delete set null,
  completed_at timestamptz,
  completed_by uuid references public.profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_tasks_updated before update on public.tasks for each row execute function public.set_updated_at();

create table public.task_checklists (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  descricao text not null,
  done boolean not null default false,
  ordem int not null default 0,
  created_at timestamptz not null default now()
);

create table public.task_comments (
  id uuid primary key default gen_random_uuid(),
  task_id uuid not null references public.tasks(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  user_id uuid references public.profiles(id) on delete set null,
  texto text not null,
  created_at timestamptz not null default now()
);

-- Modelos de checklist/tarefa (globais quando company_id é null)
create table public.task_templates (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade,
  nome text not null,
  periodicidade text,
  itens jsonb not null default '[]'::jsonb,  -- array de strings
  created_at timestamptz not null default now()
);
insert into public.task_templates (company_id,nome,periodicidade,itens) values
 (null,'Rotina diária','diaria', '["Conferir pagamentos","Conferir recebimentos","Conferir pendências bancárias"]'::jsonb),
 (null,'Rotina semanal','semanal','["Conferir contas a pagar","Conferir contas a receber","Cobrar documentos","Verificar inadimplência"]'::jsonb),
 (null,'Fechamento mensal','mensal','["Conferir extratos","Fazer conciliação","Conferir documentos","Conferir lançamentos","Conferir categorias","Conferir centros de custo","Analisar fluxo de caixa","Conferir inadimplência","Fechar mês","Emitir relatório"]'::jsonb);

-- =====================================================================
-- DOCUMENTOS
-- =====================================================================
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  nome text not null,
  tipo text,
  data date,
  competencia date,
  storage_path text,                 -- caminho no Supabase Storage
  customer_id uuid references public.customers(id) on delete set null,
  supplier_id uuid references public.suppliers(id) on delete set null,
  financial_account_id uuid references public.financial_accounts(id) on delete set null,
  receivable_id uuid references public.receivables(id) on delete set null,
  payable_id uuid references public.payables(id) on delete set null,
  categoria_id uuid references public.categories(id) on delete set null,
  status text not null default 'pendente' check (status in ('pendente','solicitado','recebido','conferido','rejeitado')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_documents_updated before update on public.documents for each row execute function public.set_updated_at();

create table public.document_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  assigned_user_id uuid references public.profiles(id) on delete set null,
  descricao text not null,
  tipo_documento text,
  competencia date,
  prazo date,
  prioridade text not null default 'media' check (prioridade in ('baixa','media','alta','critica')),
  status text not null default 'solicitado' check (status in ('solicitado','recebido','conferido','cancelado')),
  document_id uuid references public.documents(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_docreq_updated before update on public.document_requests for each row execute function public.set_updated_at();

-- =====================================================================
-- ORÇAMENTO (por competência)
-- =====================================================================
create table public.budgets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  ano int not null,
  nome text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, ano)
);
create trigger trg_budgets_updated before update on public.budgets for each row execute function public.set_updated_at();

create table public.budget_items (
  id uuid primary key default gen_random_uuid(),
  budget_id uuid not null references public.budgets(id) on delete cascade,
  company_id uuid not null references public.companies(id) on delete cascade,
  ano int not null,
  mes int not null check (mes between 1 and 12),
  categoria_id uuid references public.categories(id) on delete set null,
  cost_center_id uuid references public.cost_centers(id) on delete set null,
  valor_orcado numeric(14,2) not null default 0,
  created_at timestamptz not null default now()
);

-- =====================================================================
-- DRE (estrutura configurável + mapeamento categoria -> linha)
-- =====================================================================
create table public.dre_structures (
  id uuid primary key default gen_random_uuid(),
  company_id uuid references public.companies(id) on delete cascade, -- null = modelo global
  nome text not null,
  is_default boolean not null default false,
  created_at timestamptz not null default now()
);

create table public.dre_structure_items (
  id uuid primary key default gen_random_uuid(),
  structure_id uuid not null references public.dre_structures(id) on delete cascade,
  company_id uuid references public.companies(id) on delete cascade,
  ordem int not null,
  codigo text not null,
  titulo text not null,
  tipo text not null check (tipo in ('linha','subtotal')),   -- linha recebe lançamentos; subtotal é calculado
  natureza text,   -- receita_bruta | deducao | custo | despesa_operacional | resultado_financeiro | imposto
  operador text not null default 'soma' check (operador in ('soma','subtrai')),
  created_at timestamptz not null default now()
);

create table public.dre_category_mappings (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  categoria_id uuid not null references public.categories(id) on delete cascade,
  dre_item_id uuid not null references public.dre_structure_items(id) on delete cascade,
  created_at timestamptz not null default now(),
  unique (company_id, categoria_id)
);

-- Estrutura padrão de DRE (global)
do $$
declare v_str uuid;
begin
  insert into public.dre_structures (company_id,nome,is_default) values (null,'DRE Gerencial padrão',true) returning id into v_str;
  insert into public.dre_structure_items (structure_id,company_id,ordem,codigo,titulo,tipo,natureza,operador) values
   (v_str,null,1,'receita_bruta','RECEITA BRUTA','linha','receita_bruta','soma'),
   (v_str,null,2,'deducoes','(-) DEDUÇÕES','linha','deducao','subtrai'),
   (v_str,null,3,'receita_liquida','= RECEITA LÍQUIDA','subtotal',null,'soma'),
   (v_str,null,4,'custos','(-) CUSTOS','linha','custo','subtrai'),
   (v_str,null,5,'lucro_bruto','= LUCRO BRUTO','subtotal',null,'soma'),
   (v_str,null,6,'despesas_operacionais','(-) DESPESAS OPERACIONAIS','linha','despesa_operacional','subtrai'),
   (v_str,null,7,'resultado_operacional','= RESULTADO OPERACIONAL','subtotal',null,'soma'),
   (v_str,null,8,'resultado_financeiro','(+/-) RESULTADO FINANCEIRO','linha','resultado_financeiro','soma'),
   (v_str,null,9,'resultado_antes_impostos','= RESULTADO ANTES DOS IMPOSTOS','subtotal',null,'soma'),
   (v_str,null,10,'impostos','(-) IMPOSTOS','linha','imposto','subtrai'),
   (v_str,null,11,'resultado_liquido','= RESULTADO LÍQUIDO','subtotal',null,'soma');
end $$;

-- =====================================================================
-- METAS DE INDICADORES
-- =====================================================================
create table public.indicator_targets (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references public.companies(id) on delete cascade,
  indicador text not null references public.financial_indicators(key),
  ano int not null,
  mes int check (mes between 1 and 12),   -- null = meta anual
  meta numeric(14,2) not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create trigger trg_targets_updated before update on public.indicator_targets for each row execute function public.set_updated_at();

-- =====================================================================
-- ÍNDICES
-- =====================================================================
create index idx_pending_company on public.pending_items(company_id, status);
create index idx_pending_dedupe on public.pending_items(dedupe_key);
create index idx_tasks_company on public.tasks(company_id, status);
create index idx_tasks_prazo on public.tasks(company_id, prazo);
create index idx_checklist_task on public.task_checklists(task_id);
create index idx_comments_task on public.task_comments(task_id);
create index idx_documents_company on public.documents(company_id, status);
create index idx_docreq_company on public.document_requests(company_id, status);
create index idx_budget_items_company on public.budget_items(company_id, ano, mes);
create index idx_dre_items_struct on public.dre_structure_items(structure_id);
create index idx_dre_map_company on public.dre_category_mappings(company_id);
create index idx_targets_company on public.indicator_targets(company_id, ano);
create index idx_bpo_assign_company on public.bpo_company_assignments(company_id);

-- =====================================================================
-- RLS
-- =====================================================================
alter table public.pending_item_types      enable row level security;
alter table public.financial_indicators    enable row level security;
alter table public.bpo_company_assignments enable row level security;
alter table public.pending_items           enable row level security;
alter table public.tasks                   enable row level security;
alter table public.task_checklists         enable row level security;
alter table public.task_comments           enable row level security;
alter table public.task_templates          enable row level security;
alter table public.documents               enable row level security;
alter table public.document_requests       enable row level security;
alter table public.budgets                 enable row level security;
alter table public.budget_items            enable row level security;
alter table public.dre_structures          enable row level security;
alter table public.dre_structure_items     enable row level security;
alter table public.dre_category_mappings   enable row level security;
alter table public.indicator_targets       enable row level security;

-- Referências: todo autenticado lê; só admin escreve
create policy pit_read  on public.pending_item_types   for select to authenticated using (true);
create policy pit_admin on public.pending_item_types   for all    to authenticated using (is_admin()) with check (is_admin());
create policy fi_read   on public.financial_indicators for select to authenticated using (true);
create policy fi_admin  on public.financial_indicators for all    to authenticated using (is_admin()) with check (is_admin());

-- Tabelas por empresa (admin vê tudo)
create policy bpo_rls      on public.bpo_company_assignments for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy pend_rls     on public.pending_items           for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy tasks_rls    on public.tasks                   for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy chk_rls      on public.task_checklists         for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy cmt_rls      on public.task_comments           for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy doc_rls      on public.documents               for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy docreq_rls   on public.document_requests       for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy budg_rls     on public.budgets                 for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy budgi_rls    on public.budget_items            for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy map_rls      on public.dre_category_mappings   for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());
create policy tgt_rls      on public.indicator_targets       for all to authenticated using (has_company_access(company_id) or is_admin()) with check (has_company_access(company_id) or is_admin());

-- Templates e DRE: leem globais (company_id null) + os da própria empresa; escrevem admin ou dono da empresa
create policy tpl_select on public.task_templates for select to authenticated using (company_id is null or has_company_access(company_id) or is_admin());
create policy tpl_write  on public.task_templates for all    to authenticated using (is_admin() or has_company_access(company_id)) with check (is_admin() or has_company_access(company_id));

create policy dstr_select on public.dre_structures for select to authenticated using (company_id is null or has_company_access(company_id) or is_admin());
create policy dstr_write  on public.dre_structures for all    to authenticated using (is_admin() or has_company_access(company_id)) with check (is_admin() or has_company_access(company_id));

create policy ditem_select on public.dre_structure_items for select to authenticated using (company_id is null or has_company_access(company_id) or is_admin());
create policy ditem_write  on public.dre_structure_items for all    to authenticated using (is_admin() or has_company_access(company_id)) with check (is_admin() or has_company_access(company_id));

-- =====================================================================
-- AUTOMAÇÃO DE PENDÊNCIAS (cria as automáticas e resolve as obsoletas)
-- Rode manualmente ou via pg_cron. SECURITY DEFINER para uso agendado.
-- Retorna quantas pendências novas foram criadas.
-- =====================================================================
create or replace function public.gerar_pendencias_automaticas(p_company uuid default null)
returns int language plpgsql security definer set search_path=public as $$
declare v_count int := 0; r record;
begin
  -- 1. Contas a RECEBER vencidas sem baixa total
  for r in
    select i.id, i.company_id, i.vencimento, rec.descricao
    from receivable_installments i join receivables rec on rec.id=i.receivable_id
    where i.status not in ('recebido','cancelado') and i.saldo>0 and i.vencimento < current_date
      and (p_company is null or i.company_id=p_company)
  loop
    if not exists (select 1 from pending_items p where p.dedupe_key='rec_venc:'||r.id and p.status not in ('resolvida','cancelada')) then
      insert into pending_items(company_id,tipo,titulo,descricao,prioridade,status,origem,dedupe_key,source_table,source_id)
      values (r.company_id,'financeiro','Conta a receber vencida',
              coalesce(r.descricao,'')||' — venc. '||to_char(r.vencimento,'DD/MM/YYYY'),
              'alta','aberta','automatica','rec_venc:'||r.id,'receivable_installments',r.id);
      v_count:=v_count+1;
    end if;
  end loop;

  -- 2. Contas a PAGAR vencidas sem baixa total
  for r in
    select i.id, i.company_id, i.vencimento, pay.descricao
    from payable_installments i join payables pay on pay.id=i.payable_id
    where i.status not in ('pago','cancelado') and i.saldo>0 and i.vencimento < current_date
      and (p_company is null or i.company_id=p_company)
  loop
    if not exists (select 1 from pending_items p where p.dedupe_key='pag_venc:'||r.id and p.status not in ('resolvida','cancelada')) then
      insert into pending_items(company_id,tipo,titulo,descricao,prioridade,status,origem,dedupe_key,source_table,source_id)
      values (r.company_id,'financeiro','Conta a pagar vencida',
              coalesce(r.descricao,'')||' — venc. '||to_char(r.vencimento,'DD/MM/YYYY'),
              'alta','aberta','automatica','pag_venc:'||r.id,'payable_installments',r.id);
      v_count:=v_count+1;
    end if;
  end loop;

  -- 3. Tarefas atrasadas
  for r in
    select t.id, t.company_id, t.titulo, t.prazo from tasks t
    where t.status not in ('concluida','cancelada') and t.prazo is not null and t.prazo < current_date
      and (p_company is null or t.company_id=p_company)
  loop
    if not exists (select 1 from pending_items p where p.dedupe_key='tarefa:'||r.id and p.status not in ('resolvida','cancelada')) then
      insert into pending_items(company_id,tipo,titulo,descricao,prioridade,status,origem,dedupe_key,source_table,source_id)
      values (r.company_id,'operacional','Tarefa atrasada',
              coalesce(r.titulo,'')||' — prazo '||to_char(r.prazo,'DD/MM/YYYY'),
              'media','aberta','automatica','tarefa:'||r.id,'tasks',r.id);
      v_count:=v_count+1;
    end if;
  end loop;

  -- 4. Auto-resolver pendências automáticas cuja origem não se aplica mais
  update pending_items p set status='resolvida', resolved_at=now()
   where p.origem='automatica' and p.status not in ('resolvida','cancelada')
     and (p_company is null or p.company_id=p_company)
     and (
       (p.source_table='receivable_installments' and not exists (
          select 1 from receivable_installments i where i.id=p.source_id
            and i.status not in ('recebido','cancelado') and i.saldo>0 and i.vencimento<current_date))
    or (p.source_table='payable_installments' and not exists (
          select 1 from payable_installments i where i.id=p.source_id
            and i.status not in ('pago','cancelado') and i.saldo>0 and i.vencimento<current_date))
    or (p.source_table='tasks' and not exists (
          select 1 from tasks t where t.id=p.source_id
            and t.status not in ('concluida','cancelada') and t.prazo<current_date))
     );

  return v_count;
end;
$$;

-- =====================================================================
-- FIM DA FASE 2 (banco). Próximo: telas de BPO e Controladoria.
-- =====================================================================
