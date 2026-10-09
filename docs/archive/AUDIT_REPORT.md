# Fieldhorse v2 — Full App Audit (June 11, 2026)

Audit of the entire repository at commit `3287d19` on branch `claude/fable5-audit-hardening-7oua1v`.
Scope: web PWA (`src/`), serverless backend (`netlify/functions/`), database (`supabase/migrations/`),
Expo mobile app (`mobile/`), build/CI/deploy config. 419 tracked files; every directory was inspected
(deep file-by-file review of all 26 Netlify functions, all 46 migrations, all of `src/lib` + `src/contexts`,
all screens/components, and the mobile app; binary assets in `public/` and `mobile/assets/` were
inventoried but not byte-inspected — they are icons/images only).

This is the third audit pass on this codebase (see `FIELDHORSE_AUDIT.md` from an earlier session and
audit commits #190–#194). Items already fixed in those passes (security headers, runtime caching,
manifest identity, Suspense fallbacks, payment auto-close guard) were re-verified as fixed and are not
re-reported here.

---

## 1. Executive summary

The codebase is in **good structural shape**: typecheck, lint, all 53 unit tests, and the production
build pass on a clean tree; the database layer has comprehensive org-scoped RLS with no cross-tenant
gaps found; React data-layer patterns (React Query, realtime cleanup, error boundaries) are sound.

The serious problems were concentrated in the **Netlify functions layer**:

1. **CRITICAL — open email relay.** `send-message`, `send-quote`, `send-invoice`, `send-certificate`,
   and `docusign-send` accepted a client-supplied `sender_user_id` with **no authentication of the
   caller whatsoever** (no Authorization header read at all). Anyone on the internet could send
   white-labeled email (or DocuSign envelopes) as any tenant. **Fixed in this pass.**
2. **CRITICAL — open Anthropic proxy.** `/api/claude` forwarded any unauthenticated request to the
   Anthropic API with caller-controlled `model` and `max_tokens` — an open invitation to drain the
   API budget. **Fixed in this pass** (Supabase JWT now required; `max_tokens` capped at 8192;
   message count capped).
3. **HIGH — imminent AI breakage.** Every Claude call defaulted to `claude-sonnet-4-20250514`, which
   is deprecated and **retires June 15, 2026 (4 days from this audit)**. All AI features (Notes
   parsing, Bid estimates, Compose, Importer mapping, doc intelligence) would have started returning
   404s. **Fixed in this pass** (default is now `claude-sonnet-4-6`, the documented drop-in
   replacement).
4. **Dependency debt.** 15 npm vulnerabilities at baseline (1 critical). Semver-compatible fixes
   applied (15 → 6); the remaining 6 all require major upgrades (`jspdf` 2→4, `vite` 5→8) and are
   scheduled in `IMPROVEMENT_PLAN.md`.

**Current health score: 78/100** (was ~62 at the start of this pass).
Deductions: remaining major-version dependency vulns (−6), no rate limiting on public token
endpoints (−4), bundle size / no vendor splitting (−4), no offline write queue for a field app (−3),
accessibility gaps on icon-only buttons (−2), thin lint config and `checkJs:false` migration debt (−3).

---

## 2. Stack summary

| Layer | Technology |
|---|---|
| Web app | Vite 5 + React 18 (TS, `strict`, JS interop allowed), react-router-dom 6, TanStack Query 5, Radix UI/shadcn, framer-motion 11, vaul, Tailwind 4 (PostCSS), PWA via vite-plugin-pwa 0.20 (Workbox) |
| Backend | Supabase (Postgres + RLS + Auth + Storage + Realtime), project `pnmhblvslftdzfcdezbw` |
| Serverless | 26 Netlify Functions (esbuild bundler, Node 20) — email (Resend), DocuSign, Anthropic proxy, org/invite/punch admin, public links, account deletion |
| AI | Anthropic Messages API via `/api/claude` proxy; model `claude-sonnet-4-6` (after this pass) |
| Mobile | Separate Expo 54 / React Native 0.81 app in `mobile/` (own lockfile), EAS build via `.github/workflows/eas-build.yml` |
| PDF | jspdf 2.5 + jspdf-autotable 3.8 (+ html2canvas chunk) |
| CI | GitHub Actions: `npm ci` → `tsc --noEmit` → `vitest` → `vite build` on PRs + main |
| Hosting | Netlify (SPA redirect, security headers present, immutable asset caching) |
| Tests | Vitest 4, 7 files / 53 tests, pure-logic only (stages, rollups, dueDate, jobHealth, jobNextAction, stageWorkspace, format) |

