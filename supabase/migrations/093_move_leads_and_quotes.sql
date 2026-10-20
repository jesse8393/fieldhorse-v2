-- 093_move_leads_and_quotes.sql
--
-- Move leads and quotes out of fh_contacts into fh_leads and fh_quotes
-- (decisions D53 to D56). Jobs stay where they are. Nothing is deleted:
-- every moved deal row keeps its data and reads stage 'moved_lead' or
-- 'moved_quote', which no screen shows and no list query returns. The
-- new row points back at it through origin_contact_id, so old links
-- redirect (Task 7) and this file can be reversed by hand.
--
-- Order of work, all in one transaction:
-- 1. fh_clients_recompute learns about the new tables and ignores moved
--    rows. fh_leads and fh_quotes get the same aggregate trigger.
-- 2. Two triggers on fh_contacts are paused while rows are marked moved:
--    the event emitter (a move is not a stage change a customer or a
--    webhook should hear about) and the stage transition log (the history
--    of the real stages stays as it was).
-- 3. Lead rows become fh_leads (status open). Quote rows become
--    fh_quotes with the status copied from proposal_status. Lost rows
--    that were never a job become a lost lead, or a lost quote when they
--    have lines or were sent. Lost jobs stay lost jobs.
-- 4. Everything that hung off a moved quote gets quote_id: lines,
--    versions, proposal links, esign envelopes, visits and notes. Visits
--    and notes on a moved lead get lead_id.
-- 5. fh_invoices.client_id is backfilled from the job.
--
-- A row with no client gets one through fh_resolve_client (match by
-- phone or email in the same org, else a new client from the row). On
-- October 19 production had none such; the branch exists for safety.
--
-- Applied to production on October 20 in four pieces (093a to 093d in
-- supabase_migrations.schema_migrations): the two functions and the two
-- triggers of section 1 one at a time, then sections 2 to 5 as one
-- transaction through execute_sql. apply_migration stalled on bodies with
-- a create trigger in them; see supabase/README.md. The dry run (the same
-- transaction ending in rollback, with supabase/tests/move_leads_quotes.test.sql)
-- and the real run both reported every check ok and these counts:
--   contacts by stage   closed=62 job=31 moved_lead=70 moved_quote=32
--   leads by status     lost=6 open=64
--   quotes by status    changes_requested=1 draft=14 lost=7 sent=10
--   items with quote_id 70
--   invoices with client_id 66 of 66

-- 1. Client aggregates --------------------------------------------------------

create or replace function public.fh_clients_recompute(p_client_id uuid)
returns void
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  if p_client_id is null then return; end if;
  update public.fh_clients c
  set
    active_jobs_count = coalesce(agg.active_count, 0)
                      + coalesce((select count(*) from public.fh_leads  l where l.client_id = p_client_id and l.status = 'open'), 0)
                      + coalesce((select count(*) from public.fh_quotes q where q.client_id = p_client_id
                                   and q.status in ('draft','sent','viewed','changes_requested','approved') and q.job_id is null), 0),
    total_lifetime_value = coalesce(agg.ltv, 0),
    last_activity_at = greatest(
      coalesce(agg.last_at, c.last_activity_at),
      (select max(updated_at) from public.fh_leads  l where l.client_id = p_client_id),
      (select max(updated_at) from public.fh_quotes q where q.client_id = p_client_id)
    ),
    updated_at = now()
  from (
    select
      count(*) filter (where stage in ('job','invoice')) as active_count,
      coalesce(sum(amount) filter (where stage in ('job','invoice','closed')), 0) as ltv,
      max(updated_at) filter (where stage not in ('moved_lead','moved_quote')) as last_at
    from public.fh_contacts
    where client_id = p_client_id
  ) agg
  where c.id = p_client_id;
end $$;

create or replace function public.fh_clients_on_record_change()
returns trigger
language plpgsql
set search_path to 'pg_catalog', 'public'
as $$
begin
  if tg_op = 'DELETE' then
    perform public.fh_clients_recompute(old.client_id);
    return old;
  end if;
  perform public.fh_clients_recompute(new.client_id);
  if tg_op = 'UPDATE' and new.client_id is distinct from old.client_id then
    perform public.fh_clients_recompute(old.client_id);
  end if;
  return new;
end $$;

drop trigger if exists fh_clients_aggregate on public.fh_leads;
create trigger fh_clients_aggregate after insert or update or delete on public.fh_leads
  for each row execute function public.fh_clients_on_record_change();
drop trigger if exists fh_clients_aggregate on public.fh_quotes;
create trigger fh_clients_aggregate after insert or update or delete on public.fh_quotes
  for each row execute function public.fh_clients_on_record_change();

-- 2. Pause the two triggers that would misread a move ------------------------

alter table public.fh_contacts disable trigger fh_ev_contacts_trg;
alter table public.fh_contacts disable trigger fh_stage_transitions_log;

-- 3. The move ----------------------------------------------------------------

