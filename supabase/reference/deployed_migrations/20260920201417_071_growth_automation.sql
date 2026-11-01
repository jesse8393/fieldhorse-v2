-- =============================================================================
-- 071_growth_automation.sql
-- Workflow engine: definitions, versions, runs, step executor, event dispatch,
-- outbox (durable send queue), agents, review requests, template rendering,
-- filter evaluation, send window + consent holds.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Tables
-- ---------------------------------------------------------------------------
create table if not exists public.fh_workflows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  category text,
  status text not null default 'draft' check (status in ('draft','active','paused','archived')),
  trigger_types text[] not null default '{}',
  active_version_id uuid,
  draft_definition jsonb not null default '{}'::jsonb,
  stats jsonb not null default '{}'::jsonb,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);
create index if not exists fh_workflows_org_status_idx on public.fh_workflows(org_id, status);
create index if not exists fh_workflows_trigger_types_idx on public.fh_workflows using gin (trigger_types);

create table if not exists public.fh_workflow_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workflow_id uuid not null references public.fh_workflows(id) on delete cascade,
  version integer not null,
  definition jsonb not null,
  published_by uuid,
  published_at timestamptz not null default now(),
  unique (workflow_id, version)
);

alter table public.fh_workflows
  drop constraint if exists fh_workflows_active_version_fk,
  add constraint fh_workflows_active_version_fk
    foreign key (active_version_id) references public.fh_workflow_versions(id) on delete set null;

create table if not exists public.fh_workflow_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workflow_id uuid not null references public.fh_workflows(id) on delete cascade,
  version_id uuid not null references public.fh_workflow_versions(id) on delete cascade,
  client_id uuid not null references public.fh_clients(id) on delete cascade,
  contact_id uuid references public.fh_contacts(id) on delete set null,
  status text not null default 'active' check (status in ('active','waiting','completed','cancelled','failed','goal_met')),
  exclusive boolean not null default true,
  current_step_id text,
  wait_until timestamptz,
  waiting_for_event text,
  on_timeout_step_id text,
  context jsonb not null default '{}'::jsonb,
  trigger_event_id uuid,
  steps_executed integer not null default 0,
  source text not null default 'trigger',
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  ended_reason text,
  last_error text,
  updated_at timestamptz not null default now()
);
create unique index if not exists fh_workflow_runs_one_active_uidx
  on public.fh_workflow_runs(workflow_id, client_id) where status in ('active','waiting') and exclusive;
create index if not exists fh_workflow_runs_due_idx on public.fh_workflow_runs(wait_until) where status in ('active','waiting');
create index if not exists fh_workflow_runs_client_idx on public.fh_workflow_runs(client_id, status);
create index if not exists fh_workflow_runs_org_idx on public.fh_workflow_runs(org_id, started_at desc);

create table if not exists public.fh_workflow_run_events (
  id bigserial primary key,
  org_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.fh_workflow_runs(id) on delete cascade,
  step_id text,
  step_type text,
  status text not null default 'ok' check (status in ('ok','skipped','held','error','info','wait','end')),
  detail jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists fh_workflow_run_events_run_idx on public.fh_workflow_run_events(run_id, id);

create table if not exists public.fh_outbox (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('sms','mms','email','call','voice_drop','webhook','agent','push')),
  payload jsonb not null default '{}'::jsonb,
  status text not null default 'queued' check (status in ('queued','held','processing','done','failed','canceled')),
  hold_reason text,
  attempts integer not null default 0,
  max_attempts integer not null default 5,
  next_attempt_at timestamptz not null default now(),
  locked_at timestamptz,
  locked_by text,
  run_id uuid references public.fh_workflow_runs(id) on delete set null,
  message_id uuid references public.fh_messages(id) on delete cascade,
  client_id uuid references public.fh_clients(id) on delete cascade,
  campaign_id uuid,
  agent_run_id uuid,
  phone_number_id uuid references public.fh_phone_numbers(id) on delete set null,
  result jsonb,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  done_at timestamptz
);
create index if not exists fh_outbox_due_idx on public.fh_outbox(next_attempt_at) where status = 'queued';
create index if not exists fh_outbox_held_idx on public.fh_outbox(org_id, hold_reason) where status = 'held';
create index if not exists fh_outbox_org_idx on public.fh_outbox(org_id, created_at desc);

create table if not exists public.fh_agents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  description text,
  model text not null default 'claude-sonnet-5',
  system_prompt text not null,
  autonomy text not null default 'draft' check (autonomy in ('draft','auto_within_rules','auto')),
  tools text[] not null default '{propose_message,add_tag,set_stage,create_task,escalate}',
  guardrails jsonb not null default '{"max_messages_per_client_per_day":3,"business_hours_only":true,"escalate_keywords":["lawyer","attorney","refund","sue","complaint","bbb"],"never_promise_price":true}'::jsonb,
  status text not null default 'active' check (status in ('active','paused')),
  stats jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create table if not exists public.fh_agent_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  agent_id uuid not null references public.fh_agents(id) on delete cascade,
  client_id uuid references public.fh_clients(id) on delete cascade,
  contact_id uuid references public.fh_contacts(id) on delete set null,
  conversation_id uuid references public.fh_conversations(id) on delete set null,
  trigger_kind text not null default 'manual' check (trigger_kind in ('workflow','inbox','schedule','manual')),
  run_id uuid references public.fh_workflow_runs(id) on delete set null,
  mode text not null default 'draft' check (mode in ('draft','auto')),
  input jsonb not null default '{}'::jsonb,
  output jsonb,
  proposal jsonb,
  status text not null default 'pending' check (status in ('pending','running','proposed','approved','rejected','executed','auto_executed','failed','no_action')),
  approved_by uuid,
  approved_at timestamptz,
  executed_message_id uuid references public.fh_messages(id) on delete set null,
  tokens_in integer,
  tokens_out integer,
  cost_usd numeric(10,5),
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fh_agent_runs_org_status_idx on public.fh_agent_runs(org_id, status, created_at desc);
create index if not exists fh_agent_runs_conv_idx on public.fh_agent_runs(conversation_id, created_at desc);

