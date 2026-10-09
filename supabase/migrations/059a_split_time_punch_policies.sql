-- 059a — Split the time punch self policy so 060 can apply (audit 2026-10-09)
--
-- Repository repair only. Production already has this shape: a live only
-- migration (consolidate_permissive_rls_policies, 2026-07-26) replaced the
-- FOR ALL policy fh_time_punches_self from 036 with per command policies
-- fh_time_punches_sel / _ins / _upd / _del before 060 ran. That migration
-- never reached the repository, so on a database built from these files
-- 060 failed with "policy fh_time_punches_upd does not exist".
--
-- Runs between 059 and 060 by file name. In production it is a no-op:
-- the guard finds no fh_time_punches_self policy and does nothing.

do $$
begin
  if to_regclass('public.fh_time_punches') is null then
    return;
  end if;
  if not exists (
    select 1 from pg_policies
     where schemaname = 'public' and tablename = 'fh_time_punches'
       and policyname = 'fh_time_punches_self'
  ) then
    return;
  end if;

  execute 'drop policy "fh_time_punches_self" on public.fh_time_punches';
  execute 'drop policy if exists "fh_time_punches_org_read" on public.fh_time_punches';

  execute $p$
    create policy "fh_time_punches_sel" on public.fh_time_punches for select to authenticated
    using (
      (org_id is not null and exists (
        select 1 from public.org_members m
         where m.user_id = (select auth.uid()) and m.org_id = fh_time_punches.org_id
           and m.revoked_at is null and m.role in ('owner', 'admin', 'manager')
      ))
      or user_id = (select auth.uid())
    )
  $p$;
  execute $p$
    create policy "fh_time_punches_ins" on public.fh_time_punches for insert to authenticated
    with check (user_id = (select auth.uid()))
  $p$;
  execute $p$
    create policy "fh_time_punches_upd" on public.fh_time_punches for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()))
  $p$;
  execute $p$
    create policy "fh_time_punches_del" on public.fh_time_punches for delete to authenticated
    using (user_id = (select auth.uid()))
  $p$;
end
$$;
