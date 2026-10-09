-- 062 — Tenant boundary hardening (full audit, 2026-10-09)
--
-- Applied to production pnmhblvslftdzfcdezbw on 2026-10-09 and verified
-- with rolled back probes run as real users (an outside owner, an
-- accepted partner, and the service role). This file is the exact
-- mirror. Every statement is idempotent and avoids DROP so it can be
-- re-run safely; policies are changed with ALTER POLICY and new ones are
-- created behind an existence check.
--
-- A. Child rows inherit org_id from their parent job.
--    Every table keyed by contact_id or job_id gets org_id copied from the
--    parent fh_contacts row by a SECURITY DEFINER trigger that fires after
--    fh_set_org_id (BEFORE triggers run in name order, hence "zz_"). RLS
--    WITH CHECK runs on the final row, so a caller who references a job
--    in an org they do not belong to is rejected by the existing org_id
--    policies, and partner writes (allowed by the partner clauses on
--    notes, todos, files, schedule, payments, expenses, inspections,
--    subs, quote items and quote versions) land in the job owner's org
--    where the owner can see them. Closes:
--      * cross org contract amount rewrites through
--        fn_recalc_contact_amount_from_items (an attacker's quote item for
--        a victim's job used to pass WITH CHECK because only the item's
--        own org_id, stamped to the attacker's org, was checked);
--      * wrong org stamping for users who belong to more than one org
--        (fh_set_org_id picks the newest membership; the parent job wins);
--      * NULL org_id on rows written by service role functions
--        (public-link-approve, partner-invite, notifications) which made
--        them invisible under org scoped RLS.
--
-- B. fh_job_partners: no more self granted partner access.
--    The FOR ALL policy accepted any row whose partner_user_id was the
--    caller, so any signed in user could insert status = 'accepted' for
--    any job id and unlock fh_contacts, fh_quote_items and storage reads
--    through the partner clauses. The job id is not secret (public-link
--    returns it to every proposal viewer). Writes are now reserved for
--    members of the job's org; partners keep read access to their own
--    rows. Invite and accept run with the service role and are unaffected.
--
-- C. fh_contacts: partners cannot move a shared job to another tenant.
--    fh_contacts_upd lets an accepted partner update the row and its WITH
--    CHECK is satisfied by the partner clause, so org_id and user_id could
--    be reassigned. A trigger now rejects changes to those columns unless
--    the caller belongs to the job's current org (service role exempt).
--
-- D. Stage transition logging runs as definer. The audit insert used to
--    run with the caller's rights; with org_id now inherited from the job,
--    a partner's stage change would have been rejected by the org only
--    insert policy on fh_stage_transitions.
--
-- E. fh_fill_invite_token: migration 043 pinned its search_path to
--    pg_catalog, public, which hid pgcrypto (installed in the "extensions"
--    schema on Supabase). Every partner invite insert failed with
--    "function gen_random_bytes(integer) does not exist" from 2026-05-29
--    until this migration. The call is now schema qualified.
--
-- F. fh_emit_event: signed in callers may only emit into their own orgs
--    (the function exists only in the production database, so the change
--    is guarded; trigger originated calls keep working).
--
-- G. search_path pins lost since 043: fh_clients_recompute (recreated by
--    059 without the pin), fn_recalc_contact_amount_from_items,
--    fn_approve_quote_version.
--
-- H. anon loses all table and sequence privileges in public. Every public
--    endpoint already runs with the service role; RLS was the only barrier.
--
-- I. Repository repair: create_own_org (Onboarding depends on it,
--    previously only in the live database).

-- ---------------------------------------------------------------------
-- A. inherit org_id from the parent job
-- ---------------------------------------------------------------------
create or replace function public.fh_inherit_org_from_contact()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_row    jsonb := to_jsonb(new);
  v_parent uuid;
  v_org    uuid;
begin
  v_parent := coalesce(
    nullif(v_row ->> 'contact_id', '')::uuid,
    nullif(v_row ->> 'job_id', '')::uuid
  );
  if v_parent is null then
    return new;
  end if;
  select c.org_id into v_org from public.fh_contacts c where c.id = v_parent;
  if v_org is not null then
    new.org_id := v_org;
  end if;
  return new;
end
$$;

revoke execute on function public.fh_inherit_org_from_contact() from public, anon, authenticated;

do $$
declare
  t   text;
  col text;
begin
  for t in
    select unnest(array[
      'fh_change_orders', 'fh_closeouts', 'fh_daily_logs', 'fh_esign_envelopes',
      'fh_expenses', 'fh_inspections', 'fh_insurance_claims', 'fh_invoices',
      'fh_job_files', 'fh_job_partners', 'fh_job_todos', 'fh_materials',
      'fh_mileage', 'fh_notes', 'fh_payments', 'fh_public_links',
      'fh_quote_items', 'fh_quote_versions', 'fh_schedule', 'fh_selections',
      'fh_stage_transitions', 'fh_subs', 'fh_time_punches',
      'fh_follow_ups', 'fh_public_link_events',
      'fh_agent_runs', 'fh_appointments', 'fh_events', 'fh_form_submissions',
      'fh_messages', 'fh_review_requests', 'fh_workflow_runs'
    ])
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    if not exists (
      select 1 from information_schema.columns
      where table_schema = 'public' and table_name = t and column_name = 'org_id'
    ) then
      continue;
    end if;
    col := null;
    select column_name into col
      from information_schema.columns
     where table_schema = 'public' and table_name = t
       and column_name in ('contact_id', 'job_id')
     order by case column_name when 'contact_id' then 0 else 1 end
     limit 1;
    if col is null then
      continue;
    end if;
    execute format(
      'create or replace trigger zz_inherit_org_from_contact before insert or update of %I, org_id on public.%I for each row execute function public.fh_inherit_org_from_contact()',
      col, t
    );
  end loop;
end
$$;

-- Backfill the rows the invoker rights stage transition trigger left
-- without an org (3 rows in production).
update public.fh_stage_transitions s
   set org_id = c.org_id
  from public.fh_contacts c
 where s.contact_id = c.id and s.org_id is null and c.org_id is not null;

-- ---------------------------------------------------------------------
-- B. fh_job_partners policies
-- ---------------------------------------------------------------------
alter policy "fh_job_partners_own" on public.fh_job_partners
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'fh_job_partners'
       and policyname = 'fh_job_partners_partner_read'
  ) then
    execute $p$
      create policy "fh_job_partners_partner_read" on public.fh_job_partners
        for select to authenticated
        using (partner_user_id = (select auth.uid()))
    $p$;
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- C. fh_contacts tenant columns are immutable for partners
-- ---------------------------------------------------------------------
create or replace function public.fh_contacts_guard_tenant_columns()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null then
    return new;  -- service role / trusted server code
  end if;
  if new.org_id is distinct from old.org_id or new.user_id is distinct from old.user_id then
    if old.org_id is null or not exists (
      select 1 from public.org_members m
       where m.org_id = old.org_id
         and m.user_id = auth.uid()
         and m.revoked_at is null
    ) then
      raise exception 'not allowed: only members of the owning org may reassign a job'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

