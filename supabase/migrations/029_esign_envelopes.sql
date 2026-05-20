-- 029_esign_envelopes.sql
--
-- Tracks DocuSign (or any future e-sign provider) envelopes issued for a
-- job's proposal. One row per envelope; the docusign-webhook function
-- looks it up by envelope_id to flip status as the recipient views /
-- signs / declines. Owner-only RLS — the webhook writes via service role.

create table if not exists public.fh_esign_envelopes (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users(id) on delete cascade,
  contact_id    uuid not null references public.fh_contacts(id) on delete cascade,
  envelope_id   text not null,
  provider      text not null default 'docusign',
  status        text not null default 'sent' check (status in ('sent','delivered','viewed','completed','declined','voided')),
  recipient_email text,
  recipient_name  text,
  subject       text,
  sent_at       timestamptz not null default now(),
  completed_at  timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  unique (envelope_id)
);

create index if not exists fh_esign_envelopes_contact_idx
  on public.fh_esign_envelopes (contact_id);
create index if not exists fh_esign_envelopes_user_idx
  on public.fh_esign_envelopes (user_id);

create or replace function public.fh_esign_envelopes_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists fh_esign_envelopes_touch_t on public.fh_esign_envelopes;
create trigger fh_esign_envelopes_touch_t
  before update on public.fh_esign_envelopes
  for each row execute procedure public.fh_esign_envelopes_touch();

alter table public.fh_esign_envelopes enable row level security;

drop policy if exists fh_esign_envelopes_own on public.fh_esign_envelopes;
create policy fh_esign_envelopes_own on public.fh_esign_envelopes
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
