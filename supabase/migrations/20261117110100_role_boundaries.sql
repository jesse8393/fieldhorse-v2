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

-- DB-08 -------------------------------------------------------------------
-- Any member could put their own hourly_rate on a punch when creating it or
-- at clock out, and approval kept that rate, so crew could set their own
-- pay. Rates are hidden from managers in the app, so only owners and admins
-- choose one.
--
-- When anyone else sets a rate (on insert, or the first time on a later
-- update) the punch takes that member's own default rate from org_members
-- instead, or stays unrated when they have none. Clock out keeps working;
-- the app already sends the member rate there. Everything the guard did
-- before is unchanged, and the service role (approval) is still trusted.

create or replace function public.fh_guard_time_punch_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_rate numeric;
begin
  -- Service role / elevated contexts have no auth.uid(); trust them.
  if auth.uid() is null then
    return new;
  end if;

  if tg_op = 'INSERT' then
    -- A member creating their own punch must not pre-set approval or flag
    -- columns.
    if new.approved_at is not null
       or new.approved_by is not null
       or new.flagged is true
       or new.flag_reason is not null then
      raise exception 'time-punch approval/flag fields cannot be set on insert';
    end if;
  else
    if new.approved_at   is distinct from old.approved_at
       or new.approved_by  is distinct from old.approved_by
       or new.flagged      is distinct from old.flagged
       or new.flag_reason  is distinct from old.flag_reason then
      raise exception 'time-punch approval fields are managed by the approval workflow';
    end if;

    -- The rate is stamped once (null to a value) and then fixed.
    if old.hourly_rate is not null
       and new.hourly_rate is distinct from old.hourly_rate then
      raise exception 'time-punch hourly_rate cannot be changed after it is set';
    end if;
  end if;

  -- Only owners and admins choose a rate. Anyone else gets the punch
  -- owner's member rate.
  if new.hourly_rate is not null
     and (tg_op = 'INSERT' or old.hourly_rate is null)
     and not exists (
       select 1 from public.org_members m
        where m.org_id = new.org_id
          and m.user_id = auth.uid()
          and m.revoked_at is null
          and m.role in ('owner', 'admin')
     ) then
    select m.default_hourly_rate into v_rate
      from public.org_members m
     where m.org_id = new.org_id
       and m.user_id = new.user_id
       and m.revoked_at is null
     limit 1;
    new.hourly_rate := v_rate;
  end if;

  return new;
end;
$$;