revoke execute on function public.fh_contacts_guard_tenant_columns() from public, anon, authenticated;

create or replace trigger fh_contacts_guard_tenant_columns
  before update of org_id, user_id on public.fh_contacts
  for each row execute function public.fh_contacts_guard_tenant_columns();

-- ---------------------------------------------------------------------
-- D. stage transition logging runs as definer
-- ---------------------------------------------------------------------
alter function public.fh_stage_transitions_log() security definer;
alter function public.fh_stage_transitions_log_insert() security definer;
revoke execute on function public.fh_stage_transitions_log() from public, anon, authenticated;
revoke execute on function public.fh_stage_transitions_log_insert() from public, anon, authenticated;

-- ---------------------------------------------------------------------
-- E. partner invite token generator
-- ---------------------------------------------------------------------
create or replace function public.fh_fill_invite_token()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  -- pgcrypto lives in the "extensions" schema on Supabase. Migration 043
  -- pinned this function's search_path to pg_catalog, public, which hid
  -- gen_random_bytes and broke every partner invite insert from
  -- 2026-05-29 until 2026-10-09. Qualify the call instead of widening
  -- the search path.
  if new.invite_token is null then
    new.invite_token := encode(extensions.gen_random_bytes(24), 'hex');
  end if;
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- F. fh_emit_event tenant guard (live only object, guarded)
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.fh_emit_event(uuid,text,uuid,uuid,jsonb,text,text)') is not null
     and to_regprocedure('public.fh_is_org_member(uuid)') is not null
     and to_regprocedure('public.fh_engine_enabled(uuid)') is not null then
    execute $f$
      create or replace function public.fh_emit_event(
        p_org_id uuid, p_type text,
        p_client_id uuid default null, p_contact_id uuid default null,
        p_payload jsonb default '{}'::jsonb, p_source text default 'system',
        p_dedupe_key text default null
      )
      returns uuid
      language plpgsql
      security definer
      set search_path to 'pg_catalog', 'public'
      as $body$
      declare v_id uuid;
      begin
        if p_org_id is null or not public.fh_engine_enabled(p_org_id) then
          return null;
        end if;
        -- Tenant guard (audit 2026-10-09). Direct RPC callers must belong to
        -- the org. Calls that originate inside a trigger were already
        -- authorised by RLS on the row that fired them (partners editing a
        -- shared job included), so they are exempt.
        if pg_trigger_depth() = 0 and auth.uid() is not null
           and not public.fh_is_org_member(p_org_id) then
          raise exception 'not allowed' using errcode = '42501';
        end if;
        if coalesce(current_setting('fh.suppress_events', true), '') = 'on' then
          return null;
        end if;
        insert into public.fh_events (org_id, type, client_id, contact_id, payload, source, dedupe_key)
        values (p_org_id, p_type, p_client_id, p_contact_id,
                coalesce(p_payload, '{}'::jsonb), coalesce(p_source, 'system'), p_dedupe_key)
        on conflict (dedupe_key) do nothing
        returning id into v_id;
        return v_id;
      end
      $body$
    $f$;
  end if;
  if to_regprocedure('public.fh_follow_up_settings_seed()') is not null then
    execute 'revoke execute on function public.fh_follow_up_settings_seed() from public, anon, authenticated';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- G. search_path pins
