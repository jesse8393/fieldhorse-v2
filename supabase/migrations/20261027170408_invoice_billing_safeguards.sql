-- Generated through the Supabase CLI. Pending isolated database verification
-- and the approved release process. Not applied to production.
-- Drafts reserve scope. Void an unused draft before adding its replacement.
-- No historical invoice is deleted or automatically changed.

begin;
create schema if not exists private;

create or replace function private.fh_check_invoice_contract_budget()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public
as $$
declare
  job public.fh_contacts%rowtype;
  caller uuid := auth.uid();
  is_service boolean := coalesce(auth.role(), '') = 'service_role';
  contract_amount numeric;
  approved_changes numeric;
  reserved_amount numeric;
  prior_contribution numeric := 0;
  issuing boolean := false;
begin
  if new.status = 'void' then return new; end if;
  if new.amount is null or new.amount::text in ('NaN', 'Infinity', '-Infinity') or new.amount <= 0 then
    raise exception using errcode = '23514', message = 'Invoice amount must be a finite positive number.';
  end if;
  if new.contact_id is null then return new; end if;
  -- Only the trusted service role or a signed in financial member may
  -- inspect this budget. An invented contact_id cannot probe another org.
  if caller is null and not is_service then
    raise exception using errcode = '42501', message = 'Invoice job unavailable.';
  end if;
  -- The job row serializes concurrent inserts and increases. After this
  -- lock is acquired, the next query sees the previous transaction's rows.
  select * into job from public.fh_contacts where id = new.contact_id for update;
  if not found or job.org_id is distinct from new.org_id then
    raise exception using errcode = '42501', message = 'Invoice job unavailable.';
  end if;
  if job.org_id is null then
    if job.user_id is distinct from new.user_id or (not is_service and job.user_id is distinct from caller) then
      raise exception using errcode = '42501', message = 'Invoice job unavailable.';
    end if;
  elsif not is_service and not exists (
    select 1 from public.org_members m where m.org_id = job.org_id and m.user_id = caller
      and m.revoked_at is null and m.role in ('owner', 'admin', 'manager')
  ) then
    raise exception using errcode = '42501', message = 'Invoice job unavailable.';
  end if;
  if job.amount::text in ('NaN', 'Infinity', '-Infinity') or exists (
    select 1 from public.fh_change_orders where contact_id = new.contact_id and status = 'approved'
      and amount::text in ('NaN', 'Infinity', '-Infinity')
  ) then
    raise exception using errcode = '23514', message = 'Review invalid contract or approved change amounts before billing.';
  end if;
  select coalesce(sum(amount), 0) into approved_changes
    from public.fh_change_orders where contact_id = new.contact_id and status = 'approved';
  if coalesce(job.amount, 0) <= 0 and approved_changes <= 0 then return new; end if;
  contract_amount := coalesce(job.amount, 0) + approved_changes;
  -- Historical invalid negative invoices cannot manufacture free budget.
  select coalesce(sum(greatest(amount, 0)), 0) into reserved_amount
    from public.fh_invoices where contact_id = new.contact_id and id <> new.id and status <> 'void';
  if tg_op = 'UPDATE' and old.contact_id = new.contact_id and old.status <> 'void' then
    prior_contribution := greatest(old.amount, 0);
    issuing := old.status = 'draft' and new.status in ('sent', 'viewed', 'overdue');
  end if;
  -- Legacy overbilling can be reduced, described, paid or voided. New
  -- obligations, increases and newly issued drafts must fit approved scope.
  if round(reserved_amount + new.amount, 2) > round(contract_amount, 2)
    and (tg_op = 'INSERT' or new.amount > prior_contribution or issuing) then
    raise exception using errcode = '23514', message = 'Invoice exceeds approved contract value. Reduce or void an unused draft, or record approved added scope first.';
  end if;
  return new;
end;
$$;

revoke all on function private.fh_check_invoice_contract_budget() from public, anon, authenticated;
drop trigger if exists fh_invoice_contract_budget on public.fh_invoices;
drop trigger if exists zzz_fh_invoice_contract_budget on public.fh_invoices;
-- Run after fh_set_org_id_trg and zz_inherit_org_from_contact.
create trigger zzz_fh_invoice_contract_budget before insert or update of amount, contact_id, status
  on public.fh_invoices for each row execute function private.fh_check_invoice_contract_budget();

commit;
