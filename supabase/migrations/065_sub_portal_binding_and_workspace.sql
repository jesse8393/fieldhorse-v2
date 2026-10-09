-- 065_sub_portal_binding_and_workspace.sql
--
-- Applied to production on 2026-10-09 through the SQL editor path, in the
-- same drop free style as 062 to 064 (every statement is idempotent).
--
-- A. Vendor profile emails are stored lowercased and trimmed. The sub portal
--    functions match fh_sub_profiles.email with exact equality against the
--    caller's lowercased auth email (exact on purpose: LIKE patterns would let
--    "_" and "%" in a caller's address match other subs). The contractor UI
--    saved emails as typed, so "Mike.Diaz@Gmail.com" never matched.
-- B. identity_key gives a vendor profile a stable link to the sub key it was
--    created from, so editing the phone no longer detaches the profile.
-- C. Sub portal binding. This project confirms emails automatically at sign
--    up, so an auth email alone proves nothing: anyone could register with a
--    sub's address and read or rewrite that sub's profile at every contractor.
--    A sub may act on a vendor profile only when the email matches AND the
--    caller accepted a job invite in that contractor's org (the invite token
--    is delivered to that address, which proves possession).
-- D. Vendor profiles hold tax ids, insurance and payment handles, so foreman
--    and crew members lose access, matching the money roles rule from 064.
-- E. sub-docs storage. The only policy keyed the first folder to auth.uid(),
--    so a contractor could not open a document the sub uploaded, an admin who
--    did not create the profile could not upload or view, and the sub could
--    not open a document the contractor uploaded.
-- F. fh_set_org_id honors the workspace the app is showing (request header
--    x-fh-org-id, checked against the caller's active memberships) and then
--    prefers an owner membership over the newest one, so a contractor who
--    joins another company as crew keeps creating rows in their own book.
-- G. Indexes for foreign keys and policy lookups that were scanning tables.
-- H. In app quote approval works for owners, admins and managers in the
--    job's org, not only for the person who created the job.
-- I. Owners, admins and managers can update or revoke any customer link in
--    their org, not only links they created.

-- A ----------------------------------------------------------------------

create or replace function public.fh_sub_profiles_normalize_email()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
begin
  new.email := nullif(lower(btrim(new.email)), '');
  return new;
end
$$;

create or replace trigger fh_sub_profiles_normalize_email
  before insert or update of email on public.fh_sub_profiles
  for each row execute function public.fh_sub_profiles_normalize_email();

update public.fh_sub_profiles
   set email = nullif(lower(btrim(email)), '')
 where email is distinct from nullif(lower(btrim(email)), '');

-- B ----------------------------------------------------------------------

alter table public.fh_sub_profiles add column if not exists identity_key text;

create index if not exists fh_sub_profiles_org_identity_key_idx
  on public.fh_sub_profiles (org_id, identity_key);

create index if not exists fh_sub_profiles_email_idx
  on public.fh_sub_profiles (email);

-- C ----------------------------------------------------------------------

create or replace function public.fh_sub_profile_ids_for_caller()
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select p.id
    from public.fh_sub_profiles p
   where p.email is not null
     and p.email = (select lower(u.email) from auth.users u where u.id = (select auth.uid()))
     and exists (
       select 1
         from public.fh_job_partners j
         join public.fh_contacts c on c.id = j.job_id
        where j.partner_user_id = (select auth.uid())
          and j.status = 'accepted'
          and c.org_id = p.org_id
     )
$$;

revoke all on function public.fh_sub_profile_ids_for_caller() from public, anon;
grant execute on function public.fh_sub_profile_ids_for_caller() to authenticated;

-- D ----------------------------------------------------------------------

do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'fh_sub_profiles'
       and policyname = 'fh_sub_profiles_money_roles'
  ) then
    create policy "fh_sub_profiles_money_roles" on public.fh_sub_profiles
      as restrictive for all to authenticated
      using (public.fh_money_visible(org_id))
      with check (public.fh_money_visible(org_id));
  end if;
end
$$;

-- E ----------------------------------------------------------------------

-- Contractor side: a manager (any role allowed to see money) in the profile's
-- org may read documents the profile references, and may write documents
-- under org/<org_id>/<profile_id>/.
create or replace function public.fh_org_can_write_sub_doc(p_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.fh_sub_profiles p
     where (storage.foldername(p_path))[1] = 'org'
       and p.org_id::text = (storage.foldername(p_path))[2]
       and p.id::text = (storage.foldername(p_path))[3]
       and public.fh_is_org_member(p.org_id)
       and public.fh_money_visible(p.org_id)
  )
