-- follow_up_engine.test.sql
--
-- Checks for migration 091 (reminders per client). Run inside one
-- transaction that ends in rollback, after the migration body, so nothing
-- is kept:
--
--   begin;
--   \i supabase/migrations/091_follow_up_engine_per_client.sql
--   \i supabase/tests/follow_up_engine.test.sql
--   rollback;
--
-- Each select returns one row with ok = true when the check holds.

select public.fh_run_follow_up_engine() as run_once;
select public.fh_run_follow_up_engine() as run_twice;

-- No client has two queued reminders of one kind.
select 'one queued reminder per client and kind' as check,
       count(*) = 0 as ok
  from (
    select client_id, kind from public.fh_follow_ups
     where status = 'queued' and client_id is not null
     group by 1, 2 having count(*) > 1
  ) d;

-- No queued reminder sits on a lost deal.
select 'no queued reminder on a lost deal' as check,
       count(*) = 0 as ok
  from public.fh_follow_ups f
  join public.fh_contacts c on c.id = f.contact_id
 where f.status = 'queued' and c.stage = 'lost';

-- Running the engine twice in a row adds nothing the second time.
select 'a second run adds nothing' as check,
       (public.fh_run_follow_up_engine()->>'pipeline_queued')::int = 0
       and (public.fh_run_follow_up_engine()->>'review_asks_queued')::int = 0 as ok;

-- Every queued row carries its client when the contact has one.
select 'queued rows carry client_id' as check,
       count(*) = 0 as ok
  from public.fh_follow_ups f
  join public.fh_contacts c on c.id = f.contact_id
 where f.status = 'queued' and f.client_id is null and c.client_id is not null;
