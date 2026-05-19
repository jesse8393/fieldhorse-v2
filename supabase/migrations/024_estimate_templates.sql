-- =============================================================
-- Migration 024 — ESTIMATE TEMPLATES
-- =============================================================
--
-- Per-user library of reusable estimate templates. Lets the
-- contractor save a generated AI bid (or a hand-crafted one) and
-- spin up new estimates by cloning instead of regenerating.
--
-- line_items is jsonb to match the shape the Bid screen already
-- works with — array of { name, qty, unit, rate_low, rate_high,
-- notes }. Keeping it free-form avoids the rigidity of a child
-- table for v1; can normalize if/when we need to query individual
-- items across templates.
--
-- Owner-only RLS. Nothing partner-shared here — templates are the
-- contractor's competitive-pricing IP and never leak to anyone
-- else.
-- =============================================================

create table if not exists public.fh_estimate_templates (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  description text,
  job_type text,
  line_items jsonb not null default '[]'::jsonb,
  total_low  numeric,
  total_high numeric,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fh_estimate_templates_user
  on public.fh_estimate_templates(user_id, updated_at desc);

-- ============================================================
-- RLS — OWNER ONLY
-- ============================================================
alter table public.fh_estimate_templates enable row level security;

drop policy if exists "fh_estimate_templates_own" on public.fh_estimate_templates;
create policy "fh_estimate_templates_own" on public.fh_estimate_templates
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- updated_at maintenance
-- ============================================================
create or replace function public.fh_estimate_templates_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists fh_estimate_templates_touch on public.fh_estimate_templates;
create trigger fh_estimate_templates_touch
  before update on public.fh_estimate_templates
  for each row execute procedure public.fh_estimate_templates_touch();
