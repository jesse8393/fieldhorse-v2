# Full platform audit, 2026-11-16

Working record of the audit Jesse asked for on 2026-11-16 ("Audit and fix. We
want 10/10 best platform ever"). It covers the live app, the code on `main`
at `76e01d7` (the build that is live), the production database and the server
functions. Findings and fixes are added below as they are verified.

Status of this document: in progress.

## How it was done

1. Recon against production: live build, deploy state, cron jobs, logs,
   Supabase advisors, row counts, and a column by column comparison of the
   live schema with `src/lib/database.types.ts`.
2. Independent auditors, one per area, each told to prove a defect before
   reporting it: phone sales flows, phone operations flows, desktop and
   tablet, money, data layer, server functions, live database security,
   reminders and automation, customer portal and documents, accessibility,
   the native app. Performance and test quality follow.
3. Every production change was first run on real rows inside a transaction
   that was undone, and only then applied.
4. Fixes land on the branch `audit/2026-11-16` with a test that fails before
   the fix.

## What production looked like on 2026-11-16

| Measure | Value |
| --- | --- |
| Companies | 12 |
| Active members | 12, every one an owner. No crew, manager or admin accounts exist yet |
| Clients | 192 |
| Leads | open 80, quoted 3, lost 6 |
| Quotes | draft 16, sent 7, approved 2, lost 13 |
| Jobs | job 28, closed 68 |
| Invoices | draft 13, sent 1, overdue 2, paid 55, void 1 |
| Schedule visits | 65. None since 2026-10-16. None has crew assigned |
| Messages sent by automation | 0. No phone numbers, channels or campaigns are set up |
| Jobber and other integrations | none connected |
| Latest write by a user | 2026-11-07 |
| Cron jobs | five, all reporting success |
| CI on `main` | green |

## Production problems found and fixed during recon

### 1. "Make this a job" was broken for everyone (fixed)

The live build calls the database function `fh_make_job_from_quote`. It did
not exist in production. Its migration was merged on 2026-11-01 and never
applied, so the button on an approved quote failed for every company for
about two weeks.

Fix: applied `20261101184536_atomic_quote_conversion.sql` on 2026-11-16.
Before applying, a dry run converted all 36 open quotes as each company's
owner: 36 of 36 succeeded, each job had the right client, company and amount,
every line was copied, a second call returned the same job, and the run was
undone. After applying, the live function matches the file by checksum and
the public API reports it as present (an anonymous call is refused with
"permission denied", where a missing function answers "not found").

Not verified: a real signed in user tapping the button. That needs Jesse or
a customer account.

### 2. Two security migrations were never applied (fixed)

`20261101020547_authorization_transition_guards.sql` and
`20261101014840_growth_context_boundaries.sql` close gaps where a signed in
person from one company could act on another company's records through
database functions, given that record's id:

* closing another company's reminder,
* approving a quote they created after losing access to the company,
* reading another company's job details through the message context helper,
* sending from another company's phone number.

Both were dry run on real rows and applied on 2026-11-16. The checks are in
`supabase/README.md`. No sign that any of these gaps was ever used: the
messaging tables are empty and every account is the single owner of its own
company.

### 3. Schema drift, measured

Comparing every table and function in `src/lib/database.types.ts` with the
live catalog found exactly two gaps: the function above, and the column
`fh_schedule.assigned_user_ids`. The column is still missing (see below).

## Still open in production

### Found after the merge: the live functions have no server key

Checked against the live site on 2026-11-17 after #244 and #245 deployed.
Every Netlify function that needs the Supabase server key answers 500
with "server_misconfigured" or "Server is missing Supabase credentials":
public-link (every customer link page), partner-invite-info,
org-members-list, send-quote, send-invoice, claude, delete-account and the
new client-error. `netlify/functions/lib/serviceConfig.js` did not change
in this audit, so this predates it. It explains why production has never
held a customer link: none could ever be opened, and no quote or invoice
email could be sent from the app.

Only Jesse can fix it, in Netlify: Site configuration, Environment
variables, scope Functions. Set `SUPABASE_URL`
(`https://pnmhblvslftdzfcdezbw.supabase.co`), `SUPABASE_PUBLISHABLE_KEY`
(the anon or publishable key) and `SUPABASE_SECRET_KEY` (the service role
or secret key, from Supabase, Project settings, API keys). Rotate that key
first, since the #245 hole existed, and set the new one. Add
`ANTHROPIC_API_KEY` for the AI features. Then trigger a deploy. The steps
and a readiness check are in `docs/operations/service-setup.md`.

### Waiting on Jesse's approval

The database tool asks the owner before running any statement that removes
something, and these five need it. The full list, with what each does, is
in `supabase/README.md`.

1. `20261117120000_public_link_scope`: "Share link" on quotes and on
   invoices with no job fails in production until this runs.
2. `20261117100000_follow_ups_in_step`, then the dry run and cleanup in
   `supabase/manual/20261117_follow_up_cleanup.sql`, then
   `20261117100100_follow_up_unique_indexes`. This ends the reminder flood
   (92 unread, 74 of them for reminders that were already closed, 86 held by
   one person) and keeps it from coming back. The app falls back to the old
   list until then.
3. `20261027170430_schedule_crew_allocation`: crew assignment on visits.
   Until it runs the app hides the crew picker, which only matters once a
   company has more than one member.
4. `20261117110200_partner_and_removal_policies`: partners who left a job
   lose its invoices, and removed members lose their own unapproved punches.

### Other things only Jesse can do

* Merge #245 (the security fix) first, then this branch.
* Consider rotating the Supabase service role key, since the #245 hole
  existed.
* Attach fieldhorse.io to the Netlify site, or keep using the netlify.app
  address. Resend lists fieldhorse.io as a verified sending domain, so mail
  sent from it should still deliver. I could not see which From address the
  site is set to use.
* Turn on leaked password protection in Supabase Auth.
* Add the repository secrets `SUPABASE_URL` and
  `SUPABASE_SERVICE_ROLE_KEY` so the daily production schema check runs.
* Check the app on a real phone. Every test here ran in a browser.

## Findings by area

Thirteen independent audits, each told to prove a defect before reporting
it (a failing probe, a reproduced request, or an end to end trace with file
and line). About 276 findings in all; some appear in two areas, for
example the client merge, which three auditors found on their own.

| Area | Findings | Serious (P0) | Fix lane |
| --- | --- | --- | --- |
| Money | 25 | 10 | money-core, quotes, public-links |
| Data layer | 25 | 1 | clients, quotes, money-core, ops |
| Server functions | 25 | 1 | hotfix (#245), team-account, senders, public-links |
| Phone, sales half | 25 | 2 | quotes, clients |
| Desktop and tablet | 25 | 0 | desktop, ops |
| Customer pages and documents | 24 | 3 | public-links, senders, money-core |
| Native app | 22 | 6 | native |
| Phone, operations half | 22 | 0 | ops, money-core |
| Reminders and automation | 18 | 0 | automation |
| Tests and deploy | 18 | 2 | guards |
| Live database security | 16 | 3 | db-hardening |
| Accessibility | 14 | 0 | perf-a11y |
| Performance | 12 | 0 | perf-a11y |

The full reports are kept with the session's working files, not in this
repository, because they name customer facing records by id. Each fix
commit names its finding id.

### The serious ones, in plain words

* **Anyone signed in could read every company's data** through the file
  path the email senders accept. Fixed in #245, which should merge first.
  No sign it was used.
* **One company could change another company's quote totals, calendar and
  inbox** by writing rows that pointed at the other company's records, given
  their ids. Closed in production on 2026-11-17 by a database guard on 28
  tables.
* **Merging two duplicate clients deleted the duplicate's leads, quotes and
  approved versions**, and deleting a client did the same with no warning.
  Fixed in the app and with a database function that moves every record,
  checked against a real client in production.
* **The customer invoice link asked for the wrong amount**: "Paid in full"
  while money was owed, money that was never invoiced, the balance of an
  earlier invoice, and amounts rounded to whole dollars. Fixed; the page,
  the PDF and the email now use one calculation in whole cents.
* **Edits after a customer approved replaced what they approved**, on the
  customer link and when the quote became a job. Fixed; approved lines are
  locked until the quote is revised, and the job is built from the approved
  version (live in production).
* **A customer could approve a change order at an amount they never saw.**
  Fixed; the approval carries the amount and version shown.
* **"Share link" fails in production for quotes and for invoices with no
  job**, because a database rule from before October still demands a job.
  The fix is written and waits on Jesse's approval.
* **Cents went missing**: a line on a half cent, a fully paid job that never
  closed, an invoice PDF that printed an amount due and PAID together.
  Fixed with one shared helper that works in whole cents.
* **The native app, if anyone builds it**, pointed every link at the dead
  fieldhorse.io, showed old moved rows as live leads and quotes, and wrote
  quotes where the web app never shows them. Fixed. The app looks
  unreleased (no build has ever run), which is an inference from its
  config.
* **Nothing would have caught a missing database function**: the test mock
  answered anything with success, and no check compared the code with
  production. Fixed with a schema check on every CI run, a daily production
  check (needs two repository secrets), an honest mock, and crash reporting.

### What production looked like, by the numbers that matter

* 12 companies, each with one owner and no other members. That is why
  several role findings (crew seeing money, crew setting their own pay
  rate) were real holes but hurt nobody yet.
* 0 messages sent, 0 customer links ever created, 0 schedule visits with
  crew. The messaging and portal paths have never carried real traffic, so
  their defects were caught before customers saw them.

### Left for a later round, deliberately

* Native app: money totals and documents still differ from the web, reads
  are scoped by creator rather than company, and about 75 pop ups remain.
* Database: storage paths are not tied to the job folder, and crew can
  still read job amounts directly from the database (the screens hide
  them). Both need an owner decision.
* Several functions run in production with no source in the repository
  (the automation engine and Jobber sync). They need dumping before they
  can be tested.
* One word for the customer record (customer, client or account), and one
  for subcontractors, is Jesse's call.
