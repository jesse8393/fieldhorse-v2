-- Fieldhorse v2 — migration 003
--
-- OPTIONAL. Run in Supabase SQL Editor ONLY if you want AI-parsed note
-- structure (summary, action_items, risks, materials_needed, follow_up_date)
-- to persist across sessions. Without this column, AI parse output is shown
-- in the capture card only, then discarded on save.
--
-- No data migration needed — existing rows will have parsed = NULL.

alter table public.fh_notes
  add column if not exists parsed jsonb;

-- No index needed; parsed is not queried, only stored/retrieved with the row.

-- ============================================================
-- PROFILES — DISPLAY NAME
-- ============================================================
-- Used on Home greeting ("Evening, Jesse.") and avatar initials. Safe to run
-- on existing profiles; existing rows remain NULL until user fills it in.
alter table public.profiles
  add column if not exists full_name text;
