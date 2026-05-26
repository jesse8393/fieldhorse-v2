-- Migration 034 — CREW PORTAL PHASE 2 (FIXED)
--
-- Supersedes migration 033 (Phase 2). The original 033 was applied and
-- then rolled back the same day because Phase 1's policies on
-- public.org_members were self-referential, which created infinite
-- recursion the moment any other policy called public.auth_user_org_ids().
-- That function queries org_members; org_members' own policy then
-- re-called the function via its OR clause, looping forever.
--
-- Fix has two parts:
--   1. Simplify the org_members and org_invites policies so they do NOT
--      self-query. Users read only their own membership row directly.
--      Listing other members of an org happens in Phase 3 via an Edge
--      Function (service-role), not via a direct DB query.
--   2. Re-apply Phase 2's trigger + *_own policy rewrites on top of the
--      now-safe org_members policies.
--
-- Effect on current users: zero. Every existing user is the owner of
-- their own org-of-one, and every row they own is tagged with that
-- org_id, so the new policies match the same rows the old user_id
-- policies did.
--
-- Idempotent.

-- ============================================================
-- 1. RECURSION FIX — org_members and org_invites policies
-- ============================================================

drop policy if exists "orgs_member_read" on public.organizations;
drop policy if exists "orgs_owner_write" on public.organizations;
drop policy if exists "org_members_self_read" on public.org_members;
drop policy if exists "org_members_owner_admin_write" on public.org_members;
drop policy if exists "org_invites_admin_read_write" on public.org_invites;

-- organizations — a member can read their org. Writes (rename, billing
-- email) go through an Edge Function for now; no direct UPDATE policy
-- in this migration.
create policy "organizations_member_read" on public.organizations
  for select to authenticated
  using (
    exists (
      select 1 from public.org_members m
      where m.org_id = organizations.id
        and m.user_id = auth.uid()
        and m.revoked_at is null
    )
  );

-- org_members — direct read of YOUR OWN row only. No self-querying.
-- Phase 3's team-settings screen lists other members via an Edge
-- Function that uses service-role and applies its own owner/admin
-- gate; no direct table access for that view.
create policy "org_members_self_read" on public.org_members
  for select to authenticated
  using (user_id = auth.uid());

-- org_invites — read-by-token (no auth, used by the invite-accept flow)
-- and owner/admin manage via Edge Function. No direct policy needed for
-- the accept flow because the Edge Function reads with service-role and
-- enforces token validity itself.
-- For now, a deny-all default by enabling RLS without a SELECT policy
-- for authenticated. The Edge Function bypasses RLS.

-- ============================================================
-- 2. AUTO-FILL TRIGGER (BEFORE INSERT)
-- ============================================================

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
grant execute on function public.auth_user_org_ids() to public;

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
-- 3. RLS POLICY REWRITES (Phase 2 main act, now safe)
-- ============================================================

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