create table if not exists public.fh_review_requests (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.fh_clients(id) on delete cascade,
  contact_id uuid references public.fh_contacts(id) on delete set null,
  channel text not null check (channel in ('sms','email')),
  platform text not null default 'google',
  review_url text,
  message_id uuid references public.fh_messages(id) on delete set null,
  status text not null default 'sent' check (status in ('sent','clicked','reviewed','declined')),
  sent_at timestamptz not null default now(),
  clicked_at timestamptz,
  reviewed_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists fh_review_requests_org_idx on public.fh_review_requests(org_id, sent_at desc);

-- late FKs from 070
alter table public.fh_messages
  drop constraint if exists fh_messages_workflow_run_fk,
  add constraint fh_messages_workflow_run_fk foreign key (workflow_run_id) references public.fh_workflow_runs(id) on delete set null;
alter table public.fh_messages
  drop constraint if exists fh_messages_agent_run_fk,
  add constraint fh_messages_agent_run_fk foreign key (agent_run_id) references public.fh_agent_runs(id) on delete set null;
alter table public.fh_outbox
  drop constraint if exists fh_outbox_agent_run_fk,
  add constraint fh_outbox_agent_run_fk foreign key (agent_run_id) references public.fh_agent_runs(id) on delete cascade;

-- ---------------------------------------------------------------------------
-- Template rendering + filter evaluation
-- ---------------------------------------------------------------------------
create or replace function public.fh_get_path(p_ctx jsonb, p_path text)
returns jsonb
language sql immutable
set search_path = pg_catalog, public
as $$
  select p_ctx #> string_to_array(p_path, '.')
$$;

-- Replace {{a.b.c}} tokens with values from ctx. Unknown tokens become ''.
create or replace function public.fh_render_template(p_text text, p_ctx jsonb)
returns text
language plpgsql immutable
set search_path = pg_catalog, public
as $$
declare
  v_out text := coalesce(p_text, '');
  m text[];
  v_path text;
  v_val jsonb;
  v_str text;
begin
  for m in select regexp_matches(v_out, '\{\{\s*([A-Za-z0-9_.]+)\s*\}\}', 'g') loop
    v_path := m[1];
    v_val := public.fh_get_path(p_ctx, v_path);
    if v_val is null or v_val = 'null'::jsonb then
      v_str := '';
    elsif jsonb_typeof(v_val) = 'string' then
      v_str := v_val #>> '{}';
    elsif jsonb_typeof(v_val) = 'array' then
      select string_agg(x, ', ') into v_str from jsonb_array_elements_text(v_val) x;
      v_str := coalesce(v_str, '');
    else
      v_str := v_val::text;
    end if;
    v_out := regexp_replace(v_out, '\{\{\s*' || replace(v_path, '.', '\.') || '\s*\}\}', v_str, 'g');
  end loop;
  return v_out;
end $$;

create or replace function public.fh_jsonb_to_num(p jsonb)
returns numeric
language plpgsql immutable
set search_path = pg_catalog, public
as $$
begin
  if p is null then return null; end if;
  if jsonb_typeof(p) = 'number' then return (p #>> '{}')::numeric; end if;
  if jsonb_typeof(p) = 'string' then return (p #>> '{}')::numeric; end if;
  return null;
exception when others then return null;
end $$;

create or replace function public.fh_jsonb_to_ts(p jsonb)
returns timestamptz
language plpgsql immutable
set search_path = pg_catalog, public
as $$
begin
  if p is null or jsonb_typeof(p) <> 'string' then return null; end if;
  return (p #>> '{}')::timestamptz;
exception when others then return null;
end $$;

-- Filter DSL:
--   {"all":[f,f]} | {"any":[f,f]} | {"not":f} | {"field":"client.tags","op":"contains","value":"hot"}
-- Empty / null filter is true.
create or replace function public.fh_eval_filter(p_ctx jsonb, p_filter jsonb)
returns boolean
language plpgsql immutable
set search_path = pg_catalog, public
as $$
declare
  f jsonb;
  v_field text; v_op text; v_val jsonb; v_cur jsonb;
  v_curs text; v_vals text;
  v_n1 numeric; v_n2 numeric;
  v_ts timestamptz;
  v_res boolean;
begin
  if p_filter is null or p_filter = '{}'::jsonb or p_filter = 'null'::jsonb then return true; end if;

  if p_filter ? 'all' then
    for f in select * from jsonb_array_elements(p_filter->'all') loop
      if not public.fh_eval_filter(p_ctx, f) then return false; end if;
    end loop;
    return true;
  end if;
  if p_filter ? 'any' then
    if jsonb_array_length(p_filter->'any') = 0 then return true; end if;
    for f in select * from jsonb_array_elements(p_filter->'any') loop
      if public.fh_eval_filter(p_ctx, f) then return true; end if;
    end loop;
    return false;
  end if;
  if p_filter ? 'not' then
    return not public.fh_eval_filter(p_ctx, p_filter->'not');
  end if;

  v_field := p_filter->>'field';
  v_op := coalesce(p_filter->>'op', 'eq');
  v_val := p_filter->'value';
  if v_field is null then return true; end if;
  v_cur := public.fh_get_path(p_ctx, v_field);
  v_curs := case when v_cur is null or jsonb_typeof(v_cur) = 'null' then null
                 when jsonb_typeof(v_cur) = 'string' then v_cur #>> '{}'
                 else v_cur::text end;
  v_vals := case when v_val is null or jsonb_typeof(v_val) = 'null' then null
                 when jsonb_typeof(v_val) = 'string' then v_val #>> '{}'
                 else v_val::text end;

  case v_op
    when 'exists' then return v_cur is not null and jsonb_typeof(v_cur) <> 'null';
    when 'not_exists' then return v_cur is null or jsonb_typeof(v_cur) = 'null';
    when 'is_empty' then return v_curs is null or btrim(v_curs) = '' or v_cur = '[]'::jsonb or v_cur = '{}'::jsonb;
    when 'not_empty' then return not (v_curs is null or btrim(v_curs) = '' or v_cur = '[]'::jsonb or v_cur = '{}'::jsonb);
    when 'is_true' then return v_cur = 'true'::jsonb or lower(coalesce(v_curs,'')) in ('true','yes','1');
    when 'is_false' then return not (v_cur = 'true'::jsonb or lower(coalesce(v_curs,'')) in ('true','yes','1'));
    when 'eq' then
      v_n1 := public.fh_jsonb_to_num(v_cur); v_n2 := public.fh_jsonb_to_num(v_val);
      if v_n1 is not null and v_n2 is not null then return v_n1 = v_n2; end if;
      return lower(coalesce(v_curs,'')) = lower(coalesce(v_vals,''));
    when 'neq' then
      v_n1 := public.fh_jsonb_to_num(v_cur); v_n2 := public.fh_jsonb_to_num(v_val);
      if v_n1 is not null and v_n2 is not null then return v_n1 <> v_n2; end if;
      return lower(coalesce(v_curs,'')) <> lower(coalesce(v_vals,''));
    when 'in' then
      if v_val is null or jsonb_typeof(v_val) <> 'array' then return false; end if;
      return exists (select 1 from jsonb_array_elements_text(v_val) x where lower(x) = lower(coalesce(v_curs,'')));
    when 'nin' then
      if v_val is null or jsonb_typeof(v_val) <> 'array' then return true; end if;
      return not exists (select 1 from jsonb_array_elements_text(v_val) x where lower(x) = lower(coalesce(v_curs,'')));
    when 'contains' then
      if v_cur is not null and jsonb_typeof(v_cur) = 'array' then
        return exists (select 1 from jsonb_array_elements_text(v_cur) x where lower(x) = lower(coalesce(v_vals,'')));
      end if;
      return position(lower(coalesce(v_vals,'')) in lower(coalesce(v_curs,''))) > 0 and coalesce(v_vals,'') <> '';
    when 'not_contains' then
      if v_cur is not null and jsonb_typeof(v_cur) = 'array' then
        return not exists (select 1 from jsonb_array_elements_text(v_cur) x where lower(x) = lower(coalesce(v_vals,'')));
      end if;
      return position(lower(coalesce(v_vals,'')) in lower(coalesce(v_curs,''))) = 0;
    when 'starts_with' then return lower(coalesce(v_curs,'')) like lower(coalesce(v_vals,'')) || '%';
    when 'matches' then return coalesce(v_curs,'') ~* coalesce(v_vals,'');
    when 'gt' then v_n1 := public.fh_jsonb_to_num(v_cur); v_n2 := public.fh_jsonb_to_num(v_val); return v_n1 is not null and v_n2 is not null and v_n1 > v_n2;
    when 'gte' then v_n1 := public.fh_jsonb_to_num(v_cur); v_n2 := public.fh_jsonb_to_num(v_val); return v_n1 is not null and v_n2 is not null and v_n1 >= v_n2;
    when 'lt' then v_n1 := public.fh_jsonb_to_num(v_cur); v_n2 := public.fh_jsonb_to_num(v_val); return v_n1 is not null and v_n2 is not null and v_n1 < v_n2;
    when 'lte' then v_n1 := public.fh_jsonb_to_num(v_cur); v_n2 := public.fh_jsonb_to_num(v_val); return v_n1 is not null and v_n2 is not null and v_n1 <= v_n2;
    when 'older_than_days' then
      v_ts := public.fh_jsonb_to_ts(v_cur); v_n2 := public.fh_jsonb_to_num(v_val);
      return v_ts is not null and v_n2 is not null and v_ts < (public.fh_jsonb_to_ts(p_ctx->'now') - make_interval(days => v_n2::int));
    when 'newer_than_days' then
      v_ts := public.fh_jsonb_to_ts(v_cur); v_n2 := public.fh_jsonb_to_num(v_val);
      return v_ts is not null and v_n2 is not null and v_ts >= (public.fh_jsonb_to_ts(p_ctx->'now') - make_interval(days => v_n2::int));
    else
      return false;
  end case;
end $$;

-- ---------------------------------------------------------------------------
-- Context builders
-- ---------------------------------------------------------------------------
create or replace function public.fh_org_ctx(p_org_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_org record; v_prof record; v_set record; v_owner_name text;
begin
  select * into v_org from public.organizations where id = p_org_id;
  select * into v_set from public.fh_org_settings where org_id = p_org_id;
  select p.* into v_prof
    from public.org_members m join public.profiles p on p.user_id = m.user_id
   where m.org_id = p_org_id and m.revoked_at is null
   order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.joined_at
   limit 1;
  v_owner_name := coalesce(v_prof.full_name, '');
  return jsonb_build_object(
    'id', p_org_id,
    'name', coalesce(v_prof.company_name, v_org.name),
    'phone', v_prof.company_phone,
    'email', coalesce(v_set.default_from_email, v_prof.company_email),
    'website', v_prof.company_website,
    'address', v_prof.company_address,
    'owner_name', v_owner_name,
    'owner_first_name', public.fh_first_name(v_owner_name),
    'review_link', coalesce(v_set.review_links->>'google', v_set.review_links->>'primary'),
    'booking_url', coalesce(v_set.app_base_url,'https://fieldhorse.app') || '/book/' || coalesce(v_set.public_key,''),
    'timezone', coalesce(v_set.timezone, 'America/Chicago'),
    'public_key', v_set.public_key
  );
end $$;

create or replace function public.fh_client_ctx(p_client_id uuid, p_contact_id uuid default null, p_event jsonb default '{}'::jsonb)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare
  v_c record; v_j record; v_cons record; v_tags jsonb; v_custom jsonb; v_company jsonb; v_set record;
  v_ctx jsonb; v_first text; v_last text; v_conv record;
begin
  select * into v_c from public.fh_clients where id = p_client_id;
  if v_c.id is null then return jsonb_build_object('now', now()); end if;
  select * into v_set from public.fh_org_settings where org_id = v_c.org_id;
  select coalesce(jsonb_agg(tag order by tag), '[]'::jsonb) into v_tags from public.fh_client_tags where client_id = p_client_id;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_custom from public.fh_client_fields where client_id = p_client_id;
  select * into v_cons from public.fh_consent where client_id = p_client_id;
  select * into v_conv from public.fh_conversations where client_id = p_client_id and org_id = v_c.org_id;
  if p_contact_id is not null then
    select * into v_j from public.fh_contacts where id = p_contact_id;
  else
    select * into v_j from public.fh_contacts where client_id = p_client_id
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
end $$;

-- ---------------------------------------------------------------------------
-- Send window (org local time)
-- ---------------------------------------------------------------------------
create or replace function public.fh_org_tz(p_org_id uuid)
returns text
language sql stable
set search_path = pg_catalog, public
as $$
  select coalesce((select timezone from public.fh_org_settings where org_id = p_org_id), 'America/Chicago')
$$;

create or replace function public.fh_in_send_window(p_org_id uuid, p_at timestamptz default now())
returns boolean
language plpgsql stable
set search_path = pg_catalog, public
as $$
declare v_set record; v_local time;
begin
  select * into v_set from public.fh_org_settings where org_id = p_org_id;
  if v_set.org_id is null then return true; end if;
  v_local := (p_at at time zone v_set.timezone)::time;
  return v_local >= v_set.send_window_start and v_local < v_set.send_window_end;
end $$;

create or replace function public.fh_next_send_window_start(p_org_id uuid, p_at timestamptz default now())
returns timestamptz
language plpgsql stable
set search_path = pg_catalog, public
as $$
declare v_set record; v_local timestamp; v_day date; v_start timestamptz;
begin
  select * into v_set from public.fh_org_settings where org_id = p_org_id;
  if v_set.org_id is null then return p_at; end if;
  v_local := p_at at time zone v_set.timezone;
  v_day := v_local::date;
  if v_local::time < v_set.send_window_start then
    v_start := (v_day + v_set.send_window_start) at time zone v_set.timezone;
  else
    v_start := ((v_day + 1) + v_set.send_window_start) at time zone v_set.timezone;
  end if;
  return v_start;
end $$;

-- Next occurrence of a local time of day (optionally restricted to weekdays list)
create or replace function public.fh_next_local_time(p_org_id uuid, p_time time, p_days text[] default null, p_after timestamptz default now())
returns timestamptz
language plpgsql stable
set search_path = pg_catalog, public
as $$
declare v_tz text := public.fh_org_tz(p_org_id); v_local timestamp; v_day date; v_cand timestamptz; i int;
begin
  v_local := p_after at time zone v_tz;
  v_day := v_local::date;
  if v_local::time >= p_time then v_day := v_day + 1; end if;
  for i in 0..8 loop
    if p_days is null or array_length(p_days,1) is null
       or lower(to_char(v_day, 'dy')) = any (select lower(x) from unnest(p_days) x) then
      v_cand := (v_day + p_time) at time zone v_tz;
      return v_cand;
    end if;
    v_day := v_day + 1;
  end loop;
  return (v_day + p_time) at time zone v_tz;
end $$;

-- ---------------------------------------------------------------------------
-- Hold evaluation (why a send cannot go right now) and enqueue
-- ---------------------------------------------------------------------------
create or replace function public.fh_pick_phone_number(p_org_id uuid, p_tag text default null)
returns uuid
language sql stable
set search_path = pg_catalog, public
as $$
  select id from public.fh_phone_numbers
   where org_id = p_org_id and status = 'active'
   order by (p_tag is not null and source_tag = p_tag) desc, is_default desc, (sms_status = 'approved') desc, created_at
   limit 1
$$;

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

-- Create the message row + outbox row. Returns message id.
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
  select * into v_set from public.fh_org_settings where org_id = p_org_id;
  v_conv := public.fh_conversation_for_client(p_org_id, p_client_id);

  if p_channel in ('sms','mms','call','voice_drop') then
    v_num := coalesce(p_phone_number_id, public.fh_pick_phone_number(p_org_id, p_extra->>'from_number_tag'));
    v_to := public.fh_normalize_phone(v_client.phone);
    select e164 into v_from from public.fh_phone_numbers where id = v_num;
  elsif p_channel = 'email' then
    v_to := public.fh_normalize_email(v_client.email);
    v_from := coalesce(v_set.default_from_email, (select c.config->>'from_email' from public.fh_channels c where c.org_id = p_org_id and c.kind = 'email' and c.status = 'active' order by created_at limit 1));
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

-- Re-evaluate held outbox rows (quiet hours passed, number approved, consent given)
create or replace function public.fh_outbox_release_holds()
returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare r record; v_hold record; v_released int := 0; v_purpose text;
begin
  for r in select o.*, m.purpose as m_purpose, m.client_id as m_client
             from public.fh_outbox o left join public.fh_messages m on m.id = o.message_id
            where o.status = 'held' and o.next_attempt_at <= now()
            order by o.created_at limit 500
  loop
    if r.hold_reason = 'dnd' or r.hold_reason = 'opted_out' then
      -- only released by an explicit consent change (handled by trigger below); re-check anyway
      null;
    end if;
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

-- When consent flips to opted_in, or a number gets approved, pull holds forward
create or replace function public.fh_consent_release_trg()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  update public.fh_outbox set next_attempt_at = now(), updated_at = now()
   where status = 'held' and client_id = new.client_id;
  return null;
end $$;
drop trigger if exists fh_consent_release on public.fh_consent;
create trigger fh_consent_release after update on public.fh_consent
for each row when (old.sms_status is distinct from new.sms_status or old.email_status is distinct from new.email_status or old.dnd_all is distinct from new.dnd_all or old.calls_status is distinct from new.calls_status)
execute function public.fh_consent_release_trg();

create or replace function public.fh_phone_number_release_trg()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if new.sms_status = 'approved' then
    update public.fh_outbox set next_attempt_at = now(), updated_at = now()
     where status = 'held' and org_id = new.org_id and hold_reason in ('a2p_pending','no_number');
  end if;
  return null;
end $$;
drop trigger if exists fh_phone_number_release on public.fh_phone_numbers;
create trigger fh_phone_number_release after update of sms_status on public.fh_phone_numbers
for each row execute function public.fh_phone_number_release_trg();

-- ---------------------------------------------------------------------------
-- Outbox worker RPCs (service role)
-- ---------------------------------------------------------------------------
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
    select id from public.fh_outbox
     where status = 'queued' and next_attempt_at <= now()
     order by next_attempt_at, created_at
     limit greatest(1, least(p_limit, 200))
     for update skip locked
  )
  update public.fh_outbox o
     set status = 'processing', locked_at = now(), locked_by = p_worker, attempts = o.attempts + 1, updated_at = now()
    from c where o.id = c.id
  returning o.*;
end $$;

create or replace function public.fh_outbox_complete(p_id uuid, p_ok boolean, p_result jsonb default '{}'::jsonb, p_error text default null, p_retryable boolean default true)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare o record; v_backoff interval;
begin
  select * into o from public.fh_outbox where id = p_id;
  if o.id is null then return; end if;
  if p_ok then
    update public.fh_outbox set status = 'done', result = coalesce(p_result,'{}'::jsonb), done_at = now(), locked_at = null, locked_by = null, last_error = null, updated_at = now() where id = p_id;
    if o.message_id is not null then
      update public.fh_messages
         set status = coalesce(p_result->>'status', 'sent'),
             provider = coalesce(p_result->>'provider', provider),
             provider_message_id = coalesce(p_result->>'provider_message_id', provider_message_id),
             provider_status = coalesce(p_result->>'provider_status', provider_status),
             sent_at = coalesce(sent_at, now()), hold_reason = null, error = null, updated_at = now()
       where id = o.message_id;
      perform public.fh_emit_event(o.org_id, 'message.sent', o.client_id, null,
        jsonb_build_object('message_id', o.message_id, 'kind', o.kind, 'run_id', o.run_id), 'outbox');
    end if;
    if o.run_id is not null then
      insert into public.fh_workflow_run_events (org_id, run_id, step_type, status, detail)
      values (o.org_id, o.run_id, o.kind, 'info', jsonb_build_object('outbox_id', o.id, 'sent', true, 'result', coalesce(p_result,'{}'::jsonb)));
    end if;
  else
    if p_retryable and o.attempts < o.max_attempts then
      v_backoff := make_interval(mins => (2 ^ least(o.attempts, 6))::int);
      update public.fh_outbox set status = 'queued', next_attempt_at = now() + v_backoff, last_error = p_error, locked_at = null, locked_by = null, updated_at = now() where id = p_id;
      if o.message_id is not null then
        update public.fh_messages set status = 'queued', error = p_error, updated_at = now() where id = o.message_id;
      end if;
    else
      update public.fh_outbox set status = 'failed', last_error = p_error, result = coalesce(p_result,'{}'::jsonb), locked_at = null, locked_by = null, done_at = now(), updated_at = now() where id = p_id;
      if o.message_id is not null then
        update public.fh_messages set status = 'failed', error = p_error, updated_at = now() where id = o.message_id;
        perform public.fh_emit_event(o.org_id, 'message.failed', o.client_id, null,
          jsonb_build_object('message_id', o.message_id, 'kind', o.kind, 'error', p_error, 'run_id', o.run_id), 'outbox');
      end if;
      if o.run_id is not null then
        insert into public.fh_workflow_run_events (org_id, run_id, step_type, status, detail)
        values (o.org_id, o.run_id, o.kind, 'error', jsonb_build_object('outbox_id', o.id, 'error', p_error));
      end if;
      if o.agent_run_id is not null then
        update public.fh_agent_runs set status = 'failed', error = p_error, updated_at = now() where id = o.agent_run_id and status in ('pending','running');
      end if;
    end if;
  end if;
end $$;

-- Provider delivery status callbacks (Twilio / email provider)
create or replace function public.fh_message_provider_status(p_provider text, p_provider_message_id text, p_status text, p_error text default null, p_extra jsonb default '{}'::jsonb)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare m record; v_new text;
begin
  select * into m from public.fh_messages where provider = p_provider and provider_message_id = p_provider_message_id order by created_at desc limit 1;
  if m.id is null then return null; end if;
  v_new := case lower(p_status)
    when 'delivered' then 'delivered'
    when 'undelivered' then 'undelivered'
    when 'failed' then 'failed'
    when 'bounced' then 'failed'
    when 'complained' then 'failed'
    when 'opened' then 'read'
    when 'sent' then 'sent'
    when 'accepted' then 'sent'
    when 'queued' then 'sending'
    else m.status end;
  update public.fh_messages
     set status = case when m.status in ('delivered','read') and v_new = 'sent' then m.status else v_new end,
         provider_status = p_status,
         error = coalesce(p_error, error),
         delivered_at = case when v_new = 'delivered' then coalesce(delivered_at, now()) else delivered_at end,
         read_at = case when v_new = 'read' then coalesce(read_at, now()) else read_at end,
         updated_at = now()
   where id = m.id;
  if v_new in ('delivered','undelivered','failed') then
    perform public.fh_emit_event(m.org_id, 'message.' || v_new, m.client_id, m.contact_id,
      jsonb_build_object('message_id', m.id, 'channel', m.channel, 'provider_status', p_status, 'error', p_error) || coalesce(p_extra,'{}'::jsonb), 'provider');
  end if;
  return m.id;
end $$;

-- ---------------------------------------------------------------------------
-- Workflow definition validation + publish
-- ---------------------------------------------------------------------------
create or replace function public.fh_workflow_validate(p_def jsonb)
returns text[]
language plpgsql immutable
set search_path = pg_catalog, public
as $$
declare
  errs text[] := '{}';
  v_start text; k text; s jsonb; t jsonb; nxt text;
  v_types text[] := array['send_sms','send_email','notify','wait','branch','add_tag','remove_tag','update_field','move_stage','assign','create_task','webhook','agent','review_request','enroll_workflow','cancel_workflow','call','voice_drop','end'];
begin
  if p_def is null or p_def = '{}'::jsonb then return array['definition is empty']; end if;
  v_start := p_def->>'start';
  if v_start is null then errs := errs || 'missing start step'; end if;
  if p_def->'steps' is null or jsonb_typeof(p_def->'steps') <> 'object' then
    return errs || 'steps must be an object keyed by step id';
  end if;
  if v_start is not null and (p_def->'steps') -> v_start is null then errs := errs || ('start step ' || v_start || ' does not exist'); end if;
  if p_def->'triggers' is not null and jsonb_typeof(p_def->'triggers') <> 'array' then errs := errs || 'triggers must be an array'; end if;
  for t in select * from jsonb_array_elements(coalesce(p_def->'triggers','[]'::jsonb)) loop
    if t->>'type' is null then errs := errs || 'trigger without type'; end if;
  end loop;
  for k, s in select * from jsonb_each(p_def->'steps') loop
    if s->>'type' is null or not (s->>'type' = any (v_types)) then
      errs := errs || ('step ' || k || ' has unknown type ' || coalesce(s->>'type','(none)'));
      continue;
    end if;
    nxt := s->>'next';
    if nxt is not null and (p_def->'steps') -> nxt is null then errs := errs || ('step ' || k || ' points to missing step ' || nxt); end if;
    if s->>'type' = 'branch' then
      if s->'branches' is null or jsonb_typeof(s->'branches') <> 'array' then errs := errs || ('branch ' || k || ' needs branches[]'); end if;
      if s->>'else' is not null and (p_def->'steps') -> (s->>'else') is null then errs := errs || ('branch ' || k || ' else points to missing step'); end if;
      for t in select * from jsonb_array_elements(coalesce(s->'branches','[]'::jsonb)) loop
        if t->>'next' is null or (p_def->'steps') -> (t->>'next') is null then errs := errs || ('branch ' || k || ' has a path to a missing step'); end if;
      end loop;
    end if;
    if s->>'type' = 'wait' then
      if s->>'duration' is null and s->'until' is null and s->>'until_event' is null then errs := errs || ('wait ' || k || ' needs duration, until, or until_event'); end if;
      if s->>'on_timeout' is not null and (p_def->'steps') -> (s->>'on_timeout') is null then errs := errs || ('wait ' || k || ' on_timeout points to missing step'); end if;
      if s->>'duration' is not null then
        begin perform (s->>'duration')::interval; exception when others then errs := errs || ('wait ' || k || ' has an invalid duration'); end;
      end if;
    end if;
    if s->>'type' in ('send_sms','send_email') and coalesce(s->>'body','') = '' and coalesce(s->>'template_key','') = '' then
      errs := errs || ('step ' || k || ' needs a body or template_key');
    end if;
    if s->>'type' = 'send_email' and coalesce(s->>'subject','') = '' and coalesce(s->>'template_key','') = '' then
      errs := errs || ('step ' || k || ' needs a subject');
    end if;
    if s->>'type' in ('add_tag','remove_tag') and coalesce(s->>'tag','') = '' then errs := errs || ('step ' || k || ' needs a tag'); end if;
    if s->>'type' = 'move_stage' and coalesce(s->>'stage','') not in ('lead','quote','job','closed','lost') then errs := errs || ('step ' || k || ' stage must be lead, quote, job, closed, or lost'); end if;
    if s->>'type' = 'agent' and coalesce(s->>'agent_key','') = '' then errs := errs || ('step ' || k || ' needs agent_key'); end if;
    if s->>'type' = 'webhook' and coalesce(s->>'url','') = '' then errs := errs || ('step ' || k || ' needs url'); end if;
    if s->>'type' in ('enroll_workflow','cancel_workflow') and coalesce(s->>'workflow_key','') = '' then errs := errs || ('step ' || k || ' needs workflow_key'); end if;
  end loop;
  return errs;
end $$;

create or replace function public.fh_workflow_publish(p_workflow_id uuid, p_activate boolean default true)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare w record; errs text[]; v_ver int; v_vid uuid; v_types text[];
begin
  select * into w from public.fh_workflows where id = p_workflow_id;
  if w.id is null then raise exception 'workflow not found'; end if;
  if auth.uid() is not null and not public.fh_is_org_manager(w.org_id) then raise exception 'not allowed'; end if;
  errs := public.fh_workflow_validate(w.draft_definition);
  if array_length(errs, 1) is not null then
    raise exception 'workflow invalid: %', array_to_string(errs, '; ');
  end if;
  select coalesce(max(version),0) + 1 into v_ver from public.fh_workflow_versions where workflow_id = p_workflow_id;
  insert into public.fh_workflow_versions (org_id, workflow_id, version, definition, published_by)
  values (w.org_id, p_workflow_id, v_ver, w.draft_definition, auth.uid())
  returning id into v_vid;
  select coalesce(array_agg(distinct t->>'type'), '{}') into v_types from jsonb_array_elements(coalesce(w.draft_definition->'triggers','[]'::jsonb)) t;
  update public.fh_workflows
     set active_version_id = v_vid, trigger_types = v_types,
         status = case when p_activate then 'active' else (case when status = 'draft' then 'paused' else status end) end,
         updated_at = now()
   where id = p_workflow_id;
  return v_vid;
end $$;

-- ---------------------------------------------------------------------------
-- Enrollment
-- ---------------------------------------------------------------------------
create or replace function public.fh_enroll(
  p_workflow_id uuid, p_client_id uuid, p_contact_id uuid default null,
  p_event_id uuid default null, p_event jsonb default '{}'::jsonb, p_source text default 'trigger'
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare w record; v record; v_settings jsonb; v_run uuid; v_contact uuid; v_exclusive boolean;
begin
  select * into w from public.fh_workflows where id = p_workflow_id;
  if w.id is null or w.active_version_id is null or w.status = 'archived' then return null; end if;
  if p_source = 'trigger' and w.status <> 'active' then return null; end if;
  select * into v from public.fh_workflow_versions where id = w.active_version_id;
  v_settings := coalesce(v.definition->'settings', '{}'::jsonb);
  v_exclusive := not coalesce((v_settings->>'allow_multiple_active')::boolean, false);

  if v_exclusive and exists (select 1 from public.fh_workflow_runs r where r.workflow_id = p_workflow_id and r.client_id = p_client_id and r.status in ('active','waiting')) then
    return null;
  end if;
  if not coalesce((v_settings->>'allow_reenrollment')::boolean, true)
     and exists (select 1 from public.fh_workflow_runs r where r.workflow_id = p_workflow_id and r.client_id = p_client_id) then
    return null;
  end if;

  v_contact := p_contact_id;
  if v_contact is null then
    select id into v_contact from public.fh_contacts where client_id = p_client_id and org_id = w.org_id
     order by case stage when 'lead' then 0 when 'quote' then 1 when 'job' then 2 else 3 end, updated_at desc limit 1;
  end if;

  insert into public.fh_workflow_runs (org_id, workflow_id, version_id, client_id, contact_id, status, exclusive, current_step_id, context, trigger_event_id, source)
  values (w.org_id, p_workflow_id, w.active_version_id, p_client_id, v_contact, 'active', v_exclusive, v.definition->>'start',
          jsonb_build_object('event', coalesce(p_event,'{}'::jsonb), 'workflow_key', w.key), p_event_id, coalesce(p_source,'trigger'))
  returning id into v_run;

  insert into public.fh_workflow_run_events (org_id, run_id, step_type, status, detail)
  values (w.org_id, v_run, 'enroll', 'info', jsonb_build_object('source', p_source, 'event', coalesce(p_event,'{}'::jsonb)));

  update public.fh_workflows set stats = coalesce(stats,'{}'::jsonb) || jsonb_build_object('enrolled', coalesce((stats->>'enrolled')::int,0) + 1, 'last_enrolled_at', now()) where id = p_workflow_id;
  return v_run;
end $$;

-- UI entry point: enroll several clients by hand
create or replace function public.fh_enroll_manual(p_workflow_id uuid, p_client_ids uuid[])
returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare w record; c uuid; n int := 0;
begin
  select * into w from public.fh_workflows where id = p_workflow_id;
  if w.id is null or (auth.uid() is not null and not public.fh_is_org_member(w.org_id)) then raise exception 'not allowed'; end if;
  foreach c in array p_client_ids loop
    if exists (select 1 from public.fh_clients where id = c and org_id = w.org_id) then
      if public.fh_enroll(p_workflow_id, c, null, null, jsonb_build_object('type','manual','by', auth.uid()), 'manual') is not null then n := n + 1; end if;
    end if;
  end loop;
  return n;
end $$;

create or replace function public.fh_run_cancel(p_run_id uuid, p_reason text default 'cancelled')
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare r record;
begin
  select * into r from public.fh_workflow_runs where id = p_run_id;
  if r.id is null then return; end if;
  if auth.uid() is not null and not public.fh_is_org_member(r.org_id) then raise exception 'not allowed'; end if;
  update public.fh_workflow_runs set status = 'cancelled', ended_at = now(), ended_reason = p_reason, updated_at = now()
   where id = p_run_id and status in ('active','waiting');
  update public.fh_outbox set status = 'canceled', updated_at = now() where run_id = p_run_id and status in ('queued','held');
  update public.fh_messages set status = 'canceled', updated_at = now() where workflow_run_id = p_run_id and status in ('queued','held');
  insert into public.fh_workflow_run_events (org_id, run_id, step_type, status, detail) values (r.org_id, p_run_id, 'cancel', 'end', jsonb_build_object('reason', p_reason));
end $$;

-- ---------------------------------------------------------------------------
-- Step executor
-- ---------------------------------------------------------------------------
create or replace function public.fh_run_log(p_org uuid, p_run uuid, p_step text, p_type text, p_status text, p_detail jsonb default '{}'::jsonb)
returns void
language sql security definer
set search_path = pg_catalog, public
as $$
  insert into public.fh_workflow_run_events (org_id, run_id, step_id, step_type, status, detail)
  values (p_org, p_run, p_step, p_type, p_status, coalesce(p_detail,'{}'::jsonb))
$$;

create or replace function public.fh_notify_org(p_org_id uuid, p_kind text, p_title text, p_body text default null, p_link text default null, p_to text default 'owners', p_user_ids uuid[] default null)
returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_ids uuid[]; v_set record; n int := 0; u uuid;
begin
  select * into v_set from public.fh_org_settings where org_id = p_org_id;
  if p_user_ids is not null and array_length(p_user_ids,1) > 0 then
    v_ids := p_user_ids;
  elsif array_length(v_set.owner_notify_user_ids,1) > 0 then
    v_ids := v_set.owner_notify_user_ids;
  else
    select coalesce(array_agg(user_id), '{}') into v_ids from public.org_members
     where org_id = p_org_id and revoked_at is null and (p_to = 'all' or role in ('owner','admin','manager'));
  end if;
  foreach u in array coalesce(v_ids,'{}'::uuid[]) loop
    insert into public.fh_notifications (user_id, org_id, kind, title, body, link) values (u, p_org_id, p_kind, p_title, p_body, p_link);
    n := n + 1;
  end loop;
  return n;
end $$;

create or replace function public.fh_advance_run(p_run_id uuid, p_max_steps integer default 30)
returns text
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  r record; v record; def jsonb; steps jsonb; s jsonb; v_type text; v_step text; v_next text;
  ctx jsonb; ctx_dirty boolean := true; n int := 0; v_msg uuid; v_body text; v_subject text; v_html text;
  v_tmpl record; b jsonb; matched boolean; v_agent record; v_ar uuid; v_wf uuid; v_num uuid; v_task uuid;
  v_owner uuid; v_due timestamptz; v_url text; v_hold text; v_phone text; v_set record; v_immediate boolean;
begin
  select * into r from public.fh_workflow_runs where id = p_run_id for update;
  if r.id is null then return 'missing'; end if;
  if r.status not in ('active','waiting') then return r.status; end if;

  -- waiting: either the timer elapsed or an event resumed us
  if r.status = 'waiting' then
    if r.wait_until is null or r.wait_until > now() then return 'waiting'; end if;
    if r.waiting_for_event is not null then
      -- timed out waiting for the event
      v_next := coalesce(r.on_timeout_step_id, r.current_step_id);
      perform public.fh_run_log(r.org_id, r.id, r.current_step_id, 'wait', 'info', jsonb_build_object('timed_out_waiting_for', r.waiting_for_event, 'continue_at', v_next));
      update public.fh_workflow_runs set status = 'active', current_step_id = v_next, wait_until = null, waiting_for_event = null, on_timeout_step_id = null, updated_at = now() where id = r.id;
    else
      update public.fh_workflow_runs set status = 'active', wait_until = null, updated_at = now() where id = r.id;
    end if;
    select * into r from public.fh_workflow_runs where id = p_run_id;
  end if;

  select * into v from public.fh_workflow_versions where id = r.version_id;
  def := v.definition; steps := def->'steps';
  select * into v_set from public.fh_org_settings where org_id = r.org_id;
  v_step := r.current_step_id;

  while n < p_max_steps loop
    n := n + 1;
    if v_step is null then
      update public.fh_workflow_runs set status = 'completed', ended_at = now(), ended_reason = 'end', updated_at = now() where id = r.id;
      perform public.fh_run_log(r.org_id, r.id, null, 'end', 'end', '{}'::jsonb);
      return 'completed';
    end if;
    s := steps -> v_step;
    if s is null then
      update public.fh_workflow_runs set status = 'failed', ended_at = now(), ended_reason = 'missing step ' || v_step, last_error = 'missing step', updated_at = now() where id = r.id;
      return 'failed';
    end if;
    if r.steps_executed + n > 500 then
      update public.fh_workflow_runs set status = 'failed', ended_at = now(), ended_reason = 'step limit', updated_at = now() where id = r.id;
      return 'failed';
    end if;
    v_type := s->>'type';
    v_next := s->>'next';
    if ctx_dirty then
      ctx := public.fh_client_ctx(r.client_id, r.contact_id, coalesce(r.context->'event','{}'::jsonb)) || jsonb_build_object('run', jsonb_build_object('id', r.id, 'workflow_key', r.context->>'workflow_key'));
      ctx_dirty := false;
    end if;

    begin
      case v_type
        when 'end' then
          update public.fh_workflow_runs set status = 'completed', current_step_id = v_step, ended_at = now(), ended_reason = 'end', steps_executed = steps_executed + n, updated_at = now() where id = r.id;
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'end', '{}'::jsonb);
          return 'completed';

        when 'send_sms' then
          v_body := s->>'body';
          if coalesce(v_body,'') = '' and s->>'template_key' is not null then
            select * into v_tmpl from public.fh_message_templates where org_id = r.org_id and key = s->>'template_key';
            v_body := v_tmpl.body;
          end if;
          v_body := public.fh_render_template(v_body, ctx);
          v_num := case when s->>'from_number_tag' is not null then public.fh_pick_phone_number(r.org_id, s->>'from_number_tag') else null end;
          v_msg := public.fh_enqueue_message(r.org_id, r.client_id, r.contact_id, 'sms', v_body, null, coalesce(s->>'purpose','transactional'),
                     r.id, 'workflow', null, v_num, null, null, coalesce((s->>'immediate')::boolean,false), null, coalesce(s->'media','[]'::jsonb), '{}'::jsonb);
          select hold_reason into v_hold from public.fh_messages where id = v_msg;
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, case when v_hold is null then 'ok' else 'held' end, jsonb_build_object('message_id', v_msg, 'hold_reason', v_hold, 'preview', left(v_body, 160)));

        when 'send_email' then
          v_body := s->>'body'; v_subject := s->>'subject'; v_html := s->>'body_html';
          if coalesce(v_body,'') = '' and s->>'template_key' is not null then
            select * into v_tmpl from public.fh_message_templates where org_id = r.org_id and key = s->>'template_key';
            v_body := v_tmpl.body; v_subject := coalesce(v_subject, v_tmpl.subject); v_html := coalesce(v_html, v_tmpl.body_html);
          end if;
          v_body := public.fh_render_template(v_body, ctx);
          v_subject := public.fh_render_template(v_subject, ctx);
          v_html := case when v_html is null then null else public.fh_render_template(v_html, ctx) end;
          v_msg := public.fh_enqueue_message(r.org_id, r.client_id, r.contact_id, 'email', v_body, v_subject, coalesce(s->>'purpose','transactional'),
                     r.id, 'workflow', null, null, null, null, false, v_html, '[]'::jsonb, '{}'::jsonb);
          select hold_reason into v_hold from public.fh_messages where id = v_msg;
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, case when v_hold is null then 'ok' else 'held' end, jsonb_build_object('message_id', v_msg, 'hold_reason', v_hold, 'subject', v_subject));

        when 'call' then
          -- ring the owner first, whisper who is calling, press 1 to connect to the lead
          v_immediate := coalesce((s->>'immediate')::boolean, true);
          v_msg := public.fh_enqueue_message(r.org_id, r.client_id, r.contact_id, 'call',
                     public.fh_render_template(coalesce(s->>'whisper', 'New lead {{first_name}} from {{company.name}}. Press 1 to connect.'), ctx),
                     null, 'transactional', r.id, 'workflow', null, null, null, null, v_immediate, null, '[]'::jsonb,
                     jsonb_build_object('owner_to', coalesce(s->>'to', (select voice_forward_to from public.fh_phone_numbers where org_id = r.org_id and status='active' order by is_default desc limit 1)), 'mode', 'connect'));
          select hold_reason into v_hold from public.fh_messages where id = v_msg;
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, case when v_hold is null then 'ok' else 'held' end, jsonb_build_object('message_id', v_msg, 'hold_reason', v_hold));

        when 'voice_drop' then
          v_msg := public.fh_enqueue_message(r.org_id, r.client_id, r.contact_id, 'voice_drop', s->>'audio_url', null, coalesce(s->>'purpose','marketing'),
                     r.id, 'workflow', null, null, null, null, false, null, '[]'::jsonb, jsonb_build_object('audio_url', s->>'audio_url'));
          select hold_reason into v_hold from public.fh_messages where id = v_msg;
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, case when v_hold is null then 'ok' else 'held' end, jsonb_build_object('message_id', v_msg, 'hold_reason', v_hold));

        when 'notify' then
          perform public.fh_notify_org(r.org_id, coalesce(s->>'kind','growth'),
            public.fh_render_template(coalesce(s->>'title','Update'), ctx),
            public.fh_render_template(s->>'body', ctx),
            coalesce(s->>'link', '/inbox?client=' || r.client_id::text),
            coalesce(s->>'to','owners'));
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'ok', '{}'::jsonb);

        when 'wait' then
          if s->>'until_event' is not null then
            update public.fh_workflow_runs
               set status = 'waiting', current_step_id = v_next, waiting_for_event = s->>'until_event',
                   wait_until = now() + coalesce((s->>'timeout')::interval, interval '7 days'),
                   on_timeout_step_id = coalesce(s->>'on_timeout', v_next),
                   steps_executed = steps_executed + n, updated_at = now()
             where id = r.id;
            perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'wait', jsonb_build_object('until_event', s->>'until_event', 'timeout', coalesce(s->>'timeout','P7D')));
            return 'waiting';
          elsif s->'until' is not null then
            v_due := public.fh_next_local_time(r.org_id, (s->'until'->>'time')::time,
                        case when s->'until'->'days' is not null then array(select jsonb_array_elements_text(s->'until'->'days')) else null end);
            update public.fh_workflow_runs set status = 'waiting', current_step_id = v_next, wait_until = v_due, waiting_for_event = null, on_timeout_step_id = null, steps_executed = steps_executed + n, updated_at = now() where id = r.id;
            perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'wait', jsonb_build_object('until', v_due));
            return 'waiting';
          else
            v_due := now() + (s->>'duration')::interval;
            if coalesce((s->>'business_hours')::boolean, false) and not public.fh_in_send_window(r.org_id, v_due) then
              v_due := public.fh_next_send_window_start(r.org_id, v_due);
            end if;
            update public.fh_workflow_runs set status = 'waiting', current_step_id = v_next, wait_until = v_due, waiting_for_event = null, on_timeout_step_id = null, steps_executed = steps_executed + n, updated_at = now() where id = r.id;
            perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'wait', jsonb_build_object('until', v_due, 'duration', s->>'duration'));
            return 'waiting';
          end if;

        when 'branch' then
          matched := false;
          for b in select * from jsonb_array_elements(coalesce(s->'branches','[]'::jsonb)) loop
            if public.fh_eval_filter(ctx, b->'filter') then
              v_next := b->>'next'; matched := true;
              perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'ok', jsonb_build_object('branch', coalesce(b->>'key', b->>'next')));
              exit;
            end if;
          end loop;
          if not matched then
            v_next := s->>'else';
            perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'ok', jsonb_build_object('branch', 'else'));
          end if;

        when 'add_tag' then
          perform public.fh_tag_add(r.org_id, r.client_id, public.fh_render_template(s->>'tag', ctx), 'workflow');
          ctx_dirty := true;
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'ok', jsonb_build_object('tag', s->>'tag'));

        when 'remove_tag' then
          perform public.fh_tag_remove(r.org_id, r.client_id, public.fh_render_template(s->>'tag', ctx));
          ctx_dirty := true;
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'ok', jsonb_build_object('tag', s->>'tag'));

        when 'update_field' then
          if s->>'field' like 'custom.%' then
            insert into public.fh_client_fields (client_id, org_id, key, value)
            values (r.client_id, r.org_id, substr(s->>'field', 8), to_jsonb(public.fh_render_template(s->>'value', ctx)))
            on conflict (client_id, key) do update set value = excluded.value, updated_at = now();
          elsif s->>'field' = 'client.notes' then
            update public.fh_clients set notes = concat_ws(E'\n', nullif(notes,''), public.fh_render_template(s->>'value', ctx)), updated_at = now() where id = r.client_id;
          elsif s->>'field' = 'client.source' then
            update public.fh_clients set source = public.fh_render_template(s->>'value', ctx), updated_at = now() where id = r.client_id;
          elsif s->>'field' = 'job.follow_up_on' and r.contact_id is not null then
            update public.fh_contacts set follow_up_on = (now() + (s->>'value')::interval)::date, updated_at = now() where id = r.contact_id;
          elsif s->>'field' = 'job.stage' and r.contact_id is not null then
            update public.fh_contacts set stage = s->>'value', updated_at = now() where id = r.contact_id;
          end if;
          ctx_dirty := true;
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'ok', jsonb_build_object('field', s->>'field'));

        when 'move_stage' then
          if r.contact_id is not null then
            update public.fh_contacts set stage = s->>'stage', updated_at = now() where id = r.contact_id and stage is distinct from s->>'stage';
            perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'ok', jsonb_build_object('stage', s->>'stage'));
          else
            perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'skipped', jsonb_build_object('reason', 'no job on this run'));
          end if;
          ctx_dirty := true;

        when 'assign' then
          update public.fh_conversations set assigned_to = nullif(s->>'user_id','')::uuid, updated_at = now() where org_id = r.org_id and client_id = r.client_id;
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'ok', jsonb_build_object('user_id', s->>'user_id'));

        when 'create_task' then
          select user_id into v_owner from public.org_members where org_id = r.org_id and revoked_at is null order by case role when 'owner' then 0 else 1 end, joined_at limit 1;
          v_due := case when s->>'due_in' is not null then now() + (s->>'due_in')::interval else null end;
          if r.contact_id is not null then
            insert into public.fh_job_todos (user_id, org_id, job_id, text, due_at, assigned_to)
            values (v_owner, r.org_id, r.contact_id, public.fh_render_template(s->>'text', ctx), v_due, nullif(s->>'assign_to','')::uuid)
            returning id into v_task;
            perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'ok', jsonb_build_object('todo_id', v_task));
          else
            perform public.fh_notify_org(r.org_id, 'task', public.fh_render_template(s->>'text', ctx), null, '/inbox?client=' || r.client_id::text, 'owners');
            perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'ok', jsonb_build_object('fallback', 'notification (no job on run)'));
          end if;

        when 'webhook' then
          insert into public.fh_outbox (org_id, kind, payload, run_id, client_id)
          values (r.org_id, 'webhook', jsonb_build_object(
            'url', s->>'url', 'method', coalesce(s->>'method','POST'), 'headers', coalesce(s->'headers','{}'::jsonb),
            'body', coalesce(s->'body', jsonb_build_object('client', ctx->'client', 'job', ctx->'job', 'event', ctx->'event'))), r.id, r.client_id);
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'ok', jsonb_build_object('url', s->>'url'));

        when 'agent' then
          select * into v_agent from public.fh_agents where org_id = r.org_id and key = s->>'agent_key' and status = 'active';
          if v_agent.id is null then
            perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'skipped', jsonb_build_object('reason', 'agent not found or paused', 'agent_key', s->>'agent_key'));
          else
            insert into public.fh_agent_runs (org_id, agent_id, client_id, contact_id, conversation_id, trigger_kind, run_id, mode, input, status)
            values (r.org_id, v_agent.id, r.client_id, r.contact_id, public.fh_conversation_for_client(r.org_id, r.client_id), 'workflow', r.id,
                    case when coalesce(s->>'mode', 'draft') = 'auto' and v_agent.autonomy <> 'draft' then 'auto' else 'draft' end,
                    jsonb_build_object('instructions', public.fh_render_template(s->>'instructions', ctx), 'step_id', v_step), 'pending')
            returning id into v_ar;
            insert into public.fh_outbox (org_id, kind, payload, run_id, client_id, agent_run_id)
            values (r.org_id, 'agent', jsonb_build_object('agent_run_id', v_ar), r.id, r.client_id, v_ar);
            perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'ok', jsonb_build_object('agent_run_id', v_ar, 'agent_key', s->>'agent_key'));
          end if;

        when 'review_request' then
          v_url := coalesce(s->>'review_url', ctx->>'review_link');
          if coalesce(s->>'channel','sms') = 'sms' then
            v_body := public.fh_render_template(coalesce(s->>'body', 'Thank you for choosing {{company.name}}, {{first_name}}. If you have a minute, a quick review helps us a lot: {{review_link}}'), ctx);
            v_msg := public.fh_enqueue_message(r.org_id, r.client_id, r.contact_id, 'sms', v_body, null, 'transactional', r.id, 'workflow', null, null, null, null, false, null, '[]'::jsonb, '{}'::jsonb);
          else
            v_body := public.fh_render_template(coalesce(s->>'body', 'Thank you for choosing {{company.name}}, {{first_name}}. If you have a minute, a quick review helps us a lot: {{review_link}}'), ctx);
            v_msg := public.fh_enqueue_message(r.org_id, r.client_id, r.contact_id, 'email', v_body, public.fh_render_template(coalesce(s->>'subject','A quick favor from {{company.name}}'), ctx), 'transactional', r.id, 'workflow', null, null, null, null, false, null, '[]'::jsonb, '{}'::jsonb);
          end if;
          insert into public.fh_review_requests (org_id, client_id, contact_id, channel, platform, review_url, message_id)
          values (r.org_id, r.client_id, r.contact_id, coalesce(s->>'channel','sms'), coalesce(s->>'platform','google'), v_url, v_msg);
          perform public.fh_tag_add(r.org_id, r.client_id, 'review_requested', 'workflow');
          ctx_dirty := true;
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'ok', jsonb_build_object('message_id', v_msg));

        when 'enroll_workflow' then
          select id into v_wf from public.fh_workflows where org_id = r.org_id and key = s->>'workflow_key';
          perform public.fh_enroll(v_wf, r.client_id, r.contact_id, null, jsonb_build_object('type','enroll_workflow','from_run', r.id), 'workflow');
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, case when v_wf is null then 'skipped' else 'ok' end, jsonb_build_object('workflow_key', s->>'workflow_key'));

        when 'cancel_workflow' then
          if s->>'workflow_key' = 'all_others' then
            update public.fh_workflow_runs set status = 'cancelled', ended_at = now(), ended_reason = 'cancelled by ' || (r.context->>'workflow_key'), updated_at = now()
             where client_id = r.client_id and org_id = r.org_id and id <> r.id and status in ('active','waiting');
          else
            update public.fh_workflow_runs x set status = 'cancelled', ended_at = now(), ended_reason = 'cancelled by ' || (r.context->>'workflow_key'), updated_at = now()
              from public.fh_workflows w
             where w.id = x.workflow_id and w.key = s->>'workflow_key' and x.client_id = r.client_id and x.org_id = r.org_id and x.id <> r.id and x.status in ('active','waiting');
          end if;
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'ok', jsonb_build_object('workflow_key', s->>'workflow_key'));

        else
          perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'skipped', jsonb_build_object('reason', 'unknown step type'));
      end case;
    exception when others then
      perform public.fh_run_log(r.org_id, r.id, v_step, v_type, 'error', jsonb_build_object('error', sqlerrm));
      update public.fh_workflow_runs set last_error = sqlerrm, updated_at = now() where id = r.id;
      -- keep going: one bad step should not strand the whole sequence
    end;

    v_step := v_next;
    update public.fh_workflow_runs set current_step_id = v_step, updated_at = now() where id = r.id;
  end loop;

  update public.fh_workflow_runs set steps_executed = steps_executed + n, updated_at = now() where id = r.id;
  return 'active';
