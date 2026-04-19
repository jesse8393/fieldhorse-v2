-- Fieldhorse v2 — migration 005
-- CUSTOM COMPANY BRANDING
--
-- Ships the schema + private storage bucket + RLS for Phase 16 (logo in
-- app header) and the color-picker column Phase 17 will use. No data
-- migration, no destructive changes.
--
-- Run manually in Supabase SQL Editor. Verify with:
--   select column_name from information_schema.columns
--   where table_name = 'profiles'
--   and column_name in ('logo_url','logo_uploaded_at','brand_accent_hex');
-- Should return 3 rows.

-- ============================================================
-- PROFILES — BRANDING COLUMNS
-- ============================================================
alter table public.profiles
  add column if not exists logo_url text,
  add column if not exists logo_uploaded_at timestamptz,
  add column if not exists brand_accent_hex text;

-- Re-create the hex constraint only if it doesn't exist. add-constraint
-- has no IF NOT EXISTS in Postgres, so wrap in a DO block.
do $$
begin
  if not exists (
    select 1 from information_schema.table_constraints
    where table_schema = 'public'
      and table_name = 'profiles'
      and constraint_name = 'profiles_brand_accent_hex_format'
  ) then
    alter table public.profiles
      add constraint profiles_brand_accent_hex_format
      check (brand_accent_hex is null or brand_accent_hex ~ '^#[0-9A-Fa-f]{6}$');
  end if;
end $$;

-- ============================================================
-- STORAGE BUCKET — company-logos (private)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('company-logos', 'company-logos', false)
on conflict (id) do nothing;

-- RLS — each user can read/write only their own folder.
-- Path convention: company-logos/<user_id>/logo.<ext>
drop policy if exists "company_logos_owner" on storage.objects;
create policy "company_logos_owner"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'company-logos'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- DONE
-- ============================================================
-- Phase 16 uses logo_url.
-- Phase 17 will use brand_accent_hex + logo on invite landing/PDFs.
