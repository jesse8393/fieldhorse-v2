-- Fieldhorse v2 — migration 006
-- JOB-LEVEL FILES, PHOTOS, TO-DOS + recover missing 005 storage bits
--
-- Run manually in Supabase SQL Editor. Non-destructive; every block is
-- idempotent (IF NOT EXISTS / ON CONFLICT / DROP POLICY IF EXISTS).
--
-- What this migration does:
--   A) Recover the company-logos bucket + RLS that migration 005 tried to
--      create but silently failed on this environment (only the profiles
--      columns applied).
--   B) Create job-files bucket + job-photos bucket + RLS.
--   C) Create fh_job_files table (shared by files + photos; mime-type
--      differentiates), fh_job_todos table.
--   D) RLS on both tables mirrors fh_contacts: owner OR accepted partner
--      via fh_job_partners.

-- ============================================================
-- A) RECOVER migration 005 — company-logos bucket + policy
-- ============================================================
insert into storage.buckets (id, name, public)
values ('company-logos', 'company-logos', false)
on conflict (id) do nothing;

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
-- B) NEW BUCKETS — job-files + job-photos
-- ============================================================
insert into storage.buckets (id, name, public)
values ('job-files', 'job-files', false)
on conflict (id) do nothing;

insert into storage.buckets (id, name, public)
values ('job-photos', 'job-photos', false)
on conflict (id) do nothing;

-- Folder convention for both: <user_id>/<job_id>/<object_id>.<ext>
-- RLS: writer must own the path (first folder segment = auth.uid).
drop policy if exists "job_files_owner" on storage.objects;
create policy "job_files_owner"
  on storage.objects for all to authenticated
  using (
    bucket_id in ('job-files', 'job-photos')
    and (storage.foldername(name))[1] = auth.uid()::text
  )
  with check (
    bucket_id in ('job-files', 'job-photos')
    and (storage.foldername(name))[1] = auth.uid()::text
  );

-- The partner-read storage policy depends on public.fh_job_files, so it
-- is defined in section B2 below — AFTER section C creates the table.

-- ============================================================
-- C) TABLES — fh_job_files, fh_job_todos
-- ============================================================
create table if not exists public.fh_job_files (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.fh_contacts(id) on delete cascade,
  filename text not null,
  storage_path text not null,            -- e.g. <uid>/<job_id>/<row_id>.<ext>
  mime_type text,
  size_bytes bigint,
  kind text not null default 'file'      -- 'file' | 'photo'
    check (kind in ('file', 'photo')),
  uploaded_at timestamptz not null default now()
);

create index if not exists idx_fh_job_files_job  on public.fh_job_files(job_id);
create index if not exists idx_fh_job_files_user on public.fh_job_files(user_id);
create index if not exists idx_fh_job_files_kind on public.fh_job_files(job_id, kind);

create table if not exists public.fh_job_todos (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  job_id uuid not null references public.fh_contacts(id) on delete cascade,
  text text not null,
  done boolean not null default false,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);

create index if not exists idx_fh_job_todos_job on public.fh_job_todos(job_id, created_at desc);

-- ============================================================
-- B2) STORAGE PARTNER-READ POLICY (deferred — depends on fh_job_files)
-- ============================================================
-- Accepted partners can read the files of jobs they co-manage. Read-only;
-- partners cannot upload into another owner's storage folder. Storage
-- objects are physically owned by the inviter; the UI uploads via the
-- signed-in user, so a partner always uploads into THEIR OWN folder
-- under their own auth.uid().
drop policy if exists "job_files_partner_read" on storage.objects;
create policy "job_files_partner_read"
  on storage.objects for select to authenticated
  using (
    bucket_id in ('job-files', 'job-photos')
    and exists (
      select 1
      from public.fh_job_files jf
      join public.fh_job_partners jp on jp.job_id = jf.job_id
      where jf.storage_path = storage.objects.name
        and jp.partner_user_id = auth.uid()
        and jp.status = 'accepted'
        and jp.deleted_by_partner_at is null
    )
  );

-- ============================================================
-- D) RLS — owner + accepted-partner pattern matching fh_expenses
-- ============================================================
alter table public.fh_job_files enable row level security;
alter table public.fh_job_todos enable row level security;

drop policy if exists "fh_job_files_own" on public.fh_job_files;
create policy "fh_job_files_own" on public.fh_job_files
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "fh_job_files_partner" on public.fh_job_files;
create policy "fh_job_files_partner" on public.fh_job_files
  for all to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_job_files.job_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  )
  with check (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_job_files.job_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  );

drop policy if exists "fh_job_todos_own" on public.fh_job_todos;
create policy "fh_job_todos_own" on public.fh_job_todos
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "fh_job_todos_partner" on public.fh_job_todos;
create policy "fh_job_todos_partner" on public.fh_job_todos
  for all to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_job_todos.job_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  )
  with check (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_job_todos.job_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  );

-- ============================================================
-- DONE
-- ============================================================
-- Verify:
--   select id, name, public from storage.buckets
--   where id in ('company-logos','job-files','job-photos');
--   -- 3 rows, all public=false
--
--   select policyname from pg_policies
--   where tablename = 'objects'
--   and policyname in ('company_logos_owner','job_files_owner','job_files_partner_read');
--   -- 3 rows
--
--   select tablename from information_schema.tables
--   where table_schema = 'public'
--   and table_name in ('fh_job_files','fh_job_todos');
--   -- 2 rows
