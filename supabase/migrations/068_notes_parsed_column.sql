-- 068_notes_parsed_column.sql
--
-- Applied to production on 2026-10-09.
--
-- The Notes screen parses a dictated or typed note with AI and saves the
-- result in fh_notes.parsed. Migration 003 that adds the column was marked
-- optional and never applied, so the parse was thrown away on every save.

alter table public.fh_notes add column if not exists parsed jsonb;
