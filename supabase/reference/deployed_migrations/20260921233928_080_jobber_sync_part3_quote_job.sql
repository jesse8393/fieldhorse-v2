-- 080_jobber_sync.sql (part 3 of 6: quote and job mirrors)
-- ---------------------------------------------------------------------------
-- 4c. quote
-- ---------------------------------------------------------------------------
create or replace function public.fh_jobber_apply_quote(p_integration uuid, p_obj jsonb, p_suppress boolean default false)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_ext text; v_client uuid; v_org uuid; v_contact uuid; v_title text; v_addr text; v_status text; v_total numeric; v_num text;
  c record; v_is_new boolean := false; v_sent_at timestamptz; v_prop text; v_qv uuid; v_approved boolean;
begin
  if p_suppress then perform set_config('fh.suppress_events', 'on', true); end if;
  v_ext := p_obj->>'id';
  if v_ext is null then raise exception 'quote id missing'; end if;
  v_client := public.fh_jobber_ref(p_integration, 'client', p_obj#>>'{client,id}');
  if v_client is null then return jsonb_build_object('skipped', 'client_missing', 'client_ext', p_obj#>>'{client,id}'); end if;
  select * into c from public.fh_clients where id = v_client;
  v_org := c.org_id;
  v_num := p_obj->>'quoteNumber';
  v_title := coalesce(nullif(btrim(coalesce(p_obj->>'title','')), ''), 'Quote' || coalesce(' #' || v_num, ''));
  v_addr := coalesce(public.fh_jobber_addr(p_obj#>'{property,address}'), c.address);
  v_status := upper(coalesce(p_obj->>'quoteStatus', ''));
  v_total := public.fh_jobber_num(p_obj#>>'{amounts,total}');
  v_sent_at := coalesce(public.fh_jobber_ts(p_obj->>'transitionedAt'), public.fh_jobber_ts(p_obj->>'updatedAt'), now());
  v_approved := v_status in ('APPROVED', 'CONVERTED');
  v_prop := case v_status when 'DRAFT' then 'draft' when 'AWAITING_RESPONSE' then 'sent' when 'CHANGES_REQUESTED' then 'changes_requested'
                          when 'APPROVED' then 'approved' when 'CONVERTED' then 'approved' when 'ARCHIVED' then 'expired' else null end;

  v_contact := public.fh_jobber_ref(p_integration, 'quote', v_ext);
  if v_contact is not null and not exists (select 1 from public.fh_contacts x where x.id = v_contact) then v_contact := null; end if;
  if v_contact is null then
    v_contact := public.fh_jobber_contact_for(p_integration, v_client, 'request', p_obj#>>'{request,id}', array['lead'], interval '120 days');
  end if;
  if v_contact is null then
    insert into public.fh_contacts (user_id, org_id, client_id, name, phone, email, address, job_title, stage, source, amount, created_at)
    values (public.fh_jobber_owner(v_org), v_org, v_client, c.name, c.phone, c.email, v_addr, v_title,
            case when v_status = 'DRAFT' then 'lead' when v_status = 'CONVERTED' then 'job' when v_status = 'ARCHIVED' then 'lost' else 'quote' end,
            'jobber', v_total, coalesce(public.fh_jobber_ts(p_obj->>'createdAt'), now()))
    returning id into v_contact;
    v_is_new := true;
  end if;

  update public.fh_contacts x
     set job_title = case when x.job_title is null or x.job_title in ('New lead', 'New request') then v_title else x.job_title end,
         amount = case when coalesce(v_total, 0) > 0 then v_total else x.amount end,
         address = coalesce(x.address, v_addr),
         proposal_status = coalesce(v_prop, x.proposal_status),
         quote_sent_at = case when v_status in ('AWAITING_RESPONSE', 'CHANGES_REQUESTED', 'APPROVED', 'CONVERTED') then coalesce(x.quote_sent_at, v_sent_at) else x.quote_sent_at end,
         quote_change_requested_at = case when v_status = 'CHANGES_REQUESTED' then coalesce(x.quote_change_requested_at, v_sent_at) else x.quote_change_requested_at end,
         quote_change_request_note = case when v_status = 'CHANGES_REQUESTED' then coalesce(x.quote_change_request_note, 'Changes requested in Jobber') else x.quote_change_request_note end,
         stage = case
                   when v_status = 'CONVERTED' and x.stage in ('lead', 'quote') then 'job'
                   when v_status in ('AWAITING_RESPONSE', 'CHANGES_REQUESTED', 'APPROVED') and x.stage = 'lead' then 'quote'
                   when v_status = 'ARCHIVED' and x.stage in ('lead', 'quote') then 'lost'
                   else x.stage end,
         updated_at = now()
   where x.id = v_contact;

  if v_approved and public.fh_jobber_ref(p_integration, 'quote_approval', v_ext) is null then
    insert into public.fh_quote_versions (user_id, org_id, contact_id, version_number, status, snapshot, base_total, approval_method, approved_by_name, approved_at)
    values (public.fh_jobber_owner(v_org), v_org, v_contact,
            (select coalesce(max(version_number), 0) + 1 from public.fh_quote_versions where contact_id = v_contact),
            'approved', jsonb_build_object('source', 'jobber', 'quote_id', v_ext, 'quote_number', v_num, 'total', v_total, 'title', v_title),
            coalesce(v_total, 0), 'esign_link', 'Approved in Jobber', v_sent_at)
    returning id into v_qv;
    perform public.fh_jobber_ref_set(p_integration, v_org, 'quote_approval', v_ext, 'fh_quote_versions', v_qv, v_num);
  end if;

  insert into public.fh_client_fields (client_id, org_id, key, value) values
    (v_client, v_org, 'jobber_quote_url', coalesce(to_jsonb(p_obj->>'jobberWebUri'), 'null'::jsonb)),
    (v_client, v_org, 'jobber_client_hub_url', coalesce(to_jsonb(p_obj->>'clientHubUri'), 'null'::jsonb))
  on conflict (client_id, key) do update set value = case when excluded.value = 'null'::jsonb then public.fh_client_fields.value else excluded.value end, updated_at = now();

  perform public.fh_jobber_ref_set(p_integration, v_org, 'quote', v_ext, 'fh_contacts', v_contact, v_num,
    jsonb_build_object('updatedAt', p_obj->>'updatedAt', 'status', v_status, 'total', v_total));
  return jsonb_build_object('contact_id', v_contact, 'client_id', v_client, 'org_id', v_org, 'is_new', v_is_new, 'status', v_status, 'approval_id', v_qv);
end $$;

-- ---------------------------------------------------------------------------
-- 4d. job
-- ---------------------------------------------------------------------------
create or replace function public.fh_jobber_apply_job(p_integration uuid, p_obj jsonb, p_suppress boolean default false, p_closed boolean default false)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_ext text; v_client uuid; v_org uuid; v_contact uuid; v_title text; v_addr text; v_status text; v_total numeric; v_num text;
  c record; v_is_new boolean := false; v_completed timestamptz; v_closed boolean; v_close uuid;
begin
  if p_suppress then perform set_config('fh.suppress_events', 'on', true); end if;
  v_ext := p_obj->>'id';
  if v_ext is null then raise exception 'job id missing'; end if;
  v_client := public.fh_jobber_ref(p_integration, 'client', p_obj#>>'{client,id}');
  if v_client is null then return jsonb_build_object('skipped', 'client_missing', 'client_ext', p_obj#>>'{client,id}'); end if;
  select * into c from public.fh_clients where id = v_client;
  v_org := c.org_id;
  v_num := p_obj->>'jobNumber';
  v_title := coalesce(nullif(btrim(coalesce(p_obj->>'title','')), ''), 'Job' || coalesce(' #' || v_num, ''));
  v_addr := coalesce(public.fh_jobber_addr(p_obj#>'{property,address}'), c.address);
  v_status := upper(coalesce(p_obj->>'jobStatus', ''));
  v_total := public.fh_jobber_num(p_obj->>'total');
  v_completed := public.fh_jobber_ts(p_obj->>'completedAt');
  -- closing a job in Jobber archives it; a history load treats archived and completed as closed
  v_closed := p_closed or (v_status = 'ARCHIVED' and v_completed is not null);

  v_contact := public.fh_jobber_ref(p_integration, 'job', v_ext);
  if v_contact is not null and not exists (select 1 from public.fh_contacts x where x.id = v_contact) then v_contact := null; end if;
  if v_contact is null then
    v_contact := public.fh_jobber_contact_for(p_integration, v_client, 'quote', p_obj#>>'{quote,id}', array['quote', 'lead'], interval '180 days');
  end if;
  if v_contact is null then
    insert into public.fh_contacts (user_id, org_id, client_id, name, phone, email, address, job_title, stage, source, amount, created_at)
    values (public.fh_jobber_owner(v_org), v_org, v_client, c.name, c.phone, c.email, v_addr, v_title, 'job', 'jobber', v_total,
            coalesce(public.fh_jobber_ts(p_obj->>'createdAt'), now()))
    returning id into v_contact;
    v_is_new := true;
  end if;

  update public.fh_contacts x
     set job_title = case when x.job_title is null or x.job_title in ('New lead', 'New request') or x.job_title like 'Quote%' then v_title else x.job_title end,
         amount = case when coalesce(v_total, 0) > 0 then v_total else x.amount end,
         address = coalesce(x.address, v_addr),
         stage = case when x.stage in ('lead', 'quote') then 'job' else x.stage end,
         updated_at = now()
   where x.id = v_contact;

  if v_completed is not null then
    update public.fh_contacts set completed_at = v_completed, updated_at = now() where id = v_contact and completed_at is null;
  end if;

  if v_closed then
    update public.fh_contacts set completed_at = coalesce(completed_at, v_completed, now()), updated_at = now() where id = v_contact and completed_at is null;
    select id into v_close from public.fh_closeouts where contact_id = v_contact;
    if v_close is null then
      insert into public.fh_closeouts (contact_id, user_id, org_id, closed_at, signoff_name, signoff_method, notes, final_amount)
      values (v_contact, public.fh_jobber_owner(v_org), v_org, coalesce(v_completed, now()), 'Closed in Jobber', 'verbal', 'Closed in Jobber' || coalesce(' (job #' || v_num || ')', ''),
              coalesce(v_total, (select amount from public.fh_contacts where id = v_contact), 0))
      returning id into v_close;
    end if;
    update public.fh_contacts set stage = 'closed', updated_at = now() where id = v_contact and stage = 'job';
    perform public.fh_jobber_ref_set(p_integration, v_org, 'job_closeout', v_ext, 'fh_closeouts', v_close, v_num);
  end if;

  insert into public.fh_client_fields (client_id, org_id, key, value) values
    (v_client, v_org, 'jobber_job_url', coalesce(to_jsonb(p_obj->>'jobberWebUri'), 'null'::jsonb))
  on conflict (client_id, key) do update set value = case when excluded.value = 'null'::jsonb then public.fh_client_fields.value else excluded.value end, updated_at = now();

  perform public.fh_jobber_ref_set(p_integration, v_org, 'job', v_ext, 'fh_contacts', v_contact, v_num,
    jsonb_build_object('updatedAt', p_obj->>'updatedAt', 'status', v_status, 'total', v_total, 'closed', v_closed));
  return jsonb_build_object('contact_id', v_contact, 'client_id', v_client, 'org_id', v_org, 'is_new', v_is_new, 'closed', v_closed, 'closeout_id', v_close);
end $$;

