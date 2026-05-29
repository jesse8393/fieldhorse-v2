-- Migration 042 — wrap auth.uid() in (select auth.uid()) inside RLS policies
--
-- Problem. Supabase performance advisors flagged 31 policies across
-- 22 tables that call auth.uid() directly inside USING / WITH CHECK
-- expressions. Postgres re-evaluates a volatile function reference
-- once per row checked, so on a wide table scan (e.g. Pipeline,
-- Activity, Partners directory) the auth.uid() lookup fires
-- thousands of times for the same query.
--
-- Fix. Wrap each bare auth.uid() with (select auth.uid()). The
-- planner treats the SubPlan as an InitPlan — evaluated once, cached
-- for the rest of the query. Functionally identical (same return
-- value, same security boundary), strictly faster.
--
-- Strategy. A do-block walks pg_policies, picks the policies whose
-- expressions reference auth.uid() but don't already wrap it, and
-- DROP+CREATEs each with a regex-rewritten expression. Source text
-- comes from pg_policies (i.e. Postgres' own canonical re-print of
-- the parsed expression), so there's no risk of hand-transcription
-- errors. The block runs in a single transaction — any failure
-- aborts the whole migration.
--
-- The selection filter excludes policies that already contain
-- `(select auth.uid()` anywhere in the expression, so a policy with
-- partial-wrap is left untouched (none exist today; the audit
-- confirmed every flagged policy is fully unwrapped).
--
-- Verified before writing this migration:
--   • 31 policies across 22 tables match the rewrite filter.
--   • Each falls into one of 4 shapes: self-row predicate,
--     org_members EXISTS, fh_job_partners EXISTS, or the
--     fh_job_partners_own OR-clause. All four shapes work with the
--     wrap (the rewrite is a pure textual substitution).
--   • No policy mixes wrapped + unwrapped references, so the
--     regexp_replace is unambiguous.
--   • Idempotent: re-running this migration is a no-op because the
--     selection filter excludes already-rewritten policies.

do $$
declare
  r            record;
  new_qual     text;
  new_wc       text;
  using_clause text;
  check_clause text;
  ddl          text;
  rewritten    integer := 0;
begin
  for r in
    select schemaname, tablename, policyname, cmd, permissive, roles,
           qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (
            (qual       is not null and qual       ~ 'auth\.uid\(\)' and qual       !~* '\(\s*select\s+auth\.uid\(\)')
         or (with_check is not null and with_check ~ 'auth\.uid\(\)' and with_check !~* '\(\s*select\s+auth\.uid\(\)')
      )
  loop
    new_qual := regexp_replace(coalesce(r.qual, ''),       'auth\.uid\(\)', '(select auth.uid())', 'g');
    new_wc   := regexp_replace(coalesce(r.with_check, ''), 'auth\.uid\(\)', '(select auth.uid())', 'g');

    execute format('drop policy if exists %I on %I.%I', r.policyname, r.schemaname, r.tablename);

    using_clause := case when r.qual       is not null then format(' using (%s)',      new_qual) else '' end;
    check_clause := case when r.with_check is not null then format(' with check (%s)', new_wc)   else '' end;

    ddl := format(
      'create policy %I on %I.%I as %s for %s to %s%s%s',
      r.policyname, r.schemaname, r.tablename,
      r.permissive,
      r.cmd,
      array_to_string(r.roles, ', '),
      using_clause,
      check_clause
    );

    execute ddl;
    rewritten := rewritten + 1;
  end loop;

  raise notice 'migration 042: rewrote % RLS policies to use (select auth.uid())', rewritten;
end $$;
