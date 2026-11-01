-- =============================================================================
-- 073_growth_capture_booking_campaigns.sql
-- Forms (lead capture), booking types + appointments, reviews feed,
-- campaigns (blasts), segments (smart lists), attribution, report views.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Forms
-- ---------------------------------------------------------------------------
create table if not exists public.fh_forms (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  fields jsonb not null default '[]'::jsonb,
  settings jsonb not null default '{"create_job":true,"tags":["website_lead"],"source":"website","notify":true}'::jsonb,
  public_key text not null unique default public.fh_random_key(16),
  status text not null default 'active' check (status in ('active','disabled')),
  submissions_count integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create table if not exists public.fh_form_submissions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  form_id uuid not null references public.fh_forms(id) on delete cascade,
  client_id uuid references public.fh_clients(id) on delete set null,
  contact_id uuid references public.fh_contacts(id) on delete set null,
  data jsonb not null default '{}'::jsonb,
  attribution jsonb not null default '{}'::jsonb,
  ip_hash text,
  user_agent text,
  created_at timestamptz not null default now()
);
create index if not exists fh_form_submissions_org_idx on public.fh_form_submissions(org_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Attribution
-- ---------------------------------------------------------------------------
create table if not exists public.fh_lead_sources (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  kind text not null default 'other' check (kind in ('paid_social','paid_search','organic','referral','direct','offline','partner','other')),
  monthly_cost numeric not null default 0,
  created_at timestamptz not null default now(),
  unique (org_id, key)
);

create table if not exists public.fh_client_attribution (
  client_id uuid primary key references public.fh_clients(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  first_source text, first_medium text, first_campaign text, first_content text, first_term text,
  first_ad_id text, first_form_key text, first_landing_url text, first_referrer text, first_touch_at timestamptz,
  last_source text, last_medium text, last_campaign text, last_content text, last_term text,
  last_ad_id text, last_form_key text, last_landing_url text, last_referrer text, last_touch_at timestamptz,
  touches integer not null default 0,
  raw jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fh_client_attribution_org_src_idx on public.fh_client_attribution(org_id, first_source);

create or replace function public.fh_attribution_touch(p_org_id uuid, p_client_id uuid, p_attr jsonb)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare a jsonb := coalesce(p_attr, '{}'::jsonb); v_src text;
begin
  v_src := coalesce(a->>'source', a->>'utm_source', a->>'src');
  insert into public.fh_client_attribution (client_id, org_id,
    first_source, first_medium, first_campaign, first_content, first_term, first_ad_id, first_form_key, first_landing_url, first_referrer, first_touch_at,
    last_source, last_medium, last_campaign, last_content, last_term, last_ad_id, last_form_key, last_landing_url, last_referrer, last_touch_at,
    touches, raw)
  values (p_client_id, p_org_id,
    v_src, coalesce(a->>'medium', a->>'utm_medium'), coalesce(a->>'campaign', a->>'utm_campaign'), coalesce(a->>'content', a->>'utm_content'), coalesce(a->>'term', a->>'utm_term'),
    a->>'ad_id', a->>'form_key', a->>'landing_url', a->>'referrer', now(),
    v_src, coalesce(a->>'medium', a->>'utm_medium'), coalesce(a->>'campaign', a->>'utm_campaign'), coalesce(a->>'content', a->>'utm_content'), coalesce(a->>'term', a->>'utm_term'),
    a->>'ad_id', a->>'form_key', a->>'landing_url', a->>'referrer', now(),
    1, jsonb_build_array(a || jsonb_build_object('at', now())))
  on conflict (client_id) do update set
    last_source = coalesce(excluded.last_source, public.fh_client_attribution.last_source),
    last_medium = coalesce(excluded.last_medium, public.fh_client_attribution.last_medium),
    last_campaign = coalesce(excluded.last_campaign, public.fh_client_attribution.last_campaign),
    last_content = coalesce(excluded.last_content, public.fh_client_attribution.last_content),
    last_term = coalesce(excluded.last_term, public.fh_client_attribution.last_term),
    last_ad_id = coalesce(excluded.last_ad_id, public.fh_client_attribution.last_ad_id),
    last_form_key = coalesce(excluded.last_form_key, public.fh_client_attribution.last_form_key),
    last_landing_url = coalesce(excluded.last_landing_url, public.fh_client_attribution.last_landing_url),
    last_referrer = coalesce(excluded.last_referrer, public.fh_client_attribution.last_referrer),
    last_touch_at = now(),
    first_source = coalesce(public.fh_client_attribution.first_source, excluded.first_source),
    touches = public.fh_client_attribution.touches + 1,
    raw = (public.fh_client_attribution.raw || excluded.raw),
    updated_at = now();
  -- keep the simple client.source in step for the rest of the app
  update public.fh_clients set source = coalesce(source, v_src) where id = p_client_id and (source is null or source = '');
end $$;

-- ---------------------------------------------------------------------------
-- Form submission (called by the public edge function with service role)
-- ---------------------------------------------------------------------------
create or replace function public.fh_form_submit(
  p_org_public_key text, p_form_key text, p_data jsonb,
  p_attribution jsonb default '{}'::jsonb, p_ip_hash text default null, p_user_agent text default null
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid; f record; r record; v_name text; v_phone text; v_email text; v_addr text; v_sub uuid; v_job uuid; v_owner uuid;
  v_tag text; v_title text; v_source text; v_consent boolean;
begin
  select org_id into v_org from public.fh_org_settings where public_key = p_org_public_key and engine_enabled;
  if v_org is null then raise exception 'unknown org' using errcode = 'P0002'; end if;
  select * into f from public.fh_forms where org_id = v_org and key = p_form_key and status = 'active';
  if f.id is null then raise exception 'unknown form' using errcode = 'P0002'; end if;

  v_name := nullif(btrim(concat_ws(' ', nullif(p_data->>'first_name',''), nullif(p_data->>'last_name',''))), '');
  v_name := coalesce(nullif(p_data->>'name',''), nullif(p_data->>'full_name',''), v_name);
  v_phone := coalesce(p_data->>'phone', p_data->>'phone_number', p_data->>'mobile');
  v_email := coalesce(p_data->>'email', p_data->>'email_address');
  v_addr := coalesce(p_data->>'address', p_data->>'street_address', p_data->>'property_address');
  v_source := coalesce(p_attribution->>'source', p_attribution->>'utm_source', f.settings->>'source', 'website');

  if public.fh_normalize_phone(v_phone) is null and public.fh_normalize_email(v_email) is null then
    raise exception 'phone or email required' using errcode = '22023';
  end if;

  select * into r from public.fh_resolve_client(v_org, v_phone, v_email, v_name, v_addr, v_source);

  insert into public.fh_form_submissions (org_id, form_id, client_id, data, attribution, ip_hash, user_agent)
  values (v_org, f.id, r.client_id, coalesce(p_data,'{}'::jsonb), coalesce(p_attribution,'{}'::jsonb), p_ip_hash, p_user_agent)
  returning id into v_sub;
  update public.fh_forms set submissions_count = submissions_count + 1, updated_at = now() where id = f.id;

  perform public.fh_attribution_touch(v_org, r.client_id, coalesce(p_attribution,'{}'::jsonb) || jsonb_build_object('form_key', f.key, 'source', v_source));

  -- consent: only what the form actually captured
  v_consent := lower(coalesce(p_data->>'sms_consent', p_data->>'consent', p_data->>'text_ok', 'false')) in ('true','yes','on','1');
  if public.fh_normalize_phone(v_phone) is not null and v_consent then
    perform public.fh_consent_set(v_org, r.client_id, 'sms', 'opted_in', 'form:' || f.key);
  end if;
  if public.fh_normalize_email(v_email) is not null then
    perform public.fh_consent_set(v_org, r.client_id, 'email', 'opted_in', 'form:' || f.key);
  end if;

  for v_tag in select jsonb_array_elements_text(coalesce(f.settings->'tags','[]'::jsonb)) loop
    perform public.fh_tag_add(v_org, r.client_id, v_tag, 'form:' || f.key);
  end loop;

  -- open a job so the lead shows in the pipeline
  if coalesce((f.settings->>'create_job')::boolean, true) then
    select user_id into v_owner from public.fh_clients where id = r.client_id;
    v_title := coalesce(nullif(p_data->>'service',''), nullif(p_data->>'project',''), nullif(p_data->>'service_type',''), f.settings->>'default_job_title', 'New lead');
    if not exists (select 1 from public.fh_contacts where client_id = r.client_id and stage in ('lead','quote') and created_at > now() - interval '30 days') then
      insert into public.fh_contacts (user_id, org_id, client_id, name, phone, email, address, job_title, job_type, stage, source, notes)
      values (v_owner, v_org, r.client_id, coalesce(v_name, v_phone, v_email), public.fh_normalize_phone(v_phone), public.fh_normalize_email(v_email), v_addr,
              v_title, nullif(p_data->>'job_type',''), 'lead', v_source,
              nullif(concat_ws(E'\n', nullif(p_data->>'message',''), nullif(p_data->>'details',''), nullif(p_data->>'notes','')), ''))
      returning id into v_job;
      update public.fh_form_submissions set contact_id = v_job where id = v_sub;
    else
      select id into v_job from public.fh_contacts where client_id = r.client_id and stage in ('lead','quote') order by created_at desc limit 1;
    end if;
  end if;

  perform public.fh_emit_event(v_org, 'form.submitted', r.client_id, v_job,
    jsonb_build_object('form_key', f.key, 'form_id', f.id, 'submission_id', v_sub, 'is_new', r.is_new, 'source', v_source, 'data', coalesce(p_data,'{}'::jsonb)) || coalesce(p_attribution,'{}'::jsonb), 'forms');
  perform public.fh_emit_event(v_org, 'lead.captured', r.client_id, v_job,
    jsonb_build_object('via', 'form', 'form_key', f.key, 'is_new', r.is_new, 'source', v_source, 'name', v_name, 'phone', v_phone, 'email', v_email, 'message', coalesce(p_data->>'message', p_data->>'details')) || coalesce(p_attribution,'{}'::jsonb), 'forms');

  return jsonb_build_object('ok', true, 'client_id', r.client_id, 'is_new', r.is_new, 'submission_id', v_sub, 'job_id', v_job,
    'redirect_url', f.settings->>'redirect_url', 'thank_you', f.settings->>'thank_you');
end $$;

-- Generic lead capture (Meta lead ads, chat widgets, phone answering services)
create or replace function public.fh_lead_capture(
  p_org_id uuid, p_via text, p_name text, p_phone text, p_email text, p_address text default null,
  p_message text default null, p_attribution jsonb default '{}'::jsonb, p_dedupe_key text default null, p_sms_consent boolean default false, p_data jsonb default '{}'::jsonb
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare r record; v_job uuid; v_owner uuid; v_source text; v_title text;
begin
  if not public.fh_engine_enabled(p_org_id) then raise exception 'engine disabled for org' using errcode = 'P0002'; end if;
  if p_dedupe_key is not null and exists (select 1 from public.fh_events where dedupe_key = p_dedupe_key) then
    return jsonb_build_object('ok', true, 'duplicate', true);
  end if;
  v_source := coalesce(p_attribution->>'source', p_via);
  select * into r from public.fh_resolve_client(p_org_id, p_phone, p_email, p_name, p_address, v_source);
  perform public.fh_attribution_touch(p_org_id, r.client_id, coalesce(p_attribution,'{}'::jsonb) || jsonb_build_object('source', v_source));
  if p_sms_consent and public.fh_normalize_phone(p_phone) is not null then
    perform public.fh_consent_set(p_org_id, r.client_id, 'sms', 'opted_in', p_via);
  end if;
  if public.fh_normalize_email(p_email) is not null then
    perform public.fh_consent_set(p_org_id, r.client_id, 'email', 'opted_in', p_via);
  end if;
  perform public.fh_tag_add(p_org_id, r.client_id, p_via, p_via);
  select user_id into v_owner from public.fh_clients where id = r.client_id;
  v_title := coalesce(nullif(p_data->>'service',''), nullif(p_data->>'job_title',''), 'New lead');
  if not exists (select 1 from public.fh_contacts where client_id = r.client_id and stage in ('lead','quote') and created_at > now() - interval '30 days') then
    insert into public.fh_contacts (user_id, org_id, client_id, name, phone, email, address, job_title, stage, source, notes)
    values (v_owner, p_org_id, r.client_id, coalesce(p_name, p_phone, p_email), public.fh_normalize_phone(p_phone), public.fh_normalize_email(p_email), p_address, v_title, 'lead', v_source, p_message)
    returning id into v_job;
  else
    select id into v_job from public.fh_contacts where client_id = r.client_id and stage in ('lead','quote') order by created_at desc limit 1;
  end if;
  perform public.fh_emit_event(p_org_id, 'lead.captured', r.client_id, v_job,
    jsonb_build_object('via', p_via, 'is_new', r.is_new, 'source', v_source, 'name', p_name, 'phone', p_phone, 'email', p_email, 'message', p_message, 'data', coalesce(p_data,'{}'::jsonb)) || coalesce(p_attribution,'{}'::jsonb),
    p_via, p_dedupe_key);
  return jsonb_build_object('ok', true, 'client_id', r.client_id, 'is_new', r.is_new, 'job_id', v_job);
end $$;

-- ---------------------------------------------------------------------------
-- Booking
-- ---------------------------------------------------------------------------
create table if not exists public.fh_booking_types (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  duration_min integer not null default 60,
  slot_interval_min integer,
  buffer_before_min integer not null default 0,
  buffer_after_min integer not null default 30,
  min_notice_hours integer not null default 12,
  max_days_ahead integer not null default 21,
  max_per_day integer not null default 4,
  availability jsonb,
  assigned_user_ids uuid[] not null default '{}',
  location_mode text not null default 'at_client_address' check (location_mode in ('at_client_address','phone','office','video')),
  confirmation_sms text,
  confirmation_email_subject text,
  confirmation_email_body text,
  reminder_offsets_min integer[] not null default '{1440,120}',
  reminder_sms text,
  block_on_schedule boolean not null default false,
  tags jsonb not null default '["booked_appointment"]'::jsonb,
  status text not null default 'active' check (status in ('active','disabled')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create table if not exists public.fh_appointments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  booking_type_id uuid references public.fh_booking_types(id) on delete set null,
  client_id uuid not null references public.fh_clients(id) on delete cascade,
  contact_id uuid references public.fh_contacts(id) on delete set null,
  schedule_id uuid references public.fh_schedule(id) on delete set null,
  start_at timestamptz not null,
  end_at timestamptz not null,
  status text not null default 'booked' check (status in ('booked','confirmed','completed','cancelled','no_show','rescheduled')),
  assigned_to uuid,
  location text,
  notes text,
  source text not null default 'booking_page',
  manage_token text not null unique default public.fh_random_key(16),
  reminders_sent integer[] not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fh_appointments_org_start_idx on public.fh_appointments(org_id, start_at);
create index if not exists fh_appointments_client_idx on public.fh_appointments(client_id);

-- keep the existing Fieldhorse calendar in sync
create or replace function public.fh_appointments_mirror()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_owner uuid; v_title text; v_client text; v_type text;
begin
  select name into v_client from public.fh_clients where id = new.client_id;
  select name into v_type from public.fh_booking_types where id = new.booking_type_id;
  v_title := concat_ws(': ', coalesce(v_type, 'Appointment'), v_client);
  if tg_op = 'INSERT' then
    select user_id into v_owner from public.fh_clients where id = new.client_id;
    insert into public.fh_schedule (user_id, org_id, contact_id, title, description, start_at, end_at, assigned_to)
    values (coalesce(new.assigned_to, v_owner), new.org_id, new.contact_id, v_title, coalesce(new.notes, new.location), new.start_at, new.end_at, new.assigned_to)
    returning id into new.schedule_id;
    return new;
  end if;
  if new.schedule_id is not null then
    if new.status in ('cancelled') then
      -- the calendar row is removed in the AFTER trigger (FK set null would collide with this row)
      new.schedule_id := null;
    else
      update public.fh_schedule set start_at = new.start_at, end_at = new.end_at, title = v_title, assigned_to = new.assigned_to, contact_id = new.contact_id
       where id = new.schedule_id;
    end if;
  end if;
  return new;
exception when others then
  raise warning 'fh_appointments_mirror: %', sqlerrm; return new;
end $$;
drop trigger if exists fh_appointments_mirror_trg on public.fh_appointments;
create trigger fh_appointments_mirror_trg before insert or update of start_at, end_at, status, assigned_to on public.fh_appointments
for each row execute function public.fh_appointments_mirror();

create or replace function public.fh_appointments_mirror_after()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if old.schedule_id is not null and new.schedule_id is null and new.status = 'cancelled' then
    delete from public.fh_schedule where id = old.schedule_id;
  end if;
  return null;
exception when others then
  raise warning 'fh_appointments_mirror_after: %', sqlerrm; return null;
end $$;
drop trigger if exists fh_appointments_mirror_after_trg on public.fh_appointments;
create trigger fh_appointments_mirror_after_trg after update of status on public.fh_appointments
for each row execute function public.fh_appointments_mirror_after();

create or replace function public.fh_appointments_events()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_type text; p jsonb;
begin
  select name into v_type from public.fh_booking_types where id = new.booking_type_id;
  p := jsonb_build_object('appointment_id', new.id, 'type', v_type, 'start_at', new.start_at, 'end_at', new.end_at, 'status', new.status, 'location', new.location, 'source', new.source);
  if tg_op = 'INSERT' then
    perform public.fh_emit_event(new.org_id, 'appointment.booked', new.client_id, new.contact_id, p, 'booking');
  elsif old.status is distinct from new.status then
    perform public.fh_emit_event(new.org_id, 'appointment.' || new.status, new.client_id, new.contact_id, p || jsonb_build_object('from', old.status), 'booking');
  elsif old.start_at is distinct from new.start_at then
    perform public.fh_emit_event(new.org_id, 'appointment.rescheduled', new.client_id, new.contact_id, p || jsonb_build_object('previous_start_at', old.start_at), 'booking');
  end if;
  return null;
exception when others then
  raise warning 'fh_appointments_events: %', sqlerrm; return null;
end $$;
drop trigger if exists fh_appointments_events_trg on public.fh_appointments;
create trigger fh_appointments_events_trg after insert or update of status, start_at on public.fh_appointments
for each row execute function public.fh_appointments_events();

-- Availability windows for a day: booking type override, else org business hours
create or replace function public.fh_booking_windows(p_org_id uuid, p_type public.fh_booking_types, p_day date)
returns jsonb
language plpgsql stable
set search_path = pg_catalog, public
as $$
declare v_set record; v_dow text; v_av jsonb;
begin
  select * into v_set from public.fh_org_settings where org_id = p_org_id;
  v_dow := lower(to_char(p_day, 'dy'));
  v_av := coalesce(p_type.availability, v_set.business_hours, '{}'::jsonb);
  return coalesce(v_av -> v_dow, '[]'::jsonb);
end $$;

create or replace function public.fh_booking_slots(p_org_public_key text, p_type_key text, p_from date default null, p_days integer default 14)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid; t public.fh_booking_types; v_tz text; v_day date; v_end_day date; w jsonb; v_ws time; v_we time;
  v_start timestamptz; v_slot_end timestamptz; v_step interval; v_dur interval; v_min_start timestamptz;
  v_out jsonb := '[]'::jsonb; v_day_count int; v_taken int; v_before interval; v_after interval;
begin
  select org_id into v_org from public.fh_org_settings where public_key = p_org_public_key and engine_enabled;
  if v_org is null then return jsonb_build_object('error','unknown org'); end if;
  select * into t from public.fh_booking_types where org_id = v_org and key = p_type_key and status = 'active';
  if t.id is null then return jsonb_build_object('error','unknown booking type'); end if;
  v_tz := public.fh_org_tz(v_org);
  v_dur := make_interval(mins => t.duration_min);
  v_step := make_interval(mins => coalesce(t.slot_interval_min, t.duration_min));
  v_before := make_interval(mins => t.buffer_before_min);
  v_after := make_interval(mins => t.buffer_after_min);
  v_min_start := now() + make_interval(hours => t.min_notice_hours);
  v_day := coalesce(p_from, (now() at time zone v_tz)::date);
  v_end_day := least(v_day + greatest(1, least(p_days, 60)), (now() at time zone v_tz)::date + t.max_days_ahead);

  while v_day <= v_end_day loop
    v_day_count := 0;
    select count(*) into v_taken from public.fh_appointments a
     where a.org_id = v_org and a.booking_type_id = t.id and a.status in ('booked','confirmed')
       and (a.start_at at time zone v_tz)::date = v_day;
    for w in select * from jsonb_array_elements(public.fh_booking_windows(v_org, t, v_day)) loop
      v_ws := (w->>0)::time; v_we := (w->>1)::time;
      v_start := (v_day + v_ws) at time zone v_tz;
      while v_start + v_dur <= (v_day + v_we) at time zone v_tz loop
        v_slot_end := v_start + v_dur;
        if v_start >= v_min_start and (v_taken + v_day_count) < t.max_per_day then
          if not exists (
            select 1 from public.fh_appointments a
             where a.org_id = v_org and a.status in ('booked','confirmed')
               and (array_length(t.assigned_user_ids,1) is null or a.assigned_to is null or a.assigned_to = any (t.assigned_user_ids))
               and a.start_at < v_slot_end + v_after and a.end_at > v_start - v_before
          ) and (not t.block_on_schedule or not exists (
            select 1 from public.fh_schedule s
             where s.org_id = v_org and s.assigned_to = any (t.assigned_user_ids)
               and s.start_at < v_slot_end + v_after and s.end_at > v_start - v_before
          )) then
            v_out := v_out || jsonb_build_object('start', v_start, 'end', v_slot_end, 'day', v_day, 'label', to_char(v_start at time zone v_tz, 'Dy Mon DD, HH12:MI AM'));
            v_day_count := v_day_count + 1;
          end if;
        end if;
        v_start := v_start + v_step;
      end loop;
    end loop;
    v_day := v_day + 1;
  end loop;
  return jsonb_build_object('timezone', v_tz, 'type', jsonb_build_object('key', t.key, 'name', t.name, 'duration_min', t.duration_min, 'description', t.description, 'location_mode', t.location_mode), 'slots', v_out);
end $$;

create or replace function public.fh_book_appointment(
  p_org_public_key text, p_type_key text, p_start timestamptz,
  p_name text, p_phone text, p_email text default null, p_address text default null, p_notes text default null,
  p_attribution jsonb default '{}'::jsonb, p_sms_consent boolean default false
) returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_org uuid; t record; r record; v_appt uuid; v_job uuid; v_owner uuid; v_end timestamptz; v_tag text; v_slots jsonb; v_ok boolean;
begin
  select org_id into v_org from public.fh_org_settings where public_key = p_org_public_key and engine_enabled;
  if v_org is null then raise exception 'unknown org' using errcode = 'P0002'; end if;
  select * into t from public.fh_booking_types where org_id = v_org and key = p_type_key and status = 'active';
  if t.id is null then raise exception 'unknown booking type' using errcode = 'P0002'; end if;
  if public.fh_normalize_phone(p_phone) is null and public.fh_normalize_email(p_email) is null then
    raise exception 'phone or email required' using errcode = '22023';
  end if;

  -- the slot must still be offered
  v_slots := public.fh_booking_slots(p_org_public_key, p_type_key, (p_start at time zone public.fh_org_tz(v_org))::date, 1);
  select exists (select 1 from jsonb_array_elements(v_slots->'slots') s where (s->>'start')::timestamptz = p_start) into v_ok;
  if not v_ok then raise exception 'slot no longer available' using errcode = '23505'; end if;

  v_end := p_start + make_interval(mins => t.duration_min);
  select * into r from public.fh_resolve_client(v_org, p_phone, p_email, p_name, p_address, coalesce(p_attribution->>'source','booking_page'));
  perform public.fh_attribution_touch(v_org, r.client_id, coalesce(p_attribution,'{}'::jsonb) || jsonb_build_object('source', coalesce(p_attribution->>'source','booking_page')));
  if p_sms_consent and public.fh_normalize_phone(p_phone) is not null then
    perform public.fh_consent_set(v_org, r.client_id, 'sms', 'opted_in', 'booking:' || t.key);
  end if;
  if public.fh_normalize_email(p_email) is not null then
    perform public.fh_consent_set(v_org, r.client_id, 'email', 'opted_in', 'booking:' || t.key);
  end if;

  select user_id into v_owner from public.fh_clients where id = r.client_id;
  select id into v_job from public.fh_contacts where client_id = r.client_id and stage in ('lead','quote') order by created_at desc limit 1;
  if v_job is null then
    insert into public.fh_contacts (user_id, org_id, client_id, name, phone, email, address, job_title, stage, source, notes)
    values (v_owner, v_org, r.client_id, coalesce(p_name, p_phone, p_email), public.fh_normalize_phone(p_phone), public.fh_normalize_email(p_email), p_address, t.name, 'lead', 'booking_page', p_notes)
    returning id into v_job;
  end if;

  insert into public.fh_appointments (org_id, booking_type_id, client_id, contact_id, start_at, end_at, assigned_to, location, notes, source)
  values (v_org, t.id, r.client_id, v_job, p_start, v_end,
          case when array_length(t.assigned_user_ids,1) >= 1 then t.assigned_user_ids[1] else null end,
          case t.location_mode when 'at_client_address' then coalesce(p_address, 'Client address') when 'phone' then 'Phone call' else t.location_mode end,
          p_notes, coalesce(p_attribution->>'source','booking_page'))
  returning id into v_appt;

  for v_tag in select jsonb_array_elements_text(coalesce(t.tags,'[]'::jsonb)) loop
    perform public.fh_tag_add(v_org, r.client_id, v_tag, 'booking');
  end loop;

  return jsonb_build_object('ok', true, 'appointment_id', v_appt, 'client_id', r.client_id, 'is_new', r.is_new, 'start', p_start, 'end', v_end,
    'manage_token', (select manage_token from public.fh_appointments where id = v_appt));
end $$;

create or replace function public.fh_appointment_cancel_public(p_manage_token text, p_reason text default null)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare a record;
begin
  select * into a from public.fh_appointments where manage_token = p_manage_token;
  if a.id is null then return jsonb_build_object('ok', false, 'error', 'not found'); end if;
  if a.status in ('cancelled','completed') then return jsonb_build_object('ok', true, 'status', a.status); end if;
  update public.fh_appointments set status = 'cancelled', notes = concat_ws(E'\n', notes, 'Cancelled by client' || coalesce(': ' || p_reason, '')), updated_at = now() where id = a.id;
  return jsonb_build_object('ok', true, 'status', 'cancelled');
end $$;

-- Reminder sweep: pg_cron every 5 minutes
create or replace function public.fh_appointment_reminders_sweep()
returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare a record; off int; n int := 0; ctx jsonb; v_body text; v_set record;
begin
  for a in select ap.*, bt.reminder_offsets_min, bt.reminder_sms, bt.name as type_name
             from public.fh_appointments ap join public.fh_booking_types bt on bt.id = ap.booking_type_id
            where ap.status in ('booked','confirmed') and ap.start_at > now() and ap.start_at < now() + interval '3 days'
              and public.fh_engine_enabled(ap.org_id)
  loop
    foreach off in array coalesce(a.reminder_offsets_min, '{}'::int[]) loop
      if a.start_at - make_interval(mins => off) <= now() and not (off = any (a.reminders_sent)) then
        ctx := public.fh_client_ctx(a.client_id, a.contact_id, jsonb_build_object('type', 'appointment.reminder')) ||
               jsonb_build_object('appointment', jsonb_build_object('type', a.type_name, 'start_local', to_char(a.start_at at time zone public.fh_org_tz(a.org_id), 'Dy Mon DD at HH12:MI AM'), 'location', a.location));
        v_body := public.fh_render_template(coalesce(a.reminder_sms, 'Reminder from {{company.name}}: your {{appointment.type}} is {{appointment.start_local}}. Reply here if anything changes.'), ctx);
        perform public.fh_enqueue_message(a.org_id, a.client_id, a.contact_id, 'sms', v_body, null, 'transactional', null, 'system', null, null, null, null, false, null, '[]'::jsonb, jsonb_build_object('appointment_id', a.id, 'reminder_offset', off));
        update public.fh_appointments set reminders_sent = reminders_sent || off, updated_at = now() where id = a.id;
        n := n + 1;
      end if;
    end loop;
  end loop;
  return n;
end $$;

-- ---------------------------------------------------------------------------
-- Reviews feed (Google / Facebook reviews pulled in by the worker or added by hand)
-- ---------------------------------------------------------------------------
create table if not exists public.fh_reviews (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid references public.fh_clients(id) on delete set null,
  platform text not null default 'google' check (platform in ('google','facebook','yelp','bbb','houzz','nextdoor','other')),
  external_id text,
  rating integer check (rating between 1 and 5),
  author_name text,
  body text,
  review_url text,
  received_at timestamptz not null default now(),
  reply_body text,
  replied_at timestamptz,
  replied_by uuid,
  sentiment text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fh_reviews_ext_uidx on public.fh_reviews(org_id, platform, external_id) where external_id is not null;
create index if not exists fh_reviews_org_idx on public.fh_reviews(org_id, received_at desc);

create or replace function public.fh_reviews_events()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  perform public.fh_emit_event(new.org_id, 'review.received', new.client_id, null,
    jsonb_build_object('review_id', new.id, 'platform', new.platform, 'rating', new.rating, 'author', new.author_name, 'body', left(coalesce(new.body,''), 1000)), 'reviews');
  if new.client_id is not null then
    update public.fh_review_requests set status = 'reviewed', reviewed_at = now() where client_id = new.client_id and status in ('sent','clicked');
  end if;
  return null;
exception when others then
  raise warning 'fh_reviews_events: %', sqlerrm; return null;
end $$;
drop trigger if exists fh_reviews_events_trg on public.fh_reviews;
create trigger fh_reviews_events_trg after insert on public.fh_reviews
for each row execute function public.fh_reviews_events();

alter table public.fh_review_requests add column if not exists track_key text unique default public.fh_random_key(12);

create or replace function public.fh_review_click(p_track_key text)
returns text
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare rr record; v_url text;
begin
  select * into rr from public.fh_review_requests where track_key = p_track_key;
  if rr.id is null then return null; end if;
  update public.fh_review_requests set status = case when status = 'sent' then 'clicked' else status end, clicked_at = coalesce(clicked_at, now()) where id = rr.id;
  v_url := coalesce(rr.review_url, (select s.review_links->>'google' from public.fh_org_settings s where s.org_id = rr.org_id));
  perform public.fh_emit_event(rr.org_id, 'review.link_clicked', rr.client_id, rr.contact_id, jsonb_build_object('review_request_id', rr.id), 'reviews');
  return v_url;
end $$;

-- ---------------------------------------------------------------------------
-- Segments (smart lists)
-- ---------------------------------------------------------------------------
create table if not exists public.fh_segments (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  filter jsonb not null default '{}'::jsonb,
  is_system boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create or replace function public.fh_segment_members(p_org_id uuid, p_filter jsonb, p_limit integer default 5000)
returns table (client_id uuid)
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare c record; n int := 0;
begin
  if auth.uid() is not null and not public.fh_is_org_member(p_org_id) then raise exception 'not allowed'; end if;
  for c in select id from public.fh_clients where org_id = p_org_id order by updated_at desc loop
    if public.fh_eval_filter(public.fh_client_ctx(c.id, null, '{}'::jsonb), p_filter) then
      client_id := c.id; n := n + 1; return next;
      if n >= p_limit then return; end if;
    end if;
  end loop;
end $$;

create or replace function public.fh_segment_count(p_org_id uuid, p_filter jsonb)
returns integer
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select count(*)::int from public.fh_segment_members(p_org_id, p_filter, 100000)
$$;

-- ---------------------------------------------------------------------------
-- Campaigns (one to many sends, throttled through the outbox)
-- ---------------------------------------------------------------------------
create table if not exists public.fh_campaigns (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  channel text not null check (channel in ('sms','email')),
  purpose text not null default 'marketing' check (purpose in ('transactional','marketing')),
  subject text,
  body text not null default '',
  body_html text,
  audience jsonb not null default '{}'::jsonb,
  segment_id uuid references public.fh_segments(id) on delete set null,
  status text not null default 'draft' check (status in ('draft','scheduled','sending','sent','paused','cancelled')),
  scheduled_at timestamptz,
  throttle_per_minute integer not null default 30,
  phone_number_id uuid references public.fh_phone_numbers(id) on delete set null,
  stats jsonb not null default '{}'::jsonb,
  created_by uuid,
  launched_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.fh_campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  campaign_id uuid not null references public.fh_campaigns(id) on delete cascade,
  client_id uuid not null references public.fh_clients(id) on delete cascade,
  message_id uuid references public.fh_messages(id) on delete set null,
  status text not null default 'pending' check (status in ('pending','queued','held','sent','delivered','failed','skipped','replied')),
  skip_reason text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (campaign_id, client_id)
);
create index if not exists fh_campaign_recipients_campaign_idx on public.fh_campaign_recipients(campaign_id, status);

alter table public.fh_messages
  drop constraint if exists fh_messages_campaign_fk,
  add constraint fh_messages_campaign_fk foreign key (campaign_id) references public.fh_campaigns(id) on delete set null;

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

create or replace function public.fh_campaign_cancel(p_campaign_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare c record;
begin
  select * into c from public.fh_campaigns where id = p_campaign_id;
  if c.id is null then return; end if;
  if auth.uid() is not null and not public.fh_is_org_manager(c.org_id) then raise exception 'not allowed'; end if;
  update public.fh_outbox set status = 'canceled', updated_at = now() where campaign_id = c.id and status in ('queued','held');
  update public.fh_messages set status = 'canceled', updated_at = now() where campaign_id = c.id and status in ('queued','held');
  update public.fh_campaign_recipients set status = 'skipped', skip_reason = 'cancelled', updated_at = now() where campaign_id = c.id and status in ('pending','queued','held');
  update public.fh_campaigns set status = 'cancelled', updated_at = now() where id = c.id;
end $$;

-- keep recipient rows in step with message status
create or replace function public.fh_campaign_recipient_sync()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if new.campaign_id is not null and old.status is distinct from new.status then
    update public.fh_campaign_recipients set status = case new.status when 'sent' then 'sent' when 'delivered' then 'delivered' when 'failed' then 'failed' when 'undelivered' then 'failed' when 'held' then 'held' when 'queued' then 'queued' when 'canceled' then 'skipped' else status end, updated_at = now()
     where message_id = new.id;
    if new.status = 'sent' then
      update public.fh_campaigns set status = 'sent', updated_at = now() where id = new.campaign_id and status = 'sending'
        and not exists (select 1 from public.fh_campaign_recipients r where r.campaign_id = new.campaign_id and r.status in ('pending','queued'));
    end if;
  end if;
  return null;
end $$;
drop trigger if exists fh_campaign_recipient_sync_trg on public.fh_messages;
create trigger fh_campaign_recipient_sync_trg after update of status on public.fh_messages
for each row execute function public.fh_campaign_recipient_sync();

-- ---------------------------------------------------------------------------
-- Report views (security_invoker so RLS applies)
-- ---------------------------------------------------------------------------
create or replace view public.fh_v_inbox with (security_invoker = true) as
select c.id as conversation_id, c.org_id, c.client_id, cl.name as client_name, cl.phone, cl.email, cl.company_name,
       c.status, c.assigned_to, c.starred, c.unread_count, c.last_message_at, c.last_inbound_at, c.last_outbound_at, c.last_channel, c.last_preview, c.snoozed_until,
       (select coalesce(jsonb_agg(t.tag order by t.tag), '[]'::jsonb) from public.fh_client_tags t where t.client_id = c.client_id) as tags,
       (select j.stage from public.fh_contacts j where j.client_id = c.client_id order by j.updated_at desc limit 1) as latest_stage,
       (select count(*) from public.fh_agent_runs ar where ar.conversation_id = c.id and ar.status = 'proposed') as pending_drafts,
       (select count(*) from public.fh_messages m where m.conversation_id = c.id and m.status = 'held') as held_messages
  from public.fh_conversations c
  join public.fh_clients cl on cl.id = c.client_id;

create or replace view public.fh_v_attribution with (security_invoker = true) as
select cl.org_id,
       coalesce(a.first_source, cl.source, 'unknown') as source,
       date_trunc('month', cl.created_at) as month,
       count(distinct cl.id) as leads,
       count(distinct j.id) filter (where j.quote_sent_at is not null or j.stage in ('quote','job','closed')) as quoted,
       count(distinct j.id) filter (where j.stage in ('job','closed')) as won,
       coalesce(sum(j.amount) filter (where j.stage in ('job','closed')), 0) as revenue,
       count(distinct j.id) filter (where j.stage = 'lost') as lost
  from public.fh_clients cl
  left join public.fh_client_attribution a on a.client_id = cl.id
  left join public.fh_contacts j on j.client_id = cl.id
 group by cl.org_id, coalesce(a.first_source, cl.source, 'unknown'), date_trunc('month', cl.created_at);

create or replace view public.fh_v_response_times with (security_invoker = true) as
select m.org_id, m.id as inbound_message_id, m.conversation_id, m.client_id, m.channel, m.created_at as inbound_at,
       r.created_at as replied_at,
       extract(epoch from (r.created_at - m.created_at)) / 60.0 as minutes_to_reply,
       r.sent_by_kind as replied_by_kind
  from public.fh_messages m
  left join lateral (
    select x.created_at, x.sent_by_kind from public.fh_messages x
     where x.conversation_id = m.conversation_id and x.direction = 'outbound' and x.channel <> 'note' and x.created_at > m.created_at
     order by x.created_at limit 1
  ) r on true
 where m.direction = 'inbound' and m.channel <> 'note';

create or replace view public.fh_v_workflow_stats with (security_invoker = true) as
select w.org_id, w.id as workflow_id, w.key, w.name, w.status,
       count(r.id) as runs,
       count(r.id) filter (where r.status in ('active','waiting')) as active_runs,
       count(r.id) filter (where r.status = 'completed') as completed,
       count(r.id) filter (where r.status = 'goal_met') as goal_met,
       count(r.id) filter (where r.status = 'cancelled' and r.ended_reason = 'replied') as replied,
       count(r.id) filter (where r.status = 'failed') as failed,
       max(r.started_at) as last_run_at
  from public.fh_workflows w
  left join public.fh_workflow_runs r on r.workflow_id = w.id
 group by w.org_id, w.id, w.key, w.name, w.status;

create or replace view public.fh_v_call_log with (security_invoker = true) as
select m.org_id, m.id as message_id, m.client_id, cl.name as client_name, m.direction, m.call_status, m.call_duration_sec, m.recording_url, m.transcript,
       m.from_address, m.to_address, pn.label as number_label, pn.source_tag, m.created_at
  from public.fh_messages m
  join public.fh_clients cl on cl.id = m.client_id
  left join public.fh_phone_numbers pn on pn.id = m.phone_number_id
 where m.channel in ('call','voicemail');

-- ---------------------------------------------------------------------------
-- Standard triggers, RLS, grants
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['fh_forms','fh_form_submissions','fh_lead_sources','fh_client_attribution','fh_booking_types','fh_appointments','fh_reviews','fh_segments','fh_campaigns','fh_campaign_recipients'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_org_id', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.fh_set_org_id()', t || '_set_org_id', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array array['fh_forms','fh_client_attribution','fh_booking_types','fh_appointments','fh_reviews','fh_segments','fh_campaigns','fh_campaign_recipients'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.fh_touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

do $$
declare t text;
begin
  -- manager write, member read
  foreach t in array array['fh_forms','fh_lead_sources','fh_booking_types','fh_segments','fh_campaigns'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (org_id in (select public.auth_user_org_ids()))$p$, t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$create policy %I on public.%I for all to authenticated using (public.fh_is_org_manager(org_id)) with check (public.fh_is_org_manager(org_id))$p$, t || '_write', t);
  end loop;
  -- member read + write
  foreach t in array array['fh_appointments','fh_reviews','fh_client_attribution'] loop
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format($p$create policy %I on public.%I for all to authenticated using (org_id in (select public.auth_user_org_ids())) with check (org_id in (select public.auth_user_org_ids()))$p$, t || '_org', t);
  end loop;
  -- member read only
  foreach t in array array['fh_form_submissions','fh_campaign_recipients'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (org_id in (select public.auth_user_org_ids()))$p$, t || '_read', t);
  end loop;
end $$;

grant select, insert, update, delete on public.fh_forms, public.fh_lead_sources, public.fh_booking_types, public.fh_segments, public.fh_campaigns, public.fh_appointments, public.fh_reviews, public.fh_client_attribution to authenticated, service_role;
grant select on public.fh_form_submissions, public.fh_campaign_recipients to authenticated;
grant select, insert, update, delete on public.fh_form_submissions, public.fh_campaign_recipients to service_role;
grant select on public.fh_v_inbox, public.fh_v_attribution, public.fh_v_response_times, public.fh_v_workflow_stats, public.fh_v_call_log to authenticated, service_role;

do $$
declare f text;
begin
  foreach f in array array[
    'fh_form_submit(text,text,jsonb,jsonb,text,text)','fh_lead_capture(uuid,text,text,text,text,text,text,jsonb,text,boolean,jsonb)',
    'fh_booking_slots(text,text,date,integer)','fh_book_appointment(text,text,timestamptz,text,text,text,text,text,jsonb,boolean)',
    'fh_appointment_cancel_public(text,text)','fh_appointment_reminders_sweep()','fh_review_click(text)','fh_attribution_touch(uuid,uuid,jsonb)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('revoke all on function public.%s from anon', f);
    execute format('revoke all on function public.%s from authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  foreach f in array array['fh_segment_members(uuid,jsonb,integer)','fh_segment_count(uuid,jsonb)','fh_campaign_launch(uuid,boolean)','fh_campaign_cancel(uuid)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('revoke all on function public.%s from anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

