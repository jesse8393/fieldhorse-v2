# UI and UX phone review

October 31, 2026. Scope: interface presentation and interaction. This pass changes no Supabase schema, access policy, account configuration, or production deployment.

## Reproduced issues and corrections

| Observed issue | Correction |
| --- | --- |
| Today placed its date and sync status behind the sticky header | Removed the obsolete negative stage offset for Workspace 06 |
| Tasks retained a five column desktop table on narrow phones; assignment fields collapsed to 18 pixels | Full task text, named job links, labeled assignment controls, clear completion actions, and 44 pixel deletion targets |
| Task summary cards and duplicate utilities displaced the actual work | Compact ruled counts, one heading, one creation action, and one labeled filter |
| Task composer relied on placeholders and an unlabeled task field | Persistent labels, native form submission, visible required fields, and explicit empty job guidance |
| A saved assignee missing from the member list displayed as Unassigned | Preserve a visible option for the existing assignee |
| Failed creation left users beside Save while corrections remained offscreen | Focus and reveal the first invalid field or save error after every submit attempt |
| Nine job type buttons competed with creation fields | Native labeled selectors for long optional choice lists, including a clear option |
| Customer suggestions did not support arrow selection or Escape and concealed useful identity details | Active option tracking, keyboard selection, dismissal, and visible phone or email and address |
| Date strip and several navigation controls fell below 44 pixel targets | Minimum target sizes, horizontal date scrolling at narrow widths, and automatic horizontal reveal of selected dates |
| Ready to bill showed Remind and described contract value as money owed | Invoice action label and contract balance wording |
| Landing heading matched body size; gold frames and gradients conflicted with Workspace 06 | Clear type hierarchy, restrained copper actions, neutral rules, readable sample workspace, and semantic navigation links |
| Personal founder story remained in public marketing | Entire founder story and attribution removed; no personal founder framing remains in the landing page |

## Verification

Compiled application reviewed with isolated synthetic records through an internal browser preview. No review writes reach customer accounts.

* Checked element bounds on 37 core destinations at a 320 pixel frame width. No elements extended beyond the content boundary, excluding intended horizontal scroll containers.
* Reproduced invalid job submission, verified focus returns to Client and its correction appears below the sticky header.
* Verified customer suggestions respond to arrow keys and Enter without submitting the job form.
* Confirmed Today date starts below the header after correction.
* All 1,482 unit tests passed. TypeScript, ESLint, design system audit, and production build passed locally.
* Added six browser regressions, each running in both configured browser projects. They cover narrow geometry, long task text, form error recovery, customer selection, schedule targets, and public entry navigation. GitHub CI reports execution separately from this local review.

UI review uses synthetic data and browser phone frames. Physical Safari keyboard behavior, touch hardware, real account integration, and previously recorded backend release gaps are not certified by this work. Merge and production deployment remain with the owner.
