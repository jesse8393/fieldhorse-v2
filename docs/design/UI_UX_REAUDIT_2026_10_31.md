# Workspace 06 UI/UX follow-up audit

Baseline: merged PR #232, commit `bde43aa6d846b06ebb8478023227bf8e413e5414`.

This pass continues the phone review in `UI_UX_PHONE_REVIEW_2026_10_31.md`. It reviews the actual React implementation and an isolated compiled build. Browser records and permission failures are synthetic; no production records, backend settings, or database policies were changed.

## Reproduced problems and corrections

| Flow | Observed problem | Correction |
| --- | --- | --- |
| Edit a job's linked customer | Enter did nothing on Unlink. Pointer activation retained the old customer pill, preventing replacement. | Native button activation; explicit unlinked state; focus moves into search and returns to the selected customer control. |
| Customer selection | Unlink measured 28 × 28 CSS pixels. Selection and errors lacked a consistent keyboard path. | 44 × 44 unlink, 16px input, labelled combobox, arrow/Enter/Escape selection, readable customer details and wrapping names. |
| Customer lookup failure | Failed reads could appear empty, and failed search could still offer Create. | Distinct error and loading states, keyboard-accessible Retry, and no creation until the full lookup succeeds. |
| Delayed reads | The original customer request could overwrite a subsequent unlink or replacement. | Cancel stale reads; scope suggestions to the current user/workspace and retry generation. |
| Edit save failure | Only a transient toast described refusal. | Persistent focused error; preserve typed fields; lock controls during the confirmed save; restore heading focus on save/cancel. |
| Edit validation | Button-only submission bypassed native email validation and Enter. | Semantic form; native email validation; decimal amounts remain valid; customer-search Enter never accidentally submits the job. |
| Field-role edit | Customer-book controls could be offered to roles without customer-book access. | Use existing route permissions for customer linking and hydration; preserve existing financial permissions. |
| Creation suggestions | A failed or limited recent-client read could claim a typed customer was new. | Honest save-time matching copy; visible retryable suggestion errors; scoped read snapshots. |
| Subcontractor profile | Missing or failed profile reads left Save in an endless busy state; the empty state included an unnamed retry button. | Separate disabled and saving states, remove the empty retry control, and retain a named keyboard retry for actual read failures. |

## Verification

Compiled phone checks reproduced the old unlink failures, then confirmed keyboard unlink, customer selection, restored focus, 44px targets, permission-filtered editing, and a focused save-refusal error with the draft intact. Layout checks include a 320px frame. These checks do not establish physical iPhone behavior.

The fresh route pass covered 56 page states at 320px, including creation forms, job and invoice actions, quote documents, customer statements, and the subcontractor profile. It checked actual element bounds rather than relying on document width, which global clipping can conceal. All 18 job sections were opened after their loading state cleared. Short-phone, landscape, and desktop edit views were also inspected. Landscape exposed 14px job-edit fields; these now stay at 16px across widths.

`customer-link-edit.spec.ts` adds ten browser scenarios in each desktop/phone CI profile. They cover replacement and unlink after reload, preserved typed details, refused reads and writes, repeated retry focus, zero-row update refusal, delayed original-customer reads, matching beyond the recent list, decimal/email validation, creation pending/error states, crew/foreman restrictions, and creation suggestion recovery. Stateful fixtures verify submitted payloads and read-after-reload behavior.

The new file runs in the early CI regression step. The remaining application suite still runs in full; only the already-executed files are excluded from the second step. Final CI status and exact counts belong to the pull request and must be checked against its current head, not an older notification.

Two additional mobile UI regression scenarios cover missing subcontractor profiles and failed-read recovery. Both run in each browser profile.

## Deployment and remaining limits

The public page at `https://animated-kheer-db7c2c.netlify.app/` reported `fh-build` as `0d1866bf2ccd · 2026-10-31T22:35:11.892Z`, including after one reload. That observation identifies the PR #231 build, not merged PR #232 or this follow-up. Founder content remained absent. Do not equate a merge or a ready preview notification with production publication.

No protected Netlify preview was accessed. Real Supabase account integration, actual deployed grants and storage policies, external message delivery, and physical-device Safari/camera/keyboard behavior remain unverified. A passing synthetic browser suite is a UI regression result, not production release approval. Production publication remains with the owner.
