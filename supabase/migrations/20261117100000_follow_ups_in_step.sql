-- 20261117100000_follow_ups_in_step.sql
--
-- Audit findings AUTO-01 to AUTO-09, AUTO-12, AUTO-13 and the database part
-- of AUTO-11. Keeps reminder notifications in step with fh_follow_ups from
-- now on.
--
--   1. A notification points at its follow up (fh_notifications.follow_up_id).
--   2. Closing a follow up by ANY path (the app, the engine, a bulk update, a
--      cascade) marks its notification read. A trigger does it, so no caller
--      can forget.
--   3. A record that stops needing a reminder closes its follow ups: a lead
--      that is quoted, lost or deleted; a quote that is approved, rejected,
--      lost, expired, made into a job, sent again or deleted; a job row that
--      leaves the lead or quote stage, is lost, moved or reopened.
--   4. The engine raises at most one open reminder per record and person. A
--      newer tier closes the older one (superseded) before it is queued.
--   5. The engine skips records that should not be reminded: leads that
--      already have a quote, quotes past their valid until date or already
--      made into a job, customers with no phone and no email, records whose
--      creator left the company (the owner gets it), and anything that has
--      been quiet far longer than the tier it would get.
--   6. Day counting uses the company's time zone.
--   7. A daily cap per person stops a flood when reminders are switched on
--      or records are imported.
--
-- Additive and reversible. New nullable columns, new functions, new triggers
-- (create or replace), functions replaced in place. Nothing is removed. To go
-- back: run fh_run_follow_up_engine from 096_engine_reads_leads_quotes.sql
-- and fh_follow_up_set_status from 20261101020547_authorization_transition_guards.sql
-- again (not the one in 096, which lacks the caller guards), and switch the
-- nine new triggers off with
--   alter table public.<table> disable trigger <name>;
-- The new columns and the partial indexes of 20261117100100 can stay;
-- nothing reads them once the old bodies are back.
--
-- Order: apply this file, then run supabase/manual/20261117_follow_up_cleanup.sql
-- by hand (dry run first), then apply 20261117100100_follow_up_unique_indexes.sql
-- (the unique indexes need the duplicates closed first). Run the dry run
-- before the next 13:00 UTC engine run: from now on the engine applies the
-- same reconcile itself at the start of every run.
--
-- Checked by scripts/validate-follow-ups-sql.mjs (npm run test:db).

-- ---------------------------------------------------------------------------
-- 1. Columns
-- ---------------------------------------------------------------------------
alter table public.fh_notifications
  add column if not exists follow_up_id uuid references public.fh_follow_ups(id) on delete set null;

create index if not exists fh_notifications_follow_up_idx
  on public.fh_notifications (follow_up_id)
  where follow_up_id is not null;

-- Why a follow up left the queue: done, dismissed, superseded, record_closed,
-- record_deleted, contact_logged, unreachable, expired, closed (a bulk update
-- that gave no reason).
alter table public.fh_follow_ups
  add column if not exists closed_reason text;

-- New reminders one person may receive from one engine run day.
alter table public.fh_follow_up_settings
  add column if not exists max_new_per_day integer not null default 10;

-- Link the notifications that exist today. The engine wrote both rows in one
-- statement with title = headline and the record id at the end of the link,
-- which is the match fh_follow_up_set_status has used since 090. One
-- notification per follow up and person: the newest wins.
with matched as (
  select n.id as notification_id, f.id as follow_up_id,
         row_number() over (partition by n.id order by (f.status = 'queued') desc, f.created_at desc) as pick_follow_up
    from public.fh_notifications n
    join public.fh_follow_ups f
      on f.headline = n.title
     and coalesce(f.lead_id, f.quote_id, f.contact_id)::text = nullif(regexp_replace(coalesce(n.link, ''), '^.*/', ''), '')
     and f.user_id is not distinct from n.user_id
   where n.kind in ('follow_up_due', 'review_ask_due')
     and n.follow_up_id is null
     and not exists (select 1 from public.fh_notifications x where x.follow_up_id = f.id and x.user_id = n.user_id)
),
one_each as (
  select m.notification_id, m.follow_up_id,
         row_number() over (partition by m.follow_up_id order by n.created_at desc) as pick_notification
    from matched m
    join public.fh_notifications n on n.id = m.notification_id
   where m.pick_follow_up = 1
)
update public.fh_notifications n
   set follow_up_id = o.follow_up_id
  from one_each o
 where o.notification_id = n.id
   and o.pick_notification = 1;

-- ---------------------------------------------------------------------------
-- 2. Closing a follow up resolves its notification
-- ---------------------------------------------------------------------------
create or replace function public.fh_follow_ups_before_status()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if old.status = 'queued' and new.status is distinct from 'queued' then
    new.completed_at  := coalesce(new.completed_at, now());
    new.closed_reason := coalesce(new.closed_reason,
                                  case new.status when 'done' then 'done' when 'sent' then 'sent' else 'closed' end);
  elsif new.status = 'queued' and old.status is distinct from 'queued' then
    new.completed_at  := null;
    new.completed_by  := null;
    new.closed_reason := null;
  end if;
  return new;
