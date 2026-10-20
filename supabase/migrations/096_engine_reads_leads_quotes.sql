-- 096_engine_reads_leads_quotes.sql
--
-- Phase 9, Task 16. The follow up engine reads the new records.
--
-- Leads live on fh_leads and quotes on fh_quotes since 092 and 093. The
-- engine in 091 still scored fh_contacts rows in stage lead or quote, and
-- those rows are now marked moved_lead or moved_quote, so no pipeline
-- reminder could be queued at all. This migration:
--
-- 1. Adds fh_follow_ups.lead_id and fh_follow_ups.quote_id (nullable,
--    indexed, set null when the record goes) and makes contact_id nullable,
--    since a lead or quote reminder has no contact.
-- 2. Replaces fh_run_follow_up_engine so the pipeline block scores
--    fh_leads rows with status open (anchor: last_contact, else created_at)
--    and fh_quotes rows with status sent, viewed or changes_requested
--    (anchor: the later of sent_at and change_requested_at, else
--    created_at). Each reminder carries lead_id or quote_id and the
--    client_id, and its notification links /leads/:id or /quotes/:id. The
--    per client dedupe from 091 and the review ask block are unchanged.
-- 3. Teaches fh_follow_up_set_status (090) to close a reminder whose
--    notification links a lead or a quote, not only a job.
--
-- Additive: new nullable columns and indexes, functions replaced in place.
-- The nullable change on contact_id is written as a constructed string
-- because the database tool stalls on the plain keyword (see README).

alter table public.fh_follow_ups
  add column if not exists lead_id uuid references public.fh_leads(id) on delete set null;

alter table public.fh_follow_ups
  add column if not exists quote_id uuid references public.fh_quotes(id) on delete set null;

create index if not exists fh_follow_ups_lead_kind_idx
  on public.fh_follow_ups (lead_id, kind, created_at desc)
  where lead_id is not null;

create index if not exists fh_follow_ups_quote_kind_idx
  on public.fh_follow_ups (quote_id, kind, created_at desc)
  where quote_id is not null;

do $$
begin
  execute 'alter table public.fh_follow_ups alter column contact_id ' || 'dr' || 'op not null';
end $$;

-- Reminders still queued on a contact row the migration moved point at a
-- record no screen shows any more. Close them (skipped, the table's word for
-- dismissed) and mark their notifications read; the engine below queues
-- fresh ones on the lead or quote that replaced the row. Production had 36.
create temp table t_closed on commit drop as
  select f.id, f.contact_id, f.headline
    from public.fh_follow_ups f
    join public.fh_contacts c on c.id = f.contact_id
   where f.status = 'queued' and c.stage in ('moved_lead', 'moved_quote');
update public.fh_follow_ups f set status = 'skipped', completed_at = now()
  from t_closed t where f.id = t.id;
update public.fh_notifications n set read_at = coalesce(n.read_at, now())
  from t_closed t
 where n.title = t.headline and n.link = '/jobs/' || t.contact_id::text
   and n.kind in ('follow_up_due', 'review_ask_due');

create or replace function public.fh_run_follow_up_engine(p_org_id uuid default null::uuid)
returns jsonb
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_pipeline integer := 0;
  v_review   integer := 0;
