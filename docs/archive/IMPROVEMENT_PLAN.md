# Fieldhorse v2 — Improvement Plan (larger changes needing approval)

Companion to `AUDIT_REPORT.md` (June 11, 2026). Everything here either changes product behavior,
breaks an external contract, or is a major dependency/infra move — none of it was applied in the
audit-hardening pass. Ordered by recommended sequence.

## 1. Mobile release coordination for the auth requirement (immediate)

The hardening pass made `/api/send-*`, `/api/docusign-send`, and `/api/claude` require a Supabase
bearer token. Web deploys atomically; **old mobile binaries will get 401s** on those features.
- Action: cut an EAS build from this branch and release before/with the Netlify deploy, or stage the
  server change behind a short grace window (accept-but-log missing tokens for N days) if an old
  install base matters.
- Rollback: revert the five function files; clients sending the header are forward-compatible.

## 2. Rate limiting on anonymous endpoints

`public-link`, `public-link-approve`, `org-invite-accept`, `partner-invite-accept`, `webhook-lead`.
- Options: Netlify Rate Limiting (platform), an edge function with a token bucket, or a Supabase
  `rate_limits` table keyed on IP+route (cheap, no new infra).
- Decide alerting: log + 429 after N/min.

## 3. Account deletion re-authentication (UX + auth change)

`delete-account.js` currently purges everything on a valid (≤1 h) access token. Add password
re-entry (`signInWithPassword` server-side) or an emailed confirmation link with a 24 h token.
Touches Settings UI copy + flow. Apple's account-deletion requirement is still satisfied either way.

## 4. webhook-lead HMAC (breaking for integrations)

Add an `x-webhook-signature` HMAC (pattern already exists in `docusign-webhook.js`). Breaking for
any Zapier/GoHighLevel configs that only know the URL key — needs: a per-tenant secret surfaced in
Settings, a migration window where both schemes are accepted, then enforcement.

## 5. CORS origin pinning

Replace `Access-Control-Allow-Origin: *` with an allowlist (prod domain + deploy previews + local
dev). Requires confirming the legitimate origin set with the owner. Native mobile is unaffected
(no CORS in RN fetch).

## 6. Bundle/performance program

- `manualChunks` vendor split in `vite.config.js` (react/router/query; motion+vaul; supabase).
  Target: main chunk < 170 KB gz.
- Convert `src/lib/pdf.js` consumers to `await import(...)` at the click handler (drops the 430 KB
  pdf chunk + 201 KB html2canvas from any eager path; they are route-lazy today but still load with
  their screens).
- Replace the recharts-based sparkline with a hand-rolled SVG polyline; keep recharts only on
  Analytics.
- Re-measure with `vite build` + Lighthouse on a throttled profile after each step.

## 7. Major dependency upgrades (clears the remaining 6 npm advisories)

| Package | From → To | Risk | Verification |
|---|---|---|---|
| `jspdf` (+`jspdf-autotable`) | 2.5/3.8 → 4.2/5.0 | **High** — API changes in text/measurement APIs; affects every PDF (proposal, invoice, certificate, draws) | Render each template via `scripts/qa-render-proposal.mjs` + manual visual pass |
| `vite` (+`vite-plugin-pwa`) | 5.4/0.20 → 8.x/1.3 | Medium — config + plugin API churn; PWA regen | `npm run build`, install-and-update SW test on a deploy preview |
| `react-router-dom` | 6 → 7 (optional) | Medium | Not advisory-driven after the audit-fix; defer |

Do these as separate PRs, jspdf first (it's the critical advisory).

## 8. TypeScript & lint debt

- Flip `checkJs: true` file-by-file (`// @ts-check`), starting with `src/lib/pdf.js`.
- Tighten ESLint: enable `react-hooks` rules (dep arrays) and `no-unused-vars` via typescript-eslint;
  fix fallout incrementally.
- Add `@types/papaparse`, drop the `@ts-ignore` in `Importer.tsx`.

## 9. Monolith screen decomposition (carried from prior audit, FH-001..004)

`Home.tsx` (1.7k lines), `ClientDetail.tsx`, `Quote.tsx`, `Notes.tsx`, `Settings.tsx`: extract data
hooks + pure composition functions (`composeNextActions` first — it's the most test-worthy). No
behavior change intended; do one screen per PR with snapshot coverage where feasible.

## 10. Offline write queue (product decision)

Field crews lose writes (photos, notes, payments, stage moves) without signal. IndexedDB outbox with
idempotency keys draining on `online`. Significant build (~1–2 weeks) and a prerequisite for any
App Store wrapper story (see prior audit FH-058/FH-077).

## 11. Data-model / migration items

- One migration: pin `search_path` on `fh_resolve_account_labels(uuid[])` and
  `fn_recalc_contact_amount_from_items()`; correct the 045 `logos` → `company-logos` policy name.
- No destructive changes anywhere in this plan; all migrations remain additive/idempotent.
- Rollback plan: every migration in this repo is `IF EXISTS`-guarded; reverting = restoring the
  previous policy/function definitions (kept in git).

## 12. Privacy/compliance copy

Disclose the e-sign evidence capture (IP + user agent on proposal approval) in the public document
footer and `Privacy.tsx`. Decide retention for `client_ip` columns.

## 13. Housekeeping

- Move Apple ID / Team ID out of `mobile/eas.json` into EAS env (owner's call — changes submit flow).
- Remove stray design PNGs from `public/` (they ship to prod).
- Fold `SHIP.md` / `DEPLOY_CHECKLIST.md` / migration docs into `docs/`.
