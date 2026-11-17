-- Role boundaries the server already enforces, now also in the database.
--
-- Production today has one owner per company and no crew, foreman, manager
-- or admin accounts, so none of these limits changes anything anyone does
-- now. They close direct REST writes that skip the Netlify checks.
--
-- Only create or replace, alter policy and create policy statements.
-- Running it twice is safe.

-- DB-04 -------------------------------------------------------------------
-- Any member, crew included, could write fh_job_partners directly and mark
-- an account of their choosing as an accepted partner. That account then
-- read and edited the job, its payments and quote lines, and kept that
-- access after the member was removed.
--
-- Partner rows are now written by owners, admins and managers only (as
-- partner-invite.js already requires), and every member can still read
-- them. A signed in caller can only create pending invites and can only
-- move a status to revoked; accepting, and choosing the partner account,
-- belong to partner-invite-accept.js, which uses the service role.

alter policy "fh_job_partners_own" on public.fh_job_partners
  using (public.fh_is_org_manager(org_id))
  with check (public.fh_is_org_manager(org_id));

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'fh_job_partners'
       and policyname = 'fh_job_partners_member_read'
  ) then
    execute $p$
      create policy "fh_job_partners_member_read" on public.fh_job_partners
        for select to authenticated
        using (org_id in (select public.auth_user_org_ids()))
    $p$;
  end if;
end
$$;

create or replace function public.fh_job_partners_guard_acceptance()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- The service role (invite and accept functions) has no auth.uid().
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    if coalesce(new.status, 'pending') <> 'pending'
       or new.partner_user_id is not null
       or new.accepted_at is not null then
      raise exception 'A partner joins a job only through their invite link.'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if new.partner_user_id is distinct from old.partner_user_id
     or new.accepted_at is distinct from old.accepted_at
     or (new.status is distinct from old.status and new.status is distinct from 'revoked') then
    raise exception 'A partner joins a job only through their invite link.'
      using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function public.fh_job_partners_guard_acceptance() from public, anon, authenticated;

create or replace trigger fh_job_partners_guard_acceptance
  before insert or update on public.fh_job_partners
  for each row execute function public.fh_job_partners_guard_acceptance();

-- DB-05 -------------------------------------------------------------------
-- An admin could insert an org_invites row for the owner role straight
-- through the REST API, skipping the tier check in org-invite-create.js,
-- and then accept it with a second account to join as an owner.
--
-- The insert check now matches that function: an invite is always for a
-- role below the inviter's. Owners invite admins and below, admins invite
-- managers and below, and nobody invites an owner.

alter policy "org_invites_insert_by_owner_admin" on public.org_invites
  with check (
    invited_by = (select auth.uid())
    and exists (
      select 1
        from public.org_members m
       where m.org_id = org_invites.org_id
         and m.user_id = (select auth.uid())
         and m.revoked_at is null
         and (
           (m.role = 'owner' and org_invites.role in ('admin', 'manager', 'foreman', 'crew'))
           or (m.role = 'admin' and org_invites.role in ('manager', 'foreman', 'crew'))
         )
    )
  );
