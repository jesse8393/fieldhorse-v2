-- 056 — Tag source on fh_clients (mirrors fh_contacts.source from 054).
--
-- Lets the "Remove sample data" control delete ONLY demo-seeded rows
-- (source = 'demo') instead of every row for the user. Additive + nullable.

alter table public.fh_clients
  add column if not exists source text;
