-- Migration 035 — auto-populate org_id on insert
--
-- Phase A.1 of the multi-tenant pivot. Migrations 032 and 034 added
-- an org_id column to every public.fh_* table and rewrote RLS to
-- filter by org_id. App code still inserts with user_id only. This
-- migration installs a BEFORE INSERT trigger that copies org_id from
-- the inserting user's active org_members row whenever NEW.org_id IS
-- NULL — so existing app code keeps working unchanged, but new rows
-- become visible to the user's org instead of orphaned with NULL.
--
-- Behavior:
--   - NEW.org_id provided  → trigger leaves it alone (edge function
--                            paths can still target a specific org).
--   - NEW.org_id NULL +
--     inserting user has   → trigger fills in their most-recently
--     an active membership   joined non-revoked membership.
--   - NEW.org_id NULL +
--     no membership        → trigger leaves NULL, the row will fail
--                            the org-scoped RLS check (intentional —
--                            signup must create an org_members row
--                            BEFORE any fh_* insert; that's already
--                            handled for current users via the
--                            migration 032 backfill).
--
-- SECURITY DEFINER is required so the trigger can read org_members
-- past the row-level policy on its own session. The function pins
-- search_path = pg_catalog,public for injection safety.
--
-- Idempotent. Safe to re-run.

-- ============================================================
-- 1. SHARED TRIGGER FUNCTION
-- ============================================================

create or replace function public.fh_set_org_id()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $fn$
declare
  v_org_id uuid;
begin
  -- If the caller already supplied an org_id, respect it. Edge
  -- functions and admin tools may need to write to a specific tenant.
  if new.org_id is not null then
    return new;
  end if;

  -- Service-role / unauthenticated contexts have a NULL auth.uid().
  -- Leave org_id NULL in that case; the caller must set it explicitly.
  if auth.uid() is null then
    return new;
  end if;

  select om.org_id
    into v_org_id
    from public.org_members om
   where om.user_id    = auth.uid()
     and om.revoked_at is null
   order by om.joined_at desc
   limit 1;

  if v_org_id is not null then
    new.org_id := v_org_id;
  end if;

  return new;
end
$fn$;

comment on function public.fh_set_org_id() is
  'BEFORE INSERT trigger: copies org_id from auth.uid()''s active org_members row when NEW.org_id IS NULL. Installed on every fh_* + profiles table by migration 035.';

-- ============================================================
-- 2. ATTACH TRIGGER TO EVERY TABLE WITH AN org_id COLUMN
-- ============================================================
-- Discovery: only attach where the column actually exists. Migration
-- 034 added org_id to a known list; we re-query information_schema so
-- this migration is self-correcting if new fh_* tables are added
-- later with their own org_id column.

do $$
declare
  rec record;
begin
  for rec in
    select c.table_schema, c.table_name
      from information_schema.columns c
     where c.table_schema = 'public'
       and c.column_name  = 'org_id'
       and (c.table_name like 'fh_%' or c.table_name = 'profiles')
  loop
    -- Drop-and-recreate so re-runs converge. Trigger name is fixed
    -- per table so multiple migrations of this kind never compound.
    execute format(
      'drop trigger if exists fh_set_org_id_trg on %I.%I',
      rec.table_schema, rec.table_name
    );
    execute format(
      'create trigger fh_set_org_id_trg
         before insert on %I.%I
         for each row execute function public.fh_set_org_id()',
      rec.table_schema, rec.table_name
    );
  end loop;
end $$;
