# Fieldhorse: separate records and no pop ups (Phase 9)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A lead, a quote, a job and an invoice are four separate records that can each be created on their own at any time, every create and edit is a full screen instead of a pop up sheet, and the app asks for the fewest taps possible.

**Architecture:** The client (`fh_clients`) is the root. Jobs stay on `fh_contacts`, which already carries everything a job needs (schedule, crew, photos, files, time punches, payments, change orders). Leads and quotes move to two new tables, `fh_leads` and `fh_quotes`, each pointing at a client. Invoices stay on `fh_invoices` and gain a `client_id` so one can exist with no job. Links between records are optional pointers set only when the person taps a button (Quote this, Make this a job, Invoice this). Every pop up sheet becomes a route.

**Tech stack:** React 18, react-router, TypeScript, TanStack Query, Supabase (Postgres, RLS, pg_cron), Vitest, Playwright, the `fh` component library and `--fh-` tokens.

**Spec:** This file, plus `docs/design/2026-10-redesign/SPEC.md` section 17 (decisions D1 to D52, and D53 onward recorded by this phase).

**Why this plan exists.** The owner's words on October 19: "leads, quotes, job, invoice still are a process but they need to be separate. I should be able to create any of them at any time without starting to be a lead." "If I choose quote, job or invoice, the lead screens shouldn't come up." "Leads need a schedule estimate and quote this button." "I hate the pop up little screens." "Everything is about efficiency." He also showed an invoice PDF whose Description column printed the job title, and a notifications pop up full of repeated reminders.

**What the research found.** `fh_contacts` is one table with a `stage` column (lead, quote, job, closed, lost). A quote is a lead whose stage flipped. Quote lines, the customer link, approvals, the schedule, photos, time punches and invoices all hang off that one row. Production holds 195 of these rows across 7 companies (64 lead, 25 quote, 31 job, 62 closed, 13 lost), 173 clients, 66 invoices and 206 quote lines. The repeated reminders in the notifications list are not an engine bug: Mary Ward has three job records, so she gets three review asks; Justin Bryan has five records. Reminders are per deal and should be per client. None of them was sent to a customer. Thirty four pop up surfaces exist (11 `fh` Sheets, 16 shadcn Drawers, 7 ActionSheets, plus confirms and dialogs). `/invoices/:id` takes a job id, not an invoice id. The invoice description column exists in the database (migration 050) but the draws editor and the detail screen never show it.

## Run rules

### Setup

1. Read `SPEC.md` section 17 and `PROGRESS.md`. Then read the four research summaries in this file's "Research notes" section at the end.
2. Branch `redesign/phase-9` from `main` (main carries phases 1 to 8 as of `0c7d8e8`). Open one draft pull request titled "Separate leads, quotes, jobs and invoices, and no pop ups" against `main`.
3. Add a "Phase 9" section to `PROGRESS.md` with one line per task (status todo, done, blocked, skipped; commit hash; one line of notes). Commit before writing code.
4. Baseline: run `npm run test:all` once and list anything already failing under "Failing before Phase 9". The gate from then on is no new failures.
5. Record new decisions in `SPEC.md` section 17 starting at **D53**. Never reuse a number. The decisions this plan already makes are listed under "Decisions to record" below; write them in before Task 1.
6. If context gets compacted or a new session picks this up, read `PROGRESS.md` first and continue from the first task that is not done.

### How to work

* Test first. Every task names the tests that must fail before and pass after.
* One commit per task, plain sentence case message, `PROGRESS.md` updated in the same commit.
* Unit tests that read the local time pin `TZ=America/Chicago`. Time dependent e2e tests pin `page.clock`.
* The test mock (`scripts/qa-mock.mjs`) does not save writes. Tasks that need a write to show up seed the result with the `tables` option or route the request in the spec.
* No dashes in anything a person sees. Sentence case labels. Plain words.

### Database rules for this phase

The owner has given permission to change the database (October 19). The rules that keep that safe:

* Every change is a file in `supabase/migrations/` first, applied with `mcp__Supabase__apply_migration`, never typed into the SQL editor.
* Every migration is additive and reversible: new tables, new nullable columns, new indexes, backfills that copy. Nothing drops a table or column in this phase. Old rows that moved are marked, not deleted (D56).
* Before a migration touches production, run it against a fresh copy: `pg_dump` the schema plus the `fh_*` tables into a scratch database (the Supabase project has no branching, `list_branches` returned none), apply, run the checks in the task, then apply to production.
* After each production migration, regenerate `src/lib/database.types.ts` with `mcp__Supabase__generate_typescript_types` and commit it in the same task.
* Never run a statement that deletes rows outside a migration, and never run SQL against production from a test.
* `netlify/functions/` and `supabase/functions/` may change in this phase where a task names the file.

### Never do these

* Never merge any pull request. Never push to `main`. The owner merges after the preview. Never touch Netlify settings, environment variables or secrets.
* Never send an email, text or message, and never call `/api/send-*`, `/api/docusign-send` or `fh_send_message` outside mocked tests.
* Never delete or weaken an existing test to make a build pass. Never use `--no-verify`. Never add a dependency.
* Never use `git reset --hard` past another task's work, `git clean -x` or a force push.

### When something goes wrong

* After a careful debugging pass and three fix attempts, undo that task with `git revert` of its own commits, mark it `blocked` with the error and what you tried, and continue with the next task that does not depend on it. A blocked migration is reverted with a new down migration that drops only what the blocked one added, never by hand.
* If the plan and the code disagree, follow the intent, note the difference in `PROGRESS.md`, and keep going.
* If a decision is not covered, pick the option with the fewest taps for the owner, record it as a new D number, and keep going.

### Finish

Run `npm run test:all` and `npm run audit:design`. Take phone and desktop screenshots of every new screen (the New menu, each of the four create screens, a lead with its two buttons, a quote with Make this a job, a job with Invoice this, the invoice screen, the notifications screen, the invoice PDF with its description). Push. Update the draft pull request with the screenshots. Write a "Phase 9 summary" at the top of `PROGRESS.md` for the owner in plain words with no dashes: what changed, what is blocked, new decisions, what the migration did to his data in numbers, and an iPhone checklist.

---

## Decisions to record (D53 onward)

