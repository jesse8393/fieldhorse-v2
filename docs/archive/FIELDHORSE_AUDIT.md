# Fieldhorse PWA Audit

Read-only senior engineering review of `fieldhorse-v2` (PWA) and the parallel `mobile/` Expo app.
Branch audited: `claude/audit` (= `origin/main` at commit `912f633`).
Supabase project: `pnmhblvslftdzfcdezbw` (`fieldcap`).

> Important framing fix: the audit brief assumes a **Capacitor** iOS wrapper. There is **no Capacitor in this repo** — no `capacitor.config.ts`, no `@capacitor/*` deps. The `mobile/` folder is a **separate Expo React Native app**, not a wrapper of the PWA. The PWA is the only iOS surface available today unless Capacitor is stood up. Several iOS-wrapper findings below are therefore "prerequisite work before any wrapper exists."
>
> The brief also describes the app as a **"tenant switching portal."** The code is single-user, multi-tenant via `user_id` row-level scoping. There is no in-app account/tenant switcher. The "partner invite" flow is a per-job share (one shared job between contractor and a builder client), not a portal-style tenant switch. This is worth aligning on with stakeholders before App Store copy goes out.

---

## 1. Executive summary

Ranked by severity, top of the pile:

1. **Account deletion is missing.** `Settings.tsx` has a "wipe my data" button, not an auth-user delete. Apple has required in-app account deletion since 2022. **Blocker for any App Store submission.**
2. **No App Store wrapper exists.** No Capacitor, no native shell. The PWA cannot reach the App Store today; this is weeks of work, not a checkbox.
3. **No security headers on the host.** `netlify.toml` has only an asset `Cache-Control`. No CSP, no Permissions-Policy, no HSTS, no Referrer-Policy.
4. **Brand-token drift.** `--field-gold` is `#C7A45A` in code; the file's own comment names the canonical `#C9963A`. Manifest `background_color` is `#141414` (Onyx) where the spec says Linen `#F2EDE4`. 40+ hex literals live outside the approved palette.
5. **PWA manifest is thin.** Two icons (192, 512) where the spec wants ten plus maskable. No `start_url`, `scope`, or `shortcuts`.
6. **Bundle is heavy.** Main chunk **818 KB** (239 KB gzipped). `V3PaymentSheet` chunk **143 KB gzipped**, `Analytics` **109 KB**. `jsPDF`/`html2canvas` are imported eagerly via `src/lib/pdf.js`.
7. **Copy violations everywhere.** 151 source files contain em dashes; en dashes in aging labels, the health donut, the home time strip. Two unapproved fonts (`JetBrains Mono`, `Instrument Serif`) load from Google Fonts on every page.
8. **Monolithic screens.** `Home.tsx` 1,739 lines, `ClientDetail.tsx` 1,447, `ContactDetail/tabs/Quote.tsx` 1,425, `Notes.tsx` 1,073 — each carries data fetching, derived state, sub-components, and JSX.
9. **Supabase advisor flags.** Two public storage buckets allow listing, 20+ functions have mutable `search_path`, 5 `SECURITY DEFINER` RPCs are callable by `anon`. The application code uses signed URLs, but the policies still permit enumeration.
10. **Haptics layer is `navigator.vibrate`.** A no-op in iOS Safari and in `WKWebView`. Crews wearing gloves get nothing. Needs the Capacitor Haptics plugin once a wrapper exists.

Findings counted: **88 IDs total** (83 actionable, 5 passes). **6 blocker · 19 high · 35 medium · 23 low · 5 pass.**

---

## 2. Findings

Section IDs are stable. Severity is one of `BLOCKER · HIGH · MEDIUM · LOW`. Every finding cites `file:line`.

### 1. Architecture and code health

**FH-001 · MEDIUM** — Monolithic screens. *Home.tsx, ClientDetail.tsx, ContactDetail/tabs/Quote.tsx, Notes.tsx, Schedule.tsx, InvoiceDetail.tsx, Settings.tsx, SubDetail.tsx, Compose.tsx, Bid.tsx all exceed 900 lines.* `src/screens/Home.tsx:1-1739`, `src/screens/ClientDetail.tsx:1-1447`, `src/screens/ContactDetail/tabs/Quote.tsx:1-1425`, `src/screens/Notes.tsx:1-1073`. **Why it matters:** these files mix data fetching, derived state, inline sub-components, and JSX, making changes risky and review slow. **Fix:** extract the data layer into co-located hooks (`hooks/useHomeData.ts`, `hooks/useClientMetrics.ts`), pull inline row components into sibling files, and move large derivations (e.g. `Home.tsx:217-294` `nextActions` composition) to pure functions in `lib/`.

**FH-002 · HIGH** — Five-level prop drilling on `ContactDetail`. `src/screens/ContactDetail/index.tsx:261-346` passes `contact`, `clientSummary`, `viewerUserId`, `isEditing`, `paid`, `balance`, `nextTodo`, six handlers, and five sheet-open callbacks down to `Header` (lines 492-496) and into each tab. **Why it matters:** every new field adds noise to every level. **Fix:** introduce a `ContactDetailContext` exposing `{ contact, data, handlers }` and `useContactDetail()`. Tabs consume directly; the parent only owns sheet state.

**FH-003 · MEDIUM** — Business logic in JSX render path. `src/screens/Home.tsx:217-294` composes the operator's "next actions" stream (three data sources + urgency sorting + cap-at-five) inline. **Why it matters:** changing the priority rule requires reading 80 lines of JSX. **Fix:** extract `composeNextActions({ contacts, scheduleItems, payments, now }) → Action[]` into `src/lib/homeActions.ts`. Unit-testable in isolation.

**FH-004 · MEDIUM** — `Home.tsx` has 20+ `useState` calls. `src/screens/Home.tsx:85-180`. **Why it matters:** independent slices of state that all rehydrate from the same Supabase fetch — easy to leave one stale. **Fix:** bundle into a `useHomeData()` hook returning a single object; let React Query own caching.

