-- Fieldhorse v2 — migration 004
-- PARTNER-LEVEL JOB SHARING
--
-- Do NOT run this in prod until the Partner Tracker UI has been reviewed
-- and approved. Schema + RLS only — no data migration, no destructive changes.
--
-- Model: a contractor (owner) invites a partner by email to co-manage ONE
-- specific job. Both parties can edit every field on that job. Neither sees
-- the other's other jobs, contacts, rates, or profile data. Deletion is
-- per-partner (soft unlink) — if one side deletes, the other retains access.

create table if not exists public.fh_job_partners (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.fh_contacts(id) on delete cascade,
  invited_by_user_id uuid not null references auth.users(id) on delete cascade,
  partner_user_id uuid references auth.users(id) on delete set null,
  partner_email text not null,
  invite_token text unique,                         -- random token for email link
  status text not null default 'pending'            -- pending | accepted | declined | revoked
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  invited_at timestamptz default now(),
  accepted_at timestamptz,
  deleted_by_invited_at timestamptz,                -- soft-delete from inviter's view
  deleted_by_partner_at timestamptz,                -- soft-delete from partner's view
  unique(job_id, partner_email)
);

create index if not exists idx_fh_job_partners_job_id
  on public.fh_job_partners(job_id);
create index if not exists idx_fh_job_partners_partner_user_id
  on public.fh_job_partners(partner_user_id);
create index if not exists idx_fh_job_partners_partner_email
  on public.fh_job_partners(partner_email);
create index if not exists idx_fh_job_partners_invite_token
  on public.fh_job_partners(invite_token);

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================
alter table public.fh_job_partners enable row level security;

-- Inviter can see all their invites (where they invited OR where they're
-- the accepted partner).
drop policy if exists "fh_job_partners_own" on public.fh_job_partners;
create policy "fh_job_partners_own" on public.fh_job_partners
  for all to authenticated
  using (
    invited_by_user_id = auth.uid()
    or partner_user_id = auth.uid()
  )
  with check (
    invited_by_user_id = auth.uid()
    or partner_user_id = auth.uid()
  );

-- ============================================================
-- EXTEND fh_contacts RLS TO INCLUDE PARTNER ACCESS
-- ============================================================
-- The existing "fh_contacts_own" policy only lets users see rows where
-- user_id = auth.uid(). Add a second policy that lets an accepted partner
-- see the shared job row.
drop policy if exists "fh_contacts_partner_read" on public.fh_contacts;
create policy "fh_contacts_partner_read" on public.fh_contacts
  for select to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_contacts.id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  );

drop policy if exists "fh_contacts_partner_write" on public.fh_contacts;
create policy "fh_contacts_partner_write" on public.fh_contacts
  for update to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_contacts.id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  )
  with check (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_contacts.id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  );

-- Matching read-and-write partner policies for the child tables that hang
-- off fh_contacts by contact_id. Without these, a partner could load the
-- contact row but not its subs/expenses/payments/notes/schedule/inspections.
-- One policy per table; pattern is identical.
drop policy if exists "fh_subs_partner" on public.fh_subs;
create policy "fh_subs_partner" on public.fh_subs
  for all to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_subs.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  )
  with check (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_subs.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  );

drop policy if exists "fh_expenses_partner" on public.fh_expenses;
create policy "fh_expenses_partner" on public.fh_expenses
  for all to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_expenses.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  )
  with check (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_expenses.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  );

drop policy if exists "fh_payments_partner" on public.fh_payments;
create policy "fh_payments_partner" on public.fh_payments
  for all to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_payments.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  )
  with check (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_payments.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  );

drop policy if exists "fh_notes_partner" on public.fh_notes;
create policy "fh_notes_partner" on public.fh_notes
  for all to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_notes.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  )
  with check (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_notes.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  );

drop policy if exists "fh_schedule_partner" on public.fh_schedule;
create policy "fh_schedule_partner" on public.fh_schedule
  for all to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_schedule.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  )
  with check (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_schedule.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  );

drop policy if exists "fh_inspections_partner" on public.fh_inspections;
create policy "fh_inspections_partner" on public.fh_inspections
  for all to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_inspections.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  )
  with check (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_inspections.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  );

-- ============================================================
-- TOKEN HELPER
-- ============================================================
-- Generate a 32-char URL-safe invite token on insert if not supplied.
create or replace function public.fh_fill_invite_token()
returns trigger as $$
begin
  if new.invite_token is null then
    new.invite_token := encode(gen_random_bytes(24), 'hex');
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists fh_job_partners_fill_token on public.fh_job_partners;
create trigger fh_job_partners_fill_token
  before insert on public.fh_job_partners
  for each row execute procedure public.fh_fill_invite_token();

-- ============================================================
-- DONE
-- ============================================================
-- After running: deploy the Partner Tracker UI and the partner-invite
-- Netlify function, then test end-to-end with a second account.