end $$;

-- ---------------------------------------------------------------------------
-- Event dispatch: resume waits, stop on reply, goals, trigger enrollment
-- ---------------------------------------------------------------------------
create or replace function public.fh_dispatch_events(p_limit integer default 500)
returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare ev record; w record; t jsonb; ctx jsonb; n int := 0; v_payload jsonb; v_enrolled boolean;
begin
  for ev in select * from public.fh_events where processed_at is null order by occurred_at limit p_limit for update skip locked loop
    begin
      v_payload := coalesce(ev.payload,'{}'::jsonb) || jsonb_build_object('type', ev.type, 'event_id', ev.id, 'occurred_at', ev.occurred_at);

      if ev.client_id is not null then
        -- resume runs waiting for this event
        update public.fh_workflow_runs r
           set status = 'active', wait_until = now(), waiting_for_event = null, on_timeout_step_id = null,
               context = r.context || jsonb_build_object('event', v_payload), updated_at = now()
         where r.org_id = ev.org_id and r.client_id = ev.client_id and r.status = 'waiting' and r.waiting_for_event = ev.type;

        -- stop on reply
        if ev.type = 'message.inbound' then
          update public.fh_workflow_runs r
             set status = 'cancelled', ended_at = now(), ended_reason = 'replied', updated_at = now()
            from public.fh_workflow_versions v
           where v.id = r.version_id and r.org_id = ev.org_id and r.client_id = ev.client_id and r.status in ('active','waiting')
             and coalesce((v.definition->'settings'->>'stop_on_reply')::boolean, false);
          update public.fh_outbox o set status = 'canceled', updated_at = now()
            from public.fh_workflow_runs r where r.id = o.run_id and r.status = 'cancelled' and r.ended_reason = 'replied' and o.status in ('queued','held') and r.client_id = ev.client_id;
          update public.fh_messages m set status = 'canceled', updated_at = now()
            from public.fh_workflow_runs r where r.id = m.workflow_run_id and r.status = 'cancelled' and r.ended_reason = 'replied' and m.status in ('queued','held') and r.client_id = ev.client_id;
        end if;

        -- goals
        update public.fh_workflow_runs r
           set status = 'goal_met', ended_at = now(), ended_reason = 'goal: ' || ev.type, updated_at = now()
          from public.fh_workflow_versions v
         where v.id = r.version_id and r.org_id = ev.org_id and r.client_id = ev.client_id and r.status in ('active','waiting')
           and v.definition->'settings'->'goal'->>'event' = ev.type
           and public.fh_eval_filter(public.fh_client_ctx(ev.client_id, r.contact_id, v_payload), v.definition->'settings'->'goal'->'filter');
        update public.fh_outbox o set status = 'canceled', updated_at = now()
          from public.fh_workflow_runs r where r.id = o.run_id and r.status = 'goal_met' and o.status in ('queued','held') and r.client_id = ev.client_id;
        update public.fh_messages m set status = 'canceled', updated_at = now()
          from public.fh_workflow_runs r where r.id = m.workflow_run_id and r.status = 'goal_met' and m.status in ('queued','held') and r.client_id = ev.client_id;

        -- triggers
        ctx := null;
        for w in select wf.*, v.definition from public.fh_workflows wf join public.fh_workflow_versions v on v.id = wf.active_version_id
                  where wf.org_id = ev.org_id and wf.status = 'active' and ev.type = any (wf.trigger_types) loop
          for t in select * from jsonb_array_elements(coalesce(w.definition->'triggers','[]'::jsonb)) loop
            if t->>'type' = ev.type then
              if ctx is null then ctx := public.fh_client_ctx(ev.client_id, ev.contact_id, v_payload); end if;
              if public.fh_eval_filter(ctx, t->'filter') then
                perform public.fh_enroll(w.id, ev.client_id, ev.contact_id, ev.id, v_payload, 'trigger');
                exit;
              end if;
            end if;
          end loop;
        end loop;
      end if;

      update public.fh_events set processed_at = now() where id = ev.id;
      n := n + 1;
    exception when others then
      update public.fh_events set processed_at = now(), processing_error = sqlerrm where id = ev.id;
    end;
  end loop;
  return n;
