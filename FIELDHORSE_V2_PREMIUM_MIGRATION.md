# FIELDHORSE V2 — PREMIUM STACK MIGRATION

**Run inside `C:\Users\Jesse\Desktop\fieldhorse-v2`**
Goal: layer the premium UI stack (shadcn/ui + Tailwind v4 + Motion + Aceternity FX + Vaul + Sonner + cmdk + Lucide) on top of the existing app **without breaking any working flows**. Preserve react-router, Supabase Auth, ProfileContext, ThemeContext, all 13 screens, and the entire `global.css` / `tokens.css` system.

---

## GROUND TRUTH (audited from the deployed repo zip — do not assume otherwise)

### Already in the repo — DO NOT REPLACE
- **React Router v6** in `src/App.jsx` with `RequireAuth`, `RequireOnboarded`, `Gated` wrappers. Routes: `/login`, `/reset-password`, `/onboarding`, `/`, `/jobs`, `/jobs/:id`, `/notes`, `/schedule`, `/bid`, `/compose`, `/analytics`, `/import`, `/settings`. Wildcard redirect to `/`.
- **Supabase Auth** via `src/contexts/AuthContext.jsx` — `signIn`, `signUp`, `signOut`, `sendPasswordReset` (with `/reset-password` redirect), `updatePassword`. Session refresh via `supabase.auth.onAuthStateChange`.
- **Profile context** via `src/contexts/ProfileContext.jsx` — reads `profiles` table, gates app on `onboarded_at`.
- **Theme context** via `src/contexts/ThemeContext.jsx` — light/dark.
- **Provider tree** in `src/main.jsx`: `BrowserRouter > ThemeProvider > AuthProvider > ProfileProvider > App`. Both stylesheets imported here: `tokens.css`, `global.css`.
- **13 screens** in `src/screens/`: Analytics, Bid, Compose, ContactDetail (948 lines — heaviest), Home, Importer, Jobs, Login, Notes, Onboarding, ResetPassword, Schedule, Settings.
- **13 components** in `src/components/`: ActionSheet, AppShell, BottomNav, CommandPalette (custom cmdk-style with `Cmd/Ctrl+K`), EmptyState, LogoUploader, Monogram, NewLeadSheet, Skeleton, SpecTabs, Toaster (custom via `fh:toast` window event), Wordmark, plus `icons/Icon.jsx`.
- **Custom Icon system** at `src/components/icons/Icon.jsx` (your own brand glyph set — keep it; Lucide is *additive*, not a replacement).
- **framer-motion v11.11.9** already a dependency. Used by AppShell, BottomNav, CommandPalette, Toaster, Skeleton, ActionSheet, and 8 screens. **Import from `framer-motion`** — do not switch to the `motion/react` package.
- **Design tokens** in `src/styles/tokens.css` — brand palette, typography, spacing, motion curves, z-layers, light + dark themes.
- **Global stylesheet** `src/styles/global.css` (4,780 lines of `.fh-*` classes — every screen depends on these). Has film-grain noise overlay built in.
- **Supabase schema** in `supabase/migrations/002_full_schema.sql` — 8 tables (`fh_contacts`, `fh_notes`, `fh_schedule`, `fh_subs`, `fh_expenses`, `fh_payments`, `fh_inspections`, `fh_mileage`) with `user_id = auth.uid()` RLS policies. **RLS is correct.** Storage buckets `jobphotos` (public read) and `receipts` (private). `profiles` table has `webhook_key`, `subscription_tier`, `preferences` jsonb.
- **vite.config.js** has `vite-plugin-pwa` configured with manifest. **Preserve the PWA plugin.**
- **package.json** dependencies: `@supabase/supabase-js@^2.45.4`, `framer-motion@^11.11.9`, `jspdf@^2.5.2`, `jspdf-autotable@^3.8.4`, `papaparse@^5.4.1`, `react@^18.3.1`, `react-dom@^18.3.1`, `react-router-dom@^6.26.2`. Dev: `vite@^5.4.8`, `vite-plugin-pwa@^0.20.5`, `@vitejs/plugin-react@^4.3.2`.

### NOT in the repo — to add this session
- Tailwind v4 (additive layer, prefixed `ui-`)
- shadcn/ui (New York style, alongside existing components)
- Vaul (bottom sheets for job quick-actions)
- Sonner (premium toasts, bridged with existing `fh:toast` event)
- cmdk (upgraded CommandPalette with fuzzy search)
- Lucide React (supplementary icons for UI chrome)
- Premium FX components (Aurora, Spotlight, Shimmer, ScanLine, GridPattern, GreetingTitle, CountUp) — pure CSS + framer-motion, no library
- Instrument Serif font (hero italic moments)

### DO NOT DO THIS SESSION
- ❌ Do not build Partner Tracker or Inspection Tracker (deferred)
- ❌ Do not replace react-router with single-state nav
- ❌ Do not replace Supabase AuthContext with localStorage
- ❌ Do not delete or rewrite `global.css` or `tokens.css`
- ❌ Do not install the `motion` package (keep using `framer-motion`)
- ❌ Do not install `@tanstack/react-query` or `zustand` (the existing data fetching pattern works)
- ❌ Do not run `npx shadcn init` with overwrite — it will clobber the `components.json` written below

---

## PHASE 0 — SAFETY NET (≈ 5 min)

```bash
cd C:\Users\Jesse\Desktop\fieldhorse-v2
git status
git add -A
git commit -m "chore: pre-premium-upgrade snapshot" --allow-empty
git branch pre-premium-backup
npm run dev
```

Confirm dev server boots at `http://localhost:5173`. Render Home screen successfully. If it does not boot, **STOP and report**.

