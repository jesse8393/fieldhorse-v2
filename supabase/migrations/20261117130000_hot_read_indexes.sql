-- Indexes for the reads every open makes (PERF-12). Additive only.

-- Home, Schedule and Jobs read a company's visits in a start_at range.
-- Only (user_id, start_at) and (org_id) alone existed, so every such read
-- sorted the company's visits, and the table only grows.
create index if not exists fh_schedule_org_start_idx on public.fh_schedule (org_id, start_at);

-- Foreign keys with no index: changing or removing a quote, or a quote
-- version, scanned the whole table that points at it.
create index if not exists fh_leads_quote_idx on public.fh_leads (quote_id);
create index if not exists fh_quotes_approved_version_idx on public.fh_quotes (approved_version_id);
