-- 054 — July 2026 audit hardening
--
-- Consolidates the database-layer fixes from the July 1 2026 audit:
--   1. fh_contacts.source column (webhook-lead already writes it)
--   2. fh_public_links: close the cross-tenant token-minting hole by
--      anchoring INSERT to auth.uid() + row ownership, not just org_id
--   3. index the fh_public_links.change_order_id FK
--   4. guard trigger so a crew member can't self-approve / inflate the
--      rate on their own time punches
--   5. sanity CHECK on hourly_rate

-------------------------------------------------------------------------------
-- 1. Lead source (webhook + future attribution). Additive + nullable.
-------------------------------------------------------------------------------
alter table public.fh_contacts
  add column if not exists source text;

-------------------------------------------------------------------------------
-- 2. fh_public_links — cross-tenant isolation.
--
-- The old single "for all" policy validated only org_id on WITH CHECK, so a
-- member of org A could INSERT a row carrying another user's user_id +
-- contact_id/client_id (org_id auto-stamps to A, passing the check). The
-- public-link edge function then resolves tenancy from link.user_id with a
-- service-role client and serves the victim's data. We split the policy per
-- command and require, on INSERT, that the caller owns the row and that the
-- referenced contact/client lives in the caller's org.
-------------------------------------------------------------------------------
drop policy if exists "fh_public_links_own" on public.fh_public_links;

create policy "fh_public_links_select_own" on public.fh_public_links
  for select to authenticated
  using (org_id in (select public.auth_user_org_ids()));

create policy "fh_public_links_insert_own" on public.fh_public_links
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and org_id in (select public.auth_user_org_ids())
    and (
      (kind = 'statement' and client_id is not null and exists (
        select 1 from public.fh_clients c
        where c.id = fh_public_links.client_id
          and c.org_id = fh_public_links.org_id
      ))
      or
      (kind <> 'statement' and contact_id is not null and exists (
        select 1 from public.fh_contacts c
        where c.id = fh_public_links.contact_id
          and c.org_id = fh_public_links.org_id
      ))
    )
  );

create policy "fh_public_links_update_own" on public.fh_public_links
  for update to authenticated
  using (user_id = (select auth.uid()))
  with check (user_id = (select auth.uid()));

create policy "fh_public_links_delete_own" on public.fh_public_links
  for delete to authenticated
  using (user_id = (select auth.uid()));

-------------------------------------------------------------------------------
-- 3. Index the change_order_id FK (added in 049 without one). Every
--    fh_change_orders delete otherwise seq-scans fh_public_links.
-------------------------------------------------------------------------------
create index if not exists idx_fh_public_links_change_order
  on public.fh_public_links(change_order_id)
  where change_order_id is not null;

-------------------------------------------------------------------------------
-- 4. Time-punch approval guard.
--
-- RLS lets a member update their own punch (user_id = auth.uid()), which is
-- row-, not column-level — so a crew member could stamp approved_at /
-- approved_by, clear flagged, or raise hourly_rate on their own rows,
-- bypassing the manager-role re-check in the org-punch-approve edge function.
-- This trigger rejects self-writes to those columns. The approval edge
-- function uses a service-role client (auth.uid() IS NULL) and is exempt.
-- hourly_rate is allowed to be stamped once (NULL -> value at punch-out) but
-- may not be changed thereafter by the member.
-------------------------------------------------------------------------------
create or replace function public.fh_guard_time_punch_approval()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  -- Service role / elevated contexts have no auth.uid(); trust them.
  if auth.uid() is null then
    return new;
  end if;

  if new.approved_at   is distinct from old.approved_at
     or new.approved_by  is distinct from old.approved_by
     or new.flagged      is distinct from old.flagged
     or new.flag_reason  is distinct from old.flag_reason then
    raise exception 'time-punch approval fields are managed by the approval workflow';
  end if;

  -- Allow the initial rate snapshot (NULL -> value) but block later edits.
  if old.hourly_rate is not null
     and new.hourly_rate is distinct from old.hourly_rate then
    raise exception 'time-punch hourly_rate cannot be changed after it is set';
  end if;

  return new;
end;
$$;

drop trigger if exists fh_time_punches_guard_approval on public.fh_time_punches;
create trigger fh_time_punches_guard_approval
  before update on public.fh_time_punches
  for each row execute function public.fh_guard_time_punch_approval();

revoke execute on function public.fh_guard_time_punch_approval() from public, anon, authenticated;

-------------------------------------------------------------------------------
-- 5. Sanity bound on hourly_rate. NOT VALID so a deploy never fails on
--    legacy rows; enforced on every new insert/update.
-------------------------------------------------------------------------------
alter table public.fh_time_punches
  drop constraint if exists fh_time_punches_hourly_rate_check;
alter table public.fh_time_punches
  add constraint fh_time_punches_hourly_rate_check
  check (hourly_rate is null or (hourly_rate >= 0 and hourly_rate < 10000))
  not valid;
