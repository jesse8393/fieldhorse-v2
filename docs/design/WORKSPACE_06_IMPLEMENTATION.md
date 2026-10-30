# Workspace 06 implementation

Reviewed October 30, 2026. This is the actual React application adapted to the approved Workspace 06 direction. The separate design prototype is not the production application.

## Result

The job opens with assigned work and the next scheduled visit. Site photography and recent activity provide context alongside that work. On a phone, the same content follows a single column, with customer details in a disclosure and the existing capture and stage actions available at the bottom.

Manrope replaces the previous mixed type families. Neutral white, charcoal, and restrained copper define the hierarchy. The header carries the workspace identity and navigation. Glass is limited to floating controls and the photograph caption. Money summaries use typography and dividing rules rather than nested cards.

## Functional boundaries

- All 18 job sections retain their routes and role filtering: Activity, Daily logs, Milestones, Tasks, Schedule, Inspections, Selections, Materials, Contract balance, Invoices, Expenses, Subcontractors, Change orders, Insurance, Photos, Files, Messages, and Partner access.
- The overview uses existing task records and resilient mutations. Completing a task offers Undo and moves focus to the task heading. Failed task reads show Retry, not an empty job claim.
- The full task editor retains creation, due dates, assignment, completion, deletion, and deletion Undo. Mutations refresh parent job data.
- Photo URLs still come from the existing signed URL query. Failed photos are omitted. The highlighted photo opens Photos and is not repeated in the activity list.
- The next visit is computed from actual schedule records. Remaining history and job tools are accessible through their existing controls.
- Company switching, workspace permissions, search, keyboard shortcuts, capture, billing, and communication handlers remain connected. No database schema, authentication, RLS, or financial calculation changes are included in this iteration.

## Issues found and repaired during review

| Finding | Correction |
| --- | --- |
| Phone task descriptions were squeezed between metadata and small controls | Task text has its own grid column, metadata moves below, controls have targets of at least 44 pixels |
| Legacy section wrappers consumed the phone's usable width | Removed redundant panel borders, shadows, and stacked padding |
| Materials used a fixed six column composer and rows even on a narrow phone | Layout now responds to its container, with labeled inputs and a two column narrow layout |
| Shared font and palette changes could produce a mismatched first paint | Local font preload and matching theme colors; updated the inline script CSP hash |
| Money summaries repeated nested cards | Replaced those frames with rules and made New invoice the primary action |
| A broad chrome selector hid customer search, Edit, and Delete | Narrowed the selector to redundant chrome; real inputs and record actions remain visible |
| Clearing customer search immediately after a filter could reset that filter | Consecutive updates use the current browser URL, preserving both controls |
| Money columns clipped long balances and payment actions at middle widths | Reserved amount and action widths and gave age totals their own row when space is tight |
| Inbox composers could extend below the viewport | Removed duplicated shell padding and the extra phone header while a thread is open |
| Desktop replies and outgoing messages ended at different horizontal positions | Composer and messages now share a centered width and matching gutters |
| Inbox navigation looked like three competing actions | Conversations and History use underlined navigation; New message sits beside the page title, with a 44-pixel target |
| Photo controls sat behind navigation and lacked keyboard containment | Moved the viewer to a document portal, locked background scrolling, trapped focus, and restored focus on close |
| The photo editor presented thirteen scope buttons at once | Replaced the button wall with a labeled native selector, retaining custom sections and automatic saving |
| Authentication waited for an obsolete display font | Uses the local Manrope identity immediately, including loading, failed-font, and delayed-font states |
| Password reset and partner invitations inherited old warm colors | Neutral dark-surface tokens now match sign in and the rest of the workspace |
| Customer records retained boxed metrics, heavy shadows, and a decorative map | Introduced aligned metric columns and ruled sections, a direct Maps link, one prominent creation action, and 44-pixel record controls |
| Unbilled customer value was labeled as money owed | Phone customer summaries explicitly say Contract balance; calculations remain unchanged |
| Review criteria competed with actual customer blockers | Moved criteria into an accessible disclosure while preserving visible overdue invoice and schedule links |

