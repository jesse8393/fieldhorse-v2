-- Migration 040 — fh_materials
--
-- Phase F. Per-job procurement: one row per materials line item.
-- Captures what's needed, what's ordered, what's received, and what's
-- installed. The status flow is derived from quantities rather than a
-- separate enum so a single update to ordered_qty / received_qty /
-- installed_at correctly advances the row without manual state mgmt.
--
-- Derived status (computed in UI):
--   needed     ordered_at IS NULL
--   ordered    ordered_at IS NOT NULL and received_qty < ordered_qty
--   received   received_qty >= ordered_qty AND installed_at IS NULL
--   installed  installed_at IS NOT NULL
--
-- A future field-report ingester can drop rows here with
-- source.from = 'note' linking back to the note that mentioned them.
--
-- RLS:
--   - org members do everything in their org
--   - accepted partners on the linked job get READ access (so a sub
--     can see what's been ordered for their scope without owner
--     intervention; mirrors the partner-read pattern on fh_contacts
--     and fh_selections)
--
-- Idempotent.

create table if not exists public.fh_materials (
  id              uuid primary key default gen_random_uuid(),
  org_id          uuid references public.organizations(id) on delete cascade,
  user_id         uuid not null references auth.users(id) on delete cascade,
  contact_id      uuid not null references public.fh_contacts(id) on delete cascade,

  name            text not null,
  category        text,
  unit            text default 'EA',
  qty_needed      numeric(12, 3) not null default 1,

  supplier        text,
  po_number       text,
  unit_cost       numeric(12, 2),

  ordered_at      timestamptz,
  ordered_qty     numeric(12, 3),
  received_qty    numeric(12, 3) not null default 0,
  received_at     timestamptz,
  installed_at    timestamptz,

  notes           text,
  source          jsonb not null default '{}'::jsonb,

  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create index if not exists fh_materials_contact_idx
  on public.fh_materials (contact_id, created_at desc);
create index if not exists fh_materials_org_open_idx
  on public.fh_materials (org_id, created_at desc)
  where installed_at is null;
create index if not exists fh_materials_supplier_idx
  on public.fh_materials (supplier)
  where supplier is not null;

create or replace function public.fh_materials_touch()
returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end $fn$;

drop trigger if exists fh_materials_touch_trg on public.fh_materials;
create trigger fh_materials_touch_trg
  before update on public.fh_materials
  for each row execute function public.fh_materials_touch();

do $$ begin
  if not exists (
    select 1 from information_schema.triggers
    where  trigger_schema = 'public'
      and  event_object_table = 'fh_materials'
      and  trigger_name = 'fh_set_org_id_trg'
  ) then
    execute 'create trigger fh_set_org_id_trg
               before insert on public.fh_materials
               for each row execute function public.fh_set_org_id()';
  end if;
end $$;

alter table public.fh_materials enable row level security;

drop policy if exists fh_materials_org on public.fh_materials;
create policy fh_materials_org on public.fh_materials
  for all to authenticated
  using (
    org_id is not null
    and exists (
      select 1 from public.org_members m
      where  m.user_id    = auth.uid()
        and  m.org_id     = fh_materials.org_id
        and  m.revoked_at is null
    )
  )
  with check (
    org_id is not null
    and exists (
      select 1 from public.org_members m
      where  m.user_id    = auth.uid()
        and  m.org_id     = fh_materials.org_id
        and  m.revoked_at is null
    )
  );

drop policy if exists fh_materials_partner_read on public.fh_materials;
create policy fh_materials_partner_read on public.fh_materials
  for select to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where  p.job_id              = fh_materials.contact_id
        and  p.partner_user_id     = auth.uid()
        and  p.status              = 'accepted'
        and  p.deleted_by_partner_at is null
    )
  );

comment on table public.fh_materials is
  'Per-job materials / procurement line items. Status (needed / ordered / received / installed) is computed from qtys + timestamps, not a separate column. source jsonb traces back to the field note or estimate it came from.';