**FH-005 · LOW** — Legacy re-export stub for the old screen. `src/screens/ContactDetail.tsx` exists alongside `src/screens/ContactDetail/index.tsx`. **Why it matters:** two routes pointing at conceptually the same module is a refactor leftover. **Fix:** delete the legacy stub once all sections are migrated; track in a follow-up.

**FH-006 · LOW** — Skeleton type-cast workaround. `src/screens/ContactDetail/index.tsx:15-17` imports `SkeletonBlock` / `SkeletonList` with `_` suffixes and re-casts to `any`. **Fix:** type the exports in `src/components/Skeleton.tsx` and drop the alias.

**FH-007 · LOW** — Commented-out theme toggle residue. `src/screens/Settings.tsx:11-13, 37`. **Fix:** delete or restore.

**FH-008 · LOW** — Repo-root artifacts. `fieldhorse v3 premium design- CHat.zip` (122 KB) and `scaffold.ps1.ps1` (note the doubled extension). **Fix:** move to `/docs/assets/` or delete; they ship to the dev clone unnecessarily.

**FH-009 · LOW** — `// @ts-ignore` for an untyped dep. `src/screens/Importer.tsx:2` (papaparse). **Fix:** add `@types/papaparse` to devDependencies; remove the suppression.

**Positive (no action):** `src/App.tsx` lazy-loads every route except `Login` and `Home`. Class components live only in two error boundaries (`AppErrorBoundary.tsx`, `RouteErrorBoundary.tsx`), which is the right tool. Tenant isolation is centralized in `ProfileContext` — no scattered logic. `src/components/AppShell.tsx` already cleaned up the v2 Aurora/GridPattern decorative layer.

### 2. Brand token compliance

**FH-010 · HIGH** — Canonical Gold is wrong in the token file. `src/styles/tokens.css:3` defines `--field-gold: #C7A45A` while the same file's comment at `line 109` names the canonical as `#C9963A`. **Why it matters:** the brand-spec value is being declared and never used. **Fix:** `--field-gold: #C9963A;`. Audit downstream `--field-gold-*` variants for derived-value consistency.

**FH-011 · HIGH** — Onyx token differs from spec. `src/styles/tokens.css:7` `--onyx: #0B0B0B`. Spec is `#141414`. `--onyx-2` at line 8 is `#141414`. **Why it matters:** every consumer that grabs `--onyx` gets a deeper-than-spec black; surfaces drift. **Fix:** rename `--onyx` to `--onyx-deep` (or similar) and repoint `--onyx` to `#141414`; sweep callsites.

**FH-012 · MEDIUM** — Forty-plus hex literals outside the approved palette across `src/`. Sample: `#0B0907`, `#0E7C66`, `#178A3A`, `#1F3A93`, `#1F8F4A`, `#252019`, `#2A1F10`, `#3D1D17`, `#3F4651`, etc. **Why it matters:** every literal is a future drift point. **Fix:** route every surface and indicator through a CSS variable; add an ESLint rule (`no-restricted-syntax` on hex literals in `.tsx`/`.ts`) once the sweep is done.

**FH-013 · MEDIUM** — `RouteErrorBoundary.tsx` hardcodes a monospace stack. `src/components/RouteErrorBoundary.tsx:89` uses `'ui-monospace, SFMono-Regular, Menlo, monospace'`. Brand rule bans monospace in display UI. **Fix:** swap to `var(--font-body)` with `font-variant-numeric: tabular-nums`.

**FH-014 · MEDIUM** — Mono fallback chain in invite sheet. `src/components/InvitePartnerSheet.tsx:494` uses `var(--font-mono, ui-monospace, monospace)`. The fallback will render real monospace if the var isn't loaded. **Fix:** remove the fallback or set to `var(--font-body)`.

**FH-015 · HIGH** — Unapproved fonts loaded site-wide. `index.html:18` requests `JetBrains Mono` *and* `Instrument Serif` from Google Fonts on every page. Brand spec allows only DM Sans + Bebas Neue. **Why it matters:** brand violation plus ~80–120 KB of font payload nobody uses (the `--font-mono` token is aliased to DM Sans anyway — see `tokens.css:58`). **Fix:** trim the URL to `?family=Bebas+Neue&family=DM+Sans:wght@400;500;600;700&display=swap`. Audit `tokens.css:60` (`--font-serif: 'Instrument Serif'`) and remove or repoint to DM Sans/Bebas Neue.

**FH-016 · MEDIUM** — `--font-mono` exists at all. `src/styles/tokens.css:58` keeps `--font-mono` as a "legacy alias" that resolves to DM Sans. 25+ CSS rules in `src/styles/global.css` reference `var(--font-mono)`. **Why it matters:** the variable name lies about what it's for and invites a future developer to point it back at a real monospace. **Fix:** rename to `--font-body-num` (or just stop using it) and migrate the global.css references to `var(--font-body)` with `tabular-nums` where needed.

**FH-017 · LOW** — Gold variants proliferate. `--field-gold`, `--field-gold-hot`, `--field-gold-bright`, `--field-gold-deep`, `--field-gold-neon`, plus `--v3-primary`, `--v3-primary-bright`, `--v3-primary-hot`. **Fix:** consolidate to one canonical gold plus a single `-hover` and `-pressed`; deprecate the rest.

### 3. Copy and content compliance

**FH-018 · HIGH** — Em dashes (`—`) appear in **151 source files**. User-facing examples (these all render to the operator):
- `src/components/SignaturePad.tsx:32` `'Optional — hand the phone to the customer to sign.'`
- `src/components/BrandLogoPicker.tsx:57` `'Logo too large — keep it under 1 MB'`
- `src/components/BrandLogoPicker.tsx:72` `"Couldn't read image — try another file"`
- `src/components/TimeClockCard.tsx:235` `Less than 3 minutes — sure?`
- `src/components/AddEventSheet.tsx:105` `Drops a single event on the calendar — flip recurrence on…`
- `src/components/NewLeadSheet.tsx:278` `'Voice parse failed — fill the fields manually.'`
- `src/components/NewLeadSheet.tsx:521` `'Hang tight — applying values to the form…'`
- `src/components/MarkCompleteSheet.tsx:225` `'The PDF is saved to Files — share it manually.'`
- `src/components/MarkCompleteSheet.tsx:324` `Heads up — there's still …`
- `src/components/InvitePartnerSheet.tsx:121` `'Email sender is not configured yet — share the link manually below.'`
- `src/components/InvitePartnerSheet.tsx:234-235` `… nothing else from your account.` / `not your other contacts…`