External services: Resend (email), DocuSign (e-sign), Anthropic (AI), Open-Meteo-style weather
(`src/lib/weather.ts`), Google Fonts. No payments processor (payments are manually logged), no
analytics SDK, no tracking.

---

## 3. Commands run (baseline → final)

| Command | Baseline result | After fixes |
|---|---|---|
| `npm ci` | OK | — |
| `npx tsc --noEmit` | OK (0 errors) | OK |
| `npx eslint .` | OK (0 errors; config intentionally permissive) | OK |
| `npx vitest run` | 53/53 passed | 53/53 passed |
| `npm run build` | OK; warning: main chunk 817 KB (240 KB gz) | OK; same warning |
| `npm audit` | **15 vulns** (1 critical, 4 high, 10 moderate) | **6 vulns** (1 critical `jspdf`, 1 high `jspdf-autotable`, 4 moderate — all need major bumps) |
| `npm audit fix` (no `--force`) | — | applied; lockfile-only change |

No flaky or failing tests were observed.

---

## 4. Findings

Severity legend: **C**ritical / **H**igh / **M**edium / **L**ow. ✅ = fixed in this pass.

### Critical

**C1 ✅ Unauthenticated email relay (5 functions).**
- Evidence: `netlify/functions/send-message.js` (no auth read anywhere in the 243-line file; ownership
  "check" at old L104–113 filtered by the *client-supplied* `sender_user_id`), same pattern in
  `send-quote.js`, `send-invoice.js`, `send-certificate.js`, `docusign-send.js`. `send-message`
  didn't even require a `contact_id`, so a single POST with any victim's user UUID sent arbitrary
  white-labeled email to any address.
- Impact: spam/phishing relay under tenants' company names; DocuSign envelope abuse; Resend account
  reputation damage.
- Root cause: functions trusted `sender_user_id` from the request body; the service-role client
  bypasses RLS so the `eq('user_id', sender_user_id)` filter authenticated nothing.
- Fix applied: each function now requires `Authorization: Bearer <supabase access token>`, validates
  it via `supabase.auth.getUser(token)`, and rejects when `token user ≠ sender_user_id` (401/403).
  All 7 web callsites and 3 mobile callsites now attach the session token
  (`src/lib/supabase.ts → authHeaders()`, `mobile/lib/sendDocs.ts`).
- Regression test suggestion: integration test hitting each endpoint without a token (expect 401),
  with a token for user A and `sender_user_id` B (expect 403), and the happy path (expect 200).

**C2 ✅ Unauthenticated Anthropic proxy with caller-controlled spend.**
- Evidence: `netlify/functions/claude.js` (old L23–49) — no auth, caller-controlled `model`,
  `max_tokens` uncapped, CORS `*`.
- Impact: anyone could burn the Anthropic budget / exhaust rate limits at will.
- Root cause: proxy was written for key concealment only; auth was deferred and never added (the
  mobile app comment even documents "the anon mobile client can call it directly").
- Fix applied: Supabase JWT now required; `max_tokens` clamped to 8192; ≤50 messages per request;
  web + mobile clients attach the token.
- Regression test suggestion: POST without token → 401; with token and `max_tokens: 999999` →
  upstream payload contains `max_tokens: 8192`.

