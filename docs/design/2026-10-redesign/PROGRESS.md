# Redesign progress, overnight run (Phases 2 to 7)

Run rules and plans: `PHASE2_PLAN.md` to `PHASE7_PLAN.md` in this folder, decisions in `SPEC.md` section 17.

**If this run is picked up by a new session:** read this file first and continue from the first task that is not `done`.

## Morning summary

Not written yet. It goes here when the run finishes or has to stop.

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
| 4 | `redesign/phase-4` | not opened yet | `redesign/phase-3` |
| 5 | `redesign/phase-5` | not opened yet | `redesign/phase-4` |
| 6 | `redesign/phase-6` | not opened yet | `redesign/phase-5` |
| 7 | `redesign/phase-7` | not opened yet | `redesign/phase-6` |

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
| 4 | 4.1 Schedule layout helpers | todo | | |
| 4 | 4.2 Week board and Unscheduled tray | todo | | |
| 4 | 4.3 Desktop Job page | todo | | |
| 4 | 4.4 Command palette actions | todo | | |
| 4 | 4.5 Desktop Today (stretch) | todo | | |
| 4 | 4.6 Desktop Money (stretch) | todo | | |
| 4 | 4.7 Phase 4 review and pull request | todo | | |
| 5 | 5.1 Portal view model | todo | | |
| 5 | 5.2 Fieldhorse proposal theme | todo | | |
| 5 | 5.3 Welcome and Login | todo | | |
| 5 | 5.4 Phase 5 review and pull request | todo | | |
| 6 | 6.1 Inbox data and engine switch | todo | | |
| 6 | 6.2 Inbox list | todo | | |
| 6 | 6.3 Thread with the AI draft | todo | | |
| 6 | 6.4 Phase 6 review and pull request | todo | | |
| 7 | 7.1 Unused components | todo | | |
| 7 | 7.2 Dead CSS guarded by screenshots | todo | | |
| 7 | 7.3 Final record and morning summary | todo | | |

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
