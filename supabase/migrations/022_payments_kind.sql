-- =============================================================
-- Migration 022 — PAYMENT KIND TAGGING
-- =============================================================
--
-- Adds a `kind` column to fh_payments so the contractor can tag
-- a payment as a deposit, progress draw, final settlement, retainage,
-- or other. Surfaces on the invoice balance summary + payment history
-- list so the customer can see how each chunk fits the contract.
--
-- Most useful for:
--   - Commercial work with retainage held back per contract terms
--     (typically 5-10% withheld until punch-list sign-off)
--   - Insurance restoration where the carrier issues separate checks
--     for the deductible + RCV release + supplement + depreciation
--     recovery
--   - Any progress-billed contract where the customer wants to see
--     "deposit" called out separately from "ongoing draws"
--
-- Default 'other' so existing rows that pre-date this migration don't
-- break — they get the neutral tag until the contractor updates them
-- (no UI flow forces a backfill).
-- =============================================================

alter table public.fh_payments
  add column if not exists kind text default 'other'
    check (kind in ('deposit', 'progress', 'final', 'retainage', 'other'));

-- Index for "show me all the retainage held against this contract"
-- queries — surfaces on the invoice balance summary in the UI.
create index if not exists idx_fh_payments_contact_kind
  on public.fh_payments(contact_id, kind);
