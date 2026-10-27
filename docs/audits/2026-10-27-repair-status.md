# UX audit repair status · October 27, 2026

Scope: the 42 findings from the Fieldhorse UI and UX audit, reconciled against the current changes on `fix/ux-audit-october-2026`.

**Current ledger:** 38 implemented in code, 2 awaiting database validation and migration, 2 needing production setup. No original finding is deferred.

This ledger covers both local repair passes. It does not assign a new product score or claim production release.

**Implemented** means code addresses the observed defect. Deployment and production verification still apply to every row. **Database validation required** means the application change and CLI-generated migrations passed focused PostgreSQL execution, including authorization checks, but complete historical migration replay, simultaneous-session checks, staging verification and migration application remain gates. **Needs production setup** means interface recovery improved but the failing service still needs hosting configuration and production verification.

| ID | Finding | Status | Change and remaining scope |
| --- | --- | --- | --- |
| F01 | Desktop hides leads and quotes | Implemented | Work now uses one inventory and stage view across viewport sizes, including standalone leads and quotes. |
| F02 | Unclear revenue comparison | Implemented | Comparisons name both completed months. Current month stays explicitly partial. Receipt totals use payment dates. |
| F03 | Outstanding balances lack reconciliation | Implemented | Money exposes issued receivables, overdue invoices, drafts, unissued contract value and every reference aging bucket. Each opens exact contributing records and cent totals. Categories explain overlap and their date basis. |
| F04 | Similar invoice drafts | Database validation required | Unique invoice references, duplicate review, fresh budget checks, correct unbilled prefills and server delivery safeguards are implemented. The contract budget trigger in supabase/migrations/20261027170408_invoice_billing_safeguards.sql passed focused PostgreSQL role, budget and rollback checks. Full migration replay, simultaneous-session verification and application remain required; historical records were not automatically cleaned. |
| F05 | Margin hides cost coverage | Implemented | Money and Reports disclose recorded cost coverage. Missing costs no longer support an implied companywide profit claim. |
| F06 | Contract balance resembles invoice balance | Implemented | Financials identifies remaining contract value and unbilled work. Invoice amounts and due dates remain under Draws. Contract balances no longer imply invoice overdue status. |
| F07 | Health labels conceal delivery risks | Implemented | Customer overview shows the same recent scheduled-end signal as Today plus actual allocated overdue invoice balances. Failed reads and role limits are explicit. Relationship activity is separate from delivery review. |
| F08 | Report linkage count lacks scope | Implemented | Missing links count all fetched report history rather than the visible preview. AI and risk metrics state their history scope. Unavailable linked jobs have distinct wording. |
| F09 | Ambiguous field report job choices | Implemented | Searchable keyboard accessible job picker includes customer, project, address and stable reference. Notes distinguishes job lookup failure from a missing linked job and provides retry. |
| F10 | AI drafting unavailable | Needs production setup | Authenticated AI readiness checks, immediate manual writing, retained drafts and safe error recovery are implemented. Successful production generation still requires a configured provider key and live verification. |
| F11 | Estimates hides existing quotes | Implemented | Estimates opens a searchable quote document workspace with lifecycle filters, previews and clear creation routes. The builder is a separate New estimate view with preserved context. |
| F12 | See all hides unresolved work | Implemented | Today retains every action for See all instead of truncating at twenty. The wider dashboard prioritization and hero composition remain unchanged. |
| F13 | Competing navigation names | Implemented | Destination headings and command palette entries use Today, Jobs, Customers, Money, Reports and Estimates consistently. This was not an exhaustive terminology rewrite of every helper sentence. |
| F14 | Deeply nested job tabs | Implemented | One direct Job section selector replaces nested navigation on both layouts. Desktop adds frequent action shortcuts. Existing deep links map to leaf sections. Files and Photos retry preserve focus in their persistent section. |
| F15 | Scheduling omits allocation | Database validation required | Multi-member allocation, company-scoped availability, occurrence conflicts and manager controls are implemented. Missing schema disables allocation safely while unassigned scheduling remains available. Private reservation constraints and authorization triggers in supabase/migrations/20261027170430_schedule_crew_allocation.sql passed focused PostgreSQL role, parent-company, overlap and rollback checks. Full migration replay, simultaneous-session verification and application remain required. |
| F16 | Long record selectors | Implemented | Schedule, Notes and Compose share a searchable record picker with contextual labels, keyboard navigation and explicit selection. Search cancellation preserves the selected record. |
| F17 | Inflexible recurring events | Implemented | Recurrence accepts an interval and total visit count, previews dates and durations, and preserves local time across daylight saving changes. |
| F18 | Customer list ends at sixty | Implemented | All customers are reachable through Load more on both layouts. Search and filters remain in the URL; loaded windows and desktop sorting survive browser Back so scroll restoration has the necessary records. |
| F19 | Field report history inaccessible | Implemented | Complete paginated report history supports text, job, local date and linkage filters with full report expansion. The module explicitly covers reports captured by the current user; it does not imply access to other authors. |
| F20 | Empty Inbox offers no next step | Implemented | Empty Inbox explains message sources and links to writing a message. The reading panel no longer requests a nonexistent conversation. |
| F21 | Messaging split across tools | Implemented | Compose retains job context. Inbox and Compose share connected messages and recorded communication history with partial-source recovery. SMS and mail app handoffs require explicit confirmation to log and never imply delivery. Replies in external apps remain in those apps, as clearly explained. |
| F22 | Unorganized template browsing | Implemented | Templates support search, job type, units, dates, favorites and explicit reusable/imported reference categories. Personal preferences sync safely without overwriting concurrent settings changes. Template reads paginate and remain scoped to the active company. |
| F23 | Activity loses record identity | Implemented | Activity resolves linked jobs, leads and quotes to meaningful labels and destinations. Missing records use an honest unavailable fallback; historical snapshot storage was not added. |
| F24 | Activity periods mismatch dates | Implemented | Both layouts share calendar bucket logic instead of calling rolling seven and thirty day windows This week and This month. |
| F25 | Partner access summaries unclear | Implemented | Partners separates people and share counts, explains overlapping statuses, shows actual access beside each share and states that role labels do not change permissions. False claims about hiding customer and pricing information were removed. Directory reads paginate, remain company scoped and distinguish errors from empty results. |
| F26 | Forecast lacks supporting context | Implemented | Forecast shows provider, retrieval time, conditions timestamp, configured limits and advisory context. Missing required readings produce unknown status rather than an assumed go decision. |
| F27 | Desktop forecast clips final day | Implemented | Forecast cards wrap within a responsive grid, replacing the clipped horizontal strip. |
| F28 | Settings combines too many tasks | Implemented | Six URL-addressable settings sections have independent saves and retained drafts. Saves preserve newer typing and unrelated preferences. Legacy section links, optional setup wording and persistent save feedback remain supported. |
| F29 | Unnamed rate controls | Implemented | Trade fieldsets, associated labels and contextual unit, low price, high price and action names identify repeated controls. |
| F30 | Nested main landmarks | Implemented | Duplicate inner main wrappers were removed from affected screens. AppShell retains the page main landmark. |
| F31 | Inconsistent visual system | Implemented | Shared page patterns standardize workspace headings, spacing, cards, readable summaries and primary controls. Settings and job navigation use consistent direct destinations. Task-specific schedules, customer documents and Today retain appropriate compositions. See docs/design/page-patterns.md; no universal visual redesign or new quality score is claimed. |
| F32 | Dense helper text | Implemented | Settings and prominent instructions in Customers, Notes, Reports, Team and Compose use readable 14px helper text; editable controls use 16px where needed. Shared workspace captions use semantic contrast tokens. Small text remains for secondary timestamps and decorative details. Day/night token contrast and responsive checks accompany the change. |
| F33 | Editable fields resemble disabled fields | Implemented | Estimate scope and report capture use clearer editable surfaces, visible borders, accessible names and larger input text. |
| F34 | Import destination unclear | Implemented | Import links to Jobs filtered to Leads before and after import. Automation and developer instructions default to collapsed on both layouts. |
| F35 | Team roster fails to load | Needs production setup | Team adds a verified read-only roster fallback for authorized managers, complete pagination, timeout/retry and workspace race protection. Unknown invitations remain unknown. Full named roster, invitations and administrative writes still require correct hosting credentials and production verification. |
| F36 | Mobile proposal branding collapses | Implemented | Document headers stack responsively, contact details retain usable width and logos receive a separate backing surface. All five templates passed responsive checks; Mint and a transparent white logo were inspected in preview and the downloaded PDF. |
| F37 | Customer preview omits detailed scope | Implemented | Quote descriptions and notes flow through document mapping into preview and PDF rendering. Template regression tests and downloaded PDF inspection confirm detailed, optional and excluded scope survives. |
| F38 | Mobile calendar changes context | Implemented | Layouts share a Sunday week start. Mobile adds explicit week navigation, a fully visible week strip and access to unscheduled jobs. |
| F39 | Mobile financial meaning differs | Implemented | Responsive Reports use aligned won value, tracked profit and cost coverage definitions. Win and lost deal wording uses the stated reporting period. |
| F40 | Outdated mileage rate | Implemented | A central rate table selects the business rate by trip date, including both 2026 periods. Unknown years require verification instead of silently reusing a prior rate. |
| F41 | Missing phone leaves a dead end | Implemented | Leads without contact details link directly to customer editing for Add phone and Add address. Today offers Add phone for missing numbers, preserves follow up priority and refreshes its cache after a successful customer edit. |
| F42 | Quote lifecycle actions conflated | Implemented | Copying a share link does not mark a quote sent. Mark as sent is explicit, share cancellation preserves state, delete wording follows status, and absent written revision feedback is stated clearly. |

