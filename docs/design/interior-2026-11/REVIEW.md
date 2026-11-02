# FieldHorse interior workflows

November 2, 2026. Built on main `94666a9f05452d7fbfbe7c30c21acd8060587ece`, including merged PRs 235 and 236.

## Design direction

Higgsfield generated two reference studies using `gpt_image_2_5`, high quality, 2K, 16:9. They informed hierarchy, spacing, copper accents, quiet surfaces, and focused actions. The implemented screens use native React controls and saved records.

- [Today and job study](concept-1.webp), generation `4a08a8ab-24e2-417f-9901-f9f76f57509e`.
- [Schedule, quote and document study](concept-2.webp), generation `746260ba-6bc8-45ed-934a-c02d0b0cd6d3`.

Generated sample progress, project photos, financial values, and alternate branding were not placed into live workspaces. Company branding and existing permission gates remain authoritative.

## Implemented experience

| Area | Result |
| --- | --- |
| Today | Next stop includes project context and address. Open job and Navigate stay within reach. Attention items and week planning have clearer grouping. |
| Jobs | Visible New job action, grouped pipeline records, useful empty state, contextual help. |
| Job detail | Contact actions remain visible. One disclosure reveals scope, stage, and permitted financial details. |
| Schedule | New event becomes the primary action. Today sits beside date navigation. Phone content renders immediately without an entrance fade. |
| Money | New invoice, Quotes, and Reports remain visible. Upcoming invoices precede reconciliation on phones. Reconciliation links use compact labeled amounts. |
| Quotes | Company scoped inventory, customer/title/scope search, URL restored filters, status counts, expiry aware attention, retry and cached result states. |
| Customers | Contextual help explains customer and job relationships. Existing contact and merge workflows remain intact. |
| Setup | Keyboard accessible progress links reflect entered company, trade, and optional location details. Logo hints and service tiles use consistent contrast and spacing. |
| Learning | Owner/admin/manager checklist reads saved company, job, and upcoming visit records. Five captioned recordings use synthetic records. Direct guide links scroll to the requested lesson. |
| Photos | Batch feedback follows actual file processing. Existing upload, offline queue, and final success/error feedback remain in place. |
| Documents | White paper, default copper, and Manrope previews. Clear project heading, responsive item rows, and readable phone signatures. Company color overrides and selectable themes remain available. |

## Media

All five walkthroughs show actual browser interactions against isolated mock storage. They never send customer emails or write production records. Quote walkthrough saves a line and opens its customer preview. Billing walkthrough saves a $4,600 draft after verifying the job balance prefill. Existing job, day, and update recordings were refreshed.

MP4 exports use H.264, 720 by 1280, fast start, and no audio. Each has an optimized WebP poster and English WebVTT captions. Playback requires an explicit action, retains keyboard focus, and falls back to written steps on failure. Clips total approximately 1.7 MB. Every exported clip passed full decoding and contact sheet inspection.

## Verification

- Lint, both TypeScript configurations, design audit, and production build passed locally.
- Full unit run: 161 files, 1,542 tests passed.
- New browser coverage exercises quote search/filter recovery, saved record checklists, setup keyboard focus, role restrictions, creation entry points, date reset, actual photo writes, and 320px day/night controls.
- Existing Jobs, Job, Customers, Quotes, Schedule, Money, invoice PDF, delivery, and guide workflows were exercised on desktop and phone profiles. Updated legacy assertions reflect the single job disclosure, white document surface, and primary New invoice action. Browser CI remains the canonical result for the published commit.
- Visual inspection covered Today, Jobs, Job, Schedule, Money, Quotes, Customers, Learn, and Proposal preview at 390px, 1440px, 390px night, and 320px. Setup received separate day/night/320px inspection. The narrow schedule week strip intentionally scrolls horizontally to retain date targets.
- A real PDF download from the sample proposal was rendered and checked across both pages. Amount, customer, line item, terms, and exclusions survived export. HTML preview and PDF use separate existing layout renderers; this change does not claim pixel identical exports.

These checks use synthetic data. They do not prove production email delivery, payments, migrations, native store distribution, or deployment. Existing backend release blockers remain separate. Main remains unchanged until this PR merges.
