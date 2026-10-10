# Phase 3 Implementation Plan: Money and the quote editor

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use `* [ ]` checkboxes.

**Goal:** Money and the quote editor on a phone match `glamor/g-money.jpg` and `glamor/g-quote.jpg`.

**Architecture:** Pure view models in `src/lib/moneyView.ts` and `src/lib/quoteView.ts`, phone layouts from `src/components/fh/`, existing queries and actions underneath. Desktop branches stay as they are until Phase 4.

**Spec:** SPEC.md sections 9.6, 9.7, decisions D6 and D8. Global Constraints from the Phase 2 plan apply to every phase.

## Review Focus

1. **No invoices yet.** A new company with no invoices sees a calm vault card at $0.00 and an empty state "No open invoices" with "Create an invoice". Pinned in Task 3.2.
2. **Customer without an email.** "Remind" is disabled with the helper text "Add an email to send reminders." Pinned in Task 3.2.
3. **Field roles never reach Money.** `/invoices` stays gated by `canSeeFinancials`. Pinned in Task 3.2.
4. **Quote with only optional items.** Base total $0.00, deposit $0.00, the send button disabled with "Add at least one line". Pinned in Task 3.3.
5. **Preview never sends.** "Preview as" never calls `mintPublicLink` or any `/api/send-*`. Pinned in Task 3.4.

### Task 3.1: Money view model

**Files:** Create `src/lib/moneyView.ts`, `src/lib/moneyView.test.ts`

**Interfaces:**
* Consumes: `InvoicesBundle` from `src/lib/queries.ts`, `JobRow` from `useJobs()`, `invoiceAmountDue` from `src/lib/invoices.ts`, `avgMargin` from `src/lib/rollups.ts`.
* Produces:
  * `type MoneyRow = { id: string; title: string; subline: string; amount: number; note: string; chip: { label: string; tone: 'success' | 'info' | 'danger' | 'neutral' } | null; to: string; invoiceId: string | null; canRemind: boolean }`
  * `type MoneyView = { collectedThisWeek: number; dueThisWeek: number; monthToDate: number; marginPct: number | null; overdue: MoneyRow[]; dueSoon: MoneyRow[]; waiting: MoneyRow[]; paid: MoneyRow[] }`
  * `buildMoneyView(input: { bundle: InvoicesBundle; quotes: JobRow[]; now: Date }): MoneyView`

**Rules:**
* The week starts Sunday 00:00 local, matching the desktop schedule.
* `collectedThisWeek`: payments with `paid_on` this week.
* `monthToDate`: payments this calendar month.
* `dueThisWeek`: sum of `invoiceAmountDue` for sent invoices due by Saturday 23:59.
* `overdue`: sent invoices whose due day has ended. Chip "N days overdue", tone danger.
* `dueSoon`: sent invoices due within the next 7 days and not overdue. Note "Due today" or "Due Oct 15".
* `waiting`: contacts in stage quote with `proposal_status === 'sent'`. Note "Sent yesterday" or "Sent 4 days ago".
* `paid`: payments in the last 10 days. Chip "Paid Sep 30", tone success.
* `canRemind`: the invoice's contact has an email.

* [ ] **Step 1: Write the failing tests:**
  * with a fixed `now` of Thursday Oct 8 2026 noon, a payment on Sunday Oct 4 counts toward the week and one on Saturday Oct 3 does not
  * an invoice due yesterday is overdue with the chip "1 day overdue"; one due in 3 days is in `dueSoon`; one due in 9 days is in neither
  * void and paid invoices never appear in `overdue` or `dueSoon`
  * a quote sent 1 day ago has the note "Sent yesterday"
  * an empty bundle gives zeros and empty lists
  * a contact without an email gives `canRemind: false`
  * generated notes and chips contain no hyphen, en dash or em dash
* [ ] **Step 2:** Run `npx vitest run src/lib/moneyView.test.ts`. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 3.2: Money screen on a phone

**Files:** Create `src/screens/money/MoneyPhone.tsx`, `src/screens/money/RemindSheet.tsx`, `src/screens/money/money.css`. Modify `src/screens/Invoices.tsx` (render `MoneyPhone` below 900 px). Test `tests/e2e/money.spec.ts`.

**Layout:**
1. Title "Money" and a "Reports" link to `/analytics`.
2. `VaultCard`: label "Collected this week", the amount, then facts Due this week, the month name plus "so far", Margin. Monogram in the corner.
3. Groups as hairline `Row`s: Overdue (each with a mini "Remind" button), Due soon, Waiting on approval, Paid.
4. Tapping a row with an invoice opens a `Sheet` holding the existing invoice actions: Resend, PDF, Mark paid, Void.
5. "Statements" link at the bottom opens the existing "Who owes you" list.

`RemindSheet` shows the customer's email, the invoice and the amount, and a brushed gold "Send reminder" that calls the existing `sendInvoiceEmail`. When `canRemind` is false, the button is disabled and the helper reads "Add an email to send reminders."

