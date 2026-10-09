# Pipeline v2 — the leads / jobs / invoices redesign

*Shipped June 2026 on the `claude/fable5-audit-hardening-7oua1v` branch,
alongside the audit hardening pass. Database migration: `047_pipeline_v2.sql`
(applied to the live project).*

## Why

The original design stored everything on one record: a single `fh_contacts`
row was the lead, the quote, the job, and "the invoice," walked through a
six-stop stage column (`lead → quote → job → invoice → closed / lost`).
That shape caused the pain points reported in daily use:

- **Leads weren't their own thing** — they were not-yet-jobs cluttering the
  job board, with no follow-up workflow.
- **You couldn't send an invoice from a job** — "Invoice" was a *stage* the
  whole job moved into, not a thing you create. Progress billing existed
  (`fh_invoices` draws, migration 021) but was buried three taps deep in a
  job's Financials tab, and the Invoices screen ignored it entirely.
- **Too many steps / confusing flow** — every action was a stage ceremony,
  and there were two competing "mark complete" flows.

## The new model

| Concept | What it is now |
|---|---|
| **Lead** | `fh_contacts` row in stage `lead`/`quote` — but with its own screen (`/leads`), lifecycle (New → Quoting → Quote sent → Won/Lost), and `follow_up_on` date. `lost` is a dead lead. |
| **Job** | Stage `job` (active) or `closed` (done). Every job is a won deal. `completed_at` flags "work done, awaiting payment" — the only thing the old invoice stage actually meant. |
| **Invoice** | A first-class `fh_invoices` row. N per job — deposit, progress draws, final balance — each with its own status (`draft / sent / paid / overdue / void`), due date, PDF, and email send. |
| **Payment** | `fh_payments` row, optionally linked to the specific invoice it settles (`invoice_id`), which auto-marks that invoice paid. Paying off the contract still auto-closes the job. |

The **`invoice` stage is retired**. Existing rows were migrated to
`stage='job'` with `completed_at` backfilled. The code still tolerates the
legacy value everywhere (treated as an alias of `job`) for safety.

A deliberate choice: leads and jobs still share the `fh_contacts` table.
That's what makes **"Won" instant and lossless** — the quote, files, photos,
and notes ride along when a lead converts. The split is in the experience
(screens, lifecycle, nav), not the storage.

## What changed, surface by surface

- **`/leads` (new)** — Leads board: status pills, follow-up chips (overdue /
  today / upcoming) that float due leads to the top, swipe to call/text, and
  Quote / Won / Lost right on the card. Won converts to a job and opens it.
  Leads takes the bottom-nav slot; Clients moved to the More drawer.
- **Job screen** — primary CTA while money is owed is **Send invoice**
  (a new one-sheet flow: what for → amount prefilled from the unbilled
  remainder → due window → Send / Download / Save draft). Once paid up, the
  CTA becomes Mark complete (the closeout). "Mark complete" from the
  next-action card now stamps `completed_at` and prompts the final invoice
  instead of warping the job into a phantom stage.
- **Invoices screen** — now lists the real issued invoices (with per-invoice
  send / download / mark-paid / void) above the per-job aging view. The
  per-job "Email" shortcut mints a tracked invoice instead of firing an
  untracked PDF.
- **Jobs screen / kanban / desktop boards / Home / Analytics / Client
  detail** — leads no longer interleave with jobs; the Invoicing
  column/chips are gone; "won" metrics now count every job (a converted
  lead is a won deal), so close rate and Won YTD finally mean what they say.

## Library map (for future work)

- `src/lib/stages.ts` — stage sets (`LEAD_STAGES`, `JOB_STAGES`,
  `WON_STAGES`) + transitions. Single source of truth.
- `src/lib/invoices.ts` — create / PDF / send / settle for `fh_invoices`.
  Use this from any surface; don't re-implement the send pipeline.
- `src/components/SendInvoiceSheet.tsx` — the one-tap billing sheet.
- `src/screens/Leads.tsx` — the leads board.

## Known follow-ups (deliberately deferred)

1. **One-screen quote builder** — the quote flow still spans the Quote tab's
   builder/terms/actions. The lead → "Build quote" path now lands there
   directly, but consolidating items + terms + send into one screen (with
   rate-card autocomplete) is the next big UX win.
2. **InvoiceDrawsSection** (job Financials tab) still has its own copy of
   the PDF/send logic predating `lib/invoices.ts` — works fine, should be
   folded into the lib.
3. **Desktop Invoices board** (`SnowInvoicesBuild`) still shows only job
   balances, not the issued-invoice list the mobile screen gained.
4. **Expo mobile app** (`mobile/`) still assumes the six-stage model; it
   keeps working (legacy alias), but should adopt v2 before its next release.
5. Old stage-transition history rows referencing `invoice` render with
   legacy labels on the Activity feed — harmless, cosmetic.