Also tell Jesse to run this in the **Supabase SQL editor** (it's a manual step — Claude Code cannot do this from the laptop):

```sql
-- Cleanup stray test events from dev sessions
delete from public.fh_schedule
where title ilike '%garage pour%' or title ilike '%clear to work%';
```

Report how many rows were deleted.

**👋 CHECK-IN 0** — git branch ✓ · dev boots ✓ · stale rows deleted: ___ · wait for Jesse's "go" before Phase 1.

---

## PHASE 1 — INSTALL DEPENDENCIES

One install pass (combine if you want):

```bash
npm install tailwindcss@next @tailwindcss/vite@next
npm install class-variance-authority clsx tailwind-merge
npm install vaul sonner cmdk lucide-react
npm install @radix-ui/react-slot @radix-ui/react-dialog @radix-ui/react-tabs @radix-ui/react-popover @radix-ui/react-tooltip @radix-ui/react-toggle-group @radix-ui/react-avatar @radix-ui/react-progress @radix-ui/react-separator @radix-ui/react-switch @radix-ui/react-scroll-area @radix-ui/react-dropdown-menu @radix-ui/react-label
```

Update `vite.config.js` — **PRESERVE the existing VitePWA block exactly**, just add the Tailwind plugin and the `@` alias:

```javascript
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import path from 'path'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      registerType: 'autoUpdate',
      includeAssets: ['favicon.svg', 'icon.svg', 'apple-touch-icon.png'],
      manifest: {
        name: 'Fieldhorse',
        short_name: 'Fieldhorse',
        description: 'Contractor field operations',
        theme_color: '#141414',
        background_color: '#141414',
        display: 'standalone',
        orientation: 'portrait',
        icons: [
          { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
          { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' }
        ]
      }
    })
  ],
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') }
  },
  server: { port: 5173, host: true }
})
```

Create `jsconfig.json` at repo root:

```json
{
  "compilerOptions": {
    "baseUrl": ".",
    "paths": { "@/*": ["./src/*"] }
  }
}
```

Create `components.json` at repo root (this replaces the `npx shadcn init` step — do NOT run init):

```json
{
  "$schema": "https://ui.shadcn.com/schema.json",
  "style": "new-york",
  "rsc": false,
  "tsx": false,
  "tailwind": {
    "config": "",
    "css": "src/styles/global.css",
    "baseColor": "neutral",
    "cssVariables": true,
    "prefix": "ui-"
  },
  "aliases": {
    "components": "@/components",
    "utils": "@/lib/utils",
    "ui": "@/components/ui",
    "lib": "@/lib",
    "hooks": "@/hooks"
  },
  "iconLibrary": "lucide"
}
```

> **Why `prefix: "ui-"`:** isolates every shadcn Tailwind class so it never collides with the 4,780 lines of `.fh-*` classes already in `global.css`. This is what makes the migration non-destructive.

Add Instrument Serif to `index.html`. Find any existing Google Fonts `<link>` and append `Instrument+Serif:ital@0;1`. If none exists, add inside `<head>`:

```html
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Bebas+Neue&family=DM+Sans:wght@300;400;500;600;700;800&family=Instrument+Serif:ital@0;1&display=swap" rel="stylesheet">
```

**👋 CHECK-IN 1** — installs ✓ · vite.config.js merged with PWA preserved ✓ · components.json created ✓ · Instrument Serif loaded ✓.

---

## PHASE 2 — TAILWIND v4 ADDITIVE LAYER

**Do NOT delete `global.css`. Do NOT delete `tokens.css`.** You are *prepending* to global.css.

Open `src/styles/global.css`. Insert this block at the **very top of the file** (above the existing line 1 `*, *::before, *::after { box-sizing: border-box; }`):

```css
/* ================================================================
   TAILWIND v4 ADDITIVE LAYER — coexists with .fh-* classes below.
   All Tailwind utilities are prefixed `ui-` so they never collide.
   DO NOT REMOVE THIS BLOCK.
   ================================================================ */
@import "tailwindcss" prefix(ui);

@theme inline {
  /* Brand palette exposed to Tailwind under fh- color namespace */
  --color-fh-gold: var(--field-gold);
  --color-fh-gold-hot: var(--field-gold-hot);
  --color-fh-gold-bright: var(--field-gold-bright);
  --color-fh-gold-deep: var(--field-gold-deep);
  --color-fh-onyx: var(--onyx);
  --color-fh-onyx-2: var(--onyx-2);
  --color-fh-linen: var(--raw-linen);
  --color-fh-red: var(--alert-red);
  --color-fh-green: var(--signal-green);
  --color-fh-steel: var(--steel);

  /* shadcn semantic tokens — auto-themed via your existing ThemeContext */
  --color-background: var(--surface-0);
  --color-foreground: var(--ink-strong);
  --color-card: var(--surface-1);
  --color-card-foreground: var(--ink-strong);
  --color-popover: var(--surface-1);
  --color-popover-foreground: var(--ink-strong);
  --color-muted: var(--surface-2);
  --color-muted-foreground: var(--ink-muted);
  --color-primary: var(--field-gold);
  --color-primary-foreground: var(--onyx);
  --color-secondary: var(--surface-2);
  --color-secondary-foreground: var(--ink-strong);
  --color-accent: var(--surface-2);
  --color-accent-foreground: var(--ink-strong);
  --color-destructive: var(--alert-red);
  --color-destructive-foreground: var(--raw-linen);
  --color-border: var(--rule);
  --color-input: var(--rule);
  --color-ring: var(--field-gold);

  --font-display: 'Bebas Neue', 'Helvetica Neue', sans-serif;
  --font-body: 'DM Sans', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-serif: 'Instrument Serif', Georgia, serif;

  --radius-xs: 0px;
  --radius-sm: 2px;
  --radius-md: 4px;
  --radius-lg: 6px;
  --radius-xl: 12px;
  --radius-2xl: 16px;
  --radius: 6px;
}

/* Premium FX keyframes */
@keyframes fh-aurora-drift {
  0%, 100% { transform: translate(0, 0) scale(1); }
  50% { transform: translate(30px, 40px) scale(1.1); }
}
@keyframes fh-spotlight-breathe {
  0%, 100% { opacity: 0.5; transform: scale(1); }
  50% { opacity: 0.9; transform: scale(1.12); }
}
@keyframes fh-shimmer-sweep {
  0% { transform: translateX(-120%); }
  100% { transform: translateX(120%); }
}
@keyframes fh-scan-line {
  0%, 100% { transform: translateX(-100%); opacity: 0; }
  50% { transform: translateX(100%); opacity: 1; }
}
@keyframes fh-pulse-dot {
  0%, 100% { opacity: 1; transform: scale(1); }
  50% { opacity: 0.5; transform: scale(0.85); }
}

/* Premium FX utility classes */
.fh-fx-aurora { position: absolute; inset: 0; overflow: hidden; pointer-events: none; z-index: 0; }
.fh-fx-aurora__a {
  position: absolute; top: -200px; left: -100px;
  width: 500px; height: 500px;
  background: radial-gradient(circle, rgba(201,150,58,0.22), transparent 60%);
  filter: blur(60px);
  animation: fh-aurora-drift 20s ease-in-out infinite;
}
.fh-fx-aurora__b {
  position: absolute; bottom: -150px; right: -150px;
  width: 450px; height: 450px;
  background: radial-gradient(circle, rgba(120,60,220,0.14), transparent 60%);
  filter: blur(70px);
  animation: fh-aurora-drift 25s ease-in-out infinite reverse;
}
[data-theme='light'] .fh-fx-aurora__a { background: radial-gradient(circle, rgba(201,150,58,0.15), transparent 60%); }
[data-theme='light'] .fh-fx-aurora__b { background: radial-gradient(circle, rgba(120,60,220,0.08), transparent 60%); }

.fh-fx-grid {
  position: absolute; inset: 0; pointer-events: none; z-index: 0;
  background-image:
    linear-gradient(rgba(255,255,255,0.02) 1px, transparent 1px),
    linear-gradient(90deg, rgba(255,255,255,0.02) 1px, transparent 1px);
  background-size: 40px 40px;
}
[data-theme='light'] .fh-fx-grid {
  background-image:
    linear-gradient(rgba(20,20,20,0.025) 1px, transparent 1px),
    linear-gradient(90deg, rgba(20,20,20,0.025) 1px, transparent 1px);
}

.fh-fx-spotlight {
  position: absolute; pointer-events: none;
  width: 200px; height: 200px;
  border-radius: 50%;
  background: radial-gradient(circle, rgba(232,176,76,0.4), transparent 60%);
  animation: fh-spotlight-breathe 4s ease-in-out infinite;
}

.fh-fx-shimmer-bar {
  position: relative; overflow: hidden;
  height: 6px; border-radius: 999px;
  background: rgba(255,255,255,0.08);
}
.fh-fx-shimmer-bar__fill {
  height: 100%;
  background: linear-gradient(90deg, var(--field-gold-deep), var(--field-gold-bright), var(--field-gold-hot));
  border-radius: 999px;
  box-shadow: 0 0 20px rgba(232,176,76,0.5);
  position: relative;
}
.fh-fx-shimmer-bar__fill::after {
  content: ''; position: absolute;
  top: 0; right: 0; width: 30%; height: 100%;
  background: linear-gradient(90deg, transparent, rgba(255,255,255,0.5), transparent);
  animation: fh-shimmer-sweep 2s infinite;
}

.fh-fx-scan-line {
  position: absolute; top: 0; left: 0; right: 0; height: 2px;
  background: linear-gradient(90deg, transparent, var(--field-gold-bright), transparent);
  animation: fh-scan-line 3s ease-in-out infinite;
}

.fh-fx-pulse-dot { animation: fh-pulse-dot 2s infinite; }

.fh-text-gradient-gold {
  background: linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-hot), var(--field-gold));
  -webkit-background-clip: text;
  -webkit-text-fill-color: transparent;
  background-clip: text;
}

.fh-font-serif { font-family: var(--font-serif); }
.fh-font-serif-italic { font-family: var(--font-serif); font-style: italic; }

/* END TAILWIND v4 ADDITIVE LAYER */
```

Run `npm run dev`. If Tailwind throws on `@import` or `@theme inline`, **stop and report** — confirm `tailwindcss@next` and `@tailwindcss/vite@next` are the installed versions, not the stable ones.

**👋 CHECK-IN 2** — dev still boots ✓ · existing screens still render with `.fh-*` classes ✓ · Aurora keyframes parse without error ✓.

---

## PHASE 3 — ADD SHADCN COMPONENTS

Create `src/lib/utils.js`:

```javascript
import { clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs) {
  return twMerge(clsx(inputs))
}
```

Pull shadcn components one at a time (batched calls sometimes fail silently). If any prompts to install a package, answer **yes**:

```bash
npx shadcn@latest add button --overwrite
npx shadcn@latest add card --overwrite
npx shadcn@latest add badge --overwrite
npx shadcn@latest add input --overwrite
npx shadcn@latest add textarea --overwrite
npx shadcn@latest add label --overwrite
npx shadcn@latest add select --overwrite
npx shadcn@latest add tabs --overwrite
npx shadcn@latest add dialog --overwrite
npx shadcn@latest add sheet --overwrite
npx shadcn@latest add avatar --overwrite
npx shadcn@latest add progress --overwrite
npx shadcn@latest add separator --overwrite
npx shadcn@latest add scroll-area --overwrite
npx shadcn@latest add toggle-group --overwrite
npx shadcn@latest add switch --overwrite
npx shadcn@latest add dropdown-menu --overwrite
npx shadcn@latest add popover --overwrite
npx shadcn@latest add tooltip --overwrite
npx shadcn@latest add skeleton --overwrite
npx shadcn@latest add command --overwrite
npx shadcn@latest add sonner --overwrite
```

If `sonner` shadcn component fails: that's fine — we import directly from the `sonner` package next phase.

Everything lands in `src/components/ui/` (a NEW folder — your existing `src/components/` files are untouched).

**👋 CHECK-IN 3** — list every file now under `src/components/ui/`.

---

## PHASE 4 — PREMIUM FX COMPONENTS

Create folder `src/components/fx/` with these files.

**`src/components/fx/Aurora.jsx`**
```jsx
export default function Aurora({ className = '' }) {
  return (
    <div className={`fh-fx-aurora ${className}`} aria-hidden="true">
      <div className="fh-fx-aurora__a" />
      <div className="fh-fx-aurora__b" />
    </div>
  )
}
```

**`src/components/fx/GridPattern.jsx`**
```jsx
export default function GridPattern({ className = '' }) {
  return <div className={`fh-fx-grid ${className}`} aria-hidden="true" />
}
```

**`src/components/fx/Spotlight.jsx`**
```jsx
export default function Spotlight({ className = '', style = {} }) {
  return <div className={`fh-fx-spotlight ${className}`} style={style} aria-hidden="true" />
}
```

**`src/components/fx/ShimmerBar.jsx`**
```jsx
export default function ShimmerBar({ value = 0, className = '' }) {
  const pct = Math.max(0, Math.min(100, value))
  return (
    <div className={`fh-fx-shimmer-bar ${className}`}>
      <div className="fh-fx-shimmer-bar__fill" style={{ width: `${pct}%` }} />
    </div>
  )
}
```

**`src/components/fx/ScanLine.jsx`**
```jsx
export default function ScanLine({ className = '' }) {
  return <span className={`fh-fx-scan-line ${className}`} aria-hidden="true" />
}
```

**`src/components/fx/GreetingTitle.jsx`**
```jsx
export default function GreetingTitle({ prefix = 'Morning,', name = 'Jesse' }) {
  return (
    <h1
      className="fh-font-serif"
      style={{
        fontSize: 'clamp(32px, 8vw, 42px)',
        lineHeight: 1,
        letterSpacing: '-0.02em',
        margin: 0,
        fontWeight: 400
      }}
    >
      {prefix}
      <br />
      <em className="fh-font-serif-italic fh-text-gradient-gold">{name}.</em>
    </h1>
  )
}
```

**`src/components/fx/CountUp.jsx`**
```jsx
import { animate, motion, useMotionValue, useTransform } from 'framer-motion'
import { useEffect } from 'react'

export default function CountUp({ to = 0, duration = 1.2, prefix = '', suffix = '', formatter }) {
  const count = useMotionValue(0)
  const rounded = useTransform(count, (v) => {
    const n = Math.round(v)
    if (formatter) return formatter(n)
    return n.toLocaleString()
  })
  useEffect(() => {
    const controls = animate(count, to, { duration, ease: [0.32, 0.72, 0, 1] })
    return controls.stop
  }, [to, duration])
  return (
    <motion.span>
      {prefix}
      <motion.span>{rounded}</motion.span>
      {suffix}
    </motion.span>
  )
}
```

**👋 CHECK-IN 4** — all 7 fx files created ✓.

---

## PHASE 5 — WIRE FX INTO APPSHELL + BRIDGE SONNER

Replace the entire contents of `src/components/AppShell.jsx`:

```jsx
import { useEffect } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Toaster as SonnerToaster } from 'sonner'
import BottomNav from './BottomNav.jsx'
import CommandPalette from './CommandPalette.jsx'
import Toaster from './Toaster.jsx'
import Aurora from './fx/Aurora.jsx'
import GridPattern from './fx/GridPattern.jsx'

export default function AppShell() {
  const location = useLocation()

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'instant' })
  }, [location.pathname])

  return (
    <div className="fh-app" style={{ position: 'relative' }}>
      <Aurora />
      <GridPattern />

      <div className="fh-page-corners" aria-hidden="true">
        <span className="fh-corner fh-corner--tl" />
        <span className="fh-corner fh-corner--tr" />
        <span className="fh-corner fh-corner--bl" />
        <span className="fh-corner fh-corner--br" />
      </div>

      <AnimatePresence mode="wait">
        <motion.main
          key={location.pathname}
          className="fh-app__main"
          style={{ position: 'relative', zIndex: 1 }}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -4 }}
          transition={{ duration: 0.22, ease: [0.2, 0.8, 0.2, 1] }}
        >
          <Outlet />
        </motion.main>
      </AnimatePresence>

      <BottomNav />
      <CommandPalette />

      {/* Existing custom toaster stays — Sonner runs alongside it */}
      <Toaster />
      <SonnerToaster
        position="top-center"
        theme="dark"
        richColors
        closeButton
        toastOptions={{
          style: {
            background: 'rgba(20,20,20,0.95)',
            color: 'var(--ink-strong)',
            border: '1px solid rgba(232,176,76,0.25)',
            fontFamily: 'var(--font-body)',
            backdropFilter: 'blur(30px)'
          }
        }}
      />
    </div>
  )
}
```

Replace `src/lib/toast.js` so existing `fh:toast` callers keep working AND new code can use Sonner directly:

```javascript
import { toast as sonnerToast } from 'sonner'

let idCounter = 0

function emitLegacy(message, opts = {}) {
  const detail = {
    id: ++idCounter,
    message,
    accent: opts.accent || 'default',
    duration: opts.duration || 3200
  }
  window.dispatchEvent(new CustomEvent('fh:toast', { detail }))
}

export function toast(message, opts = {}) {
  emitLegacy(message, opts)
  if (opts.variant === 'success') sonnerToast.success(message, { description: opts.description })
  else if (opts.variant === 'error') sonnerToast.error(message, { description: opts.description })
  else sonnerToast(message, { description: opts.description })
}

export const toastSuccess = (message, description) => toast(message, { variant: 'success', description })
export const toastError = (message, description) => toast(message, { variant: 'error', description })
export const toastInfo = (message, description) => toast(message, { description })

export { sonnerToast }
```

**👋 CHECK-IN 5** — Aurora + Grid visible behind every screen ✓ · custom Toaster + Sonner both mounted ✓ · open Home and confirm gold glow drifts in background.

---

## PHASE 6 — UPGRADE COMMAND PALETTE TO CMDK

Replace the entire contents of `src/components/CommandPalette.jsx`:

```jsx
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command'
import {
  Home, Briefcase, FileText, Calendar, Calculator, MessageSquare,
  BarChart3, Upload, Settings, Plus, Mic
} from 'lucide-react'

const QUICK_ACTIONS = [
  { id: 'newLead', label: 'New lead', hint: 'Open pipeline card', icon: Plus, to: '/jobs?new=1' },
  { id: 'voice', label: 'Voice capture', hint: 'Dictate a note', icon: Mic, to: '/notes?voice=1' }
]
const NAV_ITEMS = [
  { id: 'home', label: 'Home', hint: 'Morning brief', icon: Home, to: '/' },
  { id: 'jobs', label: 'Jobs', hint: 'Pipeline', icon: Briefcase, to: '/jobs' },
  { id: 'notes', label: 'Field notes', hint: 'Capture anything', icon: FileText, to: '/notes' },
  { id: 'schedule', label: 'Schedule', hint: 'Day / week / month', icon: Calendar, to: '/schedule' }
]
const MONEY_ITEMS = [
  { id: 'bid', label: 'AI Bid Engine', hint: 'Scope to number', icon: Calculator, to: '/bid' },
  { id: 'compose', label: 'AI Compose', hint: 'Draft a message', icon: MessageSquare, to: '/compose' },
  { id: 'analytics', label: 'Analytics', hint: 'Pipeline + margin', icon: BarChart3, to: '/analytics' }
]
const SYSTEM_ITEMS = [
  { id: 'import', label: 'Import data', hint: 'CSV + webhooks', icon: Upload, to: '/import' },
  { id: 'settings', label: 'Settings', hint: 'Profile + billing', icon: Settings, to: '/settings' }
]

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function run(item) {
    setOpen(false)
    navigate(item.to)
  }

  function renderGroup(heading, items) {
    return (
      <CommandGroup heading={heading}>
        {items.map((it) => {
          const I = it.icon
          return (
            <CommandItem key={it.id} onSelect={() => run(it)} className="ui-gap-3">
              <I className="ui-text-fh-gold-bright" style={{ width: 16, height: 16 }} />
              <div className="ui-flex ui-flex-col">
                <span>{it.label}</span>
                <span className="ui-text-xs ui-text-muted-foreground">{it.hint}</span>
              </div>
            </CommandItem>
          )
        })}
      </CommandGroup>
    )
  }

  return (
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search jobs, contacts, screens..." />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {renderGroup('Quick actions', QUICK_ACTIONS)}
        <CommandSeparator />
        {renderGroup('Navigate', NAV_ITEMS)}
        <CommandSeparator />
        {renderGroup('Money tools', MONEY_ITEMS)}
        <CommandSeparator />
        {renderGroup('System', SYSTEM_ITEMS)}
      </CommandList>
    </CommandDialog>
  )
}
```

**👋 CHECK-IN 6** — `Cmd+K` opens fuzzy search dialog · type "schedule" + Enter routes to /schedule ✓.

---

## PHASE 7 — ENSURE VAUL DRAWER WRAPPER EXISTS

If shadcn drawer didn't install in Phase 3, create `src/components/ui/drawer.jsx`:

```jsx
import * as React from 'react'
import { Drawer as VaulDrawer } from 'vaul'
import { cn } from '@/lib/utils'

const Drawer = ({ shouldScaleBackground = true, ...props }) => (
  <VaulDrawer.Root shouldScaleBackground={shouldScaleBackground} {...props} />
)
Drawer.displayName = 'Drawer'

const DrawerTrigger = VaulDrawer.Trigger
const DrawerPortal = VaulDrawer.Portal
const DrawerClose = VaulDrawer.Close

const DrawerOverlay = React.forwardRef(({ className, ...props }, ref) => (
  <VaulDrawer.Overlay
    ref={ref}
    className={cn('ui-fixed ui-inset-0 ui-z-50 ui-bg-black/70 ui-backdrop-blur-sm', className)}
    {...props}
  />
))
DrawerOverlay.displayName = 'DrawerOverlay'

const DrawerContent = React.forwardRef(({ className, children, ...props }, ref) => (
  <DrawerPortal>
    <DrawerOverlay />
    <VaulDrawer.Content
      ref={ref}
      className={cn(
        'ui-fixed ui-inset-x-0 ui-bottom-0 ui-z-50 ui-mt-24 ui-flex ui-h-auto ui-flex-col ui-rounded-t-[22px] ui-border ui-border-white/10 ui-bg-fh-onyx ui-shadow-2xl',
        className
      )}
      {...props}
    >
      <div className="ui-mx-auto ui-mt-3 ui-h-1 ui-w-9 ui-rounded-full ui-bg-white/20" />
      {children}
    </VaulDrawer.Content>
  </DrawerPortal>
))
DrawerContent.displayName = 'DrawerContent'

const DrawerHeader = ({ className, ...props }) => (
  <div className={cn('ui-grid ui-gap-1.5 ui-p-4 ui-text-center sm:ui-text-left', className)} {...props} />
)
const DrawerFooter = ({ className, ...props }) => (
  <div className={cn('ui-mt-auto ui-flex ui-flex-col ui-gap-2 ui-p-4', className)} {...props} />
)
const DrawerTitle = React.forwardRef(({ className, ...props }, ref) => (
  <VaulDrawer.Title ref={ref} className={cn('ui-text-lg ui-font-semibold ui-leading-none ui-tracking-tight ui-text-foreground', className)} {...props} />
))
DrawerTitle.displayName = 'DrawerTitle'
const DrawerDescription = React.forwardRef(({ className, ...props }, ref) => (
  <VaulDrawer.Description ref={ref} className={cn('ui-text-sm ui-text-muted-foreground', className)} {...props} />
))
DrawerDescription.displayName = 'DrawerDescription'

export {
  Drawer, DrawerPortal, DrawerOverlay, DrawerTrigger, DrawerClose,
  DrawerContent, DrawerHeader, DrawerFooter, DrawerTitle, DrawerDescription
}
```

**👋 CHECK-IN 7** — `src/components/ui/drawer.jsx` exists ✓.

---

## PHASE 8 — UPGRADE HOME SCREEN (the showpiece)

Replace `src/screens/Home.jsx`. **Read the existing file first** to understand its hooks (weather fetch, profile location, pinLocation handler). Keep all that data logic. Only the visual scaffolding changes.

```jsx
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Bell, MapPin, CloudSun, TrendingUp, Briefcase, FileText, ChevronRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { supabase } from '../lib/supabase.js'
import { getWeather, workWindow } from '../lib/weather.js'
import Spotlight from '../components/fx/Spotlight.jsx'
import ShimmerBar from '../components/fx/ShimmerBar.jsx'
import GreetingTitle from '../components/fx/GreetingTitle.jsx'
import CountUp from '../components/fx/CountUp.jsx'

function formatDate(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
}
function greetingPrefix() {
  const h = new Date().getHours()
  if (h < 12) return 'Morning,'
  if (h < 17) return 'Afternoon,'
  return 'Evening,'
}
function initials(name) {
  if (!name) return 'JP'
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}

export default function Home() {
  const { user } = useAuth()
  const { profile, upsertProfile, refresh } = useProfile()
  const navigate = useNavigate()

  const [now] = useState(() => new Date())
  const [weather, setWeather] = useState(null)
  const [weatherErr, setWeatherErr] = useState('')
  const [weatherLoading, setWeatherLoading] = useState(false)
  const [pipeline, setPipeline] = useState(0)
  const [activeCount, setActiveCount] = useState(0)
  const [notesCount, setNotesCount] = useState(0)
  const [todayJobs, setTodayJobs] = useState([])
  const [weeklyTarget] = useState(25000)
  const [weeklyBooked, setWeeklyBooked] = useState(0)

  const hasCoords = profile?.location_lat != null && profile?.location_lon != null
  const firstName = (profile?.full_name || user?.email || 'Operator').split(' ')[0].split('@')[0]

  useEffect(() => {
    let cancelled = false
    if (!hasCoords) { setWeather(null); return }
    setWeatherLoading(true); setWeatherErr('')
    getWeather(profile.location_lat, profile.location_lon)
      .then((d) => { if (!cancelled) setWeather(d) })
      .catch((e) => { if (!cancelled) setWeatherErr(e.message || 'Forecast unavailable') })
      .finally(() => { if (!cancelled) setWeatherLoading(false) })
    return () => { cancelled = true }
  }, [profile?.location_lat, profile?.location_lon, hasCoords])

  const windowRead = useMemo(
    () => workWindow(weather?.current, profile?.services || []),
    [weather, profile?.services]
  )

  useEffect(() => {
    if (!user) return
    async function load() {
      const { data: contacts } = await supabase
        .from('fh_contacts')
        .select('id, name, amount, stage, job_title, job_type')
        .eq('user_id', user.id)
      const active = (contacts || []).filter((c) => ['quote', 'job'].includes(c.stage))
      const totalPipeline = (contacts || [])
        .filter((c) => c.stage !== 'closed' && c.stage !== 'lost')
        .reduce((s, c) => s + Number(c.amount || 0), 0)
      const won = (contacts || []).filter((c) => c.stage === 'invoice' || c.stage === 'closed')
      const booked = won.reduce((s, c) => s + Number(c.amount || 0), 0)
      setPipeline(totalPipeline)
      setActiveCount(active.length)
      setWeeklyBooked(booked)
      setTodayJobs(active.slice(0, 3))
      const { count } = await supabase
        .from('fh_notes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('done', false)
      setNotesCount(count || 0)
    }
    load()
  }, [user])

  function pinLocation() {
    if (!('geolocation' in navigator)) return setWeatherErr('Geolocation not supported')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await upsertProfile({ location_lat: pos.coords.latitude, location_lon: pos.coords.longitude })
        refresh()
      },
      () => setWeatherErr('Location denied'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60 * 60 * 1000 }
    )
  }

  const targetPct = Math.min(100, Math.round((weeklyBooked / weeklyTarget) * 100))
  const pourStatus = windowRead?.status || (weather ? 'OK' : '—')
  const pourGood = pourStatus.toLowerCase().includes('good') || pourStatus.toLowerCase().includes('ok')

  const stagger = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } } }
  const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 200, damping: 24 } } }

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* TOP BAR */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 20px 0' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))', padding: 2 }}>
          <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'var(--surface-1)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', color: 'var(--field-gold-bright)', fontSize: 14, letterSpacing: '0.05em' }}>
            {initials(profile?.full_name || user?.email)}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.14em' }}>
            <span style={{ color: 'var(--field-gold)' }}>FIELD</span>
            <span style={{ color: 'var(--ink-strong)' }}>HORSE</span>
          </span>
          <span className="fh-fx-pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--signal-green)', boxShadow: '0 0 0 3px rgba(45,122,79,0.2), 0 0 8px var(--signal-green)' }} />
        </div>
        <button aria-label="Notifications" style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', display: 'grid', placeItems: 'center', position: 'relative', color: 'var(--ink-strong)', cursor: 'pointer' }}>
          <Bell size={18} />
          {notesCount > 0 && <span style={{ position: 'absolute', top: 8, right: 8, width: 7, height: 7, borderRadius: '50%', background: 'var(--alert-red)', boxShadow: '0 0 0 2px var(--surface-0)' }} />}
        </button>
      </motion.div>

      {/* HERO GREETING */}
      <motion.div variants={item} style={{ padding: '24px 20px 16px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 999, background: 'rgba(201,150,58,0.1)', border: '1px solid rgba(201,150,58,0.2)', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--field-gold-bright)', marginBottom: 14 }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--field-gold-bright)' }} />
          {formatDate(now)}
        </div>
        <GreetingTitle prefix={greetingPrefix()} name={firstName} />
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-muted)' }}>
          {activeCount > 0 ? <>{activeCount} {activeCount === 1 ? 'crew' : 'crews'} on site. <span style={{ color: 'var(--signal-green)', fontWeight: 600 }}>All green.</span></> : 'Nothing active. Quiet day.'}
        </div>
      </motion.div>

      {/* TARGET CARD */}
      <motion.div variants={item} style={{ position: 'relative', margin: '0 20px 14px', padding: '18px 20px', borderRadius: 22, background: 'linear-gradient(135deg, rgba(30,20,10,0.8), rgba(20,20,20,0.6))', border: '1px solid rgba(201,150,58,0.2)', backdropFilter: 'blur(20px)', overflow: 'hidden' }}>
        <Spotlight style={{ top: -80, right: -80 }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, position: 'relative' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Weekly Target</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--signal-green)', background: 'rgba(45,122,79,0.12)', border: '1px solid rgba(45,122,79,0.25)', padding: '3px 10px', borderRadius: 999 }}>
            <TrendingUp size={12} />{targetPct}%
          </div>
        </div>
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 52, lineHeight: 1, letterSpacing: '0.01em', color: 'var(--ink-strong)', position: 'relative' }}>
          <span style={{ fontSize: 26, color: 'var(--ink-muted)', verticalAlign: 'top', marginRight: 2 }}>$</span>
          <CountUp to={weeklyBooked} />
        </div>
        <div style={{ marginTop: 14, position: 'relative' }}>
          <ShimmerBar value={targetPct} />
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-muted)' }}>
            <span><span style={{ color: 'var(--field-gold-bright)', fontWeight: 700 }}>{targetPct}%</span> of ${(weeklyTarget / 1000).toFixed(0)}K</span>
            <span>{pipeline > 0 ? `$${(pipeline / 1000).toFixed(0)}K in pipeline` : '—'}</span>
          </div>
        </div>
      </motion.div>

      {/* WEATHER + POUR */}
      {hasCoords ? (
        <motion.div variants={item} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10, padding: '0 20px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderRadius: 16, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', backdropFilter: 'blur(20px)' }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: 'linear-gradient(135deg, #2d3f54, #1a2535)', display: 'grid', placeItems: 'center' }}>
              <CloudSun size={18} color="#8fb4e3" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: '0.02em', lineHeight: 1 }}>
                {weatherLoading ? '—' : weather?.current?.temperature_2m ? `${Math.round(weather.current.temperature_2m)}°` : '—'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 3 }}>
                {weather?.current?.wind_speed_10m ? `Wind ${Math.round(weather.current.wind_speed_10m)}mph` : '—'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '13px 15px', borderRadius: 16, background: pourGood ? 'linear-gradient(135deg, rgba(45,122,79,0.2), rgba(45,122,79,0.06))' : 'linear-gradient(135deg, rgba(192,57,43,0.2), rgba(192,57,43,0.06))', border: pourGood ? '1px solid rgba(78,214,147,0.25)' : '1px solid rgba(192,57,43,0.25)' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: pourGood ? 'var(--signal-green)' : 'var(--alert-red)' }}>Pour</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: '0.03em', lineHeight: 1, marginTop: 3, color: pourGood ? 'var(--signal-green)' : 'var(--alert-red)' }}>{pourStatus.toUpperCase()}</div>
          </div>
        </motion.div>
      ) : (
        <motion.div variants={item} style={{ padding: '0 20px 14px' }}>
          <button onClick={pinLocation} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 16, background: 'rgba(201,150,58,0.08)', border: '1px solid rgba(201,150,58,0.25)', color: 'var(--field-gold-bright)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <MapPin size={16} />Pin location for weather
          </button>
        </motion.div>
      )}

      {/* KPI ROW */}
      <motion.div variants={item} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '0 20px 20px' }}>
        {[
          { label: 'Pipeline', value: pipeline, prefix: '$', format: (n) => n >= 1000 ? `${(n / 1000).toFixed(0)}K` : n.toLocaleString(), icon: TrendingUp },
          { label: 'Active', value: activeCount, format: (n) => String(n).padStart(2, '0'), icon: Briefcase },
          { label: 'Notes', value: notesCount, format: (n) => String(n).padStart(2, '0'), icon: FileText }
        ].map((kpi) => {
          const I = kpi.icon
          return (
            <div key={kpi.label} style={{ position: 'relative', overflow: 'hidden', padding: '12px 13px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)' }}>
              <I size={14} style={{ position: 'absolute', top: 10, right: 10, color: 'rgba(201,150,58,0.4)' }} />
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>{kpi.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, letterSpacing: '0.02em', lineHeight: 1, marginTop: 5 }}>
                <CountUp to={kpi.value} prefix={kpi.prefix || ''} formatter={kpi.format} />
              </div>
            </div>
          )
        })}
      </motion.div>

      {/* TODAY ON SITE */}
      <motion.div variants={item}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 12px' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, letterSpacing: '0.14em', color: 'var(--ink-strong)', margin: 0 }}>Today On Site</h3>
          <button onClick={() => navigate('/jobs')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--field-gold-bright)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'none', border: 'none', cursor: 'pointer' }}>
            All <ChevronRight size={12} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 20px 14px' }}>
          {todayJobs.length === 0 ? (
            <div style={{ padding: '24px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 12 }}>
              No active jobs yet. <button onClick={() => navigate('/jobs?new=1')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--field-gold-bright)', fontWeight: 700, cursor: 'pointer' }}>Add your first lead →</button>
            </div>
          ) : todayJobs.map((job) => {
            const accent = job.stage === 'job' ? 'green' : job.stage === 'quote' ? 'gold' : 'red'
            const accentColors = { green: 'var(--signal-green)', gold: 'var(--field-gold-bright)', red: 'var(--alert-red)' }
            return (
              <motion.button key={job.id} whileTap={{ scale: 0.98 }} onClick={() => navigate(`/jobs/${job.id}`)} style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))', border: '1px solid var(--rule)', backdropFilter: 'blur(20px)', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, borderRadius: '0 3px 3px 0', background: accentColors[accent], boxShadow: `0 0 12px ${accentColors[accent]}99` }} />
                <div style={{ width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontSize: 15, letterSpacing: '0.04em', background: `linear-gradient(135deg, ${accentColors[accent]}33, ${accentColors[accent]}11)`, color: accentColors[accent], border: `1px solid ${accentColors[accent]}33` }}>
                  {initials(job.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--ink-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.name || 'Untitled'}</div>
                  <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 3 }}>{job.job_type || job.job_title || '—'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, letterSpacing: '0.02em', lineHeight: 1, color: 'var(--field-gold-bright)' }}>${(Number(job.amount || 0) / 1000).toFixed(1)}K</div>
                </div>
              </motion.button>
            )
          })}
        </div>
      </motion.div>
    </motion.div>
  )
}
```

**👋 CHECK-IN 8** — Home renders: gold-pulse-dot beside logo · serif gradient greeting · spotlight-breathing target card · animated CountUp + ShimmerBar · 3 KPIs with Lucide icons · today jobs list with colored accent bars ✓.

---

## PHASE 9 — UPGRADE LOGIN SCREEN

Replace `src/screens/Login.jsx` — keep auth logic identical, new visual skin only:

```jsx
import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Mail, Lock, ArrowRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { toastError, toastSuccess } from '../lib/toast.js'
import Aurora from '../components/fx/Aurora.jsx'
import GridPattern from '../components/fx/GridPattern.jsx'

export default function Login() {
  const { signIn } = useAuth()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const navigate = useNavigate()

  async function handleSubmit(e) {
    e.preventDefault()
    if (loading) return
    setLoading(true)
    const { error } = await signIn(email.trim(), password)
    setLoading(false)
    if (error) toastError('Invalid credentials', error.message)
    else { toastSuccess('Signed in'); navigate('/', { replace: true }) }
  }

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'grid', placeItems: 'center', padding: 24, background: 'var(--surface-0)', color: 'var(--ink-strong)' }}>
      <Aurora />
      <GridPattern />
      <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.6, ease: [0.2, 0.8, 0.2, 1] }} style={{ position: 'relative', zIndex: 1, width: '100%', maxWidth: 380 }}>
        <div style={{ textAlign: 'center', marginBottom: 36 }}>
          <div style={{ fontFamily: 'var(--font-display)', fontSize: 36, letterSpacing: '0.14em', lineHeight: 1 }}>
            <span style={{ color: 'var(--field-gold)' }}>FIELD</span>
            <span style={{ color: 'var(--ink-strong)' }}>HORSE</span>
          </div>
          <h1 className="fh-font-serif" style={{ fontSize: 32, lineHeight: 1.1, letterSpacing: '-0.02em', marginTop: 28, fontWeight: 400 }}>
            Welcome,<br /><em className="fh-font-serif-italic fh-text-gradient-gold">operator.</em>
          </h1>
          <p style={{ marginTop: 10, color: 'var(--ink-muted)', fontSize: 13 }}>Sign in to run every job like a captain.</p>
        </div>

        <form onSubmit={handleSubmit} style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: 20, borderRadius: 18, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)', backdropFilter: 'blur(20px)' }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Email</span>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)' }} />
              <input type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@company.com" style={{ width: '100%', padding: '12px 14px 12px 40px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontSize: 14, fontFamily: 'var(--font-body)', outline: 'none' }} />
            </div>
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Password</span>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: 14, top: '50%', transform: 'translateY(-50%)', color: 'var(--ink-muted)' }} />
              <input type="password" required autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••••••" style={{ width: '100%', padding: '12px 14px 12px 40px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontSize: 14, fontFamily: 'var(--font-body)', outline: 'none' }} />
            </div>
          </label>
          <motion.button type="submit" disabled={loading} whileTap={{ scale: 0.98 }} style={{ marginTop: 6, padding: '14px 18px', borderRadius: 12, background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))', color: 'var(--onyx)', fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.15em', border: 'none', cursor: 'pointer', boxShadow: '0 8px 24px rgba(201,150,58,0.35)', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, opacity: loading ? 0.6 : 1 }}>
            {loading ? 'SIGNING IN...' : 'SIGN IN'}{!loading && <ArrowRight size={18} />}
          </motion.button>
          <Link to="/reset-password" style={{ fontSize: 12, color: 'var(--ink-muted)', textDecoration: 'none', textAlign: 'center', marginTop: 4 }}>Forgot password?</Link>
        </form>
      </motion.div>
    </div>
  )
}
```

**👋 CHECK-IN 9** — Login: Aurora backdrop · centered FIELDHORSE wordmark · serif "operator." · email/password fields with Lucide icons · gold gradient sign-in button ✓.

---

## PHASE 10 — UPGRADE JOBS SCREEN

Read `src/screens/Jobs.jsx` first. Preserve ALL existing logic (`load()`, `filter`, `search`, `addOpen`, `NewLeadSheet`, `STAGES`, etc.). Apply minimum visual upgrades:

1. Header title becomes serif italic: `Jobs & <em>pipeline</em>` with the "pipeline" word using `fh-text-gradient-gold`. Sub-line: `<span style="color:var(--field-gold-bright)">12</span> active · <span style="color:var(--field-gold-bright)">$267K</span> total`.
2. Replace filter pills with shadcn `<Tabs>` from `@/components/ui/tabs` — values map to `filter` state. Each tab shows count.
3. Add search input row using shadcn `<Input>` with leading Lucide `Search` icon and `⌘K` `<kbd>` hint (clicking it opens the CommandPalette by dispatching the same Cmd+K listener).
4. Wrap each contact card in `<motion.div>` with stagger (80ms apart). Use the same `stagger` / `item` variants pattern from Home.
5. Replace card emojis with Lucide icons: stage indicators get `Briefcase` / `TrendingUp` / `CheckCircle2` per stage.
6. On tap: open Vaul `<Drawer>` with quick-actions row — `Text` (`window.open('sms:' + contact.phone)`), `Email` (`mailto:`), `Call` (`tel:`), `Open` (`navigate(/jobs/${id})`). The "Open" action is the primary gold gradient button.
7. Keep `NewLeadSheet` integration unchanged.

If you run out of context: at minimum land items 1, 4, and 6 (title + stagger + Vaul drawer). The rest can be a follow-up pass.

**👋 CHECK-IN 10** — Jobs screen has serif italic title · cards stagger · tap opens Vaul drawer · NewLeadSheet still works ✓.

---

## PHASE 11 — APPLY PATTERN TO REMAINING 10 SCREENS

For each, preserve all hooks/state/Supabase calls. Apply visual pattern:

| Screen | Hero title (serif italic word in *italics*) | Specific upgrade |
|---|---|---|
| **Notes** | `Notes, *fast.*` | Replace category emojis with Lucide (`Phone`, `Mail`, `Calendar`, `MessageSquare`, `Package`, `ClipboardCheck`, `FileText`). Cards stagger. |
| **Schedule** | `Run the *day.*` | View toggle (day/week/month) → shadcn `<ToggleGroup>`. Upcoming list staggers. Weather card uses Spotlight FX if pour-good. |
| **Bid** | `Bid it, *clean.*` | Final total uses `<CountUp>`. Add Vaul drawer for "Save & Send" actions. |
| **Compose** | `Write it, *perfectly.*` | Channel selector → shadcn `<ToggleGroup>`. AI response card gets `<ScanLine />` on top border. Send button uses gold gradient. Toast success on send. |
| **Analytics** | `CEO *read.*` | All numbers use `<CountUp>`. Bars get gold gradient. Pipeline value at top uses spotlight card pattern. |
| **ContactDetail** (948 lines) | Customer name in serif: `Whitmore *Family*` (italic last word) | Replace tab bar with shadcn `<Tabs>`. Quick-action row at top uses Vaul drawer. Rest of file: leave logic untouched, just swap title. |
| **Importer** | `Bring it *all in.*` | Drop zone gets dashed gold border + Lucide `Upload` icon. Preset cards (Jobber/HubSpot/Generic) stagger. Toast success on import complete. |
| **Onboarding** | Each step gets serif italic step heading | Wizard logic untouched. Step transitions use existing AnimatePresence. |
| **ResetPassword** | `Reset, *no problem.*` | Match Login styling (Aurora backdrop, gold gradient submit button). |
| **Settings** | `Run your *operation.*` | Section headers use serif italic combo. Theme toggle uses shadcn `<Switch>`. Sign-out button is destructive variant. |

**Universal rules for every screen:**
- Wrap top-level container in `<motion.div variants={stagger} initial="hidden" animate="show">`.
- Wrap each child block in `<motion.div variants={item}>`.
- Replace emoji icons with Lucide. Keep brand-glyph `Icon` component for trade/stage glyphs.
- Add `toastSuccess` from `@/lib/toast` on every successful save/send/upsert.
- Never delete an `.fh-*` class — additive only.

**👋 CHECK-IN 11** — list each screen done, plus any deviations or blockers.

---

## PHASE 12 — TOAST WIRING

Audit every `supabase.upsert/insert/update` success path. Add `toastSuccess('Saved', 'Synced across devices')` after each. Priority list:

- Jobs / NewLeadSheet → `toastSuccess('Lead added', name)`
- ContactDetail save → `toastSuccess('Contact updated')`
- Notes create → `toastSuccess('Note saved')`
- Bid generate → `toastSuccess('Bid ready')`
- Compose send → `toastSuccess('Sent', `${channel} delivered`)`
- Onboarding step complete → `toastSuccess('Step complete')`
- Settings profile update → `toastSuccess('Profile updated')`

---

## PHASE 13 — BUILD + VERIFY

```bash
npm run build
```

Check `dist/`:
- `index.html` exists
- `_redirects` exists (if not, create `public/_redirects` with content: `/*    /index.html   200`)
- `assets/` has CSS + JS bundles
- Report total gzipped size of `dist/assets/*.js`

Local preview:
```bash
npm run preview
```

Walk through at `http://localhost:4173`:
1. Login → email/password → land on Home
2. Home → confirm Aurora drift, gradient greeting, target card spotlight, KPI count-up, today jobs
3. Tap a job → Vaul drawer rises → tap Open → ContactDetail loads
4. ⌘K → fuzzy search → "schedule" → routes
5. Notes / Schedule / Bid / Compose / Analytics / Importer / Settings → each renders without console errors
6. Sign out → returns to Login

**👋 CHECK-IN FINAL** — bundle size · screenshots/description of every screen · any deviations · any screens needing a second pass.

If all green, deploy: drag `dist/` into Netlify dropzone for `fieldhorse.io`.

---

## DESIGN INVARIANTS — never violate

1. **Type stack.** Instrument Serif italic = hero titles only. Bebas Neue = brand mark + numbers. DM Sans = everything else.
2. **Icons.** Lucide for UI chrome. `components/icons/Icon.jsx` for brand-specific glyphs. Zero emojis in nav, buttons, labels, cards.
3. **Green.** Indicators only (active, won, pour-good, passed). Never theme/CTA.
4. **Gold.** Primary brand. CTAs, active tabs, emphasis numbers. `fh-text-gradient-gold` for hero italic words.
5. **Motion.** Stagger 80ms / spring stiffness 200 damping 24 / Vaul cubic-bezier(0.32, 0.72, 0, 1).
6. **Spacing.** Phone padding 20px. Cards rounded 16–22px. Hero `padding: 24px 20px 16px`.
7. **Class prefixes.** Tailwind utilities → `ui-*`. Existing classes → `fh-*`. Never collide.

---

## TROUBLESHOOTING

- **`npx shadcn init` prompts to overwrite `components.json`** → answer NO.
- **Tailwind error "unknown at-rule @theme"** → confirm `tailwindcss@next` + `@tailwindcss/vite@next` (not stable) installed.
- **Vaul drawer renders empty** → confirm `vaul` package installed and `<DrawerContent>` has children.
- **Sonner toasts invisible** → confirm `<SonnerToaster />` mounted in `AppShell.jsx`.
- **Motion import fails** → it's `import { motion } from 'framer-motion'`, not `motion/react`.
- **Lucide icons render as squares** → confirm `lucide-react` installed and import like `import { Home } from 'lucide-react'`.
- **PWA stops working** → verify `VitePWA` block still in `vite.config.js` after Phase 1 edit.

---

## FINAL COMMIT MESSAGE

```
feat(v2): premium stack migration — shadcn + Tailwind v4 + FX

- Tailwind v4 additive layer (ui- prefix) alongside global.css
- shadcn/ui in src/components/ui/
- Premium FX: Aurora, Spotlight, ShimmerBar, ScanLine, GridPattern, GreetingTitle, CountUp
- Instrument Serif for hero italic moments
- Lucide React for UI chrome; zero emojis in nav/buttons
- Vaul bottom sheets for job detail quick-actions
- Sonner bridged with existing fh:toast event system
- cmdk-powered CommandPalette with fuzzy search
- All 13 screens upgraded visually
- Preserved: react-router, Supabase AuthContext, ProfileContext, ThemeContext
- Preserved: global.css, tokens.css, all .fh-* classes, VitePWA
- Deferred: Partner Tracker, Inspection Tracker
```

Go.
