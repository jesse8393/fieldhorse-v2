# Phase 1 plan: foundation

Spec: `SPEC.md` in this folder, with the October 10 decisions in its section 17. Phase 1 changes how every screen looks and how a phone gets around, and leaves every screen's layout and data alone. Phases 2 to 7 rebuild the screens on top of it.

## Done means

* Day is the default look, Night follows sunset in Auto, and both pass the contrast test.
* Barlow and Barlow Condensed load from the app itself, so they work offline. Bebas Neue is left only on the FIELDHORSE wordmark.
* On a phone: the onyx dock (Today, Jobs, Capture coin, Money, Schedule), and a header with the company monogram on the left, which opens the workspace menu, plus search and the bell on the right.
* On a desktop: the onyx sidebar at 232 px.
* The 18 components in `src/components/fh/` exist and are drawn on a component sheet at `/design`. That route is registered only in development, so production never ships it.
* `npm run test:all` and `npm run audit:design` pass.

## Steps

### 1. Tokens and type (`src/styles/tokens.css`, `src/styles/redesign.css`, `src/main.tsx`)

* Rewrite `tokens.css`: the `--fh-` tokens from spec section 5, with Day in `:root` and Night in `[data-theme='dark']`. Map every legacy name (`--v3-*`, `--surface-*`, `--ink-*`, `--rule*`, `--stage-*`, the radius tokens and the fonts) onto them as spec section 6 describes.
  * Text tokens get plain hex values, never `color-mix`, so the contrast test can read them.
  * Drop the `prefers-color-scheme` block. The theme script always sets `data-theme`.
* Status colors for stages (spec 5.4): lead neutral, quote info, job and invoice success, closed neutral ink 3, lost neutral. Red stays for late money and failed safety only.
* Add `src/styles/redesign.css`, loaded after `v3.css` and before `mobile-keyboard-fix.css`. It holds the overrides that keep older screens in line with the new system:
  * tabular numbers on the app root
  * the spec focus ring color, over the muted one global.css forces
  * the 232 px sidebar offset
  * the dock clearance
  * focus rings
* Self host the fonts with `@fontsource/barlow`, `@fontsource/barlow-condensed` and `@fontsource/bebas-neue`, latin subset only:
  * Barlow 400, 500, 600
  * Barlow Condensed 500, 600
  * Bebas Neue 400
* Remove the Google Fonts link, its preconnects and the Google Fonts runtime caching. Add `woff2` to the precache patterns.
* Replace the hard coded `'Bebas Neue'` and `'DM Sans'` font stacks in components with the font tokens. Wordmarks use `--font-wordmark`.
* Remove every uppercase transform from the older screens and rewrite the labels in sentence case at the source (done as a sweep, not a global override, so `capitalize` styles keep working).

### 2. Theme modes (`src/contexts/ThemeContext.tsx`, `src/lib/sunTimes.ts`, `src/lib/themeMode.ts`, `index.html`, `netlify.toml`, `vite.config.js`)

* `sunTimes(date, lat, lon)` implements the NOAA sunrise equation and is unit tested against known dates.
* `themeMode.ts` resolves Auto, Day or Night plus the time and location into `light` or `dark`. It works out the next switch time and caches today's and tomorrow's sun times in local storage under `fh:sun`. The mode lives under `fh:theme-mode`. The old `fh:theme` key is ignored, so everyone starts in Auto.
* `ThemeContext` exposes `mode`, `setMode` and the resolved `theme`. It re-checks on a timer set to the next sunrise or sunset and whenever the app becomes visible again. The `setTheme` and `toggleTheme` callers are moved to `setMode`.
* The pre paint script in `index.html` reads `fh:theme-mode` and `fh:sun` and sets `data-theme` and the theme color before first paint.
  * Update the script's hash in the CSP in `netlify.toml`.
  * Drop the font link hash and the Google Fonts origins from the CSP.
* Manifest `theme_color` and `background_color` become onyx `#16140F`.
* Settings gets a three way Auto, Day, Night control in place of the light switch.

### 3. Components (`src/components/fh/`)

These are the 18 components of spec section 7, each with the states it needs (hover, pressed, focus, disabled, loading), reading only `--fh-` tokens:

