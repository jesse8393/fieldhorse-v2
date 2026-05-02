-- Fieldhorse v2 — migration 015
-- Company branding profile fields.
--
-- Phase 4D-2A: every customer-facing PDF (proposal, quote, invoice,
-- approval certificate later) must carry the contractor's brand. This
-- migration formalizes the per-account branding columns on profiles
-- so the Quote PDF (4D-2C) and Invoice PDF (4D-2D) can read them.
--
-- Notes on existing-state reconciliation:
--   * `company_name` is already referenced by app code (Settings, Onboarding,
--     Invoices, generateQuote/generateInvoice) and is presumed to exist on the
--     live profiles table — it was added via the Supabase dashboard before
--     it was tracked in repo migrations. `add column if not exists` is safe
--     either way and brings the migration history in sync.
--   * `company_address` and `company_phone` are read by Invoices.jsx but
--     have never had a Settings UI input or a repo migration — they may or
--     may not exist on the live DB. `add column if not exists` covers both
--     cases.
--   * Five new columns formalize the rest of the branding surface.
--
-- Backfill: only when `company_name` is null AND `full_name` is non-blank,
-- copy `full_name` into `company_name`. Existing `company_name` values are
-- never overwritten. Idempotent — re-running the migration does nothing
-- after the first pass because the WHERE clause filters out already-set rows.
--
-- All columns are nullable with no defaults. Existing rows get NULL on every
-- new column automatically; no row rewrite, brief metadata-only ALTER lock.
-- Settings UI (4D-2A) and downstream PDF wiring (4D-2C/2D) handle the
-- empty-state rendering.

alter table public.profiles
  add column if not exists company_name      text,
  add column if not exists company_address   text,
  add column if not exists company_phone     text,
  add column if not exists company_email     text,
  add column if not exists company_website   text,
  add column if not exists license_number    text,
  add column if not exists insured_text      text,
  add column if not exists warranty_default  text;

-- Optional backfill — only fills rows where company_name has never been set.
update public.profiles
   set company_name = full_name
 where company_name is null
   and full_name is not null
   and length(trim(full_name)) > 0;

-- ============================================================
-- Verify (run manually after applying):
--
--   select column_name, data_type, is_nullable
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'profiles'
--     and column_name in (
--       'company_name', 'company_address', 'company_phone',
--       'company_email', 'company_website',
--       'license_number', 'insured_text', 'warranty_default'
--     )
--   order by column_name;
--   -- expect 8 rows; all is_nullable = YES
--
--   select count(*) as backfilled
--   from public.profiles
--   where company_name is not null;
--   -- expect: matches the count of profiles with full_name OR a previously
--   -- set company_name. Existing company_name values were not overwritten.
-- ============================================================
