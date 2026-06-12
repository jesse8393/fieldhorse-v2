# North Star — the "iPhone moment" plan

*Written June 2026, after a full-app audit (every screen + every backend
capability). First slice — Universal Capture — ships with this doc.*

## The thesis

A contractor's hands are dirty, their phone is in a truck mount, and the
thing they need to record is already leaving their head. Every competitor
ships the same answer: more screens. The iPhone moment for field software
is the opposite — **the app stops being a place you go and becomes a
thing you tell**. Fieldhorse already has the organs for this (AI bid
engine, vision OCR, voice notes, a clean org/data model); what was
missing is one front door.

## Shipped now: Universal Capture

One gold button, everywhere in the app (plus ⌘J and the command
palette). Speak, type, or snap a receipt. Claude routes the input into
the right action — **note / to-do / payment / expense / schedule event /
new lead** — matched to the right job by name, with relative dates
resolved ("Friday" → a real date). The operator confirms one editable
card; one tap writes it through the exact same code paths as manual
entry (`logPayment`, cost rollups, notifications, auto-close all fire).

Trust boundaries, by design:

- The model proposes; the operator confirms. Nothing writes without the
  confirm tap, and money rows demand an amount + job.
- `normalizeIntent()` re-validates everything the model returns —
  enum whitelists, amount sanity, date shapes, and job IDs checked
  against the live roster (a hallucinated job id is dropped). Unit-tested.
- Capture never loses words: AI down → "save as note" fallback; no
  signal → localStorage outbox that syncs as notes when back online.

## The roadmap (ranked by impact-per-effort)

1. **Today screen → assignment editor.** Home already ranks next
   actions; let the user *act* on them inline (call, mark done, send
   invoice) instead of navigating. The capture layer's confirm-card
   pattern is the UI primitive to reuse.
2. **Real offline.** Generalize the capture outbox into an IndexedDB
   write queue with idempotency keys for notes/todos/payments/photos
   (IMPROVEMENT_PLAN §10). The toast language is already honest
   ("will sync"); make every mutation behave that way.
3. **Push notifications.** `fh_notifications` is written everywhere and
   read only by the bell. Web-push + Expo push turns "proposal viewed,
   not approved for 2 days" into a nudge that closes deals.
4. **Job timeline.** Unified per-job activity feed (notes + messages +
   payments + schedule + stage moves — the data all exists) and mirror
   it into the client portal so homeowners stop calling for status.
5. **Integrations.** The OAuth vault (`fh_integrations`) is built and
   empty. QuickBooks invoice sync first (every contractor's accountant
   asks), Google Calendar two-way second.
6. **Labor → money.** GPS time punches with approval chains already
   exist; wire approved hours × rate cards into job cost and invoice
   line items. Nobody else in this price class has that loop closed.
7. **Capture v2.** Photo capture into the job gallery from the same
   sheet, multi-action inputs ("got the check AND schedule the final
   walkthrough"), and a refine loop ("make that Thursday").

## What we deliberately did NOT do

- No chat window. Chat is where AI features go to feel like work. The
  capture card is a *form filled out for you* — review it like a text
  message, not a conversation.
- No auto-commit, even at high confidence. A wrong $ amount silently
  filed costs more trust than every saved tap combined. Revisit only
  with per-kind undo + a long track record.
- No new tables. The whole feature writes to the schema the app already
  trusts — which is why it works with every report, rollup, and screen
  on day one.