## Verification

Local TypeScript, ESLint, design audit, RLS audit, production build, and all 1,443 unit tests passed. The browser suite contains 1,516 cases in 50 files, including regressions for task completion and Undo, task creation after reload, failed task reads, and narrow Materials layouts. CI runs the complete desktop and phone projects in separate jobs on Node 22. No tests were disabled to accommodate the redesign. The [PR checks](https://github.com/jesse8393/fieldhorse-v2/pull/230/checks) record the actual execution outcome for each published commit.

The first full browser run exposed 68 failures. Each was reviewed against its trace or screenshot. The next published run reduced this to seven failures: customer filter state, desktop reply alignment, a login overflow fixture, and two authentication color checks on each viewport. This local repair addresses those findings; its full browser rerun awaits publication. Repairs address hidden controls, overlays, overflow, and loading geometry; outdated brand and layout assertions now check the approved identity and preserved interactions. The task-read failure fixture now lets the parent job load before failing the independent task request, and the Materials fixture uses the real `contact_id` relationship.

The actual compiled React components were reviewed in the browser using an isolated synthetic data fixture. The fixture and its authentication seed are excluded from Git and production builds. No review mutations were sent to a real Supabase project.

Browser review covered:

- All 18 job sections at 320 pixels, inspecting element bounds rather than relying only on document scroll width. Materials initially failed this check; the repaired composer has its rightmost control at 268 pixels inside a 305 pixel content viewport, with 50 pixel control heights.
- The job overview at 390, 1024, and desktop width. The tablet check found no elements beyond the content boundary.
- Task completion, focus recovery, Undo, reopening, creation, and reload persistence against the controlled stateful fixture.
- Desktop Today, Schedule, and Money; day and night appearance for the job workspace.
- Customer search and the Edit/Delete controls; customer records at desktop and 320 pixels, including individual control bounds. Clearing search after selecting Active preserves the filter. Phone and email fields stack at narrow widths, measuring 257 pixels with 16-pixel text in the 320-pixel review frame.
- Photo viewer opening above navigation, scope selection, keyboard containment, Escape, and return focus to the originating photo.
- Signed-out desktop and phone layouts, the real local font, field and button geometry, and sign-out synchronization between the review tabs.
- Inbox thread headers and composer visibility on desktop and phone, using isolated conversation fixtures. Desktop message and composer columns share 760-pixel widths; document height matches the 936-pixel viewport. History and New message navigation work at 320 pixels without overflowing controls.

Local checks ran on Node 24.22.1. The repository specifies Node 22 and CI uses Node 22. Browser screenshots and automated synthetic-data tests do not establish real-account integration or field use on physical phones; those remain release validation.

## Contrast spot checks

The existing text and control contrast thresholds remain unchanged. The tests resolve the shared color tokens in both themes.

| Pair | Approximate ratio |
| --- | ---: |
| Primary text on white | 16.3:1 |
| Muted text on white | 6.1:1 |
| White text on copper hover | 7.6:1 |
| Light text on charcoal | 16.9:1 |
| Secondary light text on charcoal | 8.0:1 |
| Night muted text on tray | 6.3:1 |
| Strong control edge on white | 3.7:1 |

## Evidence

Screenshots show the compiled application with synthetic review records and an illustrative site photo. They are not screenshots of a deployed customer account.

![Desktop job workspace](workspace-06/desktop.jpg)

[Phone job workspace](workspace-06/phone.jpg) · [Money workspace](workspace-06/money.jpg) · [Customer record](workspace-06/customer.jpg) · [Inbox](workspace-06/inbox.jpg) · [Photo viewer](workspace-06/photo.jpg) · [Sign in](workspace-06/login.jpg) · [Section bounds audit](workspace-06/section-audit.json)

Jesse approved publication to draft PR #230 on October 30, 2026. This change has not been merged or released to the Netlify production app. Review the current PR checks before merging.
