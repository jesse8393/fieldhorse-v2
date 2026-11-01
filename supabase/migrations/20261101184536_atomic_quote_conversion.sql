-- One transaction owns the job, copied lines and quote pointer.
-- Invoker rights retain RLS at every read and write boundary.
create or replace function public.fh_make_job_from_quote(p_quote_id uuid)
returns uuid
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  v_quote public.fh_quotes;
  v_client public.fh_clients;
  v_job public.fh_contacts;
  v_items jsonb;
  v_total numeric;
  v_count integer;
begin
  if auth.uid() is null then
    raise exception 'Quote conversion requires an authenticated account' using errcode = '42501';
  end if;

  -- Retry and concurrent conversions of one quote serialize here.
  select * into v_quote from public.fh_quotes where id = p_quote_id for update;
  if not found then
    raise exception 'Quote unavailable or access revoked' using errcode = '42501';
  end if;
  if not (
    (v_quote.org_id is null and v_quote.user_id = auth.uid()) or
    (v_quote.org_id is not null and public.fh_is_org_member(v_quote.org_id)
      and public.fh_money_visible(v_quote.org_id))
  ) then
    raise exception 'Quote conversion requires financial permission' using errcode = '42501';
  end if;

  select * into v_client from public.fh_clients where id = v_quote.client_id for share;
  if not found or v_client.org_id is distinct from v_quote.org_id
    or (v_quote.org_id is null and v_client.user_id is distinct from auth.uid()) then
    raise exception 'Quote customer unavailable in this company' using errcode = '42501';
  end if;

  if v_quote.job_id is not null then
    select * into v_job from public.fh_contacts where id = v_quote.job_id;
    if not found or v_job.org_id is distinct from v_quote.org_id
      or v_job.client_id is distinct from v_quote.client_id then
      raise exception 'Linked job unavailable in this company' using errcode = '42501';
    end if;
    return v_job.id;
  end if;

  select coalesce(jsonb_agg(to_jsonb(i) order by i.sort_order, i.id), '[]'::jsonb)
    into v_items
    from (select * from public.fh_quote_items where quote_id = p_quote_id for share) i;
  if exists(select 1 from jsonb_populate_recordset(null::public.fh_quote_items, v_items) i
    where i.org_id is distinct from v_quote.org_id or i.contact_id is not null) then
    raise exception 'Quote contains invalid line associations' using errcode = '42501';
  end if;
  select coalesce(sum(i.amount), 0) into v_total
    from jsonb_populate_recordset(null::public.fh_quote_items, v_items) i
    where not i.is_optional and not i.is_excluded;

  insert into public.fh_contacts
    (user_id, org_id, client_id, stage, name, phone, email, address, job_title,
     job_type, scope_text, terms_text, exclusions_text, amount)
    values (auth.uid(), v_quote.org_id, v_quote.client_id, 'job', v_client.name,
      v_client.phone, v_client.email, v_client.address, v_quote.title, v_quote.job_type,
      v_quote.scope_text, v_quote.terms_text, v_quote.exclusions_text, v_total)
    returning * into v_job;
  if v_job.id is null or v_job.org_id is distinct from v_quote.org_id then
    raise exception 'Job creation could not be confirmed';
  end if;

  insert into public.fh_quote_items
    (user_id, org_id, contact_id, quote_id, description, qty, rate, amount,
     unit, section, notes, is_optional, is_excluded, sort_order)
    select auth.uid(), v_quote.org_id, v_job.id, null, i.description, i.qty,
      i.rate, i.amount, i.unit, i.section, i.notes, i.is_optional, i.is_excluded, i.sort_order
    from jsonb_populate_recordset(null::public.fh_quote_items, v_items) i;
  get diagnostics v_count = row_count;
  if v_count <> jsonb_array_length(v_items) then
    raise exception 'Quote line copy could not be confirmed';
  end if;

  update public.fh_quotes set job_id = v_job.id where id = p_quote_id;
  get diagnostics v_count = row_count;
  if v_count <> 1 then raise exception 'Quote link could not be confirmed'; end if;
  return v_job.id;
end;
$$;

revoke all on function public.fh_make_job_from_quote(uuid) from public, anon;
grant execute on function public.fh_make_job_from_quote(uuid) to authenticated;
