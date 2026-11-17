-- Customer links for quotes and for invoices billed straight to a client.
--
-- Migration 053 required every link that is not a statement to name a job
-- (contact_id). Migration 092 then moved quotes into fh_quotes and the app
-- began minting proposal links with quote_id and no job, and invoice links
-- with client_id and no job. The old rule refuses both inserts, so "Share
-- link" on a quote made after October 2026, and on an invoice with no job,
-- fails in production. Production had no customer links at all on
-- 2026-11-17.
--
-- The new rule:
--   statement     needs client_id
--   proposal      needs quote_id or contact_id
--   invoice       needs contact_id or client_id
--   change_order  needs contact_id and change_order_id
--
-- Replacing a check needs one statement that removes the old one, so the
-- database tool asks the owner to approve this file. Apply it from the
-- Supabase SQL editor or approve the prompt.

alter table public.fh_public_links
  drop constraint if exists fh_public_links_scope_check;

alter table public.fh_public_links
  add constraint fh_public_links_scope_check check (
    (kind = 'statement' and client_id is not null)
    or (kind = 'proposal' and (quote_id is not null or contact_id is not null))
    or (kind = 'invoice' and (contact_id is not null or client_id is not null))
    or (kind = 'change_order' and contact_id is not null and change_order_id is not null)
  ) not valid;

alter table public.fh_public_links validate constraint fh_public_links_scope_check;