| # | Title | Decision |
|---|---|---|
| D53 | Four records, one client | A client is the root. A lead, a quote, a job and an invoice are separate records, each with a `client_id`. Any of the four can be created at any time with no other record first. A lead is information from a customer who has no quote yet. |
| D54 | Links only by a tap | A quote points at the lead it came from, a job at the quote it came from, an invoice at the job it bills, and each pointer is set only when the person taps Quote this, Make this a job or Invoice this. Nothing changes a record's type on its own. An approved quote stays a quote; the job it becomes is a new record that copies scope and price. |
| D55 | Jobs keep their table | Jobs stay on `fh_contacts`. Its `stage` keeps only `job`, `closed` and `lost`. Leads live in `fh_leads` with status `open`, `quoted` or `lost`. Quotes live in `fh_quotes` with status `draft`, `sent`, `viewed`, `changes_requested`, `approved`, `rejected`, `expired` or `lost`. |
| D56 | Moved rows are marked, not deleted | The migration copies lead and quote rows into the new tables and sets the old row's `stage` to `moved_lead` or `moved_quote`. Every screen, query, view and function ignores those two stages. Each new row keeps `origin_contact_id` so notes, files and visits attached to the old row stay reachable. A cleanup migration in a later phase deletes the marked rows once the owner confirms nothing is missing. |
| D57 | No pop up sheets | Every create, edit, choose and confirm is a full screen with its own route, reached by a tap and left by Back. The dock and header stay. Destructive actions confirm in place with a second tap on the same button ("Delete" becomes "Tap again to delete" for 4 seconds). Capture becomes the screen `/capture`. The `fh` Sheet, the shadcn Drawer and ActionSheet are removed from the app once every caller has a route. |
| D58 | One New menu | One New button (phone: the gold coin's long press menu is gone; a New button sits in the header; desktop: the sidebar New row and ⌘N) opens `/new`, a full screen with four rows: Lead, Quote, Job, Invoice, plus Client under them. Each row goes straight to that record's create screen. No chooser asks "who is this for" first; the client is picked or typed on the create screen itself. |
| D59 | Fewest taps | Every create screen saves with one tap and lands on the record it made. Required fields: Lead needs a name; Quote needs a client; Job needs a client and a title; Invoice needs a client and an amount. Everything else can be filled later. A new client is created in place by typing a name that matches nobody. |
| D60 | Lead buttons | A lead screen has two buttons: Schedule estimate (opens `/schedule/new?lead=:id` with the lead's address and name filled, title "Estimate", and books an `fh_schedule` row with `lead_id`) and Quote this (opens `/quotes/new?lead=:id` with the client, title and notes filled, and marks the lead `quoted` with `quote_id` once the quote saves). |
| D61 | Quote and job buttons | A quote has Make this a job (creates a job with the quote's client, title, scope, amount and terms, sets `fh_quotes.job_id`, and lands on the job). A job has Invoice this (opens `/invoices/new?job=:id` with the client and the balance filled). Both are available regardless of status; an unapproved quote can still become a job, since the owner decides, not the software. |
| D62 | Invoices stand alone | `fh_invoices` gets `client_id` and `contact_id` becomes nullable. An invoice with no job bills the client directly. The invoice has a Description field that prints in the PDF Description column and in the email, prefilled with the job title when there is a job and blank otherwise. `/invoices/:id` means an invoice row; a job's money lives at `/jobs/:id?tab=financials`. |
| D63 | Reminders per client | The follow up engine keys on the client, not the deal. One open reminder per client and kind. Lost leads, lost quotes and lost jobs get no reminders. A reminder can be marked Done or Dismissed from the notifications screen, and that closes the `fh_follow_ups` row. |
| D64 | Notifications are a screen | `/notifications` replaces the bell's pop up. The bell navigates there. Each row opens its record. Reminders show Done and Dismiss. |
| D65 | Lists | Jobs shows jobs (`/jobs`). Quotes shows quotes (`/quotes`). Leads shows leads (`/leads`). Money shows invoices. The phone dock keeps Today, Jobs, Capture, Money, Schedule; Leads and Quotes are tabs on the Jobs screen and routes of their own. `/work` redirects to `/jobs`. |

---

## Review focus

Five things no task's tests fully exercise and that would bite the owner first. Each line names the test that pins it in the owning task.

1. A client with two open leads and one quote: Quote this on the second lead must link only that lead. Pinned in Task 9 (`leads.spec.ts`, "Quote this links the lead it came from").
2. A quote whose lines total $0 pressed Make this a job: the job gets amount 0 and no deposit sentence, never a crash. Pinned in Task 10 (`quoteToJob.test.ts`, "a quote with no lines makes a job with no amount").
3. An invoice with no job on the Money screen and on the customer link: the PDF has no Contract position block, and the balance is the invoice amount less its payments. Pinned in Task 12 (`invoices.test.ts`, "an invoice with no job settles against itself").
4. The migration on a company whose quote has a customer link already approved: the link keeps working at `/p/:token` and still shows approved. Pinned in Task 6 (`migration.test.ts`, "approved public links survive the move").
5. A screen opened from a notification that points at a moved row (`/leads/:oldId`): it redirects to the new lead by `origin_contact_id`. Pinned in Task 7 (`redirects.spec.ts`, "an old lead link lands on the new lead").

---

## Tier 1: ship this week, no data changes

### Task 1: The invoice description reaches the PDF and the email

The database column exists. The create sheet prefills it with the job title and nothing lets the owner edit it afterwards, so the PDF prints the job title.

**Files:**
- Modify: `src/screens/ContactDetail/sections/InvoiceDrawsSection.tsx` (the `Editor` form near line 826 and `handleSave` near 131)
- Modify: `src/screens/InvoiceDetail.tsx` (the Service block near 720 and the PDF line item near 213)
- Modify: `src/lib/invoices.ts` (`generateInvoicePdf`, description fallback near 182)
- Test: `src/lib/invoices.test.ts`, `tests/e2e/invoice-actions.spec.ts`

**Interfaces:**
- Produces: `invoiceDescription(invoice, contact): string` in `src/lib/invoices.ts`, exported. Returns `invoice.description` trimmed, else `contact?.job_title`, else `'Construction services'`. Every PDF and email path calls it.

- [ ] Write the failing unit test `invoiceDescription prefers the invoice's own description over the job title` and `invoiceDescription falls back to the job title then to Construction services`.
- [ ] Run `npx vitest run src/lib/invoices.test.ts` and see it fail with "invoiceDescription is not exported".
- [ ] Implement `invoiceDescription` and use it in `generateInvoicePdf` for the line item `notes` and in `InvoiceDetail.tsx` for the PDF line item and the Service block text.
- [ ] Add a Description field to the draws `Editor` (a `Field` labelled "Description, shows on the invoice", saved to `description`). Add the same field to the invoice detail screen in edit mode (Task 12 replaces this screen; keep this change small).
- [ ] Write the failing e2e `an invoice's description prints in the PDF text and the Service block` using a seeded `fh_invoices` row with `description: 'Deposit for the shed slab'` and asserting the Service block shows it, not the job title.
- [ ] Run the unit test and the e2e on `mobile-chrome` and see them pass.
- [ ] Commit: "Show the invoice's own description on the invoice screen and in its PDF".

### Task 2: Notifications become a screen with Done and Dismiss

**Files:**
- Create: `src/screens/Notifications.tsx`, `src/screens/notifications/notifications.css` (prefix `fhn-`)
- Modify: `src/components/NotificationsBell.tsx` (the bell becomes a link to `/notifications`; delete the Drawer)
- Modify: `src/App.tsx` (route `/notifications`)
- Modify: `src/lib/notifications.ts` (add `completeFollowUp`, `dismissFollowUp`)
- Create migration: `supabase/migrations/090_follow_up_actions.sql`: an RPC `fh_follow_up_set_status(p_notification_id uuid, p_status text)` that finds the `fh_follow_ups` row whose `headline` and `contact_id` match the notification's title and link, sets `status` to `done` or `dismissed` with `completed_at` and `completed_by`, and marks the notification read. Security definer, checks the caller owns the notification.
- Test: `tests/e2e/notifications.spec.ts`

**Interfaces:**
- Produces: route `/notifications`; `completeFollowUp(notificationId)` and `dismissFollowUp(notificationId)` in `src/lib/notifications.ts`, both calling the RPC.

- [ ] Write the failing e2e `the bell opens the notifications screen, not a sheet` (tap the bell, expect URL `/notifications` and no `role="dialog"`), `a reminder shows Done and Dismiss and the row leaves the list` (seed one `follow_up_due` notification; tapping Done calls `fh_follow_up_set_status` with `done`, checked through `rpcCalls`), and `tapping a notification opens its link`.
- [ ] Run and see them fail.
- [ ] Build the screen: header "Notifications", "Mark all read" as a plain button, rows from `fetchInbox(100, userId)`, loading skeleton and a "Couldn't load" state with Try again per D49, Done and Dismiss buttons only on kinds `follow_up_due` and `review_ask_due`.
- [ ] Write the migration, test it on the copy database with one inserted follow up and notification, apply it, regenerate types.
- [ ] Run the e2e on both projects and see it pass. Run `npm run audit:design`.
- [ ] Commit: "Move notifications to their own screen and let a reminder be done or dismissed".

### Task 3: Reminders stop for lost deals and run per client

**Files:**
- Create migration: `supabase/migrations/091_follow_up_engine_per_client.sql`. Replaces `public.fh_run_follow_up_engine` (its current body is in the Research notes) so that: the scored set excludes `stage = 'lost'` and any contact whose `client_id` has an open follow up of the same kind; the review ask excludes clients who already have a `review_ask` row in the last 180 days; `fh_follow_ups` gains `client_id uuid` (backfilled from the contact) and a partial unique index `(client_id, kind) where status = 'queued'`. The old per contact index stays.
- Modify: `supabase/README.md` (record that the engine body now lives in the repo)
- Test: `supabase/tests/follow_up_engine.test.sql` (new; a plain SQL script run against the copy database with `psql`, asserting counts)

- [ ] Write the SQL test: insert one client with two lead contacts, run the engine, assert exactly one `day3` row for that client; insert one lost contact with a stale `last_contact`, run, assert zero rows for it; insert one client with two closed jobs completed 10 days ago, run, assert one `review_ask`.
- [ ] Run it against the copy and see the two client assertions fail with the current engine.
- [ ] Write the migration. Run the SQL test on the copy and see it pass.
- [ ] On the copy, run a one off query that closes duplicate queued rows (`status = 'dismissed'` for every queued row except the newest per `client_id, kind`) and read back the count. Include the same statement in the migration so production gets the same cleanup, and record the production count in `PROGRESS.md`.
- [ ] Apply to production. Regenerate types.
- [ ] Commit: "Run follow up reminders per client, skip lost deals, and close the duplicates".

---

## Tier 2: the data split

### Task 4: New tables for leads and quotes

**Files:**
- Create migration: `supabase/migrations/092_leads_and_quotes.sql`
- Modify: `src/lib/database.types.ts` (regenerated)
- Test: `supabase/tests/leads_quotes_schema.test.sql`

**Interfaces (produces, exact columns):**

`fh_leads`: `id uuid pk default gen_random_uuid()`, `org_id uuid not null`, `user_id uuid not null`, `client_id uuid not null references fh_clients(id)`, `title text` (what they need), `notes text`, `source text`, `referred_by text`, `job_type text`, `status text not null default 'open' check (status in ('open','quoted','lost'))`, `follow_up_on date`, `last_contact date`, `quote_id uuid` (references fh_quotes, added after that table exists), `origin_contact_id uuid references fh_contacts(id) on delete set null`, `created_at timestamptz default now()`, `updated_at timestamptz default now()`.

`fh_quotes`: `id uuid pk`, `org_id uuid not null`, `user_id uuid not null`, `client_id uuid not null references fh_clients(id)`, `lead_id uuid references fh_leads(id) on delete set null`, `job_id uuid references fh_contacts(id) on delete set null`, `title text`, `job_type text`, `scope_text text`, `terms_text text`, `exclusions_text text`, `amount numeric default 0`, `status text not null default 'draft' check (status in ('draft','sent','viewed','changes_requested','approved','rejected','expired','lost'))`, `sent_at timestamptz`, `expires_at timestamptz`, `change_request_note text`, `change_requested_at timestamptz`, `approved_version_id uuid references fh_quote_versions(id)`, `origin_contact_id uuid references fh_contacts(id) on delete set null`, `created_at`, `updated_at`.

New nullable columns: `fh_quote_items.quote_id`, `fh_quote_versions.quote_id`, `fh_public_links.quote_id`, `fh_schedule.lead_id`, `fh_schedule.quote_id`, `fh_notes.lead_id`, `fh_notes.quote_id`, `fh_esign_envelopes.quote_id`, `fh_invoices.client_id`. `fh_invoices.contact_id` drops its not null. `fh_quote_items.contact_id` drops its not null.

RLS: copy every policy on `fh_contacts` to `fh_leads` and `fh_quotes` by name, with `org_id` membership checks identical to `fh_contacts` (read the current policies with `select policyname, qual, with_check from pg_policies where tablename = 'fh_contacts'` first). The `fh_contacts_guard_tenant_columns` trigger pattern (062) is copied for both tables. Triggers `touch updated_at` on both. The `trg_quote_items_recalc` trigger (011) learns to sum into `fh_quotes.amount` when `quote_id` is set and into `fh_contacts.amount` otherwise.

- [ ] Write the SQL test: as an authenticated member of org A, insert a lead and a quote, read them back; as a member of org B, read zero rows; insert two quote items on the quote and assert `fh_quotes.amount` equals their sum.
- [ ] Run on the copy, see it fail (tables missing).
- [ ] Write the migration. Run the test on the copy, see it pass.
- [ ] Apply to production. Regenerate types. Run `npm run typecheck`.
- [ ] Commit: "Add the leads and quotes tables with the links the other records need".

### Task 5: Pure converters and the data layer

**Files:**
- Create: `src/lib/leads.ts`, `src/lib/quotes.ts`, `src/lib/records.ts`
- Create: `src/lib/leads.test.ts`, `src/lib/quotes.test.ts`, `src/lib/records.test.ts`

**Interfaces (produces):**
- `src/lib/records.ts`: `type RecordKind = 'lead' | 'quote' | 'job' | 'invoice' | 'client'`; `recordRoute(kind: RecordKind, id: string): string` returning `/leads/:id`, `/quotes/:id`, `/jobs/:id`, `/invoices/:id`, `/clients/:id`; `newRecordRoute(kind, params?: Record<string,string>)` returning `/leads/new` etc. with a query string.
- `src/lib/leads.ts`: `createLead(input: { userId, orgId, clientId, title?, notes?, source?, referredBy?, jobType?, followUpOn? }): Promise<LeadRow>`; `markLeadQuoted(leadId, quoteId)`; `markLeadLost(leadId)`; `leadToQuoteDraft(lead: LeadRow): Partial<QuoteInsert>` (pure: copies `client_id`, `title`, `job_type`, `notes` into `scope_text`, sets `lead_id`).
- `src/lib/quotes.ts`: `createQuote(input: { userId, orgId, clientId, leadId?, title?, scopeText?, termsText?, jobType? }): Promise<QuoteRow>`; `quoteToJobDraft(quote: QuoteRow, items: QuoteItemRow[]): ContactInsert` (pure: `stage 'job'`, `client_id`, `name` from the client, `job_title` from `title`, `amount` from the sum of non optional non excluded items or 0, `scope_text`, `terms_text`, `exclusions_text`, `job_type`); `makeJobFromQuote(quoteId): Promise<{ jobId }>` (inserts the job, copies items to new `fh_quote_items` rows with `contact_id` set and `quote_id` null so the job's Money tab keeps working, sets `fh_quotes.job_id`); `quoteNumber(companyName, quoteId, issuedAt)` wraps `proposalNumber` with the quote id as seed.

- [ ] Write failing tests: `recordRoute` and `newRecordRoute` for all five kinds; `leadToQuoteDraft` copies the four fields and the lead id; `quoteToJobDraft` sums only base items and gives 0 with no lines (review focus 2); `quoteNumber` keeps the `PC-2026-XXXX` shape and uses the quote id's last four characters.
- [ ] Run, see them fail.
- [ ] Implement. The Supabase calls follow the style of `src/lib/invoices.ts` (`createInvoice`).
- [ ] Run `npx vitest run src/lib/leads.test.ts src/lib/quotes.test.ts src/lib/records.test.ts` and see them pass.
- [ ] Commit: "Add the lead and quote data layer and the record route helpers".

### Task 6: The migration that moves leads and quotes

**Files:**
- Create migration: `supabase/migrations/093_move_leads_and_quotes.sql`
- Create: `scripts/move-counts.mjs` (reads counts before and after through the service role on the copy, prints a table)
- Test: `supabase/tests/move_leads_quotes.test.sql`

The migration, in one transaction:
1. For every `fh_contacts` row with `stage = 'lead'`: insert into `fh_leads` (`client_id` from the row, or `fh_resolve_client` style: find a client in the same org by exact phone or email, else insert a client from the row's name, phone, email, address), `title` from `job_title`, `notes`, `source`, `referred_by`, `job_type`, `status 'open'`, `follow_up_on`, `last_contact`, `origin_contact_id`, `created_at`. Then set the old row `stage = 'moved_lead'`.
2. For every row with `stage = 'quote'`: insert into `fh_quotes` with the same client rule, `title` from `job_title`, `scope_text`, `terms_text`, `exclusions_text`, `amount`, `status` from `proposal_status` (`draft` when null), `sent_at` from `quote_sent_at`, `expires_at` from `quote_expires_at`, change request fields, `approved_version_id` from `approved_quote_version_id`, `origin_contact_id`, `created_at`. Update `fh_quote_items`, `fh_quote_versions`, `fh_public_links` (kind proposal), `fh_esign_envelopes` and `fh_schedule` rows with that `contact_id` to set `quote_id`. Then set the old row `stage = 'moved_quote'`.
3. For every row with `stage = 'lost'` that never had a `job` or `closed` transition in `fh_stage_transitions`: it was a lost lead or quote. Move it into `fh_leads` with `status 'lost'` (or `fh_quotes` with `status 'lost'` when it has quote items or a `quote_sent_at`), mark `moved_lead` or `moved_quote`. Lost rows that were jobs stay as `lost` jobs.
4. `fh_invoices.client_id` backfilled from the job's `client_id`.
5. `fh_follow_ups.client_id` already backfilled by 091; rows whose contact moved keep working through `client_id`.
6. `fh_clients_recompute` (059) learns to count `fh_leads` open rows and `fh_quotes` open rows into `active_jobs_count` alongside `fh_contacts.stage = 'job'`, and to ignore `moved_*`.

- [ ] Write the SQL test on the copy: seed one org with a lead with notes and a visit, a quote with two items and an approved public link, a lost lead, a lost job, a job with an invoice. Run the migration. Assert: `fh_leads` has 2 rows (one `open`, one `lost`), `fh_quotes` has 1 with `amount` equal to the item sum and `status approved`, the public link row carries `quote_id`, the schedule row carries `lead_id`, the lost job is still `stage lost`, the invoice has `client_id`, and the old rows read `moved_lead` and `moved_quote`.
- [ ] Add the Review focus 4 assertion: `select token from fh_public_links where quote_id = :q` returns the approved link and `netlify/functions/public-link.js` (after Task 11) resolves it.
- [ ] Run the test on a fresh copy of production: `scripts/move-counts.mjs` prints before and after counts (contacts by stage, leads, quotes, items with `quote_id`, links with `quote_id`, invoices with `client_id`). Keep that printout in `PROGRESS.md`.
- [ ] Apply to production. Run `move-counts.mjs` against production read only and compare with the copy. Regenerate types.
- [ ] Commit: "Move leads and quotes out of the deals table and link what hung off them".

### Task 7: Old links keep working

**Files:**
- Modify: `src/App.tsx` (`ContactDetailRoute` and new `MovedRecordRedirect`)
- Modify: `src/lib/stages.ts` (`detailRoute` and the stage lists lose `lead`, `quote`, `invoice`; `moved_lead` and `moved_quote` are never shown)
- Modify: `src/lib/queries.ts` (`useJobs`, `INVOICE_JOB_COLUMNS`, `CONTACT_COLUMNS` and every `fh_contacts` read add `.not('stage', 'in', '("moved_lead","moved_quote")')` or filter in code)
- Test: `tests/e2e/redirects.spec.ts`, `src/lib/stages.test.ts`

- [ ] Write the failing e2e `an old lead link lands on the new lead`: seed `fh_contacts` with `c-old` at `stage moved_lead` and `fh_leads` with `l-1` whose `origin_contact_id` is `c-old`; visit `/leads/c-old`; expect URL `/leads/l-1`. Same for a quote. And `moved rows never show on Jobs, Today or Money`.
- [ ] Run, see them fail.
- [ ] Implement the redirect component: it reads `fh_leads` then `fh_quotes` by `origin_contact_id` and navigates with `replace`. Every list query drops the moved stages.
- [ ] Run and see them pass. Run the full e2e suite once here; many specs seed lead and quote stage rows and need their fixtures moved to `fh_leads` and `fh_quotes` in `scripts/qa-mock.mjs` (new default rows `l-lead1`, `l-lead2`, `q-quote`, `q-change`). Fix specs as needed without weakening assertions.
- [ ] Commit: "Send old lead and quote links to their new records and hide moved rows everywhere".

---

## Tier 3: the screens

Each screen below is a full page route with Back in the header. Phone layout first, desktop reuses the same component inside the shell at a 640 px column. All CSS lives in one file per screen with its own prefix (D41): `fhnew-` for `/new`, `fhl-` for leads, `fhqt-` for quotes (`fhq-` is taken by the old quote phone tab), `fhinv-` for the invoice screen, `fhn-` for notifications.

### Task 8: The New screen and the create screens

**Files:**
- Create: `src/screens/New.tsx` (`/new`), `src/screens/leads/LeadNew.tsx` (`/leads/new`), `src/screens/quotes/QuoteNew.tsx` (`/quotes/new`), `src/screens/jobs/JobNew.tsx` (`/jobs/new`), `src/screens/invoices/InvoiceNew.tsx` (`/invoices/new`), `src/screens/clients/ClientNew.tsx` (`/clients/new`)
- Create: `src/components/ClientField.tsx` (one field: type a name, see matches from `fh_clients`, pick one or keep typing to create; replaces ClientPicker inside sheets)
- Modify: `src/components/AppHeader.tsx` (New button), `src/components/DesktopSidebar.tsx` (New row, ⌘N), `src/components/CommandPalette.tsx` (the three New items go to the new routes), `src/components/fh/Dock.tsx` (no long press menu)
- Modify: `src/App.tsx` routes
- Delete: `src/components/NewLeadSheet.tsx`, `src/components/NewQuoteSheet.tsx`, `src/components/NewClientSheet.tsx`, the `?new=1` handling in `src/screens/Work.tsx`, `createDealForClient` in `ClientDetail.tsx` (its three buttons link to the create routes with `?client=:id`)
- Test: `tests/e2e/new.spec.ts`

Fields per screen (D59):
- Lead: Name (ClientField, required), Phone, Address, What they need (title), Notes, Source chips. Save lands on `/leads/:id`.
- Quote: Client (ClientField, required), Title, Job type chips, Scope. Save lands on `/quotes/:id` with the line editor open.
- Job: Client (required), Title (required), Address (from the client, editable), Job type, Price, Scope. Save lands on `/jobs/:id`.
- Invoice: Client (required), Job (optional picker of that client's open jobs, prefilled from `?job=`), Amount (required, prefilled with the job's balance), Description (prefilled with the job title), Due chips (On receipt, 7, 14, 30), Payment instructions. Save lands on `/invoices/:id`.
- Client: Name (required), Company, Phone, Email, Address, Notes.

- [ ] Write the failing e2e: `New opens a full screen with five rows`; `New quote never shows the lead form` (tap Quote, expect the Client field and no "Pipeline step", no "Source"); `a lead saves with only a name in two taps` (type name, tap Save, expect `/leads/`); `a job saves with a client and a title`; `an invoice from a job prefills the balance`; `typing a new name on Quote creates the client`. Write each so a seeded row stands in for the write where the mock cannot save.
- [ ] Run, see them fail.
- [ ] Build `ClientField` and the six screens using `Field`, `Chip`, `Button` from `fh`. Save buttons are the one gold button on the screen. Each screen remembers a draft in `localStorage` under `fh:draft:<kind>` for 24 hours, as NewLeadSheet did.
- [ ] Wire the New button, sidebar row, palette and routes. Remove the three sheets and the `?new=1` paths. `grep -rn "NewLeadSheet\|NewQuoteSheet\|NewClientSheet\|asStage\|new=1" src tests` returns nothing.
- [ ] Run the e2e on both projects, `npm run audit:design`, `node scripts/find-dead-css.mjs`.
- [ ] Commit: "Add the New screen and a full screen for creating each record".

### Task 9: The lead screen

**Files:**
- Create: `src/screens/leads/LeadDetail.tsx` (`/leads/:id`), `src/screens/leads/LeadsList.tsx` (`/leads`), `src/screens/leads/leads.css`
- Modify: `src/screens/jobs/JobsPhone.tsx` (the Leads tab lists `fh_leads`, the Quotes tab lists `fh_quotes`)
- Modify: `src/lib/queries.ts` (`useLeads`, `useLead`, `useQuotes`, `useQuote` with keys `['leads', orgId]`, `['lead', id]`, `['quotes', orgId]`, `['quote', id]`; bump `QUERY_CACHE_VERSION` to `'v2'`)
- Test: `tests/e2e/leads.spec.ts`

The lead screen shows: name and phone with Call and Message links, address with Navigate, what they need, notes (editable in place, saved on blur with the SyncPill), the two buttons Schedule estimate and Quote this (D60), the next estimate visit if one is booked, Mark lost (second tap confirms), and the notes attached to its `origin_contact_id` under "Earlier notes" when any exist.

- [ ] Write the failing e2e: `a lead shows Schedule estimate and Quote this`; `Schedule estimate opens the new event screen with the lead filled` (expect `/schedule/new?lead=l-lead1`, title field reads "Estimate", address matches); `Quote this links the lead it came from` (seed a client with two leads; from the second, tap Quote this; expect `/quotes/new?lead=l-lead2` and, after save, a `fh_leads` PATCH on `l-lead2` only, checked by routing the request); `a lost lead shows no buttons`.
- [ ] Run, see them fail.
- [ ] Build the list and the screen. The Leads list sorts by `follow_up_on` then `created_at`, shows name, what they need and a chip for an estimate booked.
- [ ] Run and see them pass. Audit and dead CSS checks.
- [ ] Commit: "Give leads their own list and screen with Schedule estimate and Quote this".

### Task 10: The quote screen

**Files:**
- Create: `src/screens/quotes/QuoteDetail.tsx` (`/quotes/:id`), `src/screens/quotes/QuoteLines.tsx` (inline line editor, one row expands to edit), `src/screens/quotes/QuoteTerms.tsx` (`/quotes/:id/terms`), `src/screens/quotes/QuotesList.tsx` (`/quotes`), `src/screens/quotes/quotes.css`
- Modify: `src/screens/ContactDetail/tabs/Quote.tsx`, `phone/QuotePhone.tsx`, `phone/QuoteSheets.tsx`, `phone/QuotePreviewSheet.tsx`, `sections/QuoteItems.tsx`, `sections/QuoteTerms.tsx` so they read and write `fh_quotes` and `fh_quote_items` by `quote_id`; the four sheets become the inline editor and the `/quotes/:id/terms` and `/quotes/:id/preview` routes
- Modify: `src/screens/Bid.tsx` (`pushToJob` inserts an `fh_quotes` row and items with `quote_id`, lands on `/quotes/:id`)
- Modify: `src/screens/ContactDetail/sections/ApproveQuoteSheet.tsx` becomes `src/screens/quotes/QuoteApprove.tsx` (`/quotes/:id/approve`) and calls `fn_approve_quote_version` with the quote id (Task 11 updates the function)
- Modify: `src/lib/stages.ts` (`startQuote`, `markWon`, `approveQuote`, `pipeline.ts` wrappers removed; `completeJob`, `markLost` for jobs, `reopen` for jobs stay)
- Test: `tests/e2e/quote.spec.ts`, `src/lib/quotes.test.ts`

The quote screen shows the client, title, the lines (tap a line to edit it in place, a plus row adds one), the total and the deposit sentence from `quoteMoney`, Scope and terms as a row that opens `/quotes/:id/terms`, the status, Preview (`/quotes/:id/preview`), Send, Share link, and Make this a job (D61). Once `job_id` is set the button reads "Open the job".

- [ ] Write the failing tests: unit `makeJobFromQuote copies scope, amount and terms and sets job_id` (mock the Supabase client the way `timePunches.test.ts` does); e2e `a quote opens with its lines and no sheet`, `editing a line happens in place`, `Make this a job lands on the new job`, `an approved quote still offers Make this a job`.
- [ ] Run, see them fail.
- [ ] Build. Remove `QuoteSheets.tsx` and `QuotePreviewSheet.tsx`. `grep -rn "useSheet\|<Sheet" src/screens/ContactDetail` returns nothing.
- [ ] Run and see them pass. Audit and dead CSS checks.
- [ ] Commit: "Give quotes their own list and screen with lines edited in place and Make this a job".

### Task 11: The customer link, send and approve read the quote

**Files:**
- Modify: `netlify/functions/public-link.js` (resolve `link.quote_id` first; when set, load `fh_quotes` plus the client, items by `quote_id`, versions by `quote_id`; return the same payload shape with `stage` mapped from the quote status so `portalView.ts` keeps working; `contact_id` paths stay for invoice, change order and statement links)
- Modify: `netlify/functions/public-link-approve.js`, `public-link-request-changes.js`, `send-quote.js`, `docusign-send.js`, `docusign-webhook.js` (write `fh_quotes.status`, `sent_at`, `approved_version_id`, change request fields when `quote_id` is set)
- Create migration: `supabase/migrations/094_approve_quote_by_id.sql` (`fn_approve_quote_version` gains `p_quote_id` and writes `fh_quotes`; `fh_quote_versions` insert carries `quote_id`)
- Modify: `src/lib/publicLink.ts` (`mintPublicLink({ quoteId })`), `src/lib/portalView.ts` (status from `view.status`), `src/components/documents/numbers.ts` callers use `quoteNumber`
- Test: `netlify/functions/__tests__/public-link.test.js` (exists? if not, create with the pattern other function tests use), `tests/e2e/portal-after-approval.spec.ts` (fixtures move to `fh_quotes`)

- [ ] Write the failing tests: `a proposal link with quote_id loads the quote and its items`; `approval writes fh_quotes.status and approved_version_id`; `the quote number uses the quote id`.
- [ ] Run, see them fail.
- [ ] Implement. Keep every refusal rule (already approved, lost, expired, empty).
- [ ] Run the function tests and the portal e2e on both projects.
- [ ] Commit: "Point the customer link, sending and approval at the quote record".

### Task 12: The invoice screen and Money

**Files:**
- Create: `src/screens/invoices/InvoiceDetail.tsx` (`/invoices/:id` where `:id` is an `fh_invoices` id), `src/screens/invoices/InvoicePayment.tsx` (`/invoices/:id/payment`, replaces V3PaymentSheet for invoices), `src/screens/invoices/InvoiceEdit.tsx` (`/invoices/:id/edit`), `src/screens/invoices/invoices.css`
- Modify: `src/screens/InvoiceDetail.tsx` moves to `src/screens/jobs/JobMoney.tsx` and is reached at `/jobs/:id?tab=financials` only; `src/screens/money/MoneyPanels.tsx` links `/invoices/:invoiceId`; `src/screens/money/InvoiceSheet.tsx`, `InvoiceJobPicker.tsx`, `RemindSheet.tsx`, `useMoneySheets.tsx` become routes `/invoices/:id` (actions are buttons on the screen), `/invoices/new` (Task 8) and `/invoices/:id/remind`; `src/components/SendInvoiceSheet.tsx` is deleted (its logic lives in `InvoiceNew.tsx` and `InvoiceDetail.tsx`)
- Modify: `src/lib/invoices.ts` (`createInvoice` takes `clientId` and optional `contactId`; `invoiceAmountDue` treats a job less invoice as a contract of its own amount; `generateInvoicePdf` skips the Contract position block when there is no job), `src/lib/queries.ts` (`fetchInvoicesBundle` reads invoices by `org_id`, joins clients, and jobs only when `contact_id` is set), `src/lib/moneyView.ts` (`classify` works without a job)
- Modify: `netlify/functions/send-invoice.js`, `public-link.js` invoice kind (client from `client_id` when there is no job)
- Test: `src/lib/invoices.test.ts`, `tests/e2e/money.spec.ts`, `tests/e2e/invoice-actions.spec.ts`

- [ ] Write the failing tests: unit `an invoice with no job settles against itself` (amount 1200, payments 200, due 1000, no contract block in the PDF payload); e2e `an invoice row opens the invoice screen` (expect `/invoices/inv-1`, not a sheet), `Collect payment is a screen`, `Remind is a screen`, `the Description field edits in place and shows in the PDF text`.
- [ ] Run, see them fail.
- [ ] Build and rewire. Money's "New invoice" goes to `/invoices/new`. The job's Financials tab links each draw to `/invoices/:id`.
- [ ] Run the Money and invoice specs on both projects. Audit and dead CSS checks.
- [ ] Commit: "Give invoices their own screen, let one stand without a job, and make Money's actions screens".

### Task 13: The job screen loses its sheets and gains Invoice this

**Files:**
- Modify: `src/screens/ContactDetail/index.tsx` (routes replace: `V3PaymentSheet` to `/jobs/:id/payment`; `AddEventSheet` to `/schedule/new?job=:id`; `InvitePartnerSheet` to `/jobs/:id/partner`; `MarkCompleteSheet` to `/jobs/:id/complete`; `SendInvoiceSheet` to `/invoices/new?job=:id`; the delete ActionSheet to a second tap; `JobMoreSheet` rows become a "More" screen `/jobs/:id/more`; the follow up view becomes `/jobs/:id/follow-up`)
- Modify: `src/screens/ContactDetail/lib/stageWorkspace.ts` (stages are `job`, `closed`, `lost`; the `quote` tab is gone from the job; `stageCta` is Invoice this while balance > 0, Mark complete at 0, Reopen when closed or lost)
- Modify: `src/screens/ContactDetail/sections/Subs.tsx`, `Expenses.tsx`, `Photos.tsx`, `Files.tsx`, `Inspections.tsx`, `Materials.tsx` (ActionSheets and dialogs become inline forms or routes under `/jobs/:id/...`)
- Modify: `src/components/AddEventSheet.tsx` becomes `src/screens/schedule/EventNew.tsx` (`/schedule/new`, `/schedule/:eventId/edit`), reading `?job=`, `?lead=`, `?quote=` and writing `contact_id`, `lead_id` or `quote_id`
- Modify: `src/screens/Schedule.tsx`, `src/components/desktop/SnowScheduleBuild.tsx` (open the event routes; the job picker lists jobs, leads and quotes by kind)
- Test: `tests/e2e/job.spec.ts`, `tests/e2e/schedule.spec.ts`

- [ ] Write the failing e2e: `the job page opens no dialog for payment, event, partner, complete or invoice` (each button changes the URL and `role="dialog"` count stays 0); `Invoice this opens the new invoice screen with the balance`; `Delete asks with a second tap, not a sheet`; `a lead's estimate shows on the Schedule with a Lead chip`.
- [ ] Run, see them fail.
- [ ] Build and rewire. `grep -rn "from '../components/ui/drawer'\|ActionSheet" src` returns only the components themselves, which are then deleted along with `src/components/fh/Sheet.tsx` and `src/components/ActionSheet.tsx`.
- [ ] Run the job, schedule and small fixes specs on both projects. Audit and dead CSS checks.
- [ ] Commit: "Replace every sheet on the job page and the schedule with a screen, and add Invoice this".

### Task 14: Capture, Customers and the rest become screens

**Files:**
- Modify: `src/components/CaptureSheet.tsx` becomes `src/screens/Capture.tsx` (`/capture`; the dock coin, sidebar row, palette and ⌘J navigate there; `openCapture()` navigates; the roster lists jobs, leads and quotes by kind; the "Lead" and "Quote start" rows go to `/leads/new` and `/quotes/new` with the dictated text as `?text=`)
- Modify: `src/screens/Clients.tsx` and `ClientDetail.tsx` (`StatementSheet` to `/clients/:id/statement`, `MergeDuplicatesSheet` to `/clients/merge`, delete to a second tap), `src/screens/Analytics.tsx` (`LogMilesSheet` to `/miles/new`), `src/screens/Subs.tsx` (`AddSubDrawer` to `/subs/new`), `src/screens/Team.tsx` (InviteDialog to `/team/invite`), `src/screens/SubPortal.tsx` (profile edit to `/sub-portal/profile`), `src/screens/jobs/JobsFilterSheet.tsx` (filter and sort become chips in the Jobs header), `src/components/ConfirmSheet.tsx` (every `useConfirm` caller moves to a second tap; the provider is removed), `src/components/WorkspaceMenu.tsx` and `MobileSearchOverlay.tsx` (become `/workspace` and `/search`)
- Test: `tests/e2e/capture.spec.ts`, `tests/e2e/customers.spec.ts`, `tests/e2e/no-sheets.spec.ts` (new: visits every route in the app as the owner and asserts no element with `role="dialog"` or `[data-vaul-drawer]` ever mounts after tapping each button on the page)
- Delete: `src/components/ui/drawer.tsx` once unused

- [x] Write the failing `no-sheets.spec.ts` and the capture and customers changes.
- [x] Run, see them fail.
- [x] Build and rewire. `grep -rn "vaul\|useConfirm\|role=\"dialog\"" src` returns only the command palette (a keyboard tool on desktop, allowed by D57 as the one exception; record it under D57).
- [x] Run the full e2e suite. Audit and dead CSS checks.
- [x] Commit: "Make Capture, Customers and every remaining pop up a screen".

---

## Tier 4: everything else reads the new records, then cut over

### Task 15: Today, Reports, Clients and the Inbox

**Files:**
- Modify: `src/lib/homeDashboard.ts` (reads `fh_leads` and `fh_quotes` for "Needs an answer": lead follow ups due, quotes sent and quiet, quote changes requested; jobs for behind and awaiting payment; the stage rail becomes four counts, leads, quotes, jobs, invoices due), `src/lib/todayView.ts`, `src/screens/today/*`
- Modify: `src/lib/rollups.ts` (`computeFunnel` counts leads created, quotes created, jobs created from quotes (`fh_quotes.job_id`), leads and quotes lost), `src/screens/Analytics.tsx`, `src/lib/queries.ts` (`useAnalyticsBundle`, `useClientsBundle` read the new tables)
- Modify: `src/screens/ClientDetail.tsx` (Projects tab shows four groups, Leads, Quotes, Jobs, Invoices, each row to its own route)
- Modify: `src/lib/inbox.ts` (`latest_stage` is shown only when the view returns a job stage; a production migration `095_inbox_view_records.sql` updates `fh_v_inbox` to report the client's newest record kind)
- Modify: `src/lib/universalSearch.ts`, `src/components/CommandPalette.tsx`, `src/lib/paletteActions.ts` (search across the four tables)
- Test: `src/lib/homeDashboard.test.ts`, `src/lib/rollups.test.ts`, `tests/e2e/today.spec.ts`, `tests/e2e/reports.spec.ts`

- [ ] Write the failing tests: `Needs an answer lists a lead whose follow up is due and a quote quiet for 7 days`; `the funnel counts a quote that became a job as won`; `a client's Projects tab groups its four kinds`; `search finds a lead by name`.
- [ ] Run, see them fail.
- [ ] Implement. Apply and type the view migration.
- [ ] Run and see them pass.
- [ ] Commit: "Read leads, quotes, jobs and invoices as separate records on Today, Reports, Customers and search".

### Task 16: Importer, webhooks, captures and the engine write the new records

**Files:**
- Modify: `src/screens/Importer.tsx` (rows become `fh_leads` with a client each; dedupe by client phone or email), `netlify/functions/webhook-lead.js` (inserts a client and an `fh_leads` row; the notification links `/leads/:id`), `src/lib/captureActions.ts` (lead intent inserts `fh_leads`), `src/lib/outbox.ts` (table labels), `mobile/lib/queries.ts` (the Expo app's lead insert and stage update, kept compiling)
- Create migration: `supabase/migrations/096_engine_reads_leads_quotes.sql` (`fh_run_follow_up_engine` scores `fh_leads` open rows and `fh_quotes` sent, viewed or changes requested rows instead of `fh_contacts` lead and quote stages; links are `/leads/:id` and `/quotes/:id`; `fh_follow_ups` gains `lead_id` and `quote_id`)
- Modify: `supabase/README.md`
- Test: `netlify/functions/__tests__/webhook-lead.test.js`, `src/lib/captureActions.test.ts`, `supabase/tests/follow_up_engine.test.sql`

- [ ] Write the failing tests: `a webhook lead becomes a client and a lead`; `a captured lead inserts fh_leads`; the SQL test gains `a sent quote quiet for 7 days queues a day7 reminder linking /quotes/:id`.
- [ ] Run, see them fail.
- [ ] Implement. Apply the migration after the copy run.
- [ ] Run and see them pass.
- [ ] Commit: "Write new leads to the leads table from the importer, webhooks, Capture and the reminder engine".

### Task 17: Cut over, screenshots, summary

- [ ] `npm run test:all` and `npm run audit:design` green. `node scripts/find-dead-css.mjs` clean.
- [ ] Run `QA_NOW=2026-10-08T14:00:00.000Z FH_VISUAL=1 npx playwright test cleanup-guard` and retake baselines only after viewing each diff; add guard shots for `/new`, `/leads/:id`, `/quotes/:id`, `/invoices/:id`, `/notifications`, `/capture`.
- [ ] Take the screenshots listed under Finish into `docs/design/2026-10-redesign/phase9-review/`.
- [ ] Write the Phase 9 summary at the top of `PROGRESS.md`, including the migration counts from `move-counts.mjs`.
- [ ] Push. Update the draft pull request. Tell the owner the preview address once Netlify builds it.
- [ ] Commit: "Add the Phase 9 summary and screenshots".

---

## Research notes

Condensed from the four code reads on October 19. Line numbers are from `f984ec2` (equal to main `0c7d8e8` for these files).

### Data

* `fh_contacts` columns: address, amount, approved_quote_version_id, client_id, completed_at, cost, created_at, email, exclusions_text, follow_up_on, has_inspections, heat_score, id, job_title, job_type, last_contact, milestones, name, notes, org_id, partner_shared, phone, photos, proposal_status, quote_change_request_note, quote_change_requested_at, quote_expires_at, quote_sent_at, referred_by, scope_text, source, stage, tags, terms_text, updated_at, user_id. No check on `stage`. `proposal_status` check in `20260731072644_quote_change_requests.sql:25`.
* Tables with `contact_id`: quote_items (not null), quote_versions (not null), invoices (not null), payments, change_orders, public_links, public_link_events, schedule, appointments, time_punches, notes, follow_ups, stage_transitions, closeouts, esign_envelopes, insurance_claims, daily_logs, selections, materials, inspections, expenses, mileage, subs, events, messages, form_submissions, review_requests, agent_runs, workflow_runs. With `job_id`: job_files, job_todos, job_partners.
* Triggers on `fh_contacts`: touch, `fh_clients_aggregate` (007, recompute in 059), stage transition log (023), tenant guard (062), money guard (067), clear change request, clear finished follow up.
* `fh_quote_items` recalc trigger `fn_recalc_contact_amount_from_items` (011:103).
* Deposit and terms are parsed from `terms_text` by `src/lib/quoteMoney.ts`. No structured columns.
* Quote number: `proposalNumber(companyName, seed, issuedAt)` in `src/components/documents/numbers.ts:64`, server copy `netlify/functions/lib/docNumbers.js:40`; seed is the contact id; stored only in `fh_quote_versions.snapshot.quote_number`.
* Production only, no SQL in the repo: `fh_v_inbox`, `fh_v_attribution`, `fh_lead_capture`, `fh_resolve_client`, `fh_form_submit`, `fh_book_appointment`, `fh_jobber_*`, `fh_run_follow_up_engine` (body fetched on October 19 and quoted below), `automation-worker` and `jobber` edge functions.
* Production counts on October 19: contacts 195 (lead 64, quote 25, job 31, closed 62, lost 13), 9 contacts without a client, clients 173, 23 names with more than one row, follow ups 62 queued and 109 acted, 27 unread follow up notifications, invoices 66, quote items 206, 7 orgs. `fh_outbox` holds no follow up sends.
* `fh_follow_ups` indexes: `(contact_id, kind, created_at desc)`, unique `(contact_id, kind) where status = 'queued'`, `(org_id, status, due_on)`.

### The follow up engine body (production, fetched October 19)

The function scores `fh_contacts` rows with `stage in ('lead','quote')` whose company has `fh_follow_up_settings.enabled`, computes `days_quiet` from `last_contact` or the last stage transition, picks `day30`, `day14`, `day7` or `day3`, skips a contact that already has that kind since the anchor date, inserts `fh_follow_ups` with the headline and draft body, inserts `fh_notifications` (`follow_up_due`, link `/jobs/:contact_id`) and bumps `follow_up_on`. A second block queues `review_ask` for every contact with `completed_at` in the last 45 days that has no `review_ask` row yet, with notification kind `review_ask_due`. It never checks `client_id` and never excludes `lost`. Cron `fh_follow_up_engine_daily` at `0 13 * * *`.

### Screens

* Routes in `src/App.tsx:196` to `257`. `/leads/:id`, `/quotes/:id` and `/jobs/:id` all render `ContactDetailRoute`. `/invoices/:id` is a job id. `/work` is the list (phone: JobsPhone titled Jobs).
* Sheets: `fh` Sheet in JobsFilterSheet, InvoiceJobPicker, InvoiceSheet, RemindSheet, QuoteLineSheet, QuoteTermsSheet, QuoteMoreSheet, QuotePreviewSheet, JobMoreSheet (twice), CaptureSheet. shadcn Drawer in NewLeadSheet, NewQuoteSheet (dead), NewClientSheet, ClientDetail chooser, StatementSheet, MergeDuplicatesSheet, LogMilesSheet, NotificationsBell, MarkCompleteSheet, AddEventSheet, InvitePartnerSheet, V3PaymentSheet, SendInvoiceSheet, ApproveQuoteSheet, Inspections InspectionLog, Subs AddSubDrawer. ActionSheet in ContactDetail delete, ClientDetail delete, Schedule delete, Photos delete, Files delete, Subs new, Expenses new. ConfirmSheet with 22 callers. Dialogs: CommandPalette, MobileSearchOverlay, WorkspaceMenu, Team InviteDialog, SubPortal edit, Materials DialogShell.
* `NewLeadSheet` fields and payload at lines 691 to 866 and 384 to 470. `ClientDetail.createDealForClient` at 147 to 174 writes `fh_contacts` with stage quote or job and `amount 0`.
* `SendInvoiceSheet.tsx` is the only create path for invoices; its Description field prefills from `job_title` (line 99). `InvoiceDrawsSection` editor (826) has no description. `InvoiceDetail.tsx` PDF line item at 213 to 227 uses the job title.
* `NotificationsBell.tsx` Drawer at 133 to 261, reads `fetchInbox(40, userId)` from `fh_notifications`, no dedupe, `fmtAge` prints "3d".
* Stage gated tabs in `ContactDetail/lib/stageWorkspace.ts:24`. Stage CTA in `index.tsx:552`.
* Design audit rules: allowed radii 7, 10, 12, 14, 18, 22, 28, 999; font sizes 12 to 52 from the list; spacing 0, 4, 8, 12, 16, 20, 24, 28, 32, 48; no letter spacing. Prefix rule D41; `fhp-` is used by both the palette and the proposal documents (a known break).
* Test mock: `scripts/qa-mock.mjs` default rows `c-lead1`, `c-lead2`, `c-quote`, `c-change`, `c-job1`, `c-job2`, `c-done`, `c-lost`; `tables` replaces whole tables; writes are not saved; RPC calls are logged for `rpcCalls`.

### Dependencies on the deal table

* Schedule: `fh_schedule` (no kind column); `AddEventSheet` job picker reads any non lost contact; `scheduleBoard.ts:240` colours a visit by the joined stage; the Unscheduled tray keeps job stage rows with no visit from today on.
* Money: `fetchInvoicesBundle` (`queries.ts:708`) reads contacts in job, invoice, closed; `moneyView.waitingRows` reads quotes sent or viewed from `useCompanyJobs`; `invoices.ts` `contractTotals`, `invoiceAmountDue`, `knownContractTotal` cap on `contact.amount`; `stages.logPayment` closes a job when paid in full.
* Portal: `fh_public_links.contact_id`; `public-link.js:147` loads the contact and children; `public-link-approve.js` claims `proposal_status = approved` atomically and inserts `fh_quote_versions`; `fn_approve_quote_version` (065:279) on the operator side; stage never changes server side.
* Time clock, photos, files, notes, todos, daily logs, selections, materials, expenses, subs, inspections, change orders all key on the job's `contact_id` or `job_id` and stay as they are.
* Reports: `rollups.computeFunnel` from `fh_stage_transitions`; `fh_clients_recompute` counts stages.
* Stage writers: `stages.ts` `transitionStage`, `startQuote`, `markWon`, `approveQuote`, `markLost`, `logPayment`; `pipeline.ts` `reopen`; `closeout.ts`; creators NewLeadSheet, NewQuoteSheet, Bid, ClientDetail, Importer, captureActions, webhook-lead, demoSeed, mobile.
* Offline cache: `queryPersistence.ts` persists every key but `jobSearch` and `inbox`; `QUERY_CACHE_VERSION` in `main.tsx` must bump when shapes change.
