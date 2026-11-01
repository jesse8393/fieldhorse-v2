-- =============================================================================
-- 070_growth_core.sql
-- Fieldhorse Growth Engine: org settings, phone numbers, channels, consent,
-- tags, custom fields, conversations, messages, templates, event log.
--
-- Conventions (match the rest of Fieldhorse):
--   * every org scoped table has org_id + RLS via auth_user_org_ids()
--   * before insert fh_set_org_id, before update fh_touch_updated_at
--   * additive only: no existing table is altered here
-- =============================================================================

-- ---------------------------------------------------------------------------
-- Helpers
-- ---------------------------------------------------------------------------

-- Normalize a US phone into E.164. Returns null when it cannot.
create or replace function public.fh_normalize_phone(p_raw text)
returns text
language plpgsql immutable
set search_path = pg_catalog, public
as $$
declare d text;
begin
  if p_raw is null then return null; end if;
  d := regexp_replace(p_raw, '[^0-9+]', '', 'g');
  if d like '+%' then
    d := '+' || regexp_replace(d, '[^0-9]', '', 'g');
    if length(d) between 11 and 16 then return d; end if;
    return null;
  end if;
  d := regexp_replace(d, '[^0-9]', '', 'g');
  if length(d) = 10 then return '+1' || d; end if;
  if length(d) = 11 and left(d,1) = '1' then return '+' || d; end if;
  return null;
end $$;

create or replace function public.fh_normalize_email(p_raw text)
returns text
language sql immutable
set search_path = pg_catalog, public
as $$
  select nullif(lower(btrim(p_raw)), '')
$$;

create or replace function public.fh_slugify(p_text text)
returns text
language sql immutable
set search_path = pg_catalog, public
as $$
  select btrim(regexp_replace(lower(coalesce(p_text,'')), '[^a-z0-9]+', '_', 'g'), '_')
$$;

-- Short random public key (url safe)
create or replace function public.fh_random_key(p_len int default 20)
returns text
language sql volatile
set search_path = pg_catalog, public
as $$
  select substr(
    replace(replace(replace(encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'base64'), '/', ''), '+', ''), '=', ''),
    1, greatest(8, least(p_len, 40)))
$$;

-- Is the current user an owner / admin / manager of the org?
create or replace function public.fh_is_org_manager(p_org_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.revoked_at is null
      and m.role in ('owner','admin','manager')
  )
$$;

-- Is the current user a member at all?
create or replace function public.fh_is_org_member(p_org_id uuid)
returns boolean
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select exists (
    select 1 from public.org_members m
    where m.org_id = p_org_id
      and m.user_id = (select auth.uid())
      and m.revoked_at is null
  )
$$;

