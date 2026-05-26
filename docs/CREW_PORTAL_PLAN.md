# Crew Portal Plan

What this is: an implementation plan for turning Fieldhorse from a single-user contractor tool into a real multi-tenant SaaS where each contractor brings their crew, foremen, and subs onto the same job data, gated by role.

What this is not: a code drop. It's the design that lets us start Phase 1 with a clear rollback plan and zero surprises for the nine real users currently in production.

Source: the product spec was drafted in the mobile Claude session on 2026-05-25 (the seven systems, the four-lens role split, the daily and weekly operator sequence). This plan translates that spec against the real Supabase schema at project `pnmhblvslftdzfcdezbw` and adds a phased rollout that does not break current users.

---

## Product model in one paragraph

Each contractor's company is an organization. Users belong to organizations through memberships with a role. Owners and admins see everything. Foremen and managers see their crews and their jobs. Crew members see only their own schedule, time, and tasks plus a simple way to message the foreman. Customers, when invited later, see only their job status and approved photos. That's four views of the same data, gated by role. Not four apps, one app with four lenses.

## Operator sequence the dashboard is designed for

Every morning, see who is working today, where they are supposed to be, who is missing or running late, push the day plan without retyping it five times. Every hour or two, pull up a job and see who is on it, approve or reject schedule changes, answer one foreman question without scrolling fourteen text threads. Every afternoon, push tomorrow's schedule, confirm subs, reassign crews when a job slips. Every Friday, approve timesheets, push payroll, see labor cost versus job budget, spot anyone consistently over hours. Every Monday, look back at last week, see which jobs ate labor, which crews were productive, which customers are slow paying, plan the next week.

The owner dashboard is built around that sequence. Anything red on the dashboard is one tap away from being inside the thing that's red.

---

## The seven systems

1. **Scheduling.** A day view and a week view. Each job is a card, each crew member is a row. Drag a person onto a job and they're assigned for that day with a shift window. The schedule pushes notifications. People see their week on Sunday night and their day each morning. Owners see the whole board, crew sees only their own row.

2. **Time tracking.** Phone-based punch in with GPS. Each site is geofenced so the system flags suspicious punches without blocking them. Optional photo on punch in. Break tracking. Manual entry with manager approval for the offline cases. Auto rollup into weekly timesheets. Owner approves Friday, payroll exports Saturday. **Must work offline.** A crew member punching out in a basement cannot fail.

3. **Job command center.** Each job has one page. Live status (planning, scheduled, active, on hold, complete). Assigned crew with hours logged today and total to date. Site address with a directions button. Budget versus actual labor cost. Photo log. Daily notes. Punch list. Documents folder for permits, COIs, plans. Two taps from the home screen.

4. **Communication.** Job-scoped chat, not a free for all. Every job gets a thread. Crew assigned to that job sees it. Owners see all threads. Drop a photo, ask a question, tag someone, done. No more group texts with the wrong people on them. Daily morning broadcast to the whole crew or to a specific job. Foreman can post an end of day update with photos.

5. **Tasks and punch list.** Each job has a task list. Owner or foreman adds items, assigns to a crew member or a sub, sets a due date or "by end of day." Crew checks off, optionally attaches a photo. Owner sees what is done, what is not, and what is overdue at a glance.

6. **Subs and vendors.** Track sub contacts, COIs, W9s, scope confirmations, and payment status. Same chat threading as employees but with a sub-specific permission set. Subs do not need full app access. They get scoped invitations to specific jobs (see refinement below).

7. **Owner dashboard.** One screen. Today's crew status. Open jobs by status. Hours logged today by job. Active alerts (missing punches, overdue tasks, jobs over budget, unsubmitted timesheets). Cash position summary (open AR, drafts waiting approval). Anything red, tap it, you are inside.

---

## Three refinements to the spec before we lock it

These are small but they matter for the implementation.

### 1. Crews are a saved filter group, not a join table

The spec says "crews are a soft concept." Make that explicit in code. A crew is a named, saved list of user IDs the owner can drop onto a job in one tap. When you assign "Roof Crew" to a job for Tuesday, the system creates one shift per crew member, each linked to the job and that day. The crew itself owns no jobs and gives no permissions. It's a UI convenience over the underlying shift table. This avoids the trap where deleting a crew also unassigns people from jobs they're actively working.

### 2. Shifts are not the same as `fh_schedule`

`fh_schedule` already exists with 30 rows. It's for general appointments: site visits, inspections, deliveries, meetings. A shift is a different shape: it's specifically a user assigned to a job during a work window, with a state machine (scheduled, in progress, completed, missed, canceled). Build a separate `shifts` table. Let `fh_schedule` keep being what it is. Don't overload.

### 3. Three things, not two: the team, the subs, the one-off invites

