-- 080_jobber_sync.sql (part 5 of 6: connection, tokens, events, sync state, drain tick)
-- ---------------------------------------------------------------------------
-- 5. connection, tokens, events, sync state
-- ---------------------------------------------------------------------------
create or replace function public.fh_jobber_redirect_uri()
returns text
language sql stable
set search_path = pg_catalog, public
as $$
  select coalesce(
    (select value from public.fh_app_config where key = 'jobber_redirect_uri'),
    replace((select value from public.fh_app_config where key = 'growth_worker_url'), '/automation-worker', '/jobber/callback'));
$$;

-- Manager starts the connection: returns the Jobber authorize URL (PKCE, state).
create or replace function public.fh_jobber_connect_start(p_org_id uuid, p_redirect_to text default null)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_client_id text; v_redirect text; v_verifier text; v_challenge text; v_state text; v_url text;
begin
  if auth.uid() is not null and not public.fh_is_org_manager(p_org_id) then raise exception 'not allowed'; end if;
  select value into v_client_id from public.fh_app_config where key = 'jobber_client_id';
  if v_client_id is null then raise exception 'jobber_client_id is not configured'; end if;
  v_redirect := public.fh_jobber_redirect_uri();
  if v_redirect is null then raise exception 'jobber redirect uri is not configured'; end if;
  -- PKCE without pgcrypto: core sha256 over random uuids (64 hex chars is a valid verifier)
  v_verifier := encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text || gen_random_uuid()::text, 'UTF8')), 'hex');
  v_challenge := rtrim(translate(encode(sha256(convert_to(v_verifier, 'UTF8')), 'base64'), '+/', '-_'), '=');
  v_state := left(encode(sha256(convert_to(gen_random_uuid()::text || clock_timestamp()::text, 'UTF8')), 'hex'), 48);
  delete from public.fh_oauth_states where expires_at < now() - interval '1 day';
  insert into public.fh_oauth_states (state, provider, org_id, user_id, code_verifier, redirect_to)
  values (v_state, 'jobber', p_org_id, auth.uid(), v_verifier, p_redirect_to);
  v_url := 'https://api.getjobber.com/api/oauth/authorize?response_type=code'
        || '&client_id=' || v_client_id
        || '&redirect_uri=' || replace(replace(v_redirect, ':', '%3A'), '/', '%2F')
        || '&state=' || v_state
        || '&code_challenge=' || v_challenge
        || '&code_challenge_method=S256';
  return jsonb_build_object('url', v_url, 'state', v_state, 'expires_at', now() + interval '15 minutes');
end $$;

create or replace function public.fh_jobber_oauth_state_take(p_state text)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare s record;
begin
  select * into s from public.fh_oauth_states where state = p_state and provider = 'jobber' for update;
  if s.state is null then return null; end if;
  if s.used_at is not null or s.expires_at < now() then return null; end if;
  update public.fh_oauth_states set used_at = now() where state = p_state;
  return jsonb_build_object('org_id', s.org_id, 'user_id', s.user_id, 'code_verifier', s.code_verifier, 'redirect_to', s.redirect_to);
end $$;

create or replace function public.fh_jobber_connection_upsert(
  p_org_id uuid, p_user_id uuid, p_account_id text, p_display_name text, p_scopes text,
  p_access text, p_refresh text, p_expires_at timestamptz, p_meta jsonb default '{}'::jsonb
) returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_id uuid; v_user uuid;
begin
  v_user := coalesce(p_user_id, public.fh_jobber_owner(p_org_id));
  insert into public.fh_integrations (user_id, org_id, provider, status, external_account_id, display_name, scopes, connected_at, last_error, metadata)
  values (v_user, p_org_id, 'jobber', 'connected', p_account_id, p_display_name, p_scopes, now(), null, coalesce(p_meta, '{}'::jsonb))
  on conflict (org_id, provider) where org_id is not null do update
    set status = 'connected', external_account_id = excluded.external_account_id, display_name = coalesce(excluded.display_name, public.fh_integrations.display_name),
        scopes = excluded.scopes, connected_at = now(), last_error = null, user_id = coalesce(public.fh_integrations.user_id, excluded.user_id),
        metadata = public.fh_integrations.metadata || coalesce(p_meta, '{}'::jsonb) || jsonb_build_object('disconnected_reason', null),
        updated_at = now()
  returning id into v_id;
  insert into public.fh_integration_secrets (integration_id, org_id, access_token, refresh_token, expires_at)
  values (v_id, p_org_id, p_access, p_refresh, p_expires_at)
  on conflict (integration_id) do update
    set access_token = excluded.access_token, refresh_token = excluded.refresh_token, expires_at = excluded.expires_at, org_id = excluded.org_id, updated_at = now();
  return v_id;
end $$;