**C3 ✅ Deprecated model id `claude-sonnet-4-20250514` (retires 2026-06-15).**
- Evidence: defaults in `netlify/functions/claude.js:36`, `src/lib/anthropic.ts:4`,
  `mobile/lib/anthropic.ts:11`, `.env.example:4,8`.
- Impact: every AI feature 404s in 4 days.
- Fix applied: default is now `claude-sonnet-4-6` (documented drop-in replacement; still accepts the
  `temperature` passthrough this proxy supports). **Deploy note:** if `ANTHROPIC_MODEL` /
  `VITE_ANTHROPIC_MODEL` / `EXPO_PUBLIC_ANTHROPIC_MODEL` are set in Netlify/EAS env, update them too.

**C4 (open) `jspdf` ≤2.x critical advisory (ReDoS / DoS / local file inclusion).**
- Evidence: `npm audit` — fix requires `jspdf@4.2.1` + `jspdf-autotable@5` (breaking).
- Impact: PDF generation runs entirely client-side on operator-controlled input, so practical
  exploitability is low, but the advisory is real and blocks a clean audit.
- Fix: major upgrade scheduled in `IMPROVEMENT_PLAN.md` §7 (needs manual verification of every PDF
  template).

### High

**H1 (open) No rate limiting on public token endpoints.**
`public-link.js`, `public-link-approve.js`, `org-invite-accept.js`, `partner-invite-accept.js`,
`webhook-lead.js` accept anonymous traffic keyed only on a token. Tokens are high-entropy
(24–32 random bytes — brute force infeasible), but unlimited lookups still enable scraping/DoS and
mask abuse. Fix: Netlify rate limiting (edge function or paid feature) or a small token-bucket on a
Supabase table. (Plan §4.)

**H2 (open) `webhook-lead.js` trusts the payload given only a URL key.**
Key entropy is fine, but unlike `docusign-webhook.js` (HMAC over raw body) the body is unsigned —
a leaked webhook URL (common in Zapier/Slack configs) lets attackers inject leads. Fix requires
coordinating an HMAC header with external tools → breaking change, plan §5.

**H3 (open) Apple ID + Team ID committed in `mobile/eas.json:24-25`.**
`caraccount68@live.com` / `R2583WB946`. Not credentials in the password sense, but PII + targeting
info that doesn't belong in the repo (and lives in git history regardless). Recommended: move to EAS
submit env (`EXPO_APPLE_ID`) — *not changed here because it would break the owner's `eas submit`
flow without coordination.*

**H4 (open) Bundle size.** Main chunk 817 KB raw / 240 KB gz; `pdf` chunk 430 KB; `Analytics`
(recharts) 366 KB; `html2canvas` 201 KB. The pdf/html2canvas/analytics chunks are already lazy;
the main bundle still needs vendor splitting (`manualChunks`) to get the first paint under ~170 KB gz
on cell connections. Plan §6.

**H5 (open) `delete-account.js` deletes immediately on a bearer token.**
A leaked (≤1 h) access token irreversibly deletes the account and auth user. Recommended: typed
confirmation is client-side only today; add password re-auth or an emailed confirmation link
server-side. UX change → plan §3.

### Medium

**M1 ✅ `fetchClientsBundle` swallowed jobs/payments query errors** — `src/lib/queries.ts:136`
only checked `clientsRes.error`; a failing payments query silently rendered "$0 outstanding"
forever. Fixed (both errors now thrown so React Query surfaces the error state). Every other
bundle fetcher in the file already checked all results. Regression test: mock a payments error and
assert the query rejects rather than resolving empty.

**M2 ✅ ProfileContext cross-user race** — `src/contexts/ProfileContext.tsx`: an in-flight profile
fetch for user A resolving after a fast sign-out→sign-in to user B could overwrite B's profile (the
existing guard compared against its own stale closure). Fixed with an `activeUserIdRef` generation
guard; stale responses are dropped. Regression test: resolve fetch A after switching to user B,
assert profile stays B's.

