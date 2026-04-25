-- Fieldhorse v2 — migration 009
-- AI photo captions on fh_job_files
--
-- Adds a caption column so Claude Vision auto-captions persist + can
-- be edited by the owner. Idempotent. RLS already inherited from 006.

alter table public.fh_job_files
  add column if not exists caption text;

-- Verify:
--   select column_name from information_schema.columns
--   where table_name = 'fh_job_files' and column_name = 'caption';
--   -- 1 row
