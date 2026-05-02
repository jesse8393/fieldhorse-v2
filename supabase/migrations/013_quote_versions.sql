-- Fieldhorse v2 — migration 013
-- Quote approval snapshots.
--
-- Phase 4C-1: an immutable record of every approved quote. fh_quote_items
-- (migration 011) carries the live working draft; this table carries the
-- frozen artifact. Each contact accumulates v1, v2, v3… as quotes are
-- re-approved after revisions; prior versions are flagged 'superseded'
-- but kept for the legal trail.
--
-- The table is sized for the eventual customer-facing e-sign flow
-- (Phase 4C-5): signature payload columns + approval token + IP / UA
-- columns are present but nullable, unused in v1, ready for v2 without
-- another migration. The third "anonymous-read-by-token" RLS policy is
-- intentionally NOT added here; it lands when the public route does.
--
-- Idempotent. Owner + accepted-partner RLS pattern mirrors fh_quote_items
-- (migration 011) and fh_job_todos (migration 006). Reuses 004's
-- fh_job_partners join for partner access.

-- ============================================================
-- A) TABLE
-- ============================================================
create table if not exists public.fh_quote_versions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  contact_id uuid not null references public.fh_contacts(id) on delete cascade,

  version_number integer not null,
  status text not null default 'approved'
    check (status in ('approved', 'superseded', 'rejected', 'expired')),

  -- Frozen artifact — the entire quote at approval moment. Keeping the
  -- full snapshot in jsonb means later edits / deletes on fh_quote_items
  -- can never alter the legal record. base_total / optional_total /
  -- excluded_count are denormalized for fast list queries (Invoice
  -- derivation in Phase 5 will read from these without unpacking jsonb).
  snapshot jsonb not null,
  base_total numeric not null default 0,
  optional_total numeric not null default 0,
  excluded_count integer not null default 0,

  -- Approval metadata (operator-side v1)
  approval_method text not null
    check (approval_method in (
      'verbal', 'text', 'email', 'in_person',
      'signature_typed', 'signature_drawn', 'esign_link'
    )),
  approved_by_name text not null,
  approved_by_email text,
  approval_note text,
  approved_at timestamptz not null default now(),

  -- Signature payload — nullable in v1, populated by 4C-4 capture UI.
  -- signature_data holds either the typed name or a base64 data URL
  -- of the drawn stroke. signature_file_id points at a saved
  -- certificate PDF in fh_job_files when one was generated.
  signature_kind text
    check (signature_kind is null or signature_kind in ('typed', 'drawn')),
  signature_data text,
  signature_file_id uuid references public.fh_job_files(id) on delete set null,

  -- Public e-sign forward-compat (Phase 4C-5). Token is generated
  -- only when a customer-facing approval link is issued; v1 leaves
  -- it null. inet + user_agent are captured by the future public
  -- route on customer approval.
  approval_token text unique,
  token_expires_at timestamptz,
  client_ip inet,
  client_user_agent text,

  -- PDF artifact at approval (Phase 4C-3 will populate this).
  pdf_file_id uuid references public.fh_job_files(id) on delete set null,

  -- Supersede chain — each new approval marks prior approved rows
  -- for the same contact as 'superseded' with a back-reference to
  -- the new id. Self-referential FK is fine inline.
  superseded_at timestamptz,
  superseded_by uuid references public.fh_quote_versions(id),

  created_at timestamptz not null default now(),

  unique (contact_id, version_number)
);

create index if not exists idx_fh_quote_versions_contact
  on public.fh_quote_versions (contact_id, version_number desc);

create index if not exists idx_fh_quote_versions_user
  on public.fh_quote_versions (user_id, created_at desc);

-- Partial index — token lookups happen only on the public route, and
-- most rows have null tokens (v1 operator-side approval), so a partial
-- index keeps it tiny.
create index if not exists idx_fh_quote_versions_token
  on public.fh_quote_versions (approval_token)
  where approval_token is not null;

-- ============================================================
-- B) RLS — owner + accepted-partner pattern matching fh_quote_items
-- ============================================================
alter table public.fh_quote_versions enable row level security;

drop policy if exists "fh_quote_versions_own" on public.fh_quote_versions;
create policy "fh_quote_versions_own" on public.fh_quote_versions
  for all to authenticated
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists "fh_quote_versions_partner" on public.fh_quote_versions;
create policy "fh_quote_versions_partner" on public.fh_quote_versions
  for all to authenticated
  using (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_quote_versions.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  )
  with check (
    exists (
      select 1 from public.fh_job_partners p
      where p.job_id = fh_quote_versions.contact_id
        and p.partner_user_id = auth.uid()
        and p.status = 'accepted'
        and p.deleted_by_partner_at is null
    )
  );

-- NOTE: anonymous-read-by-token policy intentionally NOT added here.
-- That third policy lands together with the /quote-approval/:token
-- public route in Phase 4C-5 so the surface and the policy ship as
-- one reviewable unit.

-- ============================================================
-- C) fh_contacts.approved_quote_version_id
--    Quick-lookup pointer to the latest approved version. Set by
--    fn_approve_quote_version below; nullable because contacts may
--    never reach approval. Additive, no backfill.
-- ============================================================
alter table public.fh_contacts
  add column if not exists approved_quote_version_id uuid
    references public.fh_quote_versions(id) on delete set null;

