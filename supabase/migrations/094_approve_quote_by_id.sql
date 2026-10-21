-- 094_approve_quote_by_id.sql
--
-- The customer link, send and approve read the quote record (PHASE9_PLAN
-- Task 11, decisions D53 to D55). A quote lives on fh_quotes and has no
-- job until Make this a job, so the rows that record its approval and its
-- signing request can no longer require a contact:
--
-- 1. fh_quote_versions.contact_id and fh_esign_envelopes.contact_id become
--    nullable; a row must name a contact or a quote. Version numbers are
--    unique per quote as they are per contact.
-- 2. fn_approve_quote_version gains p_quote_id (default null). With it the
--    caller is checked against the quote's company, the version is numbered
--    per quote and inserted with quote_id, and fh_quotes.status becomes
--    approved with approved_version_id pointing at the new row. Without it
--    the function behaves as before (migration 065). p_contact_id is now
--    optional too, so a quote approval passes no job.
--
-- The function body below is the one in 065_sub_portal_binding_and_workspace.sql
-- with the quote branch added. The old signature is dropped first: with
-- both in place a call that leaves p_quote_id out would match both and
-- PostgREST could not choose.

-- 1. Columns ----------------------------------------------------------------

alter table public.fh_quote_versions  alter column contact_id drop not null;
alter table public.fh_esign_envelopes alter column contact_id drop not null;

alter table public.fh_quote_versions
  drop constraint if exists fh_quote_versions_contact_or_quote;
alter table public.fh_quote_versions
  add constraint fh_quote_versions_contact_or_quote
  check (contact_id is not null or quote_id is not null);

alter table public.fh_esign_envelopes
  drop constraint if exists fh_esign_envelopes_contact_or_quote;
alter table public.fh_esign_envelopes
  add constraint fh_esign_envelopes_contact_or_quote
  check (contact_id is not null or quote_id is not null);

create unique index if not exists fh_quote_versions_quote_version_idx
  on public.fh_quote_versions (quote_id, version_number)
  where quote_id is not null;

-- 2. The function -----------------------------------------------------------

drop function if exists public.fn_approve_quote_version(
  uuid, uuid, jsonb, numeric, numeric, integer, text, text, text, text, text, text
);

create or replace function public.fn_approve_quote_version(
  p_user_id uuid,
  p_contact_id uuid,
  p_snapshot jsonb,
  p_base_total numeric,
  p_optional_total numeric,
  p_excluded_count integer,
  p_approval_method text,
  p_approved_by_name text,
  p_approved_by_email text default null::text,
  p_approval_note text default null::text,
  p_signature_kind text default null::text,
  p_signature_data text default null::text,
  p_quote_id uuid default null::uuid
)
 returns fh_quote_versions
 language plpgsql
 security definer
 set search_path to 'pg_catalog', 'public'
as $function$
declare
  caller uuid;
  next_version integer;
  new_row public.fh_quote_versions;
  v_quote public.fh_quotes;
begin
  caller := auth.uid();
  if caller is null or caller <> p_user_id then
    raise exception 'unauthorized: caller does not match p_user_id';
  end if;

  if p_quote_id is not null then
    -- A quote record: its creator, or a member of its company who may see
    -- money (crew and foremen never see quotes, as the fh_quotes policies
    -- have it).
    select * into v_quote from public.fh_quotes q where q.id = p_quote_id;
    if v_quote.id is null then
      raise exception 'unauthorized: quote not accessible';
    end if;
    if not (
      v_quote.user_id = caller
      or (
        v_quote.org_id is not null
        and public.fh_is_org_member(v_quote.org_id)
        and public.fh_money_visible(v_quote.org_id)
      )
    ) then
      raise exception 'unauthorized: quote not accessible';
    end if;

    select coalesce(max(version_number), 0) + 1
      into next_version
      from public.fh_quote_versions
      where quote_id = p_quote_id;

    insert into public.fh_quote_versions (
      user_id, org_id, contact_id, quote_id, version_number, status,
      snapshot, base_total, optional_total, excluded_count,
      approval_method, approved_by_name, approved_by_email, approval_note,
      signature_kind, signature_data
    )
    values (
      p_user_id, v_quote.org_id, null, p_quote_id, next_version, 'approved',
      p_snapshot, p_base_total, p_optional_total, p_excluded_count,
      p_approval_method, p_approved_by_name, p_approved_by_email, p_approval_note,
      p_signature_kind, p_signature_data
    )
    returning * into new_row;

    update public.fh_quote_versions
       set status = 'superseded',
           superseded_at = now(),
           superseded_by = new_row.id
     where quote_id = p_quote_id
       and id <> new_row.id
       and status = 'approved';

    update public.fh_quotes
       set approved_version_id = new_row.id,
           status = 'approved'
     where id = p_quote_id;

    return new_row;
  end if;

  if p_contact_id is null then
    raise exception 'p_contact_id or p_quote_id is required';
  end if;

  if not exists (
    select 1
    from public.fh_contacts c
    where c.id = p_contact_id
      and (
        c.user_id = caller
        or (
          c.org_id is not null
          and public.fh_is_org_member(c.org_id)
          and public.fh_money_visible(c.org_id)
        )
        or exists (
          select 1 from public.fh_job_partners pj
          where pj.job_id = c.id
            and pj.partner_user_id = caller
            and pj.status = 'accepted'
            and pj.deleted_by_partner_at is null
        )
      )
  ) then
    raise exception 'unauthorized: contact not accessible';
  end if;

  select coalesce(max(version_number), 0) + 1
    into next_version
    from public.fh_quote_versions
    where contact_id = p_contact_id;

  insert into public.fh_quote_versions (
    user_id, contact_id, version_number, status,
    snapshot, base_total, optional_total, excluded_count,
    approval_method, approved_by_name, approved_by_email, approval_note,
    signature_kind, signature_data
  )
  values (
    p_user_id, p_contact_id, next_version, 'approved',
    p_snapshot, p_base_total, p_optional_total, p_excluded_count,
    p_approval_method, p_approved_by_name, p_approved_by_email, p_approval_note,
    p_signature_kind, p_signature_data
  )
  returning * into new_row;

  update public.fh_quote_versions
     set status = 'superseded',
         superseded_at = now(),
         superseded_by = new_row.id
   where contact_id = p_contact_id
     and id <> new_row.id
     and status = 'approved';

  update public.fh_contacts
     set approved_quote_version_id = new_row.id,
         proposal_status = 'approved'
   where id = p_contact_id;

  return new_row;
end;
$function$;

-- Same grants as 046: never callable anonymously.
revoke execute on function public.fn_approve_quote_version(
  uuid, uuid, jsonb, numeric, numeric, integer, text, text, text, text, text, text, uuid
) from public, anon;
grant execute on function public.fn_approve_quote_version(
  uuid, uuid, jsonb, numeric, numeric, integer, text, text, text, text, text, text, uuid
) to authenticated;

-- Applied to production on October 20 as 094a (columns, constraints,
-- index) through apply_migration and 094b (the function) through
-- execute_sql: the body loaded in four chunks into a scratch table and
-- executed from a do block, the old twelve argument signature removed with
-- a constructed drop statement, because the database tool never returns on
-- a call that contains the word drop (supabase/README.md).
