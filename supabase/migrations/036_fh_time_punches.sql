-- Migration 036 — fh_time_punches
--
-- Phase B (pass 2) — real multi-device time tracking. Replaces the
-- localStorage-only TimeClockCard from Phase 19 / Upgrade Move #A2.
-- One row per punch-pair (clock-in + clock-out). While the user is
-- still on the clock punch_out_at is NULL; that's how the app knows
-- the active session for any given user.
--
-- GPS is optional + advisory — the system flags suspicious punches
-- (e.g. clock-in 50 miles from the job site) but never blocks them.
-- All gating happens in the approval workflow (/timesheets, Phase B
-- pass 3), not at the punch.
--
-- RLS policy posture:
--   - members read/write their OWN punches (user_id = auth.uid())
--   - managers + admins + owners read ALL punches in their org
--   - approval (set approved_at / approved_by) goes through a
--     dedicated edge function so we can re-verify role server-side
--     and never trust a client-supplied approved_by.
--
-- Idempotent. Safe to re-run.

create table if not exists public.fh_time_punches (
  id                    uuid primary key default gen_random_uuid(),
  org_id                uuid references public.organizations(id) on delete cascade,
  user_id               uuid not null references auth.users(id) on delete cascade,
  contact_id            uuid references public.fh_contacts(id) on delete set null,

  punch_in_at           timestamptz not null,
  punch_out_at          timestamptz,

  punch_in_lat          double precision,
  punch_in_lon          double precision,
  punch_in_accuracy_m   double precision,
  punch_out_lat         double precision,
  punch_out_lon         double precision,
  punch_out_accuracy_m  double precision,

  hourly_rate           numeric(10, 2),
  break_minutes         integer not null default 0,
  notes                 text,
  flagged               boolean not null default false,
  flag_reason           text,

  approved_at           timestamptz,
  approved_by           uuid references auth.users(id) on delete set null,

  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);

create index if not exists fh_time_punches_user_in_idx
  on public.fh_time_punches (user_id, punch_in_at desc);

create index if not exists fh_time_punches_org_in_idx
  on public.fh_time_punches (org_id, punch_in_at desc);

create index if not exists fh_time_punches_contact_idx
  on public.fh_time_punches (contact_id)
  where contact_id is not null;

-- "One active punch per user" partial unique index. punch_out_at NULL
-- means clocked-in; allowing two would let a phone clock-in race with
-- a laptop clock-in.
create unique index if not exists fh_time_punches_one_active_per_user
  on public.fh_time_punches (user_id)
  where punch_out_at is null;

create or replace function public.fh_time_punches_touch()
returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end $fn$;

drop trigger if exists fh_time_punches_touch_trg on public.fh_time_punches;
create trigger fh_time_punches_touch_trg
  before update on public.fh_time_punches
  for each row execute function public.fh_time_punches_touch();

-- Attach migration 035's auto-org_id trigger if not already present.
do $$ begin
  if exists (
    select 1 from information_schema.columns
    where  table_schema = 'public' and table_name = 'fh_time_punches' and column_name = 'org_id'
  ) and not exists (
    select 1 from information_schema.triggers
    where  trigger_schema = 'public' and event_object_table = 'fh_time_punches'
      and  trigger_name = 'fh_set_org_id_trg'
  ) then
    execute 'create trigger fh_set_org_id_trg
               before insert on public.fh_time_punches
               for each row execute function public.fh_set_org_id()';
  end if;
end $$;

alter table public.fh_time_punches enable row level security;

drop policy if exists fh_time_punches_self on public.fh_time_punches;
create policy fh_time_punches_self on public.fh_time_punches
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists fh_time_punches_org_read on public.fh_time_punches;
create policy fh_time_punches_org_read on public.fh_time_punches
  for select to authenticated
  using (
    org_id is not null
    and exists (
      select 1 from public.org_members m
      where  m.user_id    = auth.uid()
        and  m.org_id     = fh_time_punches.org_id
        and  m.revoked_at is null
        and  m.role in ('owner','admin','manager')
    )
  );

comment on table public.fh_time_punches is
  'GPS-aware time-tracking punch pairs. One row per shift (punch_in_at + punch_out_at). punch_out_at NULL means clocked-in. Approval workflow uses approved_at/approved_by; gating runs through an edge function.';
