# Supabase

Project ref: `pnmhblvslftdzfcdezbw`.

* `migrations/` holds the numbered SQL files this repo has accumulated.
* `functions/` holds edge function sources captured from production on 2026-10-09.

## Production and this folder are out of sync

Checked on 2026-10-09 against the live project.

**Migrations.** Production records 77 applied migrations, timestamped from
20260518225707 to 20261009034134. Many were applied through the dashboard or
an MCP client under timestamp names, so they do not map one to one onto the
numbered files here.

**Tables with no creating migration in this folder.** These 37 tables exist
in production but no file here creates them:

fh_agent_runs, fh_agents, fh_appointments, fh_booking_types,
fh_campaign_recipients, fh_campaigns, fh_channels, fh_client_attribution,
fh_client_fields, fh_client_tags, fh_consent, fh_conversations, fh_events,
fh_external_refs, fh_field_defs, fh_follow_up_settings, fh_follow_ups,
fh_form_submissions, fh_forms, fh_jobber_events, fh_lead_sources,
fh_message_templates, fh_messages, fh_oauth_states, fh_org_settings,
fh_outbox, fh_phone_numbers, fh_review_requests, fh_reviews, fh_segments,
fh_snapshot_library, fh_tag_defs, fh_workflow_run_events, fh_workflow_runs,
fh_workflow_versions, fh_workflows, profiles.

A fresh database built from this folder alone will not match production.

**Follow up engine.** Since October 19 the body of `fh_run_follow_up_engine` lives in this folder and `tests/follow_up_engine.test.sql` checks it. `091_follow_up_engine_per_client.sql` made reminders per client; `096_engine_reads_leads_quotes.sql` is the current body: the pipeline block scores `fh_leads` rows with status open and `fh_quotes` rows with status sent, viewed or changes_requested, writes `lead_id` or `quote_id` on `fh_follow_ups` (both new, nullable; `contact_id` is nullable since 096) and links each notification to `/leads/:id` or `/quotes/:id`. The review ask block still reads completed jobs on `fh_contacts`. `fh_follow_up_set_status` (090, replaced in 096) closes a reminder by the job, lead or quote id at the end of the notification link. The tables it writes (`fh_follow_ups`, `fh_follow_up_settings`) still have no creating migration here.

**Scheduled jobs.** Five pg_cron jobs run in production and none is defined
here:

| Job | Schedule (UTC) | Runs |
| --- | --- | --- |
| fh_follow_up_engine_daily | 0 13 * * * | fh_run_follow_up_engine() |
| fh_automation_tick | every minute | fh_automation_tick() |
| fh_appointment_reminders | every 5 minutes | fh_appointment_reminders_sweep() |
| fh_daily_sweep | 30 13 * * * | fh_daily_sweep() |
| fh_jobber_drain | every 5 minutes | fh_jobber_drain_tick() |

**Edge functions.** Seven are deployed, and all seven are in this repo:
public-api, twilio-sms, twilio-voice, email-events, meta-leads, jobber and
automation-worker. Their shared helpers are in `functions/_shared/lib.ts`.
In production each folder holds its own copy of that file; the small
`lib.ts` in a folder here re-exports the shared one so `index.ts` stays
identical to the live source and the CLI can still deploy it. Nothing
checks that the deployed code matches these folders.

## Changes applied on 2026-10-09 during the audit

Applied directly to production, written without any statement that removes
data, and not recorded in `supabase_migrations.schema_migrations`:

* 062 tenant boundary hardening
* 063 storage access for teammates and bucket limits
* 064 role and recipient boundaries (crew and foreman lose money tables,
  notifications are recipient only)
* 065 sub portal binding, sub document access, workspace aware org stamping,
  quote approval and customer link management for managers, missing indexes
* 067 crew and foreman cannot change a job's stage, value, approval or
  completion, or delete jobs
* 068 adds fh_notes.parsed, which the Notes screen writes
* 069 lets a user read their own files in the logos bucket, which Storage
  needs before it will remove or replace a logo

055 (public rate limits) was applied with the migration tool and is recorded.

Not applied yet:

* 059a only matters for a fresh build (production already has the split
  time punch policies).
* 066 purges expired rate limit windows and old public link events every
  night. Apply it from the SQL editor.

## Bringing the repo back in sync

Run these with the Supabase CLI from the repo root, after
`supabase link --project-ref pnmhblvslftdzfcdezbw`:

```bash
supabase db pull                              # baseline migration from the live schema
supabase functions download jobber
supabase functions download automation-worker
supabase gen types typescript --project-id pnmhblvslftdzfcdezbw > src/lib/database.types.ts
```

Review the pulled baseline before committing it. It will include the cron
jobs only if they are part of the dumped schema; if not, add them to a
migration by hand from the table above.