Three distinct concepts, each backed by its own table. The owner picks where someone goes when they add them.

**The team** is `org_members`. This is the contractor's roster: anyone the owner manages as "mine." Each gets a login and a role the owner picks. They appear on the schedule with real shifts, clock in for timesheets, and feed payroll. W2 or 1099 doesn't matter at the app level — that's a payroll classification. If the owner thinks of someone as "on my team," they're an org member.

**The subs** (the vendor kind) stay on `fh_subs` and `fh_sub_profiles`, unchanged. These are external companies the contractor contracts with: a plumbing company, a roofer's roofer, a backhoe operator who bills you. Tracked for expenses, COIs, W9s, payment status. They can show up on the schedule as "Smith Plumbing on site Tuesday 9 to 12" without being on the team, without a login, without a shift, without a timesheet.

**The one-off scoped invites** stay on `fh_job_partners`, also unchanged. A single-job link for a sub who needs to drop in a photo, a builder client you're sharing one job with, an inspector posting a report. No login, just a scoped URL to one job.

The owner decides the bucket. The model doesn't force a choice and doesn't make the owner learn employment law to use the app.

### 4. Time tracking must be offline-first

This is not in the spec but it's required. The audit (FH-058) flagged the absence of an offline write queue. Time entries are exactly the workload that demands one. Approach: write each punch event to local IndexedDB immediately with a client-generated UUID. A background worker drains the queue when online, using the UUID as the idempotency key so retries don't double-punch. Display "1 entry waiting to sync" in the punch in screen so the crew sees their action landed locally.

---

## Data model: what exists, what's new

### Reuse as-is (with `org_id` added)

| Concept | Existing table | Today's row count |
|---------|---------------|-------------------|
| Jobs | `fh_contacts` | 33 |
| Documents | `fh_job_files` | 63 |
| Tasks, punch list | `fh_job_todos` | 11 |
| General schedule | `fh_schedule` | 30 |
| Subs | `fh_sub_profiles` + `fh_subs` | 0 + 8 |
| Notes | `fh_notes` | 24 |
| Notifications | `fh_notifications` | 1 |
| Customers | `fh_clients` | 28 |
| Quotes | `fh_quote_items` + `fh_quote_versions` | 23 + 9 |
| Payments | `fh_payments` | 8 |
| Invoices | `fh_invoices` | 0 |
| Change orders | `fh_change_orders` | 0 |

Twenty-eight tables total, all currently scoped by `user_id`. Each gets a nullable `org_id` column in Phase 1. Existing `user_id` stays put. We never drop a column current code reads from.

### Net new tables

```
organizations            id, name, slug, billing_email, created_at, created_by
org_members              id, org_id, user_id, role, invited_by, joined_at
org_invites              id, org_id, email, role, token, expires_at, accepted_at
crews                    id, org_id, name, created_at, created_by
crew_members             crew_id, user_id  -- composite PK
shifts                   id, org_id, contact_id (job), user_id, start_at, end_at,
                         state (scheduled|in_progress|completed|missed|canceled),
                         notes
time_entries             id, org_id, user_id, contact_id (job), shift_id (nullable),
                         clock_in_at, clock_out_at, clock_in_lat, clock_in_lon,
                         clock_in_photo_url, geofence_flag, break_minutes,
                         source (mobile|manual), approved_at, approved_by
timesheets               id, org_id, user_id, week_start_date,
                         total_minutes, status (draft|submitted|approved|exported),
                         submitted_at, approved_at, approved_by
job_assignments          id, org_id, contact_id (job), user_id, role (lead|crew|observer),
                         assigned_at, assigned_by
job_threads              id, org_id, contact_id (job), created_at
                         -- one row per job, lazy created on first message
messages                 id, org_id, thread_id (FK job_threads),
                         sender_user_id, body, attachments jsonb,
                         broadcast_scope (none|crew|org),
                         created_at, edited_at
message_reads            thread_id, user_id, last_read_at  -- composite PK
```

### Role enum

```sql
create type org_role as enum (
  'owner',     -- everything, including billing + delete
  'admin',     -- everything except billing + delete
  'manager',   -- their crews + their jobs, financials visible
  'foreman',   -- their crews + their jobs, financials hidden
  'crew'       -- own shifts, own time, own tasks only
);
```

No separate sub role. A recurring sub the owner wants on the schedule is an `org_member` like anyone else, role picked by the owner. One-off external subs (single job, no login) stay on `fh_job_partners`, which is a separate table for a separate purpose.

The `manager` vs `foreman` split is the only remaining judgment call. They're functionally similar; the distinction is whether they see dollar amounts. We can collapse to one role in v1 and split later if needed.

---

## Phased rollout

