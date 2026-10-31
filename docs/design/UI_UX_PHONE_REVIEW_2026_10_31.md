# UI and UX phone review

October 31, 2026. Scope: interface presentation and interaction. This pass changes no Supabase schema, access policy, account configuration, or production deployment.

## Reproduced issues and corrections

| Observed issue | Correction |
| --- | --- |
| Today placed its date and sync status behind the sticky header | Removed the obsolete negative stage offset for Workspace 06 |
| Tasks retained a five column desktop table on narrow phones; assignment fields collapsed to 18 pixels | Full task text, named job links, labeled assignment controls, clear completion actions, and 44 pixel deletion targets |
| Completing a dashboard task removed it without feedback or Undo | Completion confirmation, focus recovery, and Undo after a confirmed update; refused writes restore the list |
| Task summary cards and duplicate utilities displaced the actual work | Compact ruled counts, one heading, one creation action, and one labeled filter |
| Tasks could shrink to a narrow column on wide desktops when little content was present | Explicit workspace width, including the empty state |
| Dashboard composer styles shared a selector with the job task form | Scoped dashboard composer rules so they cannot alter the job form after navigation |
| Task composer relied on placeholders and an unlabeled task field | Persistent labels, native form submission, visible required fields, and explicit empty job guidance |
| A saved assignee missing from the member list displayed as Unassigned | Preserve a visible option for the existing assignee |
| Failed creation left users beside Save while corrections remained offscreen | Focus and reveal the first invalid field or save error after every submit attempt |
| Nine job type buttons competed with creation fields | Native labeled selectors for long optional choice lists, including a clear option |
| Customer suggestions did not support arrow selection or Escape and concealed useful identity details | Active option tracking, keyboard selection, dismissal, and visible phone or email and address |
| Date strip and several navigation controls fell below 44 pixel targets | Minimum target sizes, horizontal date scrolling at narrow widths, and automatic horizontal reveal of selected dates |
| Ready to bill showed Remind and described contract value as money owed | Invoice action label and contract balance wording |
| Landing heading matched body size; gold frames and gradients conflicted with Workspace 06 | Clear type hierarchy, restrained copper actions, neutral rules, readable sample workspace, and semantic navigation links |
| Personal founder story remained in public marketing | Entire founder story and attribution removed; no personal founder framing remains in the landing page |
| Canceling the task composer left focus on the page body | Restore focus to New task after cancellation or a successful creation |
| Deleting a task left keyboard focus on the page body, including after Undo | Move focus to the task heading so Undo restores a stable place in the workspace |
| Partner filters, message channels, estimate trades, and several job actions measured 18 to 36 pixels high | Larger shared filter controls and 44 pixel targets for the affected job actions |
| Estimate job type choices consumed several rows; target margin had no accessible name | Native optional job type selector, labeled margin slider, percentage announcement, and keyboard operation |
| Expanding a selection created a five column form reaching 587 pixels across a 320 pixel phone | Responsive option groups with persistent field labels in both create and edit flows |
| Daily log fields depended on disappearing placeholders | Persistent labels, standard fields, and wrapping actions |
| Selection Save issued separate updates, immediately reported success, and closed before results arrived | One confirmed update for title and options, a pending state, and preserved edits with a focused persistent error on refusal |
| Selection and material prices rounded away cents | Exact currency rendering for option prices, unit costs, and material totals |
| Job task dates and loading photo tiles lacked reliable accessible names | Task-specific date labels and explicit photo button labels |
| Closing expanded job forms stranded keyboard focus; financial view tabs lacked arrow navigation | Focus restoration for selections, daily logs and material panels, plus shared tab keyboard behavior |
| Crew search showed quote and invoice amounts and customer-directory links despite the job screen hiding money | Phone and desktop search now skip inaccessible record queries, omit job amounts for field roles, wait for membership, and discard results after a workspace or role change |
| Search Retry recovered results but left keyboard focus on the page body | Restore focus to the search field before retrying; retain the query in phone search and the desktop palette |

## Verification

Compiled application reviewed with isolated synthetic records through an internal browser preview. No review writes reach customer accounts.

* Checked element bounds on 37 core destinations at a 320 pixel frame width. No elements extended beyond the content boundary, excluding intended horizontal scroll containers.
* Reproduced invalid job submission, verified focus returns to Client and its correction appears below the sticky header.
* Verified customer suggestions respond to arrow keys and Enter without submitting the job form.
* Confirmed Today date starts below the header after correction.
* All 1,489 unit tests passed. TypeScript, ESLint, design system audit, and production build passed locally.
* Added fourteen browser regressions, each running in both configured browser projects. They cover narrow geometry, long task text, desktop empty-state width, form error recovery, customer selection, schedule targets, completion feedback and Undo, refused update recovery, public entry navigation, accessible estimate controls, expanded job forms, selection save feedback, and search permissions during role changes. GitHub CI reports execution separately from this local review.
* The second review covered the 37 core destinations plus 11 additional forms and 18 job section views. Expanded selection, daily log, material and change order forms were also exercised at 320 pixels. The selection overflow and small controls were reproduced before correction and remeasured afterward.
* Verified a refused selection save against the compiled application: the entered title remained intact, no success appeared, the editor stayed open, and focus moved to persistent recovery text. Selection and material edits were isolated from real accounts.
* Day and Night contrast spot checks covered 128 text elements in each theme across seven core views, with no low contrast results among the opaque color pairs measured. This is not a complete WCAG certification. Short-height and landscape forms, photo viewer dismissal, and completion/deletion Undo focus were also checked.
* Reproduced the search visibility issue with a synthetic crew role. Seven new unit cases cover allowed financial roles, restricted queries, omitted amount columns, missing membership, and search failure. Browser regressions also hold an old financial response while changing role to verify it cannot restore stale results. These tests do not establish actual server-side data disclosure or certify real account RLS.
* Full CI on the preceding PR head `50fb32a282fb92b43270855ea115cf32860bc293` passed 1,135 browser cases and 1,482 unit tests. The PR checks identify the results for the follow-up commit; earlier results do not certify later changes.

UI review uses synthetic data and browser phone frames. Physical Safari keyboard behavior, touch hardware, real account integration, and previously recorded backend release gaps are not certified by this work. Merge and production deployment remain with the owner.
