-- 067_job_money_field_guard.sql
--
-- Applied to production on 2026-10-09 (drop free, idempotent).
--
-- Crew and foreman could change a job's stage, contract value, approval or
-- completion, and delete jobs, straight through the REST API: fh_contacts
-- write policies are org wide and only the job screen hid those controls.
-- This guard enforces the money roles rule from 064 on those columns.
--
-- Not affected: owners, admins and managers; accepted partners (they hold
-- no membership in the job's org); service role and cron work (no signed
-- in user); and updates made by other triggers, such as the contract value
-- recalculated when an allowed quote item change fires (pg_trigger_depth).

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
     or new.completed_at is distinct from old.completed_at
     or new.proposal_status is distinct from old.proposal_status then
    raise exception 'Your role cannot change a job''s stage, value, approval or completion.' using errcode = '42501';
  end if;
  return new;
end
$$;

create or replace trigger fh_contacts_guard_money_fields
  before update of stage, amount, completed_at, proposal_status or delete on public.fh_contacts
  for each row execute function public.fh_contacts_guard_money_fields();