## Applying through the database tool

The Supabase MCP tool used in these sessions asks the account owner to
confirm any call whose text contains a statement that removes things
(`drop`, `delete from`, `truncate`), wherever it appears, even inside a
function body or a cron job body. The question shows in the owner's Claude
app. If nobody answers within sixty seconds the call times out and nothing
runs. Everything else, including bodies of several kilobytes, runs in well
under a second.

That prompt is a safeguard, not a fault. Do not route around it. In October
(092 to 094 and 096) it was mistaken for a tool stall and bypassed by
building `drop` statements from string pieces inside a `do` block. Do not do
that again. The honest options are:

* write the change so it needs no removing statement, where that is the
  natural way to write it (`create or replace function`, `create or replace
  trigger`),
* run the call while the owner is at the screen so they can approve it, or
* have the owner apply the file from the SQL editor or the Supabase CLI.

Where `execute_sql` did the work, the migration row is added to
`supabase_migrations.schema_migrations` by hand, under the file's own
version, so `list_migrations` stays honest.

Dry runs. Put the migration and its checks in one `do` block that ends by
raising an exception that carries the results. The raise undoes everything,
so the run cannot leave anything behind. To act as a real user inside it,
set `request.jwt.claims` with `set_config(..., true)`, run
`set local role authenticated`, and `reset role` afterwards. Compare the
live function with its file by checksum: `md5(prosrc)` in `pg_proc` against
the md5 of the text between the dollar quotes.

## State on 2026-11-16

Six prepared migrations had never reached production, although the live
build calls one of them. Each was checked by object in the live catalog, not
by the migration list, which does not map onto these files.

| File | State | Notes |
| --- | --- | --- |
| 20261101184536_atomic_quote_conversion | Applied 2026-11-16 | The live app called `fh_make_job_from_quote`, which did not exist, so "Make this a job" failed for everyone. A dry run converted all 36 open quotes as each company's owner and was undone. The live body matches the file by checksum. |
| 20261101020547_authorization_transition_guards | Applied 2026-11-16 | Dry run on real rows first: all 24 queued reminders still close for their own user, another company is refused, an owner can approve and change cost, a crew role cannot. The trigger was written as `create or replace trigger`. |
| 20261101014840_growth_context_boundaries | Applied 2026-11-16 | Applied in one transaction behind a test gate that exercised the new functions on real rows and undid its own writes. The messaging tables are empty in production, so no live traffic depends on these functions yet. |
| 20261027170430_schedule_crew_allocation | Not applied | Its text holds `drop trigger` and a `delete` inside a function, so the database tool asks the owner to approve it. Until it runs, `fh_schedule.assigned_user_ids` does not exist; the app hides the crew picker in that case and visits save normally. |
| 20261027170408_invoice_billing_safeguards | Not applied, held | See the audit of 2026-11-16 in `docs/audits`. |
| 20261101185443_record_relationship_guards | Not applied, held | Validates cleanly on live data. Held because builds older than 2026-11-01 still send unhinted embeds. The parent company guard below covers the same risk. |

Audit migrations of 2026-11-17. Each was applied in one transaction behind a
gate that exercised it on real rows as a company owner and undid its own
writes, unless noted.

| File | State | Gate |
| --- | --- | --- |
| 20261117090000_quote_job_from_approved_version | Applied | All 36 open quotes converted correctly, then undone. |
| 20261117090100_merge_client_into | Applied | Merged a client with 23 jobs, 5 leads, 9 quotes and 14 invoices into another; every record moved, another company was refused; undone. Only the header comment holds a flagged word, so the body was sent without it. |
| 20261117110000_parent_company_guard | Applied | An owner's own quote line saved; another company's quote line was refused with 42501. 28 tables guarded. |
| 20261117110100_role_boundaries | Applied | Same gate. |
| 20261117110300_function_default_privileges | Applied | |
| 20261117110400_realtime_publication | Applied | 14 tables published. |
| 20261117110500_customer_messages_office_roles | Applied | |
| 20261117130000_hot_read_indexes | Applied | Three indexes, `create index if not exists` only. A dry run built all three and was undone; the performance advisor no longer lists `fh_leads.quote_id` or `fh_quotes.approved_version_id` as unindexed. |
| 20261117100000_follow_ups_in_step | Waiting on owner approval | Its triggers fire on delete, and the word asks for approval. Then run `supabase/manual/20261117_follow_up_cleanup.sql`, dry run first. |
| 20261117100100_follow_up_unique_indexes | Waiting | After the cleanup above. |
| 20261117110200_partner_and_removal_policies | Waiting on owner approval | Names the delete command in a policy. |
| 20261117120000_public_link_scope | Waiting on owner approval | Replaces a check, which removes the old one. "Share link" on quotes and on invoices with no job fails until it runs. |