-- ---------------------------------------------------------------------------
-- Org settings (one row per org). engine_enabled gates every trigger on
-- existing tables, so tenants that never opted in are untouched.
-- ---------------------------------------------------------------------------
create table if not exists public.fh_org_settings (
  org_id uuid primary key references public.organizations(id) on delete cascade,
  engine_enabled boolean not null default false,
  public_key text not null unique default public.fh_random_key(20),
  timezone text not null default 'America/Chicago',
  send_window_start time not null default '08:00',
  send_window_end time not null default '20:00',
  hold_all_outside_window boolean not null default true,
  business_hours jsonb not null default '{"mon":[["07:30","18:00"]],"tue":[["07:30","18:00"]],"wed":[["07:30","18:00"]],"thu":[["07:30","18:00"]],"fri":[["07:30","18:00"]],"sat":[],"sun":[]}'::jsonb,
  sms_policy text not null default 'strict' check (sms_policy in ('strict','standard')),
  default_from_email text,
  default_from_name text,
  reply_domain text,
  app_base_url text not null default 'https://fieldhorse.app',
  owner_notify_user_ids uuid[] not null default '{}',
  review_links jsonb not null default '{}'::jsonb,
  brand jsonb not null default '{}'::jsonb,
  vertical text not null default 'construction',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
comment on table public.fh_org_settings is 'Growth engine settings per org. engine_enabled gates all event emission from existing tables.';

create or replace function public.fh_engine_enabled(p_org_id uuid)
returns boolean
language sql stable
set search_path = pg_catalog, public
as $$
  select coalesce((select s.engine_enabled from public.fh_org_settings s where s.org_id = p_org_id), false)
$$;

-- ---------------------------------------------------------------------------
-- Phone numbers (Twilio). SMS is hard locked per number until sms_status =
-- approved. Voice works from day one.
-- ---------------------------------------------------------------------------
create table if not exists public.fh_phone_numbers (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  provider text not null default 'twilio',
  provider_sid text,
  e164 text not null unique,
  label text,
  kind text not null default 'local' check (kind in ('local','toll_free')),
  capabilities jsonb not null default '{"sms":true,"mms":true,"voice":true}'::jsonb,
  sms_status text not null default 'unregistered' check (sms_status in ('unregistered','pending','approved','rejected')),
  sms_registration jsonb not null default '{}'::jsonb,
  daily_sms_cap integer not null default 1000,
  voice_forward_to text,
  voice_whisper text,
  voice_record boolean not null default true,
  voice_timeout_sec integer not null default 20,
  voicemail_greeting text,
  missed_call_text_back boolean not null default true,
  source_tag text,
  is_default boolean not null default false,
  status text not null default 'active' check (status in ('active','disabled','released')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fh_phone_numbers_org_idx on public.fh_phone_numbers(org_id);
comment on column public.fh_phone_numbers.sms_status is 'Carrier registration gate. Outbound SMS is held until approved.';
comment on column public.fh_phone_numbers.source_tag is 'Call tracking: which ad source this number is published on.';

-- ---------------------------------------------------------------------------
-- Non phone channels: email sending identity, Messenger, Instagram, web chat
-- ---------------------------------------------------------------------------
create table if not exists public.fh_channels (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  kind text not null check (kind in ('email','messenger','instagram','webchat','gbp')),
  provider text,
  external_id text,
  display_name text,
  status text not null default 'active' check (status in ('active','pending','disabled')),
  config jsonb not null default '{}'::jsonb,
  integration_id uuid references public.fh_integrations(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index if not exists fh_channels_org_kind_ext_uidx on public.fh_channels(org_id, kind, coalesce(external_id,''));

-- ---------------------------------------------------------------------------
-- Consent (TCPA / CAN SPAM record per client)
-- ---------------------------------------------------------------------------
create table if not exists public.fh_consent (
  client_id uuid primary key references public.fh_clients(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  sms_status text not null default 'unknown' check (sms_status in ('unknown','opted_in','opted_out')),
  sms_source text,
  sms_updated_at timestamptz,
  email_status text not null default 'unknown' check (email_status in ('unknown','opted_in','opted_out')),
  email_source text,
  email_updated_at timestamptz,
  calls_status text not null default 'unknown' check (calls_status in ('unknown','opted_in','opted_out')),
  dnd_all boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fh_consent_org_idx on public.fh_consent(org_id);

-- ---------------------------------------------------------------------------
-- Tags (contact level) and custom fields
-- ---------------------------------------------------------------------------
create table if not exists public.fh_client_tags (
  client_id uuid not null references public.fh_clients(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  tag text not null,
  added_by uuid,
  source text not null default 'manual',
  added_at timestamptz not null default now(),
  primary key (client_id, tag)
);
create index if not exists fh_client_tags_org_tag_idx on public.fh_client_tags(org_id, tag);

create table if not exists public.fh_tag_defs (
  org_id uuid not null references public.organizations(id) on delete cascade,
  tag text not null,
  color text,
  description text,
  created_at timestamptz not null default now(),
  primary key (org_id, tag)
);

create table if not exists public.fh_field_defs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  label text not null,
  kind text not null default 'text' check (kind in ('text','number','date','boolean','select','multiselect','phone','email','url','textarea')),
  options jsonb not null default '[]'::jsonb,
  position integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

create table if not exists public.fh_client_fields (
  client_id uuid not null references public.fh_clients(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  value jsonb,
  updated_at timestamptz not null default now(),
  primary key (client_id, key)
);
create index if not exists fh_client_fields_org_key_idx on public.fh_client_fields(org_id, key);

-- ---------------------------------------------------------------------------
-- Conversations: exactly one thread per client, every channel inside it
-- ---------------------------------------------------------------------------
create table if not exists public.fh_conversations (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  client_id uuid not null references public.fh_clients(id) on delete cascade,
  status text not null default 'open' check (status in ('open','closed','snoozed')),
  assigned_to uuid,
  starred boolean not null default false,
  unread_count integer not null default 0,
  last_message_at timestamptz,
  last_inbound_at timestamptz,
  last_outbound_at timestamptz,
  last_channel text,
  last_preview text,
  snoozed_until timestamptz,
  email_thread_token text not null unique default public.fh_random_key(16),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, client_id)
);
create index if not exists fh_conversations_org_last_idx on public.fh_conversations(org_id, last_message_at desc nulls last);
create index if not exists fh_conversations_client_idx on public.fh_conversations(client_id);

-- ---------------------------------------------------------------------------
-- Messages: the unified log across sms, email, calls, DMs, notes
-- ---------------------------------------------------------------------------
create table if not exists public.fh_messages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  conversation_id uuid not null references public.fh_conversations(id) on delete cascade,
  client_id uuid not null references public.fh_clients(id) on delete cascade,
  contact_id uuid references public.fh_contacts(id) on delete set null,
  channel text not null check (channel in ('sms','mms','email','call','voicemail','messenger','instagram','webchat','note','system')),
  direction text not null check (direction in ('inbound','outbound','internal')),
  status text not null default 'queued' check (status in ('queued','held','sending','sent','delivered','undelivered','failed','received','read','canceled')),
  hold_reason text,
  purpose text not null default 'transactional' check (purpose in ('transactional','marketing')),
  subject text,
  body text,
  body_html text,
  from_address text,
  to_address text,
  media jsonb not null default '[]'::jsonb,
  provider text,
  provider_message_id text,
  provider_status text,
  error text,
  call_duration_sec integer,
  call_status text,
  recording_url text,
  transcript text,
  sent_by_user uuid,
  sent_by_kind text not null default 'user' check (sent_by_kind in ('user','workflow','agent','campaign','system','contact')),
  workflow_run_id uuid,
  agent_run_id uuid,
  campaign_id uuid,
  phone_number_id uuid references public.fh_phone_numbers(id) on delete set null,
  dedupe_key text unique,
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists fh_messages_conv_created_idx on public.fh_messages(conversation_id, created_at desc);
create index if not exists fh_messages_org_created_idx on public.fh_messages(org_id, created_at desc);
create index if not exists fh_messages_client_idx on public.fh_messages(client_id);
create index if not exists fh_messages_provider_idx on public.fh_messages(provider, provider_message_id);
create index if not exists fh_messages_run_idx on public.fh_messages(workflow_run_id) where workflow_run_id is not null;

-- ---------------------------------------------------------------------------
-- Message templates (snippets with merge fields)
-- ---------------------------------------------------------------------------
create table if not exists public.fh_message_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  key text not null,
  name text not null,
  channel text not null check (channel in ('sms','email','voicemail','note')),
  subject text,
  body text not null,
  body_html text,
  purpose text not null default 'transactional' check (purpose in ('transactional','marketing')),
  category text,
  is_system boolean not null default false,
  created_by uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, key)
);

-- ---------------------------------------------------------------------------
-- Event log: everything the automation engine reacts to
-- ---------------------------------------------------------------------------
create table if not exists public.fh_events (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type text not null,
  client_id uuid references public.fh_clients(id) on delete cascade,
  contact_id uuid references public.fh_contacts(id) on delete set null,
  conversation_id uuid references public.fh_conversations(id) on delete set null,
  payload jsonb not null default '{}'::jsonb,
  source text not null default 'system',
  dedupe_key text unique,
  occurred_at timestamptz not null default now(),
  processed_at timestamptz,
  processing_error text
);
create index if not exists fh_events_unprocessed_idx on public.fh_events(occurred_at) where processed_at is null;
create index if not exists fh_events_org_time_idx on public.fh_events(org_id, occurred_at desc);
create index if not exists fh_events_client_idx on public.fh_events(client_id, occurred_at desc);

-- Emit an event. Silently returns null when the org has not enabled the engine.
create or replace function public.fh_emit_event(
  p_org_id uuid,
  p_type text,
  p_client_id uuid default null,
  p_contact_id uuid default null,
  p_payload jsonb default '{}'::jsonb,
  p_source text default 'system',
  p_dedupe_key text default null
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_id uuid;
begin
  if p_org_id is null or not public.fh_engine_enabled(p_org_id) then
    return null;
  end if;
  insert into public.fh_events (org_id, type, client_id, contact_id, payload, source, dedupe_key)
  values (p_org_id, p_type, p_client_id, p_contact_id, coalesce(p_payload, '{}'::jsonb), coalesce(p_source,'system'), p_dedupe_key)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- Conversation helpers
-- ---------------------------------------------------------------------------
create or replace function public.fh_conversation_for_client(p_org_id uuid, p_client_id uuid)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_id uuid;
begin
  select id into v_id from public.fh_conversations where org_id = p_org_id and client_id = p_client_id;
  if v_id is null then
    insert into public.fh_conversations (org_id, client_id)
    values (p_org_id, p_client_id)
    on conflict (org_id, client_id) do update set updated_at = now()
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Find or create a client by phone / email. Returns the client id.
-- p_is_new is set true when a new client row was created.
create or replace function public.fh_resolve_client(
  p_org_id uuid,
  p_phone text,
  p_email text,
  p_name text default null,
  p_address text default null,
  p_source text default null,
  out client_id uuid,
  out is_new boolean
)
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_phone text := public.fh_normalize_phone(p_phone);
  v_email text := public.fh_normalize_email(p_email);
  v_owner uuid;
  v_name text;
begin
  is_new := false;
  if v_phone is not null then
    select c.id into client_id from public.fh_clients c
     where c.org_id = p_org_id and public.fh_normalize_phone(c.phone) = v_phone
     order by c.updated_at desc limit 1;
  end if;
  if client_id is null and v_email is not null then
    select c.id into client_id from public.fh_clients c
     where c.org_id = p_org_id and public.fh_normalize_email(c.email) = v_email
     order by c.updated_at desc limit 1;
  end if;
  if client_id is not null then
    -- backfill blanks only, never overwrite what the user typed
    update public.fh_clients c
       set phone = coalesce(nullif(c.phone,''), v_phone),
           email = coalesce(nullif(c.email,''), v_email),
           address = coalesce(nullif(c.address,''), p_address),
           last_activity_at = now(),
           updated_at = now()
     where c.id = client_id;
    return;
  end if;

  select m.user_id into v_owner from public.org_members m
   where m.org_id = p_org_id and m.revoked_at is null
   order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.joined_at
   limit 1;
  if v_owner is null then
    select o.created_by into v_owner from public.organizations o where o.id = p_org_id;
  end if;

  v_name := nullif(btrim(coalesce(p_name,'')), '');
  if v_name is null then v_name := coalesce(v_phone, v_email, 'New lead'); end if;

  insert into public.fh_clients (user_id, org_id, name, phone, email, address, source, last_activity_at)
  values (v_owner, p_org_id, v_name, v_phone, v_email, p_address, coalesce(p_source,'inbound'), now())
  returning id into client_id;
  is_new := true;
end $$;

-- Split a display name into first / last
create or replace function public.fh_first_name(p_name text)
returns text
language sql immutable
set search_path = pg_catalog, public
as $$
  select nullif(split_part(btrim(coalesce(p_name,'')), ' ', 1), '')
$$;

-- ---------------------------------------------------------------------------
-- Message triggers: keep conversation counters current and emit events
-- ---------------------------------------------------------------------------
create or replace function public.fh_messages_after_insert()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  update public.fh_conversations c
     set last_message_at = greatest(coalesce(c.last_message_at, new.created_at), new.created_at),
         last_inbound_at = case when new.direction = 'inbound' then new.created_at else c.last_inbound_at end,
         last_outbound_at = case when new.direction = 'outbound' then new.created_at else c.last_outbound_at end,
         last_channel = new.channel,
         last_preview = left(coalesce(new.body, new.subject, new.channel), 140),
         unread_count = case when new.direction = 'inbound' then c.unread_count + 1 else c.unread_count end,
         status = case when new.direction = 'inbound' and c.status in ('closed','snoozed') then 'open' else c.status end,
         updated_at = now()
   where c.id = new.conversation_id;

  update public.fh_clients set last_activity_at = now() where id = new.client_id;

  if new.direction = 'inbound' and new.channel <> 'note' then
    perform public.fh_emit_event(
      new.org_id,
      case when new.channel in ('call','voicemail') then 'call.inbound' else 'message.inbound' end,
      new.client_id, new.contact_id,
      jsonb_build_object(
        'message_id', new.id, 'channel', new.channel, 'body', left(coalesce(new.body,''), 1000),
        'from', new.from_address, 'to', new.to_address, 'call_status', new.call_status,
        'phone_number_id', new.phone_number_id, 'conversation_id', new.conversation_id),
      'messages');
  end if;
  return null;
exception when others then
  -- never block a message insert because of downstream bookkeeping
  raise warning 'fh_messages_after_insert: %', sqlerrm;
  return null;
end $$;

drop trigger if exists fh_messages_after_insert_trg on public.fh_messages;
create trigger fh_messages_after_insert_trg
after insert on public.fh_messages
for each row execute function public.fh_messages_after_insert();

-- Mark thread read: reset unread and stamp read_at on inbound rows
create or replace function public.fh_conversation_mark_read(p_conversation_id uuid)
returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_org uuid;
begin
  select org_id into v_org from public.fh_conversations where id = p_conversation_id;
  if v_org is null or (auth.uid() is not null and not public.fh_is_org_member(v_org)) then
    raise exception 'not allowed';
  end if;
  update public.fh_messages set read_at = now()
   where conversation_id = p_conversation_id and direction = 'inbound' and read_at is null;
  update public.fh_conversations set unread_count = 0, updated_at = now() where id = p_conversation_id;
end $$;

-- ---------------------------------------------------------------------------
-- Consent helpers
-- ---------------------------------------------------------------------------
create or replace function public.fh_consent_set(
  p_org_id uuid, p_client_id uuid, p_channel text, p_status text, p_source text
) returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  insert into public.fh_consent (client_id, org_id) values (p_client_id, p_org_id)
  on conflict (client_id) do nothing;
  if p_channel = 'sms' then
    update public.fh_consent set sms_status = p_status, sms_source = p_source, sms_updated_at = now(), updated_at = now()
     where client_id = p_client_id;
  elsif p_channel = 'email' then
    update public.fh_consent set email_status = p_status, email_source = p_source, email_updated_at = now(), updated_at = now()
     where client_id = p_client_id;
  elsif p_channel = 'calls' then
    update public.fh_consent set calls_status = p_status, updated_at = now() where client_id = p_client_id;
  end if;
  perform public.fh_emit_event(p_org_id, 'consent.changed', p_client_id, null,
    jsonb_build_object('channel', p_channel, 'status', p_status, 'source', p_source), 'consent');
end $$;

-- Tag helpers (idempotent)
create or replace function public.fh_tag_add(p_org_id uuid, p_client_id uuid, p_tag text, p_source text default 'system', p_user uuid default null)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_tag text := public.fh_slugify(p_tag); v_added boolean := false;
begin
  if v_tag = '' then return false; end if;
  insert into public.fh_client_tags (client_id, org_id, tag, added_by, source)
  values (p_client_id, p_org_id, v_tag, p_user, coalesce(p_source,'system'))
  on conflict do nothing;
  v_added := found;
  insert into public.fh_tag_defs (org_id, tag) values (p_org_id, v_tag) on conflict do nothing;
  return v_added;
end $$;

create or replace function public.fh_tag_remove(p_org_id uuid, p_client_id uuid, p_tag text)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.fh_client_tags where client_id = p_client_id and org_id = p_org_id and tag = public.fh_slugify(p_tag);
  return found;
end $$;

-- Tag events
create or replace function public.fh_client_tags_events()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.fh_emit_event(new.org_id, 'tag.added', new.client_id, null, jsonb_build_object('tag', new.tag, 'source', new.source), 'tags');
    return null;
  elsif tg_op = 'DELETE' then
    perform public.fh_emit_event(old.org_id, 'tag.removed', old.client_id, null, jsonb_build_object('tag', old.tag), 'tags');
    return null;
  end if;
  return null;
exception when others then
  raise warning 'fh_client_tags_events: %', sqlerrm;
  return null;
end $$;

drop trigger if exists fh_client_tags_events_trg on public.fh_client_tags;
create trigger fh_client_tags_events_trg
after insert or delete on public.fh_client_tags
for each row execute function public.fh_client_tags_events();

-- ---------------------------------------------------------------------------
-- Standard triggers on new tables
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['fh_phone_numbers','fh_channels','fh_consent','fh_client_tags','fh_tag_defs','fh_field_defs','fh_client_fields','fh_conversations','fh_messages','fh_message_templates','fh_events']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_set_org_id', t);
    execute format('create trigger %I before insert on public.%I for each row execute function public.fh_set_org_id()', t || '_set_org_id', t);
  end loop;
  foreach t in array array['fh_org_settings','fh_phone_numbers','fh_channels','fh_consent','fh_field_defs','fh_client_fields','fh_conversations','fh_messages','fh_message_templates']
  loop
    execute format('drop trigger if exists %I on public.%I', t || '_touch', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.fh_touch_updated_at()', t || '_touch', t);
  end loop;
end $$;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
do $$
declare t text;
begin
  foreach t in array array['fh_org_settings','fh_phone_numbers','fh_channels','fh_consent','fh_client_tags','fh_tag_defs','fh_field_defs','fh_client_fields','fh_conversations','fh_messages','fh_message_templates','fh_events']
  loop
    execute format('alter table public.%I enable row level security', t);
  end loop;
end $$;

-- member read + write tables
do $$
declare t text;
begin
  foreach t in array array['fh_consent','fh_client_tags','fh_tag_defs','fh_client_fields','fh_conversations','fh_messages']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_org', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (org_id in (select public.auth_user_org_ids()))
      with check (org_id in (select public.auth_user_org_ids()))$p$, t || '_org', t);
  end loop;
end $$;

-- member read, manager write tables
do $$
declare t text;
begin
  foreach t in array array['fh_org_settings','fh_phone_numbers','fh_channels','fh_field_defs','fh_message_templates']
  loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format($p$create policy %I on public.%I for select to authenticated
      using (org_id in (select public.auth_user_org_ids()))$p$, t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format($p$create policy %I on public.%I for all to authenticated
      using (public.fh_is_org_manager(org_id))
      with check (public.fh_is_org_manager(org_id))$p$, t || '_write', t);
  end loop;
end $$;

-- events: members read only, writes go through fh_emit_event
drop policy if exists fh_events_read on public.fh_events;
create policy fh_events_read on public.fh_events for select to authenticated
  using (org_id in (select public.auth_user_org_ids()));

-- ---------------------------------------------------------------------------
-- Grants: lock security definer functions down to authenticated + service role
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  foreach f in array array[
    'fh_is_org_manager(uuid)','fh_is_org_member(uuid)','fh_emit_event(uuid,text,uuid,uuid,jsonb,text,text)',
    'fh_conversation_for_client(uuid,uuid)','fh_resolve_client(uuid,text,text,text,text,text)',
    'fh_conversation_mark_read(uuid)','fh_consent_set(uuid,uuid,text,text,text)',
    'fh_tag_add(uuid,uuid,text,text,uuid)','fh_tag_remove(uuid,uuid,text)']
  loop
    execute format('revoke all on function public.%s from public', f);
    execute format('revoke all on function public.%s from anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

grant select, insert, update, delete on
  public.fh_org_settings, public.fh_phone_numbers, public.fh_channels, public.fh_consent,
  public.fh_client_tags, public.fh_tag_defs, public.fh_field_defs, public.fh_client_fields,
  public.fh_conversations, public.fh_messages, public.fh_message_templates, public.fh_events
to authenticated, service_role;

