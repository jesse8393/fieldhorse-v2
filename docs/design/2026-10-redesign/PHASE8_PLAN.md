# Fieldhorse redesign: audit fixes (Phase 8)

Paste this whole file into one Claude Code session on `fieldhorse-v2`. Use Opus for this run. Nobody can answer questions while it runs, so follow the run rules exactly.

## Why this run exists

Pull requests #217 to #222 (Phases 2 to 7) were audited on October 10. All checks pass on #222: lint (0 errors), typecheck, 850 unit tests, the e2e suite, the build and the design audit. The redesigned screens match the renders closely. The audit still found real bugs that a paying company would hit: money amounts that ignore partial payments, a scheduling tray that can write into another company's calendar, Inbox paths that can send a text late or twice, a customer page that states a deposit the terms do not, and Today counts that stop at 6. This run fixes them, plus the design polish that keeps the work from reading as top grade.

Grades from the audit, for context: Phase 2 B minus, Phase 3 C plus, Phase 4 B, Phase 5 B, Phase 6 B minus, Phase 7 A minus.

## Run rules

### Setup

1. Read `docs/design/2026-10-redesign/SPEC.md` (section 17 holds decisions D1 to D30) and `PROGRESS.md`.
2. Branch `redesign/phase-8` from `redesign/phase-7`. Open one **draft** pull request titled "Redesign phase 8: audit fixes" against `redesign/phase-7`.
3. Save this file as `docs/design/2026-10-redesign/PHASE8_PLAN.md`. Add a "Phase 8" section to `PROGRESS.md` with one line per task (status todo, done, blocked, skipped; commit hash; one line of notes). Commit both before writing code.
4. **Baseline.** Run `npm run test:all` once. List anything already failing under "Failing before Phase 8". The gate from then on is no new failures.
5. Record new decisions in SPEC.md section 17 starting at **D31**. Never reuse a number.
6. If your context gets compacted or a new session picks this up, read `PROGRESS.md` first and continue from the first task that is not done.

### How to work

* Use superpowers:subagent-driven-development if available: a fresh subagent per task and a fresh reviewer after each task. Otherwise work task by task and review your own diff before each commit.
* Test first. Every task below names the tests that must fail before the fix and pass after.
* Commit after every task with a plain sentence case message. Update `PROGRESS.md` in the same commit.
* Unit tests that depend on the hour, day, week or month set `process.env.TZ = 'America/Chicago'` and restore it. E2e tests that depend on the time of day pin it with `page.clock.setFixedTime`.

### Never do these

* Never merge any pull request. Never push to `main`. Never deploy. Never touch Netlify settings, environment variables or secrets.
* Never write a database migration. Never run SQL or RPCs against the live Supabase project (`pnmhblvslftdzfcdezbw`). All tests use `scripts/qa-mock.mjs`.
* Never change files in `supabase/`. Never change files in `netlify/functions/` except the one change in Task 18, and only if its approval line says yes.
* Never send an email, text or message, and never call `/api/send-*`, `/api/docusign-send` or `fh_send_message` outside mocked tests.
* Never delete or weaken an existing test to make a build pass. Never use `--no-verify`. Never add a dependency.

### When something goes wrong

* After a careful debugging pass (superpowers:systematic-debugging) and three fix attempts, undo that task with `git restore` or `git revert` of its own commits, mark it `blocked` with the error and what you tried, and continue with the next task that does not depend on it. Never use `git reset --hard` past another task's work, `git clean -x` or a force push.
* If the plan and the code disagree (a file moved, a name changed), follow the intent, note the difference in `PROGRESS.md`, and keep going.
* If a decision is not covered, pick the option that changes the least, record it as a new D number, and keep going.

### Priority if time runs short

Tier 1 first, in order. Then Tier 2. Then Tier 3. A finished Tier 1 is worth more than anything else in this file.

### Finish