$$;

create or replace function public.fh_org_can_read_sub_doc(p_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select public.fh_org_can_write_sub_doc(p_path)
      or exists (
        select 1
          from public.fh_sub_profiles p
         where p_path in (p.coi_path, p.w9_path, p.license_path)
           and public.fh_is_org_member(p.org_id)
           and public.fh_money_visible(p.org_id)
      )
$$;

-- Sub side: the bound sub may read any document on a profile they may act on,
-- including ones the contractor uploaded.
create or replace function public.fh_sub_can_read_doc(p_path text)
returns boolean
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1
      from public.fh_sub_profiles p
     where p.id in (select public.fh_sub_profile_ids_for_caller())
       and p_path in (p.coi_path, p.w9_path, p.license_path)
  )
$$;

revoke all on function public.fh_org_can_write_sub_doc(text) from public, anon;
revoke all on function public.fh_org_can_read_sub_doc(text) from public, anon;
revoke all on function public.fh_sub_can_read_doc(text) from public, anon;
grant execute on function public.fh_org_can_write_sub_doc(text) to authenticated;
grant execute on function public.fh_org_can_read_sub_doc(text) to authenticated;
grant execute on function public.fh_sub_can_read_doc(text) to authenticated;

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'sub_docs_org_read') then
    create policy "sub_docs_org_read" on storage.objects
      for select to authenticated
      using (bucket_id = 'sub-docs' and public.fh_org_can_read_sub_doc(name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'sub_docs_org_insert') then
    create policy "sub_docs_org_insert" on storage.objects
      for insert to authenticated
      with check (bucket_id = 'sub-docs' and public.fh_org_can_write_sub_doc(name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'sub_docs_org_update') then
    create policy "sub_docs_org_update" on storage.objects
      for update to authenticated
      using (bucket_id = 'sub-docs' and public.fh_org_can_write_sub_doc(name))
      with check (bucket_id = 'sub-docs' and public.fh_org_can_write_sub_doc(name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'sub_docs_org_remove') then
    create policy "sub_docs_org_remove" on storage.objects
      for delete to authenticated
      using (bucket_id = 'sub-docs' and public.fh_org_can_write_sub_doc(name));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'sub_docs_sub_read') then
    create policy "sub_docs_sub_read" on storage.objects
      for select to authenticated
      using (bucket_id = 'sub-docs' and public.fh_sub_can_read_doc(name));
  end if;
end
$$;

-- F ----------------------------------------------------------------------

create or replace function public.fh_set_org_id()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_org_id uuid;
  v_hint text;
begin
  -- A caller supplied org_id wins. RLS with check still decides whether the
  -- caller may write there.
  if new.org_id is not null then
    return new;
  end if;

  -- Service role and anonymous contexts leave org_id to the caller.
  if auth.uid() is null then
    return new;
  end if;

  -- The workspace the app is showing, sent as a request header.
  begin
    v_hint := (nullif(current_setting('request.headers', true), '')::json) ->> 'x-fh-org-id';
  exception when others then
    v_hint := null;
  end;

  if v_hint ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    select om.org_id
      into v_org_id
      from public.org_members om
     where om.user_id = auth.uid()
       and om.revoked_at is null
       and om.org_id = v_hint::uuid;
  end if;

  if v_org_id is null then
    select om.org_id
      into v_org_id
      from public.org_members om
     where om.user_id = auth.uid()
       and om.revoked_at is null
     order by (om.role = 'owner') desc, om.joined_at desc
     limit 1;
  end if;

  if v_org_id is not null then
    new.org_id := v_org_id;
  end if;

  return new;
end
$$;

-- G ----------------------------------------------------------------------

create index if not exists fh_schedule_contact_id_idx on public.fh_schedule (contact_id);
create index if not exists fh_contacts_approved_quote_version_id_idx on public.fh_contacts (approved_quote_version_id) where approved_quote_version_id is not null;
create index if not exists fh_mileage_contact_id_idx on public.fh_mileage (contact_id);
create index if not exists fh_public_link_events_contact_id_idx on public.fh_public_link_events (contact_id);
create index if not exists fh_selections_client_id_idx on public.fh_selections (client_id);
create index if not exists fh_quote_versions_superseded_by_idx on public.fh_quote_versions (superseded_by) where superseded_by is not null;
create index if not exists fh_quote_versions_signature_file_id_idx on public.fh_quote_versions (signature_file_id) where signature_file_id is not null;
create index if not exists fh_quote_versions_pdf_file_id_idx on public.fh_quote_versions (pdf_file_id) where pdf_file_id is not null;

-- H ----------------------------------------------------------------------
-- In app quote approval: only the job's creator or an accepted partner could
-- record a customer's approval, so an owner, admin or manager approving a
-- teammate's job got "contact not accessible". Money roles in the job's org
-- may now approve; crew and foreman still cannot (quote versions are money
-- rows under 064). Body otherwise unchanged from the live definition.

CREATE OR REPLACE FUNCTION public.fn_approve_quote_version(p_user_id uuid, p_contact_id uuid, p_snapshot jsonb, p_base_total numeric, p_optional_total numeric, p_excluded_count integer, p_approval_method text, p_approved_by_name text, p_approved_by_email text DEFAULT NULL::text, p_approval_note text DEFAULT NULL::text, p_signature_kind text DEFAULT NULL::text, p_signature_data text DEFAULT NULL::text)
 RETURNS fh_quote_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  caller uuid;
  next_version integer;
  new_row public.fh_quote_versions;
begin
  caller := auth.uid();
  if caller is null or caller <> p_user_id then
    raise exception 'unauthorized: caller does not match p_user_id';
  end if;

  if not exists (
    select 1
    from public.fh_contacts c
    where c.id = p_contact_id
      and (
        c.user_id = caller
        or (
          c.org_id is not null
          and public.fh_is_org_member(c.org_id)
          and public.fh_money_visible(c.org_id)
        )
        or exists (
          select 1 from public.fh_job_partners pj
          where pj.job_id = c.id
            and pj.partner_user_id = caller
            and pj.status = 'accepted'
            and pj.deleted_by_partner_at is null
        )
      )
  ) then
    raise exception 'unauthorized: contact not accessible';
  end if;

  select coalesce(max(version_number), 0) + 1
    into next_version
    from public.fh_quote_versions
    where contact_id = p_contact_id;

  insert into public.fh_quote_versions (
    user_id, contact_id, version_number, status,
    snapshot, base_total, optional_total, excluded_count,
    approval_method, approved_by_name, approved_by_email, approval_note,
    signature_kind, signature_data
  )
  values (
    p_user_id, p_contact_id, next_version, 'approved',
    p_snapshot, p_base_total, p_optional_total, p_excluded_count,
    p_approval_method, p_approved_by_name, p_approved_by_email, p_approval_note,
    p_signature_kind, p_signature_data
  )
  returning * into new_row;

  update public.fh_quote_versions
     set status = 'superseded',
         superseded_at = now(),
         superseded_by = new_row.id
   where contact_id = p_contact_id
     and id <> new_row.id
     and status = 'approved';

  update public.fh_contacts
     set approved_quote_version_id = new_row.id,
         proposal_status = 'approved'
   where id = p_contact_id;

  return new_row;
end;
$function$;

-- I ----------------------------------------------------------------------
-- Customer links: only the link's creator could update or revoke it, so an
-- admin could not revoke a teammate's proposal or invoice link. Org members
-- may now update and remove links in their org; the restrictive money roles
-- policy from 064 still keeps crew and foreman out, and the update check
-- keeps the same shape rule the insert policy enforces.

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fh_public_links' and policyname = 'fh_public_links_org_update') then
    create policy "fh_public_links_org_update" on public.fh_public_links
      for update to authenticated
      using (org_id in (select public.auth_user_org_ids()))
      with check (org_id in (select public.auth_user_org_ids()));
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'fh_public_links' and policyname = 'fh_public_links_org_remove') then
    create policy "fh_public_links_org_remove" on public.fh_public_links
      for delete to authenticated
      using (org_id in (select public.auth_user_org_ids()));
  end if;
end
$$;

alter policy "fh_public_links_org_update" on public.fh_public_links
  using (org_id in (select public.auth_user_org_ids()))
  with check (
    org_id in (select public.auth_user_org_ids())
    and (
      (kind = 'statement' and client_id is not null and exists (
        select 1 from public.fh_clients c where c.id = fh_public_links.client_id and c.org_id = fh_public_links.org_id))
      or (kind <> 'statement' and contact_id is not null and exists (
        select 1 from public.fh_contacts c where c.id = fh_public_links.contact_id and c.org_id = fh_public_links.org_id))
    )
  );
