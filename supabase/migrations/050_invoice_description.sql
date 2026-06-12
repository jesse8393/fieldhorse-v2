-- 050 — Invoice description
--
-- "What is this bill for?" — a customer-facing description on each
-- invoice. Critical for repeat clients with multiple properties: the
-- line item used to print just "Final balance" with an empty
-- description column. Prefilled in the Send Invoice sheet from the
-- job title + address, editable before sending.

alter table public.fh_invoices
  add column if not exists description text;
