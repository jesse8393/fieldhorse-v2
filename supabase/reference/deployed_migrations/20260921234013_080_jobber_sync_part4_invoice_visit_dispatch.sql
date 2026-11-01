-- 080_jobber_sync.sql (part 4 of 6: invoice and visit mirrors, dispatcher)
-- ---------------------------------------------------------------------------
-- 4e. invoice
-- ---------------------------------------------------------------------------
create or replace function public.fh_jobber_apply_invoice(p_integration uuid, p_obj jsonb, p_suppress boolean default false)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_ext text; v_client uuid; v_org uuid; v_contact uuid; v_inv uuid; v_status text; v_mapped text; v_total numeric; v_balance numeric;
  v_num int; v_title text; c record; v_is_new boolean := false; v_due timestamptz; v_issued timestamptz; v_job_ext text; v_tz text;
begin
  if p_suppress then perform set_config('fh.suppress_events', 'on', true); end if;
  v_ext := p_obj->>'id';
  if v_ext is null then raise exception 'invoice id missing'; end if;
  v_client := public.fh_jobber_ref(p_integration, 'client', p_obj#>>'{client,id}');
  if v_client is null then return jsonb_build_object('skipped', 'client_missing', 'client_ext', p_obj#>>'{client,id}'); end if;
  select * into c from public.fh_clients where id = v_client;
  v_org := c.org_id;
  v_tz := public.fh_org_tz(v_org);
  v_status := upper(coalesce(p_obj->>'invoiceStatus', ''));
  v_total := coalesce(public.fh_jobber_num(p_obj#>>'{amounts,total}'), 0);
  v_balance := public.fh_jobber_num(p_obj#>>'{amounts,invoiceBalance}');
  v_mapped := case v_status when 'DRAFT' then 'draft' when 'AWAITING_PAYMENT' then 'sent' when 'PAST_DUE' then 'overdue'
                            when 'PAID' then 'paid' when 'BAD_DEBT' then 'void' else 'sent' end;
  if v_mapped in ('sent', 'overdue') and v_balance is not null and v_balance <= 0 and v_total > 0 then v_mapped := 'paid'; end if;
  v_num := (public.fh_jobber_num(p_obj->>'invoiceNumber'))::int;
  v_title := coalesce(nullif(btrim(coalesce(p_obj->>'subject','')), ''), 'Invoice' || coalesce(' #' || v_num::text, ''));
  v_due := case when p_obj->>'dueDate' is not null then ((p_obj->>'dueDate')::date + time '23:59') at time zone v_tz else null end;
  v_issued := coalesce(case when p_obj->>'issuedDate' is not null then ((p_obj->>'issuedDate')::date + time '09:00') at time zone v_tz else null end,
                       public.fh_jobber_ts(p_obj->>'createdAt'));

  v_inv := public.fh_jobber_ref(p_integration, 'invoice', v_ext);
  if v_inv is not null and not exists (select 1 from public.fh_invoices i where i.id = v_inv) then v_inv := null; end if;
  if v_inv is null then
    select coalesce(p_obj#>>'{jobs,nodes,0,id}', p_obj#>>'{linkedJobs,nodes,0,id}', p_obj#>>'{job,id}') into v_job_ext;
    v_contact := public.fh_jobber_contact_for(p_integration, v_client, 'job', v_job_ext, array['job', 'closed'], interval '365 days');
    if v_contact is null then
      select x.id into v_contact from public.fh_contacts x where x.client_id = v_client order by x.created_at desc limit 1;
    end if;
    if v_contact is null then
      insert into public.fh_contacts (user_id, org_id, client_id, name, phone, email, address, job_title, stage, source, amount, created_at)
      values (public.fh_jobber_owner(v_org), v_org, v_client, c.name, c.phone, c.email, c.address, v_title, 'job', 'jobber', v_total,
              coalesce(public.fh_jobber_ts(p_obj->>'createdAt'), now()))
      returning id into v_contact;
    end if;
    if v_num is null or exists (select 1 from public.fh_invoices i where i.contact_id = v_contact and i.sequence_number = v_num) then
      select coalesce(max(sequence_number), 0) + 1 into v_num from public.fh_invoices where contact_id = v_contact;
    end if;
    insert into public.fh_invoices (contact_id, user_id, org_id, sequence_number, title, amount, status, issued_at, due_at, notes, description, created_at)
    values (v_contact, public.fh_jobber_owner(v_org), v_org, v_num, v_title, v_total, v_mapped, v_issued, v_due,
            'Jobber invoice' || coalesce(' #' || (p_obj->>'invoiceNumber'), ''), p_obj->>'message', coalesce(public.fh_jobber_ts(p_obj->>'createdAt'), now()))
    returning id into v_inv;
    v_is_new := true;
  else
    select contact_id into v_contact from public.fh_invoices where id = v_inv;
    update public.fh_invoices i
       set amount = v_total, title = v_title, issued_at = coalesce(v_issued, i.issued_at), due_at = coalesce(v_due, i.due_at),
           description = coalesce(p_obj->>'message', i.description), updated_at = now()
     where i.id = v_inv;
    -- status last, on its own, so the invoice trigger sees one clean transition
    update public.fh_invoices set status = v_mapped, updated_at = now() where id = v_inv and status is distinct from v_mapped;
  end if;

  insert into public.fh_client_fields (client_id, org_id, key, value) values
    (v_client, v_org, 'jobber_invoice_url', coalesce(to_jsonb(p_obj->>'jobberWebUri'), 'null'::jsonb)),
    (v_client, v_org, 'jobber_client_hub_url', coalesce(to_jsonb(p_obj->>'clientHubUri'), 'null'::jsonb))
  on conflict (client_id, key) do update set value = case when excluded.value = 'null'::jsonb then public.fh_client_fields.value else excluded.value end, updated_at = now();

  perform public.fh_jobber_ref_set(p_integration, v_org, 'invoice', v_ext, 'fh_invoices', v_inv, p_obj->>'invoiceNumber',
    jsonb_build_object('updatedAt', p_obj->>'updatedAt', 'status', v_status, 'total', v_total, 'balance', v_balance));
  return jsonb_build_object('invoice_id', v_inv, 'contact_id', v_contact, 'client_id', v_client, 'org_id', v_org, 'is_new', v_is_new, 'status', v_mapped);
end $$;

-- ---------------------------------------------------------------------------
-- 4f. visit
-- ---------------------------------------------------------------------------
create or replace function public.fh_jobber_apply_visit(p_integration uuid, p_obj jsonb, p_suppress boolean default false)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_ext text; v_client uuid; v_org uuid; v_contact uuid; v_sched uuid; v_title text; v_addr text; v_status text;
  v_start timestamptz; v_end timestamptz; v_completed boolean; v_cancelled boolean; c record; v_is_new boolean := false; v_appt uuid; v_who text;
begin
  if p_suppress then perform set_config('fh.suppress_events', 'on', true); end if;
  v_ext := p_obj->>'id';
  if v_ext is null then raise exception 'visit id missing'; end if;
  v_client := public.fh_jobber_ref(p_integration, 'client', p_obj#>>'{client,id}');
  if v_client is null then return jsonb_build_object('skipped', 'client_missing', 'client_ext', p_obj#>>'{client,id}'); end if;
  select * into c from public.fh_clients where id = v_client;
  v_org := c.org_id;
  v_contact := public.fh_jobber_ref(p_integration, 'job', p_obj#>>'{job,id}');
  v_title := coalesce(nullif(btrim(coalesce(p_obj->>'title','')), ''), nullif(btrim(coalesce(p_obj#>>'{job,title}','')), ''), 'Visit');
  v_addr := coalesce(public.fh_jobber_addr(p_obj#>'{property,address}'), c.address);
  v_status := upper(coalesce(p_obj->>'visitStatus', ''));
  v_start := public.fh_jobber_ts(p_obj->>'startAt');
  v_end := public.fh_jobber_ts(p_obj->>'endAt');
  v_completed := public.fh_jobber_ts(p_obj->>'completedAt') is not null or coalesce((p_obj->>'isComplete')::boolean, false) or v_status = 'COMPLETED';
  v_cancelled := v_status in ('CANCELLED', 'CANCELED', 'ARCHIVED');
  select string_agg(coalesce(n#>>'{name,full}', n->>'name'), ', ') into v_who
    from jsonb_array_elements(coalesce(p_obj#>'{assignedUsers,nodes}', '[]'::jsonb)) n;

  v_sched := public.fh_jobber_ref(p_integration, 'visit', v_ext);
  if v_sched is not null and not exists (select 1 from public.fh_schedule s where s.id = v_sched) then v_sched := null; end if;
  if v_start is not null then
    if v_sched is null then
      insert into public.fh_schedule (user_id, org_id, contact_id, title, description, start_at, end_at)
      values (public.fh_jobber_owner(v_org), v_org, v_contact, v_title,
              nullif(concat_ws(E'\n', p_obj->>'instructions', case when v_who is not null then 'Assigned: ' || v_who end, 'Scheduled in Jobber'), ''),
              v_start, coalesce(v_end, v_start + interval '1 hour'))
      returning id into v_sched;
      v_is_new := true;
    else
      update public.fh_schedule s
         set title = v_title, start_at = v_start, end_at = coalesce(v_end, v_start + interval '1 hour'), contact_id = coalesce(v_contact, s.contact_id),
             description = nullif(concat_ws(E'\n', p_obj->>'instructions', case when v_who is not null then 'Assigned: ' || v_who end, 'Scheduled in Jobber'), '')
       where s.id = v_sched;
    end if;
    perform public.fh_jobber_ref_set(p_integration, v_org, 'visit', v_ext, 'fh_schedule', v_sched, null,
      jsonb_build_object('updatedAt', p_obj->>'updatedAt', 'status', v_status));
    v_appt := public.fh_jobber_upsert_appointment(p_integration, v_org, 'visit_appt', v_ext, v_client, v_contact, v_sched,
      v_start, v_end, v_addr, v_title, v_completed, v_cancelled);
  end if;
  return jsonb_build_object('schedule_id', v_sched, 'appointment_id', v_appt, 'contact_id', v_contact, 'client_id', v_client, 'org_id', v_org, 'is_new', v_is_new);
end $$;

-- ---------------------------------------------------------------------------
-- 4g. dispatcher
-- ---------------------------------------------------------------------------
create or replace function public.fh_jobber_apply(p_integration uuid, p_entity text, p_obj jsonb, p_opts jsonb default '{}'::jsonb)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare v_suppress boolean := coalesce((p_opts->>'suppress')::boolean, false); v_closed boolean := coalesce((p_opts->>'closed')::boolean, false); v_res jsonb;
begin
  if not exists (select 1 from public.fh_integrations i where i.id = p_integration and i.provider = 'jobber') then
    raise exception 'unknown jobber integration';
  end if;
  case p_entity
    when 'client' then v_res := public.fh_jobber_apply_client(p_integration, p_obj, v_suppress);
    when 'request' then v_res := public.fh_jobber_apply_request(p_integration, p_obj, v_suppress);
    when 'quote' then v_res := public.fh_jobber_apply_quote(p_integration, p_obj, v_suppress);
    when 'job' then v_res := public.fh_jobber_apply_job(p_integration, p_obj, v_suppress, v_closed);
    when 'invoice' then v_res := public.fh_jobber_apply_invoice(p_integration, p_obj, v_suppress);
    when 'visit' then v_res := public.fh_jobber_apply_visit(p_integration, p_obj, v_suppress);
    else raise exception 'unknown entity %', p_entity;
  end case;
  return coalesce(v_res, '{}'::jsonb) || jsonb_build_object('entity', p_entity);
end $$;