| Components |
| --- |
| `Icon`, `Button`, `IconButton`, `Field`, `Chip` |
| `SyncPill`, `StageRail`, `Row`, `SpineEntry`, `OnyxStage` |
| `PhotoCard`, `VaultCard`, `Monogram`, `Dock`, `Sheet` |
| `Skeleton`, `EmptyState`, `KeyCap` |

* `StageRail` takes its current segment from `src/lib/stageRail.ts`, which is unit tested against spec section 7's stage rule.
* `Sheet` wraps `vaul`.
* `Toast` is a restyle of `AppToaster.tsx`: an onyx toast with an Undo action and `aria-live="polite"`.
* `src/screens/DesignSheet.tsx` draws every component in every state, in Day and Night side by side, at `/design` in development only.

### 4. Phone shell (`src/components/AppHeader.tsx`, `src/components/WorkspaceMenu.tsx`, `src/components/fh/Dock.tsx`, `src/components/AppShell.tsx`, `src/components/CaptureFab.tsx`)

* **Header.** The monogram button (company logo or initials) on the left opens the workspace menu. The company name sits beside it, and search and the bell go on the right. The Notes shortcut moves into the menu as Field reports.
* **Workspace menu.**
  * It replaces the More drawer in `BottomNav.tsx` and is opened by the header monogram or the `fh:open-menu` event.
  * It keeps everything the drawer did: the role filter, the crew only Team group, the org switcher, sign out, the focus trap, the scroll lock and closing on route change.
  * It adds the Auto, Day, Night control.
* **Dock.**
  * It replaces the bar in `BottomNav.tsx` and keeps the `fh-nav` class, so the keyboard rules in `mobile-keyboard-fix.css` still hide it.
  * It follows the role filter and keeps the Capture coin centered.
  * Screens can hide it with the `fh:dock` event or the `useHideDock()` hook, which Phases 2 and 3 use for Job and Quote.
  * `--fh-mobile-dock-height` is updated so floating buttons, toasts and the install banner clear the new capsule.
* **Capture.** `CaptureFab` renders on desktop only. On a phone, the dock coin opens Capture.
* **Old nav.** `BottomNav.tsx` is removed.

### 5. Desktop sidebar (`src/components/DesktopSidebar.tsx`)

* Onyx, 232 px wide.
* Top: the monogram, the company name and the city, then search with ⌘K.
* Main items: Today, Schedule, Jobs, Money, Customers and Reports.
* A collapsible Team and office group holds the rest.
* Bottom: Settings, then the signed in person.
* The active item gets linen text and the gold edge bar. Focus rings on the sidebar are linen.

### 6. Checks

* Rewrite `scripts/audit-design-system.mjs` for the new scales:
  * colors: the section 5 palette, plus the legacy colors until Phase 7
  * radii: 7, 10, 12, 14, 18, 22, 28 and 999
  * type: 12, 13, 14, 15, 16, 17, 18, 20, 24, 30, 34, 36, 38 and 52
  * spacing: the existing steps plus 20 and 28
  * letter spacing stays at zero
* `src/styles/tokens.contrast.test.ts` parses `tokens.css`, resolves the `var()` chains for each theme and asserts every pair in spec section 12. It also asserts the legacy text tokens on the legacy surfaces.
* End to end tests, updated and new:
  * `scroll-behavior.spec.ts` opens the workspace menu from the header instead of More.
  * A new `redesign-shell.spec.ts` checks the dock items, the menu, the theme modes and the component sheet.
  * Screenshot baselines of the component sheet run only when `FH_VISUAL=1`, so CI never flakes on font rendering.
* Screenshots of the main screens at 390 by 844 in Day and Night and at 1440 by 900 are reviewed by hand before the pull request leaves draft.

## Risks to watch

* Older screens drawn dark first: anything with a hard coded `#141414` background and token text turns dark text on dark in Day. The screenshot pass looks for these.
* Labels that relied on `text-transform: uppercase` over lowercase source text would come out lowercase. The sweep checks the source text of each one.
* Barlow is wider than Bebas Neue in headings and narrower than DM Sans in body text, so lines wrap differently. The screenshot pass looks for clipped headings and buttons.