**M3 (open) CORS `Access-Control-Allow-Origin: *` on all functions.**
With header-token auth (no cookies) the practical risk is low — a malicious origin cannot read a
victim's token — but pinning to `https://fieldhorse.io` + dev origins is cheap defense-in-depth.
Left open because the exact set of legitimate origins (deploy previews, custom domains) needs the
owner's confirmation. Note: `Allow-Headers` now includes `Authorization` everywhere it's needed.

**M4 (open) `public-link-approve.js` stores client IP + User-Agent** on every customer approval
(`fh_quote_versions.client_ip/client_user_agent`). This is *deliberate e-sign evidence* (audit trail
for "who approved"), which is a legitimate basis — but it should be disclosed in the public doc's
terms/privacy copy. Flagged for human review rather than removed.

**M5 (open) `org-invite-info.js` / `partner-invite-info.js` return the inviter's full name to
anonymous callers** holding a token. Low practical exposure (token required), but consider returning
company name only.

**M6 (open) Supabase error `detail` strings returned to clients** in several functions
(`send-quote.js` `contact_lookup_failed` etc.). Minor information disclosure; log server-side and
return generic errors. Quick win, batched into plan §4.

**M7 (open) Amount input accepts multiple decimal points** — `src/components/V3PaymentSheet.tsx:187`
(`replace(/[^\d.]/g,'')` permits `1.2.3`, then `Number()` yields NaN → guarded later, but the field
should reject the second `.` on input). Cosmetic-adjacent; quick win.

**M8 (open) Icon-only buttons missing `aria-label`** — ~25 buttons in
`src/screens/ContactDetail/sections/InvoiceDrawsSection.tsx:700-726`, `Selections.tsx:312-317`,
`DailyLogs.tsx` (delete). Screen readers announce bare "button". Quick win sweep.

