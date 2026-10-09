-- 064 — Role and recipient boundaries (full audit, 2026-10-09)
--
-- Applied to production pnmhblvslftdzfcdezbw on 2026-10-09 and verified
-- with rolled back probes. This file is the exact mirror. Idempotent, no
-- DROP statements.
--
-- A. Crew and foreman members cannot read or write money records.
--    src/lib/permissions.ts says financials are owner, admin and manager
--    only (canSeeFinancials, canCreateFinancialDocs), but every fh_*
--    policy was org wide FOR ALL, so a crew member signed in to the same
--    org could read and delete payments, invoices, change orders, quote
--    line items, approved quote versions, public links, e-sign envelopes,
--    closeouts and insurance claims straight through the REST API. A
--    RESTRICTIVE policy now rejects those rows only when the caller is a
--    crew or foreman member of the row's org. Owners, admins, managers,
--    partners from other orgs (whose access is decided by the existing
--    partner policies) and the service role are unaffected. Expenses and
--    materials stay open because crew log receipts and receive materials
--    from the field (Capture sheet, Materials section).
--
-- B. Notifications are private to their recipient. fh_notifications_own
--    was org wide FOR ALL, so any teammate could read, mark read or
--    delete another member's inbox (payment amounts, approvals). Reads,
--    updates and deletes now require user_id = auth.uid(); inserts keep
--    the org check so the app can still notify a teammate (logPayment,
--    change orders, quote approval). None of those inserts read the row
--    back, so they are unaffected.
--
-- C. Insert and update checks that only validated user_id now also
--    require the row's org to be one of the caller's orgs. With 062
--    stamping org_id from the parent job, a user_id only check would let
--    an outsider post a daily log or a time punch into another company's
--    job by id. Covers fh_daily_logs (insert, update), fh_time_punches
--    (insert, update) and fh_public_links (update).

-- ---------------------------------------------------------------------
-- A. money tables are closed to crew and foreman
-- ---------------------------------------------------------------------
create or replace function public.fh_money_visible(p_org_id uuid)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select not exists (
    select 1 from public.org_members m
     where m.org_id = p_org_id
       and m.user_id = (select auth.uid())
       and m.revoked_at is null
       and m.role in ('foreman', 'crew')
  )
$$;

revoke execute on function public.fh_money_visible(uuid) from public, anon;
grant execute on function public.fh_money_visible(uuid) to authenticated, service_role;

do $$
declare
  t text;
begin
  for t in
    select unnest(array[
      'fh_payments', 'fh_invoices', 'fh_change_orders', 'fh_quote_items',
      'fh_quote_versions', 'fh_public_links', 'fh_esign_envelopes',
      'fh_closeouts', 'fh_insurance_claims'
    ])
  loop
    if to_regclass('public.' || t) is null then
      continue;
    end if;
    if exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = t
         and policyname = t || '_money_roles'
    ) then
      continue;
    end if;
    execute format(
      'create policy %I on public.%I as restrictive for all to authenticated using (public.fh_money_visible(org_id)) with check (public.fh_money_visible(org_id))',
      t || '_money_roles', t
    );
  end loop;
end
$$;

-- ---------------------------------------------------------------------
-- B. notifications are private to their recipient
-- ---------------------------------------------------------------------
alter policy "fh_notifications_own" on public.fh_notifications
  using (
    org_id in (select public.auth_user_org_ids())
    and user_id = (select auth.uid())
  )
  with check (org_id in (select public.auth_user_org_ids()));

-- ---------------------------------------------------------------------
-- C. self service writes must stay inside the caller's orgs
-- ---------------------------------------------------------------------
alter policy "fh_daily_logs_self_write" on public.fh_daily_logs
  with check (
    user_id = (select auth.uid())
    and org_id in (select public.auth_user_org_ids())
  );

alter policy "fh_daily_logs_self_update" on public.fh_daily_logs
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and org_id in (select public.auth_user_org_ids())
  );

alter policy "fh_time_punches_ins" on public.fh_time_punches
  with check (
    user_id = (select auth.uid())
    and org_id in (select public.auth_user_org_ids())
  );

alter policy "fh_time_punches_upd" on public.fh_time_punches
  using (user_id = (select auth.uid()) and approved_at is null)
  with check (
    user_id = (select auth.uid())
    and approved_at is null
    and org_id in (select public.auth_user_org_ids())
  );

alter policy "fh_public_links_update_own" on public.fh_public_links
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and org_id in (select public.auth_user_org_ids())
  );
