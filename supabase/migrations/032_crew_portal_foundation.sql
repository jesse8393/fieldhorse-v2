-- Migration 032 — CREW PORTAL FOUNDATION (Phase 1 of the multi-tenant pivot)
--
-- See docs/CREW_PORTAL_PLAN.md for the full design. This file does Phase 1
-- only: stand up the tenancy tables, add a nullable org_id everywhere,
-- backfill one organization per existing user. No RLS policy is rewritten
-- in this migration — every existing table continues to filter by user_id.
--
-- Effect on current users: zero. The org_id columns are populated but no
-- code reads them yet. Old RLS still in force. Phase 2 (next PR) flips RLS
-- to org_id. If you want to abort after applying this, drop the new tables
-- and drop the org_id columns — no application code references them.
--
-- Idempotent. Safe to re-run.

-- ============================================================
-- 1. ROLE ENUM
-- ============================================================

do $$
begin
  if not exists (select 1 from pg_type where typname = 'org_role') then
    create type public.org_role as enum (
      'owner',     -- everything, including billing + delete
      'admin',     -- everything except billing + delete
      'manager',   -- their crews + their jobs, financials visible
      'foreman',   -- their crews + their jobs, financials hidden
      'crew'       -- own shifts, own time, own tasks only
    );
  end if;
end$$;

-- No 'sub' role. Recurring subs the owner brings on the team are org_members
-- with whatever role the owner picks. Vendor subs stay on fh_subs /
-- fh_sub_profiles. One-off scoped invites stay on fh_job_partners.

-- ============================================================
-- 2. NEW TABLES
-- ============================================================

create table if not exists public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text unique,
  billing_email text,
  created_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.org_members (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.org_role not null default 'crew',
  invited_by uuid references auth.users(id) on delete set null,
  joined_at timestamptz not null default now(),
  revoked_at timestamptz,
  unique (org_id, user_id)
);

create table if not exists public.org_invites (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  email text not null,
  role public.org_role not null default 'crew',
  token text not null unique,
  invited_by uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '14 days'),
  accepted_at timestamptz,
  accepted_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_org_members_user_id on public.org_members(user_id);
create index if not exists idx_org_members_org_id on public.org_members(org_id);
create index if not exists idx_org_invites_token on public.org_invites(token);
create index if not exists idx_org_invites_email on public.org_invites(email);

-- ============================================================
-- 3. HELPER FUNCTION
-- ============================================================
--
-- Returns the set of org_ids the current auth user belongs to (active
-- memberships only). Phase 2 RLS policies will key off this. Defined now
-- so it's available for Phase 1 verification queries and so Phase 2 can
-- introduce policies in one atomic apply.
--
-- SECURITY DEFINER + locked search_path: standard hardening per audit
-- finding FH-049. Safe because the function reads only the caller's own
-- memberships from auth.uid() — no external input.

create or replace function public.auth_user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select org_id
  from public.org_members
  where user_id = auth.uid()
    and revoked_at is null
$$;

revoke execute on function public.auth_user_org_ids() from public;
grant execute on function public.auth_user_org_ids() to authenticated;

-- ============================================================
-- 4. RLS ON NEW TABLES
-- ============================================================
--
-- Conservative for Phase 1: members see their own org rows; owners can
-- write to invites + members of their own org. Phase 3 layers the team-
-- settings UI on top of this. Nothing else in the app touches these tables
-- in Phase 1.

alter table public.organizations enable row level security;
alter table public.org_members enable row level security;
alter table public.org_invites enable row level security;

drop policy if exists "orgs_member_read" on public.organizations;
create policy "orgs_member_read"
  on public.organizations for select
  using (id in (select public.auth_user_org_ids()));

drop policy if exists "orgs_owner_write" on public.organizations;
create policy "orgs_owner_write"
  on public.organizations for update
  using (
    exists (
      select 1 from public.org_members m
      where m.org_id = organizations.id
        and m.user_id = auth.uid()
        and m.role = 'owner'
        and m.revoked_at is null
    )
  )
  with check (
    exists (
      select 1 from public.org_members m
      where m.org_id = organizations.id
        and m.user_id = auth.uid()
        and m.role = 'owner'
        and m.revoked_at is null
    )
  );

