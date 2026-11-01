-- Reviewed source for the previously untracked growth RPCs. This migration
-- is prepared for staging/release review; it has NOT been applied to production.
-- Check relations before SECURITY DEFINER reads/writes, where RLS is bypassed.
-- Do not modify historical customer rows or queue outbound messages.

create or replace function public.fh_assert_growth_context(
  p_org_id uuid, p_client_id uuid, p_contact_id uuid default null,
  p_phone_number_id uuid default null
) returns void language plpgsql stable security definer
set search_path = pg_catalog, public
as $function$
begin
  if p_org_id is null or not exists (
    select 1 from public.fh_clients c where c.id = p_client_id and c.org_id = p_org_id
  ) then
    raise exception 'Customer context is not available.' using errcode = '42501';
  end if;
  if p_contact_id is not null and not exists (
    select 1 from public.fh_contacts j
    where j.id = p_contact_id and j.org_id = p_org_id and j.client_id = p_client_id
  ) then
    raise exception 'Job does not belong to this customer.' using errcode = '42501';
  end if;
  if p_phone_number_id is not null and not exists (
    select 1 from public.fh_phone_numbers n
    where n.id = p_phone_number_id and n.org_id = p_org_id
  ) then
    raise exception 'Sending number is not available.' using errcode = '42501';
  end if;
end
$function$;
revoke all on function public.fh_assert_growth_context(uuid,uuid,uuid,uuid) from public, anon, authenticated;
grant execute on function public.fh_assert_growth_context(uuid,uuid,uuid,uuid) to service_role;

