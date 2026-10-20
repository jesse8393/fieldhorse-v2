## Phase 9 summary

Hi Jesse. Phase 9 split your work into four separate records, a lead, a quote, a job and an invoice, each hanging off a client, and took every pop up out of the app. All seventeen tasks in the plan are done. The full check passed on the final commit: lint with no errors (the same 46 warnings as before), typecheck, all 1254 unit tests, 937 end to end tests passed on both projects with 429 skipped by device and none failing, no retries, the design audit, no dead CSS, the build, and the screenshot guard (108 shots on both projects, with fresh baselines because every signed in screen gained the New button and the new screens had none). The screenshots are in `docs/design/2026-10-redesign/phase9-review/`.

### What changed

Creating records. One New button (the plus in the phone header, the New row in the desktop sidebar, or Cmd N) opens a New screen with five rows: Lead, Quote, Job, Invoice and Client. Each row goes straight to that record's create screen, one tap saves, and you land on the record you made. A lead needs only a name, a quote only a client, a job a client and a title, an invoice a client and an amount; everything else can be filled later. Typing a name that matches nobody makes the client on the spot. Nothing asks who this is for first, and picking Quote, Job or Invoice never shows lead fields.

Leads. Leads live in their own table and have their own list at Leads (also a tab on the Jobs screen). A lead screen shows the name and phone with Call and Message, the address with Navigate, what they need, notes that save when you leave the field, and two buttons: Schedule estimate books an Estimate visit with the address filled, and Quote this starts a quote with the client, title and notes carried over and marks the lead quoted. Mark lost asks with a second tap. Notes from the old row show under Earlier notes.

Quotes. Quotes live in their own table with their own list at Quotes. The quote screen shows the lines (tap one to edit it in place, a plus row adds one), the total and deposit sentence, Scope and terms, the status, Preview, Send, Share link and Make this a job, which makes a new job with the quote's client, title, scope, amount and terms and lands on it. The customer link, send, approve and DocuSign all read the quote record. An approved quote stays a quote; the job it becomes is a new record.

Jobs. Jobs stay where they were, and the Jobs screen is now at /jobs (old /work links land there). A job's Payment, Event, Partner, Complete, Follow up and More are screens of their own, Delete and Reopen confirm with a second tap, the Quote tab is gone, and the gold button reads Invoice this while money is owed, which starts an invoice with the client and the balance filled.

Invoices and Money. An invoice is a record of its own: /invoices/:id is the invoice, with Collect payment, Resend, Remind, PDF, Share link, Edit and Void. An invoice with no job bills the client directly. Each invoice has a Description field that prints in the PDF Description column and in the email, prefilled with the job title when there is a job and blank otherwise. Money lists invoices and its rows are links; a job's own money lives on the job's Financials tab.

Notifications and reminders. The bell opens the Notifications screen instead of a pop up. Each row opens its record, and a reminder has Done and Dismiss, which close it. The reminder engine now keys on the client, one open reminder per client and kind, skips lost leads, quotes and jobs, and reads the new lead and quote tables with links that open the right screen.

No more pop ups. Every sheet, drawer, dialog and confirm box is gone. Capture is the screen /capture, the workspace menu is /workspace, phone search is /search, statements, merging, miles, subs, invites and the sub profile are screens, the Jobs filter and sort are chips, and every are you sure is a second tap on the same button. The one exception is the desktop command palette, a keyboard tool. A test taps every button on every route and checks nothing pops up.

### What the migration did to your data

Before the move your contacts held 64 leads, 25 quotes and 13 lost rows. After it: 62 closed jobs, 31 open jobs, 70 rows marked moved_lead and 32 marked moved_quote. The leads table holds 64 open leads and 6 lost. The quotes table holds 14 drafts, 10 sent, 1 with changes requested and 7 lost. 70 quote lines carry their quote id. 66 of 66 invoices carry their client. Reminders: 36 stale reminders on moved rows were closed, and about 68 fresh ones (59 leads, 9 quotes) will queue on the next daily run. Every migration was additive and reversible, and `scripts/move-counts.mjs` prints these counts read only whenever you want to check.

### Blocked, and calls for you

* The moved rows are kept, not deleted (D56). Once you have looked at the new Leads and Quotes screens and nothing is missing, say so and a later cleanup migration deletes the marked rows.
* The fieldhorse.io domain still points at the dead site. It needs your Namecheap DNS change and the Netlify domain setting; nothing here touches Netlify.
* The desktop Jobs list still carries the Work and deals title and chips from before; the phone list is the new Jobs screen. A rename is a small follow up.
* Opening /jobs with no stage shows the All tab; the old /jobs link used to open the Jobs tab. Tap Jobs on the tab strip if you want only jobs.

### New decisions in SPEC.md section 17

* D53: four records, one client; any of the four can be created at any time.
* D54: records link only by a tap (Quote this, Make this a job, Invoice this); nothing changes type on its own.
* D55: jobs keep the contacts table; leads and quotes get their own tables with their own statuses.
* D56: moved rows are marked moved_lead or moved_quote, not deleted, until you confirm nothing is missing.
* D57: no pop up sheets; every flow is a screen with Back, and destructive actions confirm with a second tap.
* D58: one New menu at /new with Lead, Quote, Job, Invoice and Client.
* D59: fewest taps; each create screen saves with one tap and needs only a name, a client, or a client plus a title or amount.
* D60: a lead has Schedule estimate and Quote this.
* D61: a quote has Make this a job and a job has Invoice this, whatever the status.
* D62: invoices stand alone with a client and a Description that prints on the PDF and in the email.
* D63: reminders are per client, one open per kind, none for lost records, closed by Done or Dismiss.
* D64: notifications are a screen; the bell goes there.
* D65: Jobs, Quotes, Leads and Money are lists of their own records; the dock keeps Today, Jobs, Capture, Money, Schedule.

### iPhone checklist

1. Tap the plus in the header. The New screen lists Lead, Quote, Job, Invoice and Client.
2. Tap Lead, type a new name, Save. You land on the lead with Schedule estimate and Quote this.
3. On that lead, tap Quote this. The quote opens with the client and title filled; add a line and watch the total.
4. On the quote, tap Make this a job. A job opens with the same title and amount.
5. On the job, tap Invoice this. The invoice form has the client and the balance filled; Save.
6. On the invoice, type a Description, leave the field, then tap PDF and check the Description column.
7. Tap Jobs in the dock, then the Leads and Quotes tabs. Nothing you had is missing.
8. Tap the bell. Mark one reminder Done; it leaves the list.
9. Tap the gold coin. Capture opens as a screen with Back, not a sheet.
10. On a lead, tap Mark lost once (it asks for a second tap), then Back without the second tap. Nothing changed.

# Redesign progress, overnight run (Phases 2 to 7)

Run rules and plans: `PHASE2_PLAN.md` to `PHASE7_PLAN.md` in this folder, decisions in `SPEC.md` section 17.

**If this run is picked up by a new session:** read this file first and continue from the first task that is not `done`.

## Phase 9, separate records and no pop ups

Plan: `PHASE9_PLAN.md`. Branch `redesign/phase-9` from `main` (`0c7d8e8`). Pull request #227 (draft) against `main`. Decisions D53 to D65.

### Failing before Phase 9

Nothing. Main at `0c7d8e8` is the Phase 8 head, which passed CI (check and the full e2e job) on October 14, so that run is the baseline.

### Phase 9 tasks