At the end: run `npm run test:all` and `npm run audit:design`, rerun every compare script and look at every image, push, update the draft pull request with before and after images for every visual task, and write a "Phase 8 summary" at the top of `PROGRESS.md` for the owner in plain words with no dashes: what changed, what is blocked, new decisions, and an iPhone checklist.

---

## Tier 1: correctness, money, sending and company boundaries

### Task 1: Make the test mock honest

The mock ignores PostgREST filters, which hid two production bugs (Today capped at 6, and Money totals that counted leads and quotes in screenshots).

**Files:** `scripts/qa-mock.mjs`.

* Honor these query parameters on REST reads: `eq`, `neq`, `in`, `gt`, `gte`, `lt`, `lte`, `is`, `limit`, `offset`, `order`. Unknown operators keep today's behavior.
* Validate `QA_NOW`: a value that does not parse throws a clear error naming the variable.
* Any existing test that now fails because its data never matched its own filter gets its data fixed, never its assertion weakened. List each one in `PROGRESS.md`.
* Tests: a small unit or e2e check that `?stage=in.(job,invoice)` and `?limit=2` are honored.

### Task 2: Today counts stop at 6

**Files:** `src/lib/homeDashboard.ts` (the `.limit(6)` on today and tomorrow visits, and `nextActions: actions.slice(0, 6)`), `src/lib/todayView.ts`, `src/screens/today/*`, desktop Today.

* Raise the visit limit to 50. Add `nextActionsTotal: actions.length` to the bundle and keep a slice of 20 for See all.
* The headline, next stop, "Today, done N of M", the Needs an answer count and the evening "N things before tomorrow" read the full counts.
* Tests: `todayView.test.ts` with 8 visits gives "Eight stops." and the 7th visit can be the next stop; with 14 actions the count reads 14. An e2e with 8 seeded visits checks the headline (works once Task 1 lands).

### Task 3: Capture from a job page shows up on the job

**Files:** `src/components/CaptureSheet.tsx` (`save`), `src/lib/captureOutbox.ts`, `src/lib/captureActions.ts`.

* After `commitCapture` succeeds, invalidate `['jobDetail', jobId]`, the jobs list keys and the home dashboard keys.
* An offline capture made with a job attached keeps `job_id` on the outbox item and inserts it as `contact_id` when the outbox flushes.
* Tests: e2e opens Capture from the job page capsule, saves a note, and the Spine shows it without leaving the page. Unit test: an outbox item with `job_id` flushes with that `contact_id`.

### Task 4: Morning cold open says "Clear day"

**Files:** `src/lib/todayView.ts`, `src/screens/Home.tsx`, `src/lib/weather.ts` usage.

* Merge `todayOnSite` and `tomorrowOnSite` and place each visit by its own local start day, so a bundle cached at 9 pm still shows this morning's visits correctly after midnight.
* Load the weather through `useQuery` (stale after 30 minutes, refetch on focus). Hide the weather line when the snapshot is more than 90 minutes old.
* Tests: unit test with a bundle fetched at 21:00 and `now` at 06:30 next day shows the right visits. Unit test that a 3 hour old weather snapshot yields no weather line.

### Task 5: What each invoice actually owes

**Files:** `src/lib/invoiceSettlement.ts`, `src/lib/invoices.ts` (`invoiceAmountDue`, `sendInvoiceEmail` amount), `src/lib/moneyView.ts`, `src/screens/Invoices.tsx` (Mark paid prefill), `src/lib/queries.ts` (invoices bundle).

