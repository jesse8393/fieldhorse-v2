# Claude Code session: Fieldhorse redesign Phase 2 (field screens) plus Phase 1 fixes

Paste this whole file into Claude Code for the `jesse8393/fieldhorse-v2` repository.

## How to run this session

1. Work on the branch behind pull request #217 if it is still open. If #217 is merged, branch from `main` as `redesign/phase-2`.
2. Save this file as `docs/design/2026-10-redesign/PHASE2_PLAN.md` and commit it first.
3. Read `docs/design/2026-10-redesign/SPEC.md` (sections 5, 7, 8, 9.2 to 9.5, 12, 17) and look at these renders before writing code:
   * `glamor/g-today.jpg`, `glamor/g-job.jpg`
   * `base/today.jpg`, `base/jobs.jpg`, `base/job-spine.jpg`, `base/capture.jpg`, `base/night.jpg`
4. Execute the tasks in order. Test first where a task has tests. Commit after each task with a plain sentence case message.
5. **Done rule.** A screen is not done until Task 13 has produced its side by side image (our build next to the matching render, Day and Night) and you have looked at it and fixed every difference that the spec does not excuse. Put the side by side images in the pull request description. If a difference is deliberate, say why in one line under the image.
6. `npm run test:all` and `npm run audit:design` must pass before you open or update the pull request.

---

# Phase 2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task by task. Steps use checkbox (`* [ ]`) syntax for tracking.

**Goal:** Make Today, Jobs, the Job page and Capture on a phone look and behave like the approved renders, and fix the five problems found in the Phase 1 preview.

**Architecture:** Each screen gets a pure view model in `src/lib/` (unit tested) and a phone layout built only from `src/components/fh/`. Data keeps coming from the existing queries (`useHomeDashboard`, `useJobs`, `useJobData`). Desktop branches (`SnowHome`, `SnowJobDetailBuild`) are left alone until Phase 4.

**Tech Stack:** React 18, TypeScript, Vite 6, TanStack Query, Supabase, vaul, lucide-react, Vitest, Playwright.

**Spec:** `docs/design/2026-10-redesign/SPEC.md`

## Global Constraints

* Phone means below 900 px (`useIsDesktop()` false). Do not change desktop layouts in this phase.
* Build new UI only from `src/components/fh/` and `--fh-` tokens. No new hard coded colors; `npm run audit:design` must stay green.
* Brushed gold on exactly one action per screen, plus the dock coin. Flat gold only for position markers (active tab underline, current stage, dots) and hairlines on onyx.
* No colored left edge on any card or row. No nested card stacks. Lists are hairline rows on plaster.
* Copy: sentence case, no dashes of any kind in text a person can read (use commas, periods or "to"), money with cents in rows and totals, never the words "general contractor".
* Every status color travels with a word.
* Keep every existing feature reachable. Nothing is deleted from the data layer.
* No database migrations.
* The Universal Capture trust rules stay: the model proposes, the person confirms, nothing writes without the confirm tap, `normalizeIntent()` still validates, offline captures still go to the outbox.

## Review Focus

1. **Empty day.** No schedule and no next actions: Today shows "Clear day." and "Nothing on the schedule.", no next stop card, and an empty state with one action. Pinned in Task 6 and Task 8.
2. **Job with no photos, or photo signing fails.** Header falls back to the onyx band with the same text, no broken image box. Pinned in Task 10 and Task 11.
3. **Long names.** A 45 character client or job name wraps to two lines in rows and headers and is never cut off mid word at 390 px. Pinned in Task 4 and Task 9.
4. **Field roles.** Crew and field roles never see money on Jobs rows, group totals or the Job money strip. Pinned in Task 9 and Task 11.
5. **Lost or closed jobs.** The rail shows the neutral Lost chip, the action capsule offers "Reopen", and Lost jobs only appear behind the filter. Pinned in Task 9 and Task 10.

---

## Part A. Phase 1 fixes

### Task 1: Night stage that stays visible

The onyx stage (`#16140F`) disappears on the Night ground (`#171611`). At night, stages get a slightly lifted surface and a gold edge.

**Files:**
* Modify: `src/styles/tokens.css` (Night block at `[data-theme='dark']`)
* Modify: `src/components/fh/OnyxStage.tsx`, `src/components/fh/VaultCard.tsx`, `src/styles/fh-components.css`
* Modify: `docs/design/2026-10-redesign/SPEC.md` section 5.5 (one line recording the change)
* Test: `src/styles/tokens.contrast.test.ts`

