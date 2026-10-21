-- 092_leads_and_quotes.sql
--
-- Leads and quotes get tables of their own (decisions D53 to D55).
--
-- A lead is information from a customer who has no quote yet. A quote is
-- lines, terms and a customer link. Both point at a client. Jobs stay on
-- fh_contacts. Nothing here moves rows; migration 093 does that. This
-- file only adds what the new records need:
--
-- 1. fh_leads and fh_quotes, with the same company boundary as
--    fh_contacts (org membership through auth_user_org_ids), the same
--    org id default, the same updated_at touch and the same tenant
--    column guard. Quotes are money, so crew and foremen cannot read them.
-- 2. Nullable pointers on the tables that hung off a quote or a lead:
--    quote_id on fh_quote_items, fh_quote_versions, fh_public_links,
--    fh_schedule, fh_notes and fh_esign_envelopes; lead_id on fh_schedule
--    and fh_notes; client_id on fh_invoices. contact_id on fh_quote_items
--    and fh_invoices may now be null, since a quote's lines and a client's
--    invoice no longer need a job.
-- 3. The org inheritance trigger learns to read the org from a quote or
--    a lead when there is no contact, and the quote items total trigger
--    learns to sum into fh_quotes.amount when the item belongs to a quote.

-- 1. Tables -----------------------------------------------------------------

