-- =============================================================
-- Migration 023 — STAGE HISTORY
-- =============================================================
--
-- Records every stage change on fh_contacts so the activity log can
-- show real "lead → quote → job → invoice → closed" history instead
-- of a synthetic 'now at' marker. Auto-logged via AFTER UPDATE +
-- AFTER INSERT triggers — every existing path that updates the stage
-- (transitionStage in lib/stages.js, kanban drag-drop, etc.) records
-- automatically without per-caller wiring.
--
-- Owner-only write; partner read so a shared-job viewer can see the
-- full timeline.
--
-- Why no backfill: every pre-migration contact has at most one stage
-- change behind it (the current value), so adding a synthetic row
-- would lie about when the transition happened. The activity log
-- falls through to the legacy "now at" marker for any contact with
-- zero transition rows — that's correct for legacy data.
-- =============================================================

create table if not exists public.fh_stage_transitions (
  id uuid primary key default gen_random_uuid(),
  contact_id uuid not null references public.fh_contacts(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  from_stage text,
  to_stage   text not null,
  transitioned_at timestamptz not null default now(),
  transitioned_by uuid references auth.users(id) on delete set null
);

create index if not exists idx_fh_stage_transitions_contact
  on public.fh_stage_transitions(contact_id, transitioned_at desc);
create index if not exists idx_fh_stage_transitions_user
  on public.fh_stage_transitions(user_id);

-- ============================================================
-- RLS — OWNER + PARTNER READ
-- ============================================================
alter table public.fh_stage_transitions enable row level security;

drop policy if exists "fh_stage_transitions_own" on public.fh_stage_transitions;
create policy "fh_stage_transitions_own" on public.fh_stage_transitions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "fh_stage_transitions_partner_read" on public.fh_stage_transitions;
create policy "fh_stage_transitions_partner_read" on public.fh_stage_transitions
  for select to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_stage_transitions.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
    )
  );

-- ============================================================
-- AUTO-LOG TRIGGERS
-- ============================================================
-- AFTER UPDATE — fires only when the stage column actually changed.
create or replace function public.fh_stage_transitions_log()
returns trigger language plpgsql as $$
begin
  if new.stage is distinct from old.stage then
    insert into public.fh_stage_transitions
      (contact_id, user_id, from_stage, to_stage, transitioned_by)
    values
      (new.id, new.user_id, old.stage, new.stage, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists fh_stage_transitions_log on public.fh_contacts;
create trigger fh_stage_transitions_log
  after update on public.fh_contacts
  for each row execute procedure public.fh_stage_transitions_log();

-- AFTER INSERT — log the initial stage when a contact is created at
-- anything other than the implicit 'lead' default. NULL from_stage
-- reads as "created at {stage}" on the activity log.
create or replace function public.fh_stage_transitions_log_insert()
returns trigger language plpgsql as $$
begin
  if new.stage is not null and new.stage <> 'lead' then
    insert into public.fh_stage_transitions
      (contact_id, user_id, from_stage, to_stage, transitioned_by)
    values
      (new.id, new.user_id, null, new.stage, auth.uid());
  end if;
  return new;
end $$;

drop trigger if exists fh_stage_transitions_log_insert on public.fh_contacts;
create trigger fh_stage_transitions_log_insert
  after insert on public.fh_contacts
  for each row execute procedure public.fh_stage_transitions_log_insert();