**Interfaces:**
* Produces: tokens `--fh-stage` and `--fh-stage-edge`. Day: `--fh-stage: var(--fh-onyx)`, `--fh-stage-edge: transparent`. Night: `--fh-stage: #24211B`, `--fh-stage-edge: rgba(201,150,58,.32)`. OnyxStage and VaultCard paint `background: var(--fh-stage)` and `box-shadow: inset 0 0 0 1px var(--fh-stage-edge)` (full bleed stages draw only the bottom gold hairline they already have).

* [ ] **Step 1: Write the failing tests** in `tokens.contrast.test.ts`:
  * `night stage is lighter than the night ground`: relative luminance of `--fh-stage` > luminance of `--fh-plaster` in Night, and contrast ratio between them ≥ 1.12.
  * `text on the night stage passes`: linen on `--fh-stage` ≥ 4.5 and smoke on `--fh-stage` ≥ 4.5 in Night.
* [ ] **Step 2:** Run `npx vitest run src/styles/tokens.contrast.test.ts`. Expected: FAIL, tokens missing.
* [ ] **Step 3:** Add the tokens and switch OnyxStage, VaultCard and the "on onyx" button panels in `fh-components.css` to them.
* [ ] **Step 4:** Run the test. Expected: PASS. Open `/design` in dev and check that every onyx panel in the Night column is visibly separate from the ground.
* [ ] **Step 5:** Commit.

### Task 2: One gold plus on a phone

Jobs, Schedule and Customers draw their own gold plus beside the dock coin.

**Files:**
* Modify: `src/components/v3/FloatingActionButton.tsx`
* Modify: `src/screens/Work.tsx` (lines 539 to 543), `src/screens/Schedule.tsx` (line 549), `src/screens/Clients.tsx`
* Test: `tests/e2e/redesign-shell.spec.ts`

**Interfaces:**
* Produces: `FloatingActionButton` renders nothing below 900 px. Each screen that used it gets a secondary header button instead: Jobs "New lead" (opens `NewLeadSheet`), Schedule "New event" (opens `AddEventSheet`), Customers "New customer" (opens `NewClientSheet`). Use `Button variant="secondary" size="mini"` with a lucide `Plus` icon. Desktop keeps the floating button.

* [ ] **Step 1: Write the failing e2e test** `phone screens show one gold plus`: on `/work`, `/schedule` and `/clients` at the mobile project, `page.locator('.fh-fab')` has count 0, and the header button with the names above is visible.
* [ ] **Step 2:** Run `npx playwright test tests/e2e/redesign-shell.spec.ts --project=mobile-chrome -g "one gold plus"`. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run the test. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 3: Content tucks under the dock

Content does scroll out from under the dock, but nothing shows it is passing behind it, so buttons look covered. Add the plaster fade from the renders.

**Files:**
* Modify: `src/styles/fh-shell.css` (`.fhs-dock`), `src/styles/global.css` (`.fh-app__main` bottom padding)

**Interfaces:**
* Produces: a fixed, `pointer-events: none` gradient behind the dock, 40 px tall above the capsule top: `linear-gradient(180deg, transparent, var(--fh-plaster))`. Bottom padding of `.fh-app__main` on a phone becomes `calc(var(--fh-mobile-dock-height) + 32px)` so the last row clears the raised coin.

* [ ] **Step 1:** Implement.
* [ ] **Step 2:** In the mobile Playwright project, scroll `/invoices` and `/clients` to the bottom and check with a bounding box assertion that the last interactive element's bottom is above the dock's top. Add this as test `last item clears the dock` in `redesign-shell.spec.ts`. Expected: PASS.
* [ ] **Step 3:** Commit.

### Task 4: Short company name in the header

The header shows `profile.company_name` and truncates "Parker Construction Comp...".

**Files:**
* Create: `src/lib/headerName.ts`, `src/lib/headerName.test.ts`
* Modify: `src/components/AppHeader.tsx`, `src/styles/fh-shell.css:102`

**Interfaces:**
* Produces: `headerName(orgName: string | null | undefined, companyName: string | null | undefined, fullName: string | null | undefined): string`. Order: org name, then company name, then full name, then "Your company". Trims, drops a trailing "Company", "Co." or "LLC" word.

