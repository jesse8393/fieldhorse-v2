-- =============================================================================
-- 077_growth_messenger.sql
-- Messenger and Instagram DMs as first class channels in the outbox.
-- =============================================================================

alter table public.fh_outbox drop constraint if exists fh_outbox_kind_check;
alter table public.fh_outbox add constraint fh_outbox_kind_check
  check (kind in ('sms','mms','email','call','voice_drop','webhook','agent','push','messenger','instagram'));

-- hold rules for DM channels: needs a stored platform id, respects DND
create or replace function public.fh_message_hold(
  p_org_id uuid, p_client_id uuid, p_channel text, p_purpose text,
  p_immediate boolean, p_phone_number_id uuid,
  out hold_reason text, out retry_at timestamptz
)
language plpgsql stable
set search_path = pg_catalog, public
as $$
declare v_set record; v_cons record; v_num record; v_today_count int; v_client record;
begin
  hold_reason := null; retry_at := null;
  select * into v_set from public.fh_org_settings where org_id = p_org_id;
  select * into v_cons from public.fh_consent where client_id = p_client_id;
  select * into v_client from public.fh_clients where id = p_client_id;

  if coalesce(v_cons.dnd_all, false) then hold_reason := 'dnd'; return; end if;

  if p_channel in ('sms','mms') then
    if public.fh_normalize_phone(v_client.phone) is null then hold_reason := 'no_phone'; return; end if;
    if coalesce(v_cons.sms_status,'unknown') = 'opted_out' then hold_reason := 'opted_out'; return; end if;
    if p_purpose = 'marketing' and coalesce(v_set.sms_policy,'strict') = 'strict' and coalesce(v_cons.sms_status,'unknown') <> 'opted_in' then
      hold_reason := 'consent_required'; return;
    end if;
    if p_phone_number_id is null then hold_reason := 'no_number'; return; end if;
    select * into v_num from public.fh_phone_numbers where id = p_phone_number_id;
    if v_num.id is null or v_num.status <> 'active' then hold_reason := 'no_number'; return; end if;
    if v_num.sms_status <> 'approved' then hold_reason := 'a2p_pending'; return; end if;
    if not p_immediate and coalesce(v_set.hold_all_outside_window, true) and not public.fh_in_send_window(p_org_id) then
      hold_reason := 'quiet_hours'; retry_at := public.fh_next_send_window_start(p_org_id); return;
    end if;
    select count(*) into v_today_count from public.fh_messages m
     where m.phone_number_id = p_phone_number_id and m.direction = 'outbound' and m.channel in ('sms','mms')
       and m.status in ('sending','sent','delivered') and m.created_at >= date_trunc('day', now() at time zone coalesce(v_set.timezone,'America/Chicago')) at time zone coalesce(v_set.timezone,'America/Chicago');
    if v_today_count >= coalesce(v_num.daily_sms_cap, 1000) then
      hold_reason := 'daily_cap'; retry_at := public.fh_next_send_window_start(p_org_id); return;
    end if;
    return;
  end if;

  if p_channel = 'email' then
    if public.fh_normalize_email(v_client.email) is null then hold_reason := 'no_email'; return; end if;
    if coalesce(v_cons.email_status,'unknown') = 'opted_out' then hold_reason := 'opted_out'; return; end if;
    if v_set.default_from_email is null and not exists (select 1 from public.fh_channels c where c.org_id = p_org_id and c.kind = 'email' and c.status = 'active') then
      hold_reason := 'no_channel'; return;
    end if;
    return;
  end if;

  if p_channel in ('messenger','instagram') then
    if not exists (select 1 from public.fh_client_fields f where f.client_id = p_client_id and f.key = p_channel || '_psid') then
      hold_reason := 'no_channel'; return;
    end if;
    if not exists (select 1 from public.fh_channels c where c.org_id = p_org_id and c.kind = 'messenger' and c.status = 'active') then
      hold_reason := 'no_channel'; return;
    end if;
    return;
  end if;

  if p_channel in ('call','voice_drop') then
    if public.fh_normalize_phone(v_client.phone) is null then hold_reason := 'no_phone'; return; end if;
    if coalesce(v_cons.calls_status,'unknown') = 'opted_out' then hold_reason := 'opted_out'; return; end if;
    if p_channel = 'voice_drop' and coalesce(v_cons.calls_status,'unknown') <> 'opted_in' then hold_reason := 'consent_required'; return; end if;
    if not p_immediate and not public.fh_in_send_window(p_org_id) then
      hold_reason := 'quiet_hours'; retry_at := public.fh_next_send_window_start(p_org_id); return;
    end if;
    return;
  end if;
  return;
