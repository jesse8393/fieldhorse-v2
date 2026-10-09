-- 069_logos_owner_read.sql
--
-- Applied to production on 2026-10-09.
--
-- The public logos bucket had insert, update and delete policies for the
-- owner's folder but no select policy. Supabase Storage needs select as
-- well as delete to remove an object, and select, insert and update to
-- replace one, so removing or replacing a logo silently did nothing.
-- Public URLs keep working for everyone; this only covers the API calls.

do $$
begin
  if not exists (select 1 from pg_policies where schemaname = 'storage' and tablename = 'objects' and policyname = 'logos_own_read') then
    create policy "logos_own_read" on storage.objects
      for select to authenticated
      using (bucket_id = 'logos' and (storage.foldername(name))[1] = (select auth.uid())::text);
  end if;
end
$$;