| Task | Status | Commit | Notes |
|---|---|---|---|
| 1 The invoice description reaches the PDF and the email | done | this commit | `invoiceDescription` in `src/lib/invoices.ts` feeds the PDF Description column, the per draw PDF, the invoice screen's Service block and the draws editor's new Description field, so the invoice's own words print instead of the job title. |
| 2 Notifications become a screen with Done and Dismiss | done | this commit | `/notifications` replaces the bell's drawer; Done and Dismiss call `fh_follow_up_set_status` (migration 090, written, not yet applied; the app's dismissed is stored as skipped because the status check allows queued, done, skipped and sent); the count words test moved from the drawer heading to the screen's count line |
| 3 Reminders stop for lost deals and run per client | done | this commit | Migration 091 applied on October 19 after a rolled back dry run passed all four checks. 17 queued duplicates closed, 45 remain, one per client and kind. The 27 unread reminders that stay belong to demo contacts with no client, which Task 6 gives one |
| 4 New tables for leads and quotes | done | this commit | Migration 092 applied on October 19 in eight pieces (the database tool times out on long statements). The rolled back check gave quote amount 1500 from two lines, lines inherit the quote's org, nine policies. The quote items inherit trigger was left as it is (it already fires on insert). Types added by hand; four invoice to job lookups now allow an invoice with no job |
| 5 Pure converters and the data layer | done | this commit | `src/lib/records.ts`, `src/lib/leads.ts`, `src/lib/quotes.ts` with 27 unit tests. `createLead` and `createQuote` throw on a database error and return the row, unlike `createInvoice`. `quoteToJobDraft` takes the client as a third argument since a quote row carries no client name |
| 6 The migration that moves leads and quotes | done | this commit | Migration 093 applied on October 20: recompute and triggers one piece at a time, then the move as one transaction (the database tool stalls on bodies with a create trigger, and on commits over about ten kilobytes). Dry run and real run both passed every check in `supabase/tests/move_leads_quotes.test.sql`. Before: lead 64, quote 25, lost 13. After: contacts closed 62, job 31, moved_lead 70, moved_quote 32; leads open 64, lost 6; quotes draft 14, sent 10, changes_requested 1, lost 7; 70 lines carry quote_id; 66 of 66 invoices carry client_id. No stage transition or event was written for the move. `scripts/move-counts.mjs` prints the same counts read only. Until Task 7 ships, the live app shows no leads or quotes, because the moved rows are stage values it does not know |
| 7 Old links keep working | done | this commit | `MovedRecordRedirect` sends any old `/leads`, `/quotes` or `/jobs` link for a moved row to its new record; every `fh_contacts` list read excludes `moved_lead` and `moved_quote`; `STAGES` is job, closed, lost; mock fixtures moved to `fh_leads` (`l-lead1`, `l-lead2`) and `fh_quotes` (`q-quote`, `q-change`) and the mock models `not.` filters. Full e2e 653 passed, 0 failed. 43 specs that drive the old quote and lead screens are `test.fixme` until Tasks 9, 10 and 15 restore them; each carries the task number |
| 8 The New screen and the create screens | done | this commit | `/new` with five rows, six create screens under one `CreateShell`, `ClientField` (type a name, pick a match or create), header New button, sidebar New row sharing a row with Capture, palette items. The three sheets and the `?new=1` paths are gone. A quote save lands on `/quotes/:id?lines=new`. 12 e2e tests |
| 9 The lead screen | done | this commit | `/leads` and `/leads/:id` with Schedule estimate (to `/schedule/new?lead=`), Quote this (to `/quotes/new?lead=`), notes saved on blur, next estimate visit, Mark lost on a second tap, earlier notes from the moved row. Jobs tabs read `fh_leads` and `fh_quotes`. `QUERY_CACHE_VERSION` v2. 10 e2e tests |
| 10 The quote screen | done | this commit | `/quotes`, `/quotes/:id` with lines edited in place, `/terms`, `/preview`, `/approve`, Make this a job. Quote sheets deleted; Bid pushes to a quote. Routes wrapped in a full width root so the desktop audit measures the shell column while the content stays 640 px. 26 e2e tests, 43 fixmes from Task 7 restored |
| 11 The customer link, send and approve read the quote | done | this commit | `public-link.js` resolves `quote_id` first; approve, request changes, send, DocuSign write `fh_quotes`. Migration 094 applied on October 20 (nullable `contact_id` on versions and envelopes, `fn_approve_quote_version` gains `p_quote_id`, old signature removed). 14 function tests |
| 12 The invoice screen and Money | done | this commit | `/invoices/:id` is the invoice row with `/payment`, `/edit`, `/remind` screens; the old invoice page is the job's Financials tab (`JobMoney`); Money rows are links and its sheets are gone; an invoice stands without a job (`client_id`, PDF without the contract block, client scoped public link); `send-invoice.js` and `public-link.js` take the client when there is no job. Four merge conflicts with Tasks 8, 10 and 11 resolved keeping both sides |
| 13 The job screen loses its sheets and gains Invoice this | done | this commit | Payment, event, partner, complete, follow up and More are screens under `/jobs/:id/...`; `/schedule/new` and `/schedule/:id/edit` replace the event sheet and link a job, lead or quote; Delete and Reopen confirm with a second tap; the job's Quote tab is gone; the stage button reads Invoice this while a balance is owed. The Schedule marks a lead's estimate with a Lead chip |
| 14 Capture, Customers and the rest become screens | done | this commit | Capture is `/capture` (the roster lists jobs, leads and quotes by kind; Lead and Quote rows carry `?text=`); the workspace menu is `/workspace` and phone search `/search`; statements are `/clients/:id/statement`, merging `/clients/merge`, miles `/miles/new`, subs `/subs/new`, invites `/team/invite`, the sub profile `/sub-portal/profile`; the Jobs filter and sort are chips; every `useConfirm` is a second tap; Log payment goes to the payment screens. `fh/Sheet`, `ui/drawer`, `ActionSheet`, `ConfirmSheet` and the sheet components are deleted; `tests/e2e/no-sheets.spec.ts` taps every button on every route |
| 15 Today, Reports, Clients and the Inbox | done | this commit | Needs an answer reads open leads with a follow up due, quotes quiet for seven days and quotes with changes requested; the stage rail shows leads, quotes, jobs and invoices due; the funnel counts leads, quotes, quotes that became jobs and losses from the new tables; a client's Projects tab groups its four kinds; the Inbox chip reads the client's newest record kind (migration 095 applied on October 20); the palette and Search cover leads, quotes and invoices |
| 16 Importer, webhooks, captures and the engine write the new records | done | this commit | Importer rows, webhook leads and captured leads become a client plus an `fh_leads` row; the reminder engine scores open leads and sent, viewed or changes requested quotes with `/leads/:id` and `/quotes/:id` links, and Done or Dismiss matches them. Migration 096 applied on October 20: 36 queued reminders on moved contacts closed; the dry run queued 68 fresh ones (59 leads, 9 quotes), which the daily cron will queue for real on its next run |
| 17 Cut over, screenshots, summary | done | this commit | /jobs is the Jobs list and /work and /pipeline redirect to it (D65); the lifecycle walk in mock-workflows runs on the new screens; guard baselines retaken for every signed in screen (the New button and sidebar row) plus six new shots; 20 screenshots and the invoice PDF in phase9-review; full e2e 937 passed, 429 skipped, 0 failed |

### Phase 9 notes

