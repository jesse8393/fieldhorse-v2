-- The quote link in the customer context (finding dead-ends-11).
--
-- fh_client_ctx hands the AI agent its client record (the automation worker
-- sends ctx.job to the model as CLIENT RECORD and renders the agent's system
-- prompt from the same context), and workflow messages render their
-- templates from it, so {{job.quote_link}} can reach a customer. It was built
-- as app_base_url || '/q/' || job id, a route the app does not have: a
-- customer who opened it landed on the contractor Sign in page.
--
-- quote_link is now the customer's own proposal link, /p/:token, the same
-- link send-quote.js emails: the newest one that is not revoked and not
-- expired, on the job or on the quote that became the job. With no such link
-- it is null, so nothing hands out a link that leads nowhere. The rest of the
-- function is unchanged from 20261101014840_growth_context_boundaries.sql.
--
-- Additive: create or replace keeps the grants; they are restated below for
-- a fresh build.

CREATE OR REPLACE FUNCTION public.fh_client_ctx(p_client_id uuid, p_contact_id uuid DEFAULT NULL::uuid, p_event jsonb DEFAULT '{}'::jsonb)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'pg_catalog', 'public'
AS $function$
declare
  v_c record; v_j record; v_cons record; v_tags jsonb; v_custom jsonb; v_company jsonb; v_set record;
  v_ctx jsonb; v_first text; v_last text; v_conv record; v_link text;
begin
  select * into v_c from public.fh_clients where id = p_client_id;
  if v_c.id is null then return jsonb_build_object('now', now()); end if;
  perform public.fh_assert_growth_context(v_c.org_id, p_client_id, p_contact_id);
  select * into v_set from public.fh_org_settings where org_id = v_c.org_id;
  select coalesce(jsonb_agg(tag order by tag), '[]'::jsonb) into v_tags from public.fh_client_tags where client_id = p_client_id;
  select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) into v_custom from public.fh_client_fields where client_id = p_client_id;
  select * into v_cons from public.fh_consent where client_id = p_client_id;
  select * into v_conv from public.fh_conversations where client_id = p_client_id and org_id = v_c.org_id;
  if p_contact_id is not null then
    select * into v_j from public.fh_contacts where id = p_contact_id;
  else
    select * into v_j from public.fh_contacts where client_id = p_client_id and org_id = v_c.org_id
     order by case stage when 'lead' then 0 when 'quote' then 1 when 'job' then 2 when 'closed' then 3 else 4 end, updated_at desc
     limit 1;
  end if;
  -- The customer's proposal link for this job: on the job itself, or on the
  -- quote that became it, in this company, still open, newest first.
  if v_j.id is not null then
    select l.token into v_link
      from public.fh_public_links l
     where l.kind = 'proposal'
       and l.revoked_at is null
       and (l.expires_at is null or l.expires_at > now())
       and (l.org_id is null or l.org_id = v_c.org_id)
       and (l.contact_id = v_j.id
            or l.quote_id in (select q.id from public.fh_quotes q where q.job_id = v_j.id and q.org_id = v_c.org_id))
     order by l.created_at desc
     limit 1;
  end if;
  v_company := public.fh_org_ctx(v_c.org_id);
  v_first := public.fh_first_name(v_c.name);
  v_last := nullif(btrim(substr(btrim(coalesce(v_c.name,'')), length(coalesce(v_first,'')) + 1)), '');

  v_ctx := jsonb_build_object(
    'now', now(),
    'client', jsonb_build_object(
      'id', v_c.id, 'name', v_c.name, 'first_name', v_first, 'last_name', v_last,
      'phone', v_c.phone, 'email', v_c.email, 'address', v_c.address, 'company_name', v_c.company_name,
      'source', v_c.source, 'notes', v_c.notes, 'created_at', v_c.created_at, 'last_activity_at', v_c.last_activity_at,
      'lifetime_value', v_c.total_lifetime_value, 'active_jobs', v_c.active_jobs_count,
      'tags', v_tags, 'custom', v_custom,
      'consent', jsonb_build_object('sms', coalesce(v_cons.sms_status,'unknown'), 'email', coalesce(v_cons.email_status,'unknown'), 'calls', coalesce(v_cons.calls_status,'unknown'), 'dnd', coalesce(v_cons.dnd_all,false)),
      'conversation', jsonb_build_object('id', v_conv.id, 'status', v_conv.status, 'assigned_to', v_conv.assigned_to,
        'last_inbound_at', v_conv.last_inbound_at, 'last_outbound_at', v_conv.last_outbound_at, 'unread', v_conv.unread_count)
    ),
    'job', case when v_j.id is null then '{}'::jsonb else jsonb_build_object(
      'id', v_j.id, 'title', v_j.job_title, 'type', v_j.job_type, 'stage', v_j.stage, 'amount', v_j.amount,
      'address', coalesce(v_j.address, v_c.address), 'source', v_j.source,
      'quote_sent_at', v_j.quote_sent_at, 'quote_expires_at', v_j.quote_expires_at, 'completed_at', v_j.completed_at,
      'follow_up_on', v_j.follow_up_on, 'created_at', v_j.created_at, 'updated_at', v_j.updated_at,
      'quote_link', case when v_link is not null then coalesce(v_set.app_base_url,'https://fieldhorse.app') || '/p/' || v_link end
    ) end,
    'company', v_company,
    'event', coalesce(p_event, '{}'::jsonb),
    'links', jsonb_build_object(
      'booking', v_company->>'booking_url',
      'review', v_company->>'review_link'
    ),
    -- flat aliases for short merge fields
    'first_name', coalesce(v_first, 'there'),
    'last_name', coalesce(v_last, ''),
    'name', v_c.name,
    'phone', v_c.phone,
    'email', v_c.email,
    'address', coalesce(v_j.address, v_c.address),
    'company_name', v_company->>'name',
    'company_phone', v_company->>'phone',
    'owner_first_name', v_company->>'owner_first_name',
    'review_link', v_company->>'review_link',
    'booking_link', v_company->>'booking_url'
  );
  return v_ctx;
end $function$;

revoke all on function public.fh_client_ctx(uuid,uuid,jsonb) from public,anon,authenticated;
grant execute on function public.fh_client_ctx(uuid,uuid,jsonb) to service_role;