-- ============================================================
-- D) proposal_status CHECK constraint — DEFERRED
-- ============================================================
-- The audit could not enumerate distinct live values of
-- fh_contacts.proposal_status because anon RLS blocks reading any
-- contact rows. Adding a CHECK without that visibility risks aborting
-- the migration on a single dirty row (e.g. capitalized 'Sent', stale
-- legacy default). The locked value set is:
--
--   'draft', 'sent', 'viewed', 'approved', 'rejected', 'expired'
--
-- 4C-2 will run a SELECT distinct probe in the Supabase SQL Editor,
-- normalize any outliers via a one-shot UPDATE, then add the CHECK
-- in a follow-up patch. Doing it then keeps this migration purely
-- additive and re-runnable.

-- ============================================================
-- E) APPROVAL FUNCTION
--    fn_approve_quote_version() — atomically create a new approved
--    version, supersede any prior approved versions for the same
--    contact, and update fh_contacts.approved_quote_version_id +
--    proposal_status.
--
--    SECURITY DEFINER bypasses RLS so the supersede UPDATE on prior
--    rows runs even when invoked by an accepted partner who has only
--    contact-scoped access. search_path is locked to public to defend
--    against schema-tampering tricks. Defense-in-depth: the function
--    re-validates that auth.uid() matches p_user_id AND that the
--    caller has owner-or-accepted-partner access to the contact —
--    refuses with 'unauthorized' otherwise.
--
--    Stage transition (stage='quote' → stage='job') and kickoff
--    schedule insertion are deliberately NOT done here. 4C-2 keeps
--    the existing app-level approveQuote() pipeline call separate so
--    operators can choose to lock the snapshot without yet committing
--    to a stage advance.
-- ============================================================

create or replace function public.fn_approve_quote_version(
  p_user_id uuid,
  p_contact_id uuid,
  p_snapshot jsonb,
  p_base_total numeric,
  p_optional_total numeric,
  p_excluded_count integer,
  p_approval_method text,
  p_approved_by_name text,
  p_approved_by_email text default null,
  p_approval_note text default null,
  p_signature_kind text default null,
  p_signature_data text default null
)
returns public.fh_quote_versions
language plpgsql
security definer
set search_path = public
as $$
declare
  caller uuid;
  next_version integer;
  new_row public.fh_quote_versions;
begin
  caller := auth.uid();
  if caller is null or caller <> p_user_id then
    raise exception 'unauthorized: caller does not match p_user_id';
  end if;

  -- Caller must own the contact or be an accepted partner. Bypassed
  -- security-definer means we cannot rely on RLS for this gate.
  if not exists (
    select 1
    from public.fh_contacts c
    where c.id = p_contact_id
      and (
        c.user_id = caller
        or exists (
          select 1 from public.fh_job_partners pj
          where pj.job_id = c.id
            and pj.partner_user_id = caller
            and pj.status = 'accepted'
            and pj.deleted_by_partner_at is null
        )
      )
  ) then
    raise exception 'unauthorized: contact not accessible';
  end if;

  -- Next version_number is monotonic per contact across all statuses
  -- (approved + superseded + rejected + expired), so the unique
  -- (contact_id, version_number) constraint is never violated by a
  -- supersede + re-approve cycle.
  select coalesce(max(version_number), 0) + 1
    into next_version
    from public.fh_quote_versions
    where contact_id = p_contact_id;

  insert into public.fh_quote_versions (
    user_id, contact_id, version_number, status,
    snapshot, base_total, optional_total, excluded_count,
    approval_method, approved_by_name, approved_by_email, approval_note,
    signature_kind, signature_data
  )
  values (
    p_user_id, p_contact_id, next_version, 'approved',
    p_snapshot, p_base_total, p_optional_total, p_excluded_count,
    p_approval_method, p_approved_by_name, p_approved_by_email, p_approval_note,
    p_signature_kind, p_signature_data
  )
  returning * into new_row;

  -- Supersede any earlier approved rows for the same contact. Skip
  -- the row we just inserted. Status 'rejected' / 'expired' are
  -- left untouched since they're terminal and not "the current
  -- approved version".
  update public.fh_quote_versions
     set status = 'superseded',
         superseded_at = now(),
         superseded_by = new_row.id
   where contact_id = p_contact_id
     and id <> new_row.id
     and status = 'approved';

  -- Point the contact at the new approved version + flip proposal_status.
  update public.fh_contacts
     set approved_quote_version_id = new_row.id,
         proposal_status = 'approved'
   where id = p_contact_id;

  return new_row;
end;
$$;

-- Allow authenticated callers to invoke the function. RLS still applies
-- to the SELECT inside the function via the caller-context check above;
-- the function itself runs with definer privileges only for the
-- table writes.
grant execute on function public.fn_approve_quote_version(
  uuid, uuid, jsonb, numeric, numeric, integer, text, text, text, text, text, text
) to authenticated;

-- ============================================================
-- Verify (run manually after applying):
--
--   select column_name from information_schema.columns
--   where table_schema = 'public' and table_name = 'fh_quote_versions';
--   -- expect 26 rows
--
--   select indexname from pg_indexes
--   where tablename = 'fh_quote_versions';
--   -- expect 4 (PK + 3 created indexes)
--
--   select polname from pg_policies
--   where tablename = 'fh_quote_versions';
--   -- expect 2 (own, partner)
--
--   select column_name from information_schema.columns
--   where table_schema = 'public'
--     and table_name = 'fh_contacts'
--     and column_name = 'approved_quote_version_id';
--   -- expect 1 row
--
--   select proname from pg_proc
--   where proname = 'fn_approve_quote_version';
--   -- expect 1 row
--
--   -- Pre-CHECK probe for 4C-2: list every distinct proposal_status
--   -- so the lifecycle CHECK can be added safely.
--   select proposal_status, count(*)
--   from public.fh_contacts
--   group by proposal_status
--   order by count(*) desc;
-- ============================================================
