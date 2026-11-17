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

### Crew assignment on visits does not work

`fh_schedule.assigned_user_ids` does not exist yet, so the crew picker on the
event screen reports "Crew scheduling unavailable" and nobody can be
assigned to a visit. Visits without crew save normally. The migration that
adds the column (`20261027170430_schedule_crew_allocation.sql`) contains
statements the database tool asks the owner to approve, and the owner was
not at the screen. It needs Jesse to approve one prompt.

### Reminder notifications

92 reminder notifications were unread, 74 of them pointing at a reminder
that was already closed, and one person held 86. Cause and fix are in the
automation section below once verified.

## Findings by area

To be filled in as each auditor's findings are verified.