* [ ] **Step 1: Write the failing tests:**
  * `headerName('Parker Construction', 'Parker Construction Company', 'Jesse Parker')` returns `'Parker Construction'`
  * `headerName(null, 'Parker Construction Company', null)` returns `'Parker Construction'`
  * `headerName(null, 'Shyld Roofing Co.', null)` returns `'Shyld Roofing'`
  * `headerName(null, null, 'Jesse Parker')` returns `'Jesse Parker'`
  * `headerName('', '  ', null)` returns `'Your company'`
* [ ] **Step 2:** Run `npx vitest run src/lib/headerName.test.ts`. Expected: FAIL.
* [ ] **Step 3:** Implement and use it in `AppHeader.tsx` with `useMembership().orgName`. Let the name wrap to two lines at 15 px before it ever truncates.
* [ ] **Step 4:** Run the tests. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 5: Banned wording

**Files:**
* Modify: `src/screens/Landing.tsx:132`
* Create: `src/lib/copyRules.test.ts`

* [ ] **Step 1: Write the failing test** `no screen says general contractor`: read every `src/**/*.tsx` file, strip `//` and `/* */` comments, assert no match for `/general contractor/i`.
* [ ] **Step 2:** Run it. Expected: FAIL on `Landing.tsx`.
* [ ] **Step 3:** Replace the sentence with exactly: "Built by someone who runs a construction company and needed it, not by a software company guessing at what the trades do all day."
* [ ] **Step 4:** Run it. Expected: PASS.
* [ ] **Step 5:** Commit.

---

## Part B. Today

### Task 6: Today headline

The hero sentence is built in code, never by the model.

**Files:**
* Create: `src/lib/todayHeadline.ts`, `src/lib/todayHeadline.test.ts`

**Interfaces:**
* Produces:
  * `type HeadlineStop = { startAt: string; title: string | null }`
  * `dayHeadline(stops: HeadlineStop[]): { title: [string, string] }`
  * `nightHeadline(input: { stopsToday: number; openAnswers: number }): { title: [string, string] }`
  * `isPour(title: string | null): boolean`, true when the title contains a word starting with "pour" (case insensitive)

* [ ] **Step 1: Write the failing tests** (times are local; format `h:mm`, 12 hour, no am or pm):
  * three stops, first titled "Pour slab, crew A" at 7:30: `['Three stops.', 'First pour at 7:30.']`
  * two stops, first "Site visit" at 9:00 and a later pour: `['Two stops.', 'First at 9:00.']`
  * one stop at 13:15: `['One stop.', 'First at 1:15.']`
  * zero stops: `['Clear day.', 'Nothing on the schedule.']`
  * twelve stops: first line `'12 stops.'` (words up to ten, numerals after)
  * stops arrive out of order: the earliest start decides the second line
  * `nightHeadline({ stopsToday: 3, openAnswers: 2 })`: `['Three stops done.', 'Two things before tomorrow.']`
  * `nightHeadline({ stopsToday: 0, openAnswers: 0 })`: `['Quiet day.', 'Nothing waiting on you.']`
  * `nightHeadline({ stopsToday: 1, openAnswers: 1 })`: `['One stop done.', 'One thing before tomorrow.']`
* [ ] **Step 2:** Run `npx vitest run src/lib/todayHeadline.test.ts`. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 7: Today view model

**Files:**
* Modify: `src/lib/homeDashboard.ts` (the today schedule query near line 690, `HomeTodayOnSite`, `HomeDashboardBundle`, `buildHomeDashboardBundle`)
* Modify: `src/lib/homeDashboard.test.ts`
* Create: `src/lib/todayView.ts`, `src/lib/todayView.test.ts`

