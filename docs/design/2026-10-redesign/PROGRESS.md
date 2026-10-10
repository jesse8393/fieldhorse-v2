# Redesign progress, overnight run (Phases 2 to 7)

Run rules and plans: `PHASE2_PLAN.md` to `PHASE7_PLAN.md` in this folder, decisions in `SPEC.md` section 17.

**If this run is picked up by a new session:** read this file first and continue from the first task that is not `done`.

## Morning summary

Good morning, Jesse. Phases 2 to 7 are all built and pushed. Nothing is merged, nothing was deployed, and no database or server file was touched. Every pull request is a draft, stacked in order, so you can read them one at a time.

### 1. What is done, phase by phase

| Phase | What | Pull request | Checks on its head |
| --- | --- | --- | --- |
| 2 | Today, Jobs, the Job page, Capture and the Night stage on a phone | #217 (existing, a Phase 2 section was added to its description) | Full suite passed: 651 unit tests, Playwright 64 passed |
| 3 | Money and the quote editor on a phone | #218 | 720 unit tests, Playwright 95 passed |
| 4 | Desktop Schedule board, desktop Job page, command palette, and the two stretch tasks: desktop Today and desktop Money | #219 | 801 unit tests, Playwright 153 passed |
| 5 | Customer quote page in the Fieldhorse theme, Welcome and Login | #220 | 812 unit tests, Playwright 198 passed (before the Phase 4 stretch work was merged in, and covered again by the Phase 6 run) |
| 6 | Inbox list and thread with the AI draft | #221 | 850 unit tests, Playwright 270 passed |
| 7 | Cleanup: unused components, dead CSS removed behind a screenshot guard, the final image record | #222 | 850 unit tests, Playwright 270 passed, 184 skipped (the screenshot guard only runs on request) |

On every head lint has 0 errors, and typecheck, build and the design audit pass. No test failed on any final head, and nothing failed persistently before this run either (see "Failing before this run" below). The only trouble was two timing sensitive desktop tests that CI caught on #219. Both now wait for the page, and the fix is on the Phase 4 branch and every branch above it.

### 2. Images worth looking at first

All in `docs/design/2026-10-redesign/final-review/`, our build on the left and the approved render on the right.

* `today-day.png` and `today-night.png`: the new Today.
* `job-day.png`: the Job page on a phone.
* `money-day.png` and `quote-day.png`: the two big Phase 3 screens.
* `schedule-day.png`, `deskjob-day.png`, `palette-day.png`: the three desktop renders.
* `deskhome-day.png` and `deskmoney-day.png`: desktop Today and Money (they sit next to the phone renders, because there is no desktop render for them).
* `portal-day.png`, `portal-approve-day.png` and `portal-night.png`: what your customer sees.
* `login-none.png` and `login-photo.png`: the sign in screen with no photo, and with a stand in photo.
* `thread-day.png` and `thread-night.png`: the Inbox thread.

### 3. Blocked, and things that need you

Nothing is blocked. Five things need your eye:

1. **The Fieldhorse customer page cannot be chosen in Settings yet.** The database only allows four template names, and saving a fifth would fail the whole Settings save. I may not write migrations, so the Fieldhorse card is hidden behind one flag. The SQL to widen the check is in #220 and in decision D22. After you run it, change `FIELDHORSE_TEMPLATE_SAVES` to true in `src/screens/Settings.tsx`.
2. **The Inbox guesses at three live values** (what a held reason looks like, the status of a waiting draft, and where the draft text sits). The Growth Engine tables are not in the migrations. Nothing can send by accident, but please check D26 against the live schema before you turn the engine on for anyone.
3. **Two numbers vanished from desktop Today:** the "N at risk" dollar value and "N behind". Each lead or job behind still shows as a Needs an answer row (up to 6). See D28.
4. **Three design calls are open for you:** the Job page hides the shared header strip (D14, D20), Navigate is outlined rather than gold on Today, and a capture made offline from a job is still saved as a note with no job.
5. **Left alone on purpose:** the six legacy brand colors are still used by the mobile app, the email and document templates, the customer pages and older screens, so they stay in the design audit list. A few unused files outside the plan's list (for example `HomeActivityCard.tsx`, `NewQuoteSheet.tsx`, `SpecTabs.tsx`, `Toaster.tsx` and the unused shadcn parts in `src/components/ui`) are still there.

### 4. New decisions in SPEC.md section 17

D1 to D13 were yours or set before this run. New in this run:

* D14 The shared header strip is hidden on the Job page, which runs the photo under it.
* D15 How the Money groups are counted (overdue, due soon, due this week).
* D16 Where the old phone Money features went (Statements, All invoices, Job balances pages).
* D17 Deposit and status chips on the Quote tab.
* D18 The Quote tab capsule shows Total, deposit and Send for approval.
* D19 Palette shortcuts are Alt plus I, M and N, and only fire inside the open palette.
* D20 Desktop Job page details.
* D21 Desktop Schedule board details.
* D22 The Fieldhorse template choice is hidden until a migration allows it.
* D23 Portal numbers and wording (total, deposit, trust line, approver name).
* D24 Portal layout details (capsule at the end of the page, Full details, Ask about this).
* D25 One onyx shell for Welcome, Login, Reset password and Partner invite.
* D26 The Inbox values it has to guess.
* D27 Who sees the Inbox and how the thread behaves.
* D28 Desktop Today.
* D29 Desktop Money.
* D30 Phase 7 choices (the forecast screen's hero, what was deleted, and what was kept).

### 5. iPhone test checklist

1. Open Today in the morning and again after dark. Look at Day and Night.
2. Tap Capture on Today, then Capture from inside a job. Save a note and a to do.
3. Open a job. Walk the tabs, tap Call and Message, and check the gold button follows the stage.
4. Jobs: switch tabs, open the filter, open a job.
5. Money: open Remind on an overdue invoice and read it, then close it without sending. Open an invoice sheet and the Statements page.
6. Open a quote, switch to the Quote tab, open the preview and check Send for approval.
7. Open a customer link on your phone with a real quote. It will still look like your current template, because the Fieldhorse choice is held back (item 1 above).
8. Sign out and look at Login. Tap the password field, and check Sign in stays above the keyboard.
9. Turn the phone sideways on Today and Jobs, and check nothing overlaps.
10. If you turn the messaging engine on for a test company, open Inbox, open a thread, edit a draft and tap Send once. Do this only for a test customer.

## Failing before this run

Nothing failed persistently on the first full `npm run test:all` of this run, on the Phase 2 head `6013498`:

* lint: 0 errors (57 warnings that were already there)
* typecheck, build and `audit:design`: pass
* unit tests: 651 of 651
* Playwright: 64 passed, 45 skipped by project. One flake showed on a cold dev server (`mock-workflows`, desktop, "Execution context was destroyed, most likely because of a navigation") and passed twice on rerun.

## Branches and pull requests

| Phase | Branch | Pull request | Base |
| --- | --- | --- | --- |
| 2 | `claude/audit-fix-pass-2026-10-09` | #217 | `main` |
| 3 | `redesign/phase-3` | #218 (draft) | the Phase 2 branch |
| 4 | `redesign/phase-4` | #219 (draft) | `redesign/phase-3` |
| 5 | `redesign/phase-5` | #220 (draft) | `redesign/phase-4` |
| 6 | `redesign/phase-6` | #221 (draft) | `redesign/phase-5` |
| 7 | `redesign/phase-7` | #222 (draft) | `redesign/phase-6` |

## Tasks

Status is one of todo, done, blocked, skipped.

| Phase | Task | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
| Setup | Plans, decisions, time zones, this file | done | see git log | Baseline above |
| 2 | Step 0 mock overrides and signIn helper | done | 3738ca9 | |
| 2 | 1 Night stage | done | 60c2ec1 | |
| 2 | 2 One gold plus | done | 7e89d18 | |
| 2 | 3 Dock fade and clearance | done | 574f722 | |
| 2 | 4 Short company name | done | 64cf80e | |
| 2 | 5 Banned wording | done | 4635b44 | |
| 2 | 6 Today headline | done | 55b5b0a | |
| 2 | 7 Today view model | done | b519bd5 | |
| 2 | 8 Today on a phone | done | ec5658d | |
| 2 | 9 Jobs view model | done | f27a973 | |
| 2 | 10 Jobs on a phone | done | ad52ce0 | |
| 2 | 11 Spine view model | done | a24af2e | |
| 2 | 12 Job page on a phone | done | 1132b5a | Includes the Set follow up action in the more menu |
| 2 | 13 Capture sheet attachable to a job | done | 90b387b | `openCapture` stub in 86c335b |
| 2 | 14 Side by side review | done | 6013498 | Fix pass in 046e21d |
| 3 | 3.1 Money view model | done | 9aad8ea | |
| 3 | 3.2 Money on a phone | done | 5d3ae27 | Sub pages for statements, all invoices, job balances |
| 3 | 3.3 Quote view model | done | 5dac52a | |
| 3 | 3.4 Quote editor on a phone | done | c2b2bce | |
| 3 | 3.5 Phase 3 review and pull request | done | see git log | #218, images in phase3-review |
| 4 | 4.1 Schedule layout helpers | done | cec29b2 | |
| 4 | 4.2 Week board and Unscheduled tray | done | 053d488 | `@dnd-kit/core` added in 2146dc7 |
| 4 | 4.3 Desktop Job page | done | 940e23a | |
| 4 | 4.4 Command palette actions | done | 9d704ed | |
| 4 | 4.5 Desktop Today (stretch) | done | bd4e0a3 | Changed the Today parts the phone shares; phone tests unchanged |
| 4 | 4.6 Desktop Money (stretch) | done | c5b7ea4 | Phone sheet logic moved into two shared hooks |
| 4 | 4.7 Phase 4 review and pull request | done | see git log | #219, images in phase4-review |
| 5 | 5.1 Portal view model | done | c6f44a0 | |
| 5 | 5.2 Fieldhorse proposal theme | done | 17b7d31 | Settings choice hidden until a migration allows it (D22) |
| 5 | 5.3 Welcome and Login | done | fd12c62 | |
| 5 | 5.4 Phase 5 review and pull request | done | see git log | #220, images in phase5-review |
| 6 | 6.1 Inbox data and engine switch | done | 45a0515 | Also touched `permissions.ts` and `appLayout.ts`, both additive |
| 6 | 6.2 Inbox list | done | d5588e8 | |
| 6 | 6.3 Thread with the AI draft | done | 0ca4345 | |
| 6 | 6.4 Phase 6 review and pull request | done | see git log | #221, images in phase6-review |
| 7 | 7.1 Unused components | done | see git log | Pour window hero is now an OnyxStage |
| 7 | 7.2 Dead CSS guarded by screenshots | done | see git log | 392 rules removed in 4 batches, 0 changed pixels |
| 7 | 7.3 Final record and morning summary | done | see git log | #222, images in final-review |

## Notes and differences from the plans

* Running the suite in this container: the dev server runs with the mock env (`VITE_SUPABASE_URL=https://qa-mock.supabase.co` and the mock anon key from `playwright.config.ts`). The bundled Chromium is at `/opt/pw-browsers/chromium`; if the repo Playwright config cannot launch a browser, use a scratch config that imports it and sets `launchOptions.executablePath`.

* Decision numbers: the Phase 2 pull request first recorded the Job page header decision as D6. D6 to D13 were then assigned to the later phases, so it is now D14 in `SPEC.md`. The text of #217's description still says D6 for it.
* Unit tests that read the local hour, day or week pin `America/Chicago` as the file loads and in `beforeAll`, and restore it in `afterAll`. Setting it only in `beforeAll` is too late for fixtures that build dates at load time.

### Phase 4 decisions to put in SPEC section 17 when Phase 4 is assembled

* **Palette shortcuts (palette agent).** Plain letters always type. A shortcut is Alt plus I, M or N (Option on a Mac), only while the palette is open and a job row or one of that job's action rows is highlighted. The key caps print the modifier. The handler is on the palette's own key handler, so nothing listens while it is closed.
* **Palette Message action.** No compose flow takes a job, so Message uses the existing `sms:` link (as the phone Job header does) and opens the job when it has no phone. Nothing is sent.
* **Palette results.** `universalSearch` now also returns phone and address for jobs, and the job sub line no longer shows an amount, so crew never see money there.
* **Desktop Job page (jobdesk agent).**
  * No key cap on the gold button, because no global shortcut exists (shortcuts live in the palette only).
  * The shared header strip is hidden on this page and the bell moves into the banner; search stays in the sidebar and under Control or Command K. This extends D14 to desktop.
  * The old rail cards (health, schedule, reports, billing, change orders) are gone; their facts moved to the rail notes, the Balance card and a Change orders section of the facts panel. Health score and next action stay under "More about this job" in the Spine.
  * The gold action shows on every tab, following the stage.
  * Lead, Quote and Lost jobs show "Estimated value" or "Quote total" on the vault card, never "Balance".
  * No `spine` prop was added to `SnowJobDetailBuild`: the Overview tab already renders the Spine.

### Phase 3 notes

* Decisions D15 to D18 in `SPEC.md` cover the Money group rules, where the old phone Money features went, the Quote deposit and status rules, and the Quote tab capsule.
* The Quote tab on a phone sits under the Job page header (rail, money strip, quick actions, tabs), so the render's bare Quote page layout differs by design.
* `src/lib/queries.ts` gained `cost` on the invoices bundle jobs so Money can compute margin. `tests/e2e/mock-workflows.spec.ts` changed two phone assertions that named old phone cards.
* Full suite on the Phase 3 head: lint 0 errors (50 warnings, down from 57), typecheck, build and design audit pass, 720 of 720 unit tests, Playwright 95 passed and 75 skipped by project.

### Phase 7 notes

* Decision D30 in `SPEC.md` covers what was deleted and what was kept.
* The screenshot guard is `tests/e2e/cleanup-guard.spec.ts`. It runs only with `FH_VISUAL=1`. To check a change: `QA_NOW=2026-10-08T14:00:00.000Z FH_VISUAL=1 npx playwright test cleanup-guard`. To retake the baselines add `--update-snapshots`. `QA_NOW` also makes `scripts/qa-mock.mjs` build its dates from that time, so runs repeat. The baselines were shown to be stable over two runs, and a deliberate one rule change (a 0.4 px letter spacing on `.fh-app`) made the guard fail with 872 changed pixels.
* `scripts/find-dead-css.mjs` lists the rules the app can no longer match. It reports none now.
* **Legacy colors still in use (design audit list):** all six, `#C9963A`, `#141414`, `#F2EDE4`, `#5C5C5C`, `#C0392B` and `#2D7A4F`, with their rgb forms. They are named by the mobile app, the email and PDF templates in `netlify/functions`, `src/components/documents`, the public quote and invoice pages, Landing, Settings and many older screens, plus `tokens.css` and `global.css`. None could be dropped.
* Unused files that the plan did not list were left alone, and are named in D30.

### Phase 6 notes

* Decisions D26 and D27 in `SPEC.md` cover the Inbox data guesses and who sees the Inbox. **Check D26 against the live schema:** the Growth Engine tables are not in `supabase/migrations`, so the held reasons and draft status values are best guesses.
* The inbox agent added `tests/e2e/helpers/rpcCalls.ts` and RPC call recording to `scripts/qa-mock.mjs` (an `rpcLog` option and an `rpcCalls(context, name)` reader).

### Phase 5 notes

* Decisions D22 to D25 in `SPEC.md` cover the Settings choice, the portal numbers, the portal layout and the Welcome and Login shell.
* **Needs a migration (not written, the run rules forbid it).** `profiles_estimate_template_check` allows only classic, slate, mint and editorial, so the Fieldhorse card in Settings is hidden behind `FIELDHORSE_TEMPLATE_SAVES` in `src/screens/Settings.tsx`. The portal theme itself works for any company whose `estimate_template` is `fieldhorse`.
* CI on #219 caught two timing sensitive desktop tests (`palette.spec` waited for network idle, `schedule.spec` dropped a keyboard drag before the highlight). Both now wait for the page. Network idle took up to 41 seconds under CPU load locally.
* Full suite on the Phase 5 head: lint 0 errors (46 warnings), typecheck, build and design audit pass, 812 of 812 unit tests, Playwright 198 passed and 116 skipped by project.

### Phase 4 notes

* Decisions D19 to D21 in `SPEC.md` cover the palette shortcuts, the desktop Job page and the Schedule board. The schedule agent also found that a second `NotificationsBell` throws ("cannot add postgres_changes callbacks after subscribe") because the two instances share a channel name, and a CSS hidden header still mounts its bell, so any screen that hides the header must not render its own bell.
* The first dev server load after `@dnd-kit/core` is imported re-optimizes dependencies once and can break a single e2e run.
* The desktop shots in the review images are Day only, as the plan says. There is no desktop render for Today or Money, so those two shots sit next to the phone renders.
* CI on #219 caught two timing sensitive desktop tests (`palette.spec` waited for network idle, `schedule.spec` dropped a keyboard drag before the highlight). Both now wait for the page. Network idle took up to 41 seconds under CPU load locally.

### Phase 4 stretch decisions (D28 and D29 in SPEC section 17)

* **D28, desktop Today.**
  * Today now takes the same props as the phone and shares its parts (`todayParts.tsx`). Both layouts read `buildTodayView`.
  * The KPI tiles, the revenue overview, saved views, the opportunities table and the job health preview are gone. Pipeline numbers live in Reports, and every job they listed is a row in Jobs.
  * "Needs an answer" always shows on desktop, with "Nothing needs an answer right now." when empty, so the right column is never only the week strip.
  * The week strip reads the schedule, Sunday to Saturday like the Schedule screen, with each day linking to `/schedule?d=`.
  * The stage carries New lead and New job as secondary buttons. A full day has no gold action, as on the phone.
  * Two aggregate figures no longer appear anywhere in the app: "N at risk" with its dollar value (`dealsAtRisk`) and "N behind" (`jobsBehind`). Each stalled lead and each behind job is still a Needs an answer row, up to 6. Both numbers stay in the dashboard data.
* **D29, desktop Money.**
  * The vault card sits beside a Total outstanding panel with the three ages, then a strip with Statements, All invoices and Job balances, then the four group tables (Customer, Job, Amount, Status, Action).
  * No gold button on the page. New invoice is a secondary button. The only gold is Send reminder inside the Remind sheet, as on the phone.
  * A row click does what Open does. Overdue rows also have a name button, because Remind is their only action control.
  * The phone's sheets and `?panel=` pages are shared through two new hooks, `useMoneySheets` and `useMoneyPanel`. The 80 row caps on All invoices and Job balances became grow on scroll. Weather left the page.
