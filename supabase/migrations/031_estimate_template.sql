-- =============================================================
-- Migration 031 — ESTIMATE TEMPLATE CHOICE
-- =============================================================
--
-- Per-account choice of which visual estimate/proposal design the
-- contractor's customer-facing documents use. Drives both the HTML
-- preview (ProposalTemplate) and the PDF export (generateQuote).
--
-- Allowed values:
--   'classic'   — the existing editorial dark-accent layout (default,
--                 so every current account keeps its look untouched)
--   'slate'     — gray header bar, FROM/FOR blocks, detailed line items
--   'mint'      — large green ESTIMATE wordmark, green table + total
--   'editorial' — sand/serif, Scope of Work prose + Cost Breakdown
--
-- Single column on profiles (one default per company), nullable with a
-- 'classic' default so existing rows render exactly as before. App code
-- also falls back to 'classic' when the value is missing, so the column
-- can roll out ahead of being populated without breaking any render.
-- =============================================================

alter table public.profiles
  add column if not exists estimate_template text not null default 'classic';

-- Constrain to the known design keys. Drop-then-add so re-running the
-- migration (or extending the set later) is idempotent.
alter table public.profiles
  drop constraint if exists profiles_estimate_template_check;

alter table public.profiles
  add constraint profiles_estimate_template_check
  check (estimate_template in ('classic', 'slate', 'mint', 'editorial'));

-- ============================================================
-- Verify (run manually after applying):
--
--   select column_name, column_default, is_nullable
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'profiles'
--     and column_name = 'estimate_template';
--   -- expect 1 row; default 'classic'; is_nullable = NO
-- ============================================================