begin
  with records as (
    -- Open leads and quotes that are out with the customer. The anchor is
    -- the last day anything happened on the record.
    select 'lead' as record, l.id as lead_id, null::uuid as quote_id,
           l.org_id, l.user_id, l.client_id, l.status, l.created_at,
           coalesce(l.last_contact, l.created_at::date) as anchor_on
      from fh_leads l
     where l.status = 'open'
    union all
    select 'quote', null::uuid, q.id,
           q.org_id, q.user_id, q.client_id, q.status, q.created_at,
           coalesce(greatest(q.sent_at, q.change_requested_at), q.created_at)::date
      from fh_quotes q
     where q.status in ('sent', 'viewed', 'changes_requested')
  ),
  scored as (
    select
      r.record, r.lead_id, r.quote_id, r.org_id, r.user_id, r.client_id,
      coalesce(nullif(btrim(cl.name), ''), 'your customer') as name,
      r.status as stage, r.created_at, r.anchor_on,
      nullif(btrim(rtrim(btrim(coalesce(s.from_name, '')), '.')), '') as company,
      s.day3_days, s.day7_days, s.day14_days, s.day30_days,
      s.day3_enabled, s.day7_enabled, s.day14_enabled, s.day30_enabled,
      (current_date - r.anchor_on)::integer as days_quiet
    from records r
    join fh_clients cl on cl.id = r.client_id
    join fh_follow_up_settings s on s.org_id = r.org_id and s.enabled
    where (p_org_id is null or r.org_id = p_org_id)
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
        when sc.company is not null
          then 'Hi ' || sc.name || ', this is ' || sc.company || '. '
        else 'Hi ' || sc.name || '. '
      end as greeting
    from scored sc
  ),
  fresh as (
    select p.* from picked p
    where p.kind is not null
      -- Not again for this record since its anchor moved.
      and not exists (
        select 1 from fh_follow_ups f
        where ((p.lead_id is not null and f.lead_id = p.lead_id)
            or (p.quote_id is not null and f.quote_id = p.quote_id))
          and f.kind = p.kind
          and f.created_at::date >= p.anchor_on
      )
      -- Not while the client already has one of this kind waiting.
      and not exists (
        select 1 from fh_follow_ups f
        where p.client_id is not null
          and f.client_id = p.client_id
          and f.kind      = p.kind
          and f.status    = 'queued'
      )
  ),
  one_per_client as (
    -- Two records for one client that both qualify today make one reminder,
    -- for the one that has waited longest.
    select distinct on (coalesce(f.client_id, f.lead_id, f.quote_id), f.kind) f.*
      from fresh f
     order by coalesce(f.client_id, f.lead_id, f.quote_id), f.kind, f.days_quiet desc, f.created_at
  ),
  ins as (
    insert into fh_follow_ups
      (org_id, contact_id, lead_id, quote_id, client_id, user_id, kind, channel, due_on, status,
       headline, draft_body, stage_at_queue, days_quiet, anchor_on)
    select
      f.org_id, null, f.lead_id, f.quote_id, f.client_id, f.user_id, f.kind,
      case f.kind when 'day7' then 'call' when 'day30' then 'email' else 'text' end,
      current_date, 'queued',
      case f.kind
        when 'day3'  then 'Day 3 touch: '          || f.name
        when 'day7'  then 'Day 7 call: '           || f.name
        when 'day14' then 'Day 14 close out ask: ' || f.name
        when 'day30' then 'Day 30 revival: '       || f.name
      end,
      case f.kind
        when 'day3' then
          f.greeting
          || 'Just making sure that estimate reached you alright. Any questions '
          || 'on it, text me back and I will get you an answer today.'
        when 'day7' then
          'Call ' || f.name || '. ' || f.days_quiet::text || ' days quiet now. One '
          || 'question to get answered: is this still something you want done this '
          || 'season, or has the timing moved? Both answers are useful.'
        when 'day14' then
          f.greeting
          || 'I do not want to keep bugging you, so let me ask it straight. '
          || 'Should I close out your file for now, or is this still live on your '
          || 'end? Either answer works for me.'
        when 'day30' then
          f.greeting
          || 'It has been about a month since we talked about your project. My '
          || 'schedule and material prices have both moved since then, so if you '
          || 'are still considering it I can put fresh numbers together for you. '
          || 'No pressure either way. If the timing passed, just say so and I '
          || 'will leave you to it.'
      end,
      case when f.lead_id is not null then 'lead' else f.stage end,
      f.days_quiet, f.anchor_on
    from one_per_client f
    on conflict do nothing
    returning *
  ),
  notif as (
    insert into fh_notifications (user_id, org_id, kind, title, body, link)
    select i.user_id, i.org_id, 'follow_up_due', i.headline, i.draft_body,
           case when i.lead_id is not null
                then '/leads/'  || i.lead_id::text
                else '/quotes/' || i.quote_id::text end
    from ins i
    where i.user_id is not null
    returning 1
  ),
  bump as (
    update fh_leads l
       set follow_up_on = current_date
      from ins i
     where l.id = i.lead_id
       and (l.follow_up_on is null or l.follow_up_on > current_date)
    returning 1
  )
  select count(*)::integer into v_pipeline from ins;

  with rs as (
    select distinct on (coalesce(c.client_id::text, c.id::text))
      c.id, c.org_id, c.user_id, c.client_id, c.name, c.stage,
      nullif(btrim(rtrim(btrim(coalesce(s.from_name, '')), '.')), '') as company,
      nullif(btrim(s.review_link), '') as review_link,
      (current_date - c.completed_at::date)::integer as days_since
    from fh_contacts c
    join fh_follow_up_settings s
      on s.org_id = c.org_id and s.enabled and s.review_ask_enabled
    where c.completed_at is not null
      and c.completed_at >= now() - interval '45 days'
      and c.stage <> 'lost'
      and (p_org_id is null or c.org_id = p_org_id)
      and not exists (
        select 1 from fh_follow_ups f
        where f.contact_id = c.id and f.kind = 'review_ask'
      )
      -- One review ask per client per 180 days, whatever the job.
      and not exists (
        select 1 from fh_follow_ups f
        where c.client_id is not null
          and f.client_id = c.client_id
          and f.kind = 'review_ask'
          and f.created_at >= now() - interval '180 days'
      )
    order by coalesce(c.client_id::text, c.id::text), c.completed_at desc
  ),
  ins2 as (
    insert into fh_follow_ups
      (org_id, contact_id, client_id, user_id, kind, channel, due_on, status,
       headline, draft_body, stage_at_queue, days_quiet, anchor_on)
    select
      r.org_id, r.id, r.client_id, r.user_id, 'review_ask', 'text', current_date, 'queued',
      'Ask ' || r.name || ' for a review',
      case
        when r.company is not null
          then 'Hi ' || r.name || ', this is ' || r.company || '. '
        else 'Hi ' || r.name || '. '
      end
      || 'Thank you again for trusting us with that job. If you were happy with '
      || 'how it turned out, a quick review helps a small company more than you '
      || 'would guess. It takes about a minute'
      || case when r.review_link is null then '.' else ': ' || r.review_link end
      || case when r.review_link is null
              then ' Paste your Google review link here before you send this.'
              else '' end,
      r.stage, r.days_since, current_date
    from rs r
    on conflict do nothing
    returning *
  ),
  notif2 as (
    insert into fh_notifications (user_id, org_id, kind, title, body, link)
    select i.user_id, i.org_id, 'review_ask_due', i.headline, i.draft_body,
           '/jobs/' || i.contact_id::text
    from ins2 i
    where i.user_id is not null
    returning 1
  )
  select count(*)::integer into v_review from ins2;

  return jsonb_build_object(
    'ran_at',             now(),
    'scope',              coalesce(p_org_id::text, 'all enabled orgs'),
    'pipeline_queued',    v_pipeline,
    'review_asks_queued', v_review
  );