end $$;

create or replace function public.fh_advance_runs(p_limit integer default 200)
returns integer
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare r record; n int := 0;
begin
  for r in select id from public.fh_workflow_runs
            where status = 'active' or (status = 'waiting' and wait_until is not null and wait_until <= now())
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

-- The heartbeat. pg_cron calls this every minute (075). Safe to call any time.
create or replace function public.fh_automation_tick()
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_dispatched int; v_advanced int; v_released int; v_queued int; v_url text; v_secret text; v_req bigint;
begin
  v_dispatched := public.fh_dispatch_events(500);
  v_advanced := public.fh_advance_runs(200);
  -- a run that just got enqueued by dispatch should not wait a full minute
  v_advanced := v_advanced + public.fh_advance_runs(200);
  v_released := public.fh_outbox_release_holds();
  select count(*) into v_queued from public.fh_outbox where status = 'queued' and next_attempt_at <= now();

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
  return jsonb_build_object('dispatched', v_dispatched, 'advanced', v_advanced, 'released', v_released, 'queued', v_queued, 'at', now());
end $$;

-- ---------------------------------------------------------------------------
-- Agent run approval (inbox copilot)
-- ---------------------------------------------------------------------------
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
  if v_body is not null and v_channel in ('sms','email') then
    v_msg := public.fh_enqueue_message(ar.org_id, ar.client_id, ar.contact_id, v_channel, v_body, v_subject, 'transactional', ar.run_id, 'agent', auth.uid(), null, null, ar.id, true, null, '[]'::jsonb, '{}'::jsonb);
  end if;
  -- side actions the agent proposed (tags, stage)
  for a in select * from jsonb_array_elements(coalesce(ar.proposal->'actions','[]'::jsonb)) loop
    if a->>'type' = 'add_tag' then perform public.fh_tag_add(ar.org_id, ar.client_id, a->>'tag', 'agent', auth.uid()); end if;
    if a->>'type' = 'set_stage' and ar.contact_id is not null then update public.fh_contacts set stage = a->>'stage', updated_at = now() where id = ar.contact_id; end if;
  end loop;
  update public.fh_agent_runs set status = 'executed', approved_by = auth.uid(), approved_at = now(), executed_message_id = v_msg,
         proposal = coalesce(proposal,'{}'::jsonb) || jsonb_build_object('final_body', v_body), updated_at = now() where id = ar.id;
  return v_msg;
