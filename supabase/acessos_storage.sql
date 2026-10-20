-- =====================================================================
-- CANDIDUS — ACESSOS + STORAGE (extraído da seção 11 do candidus_completo.sql)
-- Permissões das tabelas/funções para o app e o bucket privado "documentos"
-- com as policies por empresa. Pode rodar mais de uma vez.
-- Rode se o supabase/diagnostico.sql mostrar 'bucket "documentos"' como FALTA,
-- ou se aparecer "permission denied" no app depois de rodar etapas novas.
-- =====================================================================
grant usage on schema public to anon, authenticated;
grant all on all tables    in schema public to anon, authenticated;
grant all on all sequences in schema public to anon, authenticated;
grant all on all functions in schema public to anon, authenticated;
alter default privileges in schema public grant all on tables    to anon, authenticated;
alter default privileges in schema public grant all on sequences to anon, authenticated;
alter default privileges in schema public grant all on functions to anon, authenticated;
insert into storage.buckets (id,name,public) values ('documentos','documentos',false) on conflict (id) do nothing;
drop policy if exists "documentos_select" on storage.objects;
drop policy if exists "documentos_insert" on storage.objects;
drop policy if exists "documentos_update" on storage.objects;
drop policy if exists "documentos_delete" on storage.objects;
create policy "documentos_select" on storage.objects for select to authenticated using (bucket_id='documentos' and exists (select 1 from public.companies c where c.id=((storage.foldername(name))[1])::uuid));
create policy "documentos_insert" on storage.objects for insert to authenticated with check (bucket_id='documentos' and exists (select 1 from public.companies c where c.id=((storage.foldername(name))[1])::uuid));
create policy "documentos_update" on storage.objects for update to authenticated using (bucket_id='documentos' and exists (select 1 from public.companies c where c.id=((storage.foldername(name))[1])::uuid)) with check (bucket_id='documentos' and exists (select 1 from public.companies c where c.id=((storage.foldername(name))[1])::uuid));
create policy "documentos_delete" on storage.objects for delete to authenticated using (bucket_id='documentos' and exists (select 1 from public.companies c where c.id=((storage.foldername(name))[1])::uuid));
