-- Fieldhorse v2 — migration 014
-- Lock the proposal_status lifecycle.
--
-- Phase 4C-2: now that fh_quote_versions (013) is live and the approval
-- flow writes proposal_status='approved' through fn_approve_quote_version,
-- pin the column to the canonical lifecycle value set so a typo or stale
-- legacy default can't silently produce an unrenderable status pill.
--
-- Pre-flight probe before this migration was authored:
--   select proposal_status, count(*) from public.fh_contacts
--     group by proposal_status order by count(*) desc;
--   -- result: draft = 18  (only)
--
-- All 18 live rows match the locked value set, so the strict CHECK
-- can land without a normalize-pass. Constraint is named so it can
-- be dropped + re-added by future migrations if the value set ever
-- needs to expand.
--
-- Idempotent. No app code touched.

alter table public.fh_contacts
  drop constraint if exists fh_contacts_proposal_status_check;

alter table public.fh_contacts
  add constraint fh_contacts_proposal_status_check
  check (
    proposal_status in (
      'draft', 'sent', 'viewed', 'approved', 'rejected', 'expired'
    )
  );

-- ============================================================
-- Verify (run manually after applying):
--
--   select conname, pg_get_constraintdef(oid)
--   from pg_constraint
--   where conrelid = 'public.fh_contacts'::regclass
--     and conname = 'fh_contacts_proposal_status_check';
--   -- expect 1 row with the IN (...) definition
--
--   -- Sanity: confirm no row violates (would have raised on add anyway)
--   select count(*) from public.fh_contacts
--     where proposal_status not in
--       ('draft','sent','viewed','approved','rejected','expired');
--   -- expect 0
-- ============================================================
