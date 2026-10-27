-- Crew allocation migration generated through the Supabase CLI.
-- Verify role, tenant and concurrent booking cases in an isolated database
-- before application. Not applied to production.
-- Existing event RLS remains in force. These triggers add allocation guards.

create schema if not exists private;
create extension if not exists btree_gist with schema extensions;

alter table public.fh_schedule
  add column if not exists assigned_user_ids uuid[] not null default '{}';
create index if not exists fh_schedule_assigned_user_ids_idx
  on public.fh_schedule using gin (assigned_user_ids);

-- Migration 092 added canonical lead/quote parents to the inheritance function,
-- but the original trigger only watched contact_id and org_id. A minimal parent
-- update must inherit its company before the allocation guard and RLS run.
create or replace trigger zz_inherit_org_from_contact
  before insert or update of contact_id, lead_id, quote_id, org_id
  on public.fh_schedule for each row execute function public.fh_inherit_org_from_contact();

-- Internal reservations provide an exclusion constraint, so two concurrent
-- requests cannot both claim the same member at overlapping times.
create table if not exists private.fh_schedule_allocations (
  event_id uuid not null references public.fh_schedule(id) on delete cascade,
  scope_id uuid not null,
  member_id uuid not null references auth.users(id) on delete cascade,
  during tstzrange not null,
  primary key (event_id, member_id),
  exclude using gist (scope_id with =, member_id with =, during with &&)
);
alter table private.fh_schedule_allocations enable row level security;
revoke all on private.fh_schedule_allocations from public, anon, authenticated;

create or replace function private.fh_guard_schedule_allocation()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
declare
  actor uuid := auth.uid();
  previous_ids uuid[] := '{}';
  next_ids uuid[] := '{}';
  allocation_org uuid;
  privileged boolean := coalesce(auth.jwt()->>'role', '') = 'service_role'
    or (session_user in ('postgres', 'supabase_admin') and coalesce(current_setting('role', true), 'none') in ('none', 'postgres', 'supabase_admin'));
begin
  if tg_op <> 'INSERT' then
    select coalesce(array_agg(distinct id order by id), '{}') into previous_ids
    from unnest(coalesce(old.assigned_user_ids, '{}') || array[old.assigned_to]) id where id is not null;
  end if;
  if tg_op = 'DELETE' then
    if cardinality(previous_ids) = 0 then return old; end if;
    allocation_org := old.org_id;
  else
    -- Keep legacy single-assignee writers and the crew portal compatible.
    if tg_op = 'UPDATE' and new.assigned_user_ids is not distinct from old.assigned_user_ids
       and new.assigned_to is distinct from old.assigned_to then
      new.assigned_user_ids := case when new.assigned_to is null then '{}'::uuid[] else array[new.assigned_to] end;
    elsif tg_op = 'UPDATE' and new.assigned_user_ids is not distinct from old.assigned_user_ids then
      new.assigned_user_ids := previous_ids;
    elsif tg_op = 'INSERT' and cardinality(new.assigned_user_ids) = 0 and new.assigned_to is not null then
      new.assigned_user_ids := array[new.assigned_to];
    end if;
    select coalesce(array_agg(distinct id order by id), '{}') into next_ids
    from unnest(coalesce(new.assigned_user_ids, '{}')) id where id is not null;
    new.assigned_user_ids := next_ids;
    new.assigned_to := next_ids[1];
    if tg_op = 'UPDATE' and previous_ids = next_ids
       and new.start_at is not distinct from old.start_at
       and new.end_at is not distinct from old.end_at
       and new.org_id is not distinct from old.org_id then return new; end if;
    if cardinality(previous_ids) = 0 and cardinality(next_ids) = 0 then return new; end if;
    if tg_op = 'UPDATE' and new.org_id is distinct from old.org_id then
      raise exception 'schedule_allocation_company: Clear crew before changing the company.' using errcode = '42501';
    end if;
    allocation_org := new.org_id;
  end if;

  if not privileged then
    if actor is null or allocation_org is null or not exists (
      select 1 from public.org_members m where m.org_id = allocation_org and m.user_id = actor
      and m.revoked_at is null and m.role in ('owner', 'admin', 'manager')
    ) then
      raise exception 'schedule_allocation_permission: Manager access required.' using errcode = '42501';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  if cardinality(next_ids) = 0 then return new; end if;
  if allocation_org is null or exists (
    select 1 from unnest(next_ids) selected_id where not exists (
      select 1 from public.org_members m where m.org_id = allocation_org
      and m.user_id = selected_id and m.revoked_at is null
    )
  ) then
    raise exception 'schedule_allocation_member: Choose active members of this company.' using errcode = '23514';
  end if;
  if new.start_at is null or new.end_at is null or new.end_at <= new.start_at then
    raise exception 'Assigned visits require a valid start and end time.' using errcode = '23514';
  end if;

  -- Legacy rows are checked directly. They are deliberately not bulk inserted
  -- into the exclusion table because existing conflicting history must not
  -- make this schema change fail or silently rewrite customer schedules.
  if exists (
    select 1 from public.fh_schedule s
    where s.id <> new.id and s.org_id = allocation_org
      and (coalesce(s.assigned_user_ids, '{}') || array[s.assigned_to]) && next_ids
      and s.start_at < new.end_at
      and coalesce(s.end_at, s.start_at + interval '1 hour') > new.start_at
  ) then
    raise exception 'schedule_allocation_conflict: A crew member already has a visit at this time.' using errcode = '23P01';
  end if;
  return new;