**Rewrites (no dashes, natural voice):**
- `'Optional. Hand the phone to the customer to sign.'`
- `'Logo too large. Keep it under 1 MB.'`
- `"Couldn't read image. Try another file."`
- `'Less than 3 minutes. You sure?'`
- `'Drops a single event on the calendar. Flip recurrence on to repeat for the next four cycles.'`
- `'Voice parse failed. Fill the fields manually.'`
- `'Hang tight, applying values to the form…'`
- `'The PDF is saved to Files. Share it manually.'`
- `"Heads up, there's still {balance} unpaid. You can still close the job."`
- `'Email sender is not configured yet. Share the link manually below.'`

**Fix at scale:** sweep `grep -rln '—' src/ --include='*.tsx' --include='*.ts'` and replace user-visible strings (skip comments, code identifiers). Add an ESLint custom rule on string literals to prevent re-introduction.

**FH-019 · HIGH** — En dashes (`–`) in user-facing strings.
- `src/screens/Invoices.tsx:30-32` aging labels `'0–30 d'`, `'31–60 d'`, `'61–90 d'`, `'90+ d'`.
- `src/components/v3/HealthDonut.tsx:14-16` band labels `80–100`, `50–79`, `0–49`.
- `src/components/v3/ProgressMeter.tsx:8` `0–49 danger, 50–79 gold, 80–100 success`.
- `src/screens/Home.tsx:1050` time strip `${startTime} – ${endTime}`.
- `src/lib/jobTemplates.ts:31` `'Standard 2–3 day reroof…'`
- `src/components/settings/RateCardEditor.tsx:102, 326` rate strings.

**Fix:** replace `–` with `to` or `→` (the arrow is acceptable in dense numeric UI). For Home `${startTime} – ${endTime}` use `${startTime} to ${endTime}` in narrative contexts, `${startTime}–${endTime}` is borderline acceptable only inside hairline-time chips (still violates rule strictly).

**FH-020 · MEDIUM** — Comments in `src/lib/stages.ts:53` and `src/lib/rollups.ts:1` use em dashes, and the brand-rule sweep above doesn't catch them. Not user-facing, but if you ship a code-review rule, scope it to JSX text and string literals only — don't break the comment style.

**FH-021 · LOW** — Zero-padded numbers appear in: `src/components/TimeClockCard.tsx:65-66` (`hh:mm:ss` timer), `src/lib/dueDate.ts:36-37` (date input `YYYY-MM-DD`), `src/screens/Schedule.tsx:213-214`, `src/components/NewLeadSheet.tsx:508` (recording timer). **Assessment:** the timer (`h:mm:ss`) and the `<input type="date">` value (`YYYY-MM-DD`) are HTML/format requirements, not copy violations. Leave them. The brand rule applies to *display* numbers like "07 jobs", "03 days ago" — none of those exist today.

**FH-022 · MEDIUM** — `src/components/v3/HealthDonut.tsx:14-16` uses display labels like `"At Risk"` and `"Behind"` with title-case. Title-case feels okay; check the design system intent.

**FH-023 · LOW** — `index.html:21` `<title>Fieldhorse</title>` is fine; `manifest.description` `'Contractor field operations'` (`vite.config.js:29`) reads thin. Suggested: `'Run your day from the truck. Quotes, jobs, payments, signatures.'`

### 4. PWA fundamentals

**FH-024 · HIGH** — Manifest icon set is two icons. `vite.config.js:31-34` declares only `192×192`, `512×512` (any), and `512×512` (maskable). **Missing:** `48, 72, 96, 128, 144, 152, 256, 384` plus `192` and `512` maskable variants. **Why it matters:** Android home-screen and splash sizes look off; Lighthouse PWA scores drop. **Fix:** generate the full set in `public/` (use the existing `scripts/build-icons.mjs` if it does this, or `sharp` is already a dep) and expand the `icons` array.

**FH-025 · HIGH** — Manifest `background_color` mismatches the spec. `vite.config.js:27` sets `background_color: '#141414'` (Onyx). Brief spec is **Linen `#F2EDE4`** for the splash background. **Fix:** `background_color: '#F2EDE4'`. Keep `theme_color: '#141414'`.

**FH-026 · MEDIUM** — Manifest is missing `start_url`, `scope`, `id`, `shortcuts`, `categories`. `vite.config.js:25-38`. **Why it matters:** without `start_url` the SW uses the install URL (which can be `/login`), and without `id` PWA install state can fork when the URL changes. **Fix:**
```js
start_url: '/?source=pwa',
scope: '/',
id: '/?source=pwa',
categories: ['business', 'productivity'],
shortcuts: [
  { name: "Today's jobs", short_name: 'Today', url: '/jobs?stage=active' },
  { name: 'New lead',     short_name: 'New',   url: '/jobs?new=1' }
]
```

