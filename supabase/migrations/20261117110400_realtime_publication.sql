-- Live refresh for jobs, visits, payments, leads, quotes, change orders,
-- invoices and job files (DB-15).
--
-- The app subscribes to changes on these tables (home dashboard, job
-- screen, lists), but none of them is in the supabase_realtime publication,
-- so those subscriptions never fire and screens only refresh on refetch.
-- Each table already scopes reads by company with row level security, and
-- realtime applies those same read rules to every subscriber.
--
-- Each table is added only when it exists and is not already published.
-- Nothing happens when the publication does not exist (local databases).
-- Running it twice is safe.

do $$
declare
  t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    return;
  end if;
  foreach t in array array[
    'fh_contacts', 'fh_schedule', 'fh_payments', 'fh_leads',
    'fh_quotes', 'fh_change_orders', 'fh_invoices', 'fh_job_files'
  ]
  loop
    continue when to_regclass('public.' || t) is null;
    continue when exists (
      select 1 from pg_publication_tables
       where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
    );
    execute format('alter publication supabase_realtime add table public.%I', t);
  end loop;
end
$$;