* One allocator in `invoiceSettlement.ts`: subtract payments linked by `invoice_id` from their own invoice, apply unlinked payments to open invoices oldest due first, and cap the running total of open amounts at the job balance. Use it everywhere an invoice's amount due appears: Money rows, group totals, Due this week, the Remind sheet, the reminder email, the PDF hero if it reads the same function, and the Mark paid prefill.
* The totals must not come from the display list capped at 500. Load open (sent, viewed, overdue) invoices uncapped with `fetchAllRows` for the totals, and keep the cap only for display.
* Remove the unused `invoiceRows.effStatus` in `Invoices.tsx`. Make Today's overdue rule use the same classify function as Money, so both screens agree on when an invoice is overdue and for how much.
* Tests, with numbers: job $10,000; invoice 1 $5,000 overdue with a linked $2,000 payment; invoice 2 $5,000 due Friday. Overdue row shows $3,000.00, Due this week $8,000.00, Mark paid prefill $3,000. An unlinked $4,000 payment with two $5,000 invoices leaves $1,000.00 and $5,000.00. 620 invoices with an old open one still count it.

### Task 6: Money timing and double sends

**Files:** `src/screens/money/MoneyPhone.tsx`, `src/components/desktop/SnowInvoicesBuild.tsx`, `src/screens/Invoices.tsx`, `src/lib/moneyView.ts`.

* Add a `useNow` hook (ticks every minute and on `visibilitychange`; reuse the Schedule one if it exists) and include it in the Money memo inputs, so "Collected this week", "Due today" and the month label roll over when the app stays open.
* Replace the single shared sending flag with a set of invoice ids in flight. A second reminder for another invoice cannot re-enable the first one's button, and a second tap on the same invoice does nothing.
* Desktop Money: put the aging summary and the link strip under the same loading guard as the rest, with skeletons. Never show $0 totals while loading.
* Tests: unit test that `buildMoneyView` with `now` on Sunday 8 am gives $0.00 collected this week for last week's payments. E2e: remind A then B quickly sends exactly one request each.

### Task 7: Jobs and quotes stay inside the active company

`useJobs` returns every company the user belongs to plus jobs shared by partners. Money "Waiting on approval" and the desktop Unscheduled tray use it directly.

**Files:** `src/lib/queries.ts` (`JOB_LIST_COLUMNS`, `fetchJobs`), `src/lib/moneyView.ts`, `src/screens/money/MoneyPhone.tsx`, `src/components/desktop/SnowInvoicesBuild.tsx`, `src/components/desktop/SnowScheduleBuild.tsx`, `src/lib/scheduleBoard.ts`.

* Add `org_id` to `JOB_LIST_COLUMNS`. Add a helper `inActiveCompany(job, membership)` (match `org_id` to the active org, or `user_id` when there is no org).
* Money "Waiting on approval" and the Unscheduled tray use only jobs in the active company. Search the codebase for other places that act on `useJobs` rows (creating records, scheduling, money) and apply the same filter; list them in `PROGRESS.md`. Lists that intentionally show partner shared jobs keep doing so.
* A drop onto the board refuses a job from another company with a toast, and never inserts.
* Tests: unit test for the helper; e2e with a seeded partner job from another org that it does not appear in the tray or in Waiting on approval.

### Task 8: The Unscheduled tray tells the truth

**Files:** `src/components/desktop/SnowScheduleBuild.tsx`, `src/components/desktop/schedule/Rail.tsx` (or wherever the tray renders), `src/lib/queries.ts`.

* Replace the 400 day `select('*, fh_contacts(...)')` booked query with a dedicated query that selects only `contact_id` for visits from today on, paged with `fetchAllRows`.
* Show a skeleton until both the jobs and the booked query settle, and an error line if either fails. Never list every job as unscheduled while loading.
* While a drop is saving, disable that card's drag (`useDraggable({ disabled })`), dim it, and add it to the booked cache optimistically. On failure, roll back and toast.
* In Month view, disable dragging and change the hint to "Switch to Week to drag a job onto a day."
* Cap the tray at 50 cards with "Show all N".
* Tests: e2e that a slow insert followed by a second drag creates one visit; the tray shows a skeleton while loading.

### Task 9: One quote total and one deposit everywhere

The in app capsule, the Fieldhorse preview and the customer page can show three different deposits for the same quote.

