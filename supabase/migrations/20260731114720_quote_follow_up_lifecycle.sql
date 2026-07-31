-- Quote reminders belong only to leads and quotes still awaiting a response.
-- Keep that invariant in the database so every response path, including
-- customer approval and external signature webhooks, clears stale reminders.

create or replace function public.fh_contacts_clear_finished_quote_follow_up()
returns trigger
language plpgsql
security invoker
set search_path = pg_catalog
as $$
begin
  if coalesce(new.proposal_status, 'draft') in (
       'approved', 'changes_requested', 'rejected', 'expired'
     )
     or (
       tg_op = 'UPDATE'
       and coalesce(old.stage, 'lead') in ('lead', 'quote')
       and coalesce(new.stage, 'lead') not in ('lead', 'quote')
     ) then
    new.follow_up_on := null;
  end if;

  return new;
end;
$$;

drop trigger if exists fh_contacts_clear_finished_quote_follow_up on public.fh_contacts;

create trigger fh_contacts_clear_finished_quote_follow_up
before insert or update of stage, proposal_status, follow_up_on
on public.fh_contacts
for each row
execute function public.fh_contacts_clear_finished_quote_follow_up();

revoke all on function public.fh_contacts_clear_finished_quote_follow_up() from public;
revoke all on function public.fh_contacts_clear_finished_quote_follow_up() from anon;
revoke all on function public.fh_contacts_clear_finished_quote_follow_up() from authenticated;