**M9 (open) `demoSeed.ts` does not re-verify the session** during its multi-insert run; a
sign-out/sign-in mid-seed could write rows under the prior user id (RLS prevents *cross-tenant*
writes only if the JWT changed — the client keeps using the new session, so inserts would land on
the *new* user with the old closure's id and be rejected by RLS; residual risk is partial seeds).
Low likelihood; noted for cleanup.

### Low

- **L1** `fh_resolve_account_labels(uuid[])` and `fn_recalc_contact_amount_from_items()` lack a
  pinned `search_path = pg_catalog, public` (migrations 016:21, 011:107). RPC surface already
  revoked/guarded; one-line `ALTER FUNCTION` migration when convenient.
- **L2** Migration `045_tighten_logos_listing.sql` drops a policy on a bucket named `logos` that was
  never created (`company-logos` is the real bucket). Idempotent no-op; fix the comment/policy name
  to avoid future audit confusion.
- **L3** `mobile` WebViews use `originWhitelist={['*']}` for locally generated HTML
  (`mobile/app/invoices/[id].tsx:242`, `quote/[id].tsx:445`). Defense-in-depth: narrow it.
- **L4** `mobile/lib/publicLink.ts` falls back to `Math.random()` if `crypto.getRandomValues` is
  missing — should throw instead. (Web equivalent uses crypto only.)
- **L5** Mobile sessions persist in AsyncStorage (unencrypted) rather than `expo-secure-store`.
  Accepted trade-off today; revisit before App Store submission.
- **L6** `window.confirm` used without `typeof window` guards in 3 section files — only matters if
  code ever runs under SSR/tests; hygiene.
- **L7** `money()`/date formatters re-implemented in ~40 files despite `src/lib/format.ts`.
  Consolidation sweep, no behavior change.
- **L8** ESLint config is intentionally minimal (`no-unused-vars` off, etc.) and `checkJs: false`
  leaves `.jsx`/`.js` (e.g. `src/lib/pdf.js`) untyped. Tightening is its own project (plan §8).
- **L9** Repo-root markdown sprawl (`SHIP.md`, `DEPLOY_CHECKLIST.md`, two premium-migration docs)
  partially outdated; fold into `docs/`.

### False positives from this audit's sub-reviews (verified safe — do not "fix")

- `JSON.parse` in `Bid.tsx:103`, `Notes.tsx:116`, `Importer.tsx:173`: all three are inside
  `try/catch` with user-visible error states. No crash path.
- `Analytics.tsx:126` margin division: upstream filter guarantees `amount > 0`.
- Org-id "spoofing" via the migration-035 trigger: RLS `WITH CHECK org_id in auth_user_org_ids()`
  is the enforced boundary; caller-supplied org_id for an org you belong to is intentional.
- Public-link tokens "need hashing": they are single-purpose 24–32-byte random values; hashing adds
  nothing while breaking the resend flows.

---

## 5. What is well done (verified)

- **RLS**: all 34 tables RLS-enabled; org-scoped policies with `WITH CHECK`; revocation guards
  (`revoked_at is null`) everywhere; migration 042's initplan optimization; 043/044/045/046 hardening
  applied. No cross-tenant read/write path found.
- Time-punch approval and quote approval flow through server functions with role re-checks —
  approval state is not client-writable.
- Migrations are idempotent (`IF NOT EXISTS` / `DROP ... IF EXISTS` throughout); the user→org tenancy
  pivot (032→035→041) was executed backward-compatibly.
- React Query usage: stable user-scoped keys, `enabled: !!userId`, realtime channel cleanup
  returned from effects; lazy routes for everything except Login/Home; class components only in the
  two error boundaries.
- Email HTML rendering escapes user input (`safe()` in every send function; `esc()` in the mobile
  HTML builders). No `dangerouslySetInnerHTML` anywhere in `src/`.
- Security headers shipped in `netlify.toml` (HSTS, XFO, nosniff, Referrer-Policy,
  Permissions-Policy); CSP deliberately staged (comment documents why).
- Service worker: skipWaiting/clientsClaim + runtime caching with a documented opaque-response
  guard on the Supabase storage cache.

---

## 6. File-by-file notes (areas not individually listed above)

- `netlify/functions/org-*` (members-list, invite-create/accept/revoke/info, punch-approve,
  timesheets-list): JWT-verified, role-gated, org-scoped — clean except M5.
- `netlify/functions/sub-*` (portal-context, profile-update, doc-upload-url, doc-confirm):
  path-ownership checks present; `ilike` email match in doc-confirm is fragile but bounded (L-class).
- `netlify/functions/docusign-webhook.js`: HMAC verified over raw body ✅; unknown statuses default
  to `sent` (silent) — log-and-400 would be safer (L-class).
- `src/lib`: `dueDate`, `stages`, `rollups`, `permissions` (fail-closed), `closeout`, `clientMerge`,
  `pdfLogo` (timeout + taint guard), `timePunches` all reviewed clean; tests cover the money-path
  logic.
- `src/contexts`: Auth/Theme/Membership clean; Profile fixed (M2).
- `src/screens` + `src/components`: monolith screens (Home 1.7k lines, etc.) remain a maintainability
  cost (tracked since the first audit, FH-001..004); no new correctness issues beyond M7/M8.
- `supabase/migrations`: see §4 L1/L2; otherwise exemplary.
- `mobile/`: parallels the web app; findings H3, L3, L4, L5; `lib/queries.ts` drift vs web is
  cosmetic (no contract mismatches against `database.types.ts` found).
- `scripts/`: `build-icons.mjs` (sharp icon pipeline), `qa-render-proposal.mjs` — dev-only, clean.
- `public/`: icons + two stray design PNGs (`ChatGPT Image…png`, `45DEB62D….png`) that ship to
  production for no reason — removable (L-class).
- `.github/workflows`: CI solid; `eas-build.yml` builds mobile on tags; no secrets echoed.

---

## 7. Changes made in this pass (Phase 5)

| # | Change | Files | Verification |
|---|---|---|---|
| 1 | Require + verify Supabase JWT on all 5 sender-identity functions; reject token/user mismatch | `netlify/functions/{send-message,send-quote,send-invoice,send-certificate,docusign-send}.js` | build green; endpoints return 401/403 by construction (no token → early return) |
| 2 | Require JWT on `/api/claude`; clamp `max_tokens` ≤ 8192; ≤ 50 messages | `netlify/functions/claude.js` | build green |
| 3 | Attach session bearer token at every web callsite (7) + helper | `src/lib/supabase.ts` (`authHeaders()`), `Compose.tsx`, `Invoices.tsx`, `InvoiceDetail.tsx`, `Quote.tsx` (×2 incl. DocuSign), `InvoiceDrawsSection.tsx`, `MarkCompleteSheet.tsx`, `src/lib/anthropic.ts` | `tsc` clean, 53/53 tests, build green |
| 4 | Attach session bearer token in mobile clients (4 calls) | `mobile/lib/sendDocs.ts`, `mobile/lib/anthropic.ts` | mobile not built in CI; type-checked by inspection |
| 5 | Replace retiring model `claude-sonnet-4-20250514` → `claude-sonnet-4-6` everywhere | `claude.js`, `src/lib/anthropic.ts`, `mobile/lib/anthropic.ts`, `.env.example` | grep: zero references remain |
| 6 | Throw on jobs/payments query errors in clients bundle | `src/lib/queries.ts` | tests green |
| 7 | Generation guard against cross-user stale profile writes | `src/contexts/ProfileContext.tsx` | tests green |
| 8 | `npm audit fix` (semver-compatible only) | `package-lock.json` | 15 → 6 vulns; tests + build green |

**Rollout caution (intentional behavior change):** changes 1–4 mean *previously-deployed mobile
binaries* (which don't send the token) will get 401 on send-email/AI features until users update to
a build containing this commit. The web app deploys atomically so it is unaffected. This is the
unavoidable cost of closing an open relay; ship a mobile release alongside the Netlify deploy.

---

## 8. Prioritized remediation plan (what's next)

1. **Deploy this branch** (closes C1–C3) + update `ANTHROPIC_MODEL` env vars if set; cut a mobile build.
2. Rate limiting on anonymous token endpoints (H1) + generic error bodies (M6) — one small PR.
3. `jspdf` 2→4 + `jspdf-autotable` 3→5 major upgrade with manual PDF verification (C4) — see plan §7.
4. Vendor `manualChunks` split + dynamic-import `lib/pdf.js` at click time (H4).
5. Delete-account re-auth (H5) and webhook-lead HMAC (H2) — need product/integration coordination.
6. Accessibility sweep: `aria-label` on icon buttons (M8); amount-input decimal guard (M7).
7. CORS origin pinning after confirming the legitimate origin list (M3).
8. Housekeeping: SQL `search_path` pins (L1), migration-045 comment (L2), stray PNGs in `public/`,
   formatter consolidation (L7).

## 9. Unknowns needing human review

- Whether any third-party integrations POST to `webhook-lead` today (determines H2 rollout).
- The legitimate origin list for CORS pinning (M3): custom domains? Netlify deploy previews?
- Whether IP/UA capture on proposal approval (M4) is disclosed in the public-doc terms copy.
- Whether `ANTHROPIC_MODEL`/`VITE_ANTHROPIC_MODEL`/`EXPO_PUBLIC_ANTHROPIC_MODEL` are pinned in
  Netlify/EAS env (would override the code fix for C3).
- Apple ID in `eas.json` (H3): removing it changes the `eas submit` flow — owner's call.
- Whether an old mobile binary population exists that needs a grace period before deploying the
  auth requirement (see §7 rollout caution).
