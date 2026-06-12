-- ============================================================
-- 047 — Pipeline v2: leads/jobs split + first-class invoices
--
-- The 'invoice' pipeline stage is retired. Invoicing is no longer a
-- position a whole job moves into — it's fh_invoices rows (migration
-- 021) issued against a job, N per job (deposit / progress / final),
-- each sendable on its own.
--
-- New stage semantics on fh_contacts.stage:
--   lead / quote   → a Lead (own screen + lifecycle; 'quote' = lead
--                    with a quote in flight)
--   job            → an active Job (a won deal)
--   closed         → a finished Job
--   lost           → a dead lead
--
-- "Work done, awaiting payment" — previously the 'invoice' stage — is
-- now completed_at on the job. Payment-in-full still auto-closes.
-- ============================================================

-- Lead follow-up date: powers the Leads screen "follow up by" nudge.
alter table public.fh_contacts
  add column if not exists follow_up_on date;

-- Job completion timestamp: replaces the 'invoice' stage's only real
-- meaning (work wrapped, money still out).
alter table public.fh_contacts
  add column if not exists completed_at timestamptz;

-- Payments can now point at the specific invoice they satisfy.
-- Nullable — contact-level payments (the historic model) stay valid.
alter table public.fh_payments
  add column if not exists invoice_id uuid references public.fh_invoices(id) on delete set null;

create index if not exists idx_fh_payments_invoice
  on public.fh_payments(invoice_id)
  where invoice_id is not null;

-- Migrate existing 'invoice'-stage rows: they are jobs whose work was
-- marked complete (that's what moving to the invoice stage meant).
-- updated_at is the closest honest stand-in for when that happened.
update public.fh_contacts
   set completed_at = coalesce(completed_at, updated_at, now()),
       stage = 'job'
 where stage = 'invoice';
