-- Migration 046 — revoke anonymous EXECUTE from 3 SECURITY DEFINER functions
--
-- Supabase advisor lint 0028 (anon_security_definer_function_executable)
-- was flagging three functions as callable by the `anon` role via the
-- PostgREST /rest/v1/rpc endpoint even though none have a legitimate
-- anonymous use case.
--
-- The functions had EXECUTE granted to PUBLIC (the SQL keyword,
-- meaning "all roles including those created later" — anon inherits
-- through this). Migration 034 added `grant ... to public` on
-- auth_user_org_ids() to fix a recursion issue when org_members RLS
-- policies needed to call it; that grant was too broad.
--
-- Fix: revoke EXECUTE FROM PUBLIC. The explicit grants to
-- `authenticated` and `service_role` (already in place from
-- migrations 032 + the function definitions) stay intact — anon no
-- longer has EXECUTE because it inherited only through PUBLIC.
--
-- Per function:
--
-- 1. public.auth_user_org_ids()
--    Returns the current user's org_ids for RLS predicates (used by
--    26 policies per migration 043's comment). RLS needs the
--    `authenticated` role to call it, NOT anon.
--    Verified: no client RPC calls in src/ or netlify/.
--
-- 2. public.fh_resolve_account_labels(p_user_ids uuid[])
--    Resolves user_id → display label for team views. Body
--    early-returns when `v_caller is null` (anon), so revoking
--    anon access changes nothing functionally.
--    Called from src/lib/accountAttribution.ts via supabase.rpc()
--    in authenticated contexts only.
--
-- 3. public.fn_approve_quote_version(p_user_id, p_contact_id, ...)
--    Records an authenticated owner's approval of a quote version.
--    Body gates on `auth.uid() = p_user_id`, so anon callers
--    can't pass anyway.
--    Customer-side approval (the /p/:token public link) goes
--    through netlify/functions/public-link-approve.js which runs
--    with the service-role key and inlines the writes — does NOT
--    call this RPC. (Confirmed in that function's comment block.)
--
-- Note: lint 0029 (authenticated_security_definer_function_executable)
-- still fires on these three, but that's a false positive for our
-- use case — they ARE supposed to be callable by authenticated users
-- (RLS predicates for #1, client RPC for #2 and #3).
--
-- Idempotent.

revoke execute on function public.auth_user_org_ids() from public;
revoke execute on function public.fh_resolve_account_labels(uuid[]) from public;
revoke execute on function public.fn_approve_quote_version(
  uuid, uuid, jsonb, numeric, numeric, integer, text, text, text, text, text, text
) from public;