CREATE OR REPLACE FUNCTION public.fh_client_ctx(p_client_id uuid, p_contact_id uuid DEFAULT NULL::uuid, p_event jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_c record; v_j record; v_cons record; v_tags jsonb; v_custom jsonb; v_company jsonb; v_set record;
  v_ctx jsonb; v_first text; v_last text; v_conv record;
begin
  select * into v_c from public.fh_clients where id = p_client_id;
  if v_c.id is null then return jsonb_build_object('now', now()); end if;
  perform public.fh_assert_growth_context(v_c.org_id, p_client_id, p_contact_id);
  select * into v_set from public.fh_org_settings where org_id = v_c.org_id;
  select coalesce(jsonb_agg(tag order by tag), '[]'::jsonb) into v_tags from public.fh_client_tags where client_id = p_client_id;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_custom from public.fh_client_fields where client_id = p_client_id;
  select * into v_cons from public.fh_consent where client_id = p_client_id;
  select * into v_conv from public.fh_conversations where client_id = p_client_id and org_id = v_c.org_id;
  if p_contact_id is not null then
    select * into v_j from public.fh_contacts where id = p_contact_id;
  else
    select * into v_j from public.fh_contacts where client_id = p_client_id and org_id = v_c.org_id
     order by case stage when 'lead' then 0 when 'quote' then 1 when 'job' then 2 when 'closed' then 3 else 4 end, updated_at desc
     limit 1;
  end if;
  v_company := public.fh_org_ctx(v_c.org_id);
  v_first := public.fh_first_name(v_c.name);
  v_last := nullif(btrim(substr(btrim(coalesce(v_c.name,'')), length(coalesce(v_first,'')) + 1)), '');

  v_ctx := jsonb_build_object(
    'now', now(),
    'client', jsonb_build_object(
      'id', v_c.id, 'name', v_c.name, 'first_name', v_first, 'last_name', v_last,
      'phone', v_c.phone, 'email', v_c.email, 'address', v_c.address, 'company_name', v_c.company_name,
      'source', v_c.source, 'notes', v_c.notes, 'created_at', v_c.created_at, 'last_activity_at', v_c.last_activity_at,
      'lifetime_value', v_c.total_lifetime_value, 'active_jobs', v_c.active_jobs_count,
      'tags', v_tags, 'custom', v_custom,
      'consent', jsonb_build_object('sms', coalesce(v_cons.sms_status,'unknown'), 'email', coalesce(v_cons.email_status,'unknown'), 'calls', coalesce(v_cons.calls_status,'unknown'), 'dnd', coalesce(v_cons.dnd_all,false)),
      'conversation', jsonb_build_object('id', v_conv.id, 'status', v_conv.status, 'assigned_to', v_conv.assigned_to,
        'last_inbound_at', v_conv.last_inbound_at, 'last_outbound_at', v_conv.last_outbound_at, 'unread', v_conv.unread_count)
    ),
    'job', case when v_j.id is null then '{}'::jsonb else jsonb_build_object(
      'id', v_j.id, 'title', v_j.job_title, 'type', v_j.job_type, 'stage', v_j.stage, 'amount', v_j.amount,
      'address', coalesce(v_j.address, v_c.address), 'source', v_j.source,
      'quote_sent_at', v_j.quote_sent_at, 'quote_expires_at', v_j.quote_expires_at, 'completed_at', v_j.completed_at,
      'follow_up_on', v_j.follow_up_on, 'created_at', v_j.created_at, 'updated_at', v_j.updated_at,
      'quote_link', case when v_j.id is not null then coalesce(v_set.app_base_url,'https://fieldhorse.app') || '/q/' || v_j.id::text end
    ) end,
    'company', v_company,
    'event', coalesce(p_event, '{}'::jsonb),
    'links', jsonb_build_object(
      'booking', v_company->>'booking_url',
      'review', v_company->>'review_link'
    ),
    -- flat aliases for short merge fields
    'first_name', coalesce(v_first, 'there'),
    'last_name', coalesce(v_last, ''),
    'name', v_c.name,
    'phone', v_c.phone,
    'email', v_c.email,
    'address', coalesce(v_j.address, v_c.address),
    'company_name', v_company->>'name',
    'company_phone', v_company->>'phone',
    'owner_first_name', v_company->>'owner_first_name',
    'review_link', v_company->>'review_link',
    'booking_link', v_company->>'booking_url'
  );
  return v_ctx;
end $function$;

CREATE OR REPLACE FUNCTION public.fh_client_ctx_app(p_client_id uuid, p_contact_id uuid DEFAULT NULL::uuid, p_event jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare v_org uuid; v_ctx jsonb;
begin
  select org_id into v_org from public.fh_clients where id = p_client_id;
  if v_org is null then raise exception 'client not found'; end if;
  if auth.uid() is not null and not public.fh_is_org_member(v_org) then raise exception 'not allowed'; end if;
  perform public.fh_assert_growth_context(v_org, p_client_id, p_contact_id);
  v_ctx := public.fh_client_ctx(p_client_id, p_contact_id, coalesce(p_event, '{}'::jsonb));
  if auth.uid() is not null and not public.fh_money_visible(v_org) then
    v_ctx := v_ctx #- '{job,amount}' #- '{client,lifetime_value}';
  end if;
  return v_ctx;
end $function$;

CREATE OR REPLACE FUNCTION public.fh_enqueue_message(p_org_id uuid, p_client_id uuid, p_contact_id uuid, p_channel text, p_body text, p_subject text DEFAULT NULL::text, p_purpose text DEFAULT 'transactional'::text, p_run_id uuid DEFAULT NULL::uuid, p_sent_by_kind text DEFAULT 'system'::text, p_sent_by_user uuid DEFAULT NULL::uuid, p_phone_number_id uuid DEFAULT NULL::uuid, p_campaign_id uuid DEFAULT NULL::uuid, p_agent_run_id uuid DEFAULT NULL::uuid, p_immediate boolean DEFAULT false, p_body_html text DEFAULT NULL::text, p_media jsonb DEFAULT '[]'::jsonb, p_extra jsonb DEFAULT '{}'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_conv uuid; v_msg uuid; v_client record; v_num uuid; v_hold record; v_status text; v_set record;
  v_to text; v_from text; v_kind text;
begin
  perform public.fh_assert_growth_context(p_org_id, p_client_id, p_contact_id, p_phone_number_id);
  select * into v_client from public.fh_clients where id = p_client_id;
  if v_client.id is null then raise exception 'client % not found', p_client_id; end if;
  if p_channel not in ('sms','mms','email','call','voice_drop','messenger','instagram') then raise exception 'unsupported channel %', p_channel; end if;
  select * into v_set from public.fh_org_settings where org_id = p_org_id;
  v_conv := public.fh_conversation_for_client(p_org_id, p_client_id);

  if p_channel in ('sms','mms','call','voice_drop') then
    v_num := coalesce(p_phone_number_id, public.fh_pick_phone_number(p_org_id, p_extra->>'from_number_tag'));
    v_to := public.fh_normalize_phone(v_client.phone);
    perform public.fh_assert_growth_context(p_org_id, p_client_id, p_contact_id, v_num);
    select e164 into v_from from public.fh_phone_numbers where id = v_num and org_id = p_org_id;
  elsif p_channel = 'email' then
    v_to := public.fh_normalize_email(v_client.email);
    v_from := coalesce(v_set.default_from_email, (select c.config->>'from_email' from public.fh_channels c where c.org_id = p_org_id and c.kind = 'email' and c.status = 'active' order by created_at limit 1));
  elsif p_channel in ('messenger','instagram') then
    select f.value #>> '{}' into v_to from public.fh_client_fields f where f.client_id = p_client_id and f.key = p_channel || '_psid';
    select c.external_id into v_from from public.fh_channels c where c.org_id = p_org_id and c.kind = 'messenger' and c.status = 'active' order by created_at limit 1;
  end if;

  select * into v_hold from public.fh_message_hold(p_org_id, p_client_id, p_channel, coalesce(p_purpose,'transactional'), coalesce(p_immediate,false), v_num);
  v_status := case when v_hold.hold_reason is null then 'queued'
                   when v_hold.hold_reason in ('no_phone','no_email') then 'failed'
                   else 'held' end;

  insert into public.fh_messages (org_id, conversation_id, client_id, contact_id, channel, direction, status, hold_reason, purpose,
    subject, body, body_html, from_address, to_address, media, sent_by_user, sent_by_kind, workflow_run_id, agent_run_id, campaign_id, phone_number_id, error)
  values (p_org_id, v_conv, p_client_id, p_contact_id,
    case when p_channel = 'voice_drop' then 'voicemail' else p_channel end,
    'outbound', v_status, v_hold.hold_reason, coalesce(p_purpose,'transactional'),
    p_subject, p_body, p_body_html, v_from, v_to, coalesce(p_media,'[]'::jsonb), p_sent_by_user, coalesce(p_sent_by_kind,'system'),
    p_run_id, p_agent_run_id, p_campaign_id, v_num,
    case when v_status = 'failed' then v_hold.hold_reason end)
  returning id into v_msg;

  if v_status <> 'failed' then
    v_kind := p_channel;
    insert into public.fh_outbox (org_id, kind, payload, status, hold_reason, next_attempt_at, run_id, message_id, client_id, campaign_id, agent_run_id, phone_number_id)
    values (p_org_id, v_kind,
      jsonb_build_object('message_id', v_msg, 'to', v_to, 'from', v_from, 'channel', p_channel, 'purpose', coalesce(p_purpose,'transactional'), 'immediate', coalesce(p_immediate,false)) || coalesce(p_extra,'{}'::jsonb),
      v_status, v_hold.hold_reason, coalesce(v_hold.retry_at, now()), p_run_id, v_msg, p_client_id, p_campaign_id, p_agent_run_id, v_num);
  end if;
  return v_msg;
end $function$;

CREATE OR REPLACE FUNCTION public.fh_send_message(p_client_id uuid, p_channel text, p_body text, p_subject text DEFAULT NULL::text, p_contact_id uuid DEFAULT NULL::uuid, p_phone_number_id uuid DEFAULT NULL::uuid, p_media jsonb DEFAULT '[]'::jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare c record; v_conv uuid; v_msg uuid;
begin
  select * into c from public.fh_clients where id = p_client_id;
  if c.id is null or (auth.uid() is not null and not public.fh_is_org_member(c.org_id)) then raise exception 'not allowed'; end if;
  perform public.fh_assert_growth_context(c.org_id, p_client_id, p_contact_id, p_phone_number_id);
  if p_channel = 'note' then
    v_conv := public.fh_conversation_for_client(c.org_id, c.id);
    insert into public.fh_messages (org_id, conversation_id, client_id, contact_id, channel, direction, status, body, sent_by_user, sent_by_kind)
    values (c.org_id, v_conv, c.id, p_contact_id, 'note', 'internal', 'sent', p_body, auth.uid(), 'user') returning id into v_msg;
    return v_msg;
  end if;
  v_msg := public.fh_enqueue_message(c.org_id, c.id, p_contact_id, p_channel, p_body, p_subject, 'transactional', null, 'user', auth.uid(), p_phone_number_id, null, null, true, null, coalesce(p_media,'[]'::jsonb), '{}'::jsonb);
  return v_msg;
end $function$;

CREATE OR REPLACE FUNCTION public.fh_agent_request(p_agent_key text, p_client_id uuid, p_instructions text DEFAULT NULL::text, p_contact_id uuid DEFAULT NULL::uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare c record; a record; v_ar uuid;
begin
  select * into c from public.fh_clients where id = p_client_id;
  if c.id is null or (auth.uid() is not null and not public.fh_is_org_member(c.org_id)) then raise exception 'not allowed'; end if;
  perform public.fh_assert_growth_context(c.org_id, p_client_id, p_contact_id);
  select * into a from public.fh_agents where org_id = c.org_id and key = p_agent_key and status = 'active';
  if a.id is null then raise exception 'agent % not found', p_agent_key; end if;
  insert into public.fh_agent_runs (org_id, agent_id, client_id, contact_id, conversation_id, trigger_kind, mode, input, status)
  values (c.org_id, a.id, c.id, p_contact_id, public.fh_conversation_for_client(c.org_id, c.id), 'inbox', 'draft',
          jsonb_build_object('instructions', p_instructions, 'requested_by', auth.uid()), 'pending')
  returning id into v_ar;
  insert into public.fh_outbox (org_id, kind, payload, client_id, agent_run_id)
  values (c.org_id, 'agent', jsonb_build_object('agent_run_id', v_ar), c.id, v_ar);
  return v_ar;
end $function$;

CREATE OR REPLACE FUNCTION public.fh_agent_run_approve(p_agent_run_id uuid, p_body text DEFAULT NULL::text, p_channel text DEFAULT NULL::text)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare ar record; v_channel text; v_body text; v_subject text; v_msg uuid; a jsonb;
begin
  select * into ar from public.fh_agent_runs where id = p_agent_run_id for update;
  if ar.id is null then raise exception 'agent run not found'; end if;
  if auth.uid() is not null and not public.fh_is_org_member(ar.org_id) then raise exception 'not allowed'; end if;
  perform public.fh_assert_growth_context(ar.org_id, ar.client_id, ar.contact_id);
  if ar.status not in ('proposed') then raise exception 'agent run is %', ar.status; end if;
  v_channel := coalesce(p_channel, ar.proposal->>'channel', 'sms');
  v_body := coalesce(p_body, ar.proposal->>'body');
  v_subject := ar.proposal->>'subject';
  if v_body is not null and v_channel in ('sms','email','messenger','instagram') then
    v_msg := public.fh_enqueue_message(ar.org_id, ar.client_id, ar.contact_id, v_channel, v_body, v_subject, 'transactional', ar.run_id, 'agent', auth.uid(), null, null, ar.id, true, null, '[]'::jsonb, '{}'::jsonb);
  end if;
  for a in select * from jsonb_array_elements(coalesce(ar.proposal->'actions','[]'::jsonb)) loop
    if a->>'type' = 'add_tag' then perform public.fh_tag_add(ar.org_id, ar.client_id, a->>'tag', 'agent', auth.uid()); end if;
    if a->>'type' = 'set_stage' and ar.contact_id is not null then update public.fh_contacts set stage = a->>'stage', updated_at = now() where id = ar.contact_id; end if;
  end loop;
  update public.fh_agent_runs set status = 'executed', approved_by = auth.uid(), approved_at = now(), executed_message_id = v_msg,
         proposal = coalesce(proposal,'{}'::jsonb) || jsonb_build_object('final_body', v_body), updated_at = now() where id = ar.id;
  return v_msg;
end $function$;

-- Replacing existing functions retains grants. Explicitly keep helpers off the
-- client RPC surface, including on a new installation.
revoke all on function public.fh_client_ctx(uuid,uuid,jsonb) from public,anon,authenticated;
revoke all on function public.fh_enqueue_message(uuid,uuid,uuid,text,text,text,text,uuid,text,uuid,uuid,uuid,uuid,boolean,text,jsonb,jsonb) from public,anon,authenticated;
grant execute on function public.fh_client_ctx(uuid,uuid,jsonb) to service_role;
grant execute on function public.fh_enqueue_message(uuid,uuid,uuid,text,text,text,text,uuid,text,uuid,uuid,uuid,uuid,boolean,text,jsonb,jsonb) to service_role;
revoke all on function public.fh_client_ctx_app(uuid,uuid,jsonb), public.fh_send_message(uuid,text,text,text,uuid,uuid,jsonb), public.fh_agent_request(text,uuid,text,uuid), public.fh_agent_run_approve(uuid,text,text) from public,anon;
grant execute on function public.fh_client_ctx_app(uuid,uuid,jsonb), public.fh_send_message(uuid,text,text,text,uuid,uuid,jsonb), public.fh_agent_request(text,uuid,text,uuid), public.fh_agent_run_approve(uuid,text,text) to authenticated,service_role;