create temp table t_movers on commit drop as
  select c.id, c.org_id, c.user_id, c.client_id, c.name, c.phone, c.email, c.address,
         c.job_title, c.job_type, c.notes, c.source, c.referred_by, c.stage,
         c.scope_text, c.terms_text, c.exclusions_text, c.amount, c.proposal_status,
         c.quote_sent_at, c.quote_expires_at, c.quote_change_request_note,
         c.quote_change_requested_at, c.approved_quote_version_id,
         c.follow_up_on, c.last_contact, c.created_at, c.updated_at,
         case
           when c.stage = 'lead' then 'lead'
           when c.stage = 'quote' then 'quote'
           when c.quote_sent_at is not null
             or exists (select 1 from public.fh_quote_items i where i.contact_id = c.id) then 'quote'
           else 'lead'
         end as target
    from public.fh_contacts c
   where c.stage in ('lead', 'quote')
      or (c.stage = 'lost' and not exists (
            select 1 from public.fh_stage_transitions t
             where t.contact_id = c.id and t.to_stage in ('job', 'closed', 'invoice')));

-- Any mover without a client gets one.
do $$
declare r record; v_client uuid; v_new boolean;
begin
  for r in select * from t_movers where client_id is null and org_id is not null loop
    select client_id, is_new into v_client, v_new
      from public.fh_resolve_client(r.org_id, r.phone, r.email, r.name, r.address, coalesce(r.source, 'inbound'));
    update t_movers set client_id = v_client where id = r.id;
    update public.fh_contacts set client_id = v_client where id = r.id;
  end loop;
end $$;

insert into public.fh_leads
  (org_id, user_id, client_id, title, notes, source, referred_by, job_type, status,
   follow_up_on, last_contact, origin_contact_id, created_at, updated_at)
select m.org_id, m.user_id, m.client_id, m.job_title, m.notes, m.source, m.referred_by, m.job_type,
       case when m.stage = 'lost' then 'lost' else 'open' end,
       m.follow_up_on, m.last_contact, m.id, m.created_at, m.updated_at
  from t_movers m
 where m.target = 'lead' and m.client_id is not null;

insert into public.fh_quotes
  (org_id, user_id, client_id, title, job_type, scope_text, terms_text, exclusions_text, amount, status,
   sent_at, expires_at, change_request_note, change_requested_at, approved_version_id,
   origin_contact_id, created_at, updated_at)
select m.org_id, m.user_id, m.client_id, m.job_title, m.job_type, m.scope_text, m.terms_text, m.exclusions_text,
       coalesce(m.amount, 0),
       case when m.stage = 'lost' then 'lost' else coalesce(m.proposal_status, 'draft') end,
       m.quote_sent_at, m.quote_expires_at, m.quote_change_request_note, m.quote_change_requested_at,
       m.approved_quote_version_id, m.id, m.created_at, m.updated_at
  from t_movers m
 where m.target = 'quote' and m.client_id is not null;

-- 4. Repoint what hung off them ----------------------------------------------

update public.fh_quote_items i set quote_id = q.id
  from public.fh_quotes q where q.origin_contact_id = i.contact_id and i.quote_id is null;
update public.fh_quote_versions v set quote_id = q.id
  from public.fh_quotes q where q.origin_contact_id = v.contact_id and v.quote_id is null;
update public.fh_public_links l set quote_id = q.id
  from public.fh_quotes q where q.origin_contact_id = l.contact_id and l.quote_id is null and l.kind = 'proposal';
update public.fh_esign_envelopes e set quote_id = q.id
  from public.fh_quotes q where q.origin_contact_id = e.contact_id and e.quote_id is null;
update public.fh_schedule s set quote_id = q.id
  from public.fh_quotes q where q.origin_contact_id = s.contact_id and s.quote_id is null;
update public.fh_notes n set quote_id = q.id
  from public.fh_quotes q where q.origin_contact_id = n.contact_id and n.quote_id is null;
update public.fh_schedule s set lead_id = l.id
  from public.fh_leads l where l.origin_contact_id = s.contact_id and s.lead_id is null;
update public.fh_notes n set lead_id = l.id
  from public.fh_leads l where l.origin_contact_id = n.contact_id and n.lead_id is null;

-- Mark the old rows. Only rows that got a new record are marked.
update public.fh_contacts c set stage = 'moved_lead'
  from public.fh_leads l where l.origin_contact_id = c.id and c.stage in ('lead', 'lost');
update public.fh_contacts c set stage = 'moved_quote'
  from public.fh_quotes q where q.origin_contact_id = c.id and c.stage in ('quote', 'lost');

alter table public.fh_contacts enable trigger fh_ev_contacts_trg;
alter table public.fh_contacts enable trigger fh_stage_transitions_log;

-- 5. Invoices know their client ---------------------------------------------

update public.fh_invoices i set client_id = c.client_id
  from public.fh_contacts c where c.id = i.contact_id and i.client_id is null and c.client_id is not null;

-- Refresh every client's counts once under the new definition.
do $$
declare r record;
begin
  for r in select id from public.fh_clients loop
    perform public.fh_clients_recompute(r.id);
  end loop;
end $$;
