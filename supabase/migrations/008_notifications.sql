-- Fieldhorse v2 — migration 008
-- IN-APP NOTIFICATIONS INBOX
--
-- Foundational table for the bell + push later. This migration ships
-- only the schema + RLS; the in-app bell reads from here. Push (iOS
-- web-push, Supabase Edge Function, APNs cert) is a follow-up that
-- doesn't need this migration to ship first.
--
-- Run manually in Supabase SQL Editor. Idempotent.
--
-- Recipient model: notifications belong to ONE user (the recipient).
-- They can be triggered by another user's action (e.g. a partner
-- accepting an invite triggers a notification for the inviter), but
-- only the recipient can read them. Actor identity is stored in
-- actor_user_id for display; actor cannot read the recipient's row
-- because RLS gates on user_id = auth.uid() only.

create table if not exists public.fh_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,  -- recipient
  actor_user_id uuid references auth.users(id) on delete set null,    -- who triggered (optional)
  kind text not null,                                                  -- 'partner_accepted' | 'inspection_logged' | 'payment_received' | 'sub_responded' | etc.
  title text not null,                                                 -- short headline
  body text,                                                           -- secondary line
  link text,                                                           -- internal route to navigate on tap, e.g. '/jobs/<id>'
  read_at timestamptz,                                                 -- null = unread
  created_at timestamptz not null default now()
);

create index if not exists idx_fh_notifications_inbox
  on public.fh_notifications(user_id, created_at desc);
create index if not exists idx_fh_notifications_unread
  on public.fh_notifications(user_id, read_at)
  where read_at is null;

alter table public.fh_notifications enable row level security;

-- Recipient owns. Actor / system inserts get their own policy below
-- so partner-accept (which writes to a DIFFERENT user's inbox) can
-- still land — but only via the service role from the Netlify function.
drop policy if exists "fh_notifications_own" on public.fh_notifications;
create policy "fh_notifications_own" on public.fh_notifications
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Service role bypasses RLS by default in Supabase, so server-side
-- inserts from Netlify functions (with SUPABASE_SERVICE_ROLE_KEY)
-- can write to any user's inbox without an additional policy.

-- ============================================================
-- DONE
-- ============================================================
-- Verify:
--   select count(*) from public.fh_notifications;        -- 0 fresh
--   select policyname from pg_policies where tablename = 'fh_notifications';
--                                                         -- 1 row: fh_notifications_own
--   select indexname from pg_indexes where tablename = 'fh_notifications';
--                                                         -- pkey + idx_fh_notifications_inbox + idx_fh_notifications_unread
