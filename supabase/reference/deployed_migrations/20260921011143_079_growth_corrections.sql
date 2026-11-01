-- 079_growth_corrections.sql
-- Fixes found by an independent review of the engine against its own docs.
--   1. engine_enabled is a real master switch: runs in flight pause, holds stay held, the worker
--      skips automated sends, manual enrollment and campaign launch refuse. Human sends (sent_by_kind user)
--      still go out so the inbox keeps working while the engine is off.
--   2. Scheduled campaigns launch on time: fh_automation_tick launches fh_campaigns rows with status
--      scheduled once scheduled_at has passed.
--   3. appointment.reminder becomes a real event (emitted by the reminder sweep) so workflows can react to it.
--   4. fh_appointment_cancel_public reports whether the appointment was already cancelled or completed.
--   5. Trigger functions and the row typed booking helper are not executable through the API; the legacy
--      fh_follow_up_settings_seed is closed to anonymous callers.
-- Safe to re-run. No table is altered.

-- ---------------------------------------------------------------------------
-- 1. engine switch
-- ---------------------------------------------------------------------------
create or replace function public.fh_advance_runs(p_limit integer default 200)
returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare r record; n int := 0;
begin
  for r in select id from public.fh_workflow_runs
            where (status = 'active' or (status = 'waiting' and wait_until is not null and wait_until <= now()))
              and public.fh_engine_enabled(org_id)
            order by coalesce(wait_until, started_at) limit p_limit for update skip locked loop
    begin
      perform public.fh_advance_run(r.id);
      n := n + 1;
    exception when others then
      update public.fh_workflow_runs set status = 'failed', ended_at = now(), ended_reason = 'engine error', last_error = sqlerrm, updated_at = now() where id = r.id;
    end;
  end loop;
  return n;
end $$;

create or replace function public.fh_outbox_release_holds()
returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare r record; v_hold record; v_released int := 0;
begin
  for r in select o.*, m.purpose as m_purpose, m.client_id as m_client, m.sent_by_kind as m_by
             from public.fh_outbox o left join public.fh_messages m on m.id = o.message_id
            where o.status = 'held' and o.next_attempt_at <= now()
              and (public.fh_engine_enabled(o.org_id) or m.sent_by_kind = 'user')
            order by o.created_at limit 500
  loop
    if r.message_id is null then
      update public.fh_outbox set status = 'queued', hold_reason = null, next_attempt_at = now(), updated_at = now() where id = r.id;
      v_released := v_released + 1;
      continue;
    end if;
    select * into v_hold from public.fh_message_hold(r.org_id, r.m_client, coalesce(r.payload->>'channel', r.kind), coalesce(r.m_purpose,'transactional'), coalesce((r.payload->>'immediate')::boolean,false), r.phone_number_id);
    if v_hold.hold_reason is null then
      update public.fh_outbox set status = 'queued', hold_reason = null, next_attempt_at = now(), updated_at = now() where id = r.id;
      update public.fh_messages set status = 'queued', hold_reason = null, updated_at = now() where id = r.message_id;
      v_released := v_released + 1;
    else
      update public.fh_outbox set hold_reason = v_hold.hold_reason,
             next_attempt_at = coalesce(v_hold.retry_at, now() + interval '30 minutes'), updated_at = now() where id = r.id;
      update public.fh_messages set hold_reason = v_hold.hold_reason, updated_at = now() where id = r.message_id;
    end if;
  end loop;
  return v_released;
end $$;

create or replace function public.fh_outbox_claim(p_worker text, p_limit integer default 25)
returns setof public.fh_outbox
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  -- recover stale locks
  update public.fh_outbox set status = 'queued', locked_at = null, locked_by = null, updated_at = now()
   where status = 'processing' and locked_at < now() - interval '10 minutes';

  return query
  with c as (
    select o.id from public.fh_outbox o
     where o.status = 'queued' and o.next_attempt_at <= now()
       and (public.fh_engine_enabled(o.org_id)
            or exists (select 1 from public.fh_messages m where m.id = o.message_id and m.sent_by_kind = 'user'))
     order by o.next_attempt_at, o.created_at
     limit greatest(1, least(p_limit, 200))
     for update skip locked
  )
  update public.fh_outbox o
     set status = 'processing', locked_at = now(), locked_by = p_worker, attempts = o.attempts + 1, updated_at = now()
    from c where o.id = c.id
  returning o.*;
end $$;

create or replace function public.fh_enroll_manual(p_workflow_id uuid, p_client_ids uuid[])
returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare w record; c uuid; n int := 0;
begin
  select * into w from public.fh_workflows where id = p_workflow_id;
  if w.id is null or (auth.uid() is not null and not public.fh_is_org_member(w.org_id)) then raise exception 'not allowed'; end if;
  if not public.fh_engine_enabled(w.org_id) then raise exception 'the growth engine is off for this company'; end if;
  if w.active_version_id is null then raise exception 'publish this automation before enrolling anyone'; end if;
  foreach c in array p_client_ids loop
    if exists (select 1 from public.fh_clients where id = c and org_id = w.org_id) then
      if public.fh_enroll(p_workflow_id, c, null, null, jsonb_build_object('type','manual','by', auth.uid()), 'manual') is not null then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.fh_campaign_launch(p_campaign_id uuid, p_dry_run boolean default false)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare c record; v_filter jsonb; m record; i int := 0; v_msg uuid; v_hold text; v_start timestamptz; ctx jsonb; v_body text; v_subject text; v_html text; v_queued int := 0; v_held int := 0; v_skipped int := 0;