Each phase ends shippable. No phase requires the next phase to land. We can pause between any two phases without leaving the system in a broken state.

### Phase 1: Foundation (week one)

**Goal:** the data model exists, but nothing changes for current users.

- Create `organizations`, `org_members`, `org_invites`.
- Add nullable `org_id` to every existing user-scoped table.
- Backfill: for each row in `auth.users`, create one organization (name from `profiles.company_name` or `'My Company'`), insert an `org_members` row with role `owner`, set `org_id` on every existing row owned by that user.
- Do not change a single RLS policy yet. All existing queries still filter by `user_id`. They keep working.
- Ship behind a feature flag: a hidden `/settings/team` screen accessible only to org owners.

**Verification:** every existing user still sees their own data, byte-for-byte. The new `org_id` columns are populated. Spot-check: `select count(*) from fh_contacts where org_id is null` returns zero.

**Rollback:** drop the new tables, drop the new columns. No application code references them yet.

**Risk:** low. Pure additive schema work. Worst case the backfill misses a few rows; we re-run.

### Phase 2: RLS switch (week two)

**Goal:** RLS now filters by org_id, not user_id. Old behavior preserved because every existing user is in their own org of one.

- Rewrite each user-scoped RLS policy from `user_id = auth.uid()` to `org_id in (select org_id from org_members where user_id = auth.uid() and revoked_at is null)`.
- Add a helper function `auth.user_org_ids()` that returns the set, so policies stay readable.
- Change `org_id` on the new and existing tables from nullable to not null.
- App-level queries get the `org_id` filter added explicitly too (don't rely only on RLS for hot paths; helps query planning).

**Verification:** same spot check as Phase 1 plus query the live system end to end as a real user. Any 401 or empty list = a policy needs revisiting.

**Rollback:** keep the previous RLS policies in a comment block in the migration; restore in one apply.

**Risk:** medium. RLS bugs are silent (you see fewer rows, not an error). Mitigate with a staging branch in Supabase, run the existing app against it, eyeball every screen.

### Phase 3: Invite flow and team management (week three)

**Goal:** an owner can invite an employee. The employee gets an email, accepts, lands in the app with the assigned role.

- New Netlify Function `org-invite-send` (service-role to create the `org_invites` row + send email via Resend or whatever the existing send-quote function uses).
- New Netlify Function `org-invite-accept` (validates token, creates `org_members` row, marks invite accepted).
- New screens: `/settings/team` lists members, lets owner invite by email and assign role. `/invite/:token` is the accept landing page.
- The Expo app needs to handle the deep link too (Universal Link `/invite/:token`).

**Verification:** invite a real email address, accept it, see the new user in the members list with the right role. Sign in as that user, confirm they see the org's data.

**Rollback:** disable the invite UI, no schema changes to undo.

**Risk:** medium. Email deliverability is the biggest variable. Test against Gmail, Outlook, iCloud.

### Phase 4: Role gating in the UI (week four)

**Goal:** the role you have determines what you see.

- Add `useRole()` hook that returns the current user's role for the active org.
- Gate financial surfaces (revenue, margins, AR, payments) behind `role in ('owner', 'admin', 'manager')`. Foremen and crew see jobs without the money.
- Gate destructive actions (delete job, mark lost) behind `role in ('owner', 'admin')`.
- Crew-only home screen: just their assigned shifts, their tasks, their punch in button. No client list, no analytics.
- Top-of-app org switcher (only renders for users in more than one org, which is rare but possible for foremen working multiple contractors).

**Verification:** create a test user as each role and walk every route. Anything that should be hidden but isn't is a finding.

**Rollback:** remove the gates. UI reverts to "everyone sees everything in their org."

**Risk:** low-medium. UI work, well-bounded.

### Phase 5: Scheduling and crews (week five)

**Goal:** the spec's system one is built.

- `crews` and `crew_members` tables.
- `shifts` table.
- Drag-and-drop schedule board in the web app (each job is a card, crew members are rows, days are columns).
- Mobile app shows each crew member's week and current day.
- Push notification when a shift is assigned or changed (uses the existing notifications mechanism, extended for org-scoped recipients).

**Verification:** seed a job, drop a crew on it, sign in as the crew member on mobile, see the shift, get the push.

**Risk:** medium. Drag-and-drop schedule boards have a lot of edge cases (multi-day shifts, overlapping shifts, deletes mid-drag). Use `@dnd-kit/core` (already in deps).

### Phase 6: Time tracking and offline outbox (week six)

**Goal:** the spec's system two is built, offline-first.

- `time_entries` table.
- Mobile punch in screen: writes to IndexedDB first, syncs in background. UUID idempotency keys.
- GPS capture + geofence flag computation (server-side, against the job's `address` geocoded once and cached).
- Web app shows the live punch state per crew member on the owner dashboard.
- Manual entry flow with manager approval for the offline cases (or for forgotten punches).

**Verification:** punch in with airplane mode on. Switch airplane mode off. Confirm the entry lands without duplicating.

**Risk:** high. Offline write queues are easy to draw and hard to get right. Budget extra time for the sync logic. Test on real devices, not simulators.

### Phase 7: Timesheets and payroll exports (week seven)

**Goal:** Friday approval workflow.

- `timesheets` table.
- Cron (Supabase Edge Function on a schedule) rolls up `time_entries` into weekly `timesheets` rows every Sunday night.
- Owner sees pending timesheets, approves them.
- Export approved timesheets to CSV (or QuickBooks IIF) per pay period.

**Verification:** punch in across a week as a fake crew member, approve the timesheet, export, open the CSV in Excel.

**Risk:** low-medium. Pure data rollup; the CSV format matters for whatever payroll system they use.

### Phase 8: Job-scoped chat (week eight)

**Goal:** the spec's system four.

- `job_threads` + `messages` + `message_reads` tables.
- Real-time updates via Supabase Realtime channels scoped per thread.
- Photo attachments via Supabase Storage with signed URLs.
- Broadcast scope (this thread, this crew, the whole org) gated by role.
- Mobile and web both consume the same channel.

**Verification:** two real users in two browsers, one job, send messages back and forth, confirm read receipts update.

**Risk:** medium. Realtime quotas and channel cleanup are the main gotchas. Keep one channel per active thread; unsubscribe aggressively on unmount.

### Total: eight weeks of focused work for the web app, plus three to four weeks of parallel mobile-app work (punch in, view shifts, see assigned tasks, chat). Best done by overlapping mobile work into phases 5 through 8 once the schema settles.

---

## Concrete RLS rewrite pattern

The bulk of the Phase 2 migration is this same shape repeated about forty times. Here's the canonical example for `fh_contacts`:

```sql
-- 1. Helper function (one-time, idempotent).
create or replace function auth.user_org_ids()
returns setof uuid
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select org_id
  from public.org_members
  where user_id = auth.uid()
    and revoked_at is null
$$;

-- 2. Drop the old policy.
drop policy if exists "fh_contacts_owner_all" on public.fh_contacts;

-- 3. Add the new policy.
create policy "fh_contacts_org_all"
  on public.fh_contacts
  for all
  using (org_id in (select auth.user_org_ids()))
  with check (org_id in (select auth.user_org_ids()));
```

Crew-only restriction (Phase 4) layers on top:

```sql
-- Field crew sees only jobs they're assigned to.
create policy "fh_contacts_crew_assigned_only"
  on public.fh_contacts
  for select
  using (
    case
      when (select role from public.org_members where user_id = auth.uid() and org_id = fh_contacts.org_id) = 'crew'
        then exists (
          select 1 from public.job_assignments
          where contact_id = fh_contacts.id
            and user_id = auth.uid()
        )
      else true
    end
  );
```

Every table follows the same shape. The migration generator can output all of them from a list of table names.

---

## Open decisions before Phase 1 ships

These need an explicit answer from you (or your contractor buddies as design partners) before code:

1. **Manager vs foreman as one role or two?** Default: collapse to one role called `manager` in v1, split if real users ask.
2. **Per-seat pricing model.** Free for owner-only orgs, $X per additional member per month? Or a flat tier (Pro = up to 5 seats, Team = up to 20)? `profiles.subscription_tier` already exists, just no enforcement.
3. **Email provider for invites.** Existing `send-quote` and friends use what? Resend? SendGrid? Re-use whatever's wired.
4. **Org switcher trigger.** Most users will only ever belong to one org. Hide the switcher unless they're in more than one, or show it always as a header element?
5. **Crew member onboarding flow.** When a crew member accepts an invite, do they go through the existing onboarding (which is geared at a contractor owner) or a stripped-down crew onboarding (just name, profile photo)?

---

## Out of scope for v1

These are real eventual features. Defer.

- Customer portal (the spec's fourth lens). Wait until the other three are stable and we have actual contractor buddies using the system. Adds another role and another RLS layer; not free.
- Payroll integration beyond CSV export. QuickBooks, Gusto, ADP direct integrations are each their own project.
- Multi-org for crew members (a plumber on three contractors). The schema supports it but the UI gets weird fast. Defer until a real user asks.
- Predictive scheduling, AI labor allocation, agent-runtime cross-over. Build the foundation first.

---

## What we're committing to today

This document. Not code. Not a migration. A plan we can argue over and edit before anything touches the live database. The `org_id` column is the single most consequential decision in the whole project. Get it right before we start writing it.

When you're ready, Phase 1 is the first PR. Until then, the production database is untouched.
