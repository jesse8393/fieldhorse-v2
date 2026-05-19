-- 026_rate_cards.sql
--
-- Per-tenant rate card overrides. Pairs with the seed RATE_CARD constant
-- in src/lib/rateCard.js — every row stored here is treated as an
-- override layered on top of the seed, keyed by trade_key. A user can
-- also store rows with trade_keys outside the seed (custom trades they
-- bid regularly) — those just surface as additional rows in the UI.
--
-- One row per (user_id, trade_key). RLS: owner-only, mirrors fh_clients.
-- No partner-read needed; rate cards are private pricing intelligence.

create table if not exists public.fh_rate_cards (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users(id) on delete cascade,
  trade_key    text not null,
  label        text,
  unit         text not null default 'lump',
  rate_low     numeric not null default 0 check (rate_low >= 0),
  rate_high    numeric not null default 0 check (rate_high >= 0),
  notes        text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (user_id, trade_key)
);

create index if not exists fh_rate_cards_user_idx
  on public.fh_rate_cards (user_id);

-- updated_at auto-bump on UPDATE so the editor can sort by recency
-- without the client needing to touch the timestamp itself.
create or replace function public.fh_rate_cards_touch()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists fh_rate_cards_touch_t on public.fh_rate_cards;
create trigger fh_rate_cards_touch_t
  before update on public.fh_rate_cards
  for each row execute procedure public.fh_rate_cards_touch();

alter table public.fh_rate_cards enable row level security;

drop policy if exists fh_rate_cards_own on public.fh_rate_cards;
create policy fh_rate_cards_own on public.fh_rate_cards
  for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());
