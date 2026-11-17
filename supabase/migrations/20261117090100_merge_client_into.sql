-- Merge duplicates, one transaction (audit DATA-01, M-04).
--
-- Leads and quotes are deleted with their client (092, on delete cascade)
-- and invoices lose it (on delete set null), so a merge has to move every
-- record that points at the duplicate before the duplicate is deleted.
-- This function moves them all in one transaction and only updates rows.
-- It never deletes: the app reads every table afterwards and deletes the
-- emptied duplicate itself (src/lib/clientMerge.ts).
--
-- Tables that hold one row per client and key are folded in:
--   fh_client_tags, fh_client_fields, fh_campaign_recipients: a row moves
--     unless the kept client already has that key.
--   fh_client_attribution: moves when the kept client has none.
--   fh_consent: moves when the kept client has none; otherwise the kept
--     row takes the stricter answer (an opt out always survives).
--   fh_conversations: moves when the kept client has none; otherwise the
--     duplicate's messages, events and drafts move into the kept thread.
-- What stays on the duplicate in those tables is a copy of a row the kept
-- client already has.
--
-- Growth tables are checked with to_regclass, so the function also works
-- on a database built from this folder alone, which does not create them.
--
-- Reverse: none needed. The function only runs when called; replacing it
-- with an earlier body or leaving it unused restores the old behaviour.

create or replace function public.fh_merge_client_into(p_survivor uuid, p_duplicates uuid[])
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  v_keep public.fh_clients%rowtype;
  v_dup public.fh_clients%rowtype;
  v_dup_id uuid;
  v_n integer;
  v_jobs integer := 0;
  v_leads integer := 0;
  v_quotes integer := 0;
  v_invoices integer := 0;
  v_keep_conv uuid;
  v_dup_conv uuid;
  v_table text;
  v_left text[] := '{}';