end;
$function$;

create or replace function public.fh_follow_ups_after_close()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  update public.fh_notifications n
     set read_at = coalesce(n.read_at, now())
   where n.follow_up_id = new.id
     and n.read_at is null;

  -- The engine set the lead's follow up date when it raised this reminder.
  -- When a person answers the reminder, that date has been dealt with.
  if new.lead_id is not null and new.closed_reason in ('done', 'dismissed') then
    update public.fh_leads l
       set follow_up_on = null
     where l.id = new.lead_id
       and l.follow_up_on is not null
       and l.follow_up_on <= (now() at time zone public.fh_org_tz(l.org_id))::date;
  end if;
  return null;
end;
$function$;

create or replace function public.fh_follow_ups_before_delete()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  update public.fh_notifications n
     set read_at = coalesce(n.read_at, now())
   where n.follow_up_id = old.id
     and n.read_at is null;
  return old;
end;
$function$;

create or replace trigger fh_follow_ups_before_status
  before update of status on public.fh_follow_ups
  for each row execute function public.fh_follow_ups_before_status();

create or replace trigger fh_follow_ups_after_close
  after update of status on public.fh_follow_ups
  for each row
  when (old.status = 'queued' and new.status is distinct from 'queued')
  execute function public.fh_follow_ups_after_close();

create or replace trigger fh_follow_ups_before_delete
  before delete on public.fh_follow_ups
  for each row execute function public.fh_follow_ups_before_delete();

-- ---------------------------------------------------------------------------
-- 3. A record that no longer needs a reminder closes its follow ups
-- ---------------------------------------------------------------------------
create or replace function public.fh_follow_up_close(
  p_reason     text,
  p_lead_id    uuid default null,
  p_quote_id   uuid default null,
  p_contact_id uuid default null,
  p_kinds      text[] default null
)
returns integer
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_rows integer := 0;
begin
  if p_lead_id is null and p_quote_id is null and p_contact_id is null then
    return 0;
  end if;
  update public.fh_follow_ups f
     set status = 'skipped', closed_reason = p_reason, completed_at = now()
   where f.status = 'queued'
     and (   (p_lead_id    is not null and f.lead_id    = p_lead_id)
          or (p_quote_id   is not null and f.quote_id   = p_quote_id)
          or (p_contact_id is not null and f.contact_id = p_contact_id))
     and (p_kinds is null or f.kind = any (p_kinds));
  get diagnostics v_rows = row_count;
  return v_rows;
end;
$function$;

create or replace function public.fh_leads_close_follow_ups()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    perform public.fh_follow_up_close('record_deleted', old.id, null, null, null);
    return old;
  end if;
  if new.status is distinct from 'open' or new.quote_id is not null then
    perform public.fh_follow_up_close('record_closed', new.id, null, null, null);
  elsif new.last_contact is distinct from old.last_contact and new.last_contact is not null then
    perform public.fh_follow_up_close('contact_logged', new.id, null, null, null);
  end if;
  return null;
end;
$function$;

create or replace function public.fh_quotes_close_follow_ups()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if tg_op = 'DELETE' then
    perform public.fh_follow_up_close('record_deleted', null, old.id, null, null);
    return old;
  end if;
  if new.status not in ('sent', 'viewed', 'changes_requested')
     or new.job_id is not null
     or (new.expires_at is not null and new.expires_at <= now()) then
    perform public.fh_follow_up_close('record_closed', null, new.id, null, null);
  elsif new.sent_at is distinct from old.sent_at
     or new.change_requested_at is distinct from old.change_requested_at then
    perform public.fh_follow_up_close('contact_logged', null, new.id, null, null);
  end if;
  -- A quote made from a lead: the lead's reminders are over too.
  if new.lead_id is not null and (old.lead_id is distinct from new.lead_id) then
    perform public.fh_follow_up_close('record_closed', new.lead_id, null, null, null);
  end if;
  return null;
end;
$function$;

create or replace function public.fh_quotes_new_closes_lead_follow_ups()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if new.lead_id is not null then
    perform public.fh_follow_up_close('record_closed', new.lead_id, null, null, null);
  end if;
  return null;
end;
$function$;

create or replace function public.fh_contacts_close_follow_ups()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
begin
  if new.stage is distinct from old.stage then
    if coalesce(new.stage, 'lead') in ('lost', 'moved_lead', 'moved_quote') then
      perform public.fh_follow_up_close('record_closed', null, null, new.id, null);
    elsif coalesce(new.stage, 'lead') not in ('lead', 'quote') then
      perform public.fh_follow_up_close('record_closed', null, null, new.id, array['day3', 'day7', 'day14', 'day30']);
    end if;
  end if;
  if old.completed_at is not null and new.completed_at is null then
    perform public.fh_follow_up_close('record_closed', null, null, new.id, array['review_ask']);
  end if;
  return null;
