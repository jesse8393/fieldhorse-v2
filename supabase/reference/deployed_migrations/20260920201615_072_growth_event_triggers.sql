-- =============================================================================
-- 072_growth_event_triggers.sql
-- AFTER triggers on existing Fieldhorse tables that emit growth events.
-- Every function swallows its own errors, and fh_emit_event returns without
-- writing unless fh_org_settings.engine_enabled is true for that org, so
-- tenants that never turned the engine on see zero behavior change.
-- =============================================================================

-- fh_clients: contact.created
create or replace function public.fh_ev_clients()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.fh_emit_event(new.org_id, 'contact.created', new.id, null,
      jsonb_build_object('name', new.name, 'phone', new.phone, 'email', new.email, 'source', new.source), 'clients');
  end if;
  return null;
exception when others then
  raise warning 'fh_ev_clients: %', sqlerrm; return null;
end $$;
drop trigger if exists fh_ev_clients_trg on public.fh_clients;
create trigger fh_ev_clients_trg after insert on public.fh_clients
for each row execute function public.fh_ev_clients();

-- fh_contacts (jobs): job.created, stage.changed, quote.sent, job.completed, job.won, job.lost
create or replace function public.fh_ev_contacts()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_client uuid;
begin
  v_client := new.client_id;
  if v_client is null then return null; end if;
  if tg_op = 'INSERT' then
    perform public.fh_emit_event(new.org_id, 'job.created', v_client, new.id,
      jsonb_build_object('title', new.job_title, 'type', new.job_type, 'stage', new.stage, 'amount', new.amount, 'source', new.source), 'jobs');
    return null;
  end if;
  if old.stage is distinct from new.stage then
    perform public.fh_emit_event(new.org_id, 'stage.changed', v_client, new.id,
      jsonb_build_object('from', old.stage, 'to', new.stage, 'title', new.job_title, 'type', new.job_type, 'amount', new.amount), 'jobs');
    if new.stage = 'job' and old.stage in ('lead','quote') then
      perform public.fh_emit_event(new.org_id, 'job.won', v_client, new.id, jsonb_build_object('amount', new.amount, 'title', new.job_title, 'type', new.job_type), 'jobs');
    elsif new.stage = 'lost' then
      perform public.fh_emit_event(new.org_id, 'job.lost', v_client, new.id, jsonb_build_object('amount', new.amount, 'title', new.job_title, 'from', old.stage), 'jobs');
    end if;
  end if;
  if old.quote_sent_at is null and new.quote_sent_at is not null then
    perform public.fh_emit_event(new.org_id, 'quote.sent', v_client, new.id,
      jsonb_build_object('amount', new.amount, 'title', new.job_title, 'expires_at', new.quote_expires_at), 'jobs');
  end if;
  if old.completed_at is null and new.completed_at is not null then
    perform public.fh_emit_event(new.org_id, 'job.completed', v_client, new.id,
      jsonb_build_object('amount', new.amount, 'title', new.job_title, 'type', new.job_type), 'jobs');
  end if;
  if old.quote_change_requested_at is distinct from new.quote_change_requested_at and new.quote_change_requested_at is not null then
    perform public.fh_emit_event(new.org_id, 'quote.change_requested', v_client, new.id,
      jsonb_build_object('note', new.quote_change_request_note, 'title', new.job_title), 'jobs');
  end if;
  return null;
exception when others then
  raise warning 'fh_ev_contacts: %', sqlerrm; return null;
end $$;
drop trigger if exists fh_ev_contacts_trg on public.fh_contacts;
create trigger fh_ev_contacts_trg after insert or update of stage, quote_sent_at, completed_at, quote_change_requested_at on public.fh_contacts
for each row execute function public.fh_ev_contacts();

-- fh_quote_versions: quote.approved
create or replace function public.fh_ev_quote_versions()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_client uuid;
begin
  if new.status = 'approved' then
    select client_id into v_client from public.fh_contacts where id = new.contact_id;
    if v_client is not null then
      perform public.fh_emit_event(new.org_id, 'quote.approved', v_client, new.contact_id,
        jsonb_build_object('quote_version_id', new.id, 'version', new.version_number, 'total', new.base_total, 'approved_by', new.approved_by_name), 'quotes',
        'quote.approved:' || new.id::text);
    end if;
  end if;
  return null;
exception when others then
  raise warning 'fh_ev_quote_versions: %', sqlerrm; return null;