**Files:** create `src/lib/quoteMoney.ts`; use it from `src/lib/quoteView.ts`, `src/lib/portalView.ts`, `src/components/documents/ProposalTemplate.tsx`, `src/components/documents/proposalThemes.tsx`, `src/screens/ContactDetail/phone/QuotePhone.tsx`.

* `quoteMoney({ items, changeOrders, contactAmount, termsText })` returns `{ total, deposit: { kind: 'percent' | 'amount' | 'none' | 'per_terms', pct, amount }, steps }`. Total is the base lines plus approved change orders, falling back to `contact.amount` when no line has a price.
* Deposit rules: "no deposit" or "0%" gives none; "$2,500 deposit" gives that amount; "30% deposit" or "deposit of 30%" gives 30 percent; terms that exist but name no deposit give `per_terms`; empty terms give the default schedule's first step. "50% down at rough in" is not a deposit.
* The customer page sentence and the three steps are built from this result. When there is no deposit, say so plainly. When it is `per_terms`, say "Payment follows the terms below." Remove the fixed "balance is due after the walkthrough" wording unless the schedule says it.
* Record this as D31 (it supersedes the 50 percent rule in D8 and D23 for the customer page).
* Tests: unit tests for every rule above with a $10,000 quote, and one asserting the capsule, the preview and the portal view agree for the same input.

### Task 10: The customer page after approval and on bad data

**Files:** `src/components/documents/proposalThemes.tsx` (`ApprovedCapsule`, `FieldhorseProposal`), `src/screens/PublicDoc.tsx`, `src/lib/portalView.ts`, `src/components/public/ApproveProposalBar.tsx`.

* Hide "Pay deposit" (show "Deposit received" instead) once payments of kind deposit, or the sum of payments, reach the deposit amount.
* Show the quote number, the issue date and "Valid until". When `quote_expires_at` has passed, replace the approve area with "This quote has expired. Ask {company} for an updated one." and the call link.
* Before posting an approval, refetch `/api/public-link`. If the total changed, stop and show "This quote was just updated. Please review the new total." and render the new data. The refetch also records a view; that is fine.
* Pass `onAsk` only while the quote is open, so "Ask about this" never shows as a dead button.
* First names: reuse `previewAsName` from `quoteView.ts`, skip leading articles ("The Roof Doctor" becomes "Roof Doctor"), handle "Last, First", and fall back to "Hi there" for company names.
* The signature field starts empty with `autoCapitalize="words"`. Only the Approve button submits; Return in the field does not.
* A failed refetch keeps the previous data instead of replacing the success state with an error.
* Put a scrim (`--fh-scrim`, or the onyx veil used in `auth.css`) under the header text on the cover photo. Use the newest photo as the cover.
* Tests: e2e for already paid deposit, expired quote, total changed before approve, changes requested state, 409 and 410 errors, and a bright cover photo (a real image, not a 1 px PNG) with the header text contrast checked at 4.5 to 1 or better.

### Task 11: Inbox sends exactly once, only when tapped, only when online

**Files:** `src/lib/inbox.ts`, `src/screens/inbox/Thread.tsx`, `src/screens/inbox/Inbox.tsx`, `src/main.tsx` (query persistence).

