-- 091_follow_up_engine_per_client.sql
--
-- Reminders run per client, not per deal (decision D63).
--
-- Until now fh_run_follow_up_engine scored every fh_contacts row on its
-- own. A customer with three job rows got three "Ask X for a review"
-- reminders, and a lead that was marked lost after a quote kept getting
-- "Day 30 revival" nudges. This migration:
--
-- 1. Adds fh_follow_ups.client_id (backfilled from the contact) and a
--    partial unique index so one client has at most one queued reminder
--    of each kind.
-- 2. Replaces the engine so it skips lost rows, picks one contact per
--    client and kind per run, refuses a kind the client already has
--    queued, and asks for a review at most once per client per 180 days.
-- 3. Closes the duplicates that already exist: every queued row except
--    the newest per client and kind, and every queued row on a lost
--    contact, becomes skipped (the table's word for dismissed), and its notification is marked read.
--
-- The engine body was fetched from production on 2026-10-19 (it had no
-- migration in this folder) and edited here, so this file is now the
-- source of record for it.

alter table public.fh_follow_ups
  add column if not exists client_id uuid references public.fh_clients(id) on delete set null;

update public.fh_follow_ups f
   set client_id = c.client_id
  from public.fh_contacts c
 where c.id = f.contact_id
   and f.client_id is null
   and c.client_id is not null;

create index if not exists fh_follow_ups_client_kind_idx
  on public.fh_follow_ups (client_id, kind, created_at desc);

-- Close the duplicates before the unique index can exist.
with ranked as (
  select f.id,
         row_number() over (partition by f.client_id, f.kind order by f.created_at desc) as rn
    from public.fh_follow_ups f
   where f.status = 'queued' and f.client_id is not null
),
lost as (
  select f.id from public.fh_follow_ups f
    join public.fh_contacts c on c.id = f.contact_id
   where f.status = 'queued' and c.stage = 'lost'
),
closing as (
  select id from ranked where rn > 1
  union
  select id from lost
),
done as (
  update public.fh_follow_ups f
     set status = 'skipped', completed_at = now()
    from closing
   where f.id = closing.id
  returning f.contact_id, f.headline
)
update public.fh_notifications n
   set read_at = coalesce(n.read_at, now())
  from done d
 where n.title = d.headline
   and n.link = '/jobs/' || d.contact_id::text
   and n.kind in ('follow_up_due', 'review_ask_due');

create unique index if not exists fh_follow_ups_one_open_per_client_kind_idx
  on public.fh_follow_ups (client_id, kind)
  where status = 'queued' and client_id is not null;

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
  with stage_entry as (
    select distinct on (t.contact_id, t.to_stage)
           t.contact_id, t.to_stage, t.transitioned_at
      from fh_stage_transitions t
     order by t.contact_id, t.to_stage, t.transitioned_at desc
  ),
  scored as (
    select
      c.id, c.org_id, c.user_id, c.client_id, c.name, c.stage, c.created_at,
      nullif(btrim(rtrim(btrim(coalesce(s.from_name, '')), '.')), '') as company,
      s.day3_days, s.day7_days, s.day14_days, s.day30_days,
      s.day3_enabled, s.day7_enabled, s.day14_enabled, s.day30_enabled,
      greatest(
        coalesce(c.last_contact, c.created_at::date),
        coalesce(se.transitioned_at::date, c.created_at::date)
      ) as anchor_on,
      (current_date - greatest(
        coalesce(c.last_contact, c.created_at::date),
        coalesce(se.transitioned_at::date, c.created_at::date)
      ))::integer as days_quiet
    from fh_contacts c
    join fh_follow_up_settings s on s.org_id = c.org_id and s.enabled
    left join stage_entry se on se.contact_id = c.id and se.to_stage = c.stage
    where c.stage in ('lead','quote')
      and (p_org_id is null or c.org_id = p_org_id)
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
      -- Not again for this deal since its anchor moved.
      and not exists (
        select 1 from fh_follow_ups f
        where f.contact_id = p.id
          and f.kind       = p.kind
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
    -- Two deals for one client that both qualify today make one reminder,
    -- for the one that has waited longest.
    select distinct on (coalesce(f.client_id::text, f.id::text), f.kind) f.*
      from fresh f
     order by coalesce(f.client_id::text, f.id::text), f.kind, f.days_quiet desc, f.created_at
  ),
  ins as (
    insert into fh_follow_ups
      (org_id, contact_id, client_id, user_id, kind, channel, due_on, status,
       headline, draft_body, stage_at_queue, days_quiet, anchor_on)
    select
      f.org_id, f.id, f.client_id, f.user_id, f.kind,
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
      f.stage, f.days_quiet, f.anchor_on
    from one_per_client f
    on conflict do nothing
    returning *
  ),
  notif as (
    insert into fh_notifications (user_id, org_id, kind, title, body, link)
    select i.user_id, i.org_id, 'follow_up_due', i.headline, i.draft_body,
           '/jobs/' || i.contact_id::text
    from ins i
    where i.user_id is not null
    returning 1
  ),
  bump as (
    update fh_contacts c
       set follow_up_on = current_date
      from ins i
     where c.id = i.contact_id
       and (c.follow_up_on is null or c.follow_up_on > current_date)
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
