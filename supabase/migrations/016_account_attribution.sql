-- Fieldhorse v2 — migration 016
-- ACCOUNT ATTRIBUTION RPC
--
-- Every shared-job child table (fh_notes, fh_schedule, fh_subs,
-- fh_expenses, fh_payments, fh_inspections, fh_job_files, fh_job_todos)
-- already stores user_id at insert time, so the creator identifier is
-- already in the data. What we don't have is a SAFE way for a partner
-- to read the inviter's display name (or vice versa) without
-- broadening profiles RLS.
--
-- This migration adds a single SECURITY DEFINER function that resolves
-- a list of user_ids into display labels, but only for users connected
-- to the caller via an accepted fh_job_partners link (or self). It
-- exposes ONLY (user_id, label, role) — not email, not webhook keys,
-- not preferences, not anything else from profiles.
--
-- Idempotent. Safe to re-run.

create or replace function public.fh_resolve_account_labels(p_user_ids uuid[])
returns table (user_id uuid, label text, role text)
security definer
set search_path = public
language plpgsql
as $$
declare
  v_caller uuid := auth.uid();
begin
  if v_caller is null then
    -- Unauthenticated callers get nothing.
    return;
  end if;
  if p_user_ids is null or array_length(p_user_ids, 1) is null then
    return;
  end if;

  return query
  select
    pr.user_id,
    coalesce(
      nullif(trim(pr.company_name), ''),
      nullif(trim(pr.full_name), ''),
      'Unknown account'
    )::text as label,
    case
      when pr.user_id = v_caller then 'self'
      when exists (
        select 1 from public.fh_job_partners jp
        where jp.invited_by_user_id = v_caller
          and jp.partner_user_id   = pr.user_id
          and jp.status = 'accepted'
      ) then 'partner'
      when exists (
        select 1 from public.fh_job_partners jp
        where jp.partner_user_id   = v_caller
          and jp.invited_by_user_id = pr.user_id
          and jp.status = 'accepted'
      ) then 'owner'
      else 'unknown'
    end::text as role
  from public.profiles pr
  where pr.user_id = any(p_user_ids)
    and (
      -- Self always allowed.
      pr.user_id = v_caller
      -- Caller invited this user as a partner on at least one job.
      or exists (
        select 1 from public.fh_job_partners jp
        where jp.invited_by_user_id = v_caller
          and jp.partner_user_id   = pr.user_id
          and jp.status = 'accepted'
      )
      -- This user invited the caller as a partner on at least one job.
      or exists (
        select 1 from public.fh_job_partners jp
        where jp.partner_user_id   = v_caller
          and jp.invited_by_user_id = pr.user_id
          and jp.status = 'accepted'
      )
    );
end;
$$;

-- Grant execute to authenticated. SECURITY DEFINER means the function
-- runs with the function owner's privileges; the auth gate is enforced
-- inside the function body, not via per-table RLS.
grant execute on function public.fh_resolve_account_labels(uuid[]) to authenticated;

-- ============================================================
-- VERIFICATION (manual — run after applying):
-- ============================================================
-- Self lookup (always works):
--   select * from public.fh_resolve_account_labels(array[auth.uid()]);
-- Lookup of an unrelated user (returns 0 rows — RLS enforced inside fn):
--   select * from public.fh_resolve_account_labels(array['00000000-0000-0000-0000-000000000000'::uuid]);
-- Lookup of a partner you invited or who invited you:
--   select * from public.fh_resolve_account_labels(array[<their uuid>]);
