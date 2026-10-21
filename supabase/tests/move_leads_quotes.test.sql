-- move_leads_quotes.test.sql
--
-- Checks for migration 093. Run as: begin; <093 body>; <this file>; rollback;
-- Every row should read ok = true. The counts in the last rows are the
-- before and after picture; keep the production printout in PROGRESS.md.

select 'no lead or quote rows left' as check,
       (select count(*) from public.fh_contacts where stage in ('lead','quote')) = 0 as ok
union all select 'every moved row has a new record',
       (select count(*) from public.fh_contacts c where c.stage = 'moved_lead'
          and not exists (select 1 from public.fh_leads l where l.origin_contact_id = c.id)) = 0
   and (select count(*) from public.fh_contacts c where c.stage = 'moved_quote'
          and not exists (select 1 from public.fh_quotes q where q.origin_contact_id = c.id)) = 0
union all select 'every new record points home',
       (select count(*) from public.fh_leads  where origin_contact_id is null) = 0
   and (select count(*) from public.fh_quotes where origin_contact_id is null) = 0
union all select 'lost jobs stayed lost jobs',
       (select count(*) from public.fh_contacts c where c.stage = 'lost'
          and not exists (select 1 from public.fh_stage_transitions t where t.contact_id = c.id and t.to_stage in ('job','closed','invoice'))) = 0
union all select 'quote lines carry quote_id',
       (select count(*) from public.fh_quote_items i join public.fh_contacts c on c.id = i.contact_id
         where c.stage = 'moved_quote' and i.quote_id is null) = 0
union all select 'quote amounts match their lines',
       (select count(*) from public.fh_quotes q
         where exists (select 1 from public.fh_quote_items i where i.quote_id = q.id)
           and q.amount <> (select coalesce(sum(amount),0) from public.fh_quote_items i
                             where i.quote_id = q.id and not i.is_optional and not i.is_excluded)) = 0
union all select 'proposal links carry quote_id',
       (select count(*) from public.fh_public_links l join public.fh_contacts c on c.id = l.contact_id
         where c.stage = 'moved_quote' and l.kind = 'proposal' and l.quote_id is null) = 0
union all select 'visits and notes on movers carry a pointer',
       (select count(*) from public.fh_schedule s join public.fh_contacts c on c.id = s.contact_id
         where c.stage in ('moved_lead','moved_quote') and s.quote_id is null and s.lead_id is null) = 0
   and (select count(*) from public.fh_notes n join public.fh_contacts c on c.id = n.contact_id
         where c.stage in ('moved_lead','moved_quote') and n.quote_id is null and n.lead_id is null) = 0
union all select 'invoices know their client',
       (select count(*) from public.fh_invoices i join public.fh_contacts c on c.id = i.contact_id
         where i.client_id is null and c.client_id is not null) = 0
union all select 'no stage transition logged for the move',
       (select count(*) from public.fh_stage_transitions where to_stage like 'moved_%') = 0
union all select 'no event emitted for the move',
       (select count(*) from public.fh_events where type = 'stage.changed' and payload->>'to' like 'moved_%') = 0
union all select 'triggers back on',
       (select bool_and(tgenabled <> 'D') from pg_trigger where tgrelid = 'public.fh_contacts'::regclass
          and tgname in ('fh_ev_contacts_trg','fh_stage_transitions_log'))
union all select 'client counts exclude moved rows',
       (select count(*) from public.fh_clients cl
         where cl.active_jobs_count <>
           (select count(*) from public.fh_contacts c where c.client_id = cl.id and c.stage in ('job','invoice'))
         + (select count(*) from public.fh_leads l where l.client_id = cl.id and l.status = 'open')
         + (select count(*) from public.fh_quotes q where q.client_id = cl.id and q.job_id is null
              and q.status in ('draft','sent','viewed','changes_requested','approved'))) = 0
union all select 'after: contacts by stage ' || (select string_agg(stage || '=' || n, ' ') from (select stage, count(*) n from public.fh_contacts group by stage order by stage) s), true
union all select 'after: leads by status ' || (select string_agg(status || '=' || n, ' ') from (select status, count(*) n from public.fh_leads group by status order by status) s), true
union all select 'after: quotes by status ' || (select string_agg(status || '=' || n, ' ') from (select status, count(*) n from public.fh_quotes group by status order by status) s), true
union all select 'after: items with quote_id ' || (select count(*) from public.fh_quote_items where quote_id is not null), true
union all select 'after: links with quote_id ' || (select count(*) from public.fh_public_links where quote_id is not null), true
union all select 'after: invoices with client_id ' || (select count(*) from public.fh_invoices where client_id is not null) || ' of ' || (select count(*) from public.fh_invoices), true;