**Interfaces:**
* Consumes: `dayHeadline`, `nightHeadline` (Task 6); `dayWindows`, `resolveTheme` from `src/lib/themeMode.ts`; `workWindow`, `weatherLabel` from `src/lib/weather.ts`.
* Produces:
  * `HomeTodayOnSite` gains `address: string | null` and `jobTitle: string | null` (select `fh_contacts(name, stage, address, job_title)`).
  * `HomeDashboardBundle` gains `tomorrowOnSite: HomeTodayOnSite[]` (same query for the next local day, limit 6).
  * `isEvening(now: Date, lat?: number | null, lon?: number | null): boolean`: true when `resolveTheme('auto', now.getTime(), dayWindows(now, lat, lon)).theme === 'dark'` and `now.getHours() >= 12`. Uses sun times, not the display mode, so Night mode at noon still shows the day view.
  * `buildTodayView(input: { bundle: HomeDashboardBundle; now: Date; lat?: number | null; lon?: number | null; weather?: { tempF: number | null; code: number | null; window: { status: 'go' | 'warn' | 'stop'; label: string } } | null }): TodayView`
  * `type TodayView = { evening: boolean; title: [string, string]; weatherLine: string | null; nextStop: { jobId: string; title: string; startAt: string; address: string | null; photoUrl: string | null } | null; answers: HomeNextAction[]; answersTotal: number; day: HomeTodayOnSite[]; done: HomeTodayOnSite[]; tomorrow: HomeTodayOnSite[] }`
    * `nextStop`: the first `todayOnSite` item whose `endAt` is after `now`, with `photoUrl` from `bundle.photoUrlByJob`.
    * `answers`: first 3 of `bundle.nextActions`; `answersTotal`: its length.
    * `done`: today items whose `endAt` is before `now`.
    * `weatherLine`: `"71° and partly cloudy. Pour window is good until 3 pm."` style. Use `weatherLabel(code)` in lower case after the temperature, then the window label as its own sentence. Null when there is no weather.

* [ ] **Step 1: Write the failing tests:**
  * `homeDashboard.test.ts`: the bundle carries `address`, `jobTitle` and `tomorrowOnSite` from the source.
  * `todayView.test.ts`:
    * at 6:40 am with three stops, `evening` false, `title` equals `dayHeadline` output, `nextStop.jobId` is the first stop
    * at 3:00 pm with the first stop finished, `nextStop` is the second stop and `done` holds the first
    * at 7:40 pm in Murfreesboro (35.85, -86.39) in October, `evening` true and `title` equals `nightHeadline` output
    * at 5:00 am (dark, before noon), `evening` false
    * empty bundle: `nextStop` null, `answers` empty, `title` `['Clear day.', 'Nothing on the schedule.']`
    * eight next actions: `answers.length` 3, `answersTotal` 8
    * `photoUrlByJob` missing the job: `nextStop.photoUrl` null
* [ ] **Step 2:** Run both test files. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 8: Today screen on a phone

Rebuild the mobile branch of `Home.tsx` to match `g-today.jpg` (day) and `night.jpg` (evening content, any theme).

**Files:**
* Create: `src/screens/today/TodayPhone.tsx`, `src/screens/today/today.css`
* Modify: `src/screens/Home.tsx` (mobile branch only; keep the crew, sub portal and desktop routing)
* Test: `tests/e2e/today.spec.ts`

**Interfaces:**
* Consumes: `buildTodayView` (Task 7), `getWeather` and `workWindow`, `OnyxStage`, `PhotoCard`, `Row`, `Button`, `Chip`, `SyncPill`, `EmptyState`, `Skeleton`.

