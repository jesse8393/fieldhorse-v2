-- Migration 038 — fh_daily_logs
--
-- Phase C (pass 1). Foreman end-of-day posts: a per-job, per-day
-- structured note that captures what got done, who was there, the
-- weather window, and what's next. Kept separate from fh_notes
-- because the AI-parse flow on fh_notes is opinionated about action
-- items / risks / materials, while a daily log is its own
-- intentional thing.
--
-- One log per job per day per author is the common case but not
-- enforced — a foreman might post a morning and an afternoon update.
--
-- RLS:
--   - org members read all daily logs in their org
--   - members write their own (user_id = auth.uid())
--   - members update/delete their own only
--
-- Idempotent.

create table if not exists public.fh_daily_logs (
  id            uuid primary key default gen_random_uuid(),
  org_id        uuid references public.organizations(id) on delete cascade,
  user_id       uuid not null references auth.users(id) on delete cascade,
  contact_id    uuid not null references public.fh_contacts(id) on delete cascade,

  log_date      date not null default (current_date),
  summary       text not null,
  next_steps    text,
  weather_text  text,
  crew_count    integer,
  hours_worked  numeric(6, 2),
  photos        jsonb not null default '[]'::jsonb,

  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);

create index if not exists fh_daily_logs_contact_date_idx
  on public.fh_daily_logs (contact_id, log_date desc);

create index if not exists fh_daily_logs_org_date_idx
  on public.fh_daily_logs (org_id, log_date desc);

create index if not exists fh_daily_logs_user_date_idx
  on public.fh_daily_logs (user_id, log_date desc);

create or replace function public.fh_daily_logs_touch()
returns trigger language plpgsql as $fn$
begin new.updated_at := now(); return new; end $fn$;

drop trigger if exists fh_daily_logs_touch_trg on public.fh_daily_logs;
create trigger fh_daily_logs_touch_trg
  before update on public.fh_daily_logs
  for each row execute function public.fh_daily_logs_touch();

do $$ begin
  if not exists (
    select 1 from information_schema.triggers
    where  trigger_schema = 'public' and event_object_table = 'fh_daily_logs'
      and  trigger_name = 'fh_set_org_id_trg'
  ) then
    execute 'create trigger fh_set_org_id_trg
               before insert on public.fh_daily_logs
               for each row execute function public.fh_set_org_id()';
  end if;
end $$;

alter table public.fh_daily_logs enable row level security;

drop policy if exists fh_daily_logs_org_read on public.fh_daily_logs;
create policy fh_daily_logs_org_read on public.fh_daily_logs
  for select to authenticated
  using (
    org_id is not null
    and exists (
      select 1 from public.org_members m
      where  m.user_id    = auth.uid()
        and  m.org_id     = fh_daily_logs.org_id
        and  m.revoked_at is null
    )
  );

drop policy if exists fh_daily_logs_self_write on public.fh_daily_logs;
create policy fh_daily_logs_self_write on public.fh_daily_logs
  for insert to authenticated
  with check (user_id = auth.uid());

drop policy if exists fh_daily_logs_self_update on public.fh_daily_logs;
create policy fh_daily_logs_self_update on public.fh_daily_logs
  for update to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists fh_daily_logs_self_delete on public.fh_daily_logs;
create policy fh_daily_logs_self_delete on public.fh_daily_logs
  for delete to authenticated
  using (user_id = auth.uid());

comment on table public.fh_daily_logs is
  'Foreman end-of-day posts per job. One row per intentional update (morning + afternoon both allowed). Read by org; write/edit by author.';