Additional discovered limitation: migrations 092 and 093 move quotes into `fh_quotes`, where access requires company membership and a role allowed to view money. Existing partner shares on the old contact do not grant access to that canonical quote. This predates these repairs. Shared jobs retain their existing partner access; this repair does not widen company filters or row level security to restore legacy quote sharing.

Additional repairs discovered during verification:

- Money's approval queue now reads canonical quote records, with company scope checks and explicit loading and failure states.
- Reopening a lost job requires evidence of a previous job stage and returns it to Jobs. Unverified legacy sales records do not silently become jobs.
- Mark as sent uses an atomic expected-status condition, rejects concurrent approval or revision changes, and reports success only after a confirmed write.
- PDF image loading has one deadline across fetching, reading and decoding, with a fallback and cleanup when an image stalls.
- The shared desktop Jobs layout is exempt from the older narrow-screen width cap.
- Global search waits for company resolution, clears previous company results immediately when scope changes, and rejects late responses from the previous company.
- Schedule company inheritance and crew allocation guards cover minimal lead and quote parent changes, including callers who own both companies.

Proposal previews, public links and PDF exports now share a stable issue date and reference year based on creation, with sent date as the legacy fallback. Sending, resending or exporting later no longer changes that date or reference year.

Second pass adds complete reconciliation, draft billing safeguards, direct job navigation, the Estimates library, personal template organization, searchable selectors, crew allocation preparation, focused settings, truthful partner access, unified recorded communications, report filters and stable document dates. Review also corrected stale-save races, mobile row semantics, hidden record caps, missing route permissions and all 13 preexisting hook warnings.

