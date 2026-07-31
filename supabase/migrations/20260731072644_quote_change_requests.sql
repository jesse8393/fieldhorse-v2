-- Add a first class customer change request state to the quote lifecycle.
-- Applied to production as migration 20260731072644.
--
-- The request itself is written by the public link function through the
-- service role. The latest request stays on the contact for the quote
-- workspace, and every request is also appended to fh_notes for history.

alter table public.fh_contacts
  add column if not exists quote_change_request_note text,
  add column if not exists quote_change_requested_at timestamptz;

alter table public.fh_contacts
  drop constraint if exists fh_contacts_quote_change_request_note_length;

alter table public.fh_contacts
  add constraint fh_contacts_quote_change_request_note_length
  check (
    quote_change_request_note is null
    or char_length(quote_change_request_note) between 3 and 2000
  );

alter table public.fh_contacts
  drop constraint if exists fh_contacts_proposal_status_check;

alter table public.fh_contacts
  add constraint fh_contacts_proposal_status_check
  check (
    proposal_status in (
      'draft',
      'sent',
      'viewed',
      'changes_requested',
      'approved',
      'rejected',
      'expired'
    )
  );

comment on column public.fh_contacts.quote_change_request_note is
  'Latest revision request submitted through a secure proposal link.';

comment on column public.fh_contacts.quote_change_requested_at is
  'Time of the latest customer revision request.';

create or replace function public.fh_clear_quote_change_request()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
begin
  if new.proposal_status is distinct from old.proposal_status
     and new.proposal_status is distinct from 'changes_requested' then
    new.quote_change_request_note := null;
    new.quote_change_requested_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists fh_contacts_clear_quote_change_request
  on public.fh_contacts;

create trigger fh_contacts_clear_quote_change_request
  before update of proposal_status on public.fh_contacts
  for each row
  execute function public.fh_clear_quote_change_request();

revoke execute on function public.fh_clear_quote_change_request()
  from public, anon, authenticated;
