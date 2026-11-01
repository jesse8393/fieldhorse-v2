-- 080_jobber_sync.sql (part 6 of 6: daily sweep bounds, grants)
-- ---------------------------------------------------------------------------
-- 6. daily sweep bounds
-- ---------------------------------------------------------------------------
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
       and i.due_at > now() - interval '90 days'
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
       and c.quote_sent_at > now() - interval '30 days'
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

-- ---------------------------------------------------------------------------
-- 7. grants
-- ---------------------------------------------------------------------------
do $$
declare f text;
begin
  -- service role only
  foreach f in array array[
    'fh_jobber_owner(uuid)', 'fh_jobber_ref(uuid, text, text)', 'fh_jobber_ref_set(uuid, uuid, text, text, text, uuid, text, jsonb)',
    'fh_jobber_org_for(uuid, text[])', 'fh_jobber_visit_booking_type(uuid)', 'fh_jobber_contact_for(uuid, uuid, text, text, text[], interval)',
    'fh_jobber_upsert_appointment(uuid, uuid, text, text, uuid, uuid, uuid, timestamptz, timestamptz, text, text, boolean, boolean)',
    'fh_jobber_apply_client(uuid, jsonb, boolean)', 'fh_jobber_apply_request(uuid, jsonb, boolean)', 'fh_jobber_apply_quote(uuid, jsonb, boolean)',
    'fh_jobber_apply_job(uuid, jsonb, boolean, boolean)', 'fh_jobber_apply_invoice(uuid, jsonb, boolean)', 'fh_jobber_apply_visit(uuid, jsonb, boolean)',
    'fh_jobber_apply(uuid, text, jsonb, jsonb)', 'fh_jobber_oauth_state_take(text)',
    'fh_jobber_connection_upsert(uuid, uuid, text, text, text, text, text, timestamptz, jsonb)', 'fh_jobber_tokens_get(uuid)',
    'fh_jobber_tokens_set(uuid, text, text, timestamptz)', 'fh_jobber_refresh_lease(uuid, integer)', 'fh_jobber_mark_error(uuid, text, text)',
    'fh_jobber_disconnect(uuid, text)', 'fh_jobber_integration_for_account(text)', 'fh_jobber_integration_for_org(uuid)',
    'fh_jobber_events_enqueue(text, text, text, text, timestamptz, jsonb)', 'fh_jobber_events_claim(integer, text)',
    'fh_jobber_event_finish(uuid, text, text, jsonb)', 'fh_jobber_sync_state_set(uuid, jsonb)', 'fh_jobber_kick(text, jsonb)',
    'fh_jobber_sync_lease(uuid, integer)', 'fh_jobber_account_claim(text)', 'fh_jobber_drain_tick()',
    'fh_daily_sweep()'
  ] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
    execute format('grant execute on function public.%s to service_role', f);
  end loop;
  -- pure helpers
  foreach f in array array['fh_jobber_addr(jsonb)', 'fh_jobber_ts(text)', 'fh_jobber_num(text)', 'fh_jobber_redirect_uri()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
  -- app facing (guarded inside)
  foreach f in array array['fh_jobber_connect_start(uuid, text)', 'fh_jobber_status(uuid)', 'fh_jobber_settings_set(uuid, jsonb)', 'fh_jobber_sync_request(uuid, text)'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated, service_role', f);
  end loop;
end $$;