create or replace function public.fh_jobber_tokens_get(p_integration uuid)
returns jsonb
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object('integration_id', i.id, 'org_id', i.org_id, 'status', i.status, 'account_id', i.external_account_id,
                            'metadata', i.metadata, 'access_token', s.access_token, 'refresh_token', s.refresh_token, 'expires_at', s.expires_at)
    from public.fh_integrations i left join public.fh_integration_secrets s on s.integration_id = i.id
   where i.id = p_integration and i.provider = 'jobber';
$$;

create or replace function public.fh_jobber_tokens_set(p_integration uuid, p_access text, p_refresh text, p_expires_at timestamptz)
returns void
language sql security definer
set search_path = pg_catalog, public
as $$
  update public.fh_integration_secrets
     set access_token = p_access, refresh_token = coalesce(p_refresh, refresh_token), expires_at = p_expires_at, updated_at = now()
   where integration_id = p_integration;
  update public.fh_integrations set status = 'connected', last_error = null, updated_at = now() where id = p_integration and status in ('expired', 'error');
$$;

-- Short lease so two invocations never refresh a rotating token at the same moment.
create or replace function public.fh_jobber_refresh_lease(p_integration uuid, p_seconds integer default 30)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_until timestamptz;
begin
  select (metadata->>'refresh_lease_until')::timestamptz into v_until from public.fh_integrations where id = p_integration for update;
  if v_until is not null and v_until > now() then return false; end if;
  update public.fh_integrations set metadata = metadata || jsonb_build_object('refresh_lease_until', now() + make_interval(secs => p_seconds)) where id = p_integration;
  return true;
end $$;

create or replace function public.fh_jobber_mark_error(p_integration uuid, p_status text, p_error text)
returns void
language sql security definer
set search_path = pg_catalog, public
as $$
  update public.fh_integrations set status = case when p_status in ('connected','disconnected','error','expired') then p_status else status end,
         last_error = left(p_error, 2000), updated_at = now()
   where id = p_integration;
$$;

create or replace function public.fh_jobber_disconnect(p_integration uuid, p_reason text default null)
returns void
language sql security definer
set search_path = pg_catalog, public
as $$
  delete from public.fh_integration_secrets where integration_id = p_integration;
  update public.fh_integrations
     set status = 'disconnected', last_error = null, updated_at = now(),
         metadata = metadata || jsonb_build_object('disconnected_reason', p_reason, 'disconnected_at', now(), 'sync', null)
   where id = p_integration;
$$;

create or replace function public.fh_jobber_integration_for_account(p_account_id text)
returns jsonb
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object('integration_id', i.id, 'org_id', i.org_id, 'status', i.status, 'metadata', i.metadata)
    from public.fh_integrations i
   where i.provider = 'jobber' and i.external_account_id = p_account_id
   order by (i.status = 'connected') desc, i.updated_at desc limit 1;
$$;

create or replace function public.fh_jobber_integration_for_org(p_org_id uuid)
returns jsonb
language sql stable security definer
set search_path = pg_catalog, public
as $$
  select jsonb_build_object('integration_id', i.id, 'org_id', i.org_id, 'status', i.status, 'metadata', i.metadata, 'account_id', i.external_account_id)
    from public.fh_integrations i where i.provider = 'jobber' and i.org_id = p_org_id limit 1;
$$;

create or replace function public.fh_jobber_events_enqueue(p_account_id text, p_topic text, p_app_id text, p_item_id text, p_occurred_at timestamptz, p_raw jsonb)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_id uuid; i jsonb;
begin
  i := public.fh_jobber_integration_for_account(p_account_id);
  insert into public.fh_jobber_events (integration_id, org_id, topic, app_id, account_id, item_id, occurred_at, raw)
  values ((i->>'integration_id')::uuid, (i->>'org_id')::uuid, p_topic, p_app_id, p_account_id, p_item_id, p_occurred_at, coalesce(p_raw, '{}'::jsonb))
  on conflict do nothing
  returning id into v_id;
  return v_id;
end $$;

create or replace function public.fh_jobber_events_claim(p_limit integer default 20, p_account_id text default null)
returns setof public.fh_jobber_events
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  with picked as (
    select e.id from public.fh_jobber_events e
     where (e.status = 'pending'
            or (e.status = 'error' and e.attempts < 6 and e.received_at > now() - interval '3 days')
            or (e.status = 'processing' and e.processed_at is null and e.received_at < now() - interval '10 minutes' and e.attempts < 6))
       and (p_account_id is null or e.account_id = p_account_id)
     order by e.received_at
     limit greatest(1, least(p_limit, 200))
     for update skip locked
  )
  update public.fh_jobber_events e
     set status = 'processing', attempts = e.attempts + 1, received_at = case when e.status = 'processing' then now() else e.received_at end
    from picked where e.id = picked.id
  returning e.*;
end $$;

