-- 078_growth_app_surface.sql
-- App facing surface for the Fieldhorse growth engine UI.
--   1. Manager guard on fh_seed_growth_defaults (belt and suspenders; the import it calls is already guarded).
--   2. fh_client_ctx_app: the merge field context for one client, callable from the app (previews, agent test panel).
--   3. Realtime: add the inbox tables to the supabase_realtime publication so the app can subscribe with postgres_changes.
-- Safe to re-run. No existing table is altered.

-- ---------------------------------------------------------------------------
-- 1. seed guard
-- ---------------------------------------------------------------------------
create or replace function public.fh_seed_growth_defaults(p_org_id uuid, p_vertical text default 'construction', p_mode text default 'skip_existing')
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare s jsonb;
begin
  if auth.uid() is not null and not public.fh_is_org_manager(p_org_id) then raise exception 'not allowed'; end if;
  select snapshot into s from public.fh_snapshot_library where vertical = p_vertical order by updated_at desc limit 1;
  if s is null then raise exception 'no snapshot for vertical %', p_vertical; end if;
  insert into public.fh_org_settings (org_id, vertical) values (p_org_id, p_vertical) on conflict (org_id) do update set vertical = excluded.vertical;
  return public.fh_snapshot_import(p_org_id, s, p_mode);
end $$;

-- ---------------------------------------------------------------------------
-- 2. client context for the app
-- ---------------------------------------------------------------------------
create or replace function public.fh_client_ctx_app(p_client_id uuid, p_contact_id uuid default null, p_event jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_org uuid;
begin
  select org_id into v_org from public.fh_clients where id = p_client_id;
  if v_org is null then raise exception 'client not found'; end if;
  if auth.uid() is not null and not public.fh_is_org_member(v_org) then raise exception 'not allowed'; end if;
  return public.fh_client_ctx(p_client_id, p_contact_id, coalesce(p_event, '{}'::jsonb));
end $$;
revoke all on function public.fh_client_ctx_app(uuid, uuid, jsonb) from public, anon;
grant execute on function public.fh_client_ctx_app(uuid, uuid, jsonb) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- 3. realtime publication (skipped where the publication does not exist, e.g. the local sandbox)
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'no supabase_realtime publication here, skipping';
    return;
  end if;
  foreach t in array array['fh_messages','fh_conversations','fh_agent_runs','fh_workflow_runs','fh_appointments','fh_notifications'] loop
    if to_regclass('public.' || t) is not null
       and not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

