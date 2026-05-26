-- Migration 033 — CREW PORTAL PHASE 2 (RLS flip from user_id to org_id)
--
-- See docs/CREW_PORTAL_PLAN.md. Phase 1 (migration 032) stood up the
-- tenancy tables and backfilled org_id on every user-scoped row.
-- Phase 2 rewrites every *_own RLS policy to filter by org_id instead
-- of user_id.
--
-- Effect on current users: zero. Every existing user is the owner of
-- their own org-of-one, and every row they own has been tagged with that
-- org_id. So `org_id IN (their_org_ids)` matches exactly the same rows
-- `user_id = auth.uid()` matched before.
--
-- What this DOES NOT change:
--   - Partner policies (*_partner, *_partner_read, *_partner_write):
--     these grant access via fh_job_partners invite and are orthogonal
--     to org scoping. Left intact so partners still see jobs they were
--     invited to, even across orgs.
--   - profiles policies: per-user data (name, settings). Stays scoped
--     to user_id.
--   - fh_integration_secrets: no policies (deny-all to non-service-role).
--     Service-role bypasses RLS for the netlify functions that read it.
--
-- What is deferred to a later phase:
--   - Flipping org_id to NOT NULL. The trigger below auto-fills org_id
--     for authenticated inserts, but service-role inserts from Netlify
--     functions still leave org_id null. Once those functions are
--     audited and updated to set org_id explicitly, a follow-up
--     migration flips NOT NULL.
--
-- Idempotent. Safe to re-run.

-- ============================================================
-- 1. AUTO-FILL TRIGGER (BEFORE INSERT)
-- ============================================================
--
-- If a user inserts a row without org_id, populate it from the user's
-- first active org membership. This means existing app code that does
-- `insert ... (user_id, ...)` without `org_id` keeps working: the trigger
-- fills the gap. Explicit org_id on the row wins (idempotent if already
-- set).
--
-- For service-role inserts (Netlify Functions) auth.uid() is null, so
-- the trigger leaves org_id null. Those callers must set org_id
-- explicitly — to be audited in a follow-up.

create or replace function public.fh_auto_set_org_id()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if NEW.org_id is not null then
    return NEW;
  end if;

  select org_id into NEW.org_id
  from public.org_members
  where user_id = auth.uid()
    and revoked_at is null
  limit 1;

  return NEW;
end$$;

revoke execute on function public.fh_auto_set_org_id() from public;
grant execute on function public.fh_auto_set_org_id() to authenticated;

-- Grant the org-membership helper to public so policies on any role can
-- evaluate it. Anon callers get an empty set (auth.uid() is null), so
-- exposure is nil.
grant execute on function public.auth_user_org_ids() to public;

-- Attach the trigger to every user-scoped table with an org_id column.
-- fh_job_partners is special-cased below (has no user_id but does have
-- invited_by_user_id, which is also auth.uid() at insert time, so the
-- trigger works for it too).

do $$
declare
  t text;
  trigger_targets text[] := array[
    'profiles','fh_contacts','fh_clients','fh_notes','fh_schedule',
    'fh_subs','fh_expenses','fh_payments','fh_inspections','fh_mileage',
    'fh_job_files','fh_job_todos','fh_notifications','fh_quote_items',
    'fh_quote_versions','fh_sub_profiles','fh_insurance_claims',
    'fh_change_orders','fh_invoices','fh_stage_transitions',
    'fh_estimate_templates','fh_public_links','fh_rate_cards',
    'fh_closeouts','fh_esign_envelopes','fh_integrations',
    'fh_job_partners'
  ];
begin
  foreach t in array trigger_targets loop
    execute format('drop trigger if exists %I on public.%I', t || '_auto_org', t);
    execute format(
      'create trigger %I before insert on public.%I for each row execute function public.fh_auto_set_org_id()',
      t || '_auto_org', t
    );
  end loop;
end$$;

-- ============================================================
-- 2. RLS POLICY REWRITES
-- ============================================================
--
-- Pattern: drop the existing user_id-based *_own policy, recreate with
-- the same name, role, and command but filtering by org_id via the
-- helper function. Partner policies are untouched.

-- ---- authenticated-role tables ----