* Set `networkMode: 'always'` on all four Inbox mutations. Before sending, check `onlineManager.isOnline()`; offline shows "No signal. Nothing was sent." and keeps the text. Inbox mutations are never persisted or resumed.
* Dictation: each recognizer handler checks `recRef.current === rec` and ignores stale events. On send, detach the handlers and call `abort()` before awaiting. Disable the mic while sending.
* Errors: refresh the thread in `onSettled`, not only on success. The error toast reads "We couldn't confirm this went out. Check the thread before sending again." Send stays disabled until the refetch finishes.
* `draftText`: accept only the known body keys. With no match, show no draft panel, as D26 promises.
* `messageState`: show sent only for `sent`, `delivered`, `read` or when `sent_at` is set. Anything else reads "Not sent yet".
* Do not save queries under the `inbox` key to the persisted cache. Return a `runsFresh` flag from `useThread` and keep the draft's Send disabled until the runs were fetched after mount.
* The draft panel says how it will go out ("Sends by text to {name}" or "Sends by email: {subject}"). Drafts older than the newest customer message are collapsed under "Older draft" with Send hidden until expanded.
* Key the phone Thread by conversation id, like desktop, so typed text never carries to another customer.
* Scope thread queries by `org_id` and include it in the query keys. If the open conversation is not in the active company, show "Not in this company" with no actions.
* Email replies use the latest subject (`messages.find((m) => m.subject)`).
* Accessibility: hidden "You said" and "{name} said" text in bubbles, focus back to the reply field after send, approve and discard, the draft button named "Send draft reply", one fixed mic label with `aria-pressed`.
* Tests: e2e with the context set offline that tapping Send makes no RPC then or after going back online; dictation result after send does not refill the composer; unknown proposal keys show no draft; an unknown status shows "Not sent yet"; switching from thread A to B on a phone clears the composer.

---

## Tier 2: design polish that makes it read as top grade

### Task 12: Next stop card without a photo, and job tabs

This was planned as Task 3.0 in the overnight run but the session used an earlier copy of the plan.

**Files:** `src/components/fh/PhotoCard.tsx` and its CSS, `src/screens/today/TodayPhone.tsx`, desktop Today, `src/screens/ContactDetail/phone/JobHeaderPhone.tsx` (section tabs), `job-phone.css`.

* With no photo, the next stop card is a compact onyx band about 96 px tall: eyebrow and job name on the left, Navigate on the right, same hairline and radius. No empty image area. Today currently shows a 202 px empty dark box on phone and desktop, and most jobs have no photos yet. Record as D32 and update the `PhotoCard` line in SPEC section 7.
* Job tabs: when the row overflows, fade the right 32 px, remove the fade once scrolled to the end, and scroll the active tab into view on load.
* Tests: the Next stop region is at most 120 px tall with no photo and has no `img`; the tab row has the fade class when it overflows and loses it at the end.

### Task 13: Desktop Capture button

A floating gold microphone sits 24 px from the bottom right on every desktop page. It covers content (the Needs an answer buttons, the Money count, the Job facts panel, the Schedule rail) and adds a second gold element to pages meant to have one.

* On 900 px and wider, remove the floating button. Put a quiet "Capture" item with its key cap (Cmd or Ctrl J) at the top of the sidebar under Search, and keep the palette action. Record as D33.
* Tests: on desktop no `.fh-fab--capture` is visible, the sidebar item opens Capture, and Cmd J still works.

### Task 14: Desktop between 900 and 1279 px

* Sidebar company name: use `headerName` (the short name the phone uses), clamp to two lines, and add a `title` with the full name. "Harlow Construction Company" currently shows as "Harlow Constructi...".
* Job page below 1280 px: show a compact facts strip (balance, customer phone, address with Navigate) above the composer so it is not pushed below the whole Spine.
* Money tables: give the Action column a fixed 96 px and hide the Job column below 1100 px.
* Add e2e runs at 1024 by 768 for Today, Job, Schedule and Money that check nothing overflows horizontally and the primary action is visible without scrolling.

### Task 15: Small behavior fixes