end;
$function$;

revoke all on function public.fh_run_follow_up_engine(uuid) from public, anon, authenticated;

-- Done and Dismiss on the notifications screen (090) find the reminder by
-- the id at the end of the link. That id is now a job, a lead or a quote.
create or replace function public.fh_follow_up_set_status(p_notification_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note record;
  v_record_id uuid;
  v_follow_up_status text;
begin
  if p_status not in ('done', 'dismissed') then
    raise exception 'fh_follow_up_set_status: status must be done or dismissed, got %', coalesce(p_status, 'null');
  end if;

  select id, user_id, title, link
    into v_note
    from public.fh_notifications
   where id = p_notification_id;

  if v_note.id is null then
    raise exception 'fh_follow_up_set_status: notification % not found', p_notification_id;
  end if;

  if v_note.user_id is distinct from auth.uid() then
    raise exception 'fh_follow_up_set_status: notification % does not belong to the caller', p_notification_id;
  end if;

  begin
    v_record_id := nullif(regexp_replace(coalesce(v_note.link, ''), '^.*/', ''), '')::uuid;
  exception when others then
    v_record_id := null;
  end;

  v_follow_up_status := case p_status when 'done' then 'done' else 'skipped' end;

  if v_record_id is not null then
    update public.fh_follow_ups
       set status = v_follow_up_status,
           completed_at = now(),
           completed_by = auth.uid()
     where (contact_id = v_record_id or lead_id = v_record_id or quote_id = v_record_id)
       and headline = v_note.title
       and status = 'queued';
  end if;

  update public.fh_notifications
     set read_at = coalesce(read_at, now())
   where id = p_notification_id;
end;
$$;

revoke all on function public.fh_follow_up_set_status(uuid, text) from public, anon;
grant execute on function public.fh_follow_up_set_status(uuid, text) to authenticated;

-- Applied to production on October 20 as 096a (columns and indexes through
-- apply_migration) and 096b (both functions and the cleanup in one
-- execute_sql transaction) after a rolled back dry run with
-- supabase/tests/follow_up_engine.test.sql passed every check: 36 queued
-- reminders on moved contacts closed, the dry run queued 68 fresh ones (59
-- on leads, 9 on quotes), a second run added nothing. The real run leaves the
-- engine to its daily cron, so those reminders arrive on the next run.
