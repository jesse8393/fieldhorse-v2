-- =============================================================================
-- 076_growth_hardening.sql
-- Security advisor follow ups:
--   * trigger functions are not callable through the API
--   * helper RPCs refuse cross org calls from signed in users
--   * pg_net lives in the extensions schema
-- =============================================================================

-- 1. Trigger functions: nobody calls these directly. Postgres checks EXECUTE
--    on a trigger function when the trigger is created, not when it fires.
do $$
declare f text;
begin
  foreach f in array array[
    'fh_messages_after_insert()','fh_client_tags_events()','fh_consent_release_trg()','fh_phone_number_release_trg()',
    'fh_ev_clients()','fh_ev_contacts()','fh_ev_quote_versions()','fh_ev_invoices()','fh_ev_closeouts()',
    'fh_appointments_mirror()','fh_appointments_mirror_after()','fh_appointments_events()','fh_reviews_events()','fh_campaign_recipient_sync()'] loop
    execute format('revoke all on function public.%s from public', f);
    execute format('revoke all on function public.%s from anon', f);
    execute format('revoke all on function public.%s from authenticated', f);
  end loop;
end $$;

-- 2. Membership guards on helper RPCs that a signed in user can reach.
--    Service role and cron (auth.uid() is null) are unaffected.
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
  if auth.uid() is not null and not public.fh_is_org_member(p_org_id) then
    raise exception 'not allowed';
  end if;
  if p_client_id is not null and not exists (select 1 from public.fh_clients c where c.id = p_client_id and c.org_id = p_org_id) then
    raise exception 'client does not belong to org';
  end if;
  insert into public.fh_events (org_id, type, client_id, contact_id, payload, source, dedupe_key)
  values (p_org_id, p_type, p_client_id, p_contact_id, coalesce(p_payload, '{}'::jsonb), coalesce(p_source,'system'), p_dedupe_key)
  on conflict (dedupe_key) do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.fh_conversation_for_client(p_org_id uuid, p_client_id uuid)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_id uuid;
begin
  if auth.uid() is not null and not public.fh_is_org_member(p_org_id) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.fh_clients c where c.id = p_client_id and c.org_id = p_org_id) then
    raise exception 'client does not belong to org';
  end if;
  select id into v_id from public.fh_conversations where org_id = p_org_id and client_id = p_client_id;
  if v_id is null then
    insert into public.fh_conversations (org_id, client_id)
    values (p_org_id, p_client_id)
    on conflict (org_id, client_id) do update set updated_at = now()
    returning id into v_id;
  end if;
  return v_id;
end $$;

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
  if auth.uid() is not null and not public.fh_is_org_member(p_org_id) then raise exception 'not allowed'; end if;
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

create or replace function public.fh_consent_set(
  p_org_id uuid, p_client_id uuid, p_channel text, p_status text, p_source text
) returns void
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is not null and not public.fh_is_org_member(p_org_id) then raise exception 'not allowed'; end if;
  if not exists (select 1 from public.fh_clients c where c.id = p_client_id and c.org_id = p_org_id) then
    raise exception 'client does not belong to org';
  end if;
  if p_channel not in ('sms','email','calls') or p_status not in ('unknown','opted_in','opted_out') then
    raise exception 'invalid channel or status';
  end if;
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

create or replace function public.fh_tag_add(p_org_id uuid, p_client_id uuid, p_tag text, p_source text default 'system', p_user uuid default null)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_tag text := public.fh_slugify(p_tag); v_added boolean := false;
begin
  if auth.uid() is not null and not public.fh_is_org_member(p_org_id) then raise exception 'not allowed'; end if;
  if v_tag = '' then return false; end if;
  if not exists (select 1 from public.fh_clients c where c.id = p_client_id and c.org_id = p_org_id) then
    raise exception 'client does not belong to org';
  end if;
  insert into public.fh_client_tags (client_id, org_id, tag, added_by, source)
  values (p_client_id, p_org_id, v_tag, coalesce(p_user, auth.uid()), coalesce(p_source,'system'))
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
  if auth.uid() is not null and not public.fh_is_org_member(p_org_id) then raise exception 'not allowed'; end if;
  delete from public.fh_client_tags where client_id = p_client_id and org_id = p_org_id and tag = public.fh_slugify(p_tag);
  return found;
end $$;

-- 3. pg_net out of the public schema (nothing depends on it yet; the tick
--    resolves net.http_post dynamically at call time)
do $$
begin
  if exists (select 1 from pg_extension e join pg_namespace n on n.oid = e.extnamespace where e.extname = 'pg_net' and n.nspname = 'public') then
    drop extension pg_net;
    create extension pg_net with schema extensions;
  end if;
end $$;

