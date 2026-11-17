-- Customer conversations are for owners, admins and managers (DB-09,
-- tables only).
--
-- The app keeps Inbox and Compose to owners, admins and managers ("field
-- roles never see customer messages"), but the database let any member,
-- crew and foreman included, read and write fh_conversations and
-- fh_messages directly. A restrictive policy on each table now requires
-- fh_money_visible, which is false for crew and foreman, on top of the
-- existing company rule. Definer functions, triggers and the service role
-- are not affected. No crew or foreman accounts exist today.
--
-- Still open: the RPCs fh_send_message, fh_agent_run_approve,
-- fh_enroll_manual, fh_run_cancel and fh_agent_request only check
-- membership. Their live definitions are not in the repository and need to
-- be dumped before they can be changed safely.
--
-- Only create policy statements, each skipped when already present.
-- Running it twice is safe.

do $$
declare
  t text;
begin
  foreach t in array array['fh_conversations', 'fh_messages']
  loop
    continue when to_regclass('public.' || t) is null;
    continue when exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = t
         and policyname = t || '_office_roles'
    );
    execute format($p$
      create policy %1$I on public.%2$I
        as restrictive
        for all to authenticated
        using (public.fh_money_visible(org_id))
        with check (public.fh_money_visible(org_id))
    $p$, t || '_office_roles', t);
  end loop;
end
$$;