drop policy if exists "fh_contacts_own" on public.fh_contacts;
create policy "fh_contacts_own" on public.fh_contacts for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_clients_own" on public.fh_clients;
create policy "fh_clients_own" on public.fh_clients for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_notes_own" on public.fh_notes;
create policy "fh_notes_own" on public.fh_notes for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_schedule_own" on public.fh_schedule;
create policy "fh_schedule_own" on public.fh_schedule for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_subs_own" on public.fh_subs;
create policy "fh_subs_own" on public.fh_subs for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_expenses_own" on public.fh_expenses;
create policy "fh_expenses_own" on public.fh_expenses for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_payments_own" on public.fh_payments;
create policy "fh_payments_own" on public.fh_payments for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_inspections_own" on public.fh_inspections;
create policy "fh_inspections_own" on public.fh_inspections for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_mileage_own" on public.fh_mileage;
create policy "fh_mileage_own" on public.fh_mileage for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_job_files_own" on public.fh_job_files;
create policy "fh_job_files_own" on public.fh_job_files for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_job_todos_own" on public.fh_job_todos;
create policy "fh_job_todos_own" on public.fh_job_todos for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_notifications_own" on public.fh_notifications;
create policy "fh_notifications_own" on public.fh_notifications for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_quote_items_own" on public.fh_quote_items;
create policy "fh_quote_items_own" on public.fh_quote_items for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_quote_versions_own" on public.fh_quote_versions;
create policy "fh_quote_versions_own" on public.fh_quote_versions for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_sub_profiles_own" on public.fh_sub_profiles;
create policy "fh_sub_profiles_own" on public.fh_sub_profiles for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_insurance_claims_own" on public.fh_insurance_claims;
create policy "fh_insurance_claims_own" on public.fh_insurance_claims for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_change_orders_own" on public.fh_change_orders;
create policy "fh_change_orders_own" on public.fh_change_orders for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_invoices_own" on public.fh_invoices;
create policy "fh_invoices_own" on public.fh_invoices for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_stage_transitions_own" on public.fh_stage_transitions;
create policy "fh_stage_transitions_own" on public.fh_stage_transitions for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_estimate_templates_own" on public.fh_estimate_templates;
create policy "fh_estimate_templates_own" on public.fh_estimate_templates for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_public_links_own" on public.fh_public_links;
create policy "fh_public_links_own" on public.fh_public_links for all to authenticated
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

-- ---- public-role tables (preserve original role scope) ----
-- These were created with role `public` rather than `authenticated`.
-- auth_user_org_ids() returns an empty set for anon (auth.uid() is null),
-- so anon callers will still match no rows. Behavior preserved.

drop policy if exists "fh_rate_cards_own" on public.fh_rate_cards;
create policy "fh_rate_cards_own" on public.fh_rate_cards for all
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_closeouts_own" on public.fh_closeouts;
create policy "fh_closeouts_own" on public.fh_closeouts for all
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_esign_envelopes_own" on public.fh_esign_envelopes;
create policy "fh_esign_envelopes_own" on public.fh_esign_envelopes for all
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

drop policy if exists "fh_integrations_own" on public.fh_integrations;
create policy "fh_integrations_own" on public.fh_integrations for all
  using (org_id in (select public.auth_user_org_ids()))
  with check (org_id in (select public.auth_user_org_ids()));

-- ============================================================
-- 3. SPECIAL CASE — fh_job_partners
-- ============================================================
--
-- The original "own" policy granted access via
--   (invited_by_user_id = auth.uid() OR partner_user_id = auth.uid())
-- Org members of the inviting org should also be able to manage these
-- invites for the org's jobs. The partner's own access (via
-- partner_user_id) is preserved.

drop policy if exists "fh_job_partners_own" on public.fh_job_partners;
create policy "fh_job_partners_own" on public.fh_job_partners for all to authenticated
  using (
    org_id in (select public.auth_user_org_ids())
    or partner_user_id = auth.uid()
  )
  with check (
    org_id in (select public.auth_user_org_ids())
    or partner_user_id = auth.uid()
  );

-- ============================================================
-- 4. NOT TOUCHED IN THIS MIGRATION
-- ============================================================
--
-- profiles                       — per-user data, three policies stay as user_id-scoped.
-- fh_integration_secrets         — no policies (deny-all), service-role bypasses RLS.
-- All *_partner / *_partner_read / *_partner_write policies — orthogonal grants via
--   fh_job_partners; left intact so partner invites still work cross-org.