Verification for the second pass:

1. Final combined unit run: 1,441 tests passed across 148 files.
2. Lint passed with no errors or warnings. Application and tooling TypeScript checks, design and repository RLS audits, and the production build passed.
3. Browser inventory reconciled across 1,510 exact test identities: 1,074 passed, 436 intentional platform skips, zero unresolved failures or uncovered cases. Verification combines completed cases from interrupted runs and focused reruns after fixes; it was not one uninterrupted run. Desktop and phone layouts ran in Chromium 149. Fresh desktop, phone and 320px screenshots passed visual inspection. All writes used synthetic test data. Safari and Firefox were not exercised.
4. Both migrations passed 59 checks using actual PostgreSQL 18.6 through PGlite, including roles, RLS, triggers, exclusion constraints and rollback. This extends the initial 47 checks with canonical lead/quote inheritance regressions, including minimal parent updates, dual-company owners and the real event form's update shape. The focused synthetic schema and single connection do not verify the complete historical migration chain, simultaneous sessions or live Supabase. No live provider send occurred.

Release gates:

1. The 59 focused PostgreSQL checks passed. Complete historical migration replay in an isolated Supabase environment, simultaneous-session booking and billing probes, and staging role/API verification still gate both CLI-generated migrations, following docs/audits/sql/README.md. Apply through the established migration workflow before enabling crew allocation or claiming atomic billing protection.
2. Configure and verify the AI provider and Team hosting credentials using docs/operations/service-setup.md. Never put privileged credentials in browser variables.
3. Local browser verification is complete. Public source publication and a draft pull request were authorized on October 27, 2026. Run remote CI and perform production verification before release.
4. External SMS/mail app replies are not synchronized. Existing canonical quote access remains company scoped; partner job shares do not grant editing rights to canonical quotes. A customer review link is a separate workflow.
5. Provider email delivery and payment writes are separate operations. Fresh invoice revision checks protect changed invoices, but payment changes during PDF preparation still need release testing.

Release status: implementation verified locally; production remains unreleased. No production deployment, production database migration, customer message or live financial mutation was performed.
