-- 057 — Per-member default hourly rate for crew labor costing.
--
-- Crew members clock in via Crew Home, which writes a punch with no rate,
-- so crew labor contributed $0 to job cost/margin. This adds an
-- owner-configurable per-member rate; the crew-labor rollup uses it when a
-- punch has no per-punch snapshot rate. Owner-set (crew can't change their
-- own rate — enforced by the fh_time_punches guard + org_members RLS).

alter table public.org_members
  add column if not exists default_hourly_rate numeric;

alter table public.org_members
  drop constraint if exists org_members_default_hourly_rate_check;
alter table public.org_members
  add constraint org_members_default_hourly_rate_check
  check (default_hourly_rate is null or (default_hourly_rate >= 0 and default_hourly_rate < 10000))
  not valid;
