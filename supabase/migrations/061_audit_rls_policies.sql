-- 061: Close the RLS audit gaps for invitations and server-only config.
--
-- org_invites is the only table in this audit that needs direct client
-- access. Owners and admins can manage invites for an active organization
-- membership. An authenticated invitee can read only rows addressed to the
-- email in their verified Supabase JWT.
--
-- fh_app_config contains the private VAPID signing key and
-- fh_integration_secrets contains OAuth tokens. Both remain service role
-- only. RLS stays enabled and anon/authenticated retain no table grants.

alter table public.org_invites enable row level security;

drop policy if exists "org_invites_admin_read_write" on public.org_invites;
drop policy if exists "org_invites_manage_by_owner_admin" on public.org_invites;
drop policy if exists "org_invites_select_by_email" on public.org_invites;
drop policy if exists "org_invites_select_owner_admin_or_recipient" on public.org_invites;
drop policy if exists "org_invites_insert_by_owner_admin" on public.org_invites;
drop policy if exists "org_invites_delete_by_owner_admin" on public.org_invites;
drop policy if exists "org_invites_owner_admin_select" on public.org_invites;
drop policy if exists "org_invites_owner_admin_insert" on public.org_invites;
drop policy if exists "org_invites_owner_admin_delete" on public.org_invites;
drop policy if exists "org_invites_invitee_select" on public.org_invites;

create index if not exists idx_org_invites_org_id
  on public.org_invites(org_id);

create index if not exists idx_org_invites_email_lower
  on public.org_invites(lower(email));

create policy "org_invites_select_owner_admin_or_recipient"
  on public.org_invites
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.org_members m
      where m.org_id = org_invites.org_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin')
        and m.revoked_at is null
    )
    or lower(email) = lower(coalesce(((select auth.jwt()) ->> 'email'), ''))
  );

create policy "org_invites_insert_by_owner_admin"
  on public.org_invites
  for insert
  to authenticated
  with check (
    invited_by = (select auth.uid())
    and exists (
      select 1
      from public.org_members m
      where m.org_id = org_invites.org_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin')
        and m.revoked_at is null
    )
  );

create policy "org_invites_delete_by_owner_admin"
  on public.org_invites
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.org_members m
      where m.org_id = org_invites.org_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin')
        and m.revoked_at is null
    )
  );

revoke all on table public.org_invites from anon, authenticated;
grant select, insert, delete on table public.org_invites to authenticated;

alter table public.fh_app_config enable row level security;
drop policy if exists "fh_app_config_authenticated_public_read" on public.fh_app_config;
revoke all on table public.fh_app_config from anon, authenticated;

comment on table public.fh_app_config is
  'Server-only application secrets. Access is limited to the service role.';

alter table public.fh_integration_secrets enable row level security;
revoke all on table public.fh_integration_secrets from anon, authenticated;

comment on table public.fh_integration_secrets is
  'Server-only integration credentials. Access is limited to the service role.';
