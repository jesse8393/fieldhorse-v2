# Supabase

Project ref: `pnmhblvslftdzfcdezbw`.

- `migrations/` holds the numbered SQL files this repo has accumulated.
- `functions/` holds edge function sources captured from production on 2026-10-09.

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

**Scheduled jobs.** Five pg_cron jobs run in production and none is defined
here:

| Job | Schedule (UTC) | Runs |
| --- | --- | --- |
| fh_follow_up_engine_daily | 0 13 * * * | fh_run_follow_up_engine() |
| fh_automation_tick | every minute | fh_automation_tick() |
| fh_appointment_reminders | every 5 minutes | fh_appointment_reminders_sweep() |
| fh_daily_sweep | 30 13 * * * | fh_daily_sweep() |
| fh_jobber_drain | every 5 minutes | fh_jobber_drain_tick() |

**Edge functions.** Seven are deployed. Five are captured here:
public-api, twilio-sms, twilio-voice, email-events and meta-leads. Their
shared helpers are in `functions/_shared/lib.ts`. In production each folder
holds its own copy of that file; the small `lib.ts` in each folder here
re-exports the shared one so `index.ts` stays identical to the live source
and the CLI can still deploy it. Two functions were not captured: `jobber`
and `automation-worker`.

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