* [ ] **Step 1: Write the failing e2e tests** (mobile project, `signIn` helper, `tables` overrides; mock `/api/send-invoice` with `context.route` and assert it is never called unless the button is tapped):
  * `money vault and groups`: "Collected this week" visible; group titles appear only for groups with rows.
  * `remind needs an email`: with an invoice whose contact has no email, the "Send reminder" button is disabled and the helper text is visible.
  * `remind sends only on tap`: opening the sheet makes no request to `/api/send-invoice`; tapping "Send reminder" makes exactly one. `sendInvoiceEmail` uploads the PDF to storage first and the mock answers every `/storage/` request with 404, so in this test route `**/storage/v1/object/**` to a 200 with `{"Key":"job-files/test.pdf"}`.
  * `crew cannot open money`: with `role: 'crew'`, `/invoices` redirects away.
  * `empty money`: with no invoices, "No open invoices" and "Create an invoice" are visible.
* [ ] **Step 2:** Run `npx playwright test tests/e2e/money.spec.ts --project=mobile-chrome`. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 3.3: Quote view model

**Files:** Create `src/lib/quoteView.ts`, `src/lib/quoteView.test.ts`

**Interfaces:**
* Consumes: quote item rows (`fh_quote_items`: `id, section, description, qty, unit, rate, amount, is_optional, is_excluded, sort_order`), `DEFAULT_PAYMENT_SCHEDULE` from `src/components/documents/PaymentTermsBlock.tsx`, `splitByPercents` from `src/lib/paymentSchedule.ts`.
* Produces:
  * `type QuoteLineView = { id: string; title: string; detail: string; amount: number }`
  * `buildQuoteView(items: QuoteItemRow[]): { lines: QuoteLineView[]; optional: QuoteLineView[]; excluded: QuoteLineView[]; baseTotal: number; deposit: { pct: number; amount: number }; canSend: boolean }`
  * `detail` reads like "1,100 sq ft at $2.00": the quantity with thousands separators, the unit, "at", then the rate with cents. When qty is 1 and there is no unit, it is just the rate.

* [ ] **Step 1: Write the failing tests:**
  * three base items and one optional: `baseTotal` sums only the base, `optional` has one line
  * deposit is 50 percent of the base, rounded to cents
  * only optional items: `baseTotal` 0, `canSend` false
  * detail formatting matches the examples above
  * lines sort by `sort_order`
* [ ] **Step 2:** Run `npx vitest run src/lib/quoteView.test.ts`. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 3.4: Quote editor on a phone

**Files:** Create `src/screens/ContactDetail/phone/QuotePhone.tsx`, `src/screens/ContactDetail/phone/QuotePreviewSheet.tsx`. Modify `src/screens/ContactDetail/tabs/Quote.tsx` (render `QuotePhone` below 900 px; keep the builder and document toggle on desktop), `src/screens/ContactDetail/phone/JobActionCapsule.tsx`. Test `tests/e2e/quote.spec.ts`.

**Interfaces:**
* `JobActionCapsule` gains `variant: 'actions' | 'total'`. On the Quote tab it shows "Total", the base total in linen, "Deposit $X at approval", and the brushed gold "Send for approval".

**Layout:**
* Status chip (Draft, Sent, Approved, Changes requested), client and address.
* Line items as rows using the existing inline edit from `src/screens/ContactDetail/sections/QuoteItems.tsx` (tap a row to edit in a `Sheet`), then "Add a line".
* Optional items in a paper panel, each with the shadcn `Switch` from `src/components/ui/switch.tsx`. It flips the item's `is_optional` in local state right away, then saves through the existing `updateItem` in `sections/QuoteItems.tsx` (`patchDraft` only edits the form, it does not save).
* A "Preview as {first name}" quiet link in the header opens `QuotePreviewSheet`. It renders `ProposalTemplate` with the current data, the way the private `DocumentPreviewPane` inside `tabs/Quote.tsx` does (move that function out and export it if that is the cleanest path), and never mints a link.

**Send for approval:**
* When the contact has an email, it runs the existing `handleSend`.
* Without an email, it runs the existing `handleShare`, which mints a link and copies it. On iOS standalone, use `navigator.share` when available instead of the clipboard.
* It is disabled when `canSend` is false, with "Add at least one line".

* [ ] **Step 1: Write the failing e2e tests:**
  * `quote total and deposit`: on the mock quote contact's Quote tab, the capsule shows the total and "Deposit".
  * `preview never sends`: opening "Preview as" makes no request to `/api/send-quote` and no insert into `fh_public_links`. Assert with `context.route` spies.
  * `optional switch`: with `tables.fh_quote_items` seeded with two base items and one optional item for the quote contact, toggling the switch changes the total shown right away. The mock does not store writes, so assert the optimistic total, not the value after a refetch.
  * `empty quote`: with no items, "Send for approval" is disabled and "Add at least one line" is visible.
* [ ] **Step 2:** Run. Expected: FAIL.
* [ ] **Step 3:** Implement.
* [ ] **Step 4:** Run. Expected: PASS.
* [ ] **Step 5:** Commit.

### Task 3.5: Phase 3 side by side review

* [ ] **Step 1:** Extend `scripts/compare-renders.mjs` with `/invoices` next to `glamor/g-money.jpg` and the Quote tab next to `glamor/g-quote.jpg`, in Day and Night.
* [ ] **Step 2:** Run it, review, fix, run again.
* [ ] **Step 3:** `npm run test:all` and `npm run audit:design`. Commit, push, and open the draft pull request.
