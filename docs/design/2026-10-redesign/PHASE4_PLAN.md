# Phase 4 Implementation Plan: Desktop

**Goal:** On screens 900 px and wider, Schedule, the Job page and the command palette match `base/desktop-schedule.jpg`, `glamor/g-desktop-job.jpg` and `base/desktop-command.jpg`. Today and Money on desktop follow if time allows.

**Architecture:** Keep the `Snow*Build` components as the desktop entry points and rebuild their insides with `src/components/fh/` and the Phase 2 and 3 view models. Add back `@dnd-kit/core` (named dependency, latest 6.x) for drag to schedule.

**Spec:** SPEC.md sections 9.10 to 9.12, decision D10.

## Review Focus

1. **Overlapping events.** Two events at the same time sit side by side in the day column, never on top of each other. Pinned in Task 4.1.
2. **Dragging onto a past slot.** Drop is refused with a toast "Pick a time from now on." Pinned in Task 4.2.
3. **Keyboard only.** Every board action works without a mouse, including scheduling a job from the tray through its "Schedule" button. Pinned in Task 4.2.
4. **Job with no photo on desktop.** The banner falls back to onyx. Pinned in Task 4.3.
5. **Palette shortcuts.** Shortcuts only fire while the palette is open, so typing "i" in a text field never creates an invoice. Pinned in Task 4.4.

### Task 4.1: Schedule layout helpers

**Files:** Create `src/lib/scheduleBoard.ts`, `src/lib/scheduleBoard.test.ts`

**Interfaces:**
* `packDay(events: { id: string; start: Date; end: Date }[]): { id: string; column: number; columns: number }[]`. Greedy column packing for overlapping events.
* `unscheduledJobs(jobs: JobRow[], events: { contact_id: string | null; start_at: string }[], now: Date): JobRow[]`. Stage job, no event starting today or later (D10), newest first.
* `slotToRange(day: Date, hour: number, minutes?: number, durationMinutes?: number): { start_at: string; end_at: string }`. Default duration 60 minutes.

* [ ] **Step 1: Write the failing tests:**
  * two events at 9 to 10 and 9:30 to 11 get columns 0 and 1 of 2; a third at 11 to 12 gets column 0 of 1
  * a job with an event tomorrow is not unscheduled; a job whose only event was yesterday is
  * `slotToRange` on Oct 9 at 13 gives 13:00 to 14:00 local as ISO
* [ ] **Step 2:** Run. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 4.2: Week board with the Unscheduled tray

**Files:**
* Modify: `src/components/desktop/SnowScheduleBuild.tsx`, `src/screens/Schedule.tsx` (desktop branch)
* Create: `src/lib/scheduleWrite.ts`, `src/lib/scheduleWrite.test.ts`
* Modify: `src/components/AddEventSheet.tsx` (use the shared create function)
* Modify: `tests/e2e/desktop-route-audit.spec.ts` only if the selectors must change; keep `.fh-build-weekplan` and the 7 `.fh-build-weekplan__day` if at all possible
* Add `@dnd-kit/core` to `package.json`

**Interfaces:**
* `createScheduleEvent(input: { userId: string; orgId: string | null; contactId: string | null; title: string; start_at: string; end_at: string }): Promise<{ id: string } | { error: string }>`. Extracted from AddEventSheet's create path. Also sets `org_id`, which the old path missed.

**Layout:**
* Toolbar: title with the date range ("Oct 4 to 10, 2026"), Today, previous and next, a Week and Month segmented control (Crew is hidden until `assigned_to` is used anywhere), brushed gold "New job".
* Week grid on a paper panel from 7 am to 6 pm:
  * hourly hairlines;
  * the today column tinted, with a gold dot in its header and a 2 px gold now line;
  * event blocks colored by job stage with the status chip tones from spec 5.4, laid out with `packDay`;
  * finished events in muted plaster.
* Right rail: "Unscheduled" cards from `unscheduledJobs`.
  * Each card has a drag handle and a "Schedule" button that opens `AddEventSheet` with the job preset, for keyboard and touch.
  * Dropping a card on a slot calls `createScheduleEvent` with `slotToRange`.
  * Past slots refuse the drop with the toast "Pick a time from now on."
* Below the tray: "Crew this week", only when events carry `assigned_to`.
* Pass the weather the screen already fetches into the toolbar.

