-- Fieldhorse v2 — migration 017
-- SUB PROFILES (vendor identity layer)
--
-- The existing fh_subs table is per-job (one row = one sub on one
-- contact_id). It carries name, trade, phone, rate, status — enough to
-- record "who worked this job for how much" but nothing about the
-- vendor as a business: insurance, EIN, license, payment handle,
-- documents, etc.
--
-- This migration adds fh_sub_profiles — one row per real-world vendor,
-- owned by the contractor (user_id). The Subs directory page joins
-- by lowercased phone-or-name to surface profile metadata next to the
-- per-job rollup. Future schema work can add a profile_id FK column to
-- fh_subs to harden the link, but the directory rollup keeps working
-- without it.
--
-- Banking is intentionally LIGHTWEIGHT: payment_method + payment_handle
-- (free-text label like "Wells Fargo …1234" or a Zelle email). No raw
-- routing/account numbers. Document storage uses a private bucket
-- (sub-docs) with the same per-user folder RLS as company-logos and
-- receipts.
--
-- Idempotent. Safe to re-run.

-- ============================================================
-- TABLE
-- ============================================================
create table if not exists public.fh_sub_profiles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  -- Identity
  name text not null,
  company text,
  phone text,
  email text,
  address text,
  trades text[] default '{}',
  -- Business
  ein text,
  license_number text,
  -- Insurance
  insurance_carrier text,
  insurance_policy text,
  insurance_expires_on date,
  -- Payment (lightweight — see header comment)
  payment_method text,
  payment_handle text,
  -- Document storage paths in the sub-docs bucket. Convention:
  --   <user_id>/<sub_profile_id>/(w9|coi|license).<ext>
  -- Null means no document on file.
  w9_path text,
  coi_path text,
  license_path text,
  -- Free-form
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

-- payment_method is constrained to a small known set OR null. Done as
-- a deferred constraint so re-running the migration on an existing
-- table doesn't fail on already-present rows.
do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'fh_sub_profiles_payment_method_check'
  ) then
    alter table public.fh_sub_profiles
      add constraint fh_sub_profiles_payment_method_check
      check (
        payment_method is null
        or payment_method in ('check','ach','zelle','venmo','cashapp','cash','other')
      );
  end if;
end$$;

create index if not exists idx_fh_sub_profiles_user
  on public.fh_sub_profiles(user_id);

-- ============================================================
-- updated_at trigger
-- ============================================================
create or replace function public.fh_sub_profiles_touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end$$;

drop trigger if exists fh_sub_profiles_touch_updated_at on public.fh_sub_profiles;
create trigger fh_sub_profiles_touch_updated_at
  before update on public.fh_sub_profiles
  for each row
  execute function public.fh_sub_profiles_touch_updated_at();

-- ============================================================
-- ROW-LEVEL SECURITY
-- ============================================================
alter table public.fh_sub_profiles enable row level security;

drop policy if exists "fh_sub_profiles_own" on public.fh_sub_profiles;
create policy "fh_sub_profiles_own" on public.fh_sub_profiles
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- STORAGE BUCKET — sub-docs (private, owner-only)
-- ============================================================
insert into storage.buckets (id, name, public)
values ('sub-docs', 'sub-docs', false)
on conflict (id) do nothing;

-- Path convention: sub-docs/<user_id>/<sub_profile_id>/<doctype>.<ext>
-- Only the owning user can read/write under their own user_id folder.
drop policy if exists "sub_docs_owner" on storage.objects;
create policy "sub_docs_owner"
  on storage.objects for all to authenticated
  using (
    bucket_id = 'sub-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id = 'sub-docs'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- ============================================================
-- DONE
-- ============================================================
-- Verify after running:
--   select count(*) from public.fh_sub_profiles;        -- 0
--   select * from storage.buckets where id = 'sub-docs'; -- 1 row, public=false
--   select policyname from pg_policies
--     where tablename = 'fh_sub_profiles';              -- fh_sub_profiles_own