end;
$function$;

create or replace trigger fh_leads_close_follow_ups
  after update of status, last_contact, quote_id on public.fh_leads
  for each row execute function public.fh_leads_close_follow_ups();

create or replace trigger fh_leads_close_follow_ups_on_delete
  before delete on public.fh_leads
  for each row execute function public.fh_leads_close_follow_ups();

create or replace trigger fh_quotes_close_follow_ups
  after update of status, sent_at, change_requested_at, job_id, expires_at, lead_id on public.fh_quotes
  for each row execute function public.fh_quotes_close_follow_ups();

create or replace trigger fh_quotes_close_follow_ups_on_delete
  before delete on public.fh_quotes
  for each row execute function public.fh_quotes_close_follow_ups();

create or replace trigger fh_quotes_new_closes_lead_follow_ups
  after insert on public.fh_quotes
  for each row execute function public.fh_quotes_new_closes_lead_follow_ups();

create or replace trigger fh_contacts_close_follow_ups
  after update of stage, completed_at on public.fh_contacts
  for each row execute function public.fh_contacts_close_follow_ups();

-- ---------------------------------------------------------------------------
-- 4. Reconcile: the same rules as a statement, for rows the triggers never saw
--    (everything that happened before today, and any later bulk change made
--    with triggers switched off). p_apply false reports and changes nothing.
-- ---------------------------------------------------------------------------
create or replace function public.fh_follow_up_reconcile(
  p_apply  boolean default false,
  p_org_id uuid default null,
  p_expire_after_days integer default 45
)
returns jsonb
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_linked integer := 0; v_orphan integer := 0; v_lead integer := 0; v_quote integer := 0;
  v_contact integer := 0; v_review integer := 0; v_unreachable integer := 0; v_dupe integer := 0;
  v_expired integer := 0; v_read integer := 0; v_unlinked integer := 0;
  v_unread_before integer := 0; v_unread_after integer := 0;
  v_report jsonb;
