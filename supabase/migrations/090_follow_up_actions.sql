-- 090_follow_up_actions.sql
--
-- Phase 9, Task 2 (decisions D63 and D64). Not yet applied to production.
--
-- A reminder in the notifications list (kind follow_up_due or
-- review_ask_due) can be marked Done or Dismissed from the notifications
-- screen. Each such notification stands for one row in fh_follow_ups: the
-- follow up engine wrote both at the same time, with the notification's
-- title equal to the follow up's headline and the notification's link
-- pointing at the record ('/jobs/<contact id>' today, '/leads/<id>' or
-- '/quotes/<id>' once those have their own tables). There is no column
-- joining the two, so this function matches on the contact id taken from
-- the last part of the link, the headline, and the queued status.
--
-- fh_follow_up_set_status(p_notification_id, p_status):
--   * p_status is 'done' or 'dismissed'; anything else raises.
--   * The notification must belong to the caller (auth.uid()), or it raises.
--   * The matching queued follow up gets status 'done' or 'skipped'
--     (fh_follow_ups.status only allows queued, done, skipped and sent, so
--     the app's 'dismissed' is stored as 'skipped'), completed_at = now()
--     and completed_by = the caller.
--   * The notification is marked read.
--
-- Security definer so the update can run under row level security for a
-- row the caller owns through the notification, and only authenticated
-- users may call it. Additive: no table or column changes.

create or replace function public.fh_follow_up_set_status(p_notification_id uuid, p_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_note record;
  v_contact_id uuid;
  v_follow_up_status text;
begin
  if p_status not in ('done', 'dismissed') then
    raise exception 'fh_follow_up_set_status: status must be done or dismissed, got %', coalesce(p_status, 'null');
  end if;

  select id, user_id, title, link
    into v_note
    from public.fh_notifications
   where id = p_notification_id;

  if v_note.id is null then
    raise exception 'fh_follow_up_set_status: notification % not found', p_notification_id;
  end if;

  if v_note.user_id is distinct from auth.uid() then
    raise exception 'fh_follow_up_set_status: notification % does not belong to the caller', p_notification_id;
  end if;

  -- The contact id is the last path segment of the link. A link that does
  -- not end in a uuid leaves no follow up to close; the notification is
  -- still marked read.
  begin
    v_contact_id := nullif(regexp_replace(coalesce(v_note.link, ''), '^.*/', ''), '')::uuid;
  exception when others then
    v_contact_id := null;
  end;

  v_follow_up_status := case p_status when 'done' then 'done' else 'skipped' end;

  if v_contact_id is not null then
    update public.fh_follow_ups
       set status = v_follow_up_status,
           completed_at = now(),
           completed_by = auth.uid()
     where contact_id = v_contact_id
       and headline = v_note.title
       and status = 'queued';
  end if;

  update public.fh_notifications
     set read_at = coalesce(read_at, now())
   where id = p_notification_id;
end;
$$;

revoke execute on function public.fh_follow_up_set_status(uuid, text) from public;
revoke execute on function public.fh_follow_up_set_status(uuid, text) from anon;
grant execute on function public.fh_follow_up_set_status(uuid, text) to authenticated;

comment on function public.fh_follow_up_set_status(uuid, text) is
  'Marks the follow up behind a reminder notification done or skipped (the app says dismissed) and marks the notification read. Only the notification''s owner may call it.';
