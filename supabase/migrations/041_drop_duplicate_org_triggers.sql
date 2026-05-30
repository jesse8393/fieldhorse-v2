-- Migration 041 — drop duplicate per-table org-id triggers
--
-- Background. Migration 034 added a BEFORE INSERT trigger
-- (*_auto_org → fh_auto_set_org_id) on every tenant-scoped table to
-- auto-populate org_id from org_members. Migration 035 then added a
-- second, strictly better trigger (fh_set_org_id_trg → fh_set_org_id)
-- on the same tables — but did NOT remove the older one. Every insert
-- has been firing both triggers and doing the same org_members lookup
-- twice ever since.
--
-- Why fh_set_org_id wins:
--   • Handles service-role contexts (auth.uid() IS NULL) gracefully
--     instead of returning a NULL org_id without a guard.
--   • Uses ORDER BY joined_at DESC for deterministic selection on
--     users who belong to multiple orgs.
--   • Both functions are SECURITY DEFINER with a pinned search_path,
--     so the security posture is unchanged.
--
-- Verified before writing this migration:
--   • Each of the 27 tables below has BOTH triggers.
--   • The only references to fh_auto_set_org_id in pg_depend are the
--     27 trigger rows we're about to drop — no views, defaults, or
--     other functions depend on it.
--   • Application code (src/, netlify/) does not reference either
--     function name; both are pure DB-side triggers.
--
-- Idempotent (DROP TRIGGER IF EXISTS / DROP FUNCTION IF EXISTS).

do $$
declare
  t text;
begin
  foreach t in array array[
    'fh_change_orders',
    'fh_clients',
    'fh_closeouts',
    'fh_contacts',
    'fh_esign_envelopes',
    'fh_estimate_templates',
    'fh_expenses',
    'fh_inspections',
    'fh_insurance_claims',
    'fh_integrations',
    'fh_invoices',
    'fh_job_files',
    'fh_job_partners',
    'fh_job_todos',
    'fh_mileage',
    'fh_notes',
    'fh_notifications',
    'fh_payments',
    'fh_public_links',
    'fh_quote_items',
    'fh_quote_versions',
    'fh_rate_cards',
    'fh_schedule',
    'fh_stage_transitions',
    'fh_sub_profiles',
    'fh_subs',
    'profiles'
  ]
  loop
    execute format(
      'drop trigger if exists %I on public.%I',
      t || '_auto_org', t
    );
  end loop;
end $$;

-- Function is now orphaned (no remaining triggers reference it).
drop function if exists public.fh_auto_set_org_id();

comment on function public.fh_set_org_id() is
  'BEFORE INSERT trigger function. Sets NEW.org_id from the caller''s most-recent active org_members row when the caller did not specify one. No-op when org_id is supplied or when auth.uid() is NULL (service-role inserts must set org_id explicitly). Sole org-id auto-fill trigger as of migration 041 — superseded fh_auto_set_org_id from migration 034.';
