-- 060: approved time punches are frozen for their owner.
--
-- Applied to production 2026-07-27 (remote migration name
-- 060_freeze_approved_time_punches). This file is the repo mirror.
--
-- The approval flow already exists end to end: the Timesheets screen
-- (owner, admin, manager) calls the Netlify functions
-- org-timesheets-list, org-punch-approve and org-punch-flag, which run
-- with the service role and stamp approved_at plus approved_by after a
-- role check. A guard trigger (fh_time_punches_guard_approval) already
-- stops authenticated users from setting approval or flag fields
-- themselves and from changing a set hourly_rate.
--
-- The remaining hole: after approval, the row's owner could still
-- edit punch_in_at, punch_out_at, break_minutes and notes, or delete
-- the row outright, because the self serve update and delete policies
-- only checked user_id. That made an approval stale the moment the
-- worker edited the shift underneath it.
--
-- Smallest correct fix: the self serve update and delete policies now
-- apply only while a punch is unapproved. No new policies (keeps one
-- permissive policy per action), no new functions, no security definer.
-- The service role bypasses RLS, so approve, flag with unapprove, and
-- unflag keep working, and flagging still reopens the punch for the
-- worker by clearing approved_at. Clock in and clock out are untouched
-- since an open punch can never be approved (org-punch-approve requires
-- punch_out_at to be set).

alter policy fh_time_punches_upd on public.fh_time_punches
  using ((user_id = (select auth.uid())) and approved_at is null)
  with check ((user_id = (select auth.uid())) and approved_at is null);

alter policy fh_time_punches_del on public.fh_time_punches
  using ((user_id = (select auth.uid())) and approved_at is null);
