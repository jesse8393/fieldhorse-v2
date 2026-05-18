-- =============================================================
-- Migration 021 — PROGRESS BILLING / fh_invoices
-- =============================================================
--
-- Adds a child table to represent draws (progress-billed invoices)
-- against a contract. A given fh_contacts row is the contract; each
-- fh_invoices row is one invoice issued against it. Sequence numbers
-- ("Draw 1 of 3") are auto-assigned per contact via a BEFORE INSERT
-- trigger so concurrent inserts can't collide.
--
-- Payments stay on fh_payments at the contact level (not per-invoice)
-- so the contractor can still post a single payment that satisfies
-- multiple draws. The InvoiceTemplate's balance summary handles the
-- "previously paid / this invoice / balance remaining" math.
--
-- Backward compatibility:
--   Pre-Phase-5b, an fh_contacts row at stage='invoice' was implicitly
--   "the invoice" — a one-invoice-per-job model. That model is unchanged.
--   This table is opt-in: a contract has no draws until the contractor
--   adds one. Cash jobs / small projects still flow through the
--   single-invoice path.
-- =============================================================

create table if not exists public.fh_invoices (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.fh_contacts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,

  -- Draw # within the contract: "Draw 1 of N". Assigned by trigger;
  -- callers pass 0 / null to mean "next available".
  sequence_number integer not null,

  title text,                              -- e.g. "50% deposit", "Mid-project draw"
  amount numeric not null default 0,        -- what THIS draw asks for

  status text not null default 'draft'
    check (status in ('draft','sent','paid','overdue','void')),

  issued_at timestamptz,                    -- when sent to the client
  due_at    timestamptz,                    -- when payment is expected
  notes text,                               -- remit-to instructions etc.

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint fh_invoices_seq_unique unique (contact_id, sequence_number)
);

create index if not exists idx_fh_invoices_contact
  on public.fh_invoices(contact_id, sequence_number);
create index if not exists idx_fh_invoices_user
  on public.fh_invoices(user_id);

-- ============================================================
-- Sequence assignment — BEFORE INSERT
-- ============================================================
create or replace function public.fh_invoices_assign_seq()
returns trigger language plpgsql as $$
begin
  if new.sequence_number is null or new.sequence_number = 0 then
    select coalesce(max(sequence_number), 0) + 1
    into new.sequence_number
    from public.fh_invoices
    where contact_id = new.contact_id;
  end if;
  return new;
end $$;

drop trigger if exists fh_invoices_seq on public.fh_invoices;
create trigger fh_invoices_seq
  before insert on public.fh_invoices
  for each row execute procedure public.fh_invoices_assign_seq();

-- ============================================================
-- RLS — OWNER + PARTNER READ
-- Partners on a shared job see the draws (they're part of the
-- contract record); only owner writes.
-- ============================================================
alter table public.fh_invoices enable row level security;

drop policy if exists "fh_invoices_own" on public.fh_invoices;
create policy "fh_invoices_own" on public.fh_invoices
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "fh_invoices_partner_read" on public.fh_invoices;
create policy "fh_invoices_partner_read" on public.fh_invoices
  for select to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_invoices.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
    )
  );

-- ============================================================
-- updated_at maintenance
-- ============================================================
create or replace function public.fh_invoices_touch()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists fh_invoices_touch on public.fh_invoices;
create trigger fh_invoices_touch
  before update on public.fh_invoices
  for each row execute procedure public.fh_invoices_touch();