create table if not exists public.fh_leads (
  id                uuid primary key default gen_random_uuid(),
  org_id            uuid references public.organizations(id) on delete cascade,
  user_id           uuid not null,
  client_id         uuid not null references public.fh_clients(id) on delete cascade,
  title             text,
  notes             text,
  source            text,
  referred_by       text,
  job_type          text,
  status            text not null default 'open' check (status in ('open','quoted','lost')),
  follow_up_on      date,
  last_contact      date,
  origin_contact_id uuid references public.fh_contacts(id) on delete set null,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table if not exists public.fh_quotes (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid references public.organizations(id) on delete cascade,
  user_id             uuid not null,
  client_id           uuid not null references public.fh_clients(id) on delete cascade,
  lead_id             uuid references public.fh_leads(id) on delete set null,
  job_id              uuid references public.fh_contacts(id) on delete set null,
  title               text,
  job_type            text,
  scope_text          text,
  terms_text          text,
  exclusions_text     text,
  amount              numeric not null default 0,
  status              text not null default 'draft'
                      check (status in ('draft','sent','viewed','changes_requested','approved','rejected','expired','lost')),
  sent_at             timestamptz,
  expires_at          timestamptz,
  change_request_note text,
  change_requested_at timestamptz,
  approved_version_id uuid references public.fh_quote_versions(id) on delete set null,
  origin_contact_id   uuid references public.fh_contacts(id) on delete set null,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

alter table public.fh_leads
  add column if not exists quote_id uuid references public.fh_quotes(id) on delete set null;

create index if not exists fh_leads_org_status_idx   on public.fh_leads (org_id, status, follow_up_on);
create index if not exists fh_leads_client_idx       on public.fh_leads (client_id);
create index if not exists fh_leads_origin_idx       on public.fh_leads (origin_contact_id);
create index if not exists fh_quotes_org_status_idx  on public.fh_quotes (org_id, status, sent_at desc);
create index if not exists fh_quotes_client_idx      on public.fh_quotes (client_id);
create index if not exists fh_quotes_lead_idx        on public.fh_quotes (lead_id);
create index if not exists fh_quotes_job_idx         on public.fh_quotes (job_id);
create index if not exists fh_quotes_origin_idx      on public.fh_quotes (origin_contact_id);

alter table public.fh_leads  enable row level security;
alter table public.fh_quotes enable row level security;

drop policy if exists fh_leads_sel on public.fh_leads;
drop policy if exists fh_leads_ins on public.fh_leads;
drop policy if exists fh_leads_upd on public.fh_leads;
drop policy if exists fh_leads_del on public.fh_leads;
create policy fh_leads_sel on public.fh_leads for select to authenticated
  using (org_id in (select auth_user_org_ids()));
create policy fh_leads_ins on public.fh_leads for insert to authenticated
  with check (org_id in (select auth_user_org_ids()));
create policy fh_leads_upd on public.fh_leads for update to authenticated
  using (org_id in (select auth_user_org_ids()))
  with check (org_id in (select auth_user_org_ids()));
create policy fh_leads_del on public.fh_leads for delete to authenticated
  using (org_id in (select auth_user_org_ids()));

drop policy if exists fh_quotes_sel on public.fh_quotes;
drop policy if exists fh_quotes_ins on public.fh_quotes;
drop policy if exists fh_quotes_upd on public.fh_quotes;
drop policy if exists fh_quotes_del on public.fh_quotes;
drop policy if exists fh_quotes_money_roles on public.fh_quotes;
create policy fh_quotes_sel on public.fh_quotes for select to authenticated
  using (org_id in (select auth_user_org_ids()));
create policy fh_quotes_ins on public.fh_quotes for insert to authenticated
  with check (org_id in (select auth_user_org_ids()));
create policy fh_quotes_upd on public.fh_quotes for update to authenticated
  using (org_id in (select auth_user_org_ids()))
  with check (org_id in (select auth_user_org_ids()));
create policy fh_quotes_del on public.fh_quotes for delete to authenticated
  using (org_id in (select auth_user_org_ids()));
-- Policies are permissive, so this one is restrictive on purpose: crew and
-- foremen are org members but never see quotes, as with fh_quote_items.
create policy fh_quotes_money_roles on public.fh_quotes as restrictive for all to authenticated
  using (fh_money_visible(org_id)) with check (fh_money_visible(org_id));

drop trigger if exists fh_set_org_id_trg on public.fh_leads;
create trigger fh_set_org_id_trg before insert on public.fh_leads
  for each row execute function public.fh_set_org_id();
drop trigger if exists fh_leads_touch on public.fh_leads;
create trigger fh_leads_touch before update on public.fh_leads
  for each row execute function public.fh_touch_updated_at();
drop trigger if exists fh_leads_guard_tenant_columns on public.fh_leads;
create trigger fh_leads_guard_tenant_columns before update of org_id, user_id on public.fh_leads
  for each row execute function public.fh_contacts_guard_tenant_columns();

drop trigger if exists fh_set_org_id_trg on public.fh_quotes;
create trigger fh_set_org_id_trg before insert on public.fh_quotes
  for each row execute function public.fh_set_org_id();
drop trigger if exists fh_quotes_touch on public.fh_quotes;
create trigger fh_quotes_touch before update on public.fh_quotes
  for each row execute function public.fh_touch_updated_at();
drop trigger if exists fh_quotes_guard_tenant_columns on public.fh_quotes;
create trigger fh_quotes_guard_tenant_columns before update of org_id, user_id on public.fh_quotes
  for each row execute function public.fh_contacts_guard_tenant_columns();

grant select, insert, update, delete on public.fh_leads  to authenticated;
grant select, insert, update, delete on public.fh_quotes to authenticated;
revoke all on public.fh_leads  from anon;
revoke all on public.fh_quotes from anon;

-- 2. Pointers ---------------------------------------------------------------

alter table public.fh_quote_items    add column if not exists quote_id uuid references public.fh_quotes(id) on delete cascade;
alter table public.fh_quote_versions add column if not exists quote_id uuid references public.fh_quotes(id) on delete cascade;
alter table public.fh_public_links   add column if not exists quote_id uuid references public.fh_quotes(id) on delete cascade;
alter table public.fh_esign_envelopes add column if not exists quote_id uuid references public.fh_quotes(id) on delete cascade;
alter table public.fh_schedule       add column if not exists quote_id uuid references public.fh_quotes(id) on delete set null;
alter table public.fh_schedule       add column if not exists lead_id  uuid references public.fh_leads(id)  on delete set null;
alter table public.fh_notes          add column if not exists quote_id uuid references public.fh_quotes(id) on delete set null;
alter table public.fh_notes          add column if not exists lead_id  uuid references public.fh_leads(id)  on delete set null;
alter table public.fh_invoices       add column if not exists client_id uuid references public.fh_clients(id) on delete set null;

alter table public.fh_quote_items alter column contact_id drop not null;
alter table public.fh_invoices    alter column contact_id drop not null;

create index if not exists fh_quote_items_quote_idx    on public.fh_quote_items (quote_id, sort_order);
create index if not exists fh_quote_versions_quote_idx on public.fh_quote_versions (quote_id);
create index if not exists fh_public_links_quote_idx   on public.fh_public_links (quote_id);
create index if not exists fh_esign_envelopes_quote_idx on public.fh_esign_envelopes (quote_id);
create index if not exists fh_schedule_quote_idx       on public.fh_schedule (quote_id);
create index if not exists fh_schedule_lead_idx        on public.fh_schedule (lead_id);
create index if not exists fh_notes_quote_idx          on public.fh_notes (quote_id);
create index if not exists fh_notes_lead_idx           on public.fh_notes (lead_id);
create index if not exists fh_invoices_client_idx      on public.fh_invoices (client_id);

-- The quote items policies let an accepted partner on a job touch its
-- lines through contact_id. Lines on a quote have no job, so org
-- membership alone decides for them; the existing policies already allow
-- that through their org_id clause once the org is inherited below.

-- 3. Triggers that followed the contact ------------------------------------

create or replace function public.fh_inherit_org_from_contact()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  v_row    jsonb := to_jsonb(new);
  v_parent uuid;
  v_org    uuid;
begin
  v_parent := coalesce(
    nullif(v_row ->> 'contact_id', '')::uuid,
    nullif(v_row ->> 'job_id', '')::uuid
  );
  if v_parent is not null then
    select c.org_id into v_org from public.fh_contacts c where c.id = v_parent;
  end if;
  if v_org is null and nullif(v_row ->> 'quote_id', '') is not null then
    select q.org_id into v_org from public.fh_quotes q where q.id = (v_row ->> 'quote_id')::uuid;
  end if;
  if v_org is null and nullif(v_row ->> 'lead_id', '') is not null then
    select l.org_id into v_org from public.fh_leads l where l.id = (v_row ->> 'lead_id')::uuid;
  end if;
  if v_org is not null then
    new.org_id := v_org;
  end if;
  return new;
end
$function$;

-- The existing zz_inherit_org_from_contact trigger on fh_quote_items fires
-- on every insert, which is when a line gets its quote_id, so it does not
-- need recreating. (Recreating it timed out through the database tool on
-- October 19; a line whose quote_id changes after insert is not a case the
-- app has.)

create or replace function public.fn_recalc_contact_amount_from_items()
returns trigger
language plpgsql
security definer
set search_path to 'pg_catalog', 'public'
as $function$
declare
  target_contact uuid;
  target_quote   uuid;
  has_items boolean;
  new_total numeric;
begin
  target_quote := coalesce(new.quote_id, old.quote_id);
  if target_quote is not null then
    select coalesce(sum(amount), 0) into new_total
      from public.fh_quote_items
      where quote_id = target_quote
        and is_optional = false
        and is_excluded = false;
    update public.fh_quotes set amount = new_total where id = target_quote;
    return coalesce(new, old);
  end if;

  target_contact := coalesce(new.contact_id, old.contact_id);
  if target_contact is null then
    return coalesce(new, old);
  end if;

  select count(*) > 0 into has_items
    from public.fh_quote_items
    where contact_id = target_contact;

  if not has_items then
    -- All items deleted: keep the job's existing amount.
    return coalesce(new, old);
  end if;

  select coalesce(sum(amount), 0) into new_total
    from public.fh_quote_items
    where contact_id = target_contact
      and is_optional = false
      and is_excluded = false;

  update public.fh_contacts
    set amount = new_total
    where id = target_contact;

  return coalesce(new, old);
end;
$function$;
