# Phase 7 Implementation Plan: Cleanup and final proof

**Goal:** Remove what the redesign made dead, without changing how any screen looks, and leave a complete screenshot record.

## Review Focus

1. **A class name built from a variable** (for example `fh-stage-pill--${stage}`) looks unused to a text search. Never delete a selector whose prefix appears in a template string. Pinned in Task 7.2.
2. **A screen not rebuilt yet still needs legacy CSS.** The before and after screenshots catch any change. Pinned in Task 7.2.

### Task 7.1: Unused components

* [ ] Confirm with a search, then delete:
  * `src/components/fx/GreetingTitle.tsx`, `ScanLine.tsx`, `ShimmerBar.tsx`
  * `src/components/v3/FeedRow.tsx`, `IconButton.tsx`, `KpiTile.tsx`, `Pill.tsx`
  * `src/ui/StatCard.tsx`, and `src/ui/Card.tsx` with `src/components/v3/Card.tsx` if nothing else imports them
  * any `fx` or `v3` component that Phases 2 to 6 made unused
* [ ] Before deleting `src/components/fx/Spotlight.tsx`, replace the two `Spotlight` layers in `src/screens/PourWindow.tsx` with an `OnyxStage` header and change nothing else on that screen. Delete `Aurora`, `GridPattern` and `Spotlight` only when a search shows nothing renders them.
* [ ] Update `src/components/v3/index.ts`.
* [ ] `npm run test:all` passes. Commit.

### Task 7.2: Dead CSS, guarded by screenshots

**Files:** Create `scripts/find-dead-css.mjs`. Modify `src/styles/global.css`, `v3.css`, `fixes-2026-07.css`.

* [ ] **Step 0: Make screenshots repeatable.** The mock builds its dates from `Date.now()` when it loads, Today shows clock times and Schedule draws a moving now line, so screenshots differ on every run. Let `scripts/qa-mock.mjs` read `process.env.QA_NOW` (an ISO time) in place of `Date.now()` when it is set, and leave it unchanged otherwise. In the guard spec, set `QA_NOW` and `page.clock.setFixedTime` to the same morning time, use `animations: 'disabled'`, and mask the now line and any live clock. The guard spec runs only when `FH_VISUAL=1` is set (skip otherwise), so `test:all` and CI never run it.
* [ ] **Step 1: Take baselines.** Before removing anything, take Playwright baseline screenshots of these routes:
  * phone Day and Night: `/`, `/work`, `/jobs/c-job1`, `/invoices`, `/schedule`, `/clients`, `/settings`, `/analytics`, `/notes`, `/crew`
  * desktop Day: the same routes
  * store them under `tests/e2e/cleanup-guard.spec.ts-snapshots/`
* [ ] **Step 2: Write the script.** It lists class selectors in those three files whose class name appears nowhere in `src/**/*.{ts,tsx}`. It skips any class whose prefix up to the last `-` or `__` appears in a template string (Review Focus 1).
* [ ] **Step 3: Remove dead rules.** Remove only rule blocks where every selector is on that list, in batches of about 100 blocks. After each batch, run the screenshot guard with `FH_VISUAL=1`; if any screenshot changes, put that batch back and split it smaller.
* [ ] **Step 4: Trim the audit allowlist.** Drop from `scripts/audit-design-system.mjs` the legacy colors that no file still uses. List any still in use in `PROGRESS.md`.
* [ ] **Step 5:** Run `npm run test:all` and `npm run audit:design`. Commit.

### Task 7.3: Final screenshot record and morning summary

* [ ] Run every compare script, Phases 2 to 6, and copy the images into `docs/design/2026-10-redesign/final-review/`.
* [ ] Write the morning summary at the top of `PROGRESS.md` (see the run rules), push, and open the Phase 7 draft pull request.