begin
  if auth.uid() is null then
    raise exception 'sign in to merge clients' using errcode = '42501';
  end if;

  select * into v_keep from public.fh_clients where id = p_survivor for update;
  if not found then
    raise exception 'the client to keep was not found' using errcode = 'P0002';
  end if;

  if v_keep.org_id is not null then
    if not exists (
      select 1 from public.org_members m
      where m.org_id = v_keep.org_id and m.user_id = auth.uid()
        and m.revoked_at is null and m.role in ('owner', 'admin', 'manager')
    ) then
      raise exception 'not allowed to merge clients in this company' using errcode = '42501';
    end if;
  elsif v_keep.user_id is distinct from auth.uid() then
    raise exception 'not allowed to merge this client' using errcode = '42501';
  end if;

  foreach v_dup_id in array coalesce(p_duplicates, '{}') loop
    continue when v_dup_id is null or v_dup_id = p_survivor;
    select * into v_dup from public.fh_clients where id = v_dup_id for update;
    if not found then
      raise exception 'a duplicate was not found' using errcode = 'P0002';
    end if;
    if v_dup.org_id is distinct from v_keep.org_id
       or (v_keep.org_id is null and v_dup.user_id is distinct from v_keep.user_id) then
      raise exception 'clients from different companies cannot be merged' using errcode = '42501';
    end if;

    -- The records the app shows.
    update public.fh_contacts set client_id = p_survivor where client_id = v_dup_id;
    get diagnostics v_n = row_count; v_jobs := v_jobs + v_n;
    update public.fh_leads set client_id = p_survivor where client_id = v_dup_id;
    get diagnostics v_n = row_count; v_leads := v_leads + v_n;
    update public.fh_quotes set client_id = p_survivor where client_id = v_dup_id;
    get diagnostics v_n = row_count; v_quotes := v_quotes + v_n;
    update public.fh_invoices set client_id = p_survivor where client_id = v_dup_id;
    get diagnostics v_n = row_count; v_invoices := v_invoices + v_n;
    update public.fh_public_links set client_id = p_survivor where client_id = v_dup_id;
    update public.fh_selections set client_id = p_survivor where client_id = v_dup_id;
    if to_regclass('public.fh_follow_ups') is not null then
      update public.fh_follow_ups set client_id = p_survivor where client_id = v_dup_id;
    end if;

    -- Conversation thread: one per client and company.
    if to_regclass('public.fh_conversations') is not null then
      select id into v_keep_conv from public.fh_conversations where client_id = p_survivor limit 1;
      select id into v_dup_conv from public.fh_conversations where client_id = v_dup_id limit 1;
      if v_dup_conv is not null then
        if v_keep_conv is null then
          update public.fh_conversations set client_id = p_survivor where id = v_dup_conv;
        else
          update public.fh_messages set conversation_id = v_keep_conv where conversation_id = v_dup_conv;
          if to_regclass('public.fh_events') is not null then
            update public.fh_events set conversation_id = v_keep_conv where conversation_id = v_dup_conv;
          end if;
          if to_regclass('public.fh_agent_runs') is not null then
            update public.fh_agent_runs set conversation_id = v_keep_conv where conversation_id = v_dup_conv;
          end if;
          update public.fh_conversations k set
            unread_count = k.unread_count + d.unread_count,
            last_message_at = greatest(k.last_message_at, d.last_message_at),
            last_inbound_at = greatest(k.last_inbound_at, d.last_inbound_at),
            last_outbound_at = greatest(k.last_outbound_at, d.last_outbound_at),
            updated_at = now()
          from public.fh_conversations d
          where k.id = v_keep_conv and d.id = v_dup_conv;
          -- Counted once: a second run adds nothing.
          update public.fh_conversations set unread_count = 0 where id = v_dup_conv;
        end if;
      end if;
    end if;

    -- Plain client_id references.
    foreach v_table in array array['fh_messages', 'fh_events', 'fh_outbox', 'fh_agent_runs', 'fh_workflow_runs',
      'fh_appointments', 'fh_reviews', 'fh_review_requests', 'fh_form_submissions'] loop
      if to_regclass('public.' || v_table) is not null then
        execute format('update public.%I set client_id = $1 where client_id = $2', v_table) using p_survivor, v_dup_id;
      end if;
    end loop;

    -- One row per client and key.
    if to_regclass('public.fh_client_tags') is not null then
      update public.fh_client_tags d set client_id = p_survivor
      where d.client_id = v_dup_id
        and not exists (select 1 from public.fh_client_tags k where k.client_id = p_survivor and k.tag = d.tag);
    end if;
    if to_regclass('public.fh_client_fields') is not null then
      update public.fh_client_fields d set client_id = p_survivor
      where d.client_id = v_dup_id
        and not exists (select 1 from public.fh_client_fields k where k.client_id = p_survivor and k.key = d.key);
    end if;
    if to_regclass('public.fh_campaign_recipients') is not null then
      update public.fh_campaign_recipients d set client_id = p_survivor
      where d.client_id = v_dup_id
        and not exists (select 1 from public.fh_campaign_recipients k where k.client_id = p_survivor and k.campaign_id = d.campaign_id);
    end if;
    if to_regclass('public.fh_client_attribution') is not null then
      update public.fh_client_attribution d set client_id = p_survivor
      where d.client_id = v_dup_id
        and not exists (select 1 from public.fh_client_attribution k where k.client_id = p_survivor);
    end if;
    if to_regclass('public.fh_consent') is not null then
      if exists (select 1 from public.fh_consent where client_id = p_survivor) then
        update public.fh_consent k set
          sms_status = case when 'opted_out' in (k.sms_status, d.sms_status) then 'opted_out'
                            when 'opted_in' in (k.sms_status, d.sms_status) then 'opted_in' else k.sms_status end,
          email_status = case when 'opted_out' in (k.email_status, d.email_status) then 'opted_out'
                              when 'opted_in' in (k.email_status, d.email_status) then 'opted_in' else k.email_status end,
          calls_status = case when 'opted_out' in (k.calls_status, d.calls_status) then 'opted_out'
                              when 'opted_in' in (k.calls_status, d.calls_status) then 'opted_in' else k.calls_status end,
          dnd_all = k.dnd_all or d.dnd_all,
          updated_at = now()
        from public.fh_consent d
        where k.client_id = p_survivor and d.client_id = v_dup_id;
      else
        update public.fh_consent set client_id = p_survivor where client_id = v_dup_id;
      end if;
    end if;

    -- Nothing that is not a copy of the kept client's own row may remain.
    foreach v_table in array array['fh_contacts', 'fh_leads', 'fh_quotes', 'fh_invoices', 'fh_public_links',
      'fh_selections', 'fh_follow_ups', 'fh_messages', 'fh_events', 'fh_outbox', 'fh_agent_runs',
      'fh_workflow_runs', 'fh_appointments', 'fh_reviews', 'fh_review_requests', 'fh_form_submissions'] loop
      if to_regclass('public.' || v_table) is not null then
        execute format('select count(*) from public.%I where client_id = $1', v_table) into v_n using v_dup_id;
        if v_n > 0 then v_left := v_left || v_table; end if;
      end if;
    end loop;
    if array_length(v_left, 1) > 0 then
      raise exception 'records still point at the duplicate: %', array_to_string(v_left, ', ') using errcode = 'P0001';
    end if;
  end loop;

  return jsonb_build_object('jobs', v_jobs, 'leads', v_leads, 'quotes', v_quotes, 'invoices', v_invoices);
end;
$$;

revoke all on function public.fh_merge_client_into(uuid, uuid[]) from public;
revoke all on function public.fh_merge_client_into(uuid, uuid[]) from anon;
grant execute on function public.fh_merge_client_into(uuid, uuid[]) to authenticated, service_role;