**FH-027 · HIGH** — Service worker has no per-route caching strategies. `vite.config.js:18-23` configures only `skipWaiting`, `clientsClaim`, `cleanupOutdatedCaches`. No `runtimeCaching` array. **Why it matters:** API responses, fonts, images, and document HTML all fall through to default precache only — no stale-while-revalidate, no offline fallback. **Fix:** add
```js
workbox: {
  skipWaiting: true, clientsClaim: true, cleanupOutdatedCaches: true,
  navigateFallback: '/offline.html',
  runtimeCaching: [
    { urlPattern: /^https:\/\/pnmhblvslftdzfcdezbw\.supabase\.co\/rest\//, handler: 'NetworkFirst', options: { cacheName: 'api', networkTimeoutSeconds: 4 } },
    { urlPattern: /^https:\/\/pnmhblvslftdzfcdezbw\.supabase\.co\/storage\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'storage' } },
    { urlPattern: /^https:\/\/fonts\.googleapis\.com\//, handler: 'StaleWhileRevalidate', options: { cacheName: 'gfonts-css' } },
    { urlPattern: /^https:\/\/fonts\.gstatic\.com\//, handler: 'CacheFirst', options: { cacheName: 'gfonts-files', expiration: { maxEntries: 30, maxAgeSeconds: 60*60*24*365 } } },
    { urlPattern: /\.(?:png|svg|webp|avif)$/, handler: 'StaleWhileRevalidate', options: { cacheName: 'images' } }
  ]
}
```

**FH-028 · MEDIUM** — No offline fallback page. `public/` lacks `offline.html`. **Fix:** add a brand-styled `public/offline.html` showing "You're offline. Cached pages still work." and reference via `navigateFallback`.

**FH-029 · LOW** — `index.html:5-6` declares `<link rel="icon">` for 192 and 512 PNGs but Vite injects manifest icons separately. Harmless; verify after the icon expansion.

### 5. Performance

**FH-030 · HIGH** — Main bundle `index-*.js` is **818 KB raw / 239 KB gzipped** (from `dist/assets/`). **Why it matters:** the brand sells "in the truck on cell signal." Anything over ~170 KB gzipped on initial paint pushes time-to-interactive past 5 s on 3G. **Fix:** vendor-split with `manualChunks` in `vite.config.js` (group React + React DOM + React Router into a stable `vendor-react`, framer-motion + Vaul into `vendor-motion`, @supabase/supabase-js into `vendor-supabase`). Improves cache hit rate, splits TTI, and the warning at `build` exit goes away.

**FH-031 · HIGH** — `V3PaymentSheet` chunk is **143 KB gzipped** (`dist/assets/V3PaymentSheet-CrND5O7O.js`). **Why it matters:** this sheet opens on a per-deal action, but Rollup is attributing shared vendor weight to it. **Fix:** add manual chunks per FH-030 — the shared deps lift out and the sheet's true weight drops by an order of magnitude.

**FH-032 · HIGH** — Analytics chunk **109 KB gzipped** (`dist/assets/Analytics-5ZTLVVIi.js`). Recharts is the bulk. `src/screens/Analytics.tsx:3` imports `AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer`; `src/components/v3/Sparkline.tsx:2` also uses recharts. **Why it matters:** the route is already lazy, but recharts is heavy even for a sparkline. **Fix:** the sparkline is 14 points — replace with a hand-rolled SVG polyline (50 lines of TS, no dep). Keep recharts only for the Analytics screen.

**FH-033 · HIGH** — `jsPDF` and `jspdf-autotable` import eagerly. `src/lib/pdf.js` imports both at module top; `MarkCompleteSheet.tsx`, `Invoices.tsx`, `InvoiceDetail.tsx`, `ContactDetail/sections/InvoiceDrawsSection.tsx`, and `QuoteItems.tsx` all import `lib/pdf.js` statically. The jsPDF body is ~438 KB uncompressed. **Why it matters:** anyone landing on a deal pays the cost whether or not they generate a PDF. **Fix:** convert `lib/pdf.js` to export an async builder; each caller does `const { renderInvoice } = await import('../lib/pdf.js')` at the click handler.

**FH-034 · MEDIUM** — `html2canvas` ships in its own chunk (~48 KB gzipped) loaded somewhere. **Fix:** locate the import (likely the PDF builder), dynamic-import it at click time.

**FH-035 · MEDIUM** — Image formats. The `public/` tree only contains PNG/SVG icons; no hero photography. Job photos live in Supabase Storage. **Why it matters:** when job photos are previewed at scale, AVIF/WebP would cut bytes substantially. **Fix:** add a Supabase Storage transform pipeline (`/storage/v1/render/image/...?format=webp&quality=70&width=N`) and use a single `<img srcset>` helper component.

**FH-036 · MEDIUM** — Fonts loaded from Google but not preloaded. `index.html:15-18` does `preconnect` (good) but no `<link rel="preload" as="font">` for the two display weights actually used at hero. **Fix:** preload `DM Sans 600` and `Bebas Neue 400` (the two faces that show above the fold) with `crossorigin`.

**FH-037 · LOW** — No CLS guard on the home pipeline number. `src/screens/Home.tsx` `CountUp` swaps a skeleton in/out; verify the skeleton width matches the final character count to avoid a small shift.

### 6. Accessibility

**FH-038 · MEDIUM** — App header buttons are 34×34 px. `src/components/AppHeader.tsx:118` (search), `:143` (notes) — both `width: 34, height: 34`. iOS HIG minimum is 44 pt. The comment at `:106-110` argues padding extends the hit area; physically the tap target is still 34 px. **Fix:** raise to `40×40` minimum with the same icon size; the cluster width grows 18 px total, which the centered logo can spare.

**FH-039 · MEDIUM** — BottomNav inner icon containers are 32×32 (`src/components/BottomNav.tsx:132`) and 36×36 (`:219, :241`). The outer button has `minHeight: 44` (`:341`) so the *button* meets the rule, but the *visual affordance* sits inside a smaller box, which can confuse one-handed users. **Fix:** raise the icon container to 40×40 inside the 44-tall hit area.

**FH-040 · MEDIUM** — Color contrast on Gold over Onyx is **borderline**. With `--field-gold` at `#C7A45A` over `--onyx-2` `#141414` you're at ≈4.1:1, just below WCAG AA 4.5:1 for body text. The fix in FH-010 (move to canonical `#C9963A`) makes it worse, not better (~4.3:1). **Why it matters:** body text in gold reads as low contrast on phones in direct sun. **Fix:** reserve gold for headings (≥18 pt or bold ≥14 pt — 3:1 passes), use linen/white for body. Or raise gold toward `#D9B26B` for body-size text; lab-test on a real phone outdoors before deciding.