begin
  select count(*) into v_unread_before from public.fh_notifications n
   where n.kind in ('follow_up_due', 'review_ask_due') and n.read_at is null and (p_org_id is null or n.org_id = p_org_id);
  begin
    -- a. notifications that still have no link
    with matched as (
      select n.id as notification_id, f.id as follow_up_id,
             row_number() over (partition by n.id order by (f.status = 'queued') desc, f.created_at desc) as pick_follow_up
        from public.fh_notifications n
        join public.fh_follow_ups f
          on f.headline = n.title
         and coalesce(f.lead_id, f.quote_id, f.contact_id)::text = nullif(regexp_replace(coalesce(n.link, ''), '^.*/', ''), '')
         and f.user_id is not distinct from n.user_id
       where n.kind in ('follow_up_due', 'review_ask_due') and n.follow_up_id is null
         and (p_org_id is null or n.org_id = p_org_id)
         and not exists (select 1 from public.fh_notifications x where x.follow_up_id = f.id and x.user_id = n.user_id)
    ),
    one_each as (
      select m.notification_id, m.follow_up_id,
             row_number() over (partition by m.follow_up_id order by n.created_at desc) as pick_notification
        from matched m join public.fh_notifications n on n.id = m.notification_id
       where m.pick_follow_up = 1
    )
    update public.fh_notifications n set follow_up_id = o.follow_up_id
      from one_each o where o.notification_id = n.id and o.pick_notification = 1;
    get diagnostics v_linked = row_count;

    -- b. queued with no record left (the record was deleted)
    update public.fh_follow_ups f set status = 'skipped', closed_reason = 'record_deleted', completed_at = now()
     where f.status = 'queued' and f.lead_id is null and f.quote_id is null and f.contact_id is null
       and (p_org_id is null or f.org_id = p_org_id);
    get diagnostics v_orphan = row_count;

    -- c. queued on a lead that is not open, or already has a quote
    update public.fh_follow_ups f set status = 'skipped', closed_reason = 'record_closed', completed_at = now()
      from public.fh_leads l
     where f.status = 'queued' and l.id = f.lead_id
       and (l.status is distinct from 'open' or l.quote_id is not null
            or exists (select 1 from public.fh_quotes q where q.lead_id = l.id))
       and (p_org_id is null or f.org_id = p_org_id);
    get diagnostics v_lead = row_count;

    -- d. queued on a quote that is no longer out with the customer
    update public.fh_follow_ups f set status = 'skipped', closed_reason = 'record_closed', completed_at = now()
      from public.fh_quotes q
     where f.status = 'queued' and q.id = f.quote_id
       and (q.status not in ('sent', 'viewed', 'changes_requested') or q.job_id is not null
            or (q.expires_at is not null and q.expires_at <= now()))
       and (p_org_id is null or f.org_id = p_org_id);
    get diagnostics v_quote = row_count;

    -- e. pipeline reminders on a job row that left the lead and quote stages
    update public.fh_follow_ups f set status = 'skipped', closed_reason = 'record_closed', completed_at = now()
      from public.fh_contacts c
     where f.status = 'queued' and c.id = f.contact_id and f.kind <> 'review_ask'
       and coalesce(c.stage, 'lead') not in ('lead', 'quote')
       and (p_org_id is null or f.org_id = p_org_id);
    get diagnostics v_contact = row_count;

    -- f. review asks on a job that is lost, moved or back in progress
    update public.fh_follow_ups f set status = 'skipped', closed_reason = 'record_closed', completed_at = now()
      from public.fh_contacts c
     where f.status = 'queued' and c.id = f.contact_id and f.kind = 'review_ask'
       and (c.completed_at is null or coalesce(c.stage, 'lead') in ('lost', 'moved_lead', 'moved_quote'))
       and (p_org_id is null or f.org_id = p_org_id);
    get diagnostics v_review = row_count;

    -- g. the customer has no phone and no email
    update public.fh_follow_ups f set status = 'skipped', closed_reason = 'unreachable', completed_at = now()
      from public.fh_clients cl
     where f.status = 'queued' and cl.id = f.client_id
       and nullif(btrim(coalesce(cl.phone, '')), '') is null and nullif(btrim(coalesce(cl.email, '')), '') is null
       and (p_org_id is null or f.org_id = p_org_id);
    get diagnostics v_unreachable = row_count;

    -- h. more than one open reminder for a lead or quote and person: the newest stays
    with ranked as (
      select f.id, row_number() over (partition by coalesce(f.lead_id, f.quote_id), f.user_id order by f.created_at desc, f.id) as rn
        from public.fh_follow_ups f
       where f.status = 'queued' and coalesce(f.lead_id, f.quote_id) is not null
         and (p_org_id is null or f.org_id = p_org_id)
    )
    update public.fh_follow_ups f set status = 'skipped', closed_reason = 'superseded', completed_at = now()
      from ranked r where r.id = f.id and r.rn > 1;
    get diagnostics v_dupe = row_count;

    -- i. open for longer than p_expire_after_days (null keeps them all)
    if p_expire_after_days is not null then
      update public.fh_follow_ups f set status = 'skipped', closed_reason = 'expired', completed_at = now()
       where f.status = 'queued' and f.due_on < current_date - p_expire_after_days
         and (p_org_id is null or f.org_id = p_org_id);
      get diagnostics v_expired = row_count;
    end if;

    -- j. unread notifications whose follow up is closed (the trigger covers
    --    the rows closed above once it exists; this covers every older one)
    update public.fh_notifications n set read_at = now()
      from public.fh_follow_ups f
     where n.follow_up_id = f.id and n.read_at is null and f.status <> 'queued'
       and (p_org_id is null or n.org_id = p_org_id);
    get diagnostics v_read = row_count;

    -- k. unread reminder notifications with no follow up at all (it was
    --    removed with its job)
    update public.fh_notifications n set read_at = now()
     where n.kind in ('follow_up_due', 'review_ask_due') and n.read_at is null and n.follow_up_id is null
       and (p_org_id is null or n.org_id = p_org_id);
    get diagnostics v_unlinked = row_count;

    select count(*) into v_unread_after from public.fh_notifications n
     where n.kind in ('follow_up_due', 'review_ask_due') and n.read_at is null and (p_org_id is null or n.org_id = p_org_id);

    v_report := jsonb_build_object(
      'applied', p_apply,
      'notifications_linked', v_linked,
      'closed_record_deleted', v_orphan,
      'closed_lead_not_open_or_quoted', v_lead,
      'closed_quote_not_waiting', v_quote,
      'closed_pipeline_on_job_row', v_contact,
      'closed_review_ask', v_review,
      'closed_unreachable', v_unreachable,
      'closed_superseded', v_dupe,
      'closed_expired', v_expired,
      'notifications_marked_read', v_unread_before - v_unread_after,
      'of_those_follow_up_was_already_closed', v_read,
      'of_those_no_follow_up_left', v_unlinked,
      'still_queued', (select count(*) from public.fh_follow_ups f where f.status = 'queued' and (p_org_id is null or f.org_id = p_org_id)),
      'still_unread_reminders', v_unread_after
    );
    if not p_apply then
      raise exception using errcode = 'FH001', message = 'dry run';
    end if;
  exception when sqlstate 'FH001' then
    null;   -- every change of the dry run is undone; the report keeps its numbers
  end;
  return v_report;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 5. The engine