end $$;

-- enqueue: DM channels address the platform id
create or replace function public.fh_enqueue_message(
  p_org_id uuid,
  p_client_id uuid,
  p_contact_id uuid,
  p_channel text,
  p_body text,
  p_subject text default null,
  p_purpose text default 'transactional',
  p_run_id uuid default null,
  p_sent_by_kind text default 'system',
  p_sent_by_user uuid default null,
  p_phone_number_id uuid default null,
  p_campaign_id uuid default null,
  p_agent_run_id uuid default null,
  p_immediate boolean default false,
  p_body_html text default null,
  p_media jsonb default '[]'::jsonb,
  p_extra jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_conv uuid; v_msg uuid; v_client record; v_num uuid; v_hold record; v_status text; v_set record;
  v_to text; v_from text; v_kind text;
begin
  select * into v_client from public.fh_clients where id = p_client_id;
  if v_client.id is null then raise exception 'client % not found', p_client_id; end if;
  if p_channel not in ('sms','mms','email','call','voice_drop','messenger','instagram') then raise exception 'unsupported channel %', p_channel; end if;
  select * into v_set from public.fh_org_settings where org_id = p_org_id;
  v_conv := public.fh_conversation_for_client(p_org_id, p_client_id);

  if p_channel in ('sms','mms','call','voice_drop') then
    v_num := coalesce(p_phone_number_id, public.fh_pick_phone_number(p_org_id, p_extra->>'from_number_tag'));
    v_to := public.fh_normalize_phone(v_client.phone);
    select e164 into v_from from public.fh_phone_numbers where id = v_num;
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
end $$;

-- inbox send: allow DM channels
create or replace function public.fh_send_message(p_client_id uuid, p_channel text, p_body text, p_subject text default null, p_contact_id uuid default null, p_phone_number_id uuid default null, p_media jsonb default '[]'::jsonb)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare c record; v_conv uuid; v_msg uuid;
begin
  select * into c from public.fh_clients where id = p_client_id;
  if c.id is null or (auth.uid() is not null and not public.fh_is_org_member(c.org_id)) then raise exception 'not allowed'; end if;
  if p_channel = 'note' then
    v_conv := public.fh_conversation_for_client(c.org_id, c.id);
    insert into public.fh_messages (org_id, conversation_id, client_id, contact_id, channel, direction, status, body, sent_by_user, sent_by_kind)
    values (c.org_id, v_conv, c.id, p_contact_id, 'note', 'internal', 'sent', p_body, auth.uid(), 'user') returning id into v_msg;
    return v_msg;
  end if;
  v_msg := public.fh_enqueue_message(c.org_id, c.id, p_contact_id, p_channel, p_body, p_subject, 'transactional', null, 'user', auth.uid(), p_phone_number_id, null, null, true, null, coalesce(p_media,'[]'::jsonb), '{}'::jsonb);
  return v_msg;
end $$;

-- agent approvals may answer on the channel the client used
create or replace function public.fh_agent_run_approve(p_agent_run_id uuid, p_body text default null, p_channel text default null)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare ar record; v_channel text; v_body text; v_subject text; v_msg uuid; a jsonb;
begin
  select * into ar from public.fh_agent_runs where id = p_agent_run_id;
  if ar.id is null then raise exception 'agent run not found'; end if;
  if auth.uid() is not null and not public.fh_is_org_member(ar.org_id) then raise exception 'not allowed'; end if;
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
end $$;