**FH-041 · LOW** — Some sheet inputs lack explicit labels. `src/components/V3PaymentSheet.tsx:179, 283, 297`, `src/components/LogoUploader.tsx:59`, `src/components/MobileSearchOverlay.tsx:203` — verify each input has a `<label>` wrapping or `aria-label`. **Fix:** add `aria-label="Payment amount"` (and friends) where the visible label is rendered as a separate element rather than a `<label htmlFor>`.

**FH-042 · LOW** — Skip-link present. `src/components/AppShell.tsx:121` `<a href="#fh-main" className="fh-skip-link">Skip to content</a>`. ✅

**FH-043 · LOW** — Drawer focus management via Vaul handles trap-and-return. `src/components/ui/drawer.tsx`. ✅

**FH-044 · LOW** — Focus ring is global. `src/styles/global.css:14-25` (per agent report) defines `:focus-visible` outline in gold. ✅

### 7. Security and data

**FH-045 · LOW** — `.env.example` lists `SUPABASE_SERVICE_ROLE_KEY` as a placeholder. Confirmed not present in `src/` (no service-role key ships to the client). **Fix:** rename the example slot to `SUPABASE_SERVICE_ROLE_KEY=__server_only_do_not_paste_in_VITE_` so a copy-paste mistake fails loudly.

**FH-046 · HIGH** — `netlify.toml` ships no security headers. Only `Cache-Control` on `/assets/*` (`netlify.toml:23-26`). **Why it matters:** missing CSP, Permissions-Policy, HSTS, X-Frame-Options, Referrer-Policy. **Fix:**
```toml
[[headers]]
  for = "/*"
  [headers.values]
    Content-Security-Policy = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self' https://pnmhblvslftdzfcdezbw.supabase.co wss://pnmhblvslftdzfcdezbw.supabase.co https://fonts.googleapis.com https://fonts.gstatic.com; img-src 'self' data: blob: https://pnmhblvslftdzfcdezbw.supabase.co; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; frame-ancestors 'none'; base-uri 'self'"
    Strict-Transport-Security = "max-age=31536000; includeSubDomains; preload"
    Referrer-Policy = "strict-origin-when-cross-origin"
    Permissions-Policy = "geolocation=(self), microphone=(self), camera=(self), accelerometer=(), gyroscope=(), interest-cohort=()"
    X-Content-Type-Options = "nosniff"
    X-Frame-Options = "DENY"
```
Test against the app's actual third-party network calls before locking.

**FH-047 · HIGH (Supabase advisor)** — Two public storage buckets allow listing. `jobphotos` and `logos` each carry a broad `SELECT` policy on `storage.objects` (per advisor `0025_public_bucket_allows_listing`). **Why it matters:** any anonymous client can enumerate every file across every tenant. Application code uses signed URLs (good defense), but the policy is the source of truth. **Fix:** drop the broad `SELECT` policies; keep `INSERT/UPDATE/DELETE` scoped to owner and read via signed URLs only.

**FH-048 · HIGH (Supabase advisor)** — Five `SECURITY DEFINER` functions are callable by `anon`. `fh_resolve_account_labels`, `fn_approve_quote_version`, `fn_recalc_contact_amount_from_items`, `handle_new_user`, `rls_auto_enable`. **Why it matters:** `rls_auto_enable` callable without auth is the loudest one. `fn_approve_quote_version` is almost certainly intentional (the public quote-approval link). **Fix:** `REVOKE EXECUTE ON FUNCTION public.rls_auto_enable() FROM anon, public;` (and same for `handle_new_user`); leave `fn_approve_quote_version` callable if the approval link still flows through it.

**FH-049 · MEDIUM (Supabase advisor)** — 20+ functions have a mutable `search_path` (`fh_*_touch`, `fh_clients_recompute`, etc.). Standard hardening lint. **Fix:** one migration: `ALTER FUNCTION public.<name>(<args>) SET search_path = pg_catalog, public;` per function.

**FH-050 · LOW (Supabase advisor)** — Leaked-password protection disabled (HaveIBeenPwned). Toggle in dashboard.

**FH-051 · LOW (Supabase advisor)** — `public.fh_integration_secrets` has RLS enabled with no policies. Effective behavior is deny-all, which is safe; just confirm no client read path expects to query this table.

**FH-052 · MEDIUM** — Forty-eight `.select('*')` calls across `src/`. **Fix:** project only the columns each surface reads. Cuts payload, RLS check time, and a category of accidental PII exposure. Sweep with a follow-up PR.

**FH-053 · PASS** — No `dangerouslySetInnerHTML` in `src/`. ✅

**FH-054 · PASS** — Only `VITE_SUPABASE_URL` + `VITE_SUPABASE_ANON_KEY` in the client bundle. Netlify Functions correctly use server-side env. ✅

### 8. Data layer and sync

**FH-055 · PASS** — React Query is set up with stable, user-id-scoped query keys. `src/lib/queries.ts` exports `queryKeys` and gates every query on `enabled: !!userId`. ✅

**FH-056 · PASS** — Realtime subscription cleanup. `src/lib/queries.ts:89` returns `() => supabase.removeChannel(channel)`. ✅

**FH-057 · MEDIUM** — `staleTime` is unspecified on most queries; defaults to `0` (always-stale, refetch on window focus). **Why it matters:** on cellular data this hammers the network and burns battery. **Fix:** set route-level `staleTime: 60_000` on read-heavy queries (`useJobs`, `useClients`, `useJobPhotos` already has 5 min — good model).