drop policy if exists "org_members_self_read" on public.org_members;
create policy "org_members_self_read"
  on public.org_members for select
  using (
    user_id = auth.uid()
    or org_id in (select public.auth_user_org_ids())
  );

drop policy if exists "org_members_owner_admin_write" on public.org_members;
create policy "org_members_owner_admin_write"
  on public.org_members for all
  using (
    exists (
      select 1 from public.org_members m
      where m.org_id = org_members.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
        and m.revoked_at is null
    )
  )
  with check (
    exists (
      select 1 from public.org_members m
      where m.org_id = org_members.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
        and m.revoked_at is null
    )
  );

drop policy if exists "org_invites_admin_read_write" on public.org_invites;
create policy "org_invites_admin_read_write"
  on public.org_invites for all
  using (
    exists (
      select 1 from public.org_members m
      where m.org_id = org_invites.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
        and m.revoked_at is null
    )
  )
  with check (
    exists (
      select 1 from public.org_members m
      where m.org_id = org_invites.org_id
        and m.user_id = auth.uid()
        and m.role in ('owner', 'admin')
        and m.revoked_at is null
    )
  );

-- ============================================================
-- 5. ADD ORG_ID TO EVERY EXISTING TABLE
-- ============================================================
--
-- 26 tables have user_id. fh_job_partners has invited_by_user_id (we'll
-- backfill org_id via that). fh_integration_secrets has integration_id
-- (we'll backfill via fh_integrations). All nullable for Phase 1;
-- Phase 2 flips to NOT NULL after the backfill is verified clean.

alter table public.profiles               add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_contacts            add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_clients             add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_notes               add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_schedule            add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_subs                add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_expenses            add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_payments            add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_inspections         add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_mileage             add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_job_files           add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_job_todos           add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_notifications       add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_quote_items         add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_quote_versions      add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_sub_profiles        add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_insurance_claims    add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_change_orders       add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_invoices            add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_stage_transitions   add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_estimate_templates  add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_public_links        add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_rate_cards          add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_closeouts           add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_esign_envelopes     add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_integrations        add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_job_partners        add column if not exists org_id uuid references public.organizations(id) on delete cascade;
alter table public.fh_integration_secrets add column if not exists org_id uuid references public.organizations(id) on delete cascade;

-- Indexes on every org_id for RLS perf. RLS checks run per row; without
-- the index a multi-thousand-row scan plus a function call per row gets
-- ugly fast as data grows.

create index if not exists idx_profiles_org_id              on public.profiles(org_id);
create index if not exists idx_fh_contacts_org_id           on public.fh_contacts(org_id);
create index if not exists idx_fh_clients_org_id            on public.fh_clients(org_id);
create index if not exists idx_fh_notes_org_id              on public.fh_notes(org_id);
create index if not exists idx_fh_schedule_org_id           on public.fh_schedule(org_id);
create index if not exists idx_fh_subs_org_id               on public.fh_subs(org_id);
create index if not exists idx_fh_expenses_org_id           on public.fh_expenses(org_id);
create index if not exists idx_fh_payments_org_id           on public.fh_payments(org_id);
create index if not exists idx_fh_inspections_org_id        on public.fh_inspections(org_id);
create index if not exists idx_fh_mileage_org_id            on public.fh_mileage(org_id);
create index if not exists idx_fh_job_files_org_id          on public.fh_job_files(org_id);
create index if not exists idx_fh_job_todos_org_id          on public.fh_job_todos(org_id);
create index if not exists idx_fh_notifications_org_id      on public.fh_notifications(org_id);
create index if not exists idx_fh_quote_items_org_id        on public.fh_quote_items(org_id);
create index if not exists idx_fh_quote_versions_org_id     on public.fh_quote_versions(org_id);
create index if not exists idx_fh_sub_profiles_org_id       on public.fh_sub_profiles(org_id);
create index if not exists idx_fh_insurance_claims_org_id   on public.fh_insurance_claims(org_id);
create index if not exists idx_fh_change_orders_org_id      on public.fh_change_orders(org_id);
create index if not exists idx_fh_invoices_org_id           on public.fh_invoices(org_id);
create index if not exists idx_fh_stage_transitions_org_id  on public.fh_stage_transitions(org_id);
create index if not exists idx_fh_estimate_templates_org_id on public.fh_estimate_templates(org_id);
create index if not exists idx_fh_public_links_org_id       on public.fh_public_links(org_id);
create index if not exists idx_fh_rate_cards_org_id         on public.fh_rate_cards(org_id);
create index if not exists idx_fh_closeouts_org_id          on public.fh_closeouts(org_id);
create index if not exists idx_fh_esign_envelopes_org_id    on public.fh_esign_envelopes(org_id);
create index if not exists idx_fh_integrations_org_id       on public.fh_integrations(org_id);
create index if not exists idx_fh_job_partners_org_id       on public.fh_job_partners(org_id);
create index if not exists idx_fh_integration_secrets_org_id on public.fh_integration_secrets(org_id);

-- ============================================================
-- 6. BACKFILL
-- ============================================================
--
-- Order matters: orgs → members → profiles.org_id → user-scoped tables →
-- fh_job_partners → fh_integration_secrets (depends on fh_integrations).
--
-- Idempotent: every step is "where org_id is null" or "on conflict do
-- nothing" so re-running is a no-op once everything's populated.

-- 6a. One organization per existing auth user. Name from profile, fallback.
insert into public.organizations (name, created_by)
select coalesce(nullif(trim(p.company_name), ''), 'My Company'), u.id
from auth.users u
left join public.profiles p on p.user_id = u.id
where not exists (
  select 1 from public.organizations o where o.created_by = u.id
);

-- 6b. Owner membership for each org's creator.
insert into public.org_members (org_id, user_id, role, joined_at)
select o.id, o.created_by, 'owner'::public.org_role, o.created_at
from public.organizations o
where not exists (
  select 1 from public.org_members m
  where m.org_id = o.id and m.user_id = o.created_by
);

-- 6c. Profile rows get the owner's org.
update public.profiles
   set org_id = o.id
  from public.organizations o
 where o.created_by = profiles.user_id
   and profiles.org_id is null;

-- 6d. Every user-scoped table.
update public.fh_contacts            set org_id = o.id from public.organizations o where o.created_by = fh_contacts.user_id            and fh_contacts.org_id            is null;
update public.fh_clients             set org_id = o.id from public.organizations o where o.created_by = fh_clients.user_id             and fh_clients.org_id             is null;
update public.fh_notes               set org_id = o.id from public.organizations o where o.created_by = fh_notes.user_id               and fh_notes.org_id               is null;
update public.fh_schedule            set org_id = o.id from public.organizations o where o.created_by = fh_schedule.user_id            and fh_schedule.org_id            is null;
update public.fh_subs                set org_id = o.id from public.organizations o where o.created_by = fh_subs.user_id                and fh_subs.org_id                is null;
update public.fh_expenses            set org_id = o.id from public.organizations o where o.created_by = fh_expenses.user_id            and fh_expenses.org_id            is null;
update public.fh_payments            set org_id = o.id from public.organizations o where o.created_by = fh_payments.user_id            and fh_payments.org_id            is null;
update public.fh_inspections         set org_id = o.id from public.organizations o where o.created_by = fh_inspections.user_id         and fh_inspections.org_id         is null;
update public.fh_mileage             set org_id = o.id from public.organizations o where o.created_by = fh_mileage.user_id             and fh_mileage.org_id             is null;
update public.fh_job_files           set org_id = o.id from public.organizations o where o.created_by = fh_job_files.user_id           and fh_job_files.org_id           is null;
update public.fh_job_todos           set org_id = o.id from public.organizations o where o.created_by = fh_job_todos.user_id           and fh_job_todos.org_id           is null;
update public.fh_notifications       set org_id = o.id from public.organizations o where o.created_by = fh_notifications.user_id       and fh_notifications.org_id       is null;
update public.fh_quote_items         set org_id = o.id from public.organizations o where o.created_by = fh_quote_items.user_id         and fh_quote_items.org_id         is null;
update public.fh_quote_versions      set org_id = o.id from public.organizations o where o.created_by = fh_quote_versions.user_id      and fh_quote_versions.org_id      is null;
update public.fh_sub_profiles        set org_id = o.id from public.organizations o where o.created_by = fh_sub_profiles.user_id        and fh_sub_profiles.org_id        is null;
update public.fh_insurance_claims    set org_id = o.id from public.organizations o where o.created_by = fh_insurance_claims.user_id    and fh_insurance_claims.org_id    is null;
update public.fh_change_orders       set org_id = o.id from public.organizations o where o.created_by = fh_change_orders.user_id       and fh_change_orders.org_id       is null;
update public.fh_invoices            set org_id = o.id from public.organizations o where o.created_by = fh_invoices.user_id            and fh_invoices.org_id            is null;
update public.fh_stage_transitions   set org_id = o.id from public.organizations o where o.created_by = fh_stage_transitions.user_id   and fh_stage_transitions.org_id   is null;
update public.fh_estimate_templates  set org_id = o.id from public.organizations o where o.created_by = fh_estimate_templates.user_id  and fh_estimate_templates.org_id  is null;
update public.fh_public_links        set org_id = o.id from public.organizations o where o.created_by = fh_public_links.user_id        and fh_public_links.org_id        is null;
update public.fh_rate_cards          set org_id = o.id from public.organizations o where o.created_by = fh_rate_cards.user_id          and fh_rate_cards.org_id          is null;
update public.fh_closeouts           set org_id = o.id from public.organizations o where o.created_by = fh_closeouts.user_id           and fh_closeouts.org_id           is null;
update public.fh_esign_envelopes     set org_id = o.id from public.organizations o where o.created_by = fh_esign_envelopes.user_id     and fh_esign_envelopes.org_id     is null;
update public.fh_integrations        set org_id = o.id from public.organizations o where o.created_by = fh_integrations.user_id        and fh_integrations.org_id        is null;

-- 6e. fh_job_partners — no user_id, but invited_by_user_id is the owner.
update public.fh_job_partners
   set org_id = o.id
  from public.organizations o
 where o.created_by = fh_job_partners.invited_by_user_id
   and fh_job_partners.org_id is null;

-- 6f. fh_integration_secrets — no user_id, but integration_id → fh_integrations.org_id.
--     Must run AFTER 6d's update to fh_integrations.
update public.fh_integration_secrets
   set org_id = i.org_id
  from public.fh_integrations i
 where i.id = fh_integration_secrets.integration_id
   and i.org_id is not null
   and fh_integration_secrets.org_id is null;

-- ============================================================
-- 7. updated_at TRIGGER FOR organizations
-- ============================================================
--
-- Use the existing fh_touch_updated_at function (defined in earlier
-- migrations) so the touch behavior is consistent with every other table.

drop trigger if exists organizations_touch on public.organizations;
create trigger organizations_touch
  before update on public.organizations
  for each row execute function public.fh_touch_updated_at();

-- ============================================================
-- VERIFICATION (run manually after apply)
-- ============================================================
--
-- After applying, every one of these should return zero. Any non-zero
-- result means a row was missed by the backfill and Phase 2 would orphan
-- that data.
--
--   select count(*) from public.profiles               where org_id is null;
--   select count(*) from public.fh_contacts            where org_id is null;
--   select count(*) from public.fh_clients             where org_id is null;
--   select count(*) from public.fh_notes               where org_id is null;
--   select count(*) from public.fh_schedule            where org_id is null;
--   select count(*) from public.fh_subs                where org_id is null;
--   select count(*) from public.fh_expenses            where org_id is null;
--   select count(*) from public.fh_payments            where org_id is null;
--   select count(*) from public.fh_job_files           where org_id is null;
--   select count(*) from public.fh_job_todos           where org_id is null;
--   select count(*) from public.fh_notifications       where org_id is null;
--   select count(*) from public.fh_quote_items         where org_id is null;
--   select count(*) from public.fh_quote_versions      where org_id is null;
--   select count(*) from public.fh_stage_transitions   where org_id is null;
--   select count(*) from public.fh_job_partners        where org_id is null;
--
-- And sanity-check the org count matches user count:
--   select (select count(*) from auth.users) as users, (select count(*) from public.organizations) as orgs;
--
-- If everything's zero, Phase 2 is safe to author.
