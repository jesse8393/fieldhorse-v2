-- Fieldhorse v2 — migration 007
-- CLIENTS DIRECTORY
--
-- Ships the fh_clients table + client_id FK on fh_contacts + one-shot
-- backfill + aggregate trigger + owner-only RLS.
--
-- PRIVACY NOTE: fh_clients has NO partner policy. An accepted partner on
-- a shared job can read the shared fh_contacts row (via fh_contacts_partner_read
-- from migration 004), but is NEVER allowed to read the fh_clients row
-- it joins to. The UI enforces this by rendering the CLIENT pill as
-- read-only text (no nav) whenever viewer.user_id !== contact.user_id.
--
-- Run manually in Supabase SQL Editor. Non-destructive; every block is
-- idempotent (IF NOT EXISTS / ON CONFLICT / DROP POLICY IF EXISTS / DO $$
-- blocks for constraints).

-- ============================================================
-- A) TABLE — fh_clients
-- ============================================================
create table if not exists public.fh_clients (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  name text not null,
  company_name text,
  phone text,
  email text,
  address text,
  notes text,
  -- Aggregates maintained by trigger below. Readers never compute these.
  active_jobs_count integer not null default 0,
  total_lifetime_value numeric not null default 0,
  last_activity_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fh_clients_user
  on public.fh_clients(user_id, last_activity_at desc nulls last);
create index if not exists idx_fh_clients_user_name
  on public.fh_clients(user_id, lower(name));
create index if not exists idx_fh_clients_user_email
  on public.fh_clients(user_id, lower(email)) where email is not null;

-- ============================================================
-- B) FK on fh_contacts — client_id (nullable)
-- ============================================================
alter table public.fh_contacts
  add column if not exists client_id uuid references public.fh_clients(id) on delete set null;

create index if not exists idx_fh_contacts_client
  on public.fh_contacts(client_id) where client_id is not null;

-- ============================================================
-- C) ONE-SHOT BACKFILL
-- ============================================================
-- For each user: collapse fh_contacts rows into unique client rows keyed
-- on (lower(coalesce(email, phone, name))). First row wins for
-- name/company/address/phone/email. Then stamp client_id on every contact.
-- Idempotent: if any contact already has client_id, skip that user.
do $$
declare
  u record;
begin
  for u in select distinct user_id from public.fh_contacts where client_id is null loop
    -- Insert unique clients derived from this user's contacts.
    insert into public.fh_clients (user_id, name, company_name, phone, email, address, created_at, updated_at)
    select
      u.user_id,
      coalesce(nullif(trim(max(c.name)), ''), 'Unnamed client'),
      nullif(trim(max(c.job_type)), ''),
      nullif(trim(max(c.phone)), ''),
      nullif(trim(max(c.email)), ''),
      nullif(trim(max(c.address)), ''),
      min(c.created_at),
      now()
    from public.fh_contacts c
    where c.user_id = u.user_id
      and c.client_id is null
    group by lower(coalesce(nullif(trim(c.email), ''), nullif(trim(c.phone), ''), nullif(trim(c.name), ''), c.id::text));

    -- Re-link every contact to the matching client.
    update public.fh_contacts c
    set client_id = cli.id
    from public.fh_clients cli
    where c.user_id = u.user_id
      and cli.user_id = u.user_id
      and c.client_id is null
      and lower(coalesce(nullif(trim(c.email), ''), nullif(trim(c.phone), ''), nullif(trim(c.name), ''), c.id::text))
        = lower(coalesce(nullif(trim(cli.email), ''), nullif(trim(cli.phone), ''), nullif(trim(cli.name), ''), cli.id::text));
  end loop;
end $$;

-- ============================================================
-- D) AGGREGATE TRIGGER — keep fh_clients counters fresh
-- ============================================================
-- Recomputes active_jobs_count, total_lifetime_value, last_activity_at
-- on any fh_contacts insert/update/delete touching a client_id.
--
-- Definitions:
--   active = stage in ('lead','quote','job','invoice')
--   lifetime_value = sum(amount) where stage in ('invoice','closed')
create or replace function public.fh_clients_recompute(p_client_id uuid)
returns void
language plpgsql
as $$
begin
  if p_client_id is null then return; end if;
  update public.fh_clients c
  set
    active_jobs_count = coalesce(agg.active_count, 0),
    total_lifetime_value = coalesce(agg.ltv, 0),
    last_activity_at = coalesce(agg.last_at, c.last_activity_at),
    updated_at = now()
  from (
    select
      count(*) filter (where stage in ('lead','quote','job','invoice')) as active_count,
      coalesce(sum(amount) filter (where stage in ('invoice','closed')), 0) as ltv,
      max(updated_at) as last_at
    from public.fh_contacts
    where client_id = p_client_id
  ) agg
  where c.id = p_client_id;
end $$;

create or replace function public.fh_clients_on_contact_change()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    perform public.fh_clients_recompute(old.client_id);
    return old;
  end if;
  -- INSERT or UPDATE
  perform public.fh_clients_recompute(new.client_id);
  -- On re-link (client changed), also refresh the old client
  if tg_op = 'UPDATE' and new.client_id is distinct from old.client_id then
    perform public.fh_clients_recompute(old.client_id);
  end if;
  return new;
end $$;

drop trigger if exists fh_clients_aggregate on public.fh_contacts;
create trigger fh_clients_aggregate
  after insert or update or delete on public.fh_contacts
  for each row execute procedure public.fh_clients_on_contact_change();

-- Seed the aggregates once so the backfilled clients have correct numbers
-- immediately, without waiting for the next contact edit.
do $$
declare r record;
begin
  for r in select id from public.fh_clients loop
    perform public.fh_clients_recompute(r.id);
  end loop;
end $$;

-- ============================================================
-- E) RLS — OWNER ONLY (intentionally no partner policy)
-- ============================================================
alter table public.fh_clients enable row level security;

drop policy if exists "fh_clients_own" on public.fh_clients;
create policy "fh_clients_own" on public.fh_clients
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Explicitly NOT creating fh_clients_partner — partners must never see
-- the inviter's other clients. A partner viewing a shared job can read
-- the fh_contacts row (Phase 14 policy), but if they try to select
-- fh_clients by that row's client_id, they get 0 rows. The UI matches
-- this by rendering the CLIENT pill as static text (no navigation) on
-- any job where viewer.user_id != contact.user_id.

-- ============================================================
-- DONE
-- ============================================================
-- Verify:
--   select count(*) from public.fh_clients;
--   -- expect: one row per unique client across ALL your fh_contacts
--
--   select count(*) from public.fh_contacts where client_id is null;
--   -- expect: 0 (every contact has been linked)
--
--   select policyname from pg_policies
--   where tablename = 'fh_clients';
--   -- expect: ['fh_clients_own']  (single row — no partner policy)
--
--   select tgname from pg_trigger
--   where tgrelid = 'public.fh_contacts'::regclass
--     and tgname = 'fh_clients_aggregate';
--   -- expect: 1 row
