-- New functions in public are not executable by anon by default (DB-10).
--
-- The default privileges for functions that postgres creates in public
-- grant EXECUTE to anon. Many guards are written
-- "if auth.uid() is not null and not fh_is_org_member(...)", which skips
-- every check when there is no user. So any future security definer
-- function created without an explicit revoke would be callable by anyone
-- on the internet with its checks skipped. No function is exposed that way
-- today.
--
-- From now on, new functions are executable by signed in users and the
-- service role only; a function meant for anon needs an explicit grant.
-- Grants on existing functions are not changed.
--
-- A schema level entry cannot take away what a global entry grants, so the
-- anon grant is revoked at both levels. PUBLIC is revoked for public only,
-- so functions postgres creates in other schemas keep their usual default.
-- Running it twice is safe.

alter default privileges for role postgres in schema public
  revoke execute on functions from anon, public;

alter default privileges for role postgres
  revoke execute on functions from anon;
