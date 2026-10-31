# Fieldhorse product re-audit — October 31, 2026

This is a review of the compiled React application, not a replacement prototype. The changes extend Workspace 06 across secondary screens and repair failures found while using the app. Existing job destinations and features remain available.

## Findings and repairs

| Finding | Repair |
| --- | --- |
| The phone week planner squeezed visits into seven narrow columns | A full-width agenda shows occupied days, complete visit titles, times, crew counts, and explicit editing/deletion. The date strip still opens any day. |
| Tablet review exposed faint 28-pixel Day-view controls and a dead tap on standalone visits | Day visits now use readable 44-pixel actions, full-width text, and keyboard-accessible editing for standalone events. A narrow-screen regression covers the actual controls and navigation. |
| An empty week consumed space before the next useful action | One honest empty state replaces seven empty day panels. |
| Phone range navigation competed with Today at 320 pixels | Today now sits beside the view controls; range arrows retain 44-pixel targets. |
| Reports gave small rounded totals precedence over financial evidence | Collected, issued, won, and pipeline amounts lead. Supporting business metrics and their explanations follow in open columns. |
| Secondary screens retained duplicate utility bars and heavy panels | Reports, Notes, Settings, Team, and Crew now share flatter sections, consistent headings, restrained controls, and clear disabled states. |
| Forecast placed a large source panel before current conditions | Temperature and current readings lead, followed by a compact source section with expandable timestamps and configured limits. |
| Forecast humidity overflowed at 320 pixels | Three equal minimum-zero columns keep labels and values visible; unnecessary metric cards and icons were removed. |
| Forecast still used a green gradient hero | Neutral typography and rules replace the decorative hero. Caution and adverse conditions retain semantic status labels. |
| Activity hid customer and job names in clipped single lines | Entries wrap full titles and context, separated by rules. |
| Payment entry crashed without native `crypto.randomUUID` | A shared secure UUID helper uses `getRandomValues` when needed. Payment intent IDs remain stable across retry attempts. Other unguarded document/upload/import call sites use the same helper. |
| Small shared phone buttons offered undersized hit areas | Shared action buttons now have a minimum height of 44 pixels on phones. |
| A second visual pass found dark text on copper actions despite correct shared tokens | Repaired legacy inline colors in Settings, uploads, imports, bids, tasks, job financial sections, clock-in, invitations, and error recovery. Day and night browser checks now measure Settings action contrast. |
| Payment method and kind used ten competing pill buttons | Two labeled native selectors retain every option and leave the complete payment form and primary action visible on a narrow phone. The fallback-ID regression also verifies the selected values are actually submitted. |
| Legacy specificity kept Settings panels and secondary rails boxed | Corrected the actual competing selectors, with underlined Settings navigation, ruled form sections, and open context rails. |
| A populated Crew schedule hid the Job action on narrow phones, and task rows could not be opened with a keyboard | Visits and completed shifts now use two-column phone layouts, all visit actions remain visible, and semantic task links support keyboard navigation. The regression includes long populated rows at 320 pixels. |
| The inbox view executed with its owner's access | The view now uses caller permissions so underlying row policies apply. Direct execution of a trigger-only security-definer function was revoked. |
| Routine CI omitted optional visual baseline checks | A normal-CI 37-route phone guard checks clipping, headings, runtime exceptions, and 16-pixel minimum form text. It does not depend on screenshot-baseline opt-in. |
| Previous database tests could not exercise overlapping transactions | CI now provisions disposable PostgreSQL 17 databases and tests two separate backends contending for the same billing balance and crew allocation. |

## Verification at source preparation

- 1,457 unit tests in 151 files passed locally.
- TypeScript, ESLint, design-token audit, RLS source audit, and compiled review build passed.
- 59 billing/schedule checks and 39 inbox security checks passed in local PGlite. Its single connection does not prove simultaneous transaction safety. The PostgreSQL CI step adds two real concurrency checks.
- CI for `b624096458f3` subsequently passed all 100 PostgreSQL checks, including both independent-backend contention cases, as well as all Node 22 source checks, 1,457 unit tests, and the production build. Follow-up visual/control changes require their own final CI result.
- Browser geometry review visited 37 phone destinations, including record details, secondary tools, and creation/payment/reminder forms, at a 320-pixel frame width. Activity, Forecast, and a later populated Crew state initially failed. Each was corrected and rechecked without overflow; Crew also passed keyboard task navigation and a populated shift-history review.
- Visual review covered the revised Today, Schedule, Reports, Activity, and Forecast hierarchy. Follow-up review and automated results are recorded in the PR checks and description.
- Browser review uses synthetic records and a simulated session. Review writes do not touch customer data. Local Node is 24.22; CI uses the repository's required Node 22.

The preceding commit `b764c7fff656` passed 1,084 browser tests with 438 skips. Those results do not certify this follow-up. Of the previous skips, 128 came from the optional visual-baseline suite and two from an unconfigured authenticated smoke test; the remainder were platform-specific. No existing test was disabled for this repair.

## Live security repair

The narrow `inbox_invoker_security` migration was applied to the connected Fieldhorse database after isolated testing. Read-only verification confirmed `security_invoker=true`, anonymous and authenticated direct execution of the trigger function denied, and the trigger still enabled. A fresh security advisor returned no ERROR findings; the view error and trigger-execution finding were gone.

This does not imply all advisory warnings are resolved. Authenticated security-definer application functions require their intended access checks; they were not indiscriminately disabled. Leaked-password protection remains disabled. The four server-only tables without client policies remain intentionally inaccessible to client roles.

## Release boundaries

UI/source changes are prepared for draft PR #230; they are not a production release. The inbox security migration above is the sole live database change in this re-audit.

The earlier invoice-billing and crew-allocation migrations are not applied to production. A complete historical schema replay, staging API validation, real-provider messaging/AI/roster checks, and physical-device testing remain unverified. The protected Netlify preview could not be inspected in this session. These are concrete release gaps, so this report does not assign an unsupported universal “10/10.”

No new screenshots are uploaded to the public repository by this change. Existing repository screenshots predate this pass.