**FH-058 · BLOCKER** — **No offline write queue.** Field crews on a roof or in a basement need to capture photos, write notes, log payments, and have those drain when signal returns. Nothing in `src/lib/` implements an outbox. **Why it matters:** Apple's review note for any "field" app explicitly looks for offline value; without it the wrapper is rejected as a thin web shell. **Fix:** add an IndexedDB-backed mutation queue (`src/lib/offlineQueue.ts`) that wraps the four field-critical writes — `fh_payments.insert`, `fh_notes.insert`, `fh_job_photos.insert`, `fh_contacts.update(stage)`. Drain on `online` event with idempotency keys.

**FH-059 · MEDIUM** — Outstanding rollup divergence (also noted in code comment). `src/lib/rollups.ts` computes `outstanding` from raw `fh_contacts.amount`; `src/screens/ContactDetail/sections/InvoiceDrawsSection.tsx` and `src/components/documents/InvoiceTemplate.tsx` correctly add **approved change orders**. The list rollup and the invoice screen disagree for jobs with approved COs. **Fix:** thread approved-CO totals into `rollupJobs(jobs, payments, changeOrders)` and rebuild outstanding consistently.

**FH-060 · MEDIUM** — `stages.logPayment` auto-closes jobs with `amount = 0` on the first payment. `src/lib/stages.ts:138`. With `amount = 0` the condition `total >= 0` is always true. **Why it matters:** the new "quick invoice from client" feature creates deals at `amount = 0` until line items run; a single payment closes the deal accidentally. **Fix:** `if (contractAmount > 0 && total >= contractAmount && contact.stage !== 'closed')` (already fixed on `claude/test-suite`, PR #139).

**FH-061 · MEDIUM** — `pipeline.logPayment` toasts a misleading "Paid in full" in the same `amount = 0` case (`src/lib/pipeline.ts` near `:66`). Same guard. (Also fixed on PR #139.)

### 9. App Store readiness — iOS first

**This section assumes a Capacitor wrapper will be added** (none exists today; see top-of-document framing). Items below are the work needed before submission *plus* the few that block even today's PWA goals.

**FH-062 · BLOCKER** — No Capacitor present. `capacitor.config.ts` missing; no `@capacitor/*` deps. **Fix:** `npm i -D @capacitor/cli @capacitor/core @capacitor/ios @capacitor/haptics @capacitor/status-bar @capacitor/splash-screen @capacitor/keyboard @capacitor/preferences`, then `npx cap init Fieldhorse io.fieldhorse.app --web-dir=dist`, `npx cap add ios`. Pin `ios.contentInset: 'always'` to play nice with safe-area.

**FH-063 · BLOCKER** — No in-app account deletion. `src/screens/Settings.tsx:524` describes a "wipe everything" that deletes the user's *data rows* via RLS; the auth user is not deleted. Apple has required true account deletion since 2022. **Fix:** add a Settings → Account → Delete account flow that calls a Netlify Function (or Supabase Edge Function) using the service-role key to `auth.admin.deleteUser(userId)` after a typed-name confirmation. Show a 14-day soft-delete recovery email; complete deletion on day 14.

**FH-064 · BLOCKER** — Haptics implementation is a no-op in iOS. `src/lib/haptics.ts:7-15` uses `navigator.vibrate`. iOS Safari does not implement it, and `WKWebView` won't either. **Why it matters:** gloves on a site mean the operator needs haptic confirmation. **Fix:** detect Capacitor and route to `@capacitor/haptics`:
```ts
import { Haptics, ImpactStyle } from '@capacitor/haptics' // dynamic-imported
async function impact(style: ImpactStyle) { try { await Haptics.impact({ style }) } catch {} }
// existing hapticTap/Medium etc. dispatch to impact() on native, navigator.vibrate on web.
```

**FH-065 · BLOCKER** — App icon set incomplete for iOS. `public/` ships `apple-touch-icon.png` (180), `icon-192.png`, `icon-512.png`, `favicon.svg`, `icon.svg`. **Missing for Apple:** 20pt 2x/3x, 29pt 2x/3x, 40pt 2x/3x, 60pt 2x/3x, 76pt 2x (iPad), 83.5pt 2x (iPad Pro), 1024 marketing. **Fix:** generate from the brand mark (gold on onyx) via `sharp` in `scripts/build-icons.mjs`; output to the Xcode `AppIcon.appiconset` once the wrapper exists.

**FH-066 · HIGH** — Launch screen is missing. iOS no longer accepts a static image — needs a storyboard or SwiftUI launch view. **Fix:** add a single-color Onyx storyboard with the gold mark centered (no text).

**FH-067 · MEDIUM** — Safe-area-inset coverage is good. `src/components/AppHeader.tsx:69` (top), `src/components/BottomNav.tsx:175` (bottom in drawer + nav), `src/styles/global.css:96` (main padding). Two redundancies exist (`AppHeader` reserves the top inset *and* `.fh-app__main` re-reserves it, producing ~59 px of dead space at the top of every screen) — addressed on `claude/mobile-co-fix` and merged via PR #138. Confirm post-merge by walking the routes on a notched iPhone.

**FH-068 · MEDIUM** — Touch-target audit per FH-038, FH-039: raise header buttons to 40+ and BottomNav icon containers to 40 inside the 44 hit area.

**FH-069 · PASS** — Native gestures preserved. No document-level `touchstart`/`gesturestart` capture. `src/components/SwipeableRow.tsx` and Vaul drawers scope to their own elements. iOS edge-swipe-back will work in a wrapper.

**FH-070 · MEDIUM** — Pull-to-refresh absent on list screens (`Jobs`, `Clients`, `Schedule`, `Invoices`). Not required, but field crews expect it. **Fix:** add `@capacitor/pull-to-refresh`–style component once the wrapper exists; on web, fall back to a manual refresh button.

**FH-071 · HIGH** — Status bar style. `index.html:12` declares `apple-mobile-web-app-status-bar-style="black-translucent"`. For Capacitor, also set per-route via `@capacitor/status-bar`: `Style.Light` on Onyx-backed routes, `Style.Dark` on Linen-backed routes (Login, public docs).

**FH-072 · HIGH** — Permission usage strings. None drafted yet (no `Info.plist`). Draft for each you'll request:
- `NSCameraUsageDescription`: "Fieldhorse uses the camera to capture job photos and signatures so your crew can document work on site."
- `NSPhotoLibraryUsageDescription`: "Fieldhorse needs Photos access to attach existing site photos to a job."
- `NSPhotoLibraryAddUsageDescription`: "Fieldhorse saves generated PDF invoices and proposals to Photos when you tap Save."
- `NSLocationWhenInUseUsageDescription`: "Fieldhorse tags job photos with location so you can find them later by site."
- `NSMicrophoneUsageDescription`: "Fieldhorse records voice notes that auto-fill lead and job details."
- `NSFaceIDUsageDescription`: "Fieldhorse uses Face ID to unlock signed-in sessions on shared devices."

Skip the ones you don't ship in v1. **Generic strings get rejected.**

**FH-073 · BLOCKER** — Privacy manifest missing. `PrivacyInfo.xcprivacy` required for iOS 17+. **Fix:** declare every required-reason API in use (`UserDefaults` C56.1, file timestamp `0A2A.1`, disk space `E174.1`, system boot time `35F9.1` if present), plus data types collected (auth identifiers, contact info, photos, location). Confirm each pinned third-party SDK ships its own `PrivacyInfo.xcprivacy` — Supabase JS does not currently ship one; Sentry/analytics do.

**FH-074 · LOW** — App Tracking Transparency. No tracking SDK detected. **Action:** declare "no tracking" on the nutrition label; no ATT prompt needed.

**FH-075 · LOW** — Sign in with Apple. `src/screens/Login.tsx` offers email/password only. No social auth, so Apple's parity rule does **not** trigger today. If Google/Microsoft auth is added later, Sign in with Apple must appear on the same screen at equal prominence.

**FH-076 · LOW** — Payments. Fieldhorse charges contractors a SaaS subscription (B2B billed outside the app, exempt). The in-app payments are **construction services**, also exempt. No StoreKit needed. Confirm no consumable digital goods are sold inside the app.

**FH-077 · MEDIUM** — Offline capability. Per FH-058, the offline write queue does not exist. For App Store submission, today-assigned jobs, active job detail, photo capture, signature capture, and note writing must all work fully offline. **Status:**
- Read of today's jobs: depends on cache (no `runtimeCaching` set, FH-027).
- Photo capture: works offline only if the queue exists.
- Signature capture: works in-memory but the submit fails offline.
- Notes: insert fails offline.
**Fix:** ship the offline queue (FH-058) and the SW caching (FH-027) before submission. **Submission blocker.**

**FH-078 · LOW** — Minimum iOS version. Recommend iOS 16 floor for Capacitor 6.x. Confirm during wrapper setup.

**FH-079 · MEDIUM** — App Store metadata. No dashes, natural voice, brand wedge.
- **Name (30 char):** `Fieldhorse · Field Ops`
- **Subtitle (30 char):** `Quotes, jobs, paid faster.`
- **Promotional text (100 char):** `Run your day from the truck. Quote, schedule, capture photos, get signed, get paid.`
- **Description (4000 char draft):**
> Fieldhorse is the operating system for contractors who run real jobs from real trucks. Build quotes in under a minute with voice or photo intake. Send pro proposals your customer can sign on the spot. Schedule crews, capture site photos with auto captions, log payments, and watch the money side stay tidy without spreadsheets. Built mobile first so it works one handed, in the sun, in gloves. Recurring jobs roll forward on their own. Change orders, draws, retainage, and final closeouts live next to the work, not in a binder. Bring builder clients into a single job without giving up your book of business. Photo, signature, voice note, payment — every action is one tap and confirmed by haptics so you know it landed even when you can't look. Works offline, syncs the moment signal returns. Designed for trades that bid, build, fix, and bill.

**FH-080 · MEDIUM** — Screenshots. Plan 6 frames per device class (6.7" iPhone Pro Max, 6.5" iPhone 11 Pro Max): Daily brief, job detail with photos, signature capture, jobs list grouped by stage, offline indicator, client roll-up.

**FH-081 · MEDIUM** — App Review notes. Plan a seeded demo tenant: `review@fieldhorse.app` / `Review-2025!`, two clients, six jobs across all stages, two paid invoices, one outstanding. Walkthrough script: log in → land on Home → tap Jobs → open a deal → approve quote → mark complete → log payment → switch to Clients → spin up a new invoice from a client.

**FH-082 · LOW** — Push notifications not in v1. No APNs work required.

**FH-083 · MEDIUM** — Universal Links. No `apple-app-site-association` file under `netlify/` or `public/`. **Fix:** once the bundle ID is final, add `public/.well-known/apple-app-site-association` (no extension, served at root over HTTPS):
```json
{ "applinks": { "details": [{ "appID": "TEAMID.io.fieldhorse.app", "paths": ["/jobs/*", "/clients/*", "/p/*"] }] } }
```
Add the same to `fieldhorse.io` and the Associated Domains entitlement in Xcode.

**FH-084 · MEDIUM** — WebView quirks (Capacitor / WKWebView):
- `showSaveFilePicker` is not implemented; PDF save flows go through `@capacitor/filesystem` once wrapped.
- `navigator.share` is partial; route through `@capacitor/share`.
- `getUserMedia` works but the Capacitor Camera plugin gives the native camera UI (matches expectations).
- IndexedDB quota is smaller than Chrome's; budget photo blobs in the offline queue (cap at 200 MB and offload older items to Supabase Storage on next sync).

### 10. Android parity

**FH-085 · MEDIUM** — Edge-to-edge layout. PWA respects safe-area-inset; for a TWA or Capacitor Android, set `android:windowLayoutInDisplayCutoutMode="shortEdges"` and confirm the BottomNav respects the gesture-bar inset.

**FH-086 · MEDIUM** — Permissions in `AndroidManifest.xml`: `CAMERA`, `READ_MEDIA_IMAGES` (33+), `RECORD_AUDIO`, `ACCESS_FINE_LOCATION`, `POST_NOTIFICATIONS` (if push lands).

**FH-087 · LOW** — Predictive back gesture. Android 14 enables predictive back. Don't intercept the back button at the document level; let React Router handle it.

**FH-088 · MEDIUM** — Play Store Data Safety form. Declare every category collected: account info, contact info (your *crew's* clients, justify as "App functionality, not used for advertising or shared with third parties").

---

## 3. App Store readiness scorecard

| 9 | Item | Status | Smallest next step |
|---|------|--------|---------------------|
| a | Capacitor wrapper | **Missing** | `npm i @capacitor/cli core ios`, `npx cap init`, `npx cap add ios`. |
| b | App icons (all sizes) | **Missing** | Generate the Apple set from the gold-on-onyx mark; populate `AppIcon.appiconset`. |
| c | Launch screen storyboard | **Missing** | Add a single Onyx storyboard with the centered gold mark. |
| d | Safe-area-inset coverage | **Done** | Walk routes on a notched iPhone post-PR #138. |
| e | Touch targets ≥44pt | **Partial** | Raise AppHeader buttons to 40+, BottomNav icon containers to 40 (FH-038, FH-039). |
| f | Native gestures preserved | **Done** | No document-level swipe capture (FH-069). |
| g | Haptics | **Missing** | Wire `@capacitor/haptics` and route from `src/lib/haptics.ts`. |
| h | Status bar style | **Partial** | Add per-route `StatusBar.setStyle` once wrapped (FH-071). |
| i | Permission usage strings | **Missing** | Draft per FH-072; add to `Info.plist` when wrapper exists. |
| j | Privacy manifest (`PrivacyInfo.xcprivacy`) | **Missing** | Declare required-reason APIs + data types (FH-073). |
| k | App Tracking Transparency | **Not applicable** | No tracking SDKs. Declare "no tracking" on the nutrition label. |
| l | Sign in with Apple | **Not applicable** | Login is email/password only. Re-evaluate if social auth lands. |
| m | StoreKit for digital goods | **Not applicable** | B2B SaaS + construction services are exempt (FH-076). |
| n | In-app account deletion | **Missing** | Build the delete-account flow per FH-063. *Blocker.* |
| o | Offline capability | **Missing** | Ship the offline write queue (FH-058) + SW caching (FH-027). *Blocker.* |
| p | Minimum iOS version | **Partial** | Set iOS 16 floor during Capacitor init. |
| q | App Store metadata copy | **Partial** | Drafts in FH-079 ready for review. |
| r | Screenshots | **Missing** | Capture 6 frames per device class on the seeded demo tenant. |
| s | Review notes | **Missing** | Seed the demo tenant and write the walkthrough (FH-081). |
| t | Push notifications | **Not applicable v1** | Defer. |
| u | Universal Links | **Missing** | Publish `apple-app-site-association` once bundle ID is final (FH-083). |
| v | WebView quirks | **Partial** | Map four web APIs to Capacitor plugins (FH-084). |

**Submission-blocking gaps:** wrapper (a), account deletion (n), offline capability (o), launch screen (c), icon set (b), privacy manifest (j), haptics (g).

---

## 4. Prioritized backlog

Five sprints, one week each, in execution order.

### Sprint 1 · Truth & safety (this week)
- **FH-046** ship CSP + the rest of the security headers in `netlify.toml`.
- **FH-047 / FH-048 / FH-049** one Supabase migration that tightens bucket policies, revokes `anon` execute on `rls_auto_enable` and `handle_new_user`, and pins `search_path` on every flagged function.
- **FH-010 / FH-011** repoint `--field-gold` to `#C9963A` and split `--onyx` from `--onyx-deep`; sweep components.
- **FH-015 / FH-016** drop JetBrains Mono + Instrument Serif from `index.html`; deprecate `--font-mono`.
- **FH-060 / FH-061** confirm the two `logPayment` fixes from PR #139 merge.

### Sprint 2 · Manifest & shell hardening
- **FH-024 / FH-025 / FH-026 / FH-029** rebuild the PWA manifest with the full icon set, Linen background, `start_url`, `scope`, `shortcuts`.
- **FH-027 / FH-028** wire `runtimeCaching` per route type + ship `public/offline.html`.
- **FH-058** *start* the IndexedDB offline write queue (mutation outbox + idempotency keys); ship a behind-flag prototype.
- **FH-038 / FH-039** raise touch targets in `AppHeader` and `BottomNav`.

### Sprint 3 · Performance & copy
- **FH-030 / FH-031 / FH-032 / FH-033 / FH-034** vendor-split + dynamic-import `jsPDF`/`html2canvas`; replace Sparkline's recharts dependency.
- **FH-018 / FH-019** one PR that sweeps em + en dashes from user-facing strings; add the ESLint rule.
- **FH-052** start the `.select('*')` → projection sweep; do five highest-traffic files.
- **FH-001 / FH-002 / FH-003 / FH-004** decompose `Home.tsx` (extract `composeNextActions` first); set the template the other monoliths follow.

### Sprint 4 · App Store rails
- **FH-062** Capacitor init, iOS platform add, basic build green.
- **FH-063** in-app account deletion (server delete via Edge Function).
- **FH-064** route haptics through `@capacitor/haptics`.
- **FH-072** draft `Info.plist` usage strings, only for the permissions v1 ships.
- **FH-073** ship `PrivacyInfo.xcprivacy`.

### Sprint 5 · Submission
- **FH-065 / FH-066** icon set + launch storyboard.
- **FH-077** verify the four offline-critical flows actually work fully offline.
- **FH-083** universal links wired and verified.
- **FH-080 / FH-081** capture six screenshots, seed the demo tenant, write reviewer notes.
- Submit to TestFlight, internal track only, before public review.

---

*Audit produced read-only from `claude/audit` (= `origin/main`@`912f633`). PR #139 (`claude/test-suite`) already addresses FH-060 and FH-061 and adds a CI workflow that catches future regressions on the tested logic.*
