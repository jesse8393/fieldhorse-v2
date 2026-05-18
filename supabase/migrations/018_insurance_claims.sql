-- =============================================================
-- Migration 018 — INSURANCE CLAIMS
-- =============================================================
--
-- Adds a one-to-one table for insurance-restoration jobs (roofing, water,
-- fire, storm). Kept off fh_contacts so the contact row stays narrow and
-- cash jobs aren't polluted with NULL insurance columns.
--
-- One row per fh_contacts.id, lifecycle bound to the contact via CASCADE
-- delete. Owner-only RLS — partners do NOT see the inviter's insurance
-- payloads (matches the pattern in 007_clients.sql).
--
-- =============================================================

create table if not exists public.fh_insurance_claims (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.fh_contacts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,

  -- Carrier-side identifiers
  claim_number   text,
  carrier        text,
  adjuster       text,

  -- Money — separate columns over jsonb so we can index/sort if we ever
  -- need an "open claims" dashboard. All optional.
  deductible        numeric,   -- customer pays out of pocket
  rcv               numeric,   -- replacement cost value
  acv               numeric,   -- actual cash value
  depreciation      numeric,   -- difference between RCV and ACV
  supplement_amount numeric,   -- supplemental scope filed with carrier

  -- Mortgage co. info for two-party checks
  mortgage_company  text,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  -- One insurance payload per contact. Enforces 1-to-1.
  constraint fh_insurance_claims_contact_unique unique (contact_id)
);

create index if not exists idx_fh_insurance_claims_user
  on public.fh_insurance_claims(user_id);

-- ============================================================
-- RLS — OWNER ONLY
-- ============================================================
alter table public.fh_insurance_claims enable row level security;

drop policy if exists "fh_insurance_claims_own" on public.fh_insurance_claims;
create policy "fh_insurance_claims_own" on public.fh_insurance_claims
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Intentionally NO partner policy — insurance details are private to the
-- inviting contractor. A partner on a shared job can read the contact row
-- (per 004) but never the insurance payload.

-- ============================================================
-- updated_at maintenance
-- ============================================================
create or replace function public.fh_insurance_claims_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end $$;

drop trigger if exists fh_insurance_claims_touch on public.fh_insurance_claims;
create trigger fh_insurance_claims_touch
  before update on public.fh_insurance_claims
  for each row execute procedure public.fh_insurance_claims_touch();

-- =============================================================
-- DONE
-- =============================================================
-- Verify (after running):
--   select tablename from pg_tables where tablename = 'fh_insurance_claims';
--   select policyname from pg_policies where tablename = 'fh_insurance_claims';