-- ---------------------------------------------------------------------
do $$
begin
  if to_regprocedure('public.fh_clients_recompute(uuid)') is not null then
    execute 'alter function public.fh_clients_recompute(uuid) set search_path = pg_catalog, public';
  end if;
  if to_regprocedure('public.fn_recalc_contact_amount_from_items()') is not null then
    execute 'alter function public.fn_recalc_contact_amount_from_items() set search_path = pg_catalog, public';
  end if;
  if to_regprocedure('public.fn_approve_quote_version(uuid,uuid,jsonb,numeric,numeric,integer,text,text,text,text,text,text)') is not null then
    execute 'alter function public.fn_approve_quote_version(uuid,uuid,jsonb,numeric,numeric,integer,text,text,text,text,text,text) set search_path = pg_catalog, public';
  end if;
end
$$;

-- ---------------------------------------------------------------------
-- H. anon has no business touching tables directly
-- ---------------------------------------------------------------------
revoke all on all tables in schema public from anon;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;

-- ---------------------------------------------------------------------
-- I. repository repair: create_own_org
-- ---------------------------------------------------------------------
create or replace function public.create_own_org(p_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid;
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not authenticated';
  end if;

  select org_id into v_org
    from public.org_members
   where user_id = v_uid and revoked_at is null
   order by joined_at desc
   limit 1;

  if v_org is not null then
    return v_org;
  end if;

  insert into public.organizations (name, created_by)
  values (coalesce(nullif(trim(p_name), ''), 'My Company'), v_uid)
  returning id into v_org;

  insert into public.org_members (org_id, user_id, role)
  values (v_org, v_uid, 'owner'::public.org_role);

  return v_org;
end
$$;

revoke execute on function public.create_own_org(text) from public, anon;
grant execute on function public.create_own_org(text) to authenticated, service_role;
