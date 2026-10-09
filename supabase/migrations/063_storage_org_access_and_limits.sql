-- 063 — Storage: org wide access to job files, bucket limits (audit 2026-10-09)
--
-- Applied to production pnmhblvslftdzfcdezbw on 2026-10-09. This file is
-- the exact mirror. Idempotent, no DROP statements.
--
-- Problem 1. The job-files and job-photos policies (006, 044) key on the
-- uploader's folder: (storage.foldername(name))[1] = auth.uid(). The app
-- signs URLs from the browser (src/lib/photos.ts, Photos.tsx,
-- DailyLogs.tsx, Files.tsx), so once an org has more than one member a
-- manager cannot open a photo a crew member uploaded, and deleting a
-- teammate's photo removed the row but orphaned the object. Tables went
-- org scoped in 032 and 034; storage never followed. Org members may now
-- read objects that a fh_job_files row or a fh_daily_logs photo in their
-- org points at, and delete objects backed by a fh_job_files row in their
-- org. Uploads stay in the uploader's own folder (unchanged) and partners
-- keep their read policy (044).
--
-- Problem 2. No bucket had a size limit or an allowed MIME list, so any
-- signed in user could upload unbounded files of any type. Limits match
-- what the UI sends: Photos and DailyLogs re encode to JPEG, Files accepts
-- any document, LogoUploader accepts png, jpeg, webp and svg, and sub
-- documents are pdf, jpg or png (netlify/functions/sub-doc-upload-url.js).
--
-- Problem 3. The legacy `jobphotos` bucket (0 objects since the move to
-- job-photos) was still public. It is now private; its policies stay so
-- nothing that still references it breaks.

-- ---------------------------------------------------------------------
-- 1. org member read and delete on job files and photos
-- ---------------------------------------------------------------------
do $$
begin
  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'job_files_org_read'
  ) then
    execute $p$
      create policy "job_files_org_read" on storage.objects
        for select to authenticated
        using (
          bucket_id in ('job-files', 'job-photos')
          and (
            exists (
              select 1 from public.fh_job_files jf
               where jf.storage_path = storage.objects.name
                 and jf.org_id in (select public.auth_user_org_ids())
            )
            or exists (
              select 1
                from public.fh_daily_logs d
                cross join lateral jsonb_array_elements(coalesce(d.photos, '[]'::jsonb)) p
               where p ->> 'storage_path' = storage.objects.name
                 and d.org_id in (select public.auth_user_org_ids())
            )
          )
        )
    $p$;
  end if;

  if not exists (
    select 1 from pg_policies
     where schemaname = 'storage' and tablename = 'objects'
       and policyname = 'job_files_org_remove'
  ) then
    execute $p$
      create policy "job_files_org_remove" on storage.objects
        for delete to authenticated
        using (
          bucket_id in ('job-files', 'job-photos')
          and exists (
            select 1 from public.fh_job_files jf
             where jf.storage_path = storage.objects.name
               and jf.org_id in (select public.auth_user_org_ids())
          )
        )
    $p$;
  end if;
end
$$;

-- The lookups above hit fh_job_files by storage_path on every object read.
create index if not exists fh_job_files_storage_path_idx on public.fh_job_files (storage_path);

-- ---------------------------------------------------------------------
-- 2. bucket limits
-- ---------------------------------------------------------------------
update storage.buckets
   set file_size_limit = 26214400,                       -- 25 MB
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'image/gif']
 where id in ('job-photos', 'jobphotos');

update storage.buckets
   set file_size_limit = 52428800                        -- 50 MB, any document type
 where id = 'job-files';

update storage.buckets
   set file_size_limit = 5242880,                        -- 5 MB
       allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/svg+xml']
 where id in ('company-logos', 'logos');

update storage.buckets
   set file_size_limit = 26214400,
       allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp', 'image/heic', 'image/heif', 'application/pdf']
 where id = 'receipts';

update storage.buckets
   set file_size_limit = 26214400,
       allowed_mime_types = array['application/pdf', 'image/jpeg', 'image/png']
 where id = 'sub-docs';

-- ---------------------------------------------------------------------
-- 3. legacy bucket goes private
-- ---------------------------------------------------------------------
update storage.buckets set public = false where id = 'jobphotos';
