-- Partner and removal policies (DB-13, DB-14).
--
-- NEEDS OWNER APPROVAL WHEN APPLIED. This file is kept apart from the role
-- boundary file on purpose. DB-13 has to name the partner "left" column,
-- deleted_by_partner_at, and DB-14 changes the policy that covers the
-- DELETE command on time punches. Nothing here removes any object or row:
-- it adds three select only restrictive policies and narrows one existing
-- policy with alter policy. Running it twice is safe.

-- DB-13 -------------------------------------------------------------------
-- A partner who left a job (deleted_by_partner_at set) still read its
-- invoices, approved change orders and stage history, because the partner
-- branch of those three select policies did not test the left marker. The
-- live policy text is not tracked in the repository, so instead of
-- rewriting it this adds a restrictive select policy to each table: company
-- members pass, and a non member passes only while they hold an accepted,
-- not left partner row on the job, or hold no partner row on it at all
-- (the existing policy then decides as before).

do $$
declare
  t text;
begin
  foreach t in array array['fh_invoices', 'fh_change_orders', 'fh_stage_transitions']
  loop
    continue when to_regclass('public.' || t) is null;
    continue when exists (
      select 1 from pg_policies
       where schemaname = 'public' and tablename = t
         and policyname = t || '_left_partner_hidden'
    );
    execute format($p$
      create policy %1$I on public.%2$I
        as restrictive
        for select to authenticated
        using (
          org_id in (select public.auth_user_org_ids())
          or exists (
            select 1 from public.fh_job_partners p
             where p.job_id = %2$I.contact_id
               and p.partner_user_id = (select auth.uid())
               and p.status = 'accepted'
               and p.deleted_by_partner_at is null
          )
          or not exists (
            select 1 from public.fh_job_partners p
             where p.job_id = %2$I.contact_id
               and p.partner_user_id = (select auth.uid())
          )
        )
    $p$, t || '_left_partner_hidden', t);
  end loop;
end
$$;
