-- 052 - Public edge hardening
--
-- Adds two production guardrails for unauthenticated entry points:
--   1. durable, atomic webhook rate-limit buckets per webhook key
--   2. append-only public-link view events for audit/analytics

create table if not exists public.fh_webhook_rate_limits (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  webhook_key_hash text not null,
  bucket_start timestamptz not null,
  window_seconds integer not null default 60,
  request_count integer not null default 0,
  first_seen_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index if not exists fh_webhook_rate_limits_key_bucket_uidx
  on public.fh_webhook_rate_limits(webhook_key_hash, bucket_start);

create index if not exists fh_webhook_rate_limits_org_updated_idx
  on public.fh_webhook_rate_limits(org_id, updated_at desc);

alter table public.fh_webhook_rate_limits enable row level security;

drop policy if exists "fh_webhook_rate_limits_org_read" on public.fh_webhook_rate_limits;
create policy "fh_webhook_rate_limits_org_read"
  on public.fh_webhook_rate_limits
  for select
  to authenticated
  using (org_id in (select public.auth_user_org_ids()));

create table if not exists public.fh_public_link_events (
  id uuid primary key default gen_random_uuid(),
  public_link_id uuid not null references public.fh_public_links(id) on delete cascade,
  org_id uuid references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid references public.fh_contacts(id) on delete set null,
  kind text not null,
  event_type text not null default 'view',
  user_agent text,
  referer text,
  ip_hash text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create index if not exists fh_public_link_events_link_created_idx
  on public.fh_public_link_events(public_link_id, created_at desc);

create index if not exists fh_public_link_events_org_created_idx
  on public.fh_public_link_events(org_id, created_at desc);

alter table public.fh_public_link_events enable row level security;

drop policy if exists "fh_public_link_events_org_read" on public.fh_public_link_events;
create policy "fh_public_link_events_org_read"
  on public.fh_public_link_events
  for select
  to authenticated
  using (org_id in (select public.auth_user_org_ids()));

create or replace function public.fh_increment_webhook_rate_limit(
  p_user_id uuid,
  p_org_id uuid,
  p_key_hash text,
  p_bucket_start timestamptz,
  p_limit integer,
  p_window_seconds integer default 60
)
returns table(request_count integer, allowed boolean)
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  return query
  with upserted as (
    insert into public.fh_webhook_rate_limits (
      user_id,
      org_id,
      webhook_key_hash,
      bucket_start,
      window_seconds,
      request_count,
      first_seen_at,
      updated_at
    )
    values (
      p_user_id,
      p_org_id,
      p_key_hash,
      p_bucket_start,
      greatest(1, coalesce(p_window_seconds, 60)),
      1,
      now(),
      now()
    )
    on conflict (webhook_key_hash, bucket_start)
    do update set
      request_count = public.fh_webhook_rate_limits.request_count + 1,
      updated_at = now()
    returning public.fh_webhook_rate_limits.request_count
  )
  select
    upserted.request_count,
    upserted.request_count <= greatest(1, coalesce(p_limit, 60)) as allowed
  from upserted;
end;
$$;

revoke execute on function public.fh_increment_webhook_rate_limit(uuid, uuid, text, timestamptz, integer, integer) from public;
revoke execute on function public.fh_increment_webhook_rate_limit(uuid, uuid, text, timestamptz, integer, integer) from anon;
revoke execute on function public.fh_increment_webhook_rate_limit(uuid, uuid, text, timestamptz, integer, integer) from authenticated;
grant execute on function public.fh_increment_webhook_rate_limit(uuid, uuid, text, timestamptz, integer, integer) to service_role;

create or replace function public.fh_record_public_link_view(
  p_public_link_id uuid,
  p_org_id uuid,
  p_user_id uuid,
  p_contact_id uuid,
  p_kind text,
  p_user_agent text default null,
  p_referer text default null,
  p_ip_hash text default null,
  p_metadata jsonb default '{}'::jsonb
)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  update public.fh_public_links
     set view_count = coalesce(view_count, 0) + 1,
         last_viewed_at = now()
   where id = p_public_link_id;

  insert into public.fh_public_link_events (
    public_link_id,
    org_id,
    user_id,
    contact_id,
    kind,
    event_type,
    user_agent,
    referer,
    ip_hash,
    metadata
  )
  values (
    p_public_link_id,
    p_org_id,
    p_user_id,
    p_contact_id,
    p_kind,
    'view',
    nullif(left(coalesce(p_user_agent, ''), 500), ''),
    nullif(left(coalesce(p_referer, ''), 500), ''),
    nullif(left(coalesce(p_ip_hash, ''), 128), ''),
    coalesce(p_metadata, '{}'::jsonb)
  );
end;
$$;

revoke execute on function public.fh_record_public_link_view(uuid, uuid, uuid, uuid, text, text, text, text, jsonb) from public;
revoke execute on function public.fh_record_public_link_view(uuid, uuid, uuid, uuid, text, text, text, text, jsonb) from anon;
revoke execute on function public.fh_record_public_link_view(uuid, uuid, uuid, uuid, text, text, text, text, jsonb) from authenticated;
grant execute on function public.fh_record_public_link_view(uuid, uuid, uuid, uuid, text, text, text, text, jsonb) to service_role;