* [ ] **Step 1: Write the failing tests:**
  * `scheduleWrite.test.ts` with a mocked Supabase client: the insert payload carries `org_id`, `user_id`, `contact_id`, `title`, `start_at` and `end_at`.
  * e2e desktop: the board shows 7 day columns and an "Unscheduled" heading; with `tables: { fh_schedule: [] }` (the default mock gives Plumbing Bellevue an event two hours out), the job "Plumbing Bellevue" appears in the tray; its "Schedule" button opens the event sheet with the job selected.
* [ ] **Step 2:** Run. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run, including `tests/e2e/desktop-route-audit.spec.ts`. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 4.3: Desktop Job page

**Files:** Modify `src/components/desktop/SnowJobDetailBuild.tsx`, `src/screens/ContactDetail/index.tsx` (desktop branch props). Test `tests/e2e/job.spec.ts` (desktop project).

**Interfaces:** `SnowJobDetailBuild` props gain `coverUrl?: string | null`, `spine?: SpineItem[]`, `money?: ReturnType<typeof jobMoney>`. Existing props stay.

**Layout:**
* Photo banner, 210 px tall with 18 radius, falling back to onyx. Back link "Jobs", title, client and address line, and buttons: secondary Message and Schedule, brushed gold primary action with a key cap.
* Full width `StageRail` with notes under each segment: lead source and date, quote approval date, the next event, balance due.
* Two columns:
  * Left: a composer row (opens Capture attached to the job) above the tabs, with the Spine as the Overview tab.
  * Right: the facts panel. A `VaultCard` for Balance with Contract, Paid and Margin facts (money roles only), then Customer, Address, Crew, Documents and Shared with, as hairline sections.
* Replace the hard coded "Weather not set" with `TopbarWeather`.

* [ ] **Step 1: Write the failing tests:** desktop project on `/jobs/c-job1`: the rail is visible, "Balance" is in the facts panel, the text "Weather not set" is gone; with `role: 'crew'`, no "Balance".
* [ ] **Step 2:** Run. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 4.4: Command palette with actions

**Files:** Create `src/lib/paletteActions.ts`, `src/lib/paletteActions.test.ts`. Modify `src/components/CommandPalette.tsx`.

**Interfaces:**
* `paletteActions(job: { id: string; name: string; job_title: string | null; address: string | null; stage: string } | null, canMoney: boolean): { id: 'invoice' | 'message' | 'note' | 'navigate'; label: string; key: string | null; to?: string; event?: string }[]`
* Labels:
  * "Create invoice for {job_title}" (key I, money roles and job or invoice stage only)
  * "Message {name}" (key M)
  * "Add a note to {job_title}" (key N, opens Capture attached)
  * "Navigate to {address}" (no key, only with an address)

**Layout:** Restyle to spec 9.12:
* paper panel over a 45 percent scrim;
* esc key cap;
* groups Jobs, Actions, Customers, Documents (Documents only when results exist);
* footer key hints.

Shortcuts fire only while the palette is open and a job is highlighted.

* [ ] **Step 1: Write the failing tests:** unit tests for labels, role gating and missing address. e2e desktop: open with Control+K, type "Plumb", "Create invoice for Slab + trench" is listed with the key cap I; pressing "i" inside the job page's note textarea while the palette is closed creates nothing.
* [ ] **Step 2:** Run. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 4.5 (stretch): Desktop Today

* [ ] Rebuild the inside of `SnowHomeBuild.tsx` from `buildTodayView` (Task 7):
  * a left column with the onyx stage, the next stop photo card and "Your day";
  * a right column with "Needs an answer" and the week strip.
  * Remove the KPI tiles and the revenue operating layer from Today. Pipeline numbers live in Reports.
* [ ] Test: desktop e2e shows the headline and "Needs an answer". Commit.

### Task 4.6 (stretch): Desktop Money

* [ ] Rebuild the inside of `SnowInvoicesBuild.tsx` from `buildMoneyView`: the vault card, then the four groups as a table with columns Customer, Job, Amount, Status and Action. Test and commit.

### Task 4.7: Phase 4 side by side review

* [ ] Add `/schedule`, `/jobs/c-job1` and the open palette at 1440 by 900 Day next to the three desktop renders. Review, fix, rerun. `test:all`, `audit:design`, push, draft pull request.