begin
  select * into c from public.fh_campaigns where id = p_campaign_id;
  if c.id is null then raise exception 'campaign not found'; end if;
  if auth.uid() is not null and not public.fh_is_org_manager(c.org_id) then raise exception 'not allowed'; end if;
  if c.status not in ('draft','scheduled','paused') then raise exception 'campaign is %', c.status; end if;
  v_filter := c.audience;
  if c.segment_id is not null then select filter into v_filter from public.fh_segments where id = c.segment_id; end if;
  v_start := coalesce(c.scheduled_at, now());

  if p_dry_run then
    return jsonb_build_object('audience', public.fh_segment_count(c.org_id, v_filter));
  end if;
  if not public.fh_engine_enabled(c.org_id) then raise exception 'the growth engine is off for this company'; end if;

  update public.fh_campaigns set status = 'sending', launched_at = now(), updated_at = now() where id = c.id;
  for m in select client_id from public.fh_segment_members(c.org_id, v_filter, 100000) loop
    if exists (select 1 from public.fh_campaign_recipients where campaign_id = c.id and client_id = m.client_id) then continue; end if;
    ctx := public.fh_client_ctx(m.client_id, null, jsonb_build_object('type','campaign','campaign', c.name));
    v_body := public.fh_render_template(c.body, ctx);
    v_subject := public.fh_render_template(c.subject, ctx);
    v_html := case when c.body_html is null then null else public.fh_render_template(c.body_html, ctx) end;
    begin
      v_msg := public.fh_enqueue_message(c.org_id, m.client_id, null, c.channel, v_body, v_subject, c.purpose, null, 'campaign', c.created_by, c.phone_number_id, c.id, null, false, v_html, '[]'::jsonb, '{}'::jsonb);
      select hold_reason into v_hold from public.fh_messages where id = v_msg;
      -- spread sends out over time
      update public.fh_outbox set next_attempt_at = greatest(next_attempt_at, v_start + make_interval(secs => (i * 60.0 / greatest(c.throttle_per_minute,1)))) where message_id = v_msg;
      insert into public.fh_campaign_recipients (org_id, campaign_id, client_id, message_id, status, skip_reason)
      values (c.org_id, c.id, m.client_id, v_msg, case when v_hold is null then 'queued' when v_hold in ('no_phone','no_email') then 'skipped' else 'held' end, v_hold);
      if v_hold is null then v_queued := v_queued + 1; elsif v_hold in ('no_phone','no_email') then v_skipped := v_skipped + 1; else v_held := v_held + 1; end if;
      i := i + 1;
    exception when others then
      insert into public.fh_campaign_recipients (org_id, campaign_id, client_id, status, skip_reason) values (c.org_id, c.id, m.client_id, 'skipped', sqlerrm) on conflict do nothing;
      v_skipped := v_skipped + 1;
    end;
  end loop;
  update public.fh_campaigns set stats = coalesce(stats,'{}'::jsonb) || jsonb_build_object('recipients', i + v_skipped, 'queued', v_queued, 'held', v_held, 'skipped', v_skipped), updated_at = now() where id = c.id;
  return jsonb_build_object('recipients', i + v_skipped, 'queued', v_queued, 'held', v_held, 'skipped', v_skipped);
end $$;

-- ---------------------------------------------------------------------------
-- 2. scheduled campaigns launch from the heartbeat
-- ---------------------------------------------------------------------------
create or replace function public.fh_campaigns_launch_due(p_limit integer default 20)
returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare c record; n int := 0;
begin
  for c in select id from public.fh_campaigns
            where status = 'scheduled' and scheduled_at is not null and scheduled_at <= now()
              and public.fh_engine_enabled(org_id)
            order by scheduled_at limit p_limit for update skip locked loop
    begin
      perform public.fh_campaign_launch(c.id, false);
      n := n + 1;
    exception when others then
      update public.fh_campaigns set status = 'paused', stats = coalesce(stats,'{}'::jsonb) || jsonb_build_object('launch_error', sqlerrm), updated_at = now() where id = c.id;
    end;
  end loop;
  return n;
end $$;
revoke all on function public.fh_campaigns_launch_due(integer) from public, anon, authenticated;
grant execute on function public.fh_campaigns_launch_due(integer) to service_role;