-- ---------------------------------------------------------------------------
create or replace function public.fh_run_follow_up_engine(p_org_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pipeline   integer := 0;
  v_review     integer := 0;
  v_superseded integer := 0;
  v_waiting    integer := 0;
  v_capped     integer := 0;
  v_rows       integer := 0;
  v_today_count integer;
  v_id         uuid;
  v_heal       jsonb;
  r            record;
begin
  -- One run at a time: a second caller waits and then finds nothing to add.
  perform pg_advisory_xact_lock(hashtext('fh_run_follow_up_engine'));

  -- Close what the rules say should not be open before raising anything new.
  v_heal := public.fh_follow_up_reconcile(true, p_org_id, 45);

  for r in
    with orgs as (
      select s.org_id, s.from_name, s.max_new_per_day,
             s.day3_days, s.day7_days, s.day14_days, s.day30_days,
             s.day3_enabled, s.day7_enabled, s.day14_enabled, s.day30_enabled,
             fh_org_tz(s.org_id) as tz,
             (now() at time zone fh_org_tz(s.org_id))::date as today
        from fh_follow_up_settings s
       where s.enabled and (p_org_id is null or s.org_id = p_org_id)
    ),
    records as (
      -- Open leads with no quote yet.
      select 'lead'::text as record, l.id as lead_id, null::uuid as quote_id,
             l.org_id, l.user_id, l.client_id, 'lead'::text as stage, l.created_at, l.origin_contact_id,
             coalesce(l.last_contact, (l.created_at at time zone o.tz)::date) as anchor_on
        from fh_leads l
        join orgs o on o.org_id = l.org_id
       where l.status = 'open'
         and l.quote_id is null
         and not exists (select 1 from fh_quotes q where q.lead_id = l.id)
      union all
      -- Quotes out with the customer, still valid, not yet a job.
      select 'quote', null::uuid, q.id,
             q.org_id, q.user_id, q.client_id, q.status, q.created_at, q.origin_contact_id,
             (coalesce(greatest(q.sent_at, q.change_requested_at), q.created_at) at time zone o.tz)::date
        from fh_quotes q
        join orgs o on o.org_id = q.org_id
       where q.status in ('sent', 'viewed', 'changes_requested')
         and q.job_id is null
         and (q.expires_at is null or q.expires_at > now())
    ),
    scored as (
      select x.*, o.tz, o.today, o.max_new_per_day,
             coalesce(nullif(btrim(cl.name), ''), 'your customer') as name,
             nullif(btrim(coalesce(cl.phone, '')), '') is not null as has_phone,
             nullif(btrim(rtrim(btrim(coalesce(o.from_name, '')), '.')), '') as company,
             (o.today - x.anchor_on)::integer as days_quiet,
             -- The person who gets it: the record's creator while still in
             -- the company, otherwise the owner.
             coalesce(
               (select m.user_id from org_members m
                 where m.org_id = x.org_id and m.user_id = x.user_id and m.revoked_at is null limit 1),
               (select m.user_id from org_members m
                 where m.org_id = x.org_id and m.revoked_at is null and m.role = 'owner'
                 order by m.joined_at limit 1)
             ) as recipient,
             o.day3_days, o.day7_days, o.day14_days, o.day30_days,
             o.day3_enabled, o.day7_enabled, o.day14_enabled, o.day30_enabled
        from records x
        join orgs o on o.org_id = x.org_id
        join fh_clients cl on cl.id = x.client_id
       -- A customer nobody can reach gets no reminder.
       where nullif(btrim(coalesce(cl.phone, '')), '') is not null
          or nullif(btrim(coalesce(cl.email, '')), '') is not null
    ),
    picked as (
      select sc.*,
             case
               when sc.days_quiet >= sc.day30_days and sc.day30_enabled then 'day30'
               when sc.days_quiet >= sc.day14_days and sc.day14_enabled then 'day14'
               when sc.days_quiet >= sc.day7_days  and sc.day7_enabled  then 'day7'
               when sc.days_quiet >= sc.day3_days  and sc.day3_enabled  then 'day3'
             end as kind,
             case
               when sc.days_quiet >= sc.day30_days and sc.day30_enabled then sc.day30_days
               when sc.days_quiet >= sc.day14_days and sc.day14_enabled then sc.day14_days
               when sc.days_quiet >= sc.day7_days  and sc.day7_enabled  then sc.day7_days
               when sc.days_quiet >= sc.day3_days  and sc.day3_enabled  then sc.day3_days
             end as tier_days,
             case
               when sc.company is not null then 'Hi ' || sc.name || ', this is ' || sc.company || '. '
               else 'Hi ' || sc.name || '. '
             end as greeting
        from scored sc
    )
    select p.*
      from picked p
     where p.kind is not null
       and p.recipient is not null
       -- A tier is raised in the two weeks after its day, never months late.
       and p.days_quiet <= p.tier_days + 14
       -- Not again for this record since its anchor moved (a reminder raised
       -- on the anchor day itself belongs to the cycle before it; the
       -- shortest tier is days later). A record the migration moved keeps
       -- the history of its old fh_contacts row.
       and not exists (
         select 1 from fh_follow_ups f
          where f.kind = p.kind
            and (f.created_at at time zone p.tz)::date > p.anchor_on
            and (   (p.lead_id  is not null and f.lead_id  = p.lead_id)
                 or (p.quote_id is not null and f.quote_id = p.quote_id)
                 or (p.origin_contact_id is not null and f.contact_id = p.origin_contact_id))
       )
     order by p.org_id, p.recipient, p.days_quiet desc, p.created_at
  loop
    -- One open reminder per client and kind (the 091 index). Another record
    -- of the same client holds this kind: wait for it to close.
    if exists (
      select 1 from fh_follow_ups f
       where f.status = 'queued' and f.client_id = r.client_id and f.kind = r.kind
         and coalesce(f.lead_id, f.quote_id) is distinct from coalesce(r.lead_id, r.quote_id)
    ) then
      v_waiting := v_waiting + 1;
      continue;
    end if;

    -- The daily cap per person.
    select count(*) into v_today_count
      from fh_follow_ups f
     where f.user_id = r.recipient and f.org_id = r.org_id and f.kind <> 'review_ask'
       and (f.created_at at time zone r.tz)::date = r.today;
    if v_today_count >= r.max_new_per_day then
      v_capped := v_capped + 1;
      continue;
    end if;

    begin
      -- A newer reminder for the same record replaces the older one.
      update fh_follow_ups f
         set status = 'skipped', closed_reason = 'superseded', completed_at = now()
       where f.status = 'queued'
         and (   (r.lead_id  is not null and f.lead_id  = r.lead_id)
              or (r.quote_id is not null and f.quote_id = r.quote_id));
      get diagnostics v_rows = row_count;

      v_id := null;
      insert into fh_follow_ups
        (org_id, contact_id, lead_id, quote_id, client_id, user_id, kind, channel, due_on, status,
         headline, draft_body, stage_at_queue, days_quiet, anchor_on)
      values (
        r.org_id, null, r.lead_id, r.quote_id, r.client_id, r.recipient, r.kind,
        case when r.kind = 'day7' and r.has_phone then 'call'
             when r.kind = 'day30' or not r.has_phone then 'email'
             else 'text' end,
        r.today, 'queued',
        case r.kind
          when 'day3'  then 'Day 3 touch: '          || r.name
          when 'day7'  then 'Day 7 call: '           || r.name
          when 'day14' then 'Day 14 close out ask: ' || r.name
          when 'day30' then 'Day 30 revival: '       || r.name
        end,
        case
          when r.kind = 'day7' then
            'Call ' || r.name || '. ' || r.days_quiet::text || ' days quiet now. One '
            || 'question to get answered: is this still something you want done this '
            || 'season, or has the timing moved? Both answers are useful.'
          when r.record = 'lead' and r.kind = 'day3' then
            r.greeting
            || 'Thanks for reaching out about your project. I would like to come '
            || 'take a look and get you a number. What day works for you?'
          when r.record = 'lead' and r.kind = 'day14' then
            r.greeting
            || 'I do not want to keep bugging you, so let me ask it straight. '
            || 'Should I close out your request for now, or do you still want me '
            || 'to come take a look? Either answer works for me.'
          when r.record = 'lead' and r.kind = 'day30' then
            r.greeting
            || 'It has been about a month since you reached out about your project. '
            || 'If you are still thinking about it, I can come take a look and put '
            || 'numbers together. No pressure either way. If the timing passed, just '
            || 'say so and I will leave you to it.'
          when r.stage = 'changes_requested' and r.kind = 'day3' then
            r.greeting
            || 'I have not forgotten the changes you asked for on the quote. '
            || 'I will have the updated numbers over to you shortly.'
          when r.kind = 'day3' then
            r.greeting
            || 'Just making sure that estimate reached you alright. Any questions '
            || 'on it, text me back and I will get you an answer today.'
          when r.kind = 'day14' then
            r.greeting
            || 'I do not want to keep bugging you, so let me ask it straight. '
            || 'Should I close out your file for now, or is this still live on your '
            || 'end? Either answer works for me.'
          when r.kind = 'day30' then
            r.greeting
            || 'It has been about a month since we talked about your project. My '
            || 'schedule and material prices have both moved since then, so if you '
            || 'are still considering it I can put fresh numbers together for you. '
            || 'No pressure either way. If the timing passed, just say so and I '
            || 'will leave you to it.'
        end,
        r.stage, r.days_quiet, r.anchor_on
      )
      on conflict do nothing
      returning id into v_id;

      if v_id is null then
        -- Something else holds the slot. Undo the supersede above.
        raise exception using errcode = 'FH409', message = 'slot taken';
      end if;

      insert into fh_notifications (user_id, org_id, kind, title, body, link, follow_up_id)
      select f.user_id, f.org_id, 'follow_up_due', f.headline, f.draft_body,
             case when f.lead_id is not null then '/leads/' || f.lead_id::text else '/quotes/' || f.quote_id::text end,
             f.id
        from fh_follow_ups f where f.id = v_id;

      if r.lead_id is not null then
        update fh_leads l set follow_up_on = r.today
         where l.id = r.lead_id and (l.follow_up_on is null or l.follow_up_on > r.today);
      end if;

      v_pipeline := v_pipeline + 1;
      v_superseded := v_superseded + v_rows;
    exception when sqlstate 'FH409' then
      v_waiting := v_waiting + 1;
    end;
  end loop;

  -- Review asks: one per finished job, one per client per 180 days.
  for r in
    select distinct on (coalesce(c.client_id::text, c.id::text))
           c.id, c.org_id, c.client_id, c.name, c.stage,
           nullif(btrim(rtrim(btrim(coalesce(s.from_name, '')), '.')), '') as company,
           nullif(btrim(s.review_link), '') as review_link,
           (now() at time zone fh_org_tz(c.org_id))::date as today,
           ((now() at time zone fh_org_tz(c.org_id))::date - (c.completed_at at time zone fh_org_tz(c.org_id))::date)::integer as days_since,
           nullif(btrim(coalesce(cl.phone, '')), '') is not null as has_phone,
           coalesce(
             (select m.user_id from org_members m
               where m.org_id = c.org_id and m.user_id = c.user_id and m.revoked_at is null limit 1),
             (select m.user_id from org_members m
               where m.org_id = c.org_id and m.revoked_at is null and m.role = 'owner'
               order by m.joined_at limit 1)
           ) as recipient
      from fh_contacts c
      join fh_follow_up_settings s on s.org_id = c.org_id and s.enabled and s.review_ask_enabled
      left join fh_clients cl on cl.id = c.client_id
     where c.completed_at is not null
       and c.completed_at >= now() - interval '45 days'
       and c.stage in ('job', 'closed')
       and (p_org_id is null or c.org_id = p_org_id)
       and (cl.id is null
            or nullif(btrim(coalesce(cl.phone, '')), '') is not null
            or nullif(btrim(coalesce(cl.email, '')), '') is not null)
       and not exists (select 1 from fh_follow_ups f where f.contact_id = c.id and f.kind = 'review_ask')
       and not exists (
         select 1 from fh_follow_ups f
          where c.client_id is not null and f.client_id = c.client_id
            and f.kind = 'review_ask' and f.created_at >= now() - interval '180 days')
     order by coalesce(c.client_id::text, c.id::text), c.completed_at desc
  loop
    continue when r.recipient is null;
    v_id := null;
    insert into fh_follow_ups
      (org_id, contact_id, client_id, user_id, kind, channel, due_on, status,
       headline, draft_body, stage_at_queue, days_quiet, anchor_on)
    values (
      r.org_id, r.id, r.client_id, r.recipient, 'review_ask',
      case when r.has_phone then 'text' else 'email' end, r.today, 'queued',
      'Ask ' || r.name || ' for a review',
      case when r.company is not null then 'Hi ' || r.name || ', this is ' || r.company || '. '
           else 'Hi ' || r.name || '. ' end
      || 'Thank you again for trusting us with that job. If you were happy with '
      || 'how it turned out, a quick review helps a small company more than you '
      || 'would guess. It takes about a minute'
      || case when r.review_link is null then '.' else ': ' || r.review_link end
      || case when r.review_link is null
              then ' Paste your Google review link here before you send this.'
              else '' end,
      r.stage, r.days_since, r.today
    )
    on conflict do nothing
    returning id into v_id;
    if v_id is not null then
      insert into fh_notifications (user_id, org_id, kind, title, body, link, follow_up_id)
      select f.user_id, f.org_id, 'review_ask_due', f.headline, f.draft_body, '/jobs/' || f.contact_id::text, f.id
        from fh_follow_ups f where f.id = v_id;
      v_review := v_review + 1;
    end if;
  end loop;

  return jsonb_build_object(
    'ran_at',             now(),
    'scope',              coalesce(p_org_id::text, 'all enabled orgs'),
    'pipeline_queued',    v_pipeline,
    'review_asks_queued', v_review,
    'superseded',         v_superseded,
    'waiting_on_client',  v_waiting,
    'held_by_daily_cap',  v_capped,
    'reconciled',         v_heal
  );
end;
$function$;

-- ---------------------------------------------------------------------------
-- 6. Done and Dismiss
--    The guards of 20261101020547 (member of the notification's company, the
--    notification is locked) are kept. The follow up is found through the
--    link; rows from before the link fall back to the old match.
-- ---------------------------------------------------------------------------
create or replace function public.fh_follow_up_set_status(p_notification_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_note   record;
  v_record uuid;
  v_fu_id  uuid;
  v_lead   uuid;
  v_status text;
begin
  if p_status is null or p_status not in ('done', 'dismissed') then
    raise exception 'fh_follow_up_set_status: status must be done or dismissed, got %', coalesce(p_status, 'null');
  end if;
  select id, user_id, org_id, title, link, follow_up_id into v_note
    from public.fh_notifications where id = p_notification_id for update;
  if v_note.id is null then
    raise exception 'fh_follow_up_set_status: notification % not found', p_notification_id;
  end if;
  if auth.uid() is null or v_note.user_id is distinct from auth.uid()
     or (v_note.org_id is not null and not public.fh_is_org_member(v_note.org_id)) then
    raise exception 'fh_follow_up_set_status: notification % does not belong to the caller', p_notification_id;
  end if;

  v_fu_id := v_note.follow_up_id;
  if v_fu_id is null then
    begin
      v_record := nullif(regexp_replace(coalesce(v_note.link, ''), '^.*/', ''), '')::uuid;
    exception when others then
      v_record := null;
    end;
    if v_record is not null then
      select f.id into v_fu_id
        from public.fh_follow_ups f
       where (f.contact_id = v_record or f.lead_id = v_record or f.quote_id = v_record)
         and f.org_id is not distinct from v_note.org_id
         and (v_note.org_id is not null or f.user_id = auth.uid())
         and f.headline = v_note.title
         and f.status = 'queued'
       order by f.created_at desc
       limit 1;
    end if;
  end if;

  v_status := case p_status when 'done' then 'done' else 'skipped' end;
  if v_fu_id is not null then
    update public.fh_follow_ups f
       set status = v_status, completed_at = now(), completed_by = auth.uid(), closed_reason = p_status
     where f.id = v_fu_id
       and f.status = 'queued'
       and f.org_id is not distinct from v_note.org_id
       and (v_note.org_id is not null or f.user_id = auth.uid())
    returning f.lead_id into v_lead;

    -- Done means the customer was contacted: the lead's quiet clock starts over.
    if p_status = 'done' and v_lead is not null then
      update public.fh_leads l
         set last_contact = (now() at time zone public.fh_org_tz(l.org_id))::date
       where l.id = v_lead and l.status = 'open';
    end if;
  end if;

  update public.fh_notifications set read_at = coalesce(read_at, now()) where id = p_notification_id;
end;
$function$;

-- ---------------------------------------------------------------------------
-- 7. What the notifications screen reads: the caller's open reminders, with
--    the client to group by and the phone or email to reach them. Security
--    definer so it does not depend on the row policies of fh_follow_ups; it
--    only ever returns the caller's own.
-- ---------------------------------------------------------------------------
create or replace function public.fh_my_open_reminders()
returns table (
  notification_id uuid, follow_up_id uuid, kind text, record_kind text, record_id uuid, link text,
  client_id uuid, client_name text, client_phone text, headline text, draft_body text, channel text,
  due_on date, days_quiet integer, created_at timestamptz, read_at timestamptz, client_email text
)
language sql
stable
security definer
set search_path to 'pg_catalog', 'public'
as $function$
  select n.id, f.id, f.kind,
         case when f.lead_id is not null then 'lead' when f.quote_id is not null then 'quote' else 'job' end,
         coalesce(f.lead_id, f.quote_id, f.contact_id), n.link,
         f.client_id, cl.name, cl.phone, f.headline, f.draft_body, f.channel,
         f.due_on, f.days_quiet, n.created_at, n.read_at, cl.email
    from public.fh_notifications n
    join public.fh_follow_ups f on f.id = n.follow_up_id
    left join public.fh_clients cl on cl.id = f.client_id
   where n.user_id = auth.uid()
     and f.status = 'queued'
     and n.org_id in (select public.auth_user_org_ids())
   order by cl.name nulls last, f.client_id, f.due_on desc, n.created_at desc
$function$;

-- ---------------------------------------------------------------------------
-- 8. Grants
-- ---------------------------------------------------------------------------
revoke all on function public.fh_follow_ups_before_status()          from public, anon, authenticated;
revoke all on function public.fh_follow_ups_after_close()            from public, anon, authenticated;
revoke all on function public.fh_follow_ups_before_delete()          from public, anon, authenticated;
revoke all on function public.fh_follow_up_close(text, uuid, uuid, uuid, text[]) from public, anon, authenticated;
revoke all on function public.fh_leads_close_follow_ups()            from public, anon, authenticated;
revoke all on function public.fh_quotes_close_follow_ups()           from public, anon, authenticated;
revoke all on function public.fh_quotes_new_closes_lead_follow_ups() from public, anon, authenticated;
revoke all on function public.fh_contacts_close_follow_ups()         from public, anon, authenticated;
revoke all on function public.fh_follow_up_reconcile(boolean, uuid, integer) from public, anon, authenticated;
revoke all on function public.fh_run_follow_up_engine(uuid)          from public, anon, authenticated;
revoke all on function public.fh_follow_up_set_status(uuid, text)    from public, anon;
grant execute on function public.fh_follow_up_set_status(uuid, text) to authenticated;
revoke all on function public.fh_my_open_reminders()                 from public, anon;
grant execute on function public.fh_my_open_reminders()              to authenticated;
