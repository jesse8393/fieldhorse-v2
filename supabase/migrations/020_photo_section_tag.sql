-- =============================================================
-- Migration 020 — PHOTO SECTION TAG
-- =============================================================
--
-- Adds a `section_tag` column to fh_job_files so a contractor can tag
-- a project photo with the scope section it documents ("Roofing",
-- "Demolition", etc.). The proposal PDF + on-screen ProposalTemplate
-- distribute tagged photos to the matching scope card so the customer
-- sees real progress evidence under each trade rather than a flat
-- gallery.
--
-- Nullable. Only applied to kind='photo' rows in practice; the column
-- exists on file rows too but is ignored by the UI. The partial index
-- skips file rows + un-tagged photos.
--
-- Backward compat: prior to this migration the proposal PDF code read
-- `section_tag` from the photo's `caption` column as a soft convention.
-- The Quote.jsx loader keeps that fallback so any photos tagged via
-- caption-based convention still surface on the proposal until the
-- contractor retags them in the new picker.
-- =============================================================

alter table public.fh_job_files
  add column if not exists section_tag text;

create index if not exists idx_fh_job_files_section_tag
  on public.fh_job_files(job_id, section_tag)
  where kind = 'photo' and section_tag is not null;