* Reopen on a closed or lost job asks to confirm, like Mark lost, or shows an undo toast for 6 seconds.
* Hide "New lead" on the phone Jobs screen for crew and other field roles.
* The All tab count matches the All list (count only recent Done, the same 30 days the list shows).
* The job header Navigate uses the shared `navigateHref` (Google Maps off Apple devices).
* Spine notes show the full text of every note, with "Show N more" reflecting the real total.
* Spine thumbnails hide on load error, and signed URL freshness uses when the URL was signed.
* Jobs visit query selects only `contact_id,start_at`, looks back 14 days, newest first.
* Job banner weather shows nothing (or "Set location" for owners) when the company has no coordinates, instead of falling back to Murfreesboro.
* Palette shortcuts on a Mac need Control plus Option, so Option still types accents (ñ, µ). Key caps print the right modifier. Update D19.
* "Copy a share link" and "Open the PDF" are disabled on a quote with no lines, with "Add at least one line".
* The Quote tab finds the customer email the same way Money does (contact, then the linked client).
* The optional item switch and Send for approval are disabled while a switch save is in flight.
* Reset password status message stays mounted so screen readers announce it (copy the Login pattern).
* Tests for each, small and direct.

### Task 16: Login wordmark

The wordmark is spread across the width with flex, which reads as generic. Match the render: Bebas Neue, tight tracking, FIELD in brushed gold and HORSE in linen at one size, with the gold hairline under it. If the design audit blocks the size, add a single documented exception for the wordmark only.

---

## Tier 3: cleanup

### Task 17: CSS and test hygiene

* Remove the 16 empty `@media` and `@container` blocks, the unused `@keyframes` (fh-aurora-drift, fh-aurora-drift-alt, fh-grid-drift, fh-spotlight-breathe, fh-shimmer-sweep, fh-scan-line, fh-hero-drift, fhSkelShimmer, fh-moving-border, fh-shimmer, fh-voice-pulse) after confirming no references, dead selectors left in mixed selector lists (for example `.fh-fx-aurora__a`, `.v3-card--interactive`, `.fh-asheet--v2`, `.fh-command-dialog` in `mobile-keyboard-fix.css`), and comments that describe removed rules. Fix the stacked indentation the remover left.
* `scripts/find-dead-css.mjs`: collect protected prefixes only from className, class, cx, clsx or classList contexts; scan `netlify/` and html files too; treat `${x}--` and `${x}__` patterns as unknown, not dead.
* Widen `tests/e2e/cleanup-guard.spec.ts`: add `/login`, the customer page, `/invoices/:id`, `/inbox`, `/pour-window`, the palette open and one open sheet, desktop Night, and 1440 px.
* Replace the two `login.spec.ts` assertions that check for deleted effect markup with assertions on the onyx shell.
* Run the guard with `FH_VISUAL=1` before and after this task.

### Task 18: Private line notes on the customer page (server, needs approval)

**Server fix approved: no**

Only do this task if the line above reads `yes`. Otherwise mark it skipped.

`netlify/functions/public-link.js` reads `fh_quote_items` and `fh_insurance_claims` with `select('*')` and returns the rows to anyone with the link. That includes each line's `notes`, which migration 011 calls private operator notes, plus `user_id` and `org_id`. The page never draws them, but they are visible in the browser's network tab.

* Project explicit public columns for quote items (`id, description, qty, unit, rate, amount, section, sort_order, is_optional, is_excluded`) and for insurance claims (only what the page renders), the same way `PUBLIC_PAYMENT_COLUMNS` already does. Change nothing else in that file.
* Test: Vitest only runs files under `src`, so add `src/lib/publicLinkColumns.test.ts` that reads `netlify/functions/public-link.js` as text and asserts the quote items and insurance claims reads use explicit column lists, never `select('*')`, and that the item list has no `notes`, `user_id` or `org_id`.

---

## Not in this run (for the owner)

* The Settings choice for the Fieldhorse customer page needs the database check widened (SQL in #220, decision D22). Then set `FIELDHORSE_TEMPLATE_SAVES` to true.
* Server ideas that need a migration or function change: an `expected_total` check on approval, and a `p_dedupe_key` on `fh_send_message`.
* Screens the redesign never covered still use the old look: phone Schedule, Customers and customer detail, Settings, Reports, Crew and Timesheets, Notes, Tasks. They need designs before anyone builds them.