end $$;

create or replace function public.fh_agent_run_reject(p_agent_run_id uuid, p_reason text default null)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare ar record;
begin
  select * into ar from public.fh_agent_runs where id = p_agent_run_id;
  if ar.id is null then return; end if;
  if auth.uid() is not null and not public.fh_is_org_member(ar.org_id) then raise exception 'not allowed'; end if;
  update public.fh_agent_runs set status = 'rejected', approved_by = auth.uid(), approved_at = now(), error = p_reason, updated_at = now() where id = ar.id and status = 'proposed';
end $$;

-- Ask an agent to draft a reply inside a conversation (inbox button)
create or replace function public.fh_agent_request(p_agent_key text, p_client_id uuid, p_instructions text default null, p_contact_id uuid default null)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare c record; a record; v_ar uuid;
begin
  select * into c from public.fh_clients where id = p_client_id;
  if c.id is null or (auth.uid() is not null and not public.fh_is_org_member(c.org_id)) then raise exception 'not allowed'; end if;
  select * into a from public.fh_agents where org_id = c.org_id and key = p_agent_key and status = 'active';
  if a.id is null then raise exception 'agent % not found', p_agent_key; end if;
  insert into public.fh_agent_runs (org_id, agent_id, client_id, contact_id, conversation_id, trigger_kind, mode, input, status)
  values (c.org_id, a.id, c.id, p_contact_id, public.fh_conversation_for_client(c.org_id, c.id), 'inbox', 'draft',
          jsonb_build_object('instructions', p_instructions, 'requested_by', auth.uid()), 'pending')
  returning id into v_ar;
  insert into public.fh_outbox (org_id, kind, payload, client_id, agent_run_id)
  values (c.org_id, 'agent', jsonb_build_object('agent_run_id', v_ar), c.id, v_ar);
  return v_ar;
