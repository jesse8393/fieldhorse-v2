-- Fieldhorse v2 — migration 012
-- Quote artifact fields.
--
-- Phase 4B-1: live working-draft fields for the sendable quote /
-- proposal artifact. fh_quote_items (migration 011) carries the
-- structured line items; this migration adds the customer-facing
-- prose blocks and the lifecycle timestamps that the Send Quote
-- flow (4B-4) and the Phase 4C approval snapshot will read from.
--
-- All five columns are nullable with no default. Existing fh_contacts
-- rows get null on every new column automatically — zero behavior
-- change for legacy contacts that never enter the Quote tab.
-- Idempotent. RLS already covers fh_contacts (owner + accepted
-- partner via fh_job_partners) so no new policy is needed.
--
-- proposal_status already exists from migration 002:42 with default
-- 'draft' and is currently unused in app code; this migration does
-- NOT recreate or constrain it. Status-value CHECK constraints are
-- deferred to Phase 4C when the full draft → sent → approved
-- lifecycle is wired and the value set is locked.

alter table public.fh_contacts
  add column if not exists scope_text       text,
  add column if not exists terms_text       text,
  add column if not exists exclusions_text  text,
  add column if not exists quote_sent_at    timestamptz,
  add column if not exists quote_expires_at timestamptz;

-- ============================================================
-- Verify (run manually after applying):
--
--   select column_name, data_type, is_nullable, column_default
--   from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'fh_contacts'
--     and column_name in (
--       'scope_text', 'terms_text', 'exclusions_text',
--       'quote_sent_at', 'quote_expires_at'
--     );
--   -- expect 5 rows; all is_nullable = YES; column_default null
--
--   select count(*) from public.fh_contacts where scope_text is not null;
--   -- expect 0 immediately after migration (no backfill performed)
-- ============================================================
