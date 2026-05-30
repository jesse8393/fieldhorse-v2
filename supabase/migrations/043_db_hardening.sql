-- Migration 043 — DB hardening (audit #6-7)
--
-- Two security-advisor lints addressed in one migration:
--
-- A. function_search_path_mutable (24 functions, WARN). A function
--    whose search_path is unpinned can be exploited by a caller who
--    creates same-named objects in a schema the function would resolve
--    first. Pinning to `pg_catalog, public` forces every unqualified
--    reference to resolve in the expected places.
--
--    Functions touched: every fh_* touch / assign-seq / recompute
--    trigger function plus handle_new_user. Pure metadata change —
--    no behaviour, signatures, or bodies modified.
--
-- B. anon_security_definer_function_executable + matching authenticated
--    advisory (4 trigger-only / DDL-only SECURITY DEFINER functions).
--    These never run via REST RPC; they fire from triggers or run as
--    one-off DDL. PostgREST exposes any public-schema function with
--    EXECUTE granted to anon/authenticated, so we explicitly revoke
--    those grants to close the surface area without touching the
--    function bodies. RLS policies don't need EXECUTE — Supabase RLS
--    invokes referenced SECURITY DEFINER functions in a privileged
--    context regardless of the caller's grants.
--
--    Functions kept executable (not revoked here):
--      auth_user_org_ids()                — referenced by 26 RLS
--                                           policies, must remain
--                                           callable from authenticated.
--      fh_resolve_account_labels(uuid[])  — called via supabase.rpc
--                                           from src/lib/accountAttribution.ts.
--      fn_approve_quote_version(...)      — called via supabase.rpc
--                                           from ApproveQuoteSheet.tsx.
--
-- Verified before writing this migration:
--   • 24 functions have no `search_path=…` entry in pg_proc.proconfig.
--   • fh_set_org_id has 32 triggers attached, zero RPC callers.
--   • handle_new_user has 1 trigger (auth.users insert), zero RPC callers.
--   • fn_recalc_contact_amount_from_items has 1 trigger, zero RPC callers.
--   • rls_auto_enable has zero triggers / RPC callers (DDL helper).
--
-- NOT addressed in this migration (require non-SQL configuration):
--   • auth.config — leaked-password protection (HaveIBeenPwned).
--     Toggled in the Supabase dashboard under Auth → Settings →
--     "Leaked password protection". This migration intentionally
--     does not modify auth.* tables.
--
-- Idempotent: ALTER FUNCTION … SET search_path is a no-op when
-- already pinned; REVOKE EXECUTE on a privilege that's already gone
-- is also a no-op.

-- ---- A. pin search_path on 24 functions ------------------------------

alter function public.fh_change_orders_assign_seq()                set search_path = pg_catalog, public;
alter function public.fh_change_orders_touch()                     set search_path = pg_catalog, public;
alter function public.fh_clients_on_contact_change()               set search_path = pg_catalog, public;
alter function public.fh_clients_recompute(p_client_id uuid)       set search_path = pg_catalog, public;
alter function public.fh_closeouts_touch()                         set search_path = pg_catalog, public;
alter function public.fh_daily_logs_touch()                        set search_path = pg_catalog, public;
alter function public.fh_esign_envelopes_touch()                   set search_path = pg_catalog, public;
alter function public.fh_estimate_templates_touch()                set search_path = pg_catalog, public;
alter function public.fh_fill_invite_token()                       set search_path = pg_catalog, public;
alter function public.fh_insurance_claims_touch()                  set search_path = pg_catalog, public;
alter function public.fh_integration_secrets_touch()               set search_path = pg_catalog, public;
alter function public.fh_integrations_touch()                      set search_path = pg_catalog, public;
alter function public.fh_invoices_assign_seq()                     set search_path = pg_catalog, public;
alter function public.fh_invoices_touch()                          set search_path = pg_catalog, public;
alter function public.fh_materials_touch()                         set search_path = pg_catalog, public;
alter function public.fh_public_links_touch()                      set search_path = pg_catalog, public;
alter function public.fh_rate_cards_touch()                        set search_path = pg_catalog, public;
alter function public.fh_selections_touch()                        set search_path = pg_catalog, public;
alter function public.fh_stage_transitions_log()                   set search_path = pg_catalog, public;
alter function public.fh_stage_transitions_log_insert()            set search_path = pg_catalog, public;
alter function public.fh_sub_profiles_touch_updated_at()           set search_path = pg_catalog, public;
alter function public.fh_time_punches_touch()                      set search_path = pg_catalog, public;
alter function public.fh_touch_updated_at()                        set search_path = pg_catalog, public;
alter function public.handle_new_user()                            set search_path = pg_catalog, public;

-- ---- B. revoke EXECUTE on trigger-only / DDL-only SECURITY DEFINER ---
--
-- Note: Postgres grants EXECUTE on newly-created functions to the
-- pseudo-role PUBLIC by default, and both `anon` and `authenticated`
-- inherit that grant. A `REVOKE … FROM anon, authenticated` only
-- removes role-specific grants and leaves the PUBLIC default in
-- place, so it has no effect on REST-RPC reachability. We revoke
-- from PUBLIC to actually close the surface; triggers continue to
-- fire normally because trigger functions execute with the table
-- owner's privileges regardless of caller grants.

revoke execute on function public.fh_set_org_id()                       from public;
revoke execute on function public.handle_new_user()                     from public;
revoke execute on function public.fn_recalc_contact_amount_from_items() from public;
revoke execute on function public.rls_auto_enable()                     from public;
