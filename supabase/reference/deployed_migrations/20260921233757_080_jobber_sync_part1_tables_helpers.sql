-- =============================================================================
-- 080_jobber_sync.sql (part 1 of 6: suppress flag, integration key, tables, helpers)
-- Jobber as the system of record. Jobber clients, requests, quotes, jobs,
-- invoices and visits are mirrored into the Fieldhorse core tables
-- (fh_clients, fh_contacts, fh_quote_versions, fh_closeouts, fh_invoices,
-- fh_schedule, fh_appointments). The existing growth triggers on those tables
-- then emit the same events the engine already understands, so every workflow
-- built for Fieldhorse data works unchanged on Jobber data.
-- =============================================================================

-- ---------------------------------------------------------------------------
-- 1. suppress flag for history loads
-- ---------------------------------------------------------------------------
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
  if coalesce(current_setting('fh.suppress_events', true), '') = 'on' then
    return null;
  end if;
  insert into public.fh_events (org_id, type, client_id, contact_id, payload, source, dedupe_key)
  values (p_org_id, p_type, p_client_id, p_contact_id, coalesce(p_payload, '{}'::jsonb), coalesce(p_source,'system'), p_dedupe_key)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

-- ---------------------------------------------------------------------------
-- 2. one integration per org and provider
-- ---------------------------------------------------------------------------
alter table public.fh_integrations drop constraint if exists fh_integrations_user_id_provider_key;
create unique index if not exists fh_integrations_org_provider_key on public.fh_integrations (org_id, provider) where org_id is not null;

-- ---------------------------------------------------------------------------
-- 3. tables
-- ---------------------------------------------------------------------------
create table if not exists public.fh_oauth_states (
  state text primary key,
  provider text not null default 'jobber',
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid,
  code_verifier text not null,
  redirect_to text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '15 minutes',
  used_at timestamptz
);
alter table public.fh_oauth_states enable row level security;
revoke all on table public.fh_oauth_states from public, anon, authenticated;

create table if not exists public.fh_external_refs (
  integration_id uuid not null references public.fh_integrations(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  entity text not null,
  external_id text not null,
  local_table text not null,
  local_id uuid not null,
  external_number text,
  raw jsonb not null default '{}'::jsonb,
  synced_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  primary key (integration_id, entity, external_id)
);
create index if not exists fh_external_refs_local_idx on public.fh_external_refs (local_table, local_id);
create index if not exists fh_external_refs_org_idx on public.fh_external_refs (org_id, entity);
alter table public.fh_external_refs enable row level security;
drop policy if exists fh_external_refs_read on public.fh_external_refs;
create policy fh_external_refs_read on public.fh_external_refs for select
  using (org_id in (select public.auth_user_org_ids()));
revoke insert, update, delete on table public.fh_external_refs from anon, authenticated;

create table if not exists public.fh_jobber_events (
  id uuid primary key default gen_random_uuid(),
  integration_id uuid references public.fh_integrations(id) on delete set null,
  org_id uuid,
  topic text not null,
  app_id text,
  account_id text not null,
  item_id text,
  occurred_at timestamptz,
  raw jsonb not null default '{}'::jsonb,
  status text not null default 'pending' check (status in ('pending','processing','done','error','skipped')),
  attempts integer not null default 0,
  last_error text,
  result jsonb,
  received_at timestamptz not null default now(),
  processed_at timestamptz
);
create unique index if not exists fh_jobber_events_dedupe on public.fh_jobber_events (account_id, topic, coalesce(item_id,''), coalesce(occurred_at, 'epoch'::timestamptz));
create index if not exists fh_jobber_events_open_idx on public.fh_jobber_events (received_at) where status in ('pending','error','processing');
alter table public.fh_jobber_events enable row level security;
drop policy if exists fh_jobber_events_read on public.fh_jobber_events;
create policy fh_jobber_events_read on public.fh_jobber_events for select
  using (org_id in (select public.auth_user_org_ids()));
revoke insert, update, delete on table public.fh_jobber_events from anon, authenticated;

-- ---------------------------------------------------------------------------
-- 4. helpers
-- ---------------------------------------------------------------------------
create or replace function public.fh_jobber_owner(p_org_id uuid)
returns uuid
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select i.user_id from public.fh_integrations i where i.org_id = p_org_id and i.provider = 'jobber' limit 1),
    (select m.user_id from public.org_members m where m.org_id = p_org_id and m.revoked_at is null
      order by case m.role when 'owner' then 0 when 'admin' then 1 else 2 end, m.joined_at limit 1),
    (select o.created_by from public.organizations o where o.id = p_org_id));
$$;

create or replace function public.fh_jobber_addr(p jsonb)
returns text
language sql immutable
set search_path = pg_catalog, public
as $$
  select nullif(concat_ws(', ',
    nullif(btrim(coalesce(p->>'street1', p->>'street')), ''),
    nullif(btrim(p->>'street2'), ''),
    nullif(btrim(p->>'city'), ''),
    nullif(btrim(concat_ws(' ', nullif(btrim(p->>'province'), ''), nullif(btrim(p->>'postalCode'), ''))), '')), '');
$$;

create or replace function public.fh_jobber_ts(p text)
returns timestamptz
language plpgsql immutable
set search_path = pg_catalog, public
as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  return p::timestamptz;
exception when others then
  return null;
end $$;

create or replace function public.fh_jobber_num(p text)
returns numeric
language plpgsql immutable
set search_path = pg_catalog, public
as $$
begin
  if p is null or btrim(p) = '' then return null; end if;
  return p::numeric;
exception when others then
  return null;
end $$;

