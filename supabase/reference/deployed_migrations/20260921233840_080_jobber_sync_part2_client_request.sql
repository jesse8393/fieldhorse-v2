-- 080_jobber_sync.sql (part 2 of 6: client and request mirrors)
-- ---------------------------------------------------------------------------
-- 4a. client
-- ---------------------------------------------------------------------------
create or replace function public.fh_jobber_apply_client(p_integration uuid, p_obj jsonb, p_suppress boolean default false)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_org uuid; v_ext text; v_client uuid; v_name text; v_phone text; v_sms boolean; v_email text; v_addr text;
  v_tags text[]; v_tag text; r record; v_is_new boolean := false; v_cons record; v_meta jsonb; v_consent_in boolean;
begin
  if p_suppress then perform set_config('fh.suppress_events', 'on', true); end if;
  v_ext := p_obj->>'id';
  if v_ext is null then raise exception 'client id missing'; end if;
  select coalesce(array_agg(t->>'label'), '{}'::text[]) into v_tags
    from jsonb_array_elements(coalesce(p_obj#>'{tags,nodes}', '[]'::jsonb)) t where t->>'label' is not null;
  v_org := public.fh_jobber_org_for(p_integration, v_tags);
  select metadata into v_meta from public.fh_integrations where id = p_integration;
  v_consent_in := coalesce((v_meta->>'consent_from_jobber')::boolean, false);

  v_name := nullif(btrim(coalesce(p_obj->>'name', '')), '');
  if v_name is null then v_name := nullif(btrim(concat_ws(' ', p_obj->>'firstName', p_obj->>'lastName')), ''); end if;
  if coalesce((p_obj->>'isCompany')::boolean, false) and nullif(btrim(coalesce(p_obj->>'companyName','')), '') is not null then
    v_name := btrim(p_obj->>'companyName');
  end if;
  v_name := coalesce(v_name, nullif(btrim(coalesce(p_obj->>'companyName','')), ''), 'Jobber client');

  select e->>'number', coalesce((e->>'smsAllowed')::boolean, true) into v_phone, v_sms
    from jsonb_array_elements(coalesce(p_obj->'phones', '[]'::jsonb)) e
   where public.fh_normalize_phone(e->>'number') is not null
   order by coalesce((e->>'primary')::boolean, false) desc, (upper(coalesce(e->>'description','')) = 'MOBILE') desc, coalesce((e->>'smsAllowed')::boolean, false) desc
   limit 1;
  select e->>'address' into v_email
    from jsonb_array_elements(coalesce(p_obj->'emails', '[]'::jsonb)) e
   where public.fh_normalize_email(e->>'address') is not null
   order by coalesce((e->>'primary')::boolean, false) desc limit 1;
  v_addr := public.fh_jobber_addr(p_obj->'billingAddress');
  if v_addr is null then
    select public.fh_jobber_addr(n->'address') into v_addr
      from jsonb_array_elements(coalesce(p_obj#>'{clientProperties,nodes}', p_obj#>'{properties,nodes}', '[]'::jsonb)) n limit 1;
  end if;

  v_client := public.fh_jobber_ref(p_integration, 'client', v_ext);
  if v_client is not null and not exists (select 1 from public.fh_clients c where c.id = v_client) then v_client := null; end if;
  if v_client is null then
    select * into r from public.fh_resolve_client(v_org, v_phone, v_email, v_name, v_addr, 'jobber');
    v_client := r.client_id; v_is_new := r.is_new;
  end if;

  update public.fh_clients c
     set name = v_name,
         company_name = coalesce(nullif(btrim(coalesce(p_obj->>'companyName','')), ''), c.company_name),
         phone = coalesce(public.fh_normalize_phone(v_phone), c.phone),
         email = coalesce(public.fh_normalize_email(v_email), c.email),
         address = coalesce(v_addr, c.address),
         source = coalesce(c.source, 'jobber'),
         last_activity_at = greatest(coalesce(c.last_activity_at, 'epoch'::timestamptz), coalesce(public.fh_jobber_ts(p_obj->>'updatedAt'), now())),
         updated_at = now()
   where c.id = v_client;

  insert into public.fh_client_fields (client_id, org_id, key, value) values
    (v_client, v_org, 'jobber_client_id', to_jsonb(v_ext)),
    (v_client, v_org, 'jobber_url', coalesce(to_jsonb(p_obj->>'jobberWebUri'), 'null'::jsonb)),
    (v_client, v_org, 'jobber_is_lead', coalesce(to_jsonb((p_obj->>'isLead')::boolean), 'false'::jsonb)),
    (v_client, v_org, 'jobber_archived', coalesce(to_jsonb((p_obj->>'isArchived')::boolean), 'false'::jsonb))
  on conflict (client_id, key) do update set value = excluded.value, updated_at = now();

  -- tags: Jobber owns the tags it created; tags added inside the engine stay
  delete from public.fh_client_tags t
   where t.client_id = v_client and t.source = 'jobber'
     and not (t.tag = any (select public.fh_slugify(x) from unnest(v_tags) x));
  foreach v_tag in array v_tags loop
    perform public.fh_tag_add(v_org, v_client, v_tag, 'jobber');
  end loop;

  -- consent: a phone marked "SMS not allowed" in Jobber is never texted. Opting a
  -- client in from Jobber is a choice (metadata.consent_from_jobber), off by default.
  select * into v_cons from public.fh_consent where client_id = v_client;
  if v_phone is not null then
    if v_sms = false then
      if coalesce(v_cons.sms_status, 'unknown') <> 'opted_out' then
        perform public.fh_consent_set(v_org, v_client, 'sms', 'opted_out', 'jobber_sms_not_allowed');
      end if;
    elsif v_consent_in and coalesce(v_cons.sms_status, 'unknown') = 'unknown' then
      perform public.fh_consent_set(v_org, v_client, 'sms', 'opted_in', 'jobber_sms_allowed');
    end if;
  end if;
  if v_email is not null and coalesce(v_cons.email_status, 'unknown') = 'unknown' then
    perform public.fh_consent_set(v_org, v_client, 'email', 'opted_in', 'jobber');
  end if;

  perform public.fh_jobber_ref_set(p_integration, v_org, 'client', v_ext, 'fh_clients', v_client, null,
    jsonb_build_object('updatedAt', p_obj->>'updatedAt', 'isLead', p_obj->>'isLead'));
  return jsonb_build_object('client_id', v_client, 'org_id', v_org, 'is_new', v_is_new);
end $$;

-- ---------------------------------------------------------------------------
-- 4b. request (a lead)
-- ---------------------------------------------------------------------------
create or replace function public.fh_jobber_apply_request(p_integration uuid, p_obj jsonb, p_suppress boolean default false)
returns jsonb
language plpgsql security definer
set search_path = pg_catalog, public
as $$
declare
  v_ext text; v_client uuid; v_org uuid; v_contact uuid; v_title text; v_addr text; v_status text; v_is_new boolean := false;
  c record; v_details text; v_appt uuid;
begin
  if p_suppress then perform set_config('fh.suppress_events', 'on', true); end if;
  v_ext := p_obj->>'id';
  if v_ext is null then raise exception 'request id missing'; end if;
  v_client := public.fh_jobber_ref(p_integration, 'client', p_obj#>>'{client,id}');
  if v_client is null then return jsonb_build_object('skipped', 'client_missing', 'client_ext', p_obj#>>'{client,id}'); end if;
  select * into c from public.fh_clients where id = v_client;
  v_org := c.org_id;
  v_title := coalesce(nullif(btrim(coalesce(p_obj->>'title','')), ''), 'New request');
  v_addr := coalesce(public.fh_jobber_addr(p_obj#>'{property,address}'), c.address);
  v_status := upper(coalesce(p_obj->>'requestStatus', ''));
  v_details := nullif(btrim(concat_ws(E'\n', p_obj->>'details', p_obj->>'note', p_obj->>'notes')), '');

  v_contact := public.fh_jobber_ref(p_integration, 'request', v_ext);
  if v_contact is not null and not exists (select 1 from public.fh_contacts x where x.id = v_contact) then v_contact := null; end if;
  if v_contact is null then
    -- a lead that already came in through a form or a call in the last week is the same opportunity
    select x.id into v_contact from public.fh_contacts x
     where x.client_id = v_client and x.stage = 'lead' and x.created_at > now() - interval '7 days'
       and not exists (select 1 from public.fh_external_refs r where r.local_table = 'fh_contacts' and r.local_id = x.id)
     order by x.created_at desc limit 1;
    if v_contact is null then
      insert into public.fh_contacts (user_id, org_id, client_id, name, phone, email, address, job_title, stage, source, notes, created_at)
      values (public.fh_jobber_owner(v_org), v_org, v_client, c.name, c.phone, c.email, v_addr, v_title, 'lead', 'jobber', v_details,
              coalesce(public.fh_jobber_ts(p_obj->>'createdAt'), now()))
      returning id into v_contact;
      v_is_new := true;
    else
      update public.fh_contacts set job_title = coalesce(nullif(job_title, 'New lead'), v_title), address = coalesce(address, v_addr),
             notes = coalesce(notes, v_details), updated_at = now() where id = v_contact;
    end if;
    if v_is_new then
      perform public.fh_emit_event(v_org, 'lead.captured', v_client, v_contact,
        jsonb_build_object('via', 'jobber', 'source', 'jobber', 'is_new', true, 'name', c.name, 'phone', c.phone, 'email', c.email,
                           'message', v_title, 'request_id', v_ext, 'request_url', p_obj->>'jobberWebUri'),
        'jobber', 'lead.captured:jobber:' || v_ext);
    end if;
  else
    update public.fh_contacts set job_title = case when job_title is null or job_title in ('New lead','New request') then v_title else job_title end,
           address = coalesce(address, v_addr), notes = coalesce(notes, v_details), updated_at = now()
     where id = v_contact;
  end if;

  if v_status = 'ARCHIVED' then
    update public.fh_contacts set stage = 'lost', updated_at = now() where id = v_contact and stage = 'lead';
  end if;

  -- an on site assessment scheduled from the request is an estimate appointment
  if p_obj#>>'{assessment,startAt}' is not null then
    v_appt := public.fh_jobber_upsert_appointment(p_integration, v_org, 'assessment', coalesce(p_obj#>>'{assessment,id}', 'request:' || v_ext),
      v_client, v_contact, null, public.fh_jobber_ts(p_obj#>>'{assessment,startAt}'), public.fh_jobber_ts(p_obj#>>'{assessment,endAt}'),
      v_addr, 'Estimate visit: ' || v_title, p_obj#>>'{assessment,completedAt}' is not null, false);
  end if;

  perform public.fh_jobber_ref_set(p_integration, v_org, 'request', v_ext, 'fh_contacts', v_contact, null,
    jsonb_build_object('updatedAt', p_obj->>'updatedAt', 'status', v_status));
  return jsonb_build_object('contact_id', v_contact, 'client_id', v_client, 'org_id', v_org, 'is_new', v_is_new, 'appointment_id', v_appt);
end $$;

