-- Close creator/revocation and linked-notification tenant bypasses.
-- Lock the quote/job before assigning an approved version number.
-- Historical records are not rewritten by this migration.

CREATE OR REPLACE FUNCTION public.fh_follow_up_set_status(p_notification_id uuid, p_status text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_note record;
  v_record_id uuid;
  v_follow_up_status text;
begin
  if p_status is null or p_status not in ('done', 'dismissed') then
    raise exception 'fh_follow_up_set_status: status must be done or dismissed, got %', coalesce(p_status, 'null');
  end if;
  select id, user_id, org_id, title, link into v_note from public.fh_notifications where id = p_notification_id for update;
  if v_note.id is null then
    raise exception 'fh_follow_up_set_status: notification % not found', p_notification_id;
  end if;
  if auth.uid() is null or v_note.user_id is distinct from auth.uid()
     or (v_note.org_id is not null and not public.fh_is_org_member(v_note.org_id)) then
    raise exception 'fh_follow_up_set_status: notification % does not belong to the caller', p_notification_id;
  end if;
  begin
    v_record_id := nullif(regexp_replace(coalesce(v_note.link, ''), '^.*/', ''), '')::uuid;
  exception when others then
    v_record_id := null;
  end;
  v_follow_up_status := case p_status when 'done' then 'done' else 'skipped' end;
  if v_record_id is not null then
    update public.fh_follow_ups
       set status = v_follow_up_status, completed_at = now(), completed_by = auth.uid()
     where (contact_id = v_record_id or lead_id = v_record_id or quote_id = v_record_id)
       and org_id is not distinct from v_note.org_id
       and (v_note.org_id is not null or user_id = auth.uid())
       and headline = v_note.title
       and status = 'queued';
  end if;
  update public.fh_notifications set read_at = coalesce(read_at, now()) where id = p_notification_id;
end;
$function$;

CREATE OR REPLACE FUNCTION public.fn_approve_quote_version(p_user_id uuid, p_contact_id uuid, p_snapshot jsonb, p_base_total numeric, p_optional_total numeric, p_excluded_count integer, p_approval_method text, p_approved_by_name text, p_approved_by_email text DEFAULT NULL::text, p_approval_note text DEFAULT NULL::text, p_signature_kind text DEFAULT NULL::text, p_signature_data text DEFAULT NULL::text, p_quote_id uuid DEFAULT NULL::uuid)
 RETURNS fh_quote_versions
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  caller uuid; next_version integer; new_row public.fh_quote_versions; v_quote public.fh_quotes; v_contact public.fh_contacts;
begin
  caller := auth.uid();
  if caller is null or caller <> p_user_id then raise exception 'unauthorized: caller does not match p_user_id'; end if;

  if p_quote_id is not null then
    select * into v_quote from public.fh_quotes q where q.id = p_quote_id for update;
    if v_quote.id is null then raise exception 'unauthorized: quote not accessible'; end if;
    if not ((v_quote.org_id is null and v_quote.user_id = caller) or (v_quote.org_id is not null and public.fh_is_org_member(v_quote.org_id) and public.fh_money_visible(v_quote.org_id))) then
      raise exception 'unauthorized: quote not accessible';
    end if;
    select coalesce(max(version_number), 0) + 1 into next_version from public.fh_quote_versions where quote_id = p_quote_id;
    insert into public.fh_quote_versions (user_id, org_id, contact_id, quote_id, version_number, status, snapshot, base_total, optional_total, excluded_count, approval_method, approved_by_name, approved_by_email, approval_note, signature_kind, signature_data)
    values (p_user_id, v_quote.org_id, null, p_quote_id, next_version, 'approved', p_snapshot, p_base_total, p_optional_total, p_excluded_count, p_approval_method, p_approved_by_name, p_approved_by_email, p_approval_note, p_signature_kind, p_signature_data)
    returning * into new_row;

    update public.fh_quote_versions set status = 'superseded', superseded_at = now(), superseded_by = new_row.id where quote_id = p_quote_id and id <> new_row.id and status = 'approved';
    update public.fh_quotes set approved_version_id = new_row.id, status = 'approved' where id = p_quote_id;
    return new_row;
  end if;
  if p_contact_id is null then raise exception 'p_contact_id or p_quote_id is required'; end if;
  select * into v_contact from public.fh_contacts where id = p_contact_id for update;
  if not exists (
    select 1 from public.fh_contacts c where c.id = p_contact_id and (
      (c.org_id is null and c.user_id = caller)
      or (c.org_id is not null and public.fh_is_org_member(c.org_id) and public.fh_money_visible(c.org_id))
      or exists (select 1 from public.fh_job_partners pj where pj.job_id = c.id and pj.partner_user_id = caller and pj.status = 'accepted' and pj.deleted_by_partner_at is null))
  ) then raise exception 'unauthorized: contact not accessible'; end if;
  select coalesce(max(version_number), 0) + 1 into next_version from public.fh_quote_versions where contact_id = p_contact_id;

  insert into public.fh_quote_versions (user_id, contact_id, version_number, status, snapshot, base_total, optional_total, excluded_count, approval_method, approved_by_name, approved_by_email, approval_note, signature_kind, signature_data)
  values (p_user_id, p_contact_id, next_version, 'approved', p_snapshot, p_base_total, p_optional_total, p_excluded_count, p_approval_method, p_approved_by_name, p_approved_by_email, p_approval_note, p_signature_kind, p_signature_data)
  returning * into new_row;
  update public.fh_quote_versions set status = 'superseded', superseded_at = now(), superseded_by = new_row.id where contact_id = p_contact_id and id <> new_row.id and status = 'approved';
  update public.fh_contacts set approved_quote_version_id = new_row.id, proposal_status = 'approved' where id = p_contact_id;
  return new_row;
end;
$function$;

revoke all on function public.fh_follow_up_set_status(uuid,text) from public, anon;
grant execute on function public.fh_follow_up_set_status(uuid,text) to authenticated;
revoke all on function public.fn_approve_quote_version(uuid,uuid,jsonb,numeric,numeric,integer,text,text,text,text,text,text,uuid) from public, anon;
grant execute on function public.fn_approve_quote_version(uuid,uuid,jsonb,numeric,numeric,integer,text,text,text,text,text,text,uuid) to authenticated;

-- A removed partner must lose vendor profile/document access as well as job access.
CREATE OR REPLACE FUNCTION public.fh_sub_profile_ids_for_caller()
 RETURNS SETOF uuid
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
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
          and j.deleted_by_partner_at is null
          and c.org_id = p.org_id
     )
$function$;
revoke all on function public.fh_sub_profile_ids_for_caller() from public, anon;
grant execute on function public.fh_sub_profile_ids_for_caller() to authenticated, service_role;