create or replace function public.fh_jobber_ref(p_integration uuid, p_entity text, p_ext text)
returns uuid
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select r.local_id from public.fh_external_refs r
   where r.integration_id = p_integration and r.entity = p_entity and r.external_id = p_ext;
$$;

create or replace function public.fh_jobber_ref_set(
  p_integration uuid, p_org uuid, p_entity text, p_ext text, p_table text, p_local uuid,
  p_number text default null, p_raw jsonb default '{}'::jsonb
) returns void
language sql security definer
set search_path = pg_catalog, public
as $$
  insert into public.fh_external_refs (integration_id, org_id, entity, external_id, local_table, local_id, external_number, raw, synced_at)
  values (p_integration, p_org, p_entity, p_ext, p_table, p_local, p_number, coalesce(p_raw, '{}'::jsonb), now())
  on conflict (integration_id, entity, external_id) do update
    set local_id = excluded.local_id, local_table = excluded.local_table, org_id = excluded.org_id,
        external_number = coalesce(excluded.external_number, public.fh_external_refs.external_number),
        raw = excluded.raw, synced_at = now();
$$;

-- Which org a Jobber client belongs to. One Jobber account can feed several
-- companies (Parker Construction Company and SHYLD ROOFING share one account):
-- fh_integrations.metadata.org_rules = [{"tag": "roofing", "org_id": "<uuid>"}]
-- routes clients that carry that Jobber tag. No match means the connection org.
create or replace function public.fh_jobber_org_for(p_integration uuid, p_tags text[])
returns uuid
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare i record; rule jsonb; v_tag text;
begin
  select org_id, metadata into i from public.fh_integrations where id = p_integration;
  if i.org_id is null then raise exception 'integration has no org'; end if;
  for rule in select * from jsonb_array_elements(coalesce(i.metadata->'org_rules', '[]'::jsonb)) loop
    v_tag := lower(btrim(coalesce(rule->>'tag', '')));
    if v_tag <> '' and (rule->>'org_id') is not null and exists (
         select 1 from unnest(coalesce(p_tags, '{}'::text[])) t where lower(btrim(t)) = v_tag) then
      return (rule->>'org_id')::uuid;
    end if;
  end loop;
  return i.org_id;
end $$;

-- Hidden booking type that Jobber visits hang off, so the reminder sweep and the
-- inbox can treat them like any other appointment. Reminders are off by default
-- because Jobber usually sends its own visit reminders; turn them on per org by
-- setting reminder_offsets_min on the jobber_visit booking type.
create or replace function public.fh_jobber_visit_booking_type(p_org_id uuid)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_id uuid;
begin
  select id into v_id from public.fh_booking_types where org_id = p_org_id and key = 'jobber_visit';
  if v_id is null then
    insert into public.fh_booking_types (org_id, key, name, description, duration_min, reminder_offsets_min, tags, status, location_mode)
    values (p_org_id, 'jobber_visit', 'Scheduled visit', 'Visits scheduled in Jobber. Not bookable from the public booking page.', 60, '{}'::int[], '[]'::jsonb, 'disabled', 'at_client_address')
    returning id into v_id;
  end if;
  return v_id;
end $$;

-- Find the opportunity row (fh_contacts) a Jobber object belongs to.
create or replace function public.fh_jobber_contact_for(
  p_integration uuid, p_client uuid, p_link_entity text, p_link_ext text, p_stages text[], p_window interval
) returns uuid
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare v_contact uuid;
begin
  if p_link_entity is not null and p_link_ext is not null then
    v_contact := public.fh_jobber_ref(p_integration, p_link_entity, p_link_ext);
    if v_contact is not null then return v_contact; end if;
  end if;
  select c.id into v_contact from public.fh_contacts c
   where c.client_id = p_client and c.stage = any (p_stages) and c.created_at > now() - p_window
   order by c.created_at desc limit 1;
  return v_contact;
end $$;

-- Appointment mirror for visits and assessments (reminders, inbox context).
create or replace function public.fh_jobber_upsert_appointment(
  p_integration uuid, p_org uuid, p_entity text, p_ext text, p_client uuid, p_contact uuid, p_schedule uuid,
  p_start timestamptz, p_end timestamptz, p_location text, p_notes text, p_completed boolean, p_cancelled boolean
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_id uuid; v_status text; v_type uuid;
begin
  if p_start is null then return null; end if;
  v_status := case when p_cancelled then 'cancelled' when p_completed then 'completed' else 'booked' end;
  v_id := public.fh_jobber_ref(p_integration, p_entity, p_ext);
  if v_id is null then
    if v_status <> 'booked' then return null; end if;
    v_type := public.fh_jobber_visit_booking_type(p_org);
    insert into public.fh_appointments (org_id, booking_type_id, client_id, contact_id, schedule_id, start_at, end_at, status, location, notes, source)
    values (p_org, v_type, p_client, p_contact, p_schedule, p_start, coalesce(p_end, p_start + interval '1 hour'), 'booked', p_location, p_notes, 'jobber')
    returning id into v_id;
    perform public.fh_jobber_ref_set(p_integration, p_org, p_entity, p_ext, 'fh_appointments', v_id);
  else
    update public.fh_appointments a
       set start_at = p_start, end_at = coalesce(p_end, p_start + interval '1 hour'),
           status = case when a.status in ('no_show') then a.status else v_status end,
           location = coalesce(p_location, a.location), notes = coalesce(p_notes, a.notes),
           contact_id = coalesce(p_contact, a.contact_id), schedule_id = coalesce(p_schedule, a.schedule_id), updated_at = now()
     where a.id = v_id;
  end if;
  return v_id;
end $$;

