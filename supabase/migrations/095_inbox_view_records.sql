-- 095_inbox_view_records.sql
--
-- Phase 9, Task 15. The Inbox reads the client's newest record.
--
-- fh_v_inbox reported latest_stage from the client's newest fh_contacts
-- row. Since 093 moved leads and quotes out of fh_contacts, that row is
-- either a job or a row marked moved_lead or moved_quote, so the chip
-- on an Inbox row was wrong for every customer who only has a lead or a
-- quote. The view now also reports which record the client touched
-- last, across the four tables (D53):
--
--   latest_record     lead, quote, job or invoice; null when the client
--                     has none
--   latest_record_id  that record's id
--
-- latest_stage stays, but it ignores moved rows (D56), so it is a job
-- stage or null. Every column the view had is kept, in its order, with
-- the two new columns appended, as create or replace view requires. The
-- body below is the production view fetched on October 20 with the one
-- subquery changed and the two columns added.

create or replace view public.fh_v_inbox as
select
  c.id as conversation_id,
  c.org_id,
  c.client_id,
  cl.name as client_name,
  cl.phone,
  cl.email,
  cl.company_name,
  c.status,
  c.assigned_to,
  c.starred,
  c.unread_count,
  c.last_message_at,
  c.last_inbound_at,
  c.last_outbound_at,
  c.last_channel,
  c.last_preview,
  c.snoozed_until,
  (
    select coalesce(jsonb_agg(t.tag order by t.tag), '[]'::jsonb)
    from public.fh_client_tags t
    where t.client_id = c.client_id
  ) as tags,
  (
    select j.stage
    from public.fh_contacts j
    where j.client_id = c.client_id
      and j.stage not in ('moved_lead', 'moved_quote')
    order by j.updated_at desc
    limit 1
  ) as latest_stage,
  (
    select count(*)
    from public.fh_agent_runs ar
    where ar.conversation_id = c.id and ar.status = 'proposed'
  ) as pending_drafts,
  (
    select count(*)
    from public.fh_messages m
    where m.conversation_id = c.id and m.status = 'held'
  ) as held_messages,
  newest.kind as latest_record,
  newest.id as latest_record_id
from public.fh_conversations c
join public.fh_clients cl on cl.id = c.client_id
left join lateral (
  select r.kind, r.id
  from (
    select 'lead'::text as kind, l.id, l.updated_at
    from public.fh_leads l
    where l.client_id = c.client_id
    union all
    select 'quote'::text, q.id, q.updated_at
    from public.fh_quotes q
    where q.client_id = c.client_id
    union all
    select 'job'::text, j.id, j.updated_at
    from public.fh_contacts j
    where j.client_id = c.client_id
      and j.stage not in ('moved_lead', 'moved_quote')
    union all
    select 'invoice'::text, i.id, i.updated_at
    from public.fh_invoices i
    where i.client_id = c.client_id
  ) r
  order by r.updated_at desc nulls last
  limit 1
) newest on true;

-- Applied to production on October 20 through apply_migration; the view
-- body above was read from the live definition first, so every existing
-- column keeps its place and only latest_record and latest_record_id are
-- appended.