end $$;

-- Send a message by hand from the inbox
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

-- ---------------------------------------------------------------------------
-- Standard triggers + RLS + grants
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['fh_workflows','fh_workflow_versions','fh_workflow_runs','fh_workflow_run_events','fh_outbox','fh_agents','fh_agent_runs','fh_review_requests'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_org_id', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.fh_set_org_id()', t || '_set_org_id', t);
    execute format('alter table public.%I enable row level security', t);
  end loop;
  foreach t in array array['fh_workflows','fh_workflow_runs','fh_outbox','fh_agents','fh_agent_runs'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.fh_touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- manager write, member read
do $$
declare t text;
begin
  foreach t in array array['fh_workflows','fh_workflow_versions','fh_agents'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (org_id in (select public.auth_user_org_ids()))$p$, t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$create policy %I on public.%I for all to authenticated using (public.fh_is_org_manager(org_id)) with check (public.fh_is_org_manager(org_id))$p$, t || '_write', t);
  end loop;
  -- member read only (writes through RPCs)
  foreach t in array array['fh_workflow_runs','fh_workflow_run_events','fh_outbox','fh_agent_runs','fh_review_requests'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated using (org_id in (select public.auth_user_org_ids()))$p$, t || '_read', t);
  end loop;
end $$;

grant select, insert, update, delete on public.fh_workflows, public.fh_workflow_versions, public.fh_agents to authenticated, service_role;
grant select on public.fh_workflow_runs, public.fh_workflow_run_events, public.fh_outbox, public.fh_agent_runs, public.fh_review_requests to authenticated;
grant select, insert, update, delete on public.fh_workflow_runs, public.fh_workflow_run_events, public.fh_outbox, public.fh_agent_runs, public.fh_review_requests to service_role;
grant usage, select on sequence public.fh_workflow_run_events_id_seq to authenticated, service_role;

do $$
declare f text;
begin
  -- service role only
  foreach f in array array[
    'fh_outbox_claim(text,integer)','fh_outbox_complete(uuid,boolean,jsonb,text,boolean)','fh_message_provider_status(text,text,text,text,jsonb)',
    'fh_outbox_release_holds()','fh_dispatch_events(integer)','fh_advance_runs(integer)','fh_advance_run(uuid,integer)','fh_automation_tick()',
    'fh_enqueue_message(uuid,uuid,uuid,text,text,text,text,uuid,text,uuid,uuid,uuid,uuid,boolean,text,jsonb,jsonb)',
    'fh_enroll(uuid,uuid,uuid,uuid,jsonb,text)','fh_notify_org(uuid,text,text,text,text,text,uuid[])','fh_run_log(uuid,uuid,text,text,text,jsonb)',
    'fh_org_ctx(uuid)','fh_client_ctx(uuid,uuid,jsonb)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('revoke all on function public.%s from anon', f);
    execute format('revoke all on function public.%s from authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- ui callable
  foreach f in array array[
    'fh_workflow_publish(uuid,boolean)','fh_workflow_validate(jsonb)','fh_enroll_manual(uuid,uuid[])','fh_run_cancel(uuid,text)',
    'fh_agent_run_approve(uuid,text,text)','fh_agent_run_reject(uuid,text)','fh_agent_request(text,uuid,text,uuid)',
    'fh_send_message(uuid,text,text,text,uuid,uuid,jsonb)','fh_render_template(text,jsonb)','fh_eval_filter(jsonb,jsonb)',
    'fh_in_send_window(uuid,timestamptz)','fh_next_send_window_start(uuid,timestamptz)'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('revoke all on function public.%s from anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

