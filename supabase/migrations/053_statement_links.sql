-- 052 — Statements: shareable public link (client-scoped)
--
-- Proposal / invoice / change_order links all hang off a single job
-- (contact_id). A statement is different: it rolls up EVERY open job
-- for one client, so it's scoped to fh_clients, not fh_contacts.
--
-- This migration widens fh_public_links to carry a client_id and lets
-- statement links leave contact_id null. The customer opens /p/:token
-- and sees the same rolled-up balance the contractor emails as a PDF,
-- now as a live web page.

alter table public.fh_public_links
  add column if not exists client_id uuid
  references public.fh_clients(id) on delete cascade;

-- Statement links are client-scoped; contact_id is meaningless for
-- them, so it can no longer be NOT NULL across the table.
alter table public.fh_public_links
  alter column contact_id drop not null;

-- Widen the kind whitelist to include 'statement'.
alter table public.fh_public_links
  drop constraint if exists fh_public_links_kind_check;

alter table public.fh_public_links
  add constraint fh_public_links_kind_check
  check (kind in ('proposal', 'invoice', 'change_order', 'statement'));

-- Integrity: a statement link must carry a client_id; every other
-- kind must carry a contact_id. Prevents a mis-minted token that
-- resolves to nothing (or to the wrong scope).
alter table public.fh_public_links
  drop constraint if exists fh_public_links_scope_check;

alter table public.fh_public_links
  add constraint fh_public_links_scope_check
  check (
    (kind = 'statement' and client_id is not null) or
    (kind <> 'statement' and contact_id is not null)
  );

create index if not exists idx_fh_public_links_client
  on public.fh_public_links(client_id);