create or replace function public.fh_jobber_event_finish(p_id uuid, p_status text, p_error text default null, p_result jsonb default null)
returns void
language sql security definer
set search_path = pg_catalog, public
as $$
  update public.fh_jobber_events
     set status = case when p_status in ('done','error','skipped') then p_status else 'error' end,
         last_error = left(p_error, 2000), result = p_result, processed_at = now()
   where id = p_id;
$$;

create or replace function public.fh_jobber_sync_state_set(p_integration uuid, p_patch jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_sync jsonb;
begin
  update public.fh_integrations
     set metadata = metadata || jsonb_build_object('sync', coalesce(metadata->'sync', '{}'::jsonb) || coalesce(p_patch, '{}'::jsonb)),
         last_synced_at = case when coalesce(p_patch->>'status', '') = 'done' then now() else last_synced_at end,
         updated_at = now()
   where id = p_integration
  returning metadata->'sync' into v_sync;
  return v_sync;
end $$;

-- Fire and forget call into the jobber edge function (next sync chunk, event drain).
create or replace function public.fh_jobber_kick(p_path text, p_body jsonb)
returns bigint
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_url text; v_secret text; v_base text; v_id bigint;
begin
  select nullif(value, '') into v_url from public.fh_app_config where key = 'growth_worker_url';
  select nullif(value, '') into v_secret from public.fh_app_config where key = 'growth_worker_secret';
  if v_url is null or v_secret is null or not exists (select 1 from pg_extension where extname = 'pg_net') then return null; end if;
  v_base := regexp_replace(v_url, '/automation-worker.*$', '');
  execute format('select net.http_post(url := %L, headers := %L::jsonb, body := %L::jsonb, timeout_milliseconds := 5000)',
    v_base || '/jobber/' || ltrim(p_path, '/'),
    jsonb_build_object('Content-Type', 'application/json', 'Authorization', 'Bearer ' || v_secret)::text,
    coalesce(p_body, '{}'::jsonb)::text) into v_id;
  return v_id;
exception when others then
  raise warning 'fh_jobber_kick: %', sqlerrm;
  return null;
end $$;

-- One sync chunk at a time per connection.
create or replace function public.fh_jobber_sync_lease(p_integration uuid, p_seconds integer default 90)
returns boolean
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_until timestamptz;
begin
  select (metadata#>>'{sync,lease_until}')::timestamptz into v_until from public.fh_integrations where id = p_integration for update;
  if v_until is not null and v_until > now() then return false; end if;
  update public.fh_integrations
     set metadata = metadata || jsonb_build_object('sync', coalesce(metadata->'sync', '{}'::jsonb) || jsonb_build_object('lease_until', now() + make_interval(secs => p_seconds)))
   where id = p_integration;
  return true;
end $$;

-- APP_CONNECT arrives with the Jobber account id. A connection saved moments ago
-- without one (the account query was unavailable) claims it.
create or replace function public.fh_jobber_account_claim(p_account_id text)
returns uuid
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_id uuid;
begin
  select id into v_id from public.fh_integrations
   where provider = 'jobber' and external_account_id = p_account_id limit 1;
  if v_id is not null then return v_id; end if;
  select id into v_id from public.fh_integrations
   where provider = 'jobber' and external_account_id is null and status = 'connected' and connected_at > now() - interval '30 minutes'
   order by connected_at desc limit 1;
  if v_id is not null then
    update public.fh_integrations set external_account_id = p_account_id, updated_at = now() where id = v_id;
  end if;
  return v_id;
end $$;

-- Every five minutes: drain stuck webhook events, resume a stalled history load,
-- and touch each connection once a day so revoked access shows up as an error
-- instead of a silent gap.
create or replace function public.fh_jobber_drain_tick()
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare n_events int; n_sync int := 0; n_touch int := 0; i record;
begin
  select count(*) into n_events from public.fh_jobber_events
   where status in ('pending', 'error') or (status = 'processing' and processed_at is null and received_at < now() - interval '10 minutes');
  if n_events > 0 then perform public.fh_jobber_kick('process', jsonb_build_object('source', 'tick')); end if;
  for i in select * from public.fh_integrations where provider = 'jobber' and status = 'connected' loop
    if coalesce(i.metadata#>>'{sync,status}', '') in ('queued', 'running')
       and coalesce((i.metadata#>>'{sync,updated_at}')::timestamptz, 'epoch'::timestamptz) < now() - interval '3 minutes' then
      perform public.fh_jobber_kick('sync', jsonb_build_object('org_id', i.org_id, 'mode', coalesce(i.metadata#>>'{sync,mode}', 'full'), 'source', 'tick'));
      n_sync := n_sync + 1;
    elsif coalesce(i.metadata#>>'{sync,status}', '') not in ('queued', 'running')
       and coalesce(i.last_synced_at, i.connected_at, 'epoch'::timestamptz) < now() - interval '24 hours' then
      perform public.fh_jobber_sync_state_set(i.id, jsonb_build_object('status', 'queued', 'mode', 'recent', 'requested_at', now(), 'updated_at', now(), 'cursor', null, 'stage', null, 'counts', '{}'::jsonb, 'error', null));
      perform public.fh_jobber_kick('sync', jsonb_build_object('org_id', i.org_id, 'mode', 'recent', 'source', 'tick'));
      n_touch := n_touch + 1;
    end if;
  end loop;
  return jsonb_build_object('events', n_events, 'sync_resumed', n_sync, 'daily', n_touch, 'at', now());
end $$;

do $$
declare j record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in select jobid from cron.job where jobname = 'fh_jobber_drain' loop
      perform cron.unschedule(j.jobid);
    end loop;
    perform cron.schedule('fh_jobber_drain', '*/5 * * * *', $c$select public.fh_jobber_drain_tick();$c$);
  end if;
end $$;

-- Manager or member facing status for the app.
create or replace function public.fh_jobber_status(p_org_id uuid)
returns jsonb
language plpgsql stable security definer
set search_path = pg_catalog, public
as $$
declare i record; v_counts jsonb; v_pending int; v_last_event timestamptz;
begin
  if auth.uid() is not null and not public.fh_is_org_member(p_org_id) then raise exception 'not allowed'; end if;
  select * into i from public.fh_integrations where org_id = p_org_id and provider = 'jobber';
  if i.id is null then return jsonb_build_object('connected', false, 'status', 'not_connected'); end if;
  select coalesce(jsonb_object_agg(entity, n), '{}'::jsonb) into v_counts
    from (select entity, count(*) as n from public.fh_external_refs where integration_id = i.id group by entity) t;
  select count(*), max(received_at) into v_pending, v_last_event from public.fh_jobber_events where integration_id = i.id and status in ('pending', 'processing', 'error');
  return jsonb_build_object(
    'connected', i.status = 'connected', 'status', i.status, 'account_id', i.external_account_id, 'account_name', i.display_name,
    'scopes', i.scopes, 'connected_at', i.connected_at, 'last_synced_at', i.last_synced_at, 'last_error', i.last_error,
    'sync', coalesce(i.metadata->'sync', '{}'::jsonb), 'org_rules', coalesce(i.metadata->'org_rules', '[]'::jsonb),
    'consent_from_jobber', coalesce((i.metadata->>'consent_from_jobber')::boolean, false),
    'counts', v_counts, 'open_events', v_pending, 'last_event_at', (select max(received_at) from public.fh_jobber_events where integration_id = i.id));
end $$;

-- Manager settings: org_rules, consent_from_jobber, anything else the sync reads.
create or replace function public.fh_jobber_settings_set(p_org_id uuid, p_patch jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_meta jsonb; k text;
begin
  if auth.uid() is not null and not public.fh_is_org_manager(p_org_id) then raise exception 'not allowed'; end if;
  for k in select jsonb_object_keys(coalesce(p_patch, '{}'::jsonb)) loop
    if k not in ('org_rules', 'consent_from_jobber', 'sync_visits_days', 'sync_history_days') then raise exception 'unknown setting %', k; end if;
  end loop;
  update public.fh_integrations set metadata = metadata || coalesce(p_patch, '{}'::jsonb), updated_at = now()
   where org_id = p_org_id and provider = 'jobber'
  returning metadata into v_meta;
  if v_meta is null then raise exception 'jobber is not connected for this company'; end if;
  return v_meta - 'refresh_lease_until';
end $$;

-- Manager asks for a fresh history load (the edge function does the work).
create or replace function public.fh_jobber_sync_request(p_org_id uuid, p_mode text default 'recent')
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare i record;
begin
  if auth.uid() is not null and not public.fh_is_org_manager(p_org_id) then raise exception 'not allowed'; end if;
  select * into i from public.fh_integrations where org_id = p_org_id and provider = 'jobber' and status = 'connected';
  if i.id is null then raise exception 'jobber is not connected for this company'; end if;
  if coalesce(i.metadata#>>'{sync,status}', '') = 'running' and (i.metadata#>>'{sync,updated_at}')::timestamptz > now() - interval '10 minutes' then
    return jsonb_build_object('ok', true, 'already_running', true, 'sync', i.metadata->'sync');
  end if;
  perform public.fh_jobber_sync_state_set(i.id, jsonb_build_object('status', 'queued', 'mode', p_mode, 'requested_at', now(), 'updated_at', now(), 'cursor', null, 'stage', null, 'counts', '{}'::jsonb, 'error', null));
  perform public.fh_jobber_kick('sync', jsonb_build_object('org_id', p_org_id, 'mode', p_mode));
  return jsonb_build_object('ok', true, 'queued', true);
end $$;

