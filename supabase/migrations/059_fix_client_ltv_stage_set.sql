-- 059 — fh_clients.total_lifetime_value: count the pipeline-v2 won set.
--
-- The recompute from migration 007 predates pipeline v2: it sums
-- lifetime value over stage in ('invoice','closed'), but migration 047
-- converted every 'invoice' row to 'job' and retired the stage — so
-- active and completed-but-unpaid jobs contribute $0 to the cached LTV.
-- The Clients screen already ignores the column as "stale", but it is
-- still trigger-maintained, typed, and one future consumer away from
-- shipping a wrong number.
--
-- Aligned with src/lib/rollups.ts `lifetime`: won deals only
-- (job + closed, with 'invoice' kept as the legacy alias).

create or replace function public.fh_clients_recompute(p_client_id uuid)
returns void
language plpgsql
as $$
begin
  if p_client_id is null then return; end if;
  update public.fh_clients c
  set
    active_jobs_count = coalesce(agg.active_count, 0),
    total_lifetime_value = coalesce(agg.ltv, 0),
    last_activity_at = coalesce(agg.last_at, c.last_activity_at),
    updated_at = now()
  from (
    select
      count(*) filter (where stage in ('lead','quote','job','invoice')) as active_count,
      coalesce(sum(amount) filter (where stage in ('job','invoice','closed')), 0) as ltv,
      max(updated_at) as last_at
    from public.fh_contacts
    where client_id = p_client_id
  ) agg
  where c.id = p_client_id;
end $$;

-- Backfill every client row once with the corrected definition.
do $$
declare r record;
begin
  for r in select id from public.fh_clients loop
    perform public.fh_clients_recompute(r.id);
  end loop;
end $$;