create or replace function public.fh_automation_tick()
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_dispatched int; v_advanced int; v_released int; v_queued int; v_campaigns int; v_url text; v_secret text; v_req bigint;
begin
  v_campaigns := public.fh_campaigns_launch_due(20);
  v_dispatched := public.fh_dispatch_events(500);
  v_advanced := public.fh_advance_runs(200);
  -- a run that just got enqueued by dispatch should not wait a full minute
  v_advanced := v_advanced + public.fh_advance_runs(200);
  v_released := public.fh_outbox_release_holds();
  select count(*) into v_queued from public.fh_outbox o
   where o.status = 'queued' and o.next_attempt_at <= now()
     and (public.fh_engine_enabled(o.org_id)
          or exists (select 1 from public.fh_messages m where m.id = o.message_id and m.sent_by_kind = 'user'));

  if v_queued > 0 then
    select nullif(btrim(value),'') into v_url from public.fh_app_config where key = 'growth_worker_url';
    select nullif(btrim(value),'') into v_secret from public.fh_app_config where key = 'growth_worker_secret';
    if v_url is not null and v_secret is not null and exists (select 1 from pg_extension where extname = 'pg_net') then
      begin
        execute format('select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb, timeout_milliseconds := 25000)',
          v_url, jsonb_build_object('Content-Type','application/json','Authorization','Bearer ' || v_secret)::text,
          jsonb_build_object('source','tick','queued', v_queued)::text) into v_req;
      exception when others then
        raise warning 'worker ping failed: %', sqlerrm;
      end;
    end if;
  end if;
  return jsonb_build_object('dispatched', v_dispatched, 'advanced', v_advanced, 'released', v_released, 'queued', v_queued, 'campaigns', v_campaigns, 'at', now());
end $$;

-- ---------------------------------------------------------------------------
-- 3. appointment.reminder is an event workflows can use
-- ---------------------------------------------------------------------------
create or replace function public.fh_appointment_reminders_sweep()
returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare a record; off int; n int := 0; ctx jsonb; v_body text; v_start_local text;
begin
  for a in select ap.*, bt.reminder_offsets_min, bt.reminder_sms, bt.name as type_name
             from public.fh_appointments ap join public.fh_booking_types bt on bt.id = ap.booking_type_id
            where ap.status in ('booked','confirmed') and ap.start_at > now() and ap.start_at < now() + interval '3 days'
              and public.fh_engine_enabled(ap.org_id)
  loop
    foreach off in array coalesce(a.reminder_offsets_min, '{}'::int[]) loop
      if a.start_at - make_interval(mins => off) <= now() and not (off = any (a.reminders_sent)) then
        v_start_local := to_char(a.start_at at time zone public.fh_org_tz(a.org_id), 'Dy Mon DD at HH12:MI AM');
        ctx := public.fh_client_ctx(a.client_id, a.contact_id, jsonb_build_object('type', 'appointment.reminder')) ||
               jsonb_build_object('appointment', jsonb_build_object('type', a.type_name, 'start_local', v_start_local, 'location', a.location));
        v_body := public.fh_render_template(coalesce(a.reminder_sms, 'Reminder from {{company.name}}: your {{appointment.type}} is {{appointment.start_local}}. Reply here if anything changes.'), ctx);
        perform public.fh_enqueue_message(a.org_id, a.client_id, a.contact_id, 'sms', v_body, null, 'transactional', null, 'system', null, null, null, null, false, null, '[]'::jsonb, jsonb_build_object('appointment_id', a.id, 'reminder_offset', off));
        perform public.fh_emit_event(a.org_id, 'appointment.reminder', a.client_id, a.contact_id,
          jsonb_build_object('appointment_id', a.id, 'booking_type_id', a.booking_type_id, 'type', a.type_name, 'start_at', a.start_at, 'start_local', v_start_local, 'location', a.location, 'offset_min', off),
          'sweep', 'appointment.reminder:' || a.id::text || ':' || off::text);
        update public.fh_appointments set reminders_sent = reminders_sent || off, updated_at = now() where id = a.id;
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- 4. cancel by manage token says when it was already done
-- ---------------------------------------------------------------------------
create or replace function public.fh_appointment_cancel_public(p_manage_token text, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare a record;
begin
  select * into a from public.fh_appointments where manage_token = p_manage_token;
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
  if a.status in ('cancelled','completed') then return jsonb_build_object('ok', true, 'status', a.status, 'already', true); end if;
  update public.fh_appointments set status = 'cancelled', notes = concat_ws(E'\n', notes, 'Cancelled by client' || coalesce(': ' || p_reason, '')), updated_at = now() where id = a.id;
  return jsonb_build_object('ok', true, 'status', 'cancelled', 'already', false);
end $$;

-- ---------------------------------------------------------------------------
-- 5. grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array['fh_set_org_id()', 'fh_touch_updated_at()', 'fh_booking_windows(uuid, public.fh_booking_types, date)'] loop
    if to_regprocedure('public.' || f) is not null then
      execute format('revoke all on function public.%s from public, anon, authenticated', f);
    end if;
  end loop;
  if to_regprocedure('public.fh_follow_up_settings_seed()') is not null then
    revoke all on function public.fh_follow_up_settings_seed() from public, anon;
  end if;
end $$;

