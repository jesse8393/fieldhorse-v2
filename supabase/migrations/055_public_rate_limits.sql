-- 055 — Generic per-identifier rate limiter for public (unauthenticated)
-- edge endpoints.
--
-- webhook-lead already has a durable limiter (052), but the public token
-- endpoints (public-link view, public-link-approve, public-co-approve) had
-- none: each request costs a full service-role round trip (and, on a valid
-- token, notification/DB writes), so they were an unauthenticated
-- amplification vector. This adds a general-purpose fixed-window counter
-- keyed on (scope, identifier, bucket) — identifier is a hashed client IP —
-- callable only by the service role.

create table if not exists public.fh_rate_limits (
  id             uuid primary key default gen_random_uuid(),
  scope          text not null,           -- e.g. 'public-link', 'co-approve'
  identifier     text not null,           -- hashed client IP (never raw)
  bucket_start   timestamptz not null,
  window_seconds integer not null default 60,
  request_count  integer not null default 0,
  first_seen_at  timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);

create unique index if not exists fh_rate_limits_scope_id_bucket_uidx
  on public.fh_rate_limits(scope, identifier, bucket_start);

create index if not exists fh_rate_limits_updated_idx
  on public.fh_rate_limits(updated_at desc);

-- Service-role only: RLS on, zero policies, explicit revokes. No tenant
-- ever reads or writes this table directly (same posture as fh_app_config).
alter table public.fh_rate_limits enable row level security;
revoke all on public.fh_rate_limits from public, anon, authenticated;

create or replace function public.fh_increment_rate_limit(
  p_scope text,
  p_identifier text,
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
    insert into public.fh_rate_limits (
      scope, identifier, bucket_start, window_seconds,
      request_count, first_seen_at, updated_at
    )
    values (
      p_scope, p_identifier, p_bucket_start,
      greatest(1, coalesce(p_window_seconds, 60)),
      1, now(), now()
    )
    on conflict (scope, identifier, bucket_start)
    do update set
      request_count = public.fh_rate_limits.request_count + 1,
      updated_at = now()
    returning public.fh_rate_limits.request_count
  )
  select
    upserted.request_count,
    upserted.request_count <= greatest(1, coalesce(p_limit, 60)) as allowed
  from upserted;
end;
$$;

revoke execute on function public.fh_increment_rate_limit(text, text, timestamptz, integer, integer) from public;
revoke execute on function public.fh_increment_rate_limit(text, text, timestamptz, integer, integer) from anon;
revoke execute on function public.fh_increment_rate_limit(text, text, timestamptz, integer, integer) from authenticated;
grant execute on function public.fh_increment_rate_limit(text, text, timestamptz, integer, integer) to service_role;
