-- follow_up_engine.test.sql
--
-- Checks for migrations 091 (reminders per client) and 096 (the engine
-- reads fh_leads and fh_quotes). Run inside one transaction that ends in
-- rollback, after the migration bodies, so nothing is kept:
--
--   begin;
--   \i supabase/migrations/091_follow_up_engine_per_client.sql
--   \i supabase/migrations/096_engine_reads_leads_quotes.sql
--   \i supabase/tests/follow_up_engine.test.sql
--   rollback;
--
-- Each select returns one row with ok = true when the check holds.

-- Seed one quiet quote and one quiet lead in the first company that has
-- reminders switched on, each on a client of its own so the per client
-- dedupe cannot hide one behind the other. The quote has been out for the
-- company's day7 count of days, the lead for its day3 count.
create temp table t_seed as
select s.org_id,
       coalesce((select user_id from public.org_members m where m.org_id = s.org_id limit 1), gen_random_uuid()) as user_id,
       gen_random_uuid() as quote_client_id,
       gen_random_uuid() as lead_client_id,
       gen_random_uuid() as quote_id,
       gen_random_uuid() as lead_id,
       s.day7_days, s.day3_days
  from public.fh_follow_up_settings s
 where s.enabled and s.day7_enabled and s.day3_enabled
 order by s.org_id
 limit 1;

insert into public.fh_clients (id, org_id, user_id, name, phone)
select quote_client_id, org_id, user_id, 'Quiet Quote Customer', '615-555-0196' from t_seed
union all
select lead_client_id,  org_id, user_id, 'Quiet Lead Customer',  '615-555-0197' from t_seed;

insert into public.fh_quotes (id, org_id, user_id, client_id, title, amount, status, sent_at, created_at)
select quote_id, org_id, user_id, quote_client_id, 'Engine test quote', 1200, 'sent',
       now() - make_interval(days => day7_days), now() - make_interval(days => day7_days + 1)
  from t_seed;

insert into public.fh_leads (id, org_id, user_id, client_id, title, status, created_at)
select lead_id, org_id, user_id, lead_client_id, 'Engine test lead', 'open',
       now() - make_interval(days => day3_days)
  from t_seed;

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

-- A sent quote quiet for 7 days queues a day7 reminder linking /quotes/:id.
select 'a sent quote quiet for 7 days queues a day7 reminder linking /quotes/:id' as check,
       exists (
         select 1 from public.fh_follow_ups f
         join t_seed t on t.quote_id = f.quote_id
         where f.kind = 'day7' and f.status = 'queued'
           and f.client_id = t.quote_client_id and f.contact_id is null
       )
       and exists (
         select 1 from public.fh_notifications n
         join t_seed t on n.link = '/quotes/' || t.quote_id::text
         where n.kind = 'follow_up_due'
       ) as ok;

-- An open lead quiet 3 days queues a day3 reminder linking /leads/:id.
select 'an open lead quiet 3 days queues a day3' as check,
       exists (
         select 1 from public.fh_follow_ups f
         join t_seed t on t.lead_id = f.lead_id
         where f.kind = 'day3' and f.status = 'queued'
           and f.client_id = t.lead_client_id and f.contact_id is null
       )
       and exists (
         select 1 from public.fh_notifications n
         join t_seed t on n.link = '/leads/' || t.lead_id::text
         where n.kind = 'follow_up_due'
       ) as ok;

-- Moved contact rows never get a pipeline reminder of their own.
select 'no queued reminder points at a moved contact' as check,
       count(*) = 0 as ok
  from public.fh_follow_ups f
  join public.fh_contacts c on c.id = f.contact_id
 where f.status = 'queued' and c.stage in ('moved_lead', 'moved_quote');
