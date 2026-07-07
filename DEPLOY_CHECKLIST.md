# Fieldhorse v2 — Deploy Checklist

Premium migration (phases 0-12) complete. This checklist walks a drag-and-drop deploy to Netlify and the 60-second smoke test after.

---

## 1. Drag-and-drop folder

**Absolute path** to the production build:

```
C:\Users\Jesse\OneDrive\Documents\Claude\Projects\Command App Project\fieldhorse-v2\dist
```

Drop this entire folder onto the Netlify Deploys zone for your Fieldhorse site.

Contents that MUST be present (verify before drag):

| File | Purpose |
|---|---|
| `index.html` | SPA entry point (~1.5 KB) |
| `assets/index-*.js` | Main JS bundle (~879 KB, ~258 KB gzipped) |
| `assets/index-*.css` | Tailwind v4 + tokens + `.fh-*` + FX (~150 KB) |
| `_redirects` | **Critical.** `/*  /index.html  200` — without this, deep links (e.g., `/jobs/:id` on refresh) return 404 |
| `manifest.webmanifest` | PWA metadata (name=Fieldhorse, theme=#141414, icons) |
| `registerSW.js` | Service-worker register bootstrap |
| `favicon.svg`, `icon.svg`, `icon-192.png`, `icon-512.png`, `apple-touch-icon.png` | Icon set |

If `_redirects` is ever missing from a future build, re-run `npm run build` after confirming `public/_redirects` exists at repo root.

---

## 2. Netlify environment variables

**Do not hardcode.** Set them at **Site Settings → Environment variables** in the Netlify dashboard, then trigger a redeploy (or the next deploy will pick them up automatically).

| Variable | Scope | Value source | Notes |
|---|---|---|---|
| `VITE_SUPABASE_URL` | **Client** (baked into bundle) | `https://pnmhblvslftdzfcdezbw.supabase.co` | Same as `.env.local`. Public — safe to ship in client bundle. |
| `VITE_SUPABASE_ANON_KEY` | **Client** (baked into bundle) | anon JWT from Supabase → Project Settings → API | Same as `.env.local`. Public — RLS is what protects data, not this key. |
| `ANTHROPIC_API_KEY` | **Server only** (Netlify Functions) — no `VITE_` prefix | Copy from https://console.anthropic.com → API keys | Must NOT have a `VITE_` prefix or it ends up in the client bundle. Used by `netlify/functions/claude.js` for AI Compose / AI Bid / AI Notes parse. |

After setting: **Deploys tab → Trigger deploy → Deploy site** (so the new vars bake into the next build; drag-and-drop deploys skip the build step, so variables set after a drag-and-drop deploy only take effect on the NEXT deploy).

Optional: if Jesse wants to surface a non-default Claude model on the client side, set `VITE_ANTHROPIC_MODEL` (currently defaults to `claude-sonnet-5`).

---

## 3. Post-deploy smoke test (≤60 seconds)

Open https://fieldhorse.io and run through these in order. If any fails, roll back (step 4).

1. **Login page renders with premium styling**
   - Aurora drifting + subtle grid pattern behind the card
   - Serif italic hero: "Welcome, *operator.*"
   - Gold-gradient "SIGN IN" button with right arrow
   - No subtitle (the killed "Your rig. Your bids. Your numbers." is gone)

2. **Sign in works**
   - Enter credentials → lands on `/` (Home) without a 500/401
   - If auth fails: check `VITE_SUPABASE_*` env vars were saved and a fresh deploy ran afterward

3. **Home renders real data**
   - Serif italic "Morning, *{FirstName}.*" greeting (or "Morning, *there.*" if full_name is blank)
   - KPI cards animate `CountUp` from 0 → real values (Pipeline, Active, Notes)
   - Gold weekly target card with shimmer bar + "N% of $25K"
   - If `profile.location_lat` set → weather + Pour card render; else "Pin location for weather" button

4. **⌘K palette works**
   - Press Cmd+K (Mac) or Ctrl+K (Win/Linux) anywhere
   - Four grouped sections appear: Quick actions / Navigate / Money tools / System
   - Type `schedule` + Enter → routes to `/schedule`

5. **Jobs → drawer → ContactDetail**
   - `/jobs` tab via bottom nav
   - Tap any contact card → Vaul drawer slides up from bottom with Text / Email / Call / Open tiles
   - Tap "Open" (gold gradient) → routes to `/jobs/:id`
   - Detail screen shows serif italic "{First} *{Last}.*" title with colored stage pill above

6. **At least one Sonner toast fires** (save a test note)
   - `/notes` tab
   - Type "smoke test" + "SAVE NOTE"
   - Expect: row appears in list (Lucide icon + timestamp + "smoke test" body) AND top-center green toast "Note saved / Synced across devices"
   - Delete the test note via the trash icon

7. **Theme toggle persists**
   - `/settings` tab
   - Toggle the light/dark shadcn Switch
   - Hard refresh the page — theme should persist (ThemeContext writes to localStorage)

---

## 4. Rollback plan

**If any smoke test fails**, don't push a hotfix — roll back first, debug locally, redeploy clean.

### Fastest rollback (Netlify UI)

1. Netlify dashboard → your Fieldhorse site → **Deploys** tab
2. Find the previous successful deploy (before today's deploy)
3. Click the `...` menu on that row → **Publish deploy**
4. Propagation is near-instant; verify `fieldhorse.io` is back within 30-60s

### Rebuild from a known-good commit

Local git history (as of this checklist):

| Commit | What it is |
|---|---|
| `1588206` | Phase 12 cleanup — current HEAD, what you're deploying now |
| `ed020ee` | Premium migration phases 2-11 complete (10 screens upgraded, before Sonner toast wiring) |
| `79700aa` | Pre-premium snapshot (original unmodified app) |

To rebuild from any of those:

```bash
cd "c:\Users\Jesse\OneDrive\Documents\Claude\Projects\Command App Project\fieldhorse-v2"
git checkout <commit-sha>
npm run build
# drag dist/ to Netlify
git checkout main   # return to HEAD when done
```

The `pre-premium-backup` branch (at `79700aa`) is the full escape hatch if the premium stack itself needs to be reverted.

---

## 5. Known gaps and non-blockers

These are intentional and don't block deploy — just documented so nothing feels unexpected post-deploy.

- **AI-parsed notes don't persist.** `fh_notes` schema only has a `text` column, no `parsed jsonb`. AI parse output renders in the capture card but disappears on save. To enable persistence, run [`supabase/migrations/003_add_notes_parsed.sql`](supabase/migrations/003_add_notes_parsed.sql) in the Supabase SQL Editor (optional).
- **Bundle size warning.** Main JS chunk is 879 KB (258 KB gzipped) — above Vite's 500 KB soft limit. Acceptable for a 10-screen contractor app. Future optimization: code-split per-route via `React.lazy()` or `manualChunks` in `vite.config.js`. No functional issue.
- **Three pre-existing JSX parser warnings** in [`src/screens/ContactDetail.jsx`](src/screens/ContactDetail.jsx) at lines 654, 786, 954 (`}}` pattern). esbuild tolerates these and the file compiles + runs correctly. Not touching since "fixing" them risks breaking the known-working tab rendering.
- **Shadcn-auto-generated wrapper at `src/components/ui/sonner.jsx`** imports `useTheme` from `next-themes` (not installed). Dead file — nothing imports it. AppShell's `<SonnerToaster>` comes directly from the `sonner` package. Can delete the wrapper file if wanted, no effect either way.
- **One first-paint click-target race** on the Vaul drawer "Open" tile: the very first coordinate-based click within the first ~300 ms of drawer open may register as drawer-dismiss instead of tile-click. Real-user finger taps won't hit this window. Low priority.

---

## 6. Ready state

At `1588206`:
- ✅ Build succeeds in 43.94s, zero errors
- ✅ 1.1 MB total dist/ size
- ✅ `_redirects` present (created this phase)
- ✅ PWA manifest + icons valid
- ✅ Preview server serves all assets HTTP 200
- ✅ SPA deep-link fallback working
- ✅ Netlify Functions present (`claude.js`, `webhook-lead.js`)
- ✅ Zero kill-list leaks in src/ (grep verified)
- ✅ Zero brand-name leaks (Parker/Jesse/parkerconstruction) in src/
- ✅ Schema mismatch fixed (fh_notes body → text)
- ✅ Sonner responsive config applied

Drag `dist/` to Netlify when ready.
