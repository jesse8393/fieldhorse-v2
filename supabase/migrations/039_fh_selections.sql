-- Migration 039 — fh_selections
--
-- Phase E. Client-facing finish picks: tile, paint, fixtures, etc.
-- One row per selection item (e.g. "Master Bath Floor Tile"). Each
-- item carries an `options` JSONB array of candidate picks, and a
-- `selected_option_id` string that points at the picked one.
--
-- Status flow:
--   draft     — being authored, not yet visible to client
--   sent      — client can see it, no decision yet
--   reviewed  — client opened it
--   approved  — client picked an option (selected_option_id set)
--   changed   — owner changed scope after approval (resets)
--   installed — work done
--
-- Pass 1 scope (this migration + UI): owner-side CRUD inside job
-- detail. Client-side approval comes via the existing fh_public_links
-- token mechanism or the future authenticated client portal.
--
-- RLS:
--   - org members (auth_user_org_ids()) read + write all selections
--     in their org
--   - accepted partners on the linked job get READ access via
--     fh_job_partners (mirrors the fh_contacts_partner_read pattern)
--
-- Idempotent.

create table if not exists public.fh_selections (
  id                  uuid primary key default gen_random_uuid(),
  org_id              uuid references public.organizations(id) on delete cascade,
  user_id             uuid not null references auth.users(id) on delete cascade,
  contact_id          uuid not null references public.fh_contacts(id) on delete cascade,
  client_id           uuid references public.fh_clients(id) on delete set null,

  title               text not null,
  description         text,
  room                text,
  category            text,
  status              text not null default 'draft'
                        check (status in ('draft','sent','reviewed','approved','changed','installed')),
  options             jsonb not null default '[]'::jsonb,
  selected_option_id  text,
  decision_at         timestamptz,
  decision_by         text,
  due_at              date,
  notes               text,

  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create index if not exists fh_selections_contact_idx
  on public.fh_selections (contact_id, created_at desc);
create index if not exists fh_selections_org_idx
  on public.fh_selections (org_id, status, created_at desc);
create index if not exists fh_selections_due_idx
  on public.fh_selections (due_at)
  where due_at is not null and status not in ('approved', 'installed');

create or replace function public.fh_selections_touch()
returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end $fn$;

drop trigger if exists fh_selections_touch_trg on public.fh_selections;
create trigger fh_selections_touch_trg
  before update on public.fh_selections
  for each row execute function public.fh_selections_touch();

do $$ begin
  if not exists (
    select 1 from information_schema.triggers
    where  trigger_schema = 'public'
      and  event_object_table = 'fh_selections'
      and  trigger_name = 'fh_set_org_id_trg'
  ) then
    execute 'create trigger fh_set_org_id_trg
               before insert on public.fh_selections
               for each row execute function public.fh_set_org_id()';
  end if;
end $$;

alter table public.fh_selections enable row level security;

drop policy if exists fh_selections_org on public.fh_selections;
create policy fh_selections_org on public.fh_selections
  for all to authenticated
  using (
    org_id is not null
    and exists (
      select 1 from public.org_members m
      where  m.user_id    = auth.uid()
        and  m.org_id     = fh_selections.org_id
        and  m.revoked_at is null
    )
  )
  with check (
    org_id is not null
    and exists (
      select 1 from public.org_members m
      where  m.user_id    = auth.uid()
        and  m.org_id     = fh_selections.org_id
        and  m.revoked_at is null
    )
  );

drop policy if exists fh_selections_partner_read on public.fh_selections;
create policy fh_selections_partner_read on public.fh_selections
  for select to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where  p.job_id              = fh_selections.contact_id
        and  p.partner_user_id     = auth.uid()
        and  p.status              = 'accepted'
        and  p.deleted_by_partner_at is null
    )
  );

comment on table public.fh_selections is
  'Client-facing finish picks per job. One row per selection item with options jsonb + selected_option_id. Status: draft / sent / reviewed / approved / changed / installed.';
