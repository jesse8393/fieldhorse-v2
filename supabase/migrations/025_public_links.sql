-- =============================================================
-- Migration 025 — PUBLIC LINKS
-- =============================================================
--
-- One-token-per-share table that lets the contractor send a customer
-- a public web link to view a proposal or invoice without needing
-- an account. The customer clicks /p/{token} → server resolves the
-- token via service role → returns the doc payload → React renders
-- the same ProposalTemplate / InvoiceTemplate used in-app.
--
-- Design: NO anon SELECT policy. All public consumption flows
-- through the /api/public-link/[token] Netlify function which uses
-- the service-role key. Keeps fh_public_links opaque to direct
-- PostgREST + concentrates all token → document resolution + view
-- count bumping in one server endpoint.
--
-- The contractor's auth-side queries (list tokens for a contact,
-- revoke a token, etc.) flow through the owner-only RLS policy.
-- =============================================================

create table if not exists public.fh_public_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.fh_contacts(id) on delete cascade,
  kind text not null check (kind in ('proposal','invoice')),
  token text not null unique,
  expires_at timestamptz,
  revoked_at timestamptz,
  view_count integer not null default 0,
  last_viewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fh_public_links_user
  on public.fh_public_links(user_id, created_at desc);
create index if not exists idx_fh_public_links_contact
  on public.fh_public_links(contact_id);

alter table public.fh_public_links enable row level security;

drop policy if exists "fh_public_links_own" on public.fh_public_links;
create policy "fh_public_links_own" on public.fh_public_links
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create or replace function public.fh_public_links_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists fh_public_links_touch on public.fh_public_links;
create trigger fh_public_links_touch
  before update on public.fh_public_links
  for each row execute procedure public.fh_public_links_touch();