**Layout, top to bottom:**
1. `OnyxStage` with glow, running under the header, about 46 percent of the first screen. Inside: date line ("Thursday, October 9", evening "Thursday, 7:40 pm"), the two line title in Barlow Condensed 38/40, the weather line with a thin cloud icon (evening: moon icon and tomorrow's first stop). Gold hairline at the bottom.
2. Next stop `PhotoCard` overlapping the stage edge by 48 px, in a paper tray: eyebrow "Next stop, 7:30 am", title job name, action "Navigate" (opens `https://maps.apple.com/?daddr=` plus the encoded address on iOS, Google Maps otherwise). Hidden in the evening and when `nextStop` is null.
3. "Needs an answer" section title with the count. Up to 3 `Row`s with a dot and one mini action. Map `urgencyTone` to dots: danger to danger, warn to neutral, success to info. Action labels by `HomeNextAction.kind`: Remind, Nudge, Reply, Schedule, Close job (keep `nextActionPath` for the row link). "See all" link to the full list when `answersTotal > 3`.
4. Day: "Your day" with a "Week" link to `/schedule`. Rows: time column ("7:30" over "am"), job title, one line of detail, address with Navigate. Evening: "Today, done" rows with a `Done` chip, then "Tomorrow" rows.
5. Remove from the phone view: the "Total pipeline" hero, the quick action grid, the KPI tiles, the pipeline preview, the greeting with the gold name. The desktop view keeps them for now.

**States:** `Skeleton` shaped like the stage, card and three rows while loading. `DataErrorState` with retry on error. Empty day: the stage shows "Clear day.", then `EmptyState` with icon `CalendarPlus`, title "Nothing scheduled today", action "Plan the week" to `/schedule`.

* [ ] **Step 0: Let the mock take overrides.** In `scripts/qa-mock.mjs`, `installMock(ctx, options)` accepts `options.tables?: Partial<Record<string, object[]>>` (replaces those tables for this context only) and `options.role?: string` (overrides the `org_members` role, instead of the `QA_ROLE` env var read at import). `restResponse` reads from a per context table set. Existing callers keep working unchanged. Move the `signIn` helper from `redesign-shell.spec.ts` into `tests/e2e/helpers/signIn.ts` with the signature `signIn(context, { mode?: 'auto' | 'day' | 'night'; tables?; role? })` and use it in every new spec.
* [ ] **Step 1: Write the failing e2e tests** in `today.spec.ts` (mobile project, `signIn` from the helper, mock Open Meteo with `context.route('https://api.open-meteo.com/**', ...)`):
  * `today shows the headline and the next stop`: heading text matches `/stops?\.|Clear day\./`, a link named "Navigate" is visible, the section "Needs an answer" lists at most 3 rows.
  * `today has one brushed gold action`: inside `main`, `.fhc-btn--primary` count is at most 1 (the dock coin sits outside `main`).
  * `empty day`: with `tables: { fh_schedule: [], fh_contacts: [] }`, the text "Clear day." and "Nothing scheduled today" are visible and no "Navigate" link exists.
  * `evening content`: with the clock set by `page.clock.setFixedTime` to 19:40 local, the text "Today, done" or "Tomorrow" is visible.
* [ ] **Step 2:** Run `npx playwright test tests/e2e/today.spec.ts --project=mobile-chrome`. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

---

## Part C. Jobs

### Task 9: Jobs view model

**Files:**
* Create: `src/lib/jobsList.ts`, `src/lib/jobsList.test.ts`

**Interfaces:**
* Consumes: `JobRow` from `src/lib/queries.ts`, `stageLabel` from `src/lib/stages.ts`.
* Produces:
  * `type JobsTab = 'all' | 'leads' | 'quotes' | 'jobs' | 'done'` (decision D3; Lost lives behind the filter)
  * `JOBS_TABS: { id: JobsTab; label: string }[]` with labels All, Leads, Quotes, Jobs, Done
  * `type JobsGroup = { id: 'jobs' | 'quotes' | 'leads' | 'done' | 'lost'; title: string; total: number | null; note: string; rows: JobsRowView[] }`
  * `type JobsRowView = { id: string; title: string; subline: string; money: string | null; next: string | null; chip: { label: string; tone: 'success' | 'info' | 'danger' | 'neutral' } | null; to: string }`
  * `buildJobsList(input: { jobs: JobRow[]; tab: JobsTab; showLost: boolean; showMoney: boolean; now: Date }): { counts: Record<JobsTab, number>; groups: JobsGroup[] }`
  * Group order in All: Jobs (job and invoice stages), Quotes, Leads, Done. Group notes, built from the group's own numbers: Jobs "{total} in progress", Quotes "{total} waiting", Leads "{n} new this week", Done "Last 30 days". Lost group only when `showLost`.
  * Row: `title` is the contact `name`, `subline` the `job_title`, `money` the amount with cents (null when `showMoney` is false), `next` the follow up or quote sent line ("Sent yesterday", "Follow up Oct 12", "Viewed twice, 4 days" when the data has it), `chip` for states that need a color: on site today (success), starts on a date (info), overdue follow up (danger, "Follow up 9 days overdue"), draft (neutral), new lead under 48 hours (info, "New").

* [ ] **Step 1: Write the failing tests:**
  * counts for the mock contacts in `scripts/qa-mock.mjs`: all 7, leads 2, quotes 2, jobs 2 (job and invoice stages), done 1; the lost contact is excluded from every count and appears only when `showLost`
  * tab `quotes` returns only the Quotes group
  * `showMoney: false` gives `money: null` on every row and `total: null` on every group, and notes without dollar amounts ("2 waiting")
  * a lead with `follow_up_on` 10 days ago gets the danger chip "Follow up 10 days overdue"
  * a 45 character client name is passed through untruncated
  * the text the code writes itself (`next`, chip labels, group titles and notes) never contains a hyphen, en dash or em dash; names and job titles typed by people pass through untouched
* [ ] **Step 2:** Run `npx vitest run src/lib/jobsList.test.ts`. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 10: Jobs screen on a phone

Rebuild the mobile view of `Work.tsx` to match `base/jobs.jpg`.

**Files:**
* Create: `src/screens/jobs/JobsPhone.tsx`, `src/screens/jobs/JobsFilterSheet.tsx`, `src/screens/jobs/jobs.css`
* Modify: `src/screens/Work.tsx` (render `JobsPhone` below 900 px; keep the current desktop list until Phase 4; keep `?stage=` syncing, mapping old values `active` to `jobs` and `lost` to `showLost`)
* Test: `tests/e2e/jobs.spec.ts`

**Layout:** Condensed title "Jobs" 36/40. Icon buttons: search (reveals the existing search field, focused) and filter (opens `JobsFilterSheet` with a "Show lost jobs" switch and sort by "Next step" or "Amount"). Text tabs with counts on a hairline, gold 2 px underline on the active one, horizontally scrollable without a scrollbar. Groups as section labels with the note on the right, then `Row`s: title, subline, money, next, chip. The whole row links to the job. Header "New lead" secondary button from Task 2.

**Removed on a phone:** the old `DealCard` with its colored left edge and per row menu, the gold "All" pill, the stats line "6 open, $154K in play". Stage actions stay available on the Job page.

* [ ] **Step 1: Write the failing e2e tests:**
  * `jobs title and tabs`: heading "Jobs", tabs "All", "Leads", "Quotes", "Jobs", "Done" visible, no element with class `fh-deal-card`.
  * `lost behind the filter`: "Old Mill HOA" not visible; after the filter sheet switch "Show lost jobs" it is visible.
  * `crew sees no money`: with `signIn(context, { role: 'crew' })`, no text matching `/\$\d/` inside the list.
  * `rows open the job`: tapping "Plumbing Bellevue" goes to `/jobs/c-job1`.
* [ ] **Step 2:** Run `npx playwright test tests/e2e/jobs.spec.ts --project=mobile-chrome`. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

---

## Part D. Job page

### Task 11: The Spine view model

**Files:**
* Create: `src/screens/ContactDetail/lib/spine.ts`, `src/screens/ContactDetail/lib/spine.test.ts`

**Interfaces:**
* Consumes: `composeActivityEvents` and `ActivityEvent` from `src/screens/ContactDetail/sections/composeActivityEvents.ts`; photo rows `{ id, storage_path, uploaded_at, caption }` from `fh_job_files`; inspections from `useJobData`.
* Produces:
  * `type SpineItem = { id: string; at: Date; time: string; day: string; title: string; subline: string | null; tone: 'success' | 'neutral'; photos: { src: string; alt: string }[] }`
  * `buildSpine(input: { events: ActivityEvent[]; photos: { id: string; uploaded_at: string; caption: string | null; url: string | null }[]; inspections: { id: string; result?: string | null; inspected_at?: string | null; type?: string | null }[]; now: Date }): SpineItem[]`
  * Newest first. Photos uploaded within 15 minutes of each other merge into one item "N photos" with up to 3 thumbnails (skip photos whose `url` is null). Passed inspections, payments and approvals get tone success. `time` is "7:12" and `day` is "today", "Wed", or "Sep 30" past a week.
  * `jobMoney(input: { contractTotal: number; paid: number; balance: number; marginPct: number | null }): { contract: string; paid: string; balance: string; marginChip: { label: string; tone: 'success' | 'neutral' | 'danger' } | null }` using `marginTier` from `src/lib/stages.ts`: good is success, warn is neutral, thin is danger. Label "31.2% margin".

* [ ] **Step 1: Write the failing tests:**
  * events and photos interleave newest first
  * three photos 4 minutes apart become one item titled "3 photos" with 3 thumbnails; a fourth an hour later is its own item
  * a photo with `url: null` is dropped from thumbnails and never renders a broken image
  * a payment event has tone success; a note has tone neutral
  * `day` is "today" for this morning, a weekday name inside 7 days, "Sep 30" beyond
  * `jobMoney` with margin 31.2 gives a success chip "31.2% margin"; 12 gives danger; null gives no chip
  * titles the code writes itself ("3 photos", "Payment received", "Inspection passed") never contain a hyphen, en dash or em dash; note text typed by people passes through untouched
* [ ] **Step 2:** Run `npx vitest run src/screens/ContactDetail/lib/spine.test.ts`. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 12: Job page on a phone

Rebuild the mobile top of `ContactDetail` and its Overview tab to match `glamor/g-job.jpg`.

**Decision D5 (record it in SPEC.md section 17):** the spec's "Details sheet" is replaced by keeping the existing section tabs below the quick actions, restyled as text tabs. Overview becomes the Spine. This keeps every section (Quote, Details, Selections, Materials, Change orders, Daily logs, Financials, Files) one tap away with less risk.

**Files:**
* Create: `src/screens/ContactDetail/phone/JobHeaderPhone.tsx`, `src/screens/ContactDetail/phone/JobActionCapsule.tsx`, `src/screens/ContactDetail/phone/SpineList.tsx`, `src/screens/ContactDetail/phone/job-phone.css`
* Modify: `src/screens/ContactDetail/index.tsx` (mobile branch: replace the local `Header`, `StageTimeline` and the full width stage CTA), `src/screens/ContactDetail/tabs/Overview.tsx` (mobile: render `SpineList` first, keep the existing cards below it under a "More about this job" disclosure)
* Test: `tests/e2e/job.spec.ts`

**Interfaces:**
* Consumes: `buildSpine`, `jobMoney` (Task 11), `fetchCoverPhotosByJob` from `src/lib/photos.ts`, `signedUrlsFor` from `src/lib/signedUrls.ts`, `contractTotals` from `src/lib/invoices.ts`, `margin` from `src/lib/stages.ts`, `StageRail`, `SpineEntry`, `IconButton`, `Chip`, `Button`, `useHideDock` from `src/lib/dockVisibility.ts`, the existing `stageCta`.

**Layout:**
1. Photo header, 34 percent of the screen, full bleed under the status bar: newest job photo, top gradient for the status bar, bottom fade into an onyx band. Translucent round back and more buttons (`IconButton variant="onyx"`). "14 photos" pill opens the Files tab on Photos. No photo, or signing fails: the onyx band alone with the same text, no image box.
2. Onyx band: title is the `job_title` (falls back to `name`) in linen Barlow Condensed 34/36, then `name` and the address in smoke, gold hairline.
3. `StageRail` (Lost shows the neutral chip).
4. Money strip between hairlines: Contract, Paid, Balance, margin chip. Hidden for field roles (existing `showMoney` logic).
5. Quick actions: Call, Message, Navigate, Photos as 48 px round paper buttons with labels.
6. Section tabs (D5) as text tabs with the gold underline. Overview is labeled "Spine".
7. `JobActionCapsule`: floating onyx capsule above the home indicator with camera and microphone round buttons and one brushed gold button whose label and action come from `stageCta` (Send quote, Approve quote, Schedule, Create invoice, Mark complete, Reopen). Camera opens the Files tab photo upload; microphone opens Capture attached to this job (Task 13). The page calls `useHideDock()` while mounted on a phone.

* [ ] **Step 1: Write the failing e2e tests:**
  * `job header and rail`: on `/jobs/c-job1`, heading "Slab + trench" with "Plumbing Bellevue" beneath it, the rail's current segment is "Job", the dock is hidden, the capsule's gold button is visible and fully inside the viewport.
  * `job without photos`: no `img` inside the header; the onyx band text is visible.
  * `spine first`: the "Spine" tab is selected and "Inspector confirmed Friday." is listed.
  * `lost job`: on `/jobs/c-lost`, the rail shows "Lost" and the capsule button reads "Reopen".
  * `crew sees no money`: with `signIn(context, { role: 'crew' })`, no "Contract" label.
* [ ] **Step 2:** Run `npx playwright test tests/e2e/job.spec.ts --project=mobile-chrome`. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

---

## Part E. Capture

### Task 13: Capture sheet in the new style, attachable to a job

Match `base/capture.jpg`. Keep every rule in `NORTH_STAR.md`.

**Files:**
* Create: `src/lib/captureAttach.ts`, `src/lib/captureAttach.test.ts`
* Modify: `src/components/CaptureSheet.tsx`, `src/components/fh/Dock.tsx` (no change to the event name)

**Interfaces:**
* Produces:
  * The `fh:open-capture` event accepts `detail: { jobId?: string }`. Helper `openCapture(detail?: { jobId?: string }): void` exported from `src/lib/captureAttach.ts`.
  * `withAttachedJob(roster: RosterEntry[], job: RosterEntry | null): RosterEntry[]` puts the attached job first and never duplicates it, so `normalizeIntent` keeps its id even when the job is a lead or quote outside `ACTIVE_STAGES`.
  * `seedJob(intent: CaptureIntent, jobId: string | null): CaptureIntent` sets `job_id` only when the model left it empty.

**Layout:** `Sheet` (fh) with title "Capture" and "Done". Input phase: microphone, text field, "File it" brushed gold. Confirm phase on `--fh-tray`: "Heard" with the transcript, "Filed as" chips (kind, action, time, job), a line naming the attached job with "Change" (opens the existing job select), brushed gold "Save" and secondary "Edit". Below the panel, "Or start with" rows: Photo, Note, Lead, Quote, Invoice, Expense, Time, each a `Row` with an icon tile, a gray hint and a chevron, wired to the existing flows. "Just save it as a note" stays as a quiet button.

* [ ] **Step 1: Write the failing tests** in `captureAttach.test.ts`:
  * `withAttachedJob` with a lead not in the roster returns it first, length plus one
  * `withAttachedJob` with a job already in the roster moves it first without a duplicate
  * `normalizeIntent` on a model reply naming the attached lead's id keeps the id when the roster comes from `withAttachedJob`
  * `seedJob` fills an empty `job_id` and leaves a model chosen one alone
* [ ] **Step 2:** Run `npx vitest run src/lib/captureAttach.test.ts`. Expected: FAIL.
* [ ] **Step 3:** Implement the helpers and the restyle. The microphone in `JobActionCapsule` calls `openCapture({ jobId })`.
* [ ] **Step 4:** Run the unit tests, then `npx playwright test tests/e2e/redesign-shell.spec.ts --project=mobile-chrome`. Expected: PASS.
* [ ] **Step 5:** Commit.

---

## Part F. Proof

### Task 14: Side by side review images

**Files:**
* Create: `scripts/compare-renders.mjs`
* Create (output, committed): `docs/design/2026-10-redesign/phase2-review/*.png`

**Interfaces:**
* `node scripts/compare-renders.mjs` starts nothing itself; it expects `npm run dev` with the mock env from `playwright.config.ts`. It signs in with `installMock` and `session` from `scripts/qa-mock.mjs`, mocks Open Meteo, and at 390 by 844, device scale 2, captures Day and Night for `/`, `/work`, `/jobs/c-job1` and the open Capture sheet. For each it writes one PNG with our screen on the left and the matching render on the right, both scaled to the same height:
  * `/` with `glamor/g-today.jpg`
  * `/work` with `base/jobs.jpg`
  * `/jobs/c-job1` with `glamor/g-job.jpg`
  * Capture with `base/capture.jpg`
  * Night `/` at 19:40 with `base/night.jpg`

* [ ] **Step 1:** Write the script (use `sharp`, already a dev dependency, for the side by side).
* [ ] **Step 2:** Run it and look at every image. List each difference. Fix each one that the spec does not excuse, then run it again.
* [ ] **Step 3:** Run `npm run test:all` and `npm run audit:design`. Expected: both pass.
* [ ] **Step 4:** Commit the script and the images. Put the images in the pull request description with one line per deliberate difference.

---

## Self review notes

* Spec coverage: 9.2 Today (Tasks 6 to 8), 9.3 Jobs (Tasks 9 and 10), 9.4 Job (Tasks 11 and 12, with D5 replacing the Details sheet), 9.5 Capture (Task 13), section 12 contrast (Task 1), Phase 1 defects (Tasks 1 to 5). Desktop screens, Money, Quote, Inbox, Portal and Login stay in later phases.
* The Today next actions keep `nextActionPath`, so the existing deep links into a job tab keep working.