end;
$$;
revoke all on function private.fh_guard_schedule_allocation() from public, anon, authenticated;

drop trigger if exists zz_fh_guard_schedule_allocation on public.fh_schedule;
-- Runs after fh_set_org_id_trg and zz_inherit_org_from_contact on INSERT.
drop trigger if exists zzz_fh_guard_schedule_allocation on public.fh_schedule;
create trigger zzz_fh_guard_schedule_allocation
before insert or update of assigned_user_ids, assigned_to, start_at, end_at, org_id, contact_id, lead_id, quote_id or delete
on public.fh_schedule for each row execute function private.fh_guard_schedule_allocation();

create or replace function private.fh_sync_schedule_allocations()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, extensions
as $$
begin
  if tg_op = 'UPDATE' and new.start_at is not distinct from old.start_at
     and new.end_at is not distinct from old.end_at and new.org_id is not distinct from old.org_id
     and new.assigned_user_ids = (select coalesce(array_agg(distinct id order by id), '{}')
       from unnest(coalesce(old.assigned_user_ids, '{}') || array[old.assigned_to]) id where id is not null)
  then return new; end if;
  delete from private.fh_schedule_allocations where event_id = new.id;
  insert into private.fh_schedule_allocations(event_id, scope_id, member_id, during)
    select new.id, new.org_id, id, tstzrange(new.start_at, new.end_at, '[)')
    from unnest(new.assigned_user_ids) id;
  return new;
end;
$$;
revoke all on function private.fh_sync_schedule_allocations() from public, anon, authenticated;
drop trigger if exists fh_sync_schedule_allocations on public.fh_schedule;
create trigger fh_sync_schedule_allocations
  after insert or update of assigned_user_ids, assigned_to, start_at, end_at, org_id, contact_id, lead_id, quote_id
  on public.fh_schedule for each row execute function private.fh_sync_schedule_allocations();

-- Verification required before application:
-- 1. Owner/admin/manager can assign two active members in their company.
-- 2. Crew, foreman, revoked, foreign-company and anonymous users cannot change
--    assignment, move an assigned visit or delete an assigned visit.
-- 3. Cross-company and revoked assignees fail, even with forged REST requests.
-- 4. Adjacent visits succeed; overlaps fail, including across midnight and
--    recurring occurrences. Two concurrent bookings yield exactly one success.
-- 5. Updating one visit excludes its own reservations; deletion frees slots.
-- 6. Unassigned and legacy visits still work; legacy overlaps are not rewritten.
-- 7. Private reservations cannot be selected or changed through the Data API.
