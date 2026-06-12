-- 048 — Web push foundation
--
-- fh_push_subscriptions: one row per browser/device push subscription.
--   Written by the signed-in client (RLS own-rows); read by Netlify
--   functions with the service role when an event needs to reach the
--   contractor's lock screen.
--
-- fh_app_config: service-role-only key/value store. First use: VAPID
--   signing keys for web push (inserted out-of-band, never committed).
--   RLS enabled with NO policies + explicit revokes = only the service
--   role can touch it.

create table if not exists public.fh_push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  user_agent   text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);

create index if not exists idx_fh_push_subs_user
  on public.fh_push_subscriptions(user_id);

alter table public.fh_push_subscriptions enable row level security;

drop policy if exists fh_push_subs_own on public.fh_push_subscriptions;
create policy fh_push_subs_own on public.fh_push_subscriptions
  for all
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

revoke all on public.fh_push_subscriptions from anon;
grant select, insert, update, delete on public.fh_push_subscriptions to authenticated;

create table if not exists public.fh_app_config (
  key        text primary key,
  value      text not null,
  updated_at timestamptz not null default now()
);

alter table public.fh_app_config enable row level security;
-- No policies on purpose: only the service role (which bypasses RLS)
-- can read or write app-level secrets.
revoke all on public.fh_app_config from anon, authenticated;
