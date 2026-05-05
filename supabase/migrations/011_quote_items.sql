-- Fieldhorse v2 — migration 011
-- Quote line items.
--
-- Phase 4A-1: structured line items for the Quote stage. Each contact
-- (deal) can carry many quote items: one row per labor / material /
-- sub / line on the operator's quote. Existing single-amount contacts
-- continue to work unchanged — fh_contacts.amount only auto-syncs once
-- at least one quote item exists for that contact.
--
-- Idempotent. RLS mirrors fh_job_todos (owner all + accepted partner
-- all via fh_job_partners). Reuses fh_touch_updated_at() from
-- migration 002 for the updated_at trigger.

-- ============================================================
-- A) TABLE
-- ============================================================
create table if not exists public.fh_quote_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.fh_contacts(id) on delete cascade,

  section text,                                  -- 'Labor' | 'Materials' | 'Subs' | 'Other' | free-text
  description text not null,
  qty numeric not null default 1,
  unit text,                                     -- 'sf' | 'lf' | 'ea' | 'hr' | 'lot' | ...
  rate numeric not null default 0,
  amount numeric not null default 0,             -- stored; app defaults to qty*rate, operator may override
  notes text,                                    -- private operator notes per line

  is_optional boolean not null default false,    -- shown to customer but excluded from base total
  is_excluded boolean not null default false,    -- explicit out-of-scope; never counted

  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists idx_fh_quote_items_contact
  on public.fh_quote_items (contact_id, sort_order);

create index if not exists idx_fh_quote_items_user_contact
  on public.fh_quote_items (user_id, contact_id);

-- ============================================================
-- B) updated_at touch — reuse fh_touch_updated_at() from 002
-- ============================================================
drop trigger if exists fh_quote_items_touch on public.fh_quote_items;
create trigger fh_quote_items_touch
  before update on public.fh_quote_items
  for each row execute procedure public.fh_touch_updated_at();

-- ============================================================
-- C) RLS — owner + accepted-partner pattern matching fh_job_todos
-- ============================================================
alter table public.fh_quote_items enable row level security;

drop policy if exists "fh_quote_items_own" on public.fh_quote_items;
create policy "fh_quote_items_own" on public.fh_quote_items
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "fh_quote_items_partner" on public.fh_quote_items;
create policy "fh_quote_items_partner" on public.fh_quote_items
  for all to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_quote_items.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  )
  with check (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_quote_items.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  );

-- ============================================================
-- D) Amount sync trigger
-- ============================================================
-- After any insert / update / delete of fh_quote_items, recalc
-- fh_contacts.amount as SUM(amount) of base items
-- (is_optional = false AND is_excluded = false).
--
-- If zero items remain for the contact, leave fh_contacts.amount
-- unchanged — preserves manually-entered amounts on legacy contacts
-- that have never had quote items, and preserves the prior amount
-- when an operator deletes all items intending to revert to manual.
--
-- security definer so a partner (with no UPDATE on fh_contacts via
-- their RLS) can still trigger the recalc when they edit shared
-- quote items. Function body is narrow: one count + one update on
-- one column of one row. search_path is locked to public to defend
-- against schema-tampering tricks.

create or replace function public.fn_recalc_contact_amount_from_items()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  target_contact uuid;
  has_items boolean;
  new_total numeric;
begin
  target_contact := coalesce(new.contact_id, old.contact_id);
  if target_contact is null then
    return coalesce(new, old);
  end if;

  select count(*) > 0 into has_items
    from public.fh_quote_items
    where contact_id = target_contact;

  if not has_items then
    -- All items deleted — preserve the contact's existing amount.
    return coalesce(new, old);
  end if;

  select coalesce(sum(amount), 0) into new_total
    from public.fh_quote_items
    where contact_id = target_contact
      and is_optional = false
      and is_excluded = false;

  update public.fh_contacts
    set amount = new_total
    where id = target_contact;

  return coalesce(new, old);
end;
$$;

drop trigger if exists trg_quote_items_recalc on public.fh_quote_items;
create trigger trg_quote_items_recalc
  after insert or update or delete on public.fh_quote_items
  for each row execute procedure public.fn_recalc_contact_amount_from_items();

-- ============================================================
-- Verify (run manually after applying):
--
--   select column_name from information_schema.columns
--   where table_name = 'fh_quote_items';
--   -- expect 14 rows
--
--   select indexname from pg_indexes
--   where tablename = 'fh_quote_items';
--   -- expect 3 rows (PK + 2 created indexes)
--
--   select polname from pg_policies where tablename = 'fh_quote_items';
--   -- expect 2 (own, partner)
--
--   select tgname from pg_trigger where tgrelid = 'public.fh_quote_items'::regclass;
--   -- expect 2 (touch + recalc) plus 'RI_ConstraintTrigger_*' system rows
-- ============================================================
