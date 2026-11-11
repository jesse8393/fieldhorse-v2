-- Extend the existing job money guard to include recorded cost.
-- Preserve the established treatment of partners, trusted trigger work,
-- service operations, personal records and all other guarded fields.
create or replace function public.fh_contacts_guard_money_fields()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
begin
  if auth.uid() is null or old.org_id is null or pg_trigger_depth() > 1 then
    return coalesce(new, old);
  end if;
  if public.fh_money_visible(old.org_id) then
    return coalesce(new, old);
  end if;
  if tg_op = 'DELETE' then
    raise exception 'Your role cannot delete jobs.' using errcode = '42501';
  end if;
  if new.stage is distinct from old.stage
     or new.amount is distinct from old.amount
     or new.cost is distinct from old.cost
     or new.completed_at is distinct from old.completed_at
     or new.proposal_status is distinct from old.proposal_status then
    raise exception 'Your role cannot change a job''s stage, value, cost, approval or completion.' using errcode = '42501';
  end if;
  return new;
end
$$;

create or replace trigger fh_contacts_guard_money_fields
  before update of stage, amount, cost, completed_at, proposal_status or delete on public.fh_contacts
  for each row execute function public.fh_contacts_guard_money_fields();
