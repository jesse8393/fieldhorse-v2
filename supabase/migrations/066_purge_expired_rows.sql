-- 066_purge_expired_rows.sql
--
-- NOT YET APPLIED TO PRODUCTION. Apply it from the Supabase SQL editor or
-- with `supabase db push`. (The audit session could not run statements that
-- remove rows, because the database connector it used asks a person to
-- confirm those and no one could.)
--
-- fh_rate_limits and fh_webhook_rate_limits get one row per caller per
-- minute and only the current window is ever read, so they grow forever.
-- fh_public_link_events gets one row per customer view; the view counter
-- lives on fh_public_links.view_count, so old events are only an audit trail.
--
-- A nightly pg_cron job keeps two days of rate limit windows (the longest
-- window in use is ten minutes) and a little over a year of link events.

create or replace function public.fh_purge_expired_rows()
returns void
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  delete from public.fh_rate_limits
   where bucket_start < now() - interval '2 days';

  delete from public.fh_webhook_rate_limits
   where bucket_start < now() - interval '2 days';

  delete from public.fh_public_link_events
   where created_at < now() - interval '400 days';
end
$$;

revoke all on function public.fh_purge_expired_rows() from public, anon, authenticated;

-- cron.schedule replaces an existing job with the same name, so this is safe
-- to run more than once.
select cron.schedule(
  'fh_purge_expired_rows',
  '17 9 * * *',
  $$select public.fh_purge_expired_rows();$$
);