end $$;
drop trigger if exists fh_ev_quote_versions_trg on public.fh_quote_versions;
create trigger fh_ev_quote_versions_trg after insert on public.fh_quote_versions
for each row execute function public.fh_ev_quote_versions();

-- fh_invoices: invoice.created, invoice.sent, invoice.paid, invoice.status_changed
create or replace function public.fh_ev_invoices()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_client uuid; v_payload jsonb;
begin
  select client_id into v_client from public.fh_contacts where id = new.contact_id;
  if v_client is null then return null; end if;
  v_payload := jsonb_build_object('invoice_id', new.id, 'number', new.sequence_number, 'amount', new.amount, 'status', new.status, 'due_at', new.due_at, 'title', new.title);
  if tg_op = 'INSERT' then
    perform public.fh_emit_event(new.org_id, 'invoice.created', v_client, new.contact_id, v_payload, 'invoices');
    return null;
  end if;
  if old.status is distinct from new.status then
    perform public.fh_emit_event(new.org_id, 'invoice.status_changed', v_client, new.contact_id, v_payload || jsonb_build_object('from', old.status), 'invoices');
    if new.status = 'paid' then
      perform public.fh_emit_event(new.org_id, 'invoice.paid', v_client, new.contact_id, v_payload, 'invoices', 'invoice.paid:' || new.id::text);
    elsif new.status in ('sent','issued') then
      perform public.fh_emit_event(new.org_id, 'invoice.sent', v_client, new.contact_id, v_payload, 'invoices', 'invoice.sent:' || new.id::text);
    end if;
  end if;
  return null;
exception when others then
  raise warning 'fh_ev_invoices: %', sqlerrm; return null;
end $$;
drop trigger if exists fh_ev_invoices_trg on public.fh_invoices;
create trigger fh_ev_invoices_trg after insert or update of status on public.fh_invoices
for each row execute function public.fh_ev_invoices();

-- fh_closeouts: job.closed (the review request moment)
create or replace function public.fh_ev_closeouts()
returns trigger
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_client uuid; v_title text;
begin
  select client_id, job_title into v_client, v_title from public.fh_contacts where id = new.contact_id;
  if v_client is not null then
    perform public.fh_emit_event(new.org_id, 'job.closed', v_client, new.contact_id,
      jsonb_build_object('closeout_id', new.id, 'final_amount', new.final_amount, 'title', v_title, 'closed_at', new.closed_at), 'closeouts',
      'job.closed:' || new.id::text);
  end if;
  return null;
exception when others then
  raise warning 'fh_ev_closeouts: %', sqlerrm; return null;
end $$;
drop trigger if exists fh_ev_closeouts_trg on public.fh_closeouts;
create trigger fh_ev_closeouts_trg after insert on public.fh_closeouts
for each row execute function public.fh_ev_closeouts();

-- Daily sweep: invoice.overdue (once per invoice) and quote.stale (no answer after N days)
create or replace function public.fh_daily_sweep()
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare inv record; q record; n_inv int := 0; n_q int := 0;
begin
  for inv in
    select i.*, c.client_id from public.fh_invoices i join public.fh_contacts c on c.id = i.contact_id
     where i.status not in ('paid','void','draft','cancelled') and i.due_at is not null and i.due_at < now()
       and public.fh_engine_enabled(i.org_id)
  loop
    if public.fh_emit_event(inv.org_id, 'invoice.overdue', inv.client_id, inv.contact_id,
         jsonb_build_object('invoice_id', inv.id, 'number', inv.sequence_number, 'amount', inv.amount, 'due_at', inv.due_at, 'days_overdue', (now()::date - inv.due_at::date)),
         'sweep', 'invoice.overdue:' || inv.id::text) is not null then
      n_inv := n_inv + 1;
    end if;
  end loop;

  for q in
    select c.* from public.fh_contacts c
     where c.stage = 'quote' and c.quote_sent_at is not null and c.quote_sent_at < now() - interval '3 days'
       and c.client_id is not null and public.fh_engine_enabled(c.org_id)
  loop
    if public.fh_emit_event(q.org_id, 'quote.stale', q.client_id, q.id,
         jsonb_build_object('amount', q.amount, 'title', q.job_title, 'days_since_sent', (now()::date - q.quote_sent_at::date)),
         'sweep', 'quote.stale:' || q.id::text) is not null then
      n_q := n_q + 1;
    end if;
  end loop;
  return jsonb_build_object('invoice_overdue', n_inv, 'quote_stale', n_q);
end $$;

revoke all on function public.fh_daily_sweep() from public, anon, authenticated;
grant execute on function public.fh_daily_sweep() to service_role;

