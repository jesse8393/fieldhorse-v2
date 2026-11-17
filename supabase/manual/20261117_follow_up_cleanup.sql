-- 20261117_follow_up_cleanup.sql
--
-- Run by hand, once, in the SQL editor, AFTER migration
-- 20261117100000_follow_ups_in_step.sql is applied and BEFORE migration
-- 20261117100100_follow_up_unique_indexes.sql. This is not a migration: it
-- closes stale reminders and marks their notifications read (audit findings
-- AUTO-01, AUTO-05, AUTO-07). Do the dry run first.
--
-- Do it before the next engine run (13:00 UTC daily). From the migration on,
-- every engine run starts with fh_follow_up_reconcile(true) itself, so a run
-- in between applies this cleanup without the dry run.
--
-- As it stands this whole file changes nothing: every step ends in rollback.
-- To keep step 2, change its rollback to commit once its report matches the
-- dry run of step 1.
--
-- What the dry run is expected to report, worked out from the production
-- counts of 2026-11-16 (any reminder the engine raises after that moves
-- still_queued and still_unread_reminders up by one each):
--   notifications_linked                     0   the migration linked them
--   closed_record_deleted                    0
--   closed_lead_not_open_or_quoted           0
--   closed_quote_not_waiting                 0
--   closed_pipeline_on_job_row               1   the quote era day14 on a won job
--   closed_review_ask                        0
--   closed_unreachable                       0
--   closed_superseded                        0
--   closed_expired                           5   review asks from July and August
--   notifications_marked_read               77   74 on follow ups already skipped,
--                                                 3 review asks unread since July
--   of_those_follow_up_was_already_closed   74   the 3 review asks are read by
--                                                 the close trigger, not counted here
--   of_those_no_follow_up_left               0   a notification the migration could
--                                                 not link moves from the line above
--                                                 to this one; the two never pass 74
--   still_queued                            18   24 minus the 6 closed above
--   still_unread_reminders                  14   91 minus 77
-- Anything far from that: stop and look before committing step 2.

-- Step 1, look. The function undoes its own work when p_apply is false, and
-- the transaction around it is a second belt.
begin;
select public.fh_follow_up_reconcile(false) as would_change;
rollback;

-- Step 2, do it, and read the same report before keeping it.
begin;
select public.fh_follow_up_reconcile(true) as changed;
rollback;  -- end of step 2: change to commit once the report matches step 1

-- Step 3, optional and a separate decision. Leads the engine pushed onto
-- Today: clear the follow up date the engine wrote when the reminder it
-- belonged to is closed and no open reminder is left for the lead. Counts
-- first; production had 57 open leads 14 or more days overdue this way.
begin;
with stale as (
  select l.id
    from public.fh_leads l
   where l.status = 'open'
     and l.follow_up_on is not null
     and l.follow_up_on < current_date
     and exists (select 1 from public.fh_follow_ups f
                  where f.lead_id = l.id and f.due_on = l.follow_up_on and f.status <> 'queued')
     and not exists (select 1 from public.fh_follow_ups f where f.lead_id = l.id and f.status = 'queued')
),
cleared as (
  update public.fh_leads l set follow_up_on = null
    from stale s where s.id = l.id
  returning 1
)
select (select count(*) from stale) as leads_with_a_stale_engine_date,
       (select count(*) from cleared) as leads_cleared;
rollback;  -- end of step 3: change to commit once the count is the one you expect
