-- 058 — Restore owner/admin/manager read access on org_members.
--
-- Migration 034 dropped every org_members SELECT policy except
-- "org_members_self_read" (own row only). That silently broke the crew
-- labor rollup (src/lib/labor.ts): it runs in the OWNER's browser and
-- looks up other members' default_hourly_rate, so RLS returned zero
-- rows and every unrated crew punch priced at $0 — the exact bug
-- migration 057 was supposed to fix ("crew labor contributed $0 to job
-- cost/margin") stayed live for any org whose punches carry no
-- snapshot rate.
--
-- Fix: members with a financials-visible role (owner, admin, manager)
-- can read the member rows of their own org. Foreman/crew keep
-- self-read only, so rates stay hidden from them.
--
-- The helper is SECURITY DEFINER because a policy on org_members whose
-- USING clause queries org_members would recurse. search_path pinned;
-- EXECUTE revoked from anon (repo convention, see migrations 043/046).

create or replace function public.fh_can_read_org_members(p_org_id uuid)
returns boolean
language sql
security definer
set search_path = public
stable
as $$
  select exists (
    select 1
    from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.revoked_at is null
      and m.role in ('owner', 'admin', 'manager')
  );
$$;

revoke execute on function public.fh_can_read_org_members(uuid) from anon;
revoke execute on function public.fh_can_read_org_members(uuid) from public;
grant execute on function public.fh_can_read_org_members(uuid) to authenticated;

drop policy if exists "org_members_financial_roles_read" on public.org_members;
create policy "org_members_financial_roles_read" on public.org_members
  for select to authenticated
  using (public.fh_can_read_org_members(org_id));
