-- Migration 037 — task assignment on fh_job_todos
--
-- Phase C (pass 1). Adds a nullable assigned_to column so a task on
-- a job can be aimed at a specific org member. NULL means "anyone
-- on the crew" (or just the owner's own to-do). The existing
-- user_id column stays as the CREATOR — we don't repurpose it,
-- because the rest of the app already reads user_id that way for the
-- "started by X" provenance and the RLS policy.
--
-- Idempotent.

alter table public.fh_job_todos
  add column if not exists assigned_to uuid references auth.users(id) on delete set null;

create index if not exists fh_job_todos_assigned_to_idx
  on public.fh_job_todos (assigned_to)
  where assigned_to is not null;

create index if not exists fh_job_todos_assigned_done_idx
  on public.fh_job_todos (assigned_to, done)
  where assigned_to is not null;

comment on column public.fh_job_todos.assigned_to is
  'auth.users.id of the teammate the task is assigned to. NULL = unassigned (still visible to anyone with org-read on the job).';
