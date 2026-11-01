-- =============================================================================
-- 075_growth_schedule.sql
-- pg_cron heartbeat + pg_net worker ping. Guarded so it is a no op where the
-- extensions are missing (local sandbox).
-- =============================================================================

do $$
begin
  if exists (select 1 from pg_available_extensions where name = 'pg_net') then
    create extension if not exists pg_net;
  end if;
end $$;

do $$
declare j record;
begin
  if exists (select 1 from pg_extension where extname = 'pg_cron') then
    for j in select jobid from cron.job where jobname in ('fh_automation_tick','fh_appointment_reminders','fh_daily_sweep') loop
      perform cron.unschedule(j.jobid);
    end loop;
    perform cron.schedule('fh_automation_tick', '* * * * *', $c$select public.fh_automation_tick();$c$);
    perform cron.schedule('fh_appointment_reminders', '*/5 * * * *', $c$select public.fh_appointment_reminders_sweep();$c$);
    -- 13:30 UTC is 8:30 AM Central in summer and 7:30 AM in winter
    perform cron.schedule('fh_daily_sweep', '30 13 * * *', $c$select public.fh_daily_sweep();$c$);
  end if;
end $$;

-- Worker wiring lives in fh_app_config (service role only):
--   growth_worker_url     https://<project>.supabase.co/functions/v1/automation-worker
--   growth_worker_secret  a long random string, also set as WORKER_SECRET on the function
-- Rows are created empty here; the tick ignores empty values.
insert into public.fh_app_config (key, value) values ('growth_worker_url', ''), ('growth_worker_secret', '')
on conflict (key) do nothing;

