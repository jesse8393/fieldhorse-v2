-- Fieldhorse v2 — migration 010
-- Due dates on job todos.
--
-- Adds an optional deadline column to fh_job_todos so the NextAction
-- priority chain (jobNextAction.js) can rank overdue / today / upcoming
-- before undated rows. Nullable with no default so all existing rows
-- get null automatically — operators who don't use deadlines see zero
-- behavior change. Idempotent. RLS already inherited from 006
-- (fh_job_todos_own + fh_job_todos_partner cover the new column).

alter table public.fh_job_todos
  add column if not exists due_at timestamptz null;

-- Partial index for ranking open todos by deadline. Covers the common
-- "what's due across this job's open work" query without paying the
-- write cost on completed rows.
create index if not exists idx_fh_job_todos_due
  on public.fh_job_todos (job_id, due_at)
  where done = false;

-- Verify:
--   select column_name from information_schema.columns
--   where table_name = 'fh_job_todos' and column_name = 'due_at';
--   -- 1 row
--
--   select indexname from pg_indexes
--   where tablename = 'fh_job_todos' and indexname = 'idx_fh_job_todos_due';
--   -- 1 row
