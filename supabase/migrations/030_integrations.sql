-- 030_integrations.sql
--
-- Third-party integrations (QuickBooks Online, Stripe, Jobber, Google
-- Calendar, GoHighLevel). Two tables, mirroring the e-sign pattern:
--
--   fh_integrations         — one row per connected provider per user.
--                             Owner-readable status + account display
--                             info. The mobile Integrations hub reads
--                             this to show Connected / Not connected.
--   fh_integration_secrets  — OAuth/access tokens. NO client RLS policy,
--                             so anon/auth roles can't read tokens at all;
--                             only the edge functions (service role, which
--                             bypasses RLS) read/write them during OAuth
--                             callback, token refresh, and sync.
--
-- Edge functions own the write path: the OAuth callback inserts/updates
-- the integration row + secret, and webhooks/sync jobs update status.

create table if not exists public.fh_integrations (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references auth.users(id) on delete cascade,
  provider            text not null check (provider in ('quickbooks','stripe','jobber','google_calendar','gohighlevel')),
  status              text not null default 'disconnected'
                        check (status in ('disconnected','connected','error','expired')),
  external_account_id text,
  display_name        text,
  scopes              text,
  last_synced_at      timestamptz,
  last_error          text,
  metadata            jsonb not null default '{}'::jsonb,
  connected_at        timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (user_id, provider)
);

create index if not exists fh_integrations_user_idx
  on public.fh_integrations (user_id);

create or replace function public.fh_integrations_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists fh_integrations_touch_t on public.fh_integrations;
create trigger fh_integrations_touch_t
  before update on public.fh_integrations
  for each row execute procedure public.fh_integrations_touch();

alter table public.fh_integrations enable row level security;

-- Owner can read + manage their own integration rows (e.g. disconnect).
drop policy if exists fh_integrations_own on public.fh_integrations;
create policy fh_integrations_own on public.fh_integrations
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ---- Secrets: tokens live here, service-role only ----
create table if not exists public.fh_integration_secrets (
  integration_id  uuid primary key references public.fh_integrations(id) on delete cascade,
  access_token    text,
  refresh_token   text,
  realm_id        text,                 -- QBO company id; null for others
  expires_at      timestamptz,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create or replace function public.fh_integration_secrets_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists fh_integration_secrets_touch_t on public.fh_integration_secrets;
create trigger fh_integration_secrets_touch_t
  before update on public.fh_integration_secrets
  for each row execute procedure public.fh_integration_secrets_touch();

-- RLS on, but NO policies for anon/authenticated: every client read/write
-- is denied. Edge functions use the service role key, which bypasses RLS.
alter table public.fh_integration_secrets enable row level security;
