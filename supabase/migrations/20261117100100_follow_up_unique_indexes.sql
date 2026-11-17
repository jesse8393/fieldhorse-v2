-- 20261117100100_follow_up_unique_indexes.sql
--
-- Audit finding AUTO-03. One open reminder per record and person, and one
-- notification per follow up and person, held by the database.
--
-- Apply after 20261117100000_follow_ups_in_step.sql and after the cleanup in
-- supabase/manual/20261117_follow_up_cleanup.sql has been committed: a
-- unique index cannot be built while duplicates are still queued. The guard
-- below stops with a plain message when any are left, so nothing half
-- builds. If both migrations were pushed together and this one stopped, run
-- the cleanup and push again.
--
-- Kept as they are: fh_follow_ups_one_open_per_client_kind_idx (091) and the
-- older unique (contact_id, kind) where queued.
--
-- Checked by scripts/validate-follow-ups-sql.mjs (npm run test:db).

do $$
declare
  v_leads integer; v_quotes integer; v_notes integer;
begin
  select count(*) into v_leads from (
    select 1 from public.fh_follow_ups where status = 'queued' and lead_id is not null
     group by lead_id, user_id having count(*) > 1) d;
  select count(*) into v_quotes from (
    select 1 from public.fh_follow_ups where status = 'queued' and quote_id is not null
     group by quote_id, user_id having count(*) > 1) d;
  select count(*) into v_notes from (
    select 1 from public.fh_notifications where follow_up_id is not null
     group by follow_up_id, user_id having count(*) > 1) d;
  if v_leads + v_quotes + v_notes > 0 then
    raise exception 'Run the cleanup in supabase/manual/20261117_follow_up_cleanup.sql first: % leads, % quotes and % follow ups still have more than one open row.',
      v_leads, v_quotes, v_notes;
  end if;
end $$;

create unique index if not exists fh_follow_ups_one_open_per_lead_person_idx
  on public.fh_follow_ups (lead_id, user_id)
  where status = 'queued' and lead_id is not null;

create unique index if not exists fh_follow_ups_one_open_per_quote_person_idx
  on public.fh_follow_ups (quote_id, user_id)
  where status = 'queued' and quote_id is not null;

create unique index if not exists fh_notifications_one_per_follow_up_person_idx
  on public.fh_notifications (follow_up_id, user_id)
  where follow_up_id is not null;