* October 19: the four code reads and the production queries behind the plan are summarised in the plan's Research notes. The repeated reminders in the notifications list come from one customer having several deal rows, not from the engine repeating itself; none were sent.

## Phase 8 summary

Hi Jesse. Phase 8 fixed what the October 10 audit found, and then some. All seventeen tasks in the plan are done and pushed; Task 18 was skipped because its approval line reads no. After Task 17, the final screenshots and a careful sweep of the app turned up more places where a screen said something untrue, so three follow ups fixed those too. Nothing was merged or deployed, no migration was written, and no file under `supabase/` or `netlify/functions/` changed. #223 (Task 1) and #224 (Tasks 2, 3 and 7) are already merged into `redesign/phase-7`; #225 carries the rest.

Every task and follow up was written test first, then read by two independent reviewers (one for the plan and the tests, one for bugs and regressions), fixed and read again until both approved, before it landed. Reviews caught real bugs along the way, among them a reminder that could still go out twice, a void undone by a send that landed later, a customer page that could approve terms changed while it was open, a crew member on the clock being shown "Not clocked in", and a second Clock out that could move the end of a shift that had already ended.

The full check (`npm run test:all` steps plus the design audit) passed on `1fc654f`: lint with no errors (the same 46 warnings as before Phase 8), typecheck, all 1187 unit tests, 674 end to end tests passed and 432 skipped by device with none failing, the build, and the design audit. The one commit after it (`4a05967`, the job page clock) passed the unit suite and its 26 related end to end tests. CI on the pull request is green. Before and after images for every visual task are in `phase8-review/` and in #225, and the render comparisons in `final-review/` were retaken on this branch.

### What changed

Correctness, money, sending and company boundaries:

1. The test mock now answers like the real database, so a test can no longer pass on data the app would never get.
2. Today counts every stop and every answer waiting, where it used to stop at six.
3. A capture made from a job shows on that job at once, and one made with no signal keeps its job.
4. Opening the app in the morning shows today's stops from last night's saved copy, and never last night's weather.
5. Each invoice asks only for what is still owed after partial payments, everywhere: Money, Due this week, Remind, the email and its PDF, and Mark paid.
6. Money rolls over to the new day, week and month while it stays open. A reminder can never go out twice, and a void or a payment recorded while an email goes out is no longer undone.
7. The Schedule tray and Waiting on approval show only the active company's jobs and quotes, and a drop of another company's job is refused.
8. The Unscheduled tray waits for the booked visits instead of listing every job, holds a card still while its drop saves, and shows 50 cards, then Show all.
9. The Quote tab, the preview and the customer page show one total and one deposit, and the deposit follows the payment terms.
10. The customer page tells the truth after approval, after payment and past expiry, stops an approval if the quote changed while it was open, and stays readable over a bright photo.
11. Inbox sends happen once, only on a tap, and never with no signal.

Design polish:

12. The next stop with no photo is a slim band instead of an empty dark box, and the job tabs fade where they overflow. Opening a job from the Jobs list no longer breaks its header.
13. The gold microphone no longer floats over desktop pages; Capture is a quiet row in the sidebar with its key cap.
14. On a desktop from 900 to 1279 px the company name shows whole, the job page has a facts strip above the composer, and the Money tables keep their buttons and amounts whole.
15. Thirteen small fixes: Reopen asks first, crew do not see New lead, tab counts match their lists, Navigate follows the device, notes show in full, no Murfreesboro forecast without a company location, key caps match the keyboard, a quote with no lines cannot be shared, the Quote tab finds the client's email, an optional line holds Send while it saves, and closing a sheet gives keyboard focus back to the button that opened it.
16. The login wordmark is one word in Bebas Neue, FIELD in gold and HORSE in linen, with the hairline under it.

Cleanup:

17. The screenshot guard now covers 83 views, including Login, the customer page, an invoice, the Inbox and the Forecast screen. The dead CSS it proved unused is gone, and every check for things running off the side of the screen now measures each element. Counting numbers on Reports show their final value at once when Reduce Motion is on.

Follow ups, found after the plan's tasks:

* **A. Nothing says empty while it is still loading, or after a read failed.** The desktop Schedule (Up next, and the week, day and month), Crew home, Reports, Customers, a job's Photos and Files, Field reports and the quote lines now show a placeholder while they load and "Couldn't load" with Try again when a read fails, instead of "Nothing scheduled", "$0", "0 photos" or "No lines yet". Crew home matters most: a crew member already on the clock no longer sees "Not clocked in" with Clock in on while it loads, and Clock out can no longer move the end of a shift that already ended. Counts agree with their numbers too: "1 client on file", "1 new notification.", "Import 1 contact" and five more.
* **B. The customer page after approval.** The headline says the quote is approved, What happens next lists only what is left, a job that is closed out promises nothing more, a company name that starts with The stays whole ("The Concrete Guys sends you a start date."), and the buttons wrap instead of running off a phone. The sign in screens also reach the right edge on a Windows desktop.
* **C. The invoice page on a phone.** Collect Payment no longer runs off the screen; Email, Share link and Download are icons there, with their names kept for screen readers.
* A Money test that failed now and then was fixed. Its taps landed on the dock after the sheet closed; the app was fine.

### Blocked, and calls for you

Nothing is blocked. These need you:

1. **What "behind schedule" means.** Today now counts honestly, which shows an old rule: a job counts as behind whenever any of its visits ended in the last 14 days. A busy company could read 30 things before tomorrow. Pick a rule, for example: the last visit ended, nothing is booked next, and the job is not marked done.
2. **Renaming the company does not rename the workspace.** A workspace that kept an old name (some were given "My Company") shows it in the sidebar and the phone header. Rename the workspace when Settings saves, or prefer the profile's name.
3. **A quote can still change after the customer approved it.** Its lines can be edited afterwards, and the customer page then shows the new total and deposit under Approved, because nothing keeps a copy of what was approved. Decide whether approval should lock the quote or keep a snapshot the page shows.
4. **An approved quote whose job is marked lost** still reads as approved and asks for the deposit (D51). Say what it should say.
5. **The quote number keeps its hyphens** so it matches the PDF. It is the one exception to the no dashes rule (D44).
6. **The classic customer page keeps its old approval bar** (D24): the name comes filled in, Return approves, and Request changes is a dead button on closed quotes. The Fieldhorse page has none of these.
7. **The customer page's cover photo** is the newest of the 12 oldest photos the server sends. The server file would need to send the newest first; that file was off limits in this run.
8. **Task 18** (each quote line's private notes reach the customer's browser, though the page never shows them) still waits for your yes.
9. **The Fieldhorse customer page cannot be chosen in Settings yet** (D22, from Phase 7): the database check needs widening first. Follow up B's fixes are ready for the day it can.
10. **Main does not carry phases 5 to 8 yet.** Phase 4 holds them; main also has the October 9 audit pass (#217) that the redesign branches do not.

### New decisions in SPEC.md section 17

* D19 updated: palette shortcuts are Control plus Option on a Mac, so Option still types accents.
* D31 One quote total and one deposit, read from the terms.
* D32 The next stop without a photo is a compact band.
* D33 Desktop Capture is a sidebar row.
* D34 Today counts past six.
* D35 What Capture refreshes, and offline captures keep their job.
* D36 The active company boundary.
* D37 What each invoice owes.
* D38 Inbox sends once, on a tap, with a signal.
* D39 The Unscheduled tray tells the truth.
* D40 The morning cold open.
* D41 Each screen owns its class prefix.
* D42 The login wordmark.
* D43 Money keeps time and sends once.
* D44 The customer page after approval.
* D45 The small behavior rules.
* D46 The desktop from 900 to 1279 px.
* D47 Counting numbers and the screenshot guard.
* D48 The phone invoice actions fit.
* D49 Loading and failed reads never read as empty.
* D50 Counts agree with their number.
* D51 The customer page after approval, continued.
* D52 The sign in screens reach the window edge.

### iPhone checklist

1. Leave Today open overnight, then look at 6:30 am: today's stops, and no weather from last night.
2. On a day with more than six visits, every stop counts in the headline and the list.
3. Capture a note from inside a job: it shows on the job at once. Then try it in airplane mode: it lands on that job when the signal returns.
4. Money: record a partial payment, open Remind, and check the amount is what is left. Tap Send reminder several times fast on a test customer: one email.
5. Leave Money open past midnight on a Saturday: Due this week and the month label roll over.
6. Open an invoice from Money: Email, Share link and Download are icons, and Collect Payment reads whole.
7. Open a test quote's customer link: the deposit sentence follows the terms. Approve it, open it again, and check it says approved.
8. Login and Reset password: the wordmark shows as one word with no flash while the font loads. Safari's font behavior was only imitated in Chromium here, so this one matters.
9. Sign in as crew while clocked in, on weak signal if you can: the card says "Checking your clock" first, never "Not clocked in", and Clock out works.
10. Sign in as crew: no New lead on Jobs. Open a lost job and tap Reopen: it asks first.
11. Sign out and back in, turn on airplane mode, then open Customers and Reports: each shows its loading placeholder, or "Couldn't load" with Try again once a read fails, never zero or empty. With data already on screen, a failed refresh keeps it there.
12. Turn the phone sideways on Today and Jobs, and check nothing overlaps.
13. If you turn the messaging engine on for a test company, open Inbox, turn on airplane mode and tap Send: nothing goes out. Turn it off and send once.

## Phase 8, audit fixes

Plan: `PHASE8_PLAN.md` in this folder. Branch `redesign/phase-8` from `redesign/phase-7`, draft pull request against `redesign/phase-7`. New decisions start at D31 in `SPEC.md` section 17.

**If a new session picks this up:** continue from the first Phase 8 task below that is not `done`, `blocked` or `skipped`.

### Failing before Phase 8

Baseline `npm run test:all` steps on `cdcbc23` (the Phase 7 code plus the plan), run at 10:35 pm Central on October 10:

* lint 0 errors (46 warnings that were already there), typecheck, build and `audit:design` pass, 850 of 850 unit tests.
* Playwright 269 passed, 184 skipped by project, 1 failed: `mock-workflows` "keeps the desktop schedule planning workflow complete" (desktop). It depends on the time of day (see the notes below) and is fixed in `8ff6cb7`, before any task.

### Phase 8 tasks

Status is one of todo, done, blocked, skipped.

| Tier | Task | Status | Commit | Notes |
| --- | --- | --- | --- | --- |
| 1 | 1 Make the test mock honest | done | `8b14809` | Reviewed twice, one fix round. Data fixed in one test (see notes) |
| 1 | 2 Today counts stop at 6 | done | `07a9071` | Reviewed by two lenses, approved with no fix round. Decision D34 |
| 1 | 3 Capture from a job page shows up on the job | done | `1766c46` | Reviewed by two lenses, approved with no fix round. Decision D35 |
| 1 | 4 Morning cold open says "Clear day" | done | `84ccf0d` | Reviewed by two lenses, approved with no fix round. Decision D40 |
| 1 | 5 What each invoice actually owes | done | `33a5b55` | One fix round (email and PDF agreement, jobs with no contract amount, drafts in the allocator), then approved. Decision D37 |
| 1 | 6 Money timing and double sends | done | `244804d` | Three fix rounds (panel pages before the company loads, a send surviving a trip away from Money, a tap as the email lands), then approved. Decision D43 |
| 1 | 7 Jobs and quotes stay inside the active company | done | `222e8f6` | Reviewed by two lenses, approved with no fix round. Decision D36 |
| 1 | 8 The Unscheduled tray tells the truth | done | `d4dc086` | Two fix rounds (overlapping drops, rollback by value), then approved. Decision D39 |
| 1 | 9 One quote total and one deposit everywhere | done | `8c3f6c9` | Reviewed by two lenses, approved with no fix round. Decision D31 |
| 1 | 10 The customer page after approval and on bad data | done | `69391d8` | Four fix rounds (Ask controls left as dead buttons, Enter on the authority box approving, a stale page approving changed terms), then approved. Decision D44 |
| 1 | 11 Inbox sends exactly once, only when tapped, only when online | done | `36e4c88` | Reviewed by two lenses, approved with no fix round. Decision D38 |
| 2 | 12 Next stop card without a photo, and job tabs | done | `988deb0` | Two fix rounds (a class clash with the Jobs list, tabs under the fade), then approved. Decisions D32 and D41 |
| 2 | 13 Desktop Capture button | done | `7d8351b` | One fix round (an Inbox test still waited for the removed button), then approved. Decision D33 |
| 2 | 14 Desktop between 900 and 1279 px | done | `2477a34` | Two fix rounds (an overflow check that could not fail, a company name cut to a fragment), then approved. Decision D46 |
| 2 | 15 Small behavior fixes | done | `5a2fd06` | Two fix rounds (the closeout Reopen, a frozen app after back, focus on the deal card), then approved. Decisions D19 updated, D45 |
| 2 | 16 Login wordmark | done | `74cd854` | Two fix rounds (the fallback face ran off a phone while Bebas Neue loaded, WebKit's early font answer), then approved. Decision D42 |
| 3 | 17 CSS and test hygiene | done | `3f06868` | Reviewed by two lenses, approved with no fix round; the lead added a test for the dead CSS finder and fixed the two gaps it found. Decision D47 |
| 3 | 18 Private line notes on the customer page | skipped | | The approval line in the plan reads no, so `netlify/functions/public-link.js` is unchanged |

### Phase 8 follow ups

Found after Task 17 by the final screenshots, a read only sweep a skeptic checked, and the Task 17 review. They are outside the plan's eighteen tasks; each is written test first and reviewed like a task. Status is one of todo, done, blocked.

| Follow up | Status | Commit | Notes |
| --- | --- | --- | --- |
| A Nothing reads as empty while it loads or after a failed read, and counts agree with their number | done | `95c9fba`, `0c796f6`, `4a05967` | Three fix rounds (the desktop quote builder adding a line after a failed read, a running shift hidden by another failed read, a flaky race test), then approved. The lead added two fixes from the last review. Decisions D49 and D50 |
| B The customer page after approval, company short names, and the login edge | done | `b4659a0`, `1fc654f` | Two fix rounds (Login with the photo still short of the edge, a finished job's pay button, a whole company name pushing the capsule buttons off a phone), then approved. The lead merged its preview pane with follow up A's and fixed the preview's headline for a changes requested quote. Decisions D51 and D52 |
| C The phone invoice actions fit | done | `49f3c87`, `d0b74d1` | Found by the Task 17 review. Reviewed by two lenses, approved; the lead then took up their minor points in a second commit. Decision D48 |

### Phase 8 notes

* **Task 1, the honest mock.** REST reads in `scripts/qa-mock.mjs` now honor eq, neq, in, gt, gte, lt, lte, is, order, limit and offset, several filters per column, and counts (the filtered total before limit and offset, with Content-Range exposed to the page). Unknown operators, `not.`, `or=`, `and=`, embedded columns with a dot and embedded ordering are still ignored. A single object read returns PostgREST's 406 when none or several rows match, unless the mock ignored part of the query. A date column compares with a time filter by the date as written. `QA_NOW` must be an ISO time with a zone, or loading the mock throws an error that names it. Writes keep the old rules.
  * Test data fixed (no assertion changed): `mock-workflows` "keeps money, schedule, settings, and missing routes usable" on the phone. The phone Day view filters visits to today, and the default visit starts two hours after the mock loads, so after 10 pm Central it fell on tomorrow. The test now seeds its own visit and pins the page clock.
  * Default rows whose meaning changed: Money now counts only job, invoice and closed jobs (desktop Total outstanding $156,850.00 with 7 jobs became $49,100.00 with 3); the default visit no longer counts as a past visit, so Today's Needs an answer loses "Plumbing Bellevue is behind schedule"; the Add event job picker no longer offers the lost job. The six cleanup guard baselines for Today and Money were retaken for this reason.
  * The cleanup guard has one unstable shot: phone Analytics in Day (Won YTD and Profit YTD show $55K against $56K between runs). Task 17 widens the guard and should make that shot stable.
  * Known minor gap, left as is: `QA_NOW` with an impossible date such as February 30 rolls over to March instead of throwing.

* **Task 2, Today counts.** Today reads up to 50 visits a day (`VISITS_PER_DAY`) and keeps the 20 most urgent next actions (`NEXT_ACTIONS_KEPT`) with a full count beside them (`nextActionsTotal`). See all shows the 20 with a note when more wait. D28 said up to 6 rows; it now points at D34.
  * Known issue, not changed: a job counts as behind schedule when any of its visits ended in the last 14 days (`overdueScheduleQuery` in `homeDashboard.ts`), because visits have no done state. The cap of 6 used to hide this. With the honest count, a company with 30 jobs visited in the last two weeks will read about 30 things before tomorrow. The rule needs Jesse's call (for example: behind means the last visit ended and nothing is booked next, and the job is not marked done).
  * Small follow up, not changed: cover photos are still signed for every job in the kept actions and today's visits (up to 73), though only the next stop shows one.
  * Days with more than 50 visits still cut off quietly at 50.

* **Task 3, Capture on a job.** `refreshAfterCapture` in `captureActions.ts` refreshes `jobDetail` for the job, `jobsKey` and `homeDashboardKey` after a save. The offline outbox keeps `job_id` and inserts it as `contact_id`; items queued before this change flush with no job, as before.
  * The offline e2e fakes no signal through `navigator.onLine` and the online and offline events, not `context.setOffline`: with `setOffline`, a module still loading made the stale chunk guard reload onto the browser's offline page under load.
  * Known gap, not changed: a queued job capture that the database refuses for permission (the job still exists but this person lost access) stays queued and the pill reads Syncing. Only a deleted job falls back to a note on no job.

* **Task 7, the active company.** `org_id` joined `JOB_LIST_COLUMNS`. New `src/lib/activeCompany.ts` (`inActiveCompany`) and `useCompanyJobs` in `queries.ts`; `dropRefusal` in `scheduleBoard.ts` refuses another company's job before any insert. The filter sits in a hook rather than in `moneyView.ts`, because the invoices bundle carries no quotes. Places that use `useJobs` rows:
  * Changed: the desktop Schedule tray and its drop, phone Money Waiting on approval, desktop Money Waiting on approval.
  * Left alone on purpose, lists meant to show partner shared jobs: the Jobs list in `Work.tsx` with its row actions (won, lost, reopen, follow up), `DetailListRail.tsx`, `useJobSearch`. The Jobs list's group money notes still add up partner amounts, matching the rows shown.
  * Link only: `inbox/Thread.tsx` picks a job chip and creates nothing. Already scoped: the Add event job picker.
  * Outside Task 7, not changed: the Capture sheet's job picker reads jobs with no company filter (it does not use `useJobs`).

* **Flaky test made steady, no assertion changed.** `quote.spec` "a draft can be deleted, an approved quote cannot" (phone) opened the draft and then the approved quote in the same browser context. The job page keeps its last read in the offline cache for 30 seconds, so the second visit could show the draft it had just seen and never ask the mock again. It passed in CI and in the baseline but failed here on every lane after Task 1 (the honest mock answers in a different order, which tips the race). The approved half now opens in a fresh browser context; it passed three runs in a row.

* **Task 11, Inbox sends.** New `src/lib/queryPersistence.ts` decides what the offline cache saves; Inbox reads and writes never are. Three existing assertions changed with the behavior (the Send button is now "Send draft reply", the failed approval test expects the new toast and a disabled Send until the thread is read again, and two `draftText` cases flip because D26 says unknown shapes show no draft).
  * `QUERY_CACHE_VERSION` was not bumped: a cache saved before this change rehydrates old Inbox rows once, they refetch at once and are never saved again.
  * Known small gaps, not changed: a cold open with no signal shows the failure toast rather than the no signal one; words typed after tapping the mic to stop can be overwritten by a late dictation result; when the drafts read fails, draft Send stays disabled.
  * For other tests: under `page.clock.setFixedTime` the cache writer (TanStack's throttle waits on `Date.now`) writes once and then stalls, so persistence tests run on the real clock.

* **Task 8, the tray.** Three lane commits squashed into one. Round 1 found a major (two overlapping drops could re enable the slow card before its refetch and a second drag wrote a duplicate visit); round 2 found another (rollback by identity missed after another drop's rollback, so a failed card vanished). Both fixed with new e2e tests. The third round's second reviewer never finished (it waited on a shared dev server), the first approved with three small notes.
  * Fixed at integration: Show all N used to unmount under keyboard focus; it now moves focus to the first revealed card.
  * Known small gaps, not changed: a drop that succeeds during the one round trip at midnight can bring its card back with drag enabled until the next refetch; rollback by value can remove a teammate's real booked row for the same job when three things coincide (slow insert, a refetch landing mid insert that carries the teammate's row, then a failure). Both are one round trip wide.
  * The mock ignores `not.` filters, so the booked read's `contact_id not null` is only applied by the real database.

* **Task 4, the morning cold open.** `onDay` became `placeByDay` in `todayView.ts`; `weatherQuery` and `currentForecast` are new; `Home.tsx` lost its weather effect and state. `getWeather` is untouched, so every test and compare script that answers `api.open-meteo.com` still works.
  * Plan and brief mismatch, kept on purpose: the cold open e2e pins the clock with `page.clock.setSystemTime`, not `setFixedTime`, because the offline cache writer (TanStack's throttle) loops on `Date.now` and never writes under a fixed clock. The time still never drifts within the test's reads.
  * Known small gaps, not changed: when the browser has fired an offline event, a stale forecast's paused refetch leaves the stage on the forecast skeleton rather than the unavailable line; Today's clock ticks once a minute, so after a backgrounded tab resumes the 90 minute gate and the day placement can lag one tick.

* **Task 9, one quote total and one deposit.** New `src/lib/quoteMoney.ts` with `quoteMoney.test.ts` (25 tests on a $10,000 quote) and `quoteMoneyAgree.test.tsx`, which renders the real preview pane and checks the capsule, the preview and the customer page agree. `buildQuoteView(items, terms)` now returns `money`; `depositScheduleFromTerms` is gone. `quoteStatus.ts` lives at `src/screens/ContactDetail/lib/` and computes no money, so it is unchanged.
  * Assertions changed with the behavior the plan asks for (none weakened): the portal headline test no longer expects the fixed walkthrough line and now asserts it is absent; step 3 with empty terms reads the default schedule; the empty quote capsule shows `contact.amount` ($46,200.00 with a $23,100.00 deposit) instead of $0.00, as the customer page already did; `depositScheduleFromTerms` tests were restated for `quoteMoney` with the same inputs, and "No deposit required." and "0% deposit" now give no deposit where they used to fall back to 50 percent (the bug).
  * Known small gaps, not changed: on a $0.00 quote with a named dollar deposit the capsule prints "Deposit $0.00 at approval" while the customer page prints no sentence; phrasings such as "$500 non refundable deposit" or "Deposit due at signing: 30%" fall to "per the terms"; the desktop payment terms hint still lists the old helper text; the classic letter's totals block still adds tax from the priced lines only; `InvoiceDrawsSection` still generates draws from the default schedule whatever the terms say.

* **Task 5, what each invoice owes.** Two lane commits squashed into one. Round 1 found three majors: the reminder email and its attached PDF disagreed on the amount due (the PDF hero now takes `amountDue`), Today dropped overdue invoices on jobs with no contract amount (`knownContractTotal`), and the allocator ignored drafts so it disagreed with `invoicesPaidInFull` and `logPayment` (drafts now absorb unlinked money). All fixed with tests written first.
  * Plan and code differ on purpose: the plan says unlinked money settles "oldest due first"; the code settles by invoice number, then due date, then creation, because draws made from terms have no due date and the deposit draft would otherwise come last. This matches `logPayment` and the job page. The unit test that asserted the due date order was restated with flipped expectations and a stated reason.
  * Shared file `scripts/qa-mock.mjs`: Harold (`c-job2`) had a $6,400 unlinked payment and one open $6,400 draw, which the honest rule read as paid. A paid deposit row `inv0` was added and `inv1` became invoice 2, so `mock-workflows` and `redesign-shell` keep their rows. `money.spec` Rosa gained a paid $3,000 deposit for the same reason; no assertion changed. The lead gave Rosa the same paid deposit in `scripts/compare-renders.mjs`, so her Overdue row stays in the Phase 8 render comparison.
  * Known small gaps, not changed: Mark paid from Money on a bill the allocator says is covered opens an empty payment sheet; the job page's Mark paid prefill (`InvoiceDrawsSection.handleMarkPaid`) subtracts only linked payments; the PDF hero's "collected of contract" line can read collected above contract on a job with no recorded amount; Money loads every settled invoice in the company for the allocator (Today narrows to jobs with an open invoice).

* **Task 12, the next stop band and the job tabs.** Three lane commits squashed into one. `PhotoCard` with no photo is a compact onyx band; the job tabs fade where they overflow.
  * Found by review and fixed in this task: the Jobs list's `jobs.css` used the job page's own class names (`.fhj-tabs`, `.fhj-head`), so after opening a job from the Jobs list on a phone the header became a flex row and the fade sat on the wrong box. The Jobs list moved to `fhjl-` (D41); new e2e tests walk Jobs list to job and back.
  * The opt in pixel baselines (`FH_VISUAL=1`) for Today, the job page and `/design` were refreshed for the band and the fade (seven images). Task 17 reruns the whole guard.
  * Known small gaps, not changed: after the tab strip changes width (turning the phone), the selected last tab can end a few pixels under the fade until the next tab change; at about 1100 px on a desktop the photo version of the next stop clips the top of a two line eyebrow (passed to Task 14); with `QA_NOW` set, `redesign-shell` "last item clears the dock" fails on the base too.
* A one off failure in the background run after Task 5: `mock-workflows` "uses the full desktop workspace" timed out on desktop while three agent groups were running browsers (load average 18). It passed twice alone and in CI.

* **Task 13, desktop Capture.** Two lane commits squashed into one. New `src/lib/shortcutKeys.ts` (`isMacLike`, `desktopShortcut`) prints ⌘ or Ctrl on the sidebar caps. `CaptureFab.tsx` was deleted: it never rendered below 900 px (the phone uses the dock coin), so nothing was left to keep on the phone.
  * Test changed with the behavior the plan asks for: the desktop Inbox test that measured the floating button now asserts nothing floats over Send (a hit test at five points) and the only Capture button is the sidebar row. The desktop capture test was strengthened at integration to assert no `.fh-fab` and exactly one Capture button on Today, Money and the job page, whatever a future button's class.
  * Known small gaps, not changed: older desktop pages outside the redesign (Customers, Settings, Notes, Reports and others) still print a fixed ⌘K in their own search bars; with the Inbox switched on and Team and office open, the sidebar's last row (Import) is clipped on a 900 px tall window and needs a scroll; focus does not return to the row that opened a sheet after it closes, for every `fh/Sheet` (it did not before either); `.fhs-side__kbd` in `fh-shell.css` is now dead (Task 17).

* **Task 16, the login wordmark.** Three lane commits squashed into one. The wordmark Login shows is the local one in `src/screens/auth/AuthShell.tsx`, shared by Reset password and Partner invite, not `src/components/Wordmark.tsx` as the lead's note said; the lane changed the AuthShell one and left Onboarding as it was.
  * Shared file, allowed by the task: `scripts/audit-design-system.mjs` gained one documented exception for the 68 px wordmark rule in `auth.css`.
  * The WebKit font behavior was imitated in Chromium (only Chromium is installed here); it is on the iPhone checklist.

* **Task 6, Money timing and double sends.** Four lane commits squashed into one. New `src/lib/useNow.ts` and `src/lib/invoiceSends.ts`; `sendInvoiceEmail` now filters its status update on the status it started from (`sendInvoiceEmail.test.ts`). `money.spec` grew from 27 to 49 tests, every new one pinned to a fixed clock.
  * At integration: the desktop Schedule board dropped its private minute ticker for the shared `useNow`, so it also catches up when its tab comes back into view; the paused Mark paid and Void line was reworded to "Mark paid and Void are paused while the email goes out.", because the sheet closes when the email lands rather than turning the buttons back on.
  * Plan and code differ: the named Sunday 8 am unit test passes on the old code too, because the pure function already honored `now`; the screen level failure is pinned by the rollover e2e tests.
  * Known small gaps, not changed: the job page draws (`InvoiceDrawsSection`) still send with an unfiltered status update and keep their own busy state, as do the invoice page and the Send invoice sheet; only Money's sends go through the shared set.

* **Task 10, the customer page.** Five lane commits squashed into one. `portal.spec` grew to 54 tests per project; a real bright photo (`tests/e2e/fixtures/bright-cover.jpg`) checks the header contrast. Three existing assertions changed because the plan asks for it (the newest cover, the empty signature), one round 3 assertion changed with a stated reason.
  * At integration: while changes are requested the steps used to drop the deposit step but keep the balance step, so the listed payments covered half the price. The steps now start with the revised proposal and keep every open quote step; the unit test checks that against the open quote, and the e2e list was updated with it.
  * Lead decision recorded in D44: the quote number keeps its hyphens so it matches the PDF and the letter themes; it is the one exception to the no dash rule.
  * Known gaps, not changed: the classic page keeps its prefilled signature and Return submit, and its Request changes button is a dead button on declined and closed quotes (D24 keeps the classic bar as it was; Jesse's call); sentence case company names with no business word ("Elite pools") are greeted by their first word; the cover is the newest of the 12 oldest photos the server sends (`netlify/functions/public-link.js` would need to order by upload date, not allowed in this run); a refused question that ends on the Approved or Closed capsule drops focus to the page; a question refused because the job was deleted says to try again; the deposit after a change order follows D31.

* **Task 15, small behavior fixes.** Three lane commits squashed into one: all thirteen bullets, plus the lead's addition (a closing sheet gives focus back to its opener). New `tests/e2e/small-fixes.spec.ts`, `src/lib/customerEmail.ts`, `src/screens/ContactDetail/lib/jobPhotos.ts` and `src/components/desktop/PaletteKeyCap.tsx`. Shared files changed, backward compatible: `fh/Sheet.tsx`, `fh/SpineEntry.tsx` and `ConfirmSheet.tsx` (an optional abort signal and `freePageForQuestion`).
  * At integration: `useMoneySheets` took Task 15's shared `customerEmail` beside Task 6's send store (one conflict, resolved); any open question now closes when the page changes (it stayed over the next screen after the back button, and a yes there moved the previous job's stage; Mark lost behaved the same); Approve a new version now waits while an optional line saves. Both with tests that failed first.
  * One existing test's data changed, no assertion: `quote.spec` "shares a link when there is no email" gave the linked client an email, which now counts.
  * CI on `5a2fd06` failed one test for the same reason: Task 10's "a customer name saved in sentence case shows whole in the labels" seeded a customer with no email but a linked client with one, so the Quote tab rightly found it and "No email on file" did not show. The test now gives the linked client no email either; no assertion changed.
  * Known gaps, not changed: invoice draws on the Financials tab still read only the job's own email; the Forecast screen still defaults to Murfreesboro; when one sheet opens another, closing the second cannot return focus to the first sheet's opener.

* **Task 14, desktop from 900 to 1279 px.** Three lane commits squashed into one. New `tests/e2e/mid-width.spec.ts` (it reads `FH_MID_WIDTH` to run at another width; it passes at 900, 1024, 1100, 1279, 1280 and 1440 px), `JobFactsStrip.tsx` and `money/useCompactMoneyTable.ts`. Shared files: `fh-components.css` for the next stop photo fix, which the lead assigned (the Task 12 review found it in this range), and `global.css` for the sidebar name, where Task 13 put the sidebar rules.
  * At integration: the facts panel and the strip both use Task 15's `navigateHrefHere` (two conflicts, resolved the way the Task 15 lane described); the shortening rule changed so a one word name loses its legal word again ("Acme LLC" reads "Acme", the Phase 2 rule), while My, The and similar words still keep it; the lane's own test asserted the opposite and was changed with this reason. The opt in visual baselines (`FH_VISUAL=1`, 12 desktop and crew images) were refreshed for Tasks 12 to 16, so Task 17 starts from a clean guard; a second run matched all 30.
  * Known gaps, not changed: renaming the company in Settings does not rename the workspace, so a workspace that kept an old name ("My Company" from migration 032) shows it in the sidebar now as it already did in the phone header (Jesse's call: rename the workspace on save, or prefer the profile's name); Schedule blocks at 1024 px break long words ("Walkthroug h"); the Money tables' amount cells render at 15 px regular and the Amount and Action headers sit left of their values (an older style clash); `redesign-shell`, `desktop-route-audit`, `mock-workflows` and `portal` still check overflow by the page's scroll width, which cannot fail.

* **Task 17, CSS and test hygiene.** One lane commit, approved by both reviewers with no fix round.
  * The screenshot guard now takes 83 shots: the 10 earlier screens plus an invoice (`/invoices/c-job2`), the Inbox, the Forecast screen, Login and the customer page, each full page on the phone in Day and Night, the 1280 desktop in Day and Night, and 1440 by 900 in Day, plus the palette and the Capture sheet open, in Day and Night on both. It answers the forecast and the place name lookup itself, so no shot depends on the network. Its baselines were written on the untouched CSS and two runs matched; after the removal two more runs matched with no changed pixel. A 0.3 px letter spacing change made it fail, so it still sees small changes.
  * Why phone Analytics moved: the counting numbers (CountUp) ran a spring even under Reduce Motion, and the old shot caught Won YTD mid count ($55K on its way to $56K). Under Reduce Motion they now show the final number at once (D47). Only the two phone Analytics baselines changed.
  * Removed: 17 empty blocks, 13 unused keyframes (the 11 the plan names and two copies of `fh-pulse`), 12 whole dead rules, 33 dead selectors in live lists, `.fhs-side__kbd`, about 66 stale comments, and the stacked indentation. Every remaining rule is unchanged and in the same order. Shared CSS files were edited for dead rules and comments only.
  * `scripts/find-dead-css.mjs` reads every CSS file under src, counts netlify and the HTML files as use and test files as not, protects names built from a variable only inside class contexts, and lists rules a variable could build as unknown, never dead. It reports nothing left. At integration the lead added `src/lib/findDeadCss.test.ts`, which runs the script on a small fixture, and fixed two gaps the review found: a prop such as `overlayClassName` now counts as a class context, and a block holding only `@page` or `@font-face` is no longer listed as empty. A stale comment about a removed client grid went too.
  * `login.spec.ts` checks the onyx shell (scope, background, text color and grain) instead of the removed effect markup. The overflow check from `mid-width.spec.ts` is now `tests/e2e/helpers/overflow.ts`, used by `mid-width`, `redesign-shell`, `desktop-route-audit`, `mock-workflows` and `portal`. It found no overflow on their pages, which closes the Task 14 gap above about checks that could not fail.
  * Known gaps, not changed: `scroll-behavior.spec.ts` still uses the page scroll width check; under Reduce Motion the dock coin still shrinks a little when pressed (the old rule meant to stop it named a class that no longer exists and went as dead).

* **Follow up A, nothing reads as empty while it loads or after a failed read, and counts agree with their number.** Four lane commits squashed into one. The sweep found eight screens that said empty, zero or done while their data was still loading or after the read failed, and eight places where a number and its noun disagreed ("1 clients on file", "12 all", "1 new notifications.").
  * Loading and failed reads: the desktop Schedule's Up next, the board in Week, Day and Month, Crew home, Reports, Customers, the job's Photos and Files, Field reports, and the quote lines on both layouts with both previews and the approve sheet. Each shows its own skeleton while the first read is out, an error with Try again after a failed read, and the same screen as before once the data is in. Try again keeps keyboard focus on what stays on screen (new `src/lib/retryFocus.ts`); a one value skeleton is the new `src/components/LoadingValue.tsx`.
  * Crew home was the most important: a crew member already on the clock saw "Not clocked in" with Clock in on while the page loaded. Now the card says it is checking, Clock in waits for a read of the clock that works, a running shift stays on the card with Clock out whichever other read failed, and only the latest load decides what the card says. `getActivePunch` and `listMyRecentPunches` gained an opt in to throw, so their other callers are unchanged.
  * The quote lines: a failed read used to read as a quote with no lines, offer Add a line at sort order 0, and block Approve as if nothing was there. Now nothing can be added until a read works, Send and Approve wait with "We couldn't load the lines.", and a failed delete or move puts the lines back.
  * Counts: Customers, Notifications, the photo upload toast, Vendors, the vendor page, Importer, Compose and Settings now agree with their numbers through `countNoun`. On Customers the second count of the Book of business line now counts only the clients the first one counts.
  * New `tests/e2e/loading-truth.spec.ts` (each screen held loading, failed, and loaded as before) and `tests/e2e/count-words.spec.ts`, plus unit tests for `timePunches`, `retryFocus` and `LoadingValue`.
  * At integration the lead added two fixes from the last review, each test first. Try again after a failed read of the clock now shows "Checking your clock" with Clock in off until the new read lands, where it showed the older "Not clocked in" with Clock in on (new test in `loading-truth.spec.ts`). Clock out now ends only a shift that is still open: a second clock out from an older screen, or after the shift ended elsewhere, leaves the shift's end time as it was (new tests in `src/lib/timePunches.test.ts`). On Crew home it says "Already clocked out" and reads the clock again. A third review of the merge found that the job page's time clock (`TimeClockCard`, the other caller) then kept failing on every Log time for a crew member; it now says "Already clocked out" and stops its meter, and for the job's owner it still logs the meter as labor, as it always did, and says the shift had already been clocked out (new `tests/e2e/time-clock.spec.ts` and a Crew home test). The lead also dropped a `--v3-` color from the checking line, which drew only a skeleton.
  * The screenshot guard's three desktop Customers shots changed for the new count words ("1 client on file", "1 client · 1 with open jobs", "relationship in book") and nothing else; a second commit retook them, after the related specs passed on both projects (483 passed, none failed) and the rest of the guard matched (80 shots).
  * Known gaps, not changed: on the job page an owner's Log time still books the meter as labor when the shift was already clocked out elsewhere (it now says so; whether to book it then is Jesse's call); the Quote tab's signature button label still has a hyphen, older than Phase 8; no test holds the company scope read itself, though a probe showed Reports and Customers wait for it correctly; Field reports labels a linked report "Unlinked" on desktop, or "Unknown job" on a phone, while the job list is still loading or after it failed (older than Phase 8); the desktop Field reports error sits flush against its card's edges in the failed state only; the older Unscheduled tray (D39) does not keep focus on Try again.

* **Follow up B, the customer page after approval, company short names, and the login edge.** Three lane commits squashed into one.
  * The Fieldhorse customer page: the headline follows the quote ("your quote is ready." while it can be approved, "your quote is approved." once it is, "here is your quote." while it waits on a revised proposal, after it expired and once it closed). After approval, What happens next drops the approve step, and while any of the deposit is owed the first step is "You pay the deposit.". An approved quote whose job is closed out is a finished job: no steps, no sentence under the total, "{company} has your approval." with no start date promise, and no pay button once the deposit is in (or, on terms with no deposit, once the payments reach the total).
  * Company names: one rule (`companyShortName`, using the word lists `headerName.ts` uses) for the steps and the capsule's question link, so "The Concrete Guys sends you a start date." no longer reads "The sends you a start date.", and "Parker, Inc." stays whole.
  * The capsule's buttons are as wide as the capsule and a long label wraps inside its button, so a whole company name never pushes Approve or the question link off a phone.
  * The in app Preview as and the desktop Document view read the job's payments for the Fieldhorse theme, so they say what the customer page says. They wait for that read, and say so with Try again when it fails.
  * The sign in screens (Welcome, Login, Reset password, Partner invite) give the reserved scrollbar gutter back, so on a desktop with classic scrollbars the stage and its photo reach the window's right edge. The column and the photo are measured from the window, so a scrollbar that comes and goes never moves them, and on a desktop the photo column leaves room for one alert line.
  * New `tests/e2e/portal-after-approval.spec.ts` and `tests/e2e/login-edge.spec.ts` (which runs Chromium with real scrollbars), plus unit tests in `portalView.test.ts`, `quoteMoney.test.ts`, `quoteMoneyAgree.test.tsx` and `DocumentPreviewPane.test.ts`.
  * At integration: follow up A had changed the same preview pane (one element in every state, with focus kept on Try again). The lead merged the two, with the payments read and its error inside A's pane, so Try again on a failed payments read keeps focus on the pane too; that also settles a point from B's last review. The lead also made the preview read a changes requested quote as the customer page does: it had said "your quote is ready.", asked for the deposit, left out the revised proposal step and showed no capsule for it (new test in `quoteMoneyAgree.test.tsx` for the headline, the sentence and the steps).
  * The screenshot guard's Login and customer page shots changed with this follow up and nothing else did: the three desktop Login shots by the column moving about 7 px to center on the whole window and by the right 15 px, where the onyx stage now reaches the edge instead of the flat gutter, and the five customer page shots by one row of pixels, the question link's underline (plus one antialiased pixel in the two phone shots). A second commit retook those eight after the related specs passed on both projects (379 passed, none failed); the whole guard then matched (83 shots).
  * Known gaps, not changed: an approved quote whose job was marked lost reads as any approved quote (Jesse's call); the desktop Document view keeps the payments it read when it opened, so a payment logged while it is open shows once it is opened again; a two line alert still makes Login with the photo scroll at 1440 by 900, though nothing moves sideways.

* **Follow up C, the phone invoice actions.** On a phone the invoice page's action row (Email, Share link, Download and the gold Collect Payment) was wider than the window, so Collect Payment was cut off at the right edge on every phone up to 412 px (Money's invoice rows open this page). Below 600 px the three quiet actions are now 48 by 44 px icon buttons that keep their names for screen readers and a hover tooltip; Collect Payment reads whole on one line from 375 px up, and on a 320 px phone its two words stack inside the button. From 600 px up, tablets and desktops keep the labels. New `tests/e2e/invoice-actions.spec.ts` checks 320, 375, 390, 412 and 599 px with the shared overflow check and that no word or icon is drawn outside its button, that the labels are drawn on one line at 600, 899 and 900 px, and that an icon button is named for what it is doing while it works ("Minting…"). Only the two phone invoice shots in the screenshot guard changed: the action row, plus 81 card corner pixels a shade apart in the Day shot. Both were retaken.
  * Review: both reviewers approved with minor points. The lead's second commit keeps the labels wherever the labelled row fits (the first commit hid them below 900 px, so tablets lost them), gives each quiet action one label for both its text and its name, adds the tests at 599, 600, 899 and 900 px and the busy name test, and corrects the size and tooltip wording here and in D48.
  * Known gap, not changed: on a phone a busy quiet action shows only its dimmed icon; its name says what it is doing, and a toast follows when it finishes.

* CI on `49f3c87` failed `money` "a sheet opened while another email of its invoice goes out closes when it lands" on the phone, and it failed 2 of 5 runs here too. The cause was in the test, not the app: its tap loop kept tapping the Send reminder spot while the sheet slid away after the email landed, and a late tap reached the dock's Capture button behind it, so Capture covered Money and Lorraine's Remind button never showed. The loop now stops tapping once the sheet starts to close; the helper still clicks the button at that instant, so the landing is covered as before and no assertion changed. 12 runs in a row then passed, and every test that uses the loop passed 3 runs on both projects.

* The first CI run on #223 (a docs only commit) failed `mock-workflows` "keeps the desktop schedule planning workflow complete" on desktop. The default mock visit starts two hours after the mock loads, so between 10 pm and midnight Central it lands on tomorrow and the Day view is empty. It failed here too at 10:48 pm Central and passed after the test pinned its page clock to a Thursday morning and seeded that day's visit. It is listed under "Failing before Phase 8".

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
