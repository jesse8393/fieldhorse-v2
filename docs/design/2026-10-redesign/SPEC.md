# Fieldhorse redesign: design spec

Status: approved design, checked against the code on October 10, 2026. Section 16 lists every correction from that check. Section 17 records the decisions made on October 10.
Date: October 9, 2026
Owner: Jesse Parker
Applies to: `fieldhorse-v2` (React 18, Vite 6, Tailwind 4, shadcn on the `radix-ui` package, TanStack Query, Supabase)

## 1. Purpose

Rebuild the look and navigation of Fieldhorse so a contractor can run a whole day from one thumb, read every screen in full sun, and feel like they are using a premium tool. The approved direction is the plaster, paper and ink base with the glamor layer on top: one onyx stage per screen, brushed gold for the single main action, real job photography, and a floating onyx dock.

### Success criteria

* A contractor opens the app and knows the shape of the day from one sentence and three rows, without scrolling.
* Every route in `src/App.tsx` stays reachable, within two taps on a phone, for every role allowed to see it.
* Brushed gold appears on exactly one action per screen, plus the Capture coin. Flat gold is allowed only as a small position marker (active tab, today dot, now line, current stage) and as hairlines on onyx.
* Every text pair meets WCAG AA contrast (4.5 to 1 body, 3 to 1 for 24 px and up), and every input outline and focus ring meets 3 to 1, checked by an automated test.
* Every existing feature keeps working. This is a visual and navigation rebuild, not a data rebuild. No new tables.
* `npm run test:all` passes at the end of every phase.

## 2. Approved references

* Design canvas (private to Jesse): https://claude.ai/artifact/GBzNhVmHEp4Gf5M3tNAQQU
  * Row 1: direction, Foundations sheet, Components sheet
  * Row 2: coded phone screens (Today, Jobs, Job, Capture, Quote, Money, Inbox, Night)
  * Row 3: coded desktop screens (Schedule, Job)
  * Row 4: customer portal, empty and loading and error and offline states
  * Rows 5 and 6: rendered concepts of the base
  * Row 7: Glamor edition sheet plus glamor renders. **Row 7 wins wherever it differs from earlier rows.**
* Renders copied from the canvas into this folder so any Claude Code session can open them. They are JPEG copies of the canvas PNGs (same 1024 by 1536 or 1536 by 1024 frames, about 4 MB for all 19 instead of 34 MB):
  * `glamor/`: `g-welcome.jpg`, `g-today.jpg`, `g-job.jpg`, `g-quote.jpg`, `g-money.jpg`, `g-portal.jpg`, `g-desktop-job.jpg`
  * `base/`: `today.jpg`, `jobs.jpg`, `job-spine.jpg`, `capture.jpg`, `quote.jpg`, `money.jpg`, `inbox.jpg`, `night.jpg`, `portal.jpg`, `desktop-schedule.jpg`, `desktop-job.jpg`, `desktop-command.jpg`
* Renders are concept art. Where a render and this spec disagree, **this spec wins**. Known render drift: the desktop stage rail drew as a check mark stepper (build the five segment rail), desktop sidebar icons drew filled (build thin line icons), and the portal question link drew gold (build it in linen).

## 3. Scope and phases

The work splits into phases. Each phase gets its own implementation plan and ships on its own. Each phase must leave the app fully working.

| Phase | Name | Delivers |
|---|---|---|
| 1 | Foundation | Fonts, tokens (Day, Night, Glamor), theme auto switch, icon wrapper, core components, app shell, mobile dock, workspace menu, desktop sidebar, contrast test |
| 2 | Field screens | Today (day and night), Jobs, Job with the Spine, Capture sheet, Forecast (`PourWindow.tsx`, which still renders the old `Spotlight` effect) |
| 3 | Money and quotes | Money, quote editor, send flow |
| 4 | Desktop | Schedule week board (adds `@dnd-kit/core` back), desktop Job, command palette |
| 5 | Customer facing | Portal theme for `/p/:token`, Welcome and Login, `ResetPassword.tsx` and `PartnerInvite.tsx` (both still render `Aurora` and `GridPattern`) |
| 6 | Inbox | Inbox list and thread, built on the Growth Engine tables that already exist |
| 7 | Cleanup | Remove dead CSS and unused effect components, final contrast and screenshot pass |

### Out of scope

* Database schema changes. None are required. (Optional later: a `cover_file_id` column on `fh_contacts` to pin a cover photo. Not part of this work.)
* PDF output from `jspdf` (`src/lib/pdf.js`, `pdfLogo.ts`). Printed documents keep their current look.
* The marketing site. It is not in this repository.
* Growth Engine backend. Phase 6 only draws the screens on tables and functions that already exist.
* Native mobile in `mobile/`.

## 4. Locked constraints (do not change)

* Supabase email and password auth through `AuthContext`, session refresh, protected routes, `/reset-password`.
* Roles as the code has them: workspace roles `owner`, `admin`, `manager`, `foreman` and `crew` (the `org_role` enum), job partners scoped to one job through `fh_job_partners`, and subcontractors in the sub portal. Every navigation surface keeps the role filter from `useMembership().canViewRoute`, the same way `BottomNav.tsx` does today.
* Partners are scoped to one job, live inside `/jobs/:id`, equal edit rights, soft unlink.
* Inspections are a per job toggle.
* Real time sync stays as it is: `supabase.channel()` subscriptions in `lib/queries.ts`, `lib/homeDashboard.ts`, `NotificationsBell.tsx` and `ContactDetail/hooks/useJobData.ts`, with cache refreshes debounced at 1200 ms. Saves keep going through the existing `lib/` functions. No table has an `updated_by` column today; adding one would be a schema change and is out of scope.
* Multi tenant: a new user lands in a clean blank workspace. No demo data unless the user asks for it.
* Universal Capture trust rules from `docs/NORTH_STAR.md`: the model proposes, the person confirms, nothing writes without the confirm tap, the outbox never loses words.
* iOS PWA rules: `100dvw` not `100vw`, `viewport-fit=cover`, `overflow-x: hidden`, voice through the browser's Web Speech API (`SpeechRecognition`, as in `CaptureSheet.tsx`, `NewLeadSheet.tsx` and `Notes.tsx` today), share sheet instead of clipboard in standalone mode, toasts clear the Dynamic Island.
* Never write the words "general contractor" anywhere in the product. Use "construction company".
* No dashes in any copy a user can read. Use commas, periods, or "to" for ranges ("Oct 6 to 12").

## 5. Design tokens

Add these as CSS custom properties in `src/styles/tokens.css`. New names use the `--fh-` prefix. Section 6 explains how old names map onto them.

### 5.1 Day theme (default)

| Token | Value | Use |
|---|---|---|
| `--fh-plaster` | `#EDE8DF` | App ground |
| `--fh-paper` | `#FBF9F5` | Surfaces, bars, sheets, inputs |
| `--fh-tray` | `#F5F1EA` | Inset panels (AI notes, voice panel) |
| `--fh-hairline` | `#DAD3C7` | Row dividers, card edges |
| `--fh-hairline-soft` | `#EAE5DC` | Dividers inside panels |
| `--fh-edge` | `#C7BFB1` | Outlines of secondary buttons (their label identifies them) |
| `--fh-edge-strong` | `#8B8375` | Outlines of inputs, switches and checkboxes (3.6 to 1 on paper) |
| `--fh-ink` | `#1B1A16` | Primary text and icons |
| `--fh-ink-2` | `#4F4B43` | Secondary text |
| `--fh-ink-3` | `#66615A` | Captions, timestamps, inactive tab labels |
| `--fh-ink-4` | `#8B8375` | Decorative icons, chevrons and done rail segments only, never text |
| `--fh-focus` | `#1B1A16` | 2 px focus ring on plaster, paper and tray |

Correction from the canvas: captions were drawn at `#6F6A61`, which measures about 4.4 to 1 on plaster. `#66615A` measures about 5.0 to 1. Use `#66615A`.

### 5.2 Gold

| Token | Value | Use |
|---|---|---|
| `--fh-gold` | `#C9963A` | Flat gold: dots, underlines, active markers |
| `--fh-gold-hi` | `#E6C278` | Top of the brushed gradient |
| `--fh-gold-lo` | `#AD7E2E` | Bottom of the brushed gradient |
| `--fh-gold-brushed` | `linear-gradient(180deg, #E6C278 0%, #C9963A 55%, #AD7E2E 100%)` | Primary button, Capture coin |
| `--fh-gold-edge` | `inset 0 1px 0 rgba(255,244,214,.75), inset 0 -1px 0 rgba(80,52,12,.35)` | Lit top edge on brushed gold |
| `--fh-on-gold` | `#1B1A16` | Text and icons on gold, in both themes |

Correction from the glamor sheet: the bottom stop was `#A57628`, where ink measures about 4.3 to 1. `#AD7E2E` measures about 4.8 to 1, so text stays legible across the whole button.

Anything drawn on gold uses `--fh-on-gold`, never `--fh-ink`. At night `--fh-ink` turns to linen, and linen on gold measures about 2.3 to 1.

### 5.3 Onyx stage (glamor layer, same in both themes)

| Token | Value | Use |
|---|---|---|
| `--fh-onyx` | `#16140F` | Hero bands, vault cards, desktop sidebar |
| `--fh-onyx-2` | `#211F19` | Raised items on onyx (dark buttons inside the dock) |
| `--fh-onyx-line` | `#352F26` | Hairlines on onyx |
| `--fh-dock` | `#16140F` Day, `#1E1C16` Night | The dock capsule, so it still reads as its own layer at night |
| `--fh-linen` | `#F2EDE4` | Text on onyx (about 15.8 to 1) |
| `--fh-smoke` | `#9A9183` | Secondary text on onyx (about 5.9 to 1) |
| `--fh-gold-line` | `#C9963A` | 1 px hairline closing an onyx stage |
| `--fh-focus-on-onyx` | `#F2EDE4` | 2 px focus ring on any onyx surface, in both themes |
| `--fh-scrim` | `linear-gradient(180deg, rgba(22,20,15,0) 0%, rgba(22,20,15,.78) 100%)` | Under every line of text over a photo |

An ink focus ring on onyx measures about 1.1 to 1 and disappears. Every control on the stage, the dock, the sidebar, the vault card and the onyx capsules uses `--fh-focus-on-onyx`.

### 5.4 Status (jewel tones)

| Meaning | Dot | Chip fill | Chip text | Words to use |
|---|---|---|---|---|
| Done, paid, on site, passed | `#2E7D4F` | `#DCEADF` | `#1D5536` | On site, Paid, Passed, Approved, Done |
| Coming, scheduled, new | `#3B5F85` | `#DCE5EE` | `#2C4A6B` | Scheduled, New, Starts Mon, Truck 7:10 |
| Late money or failed safety | `#B3362A` | `#F2DCD8` | `#7E2419` | 6 days overdue, Inspection failed |
| Neutral | `#8B8375` | `--fh-paper` with `--fh-hairline` edge | `--fh-ink-2` | Lead, Draft, Sent yesterday |

Rule: every status color travels with a word. Red only for late money or failed safety, never for decoration.

### 5.5 Night theme

| Token | Night value |
|---|---|
| `--fh-plaster` | `#171611` |
| `--fh-paper` | `#211F19` |
| `--fh-tray` | `#2A2720` |
| `--fh-hairline` | `#352F26` |
| `--fh-hairline-soft` | `#2C2821` |
| `--fh-edge` | `#4A443A` |
| `--fh-edge-strong` | `#7A7366` |
| `--fh-ink` | `#F2EDE4` |
| `--fh-ink-2` | `#C9C1B3` |
| `--fh-ink-3` | `#9A9183` |
| `--fh-ink-4` | `#7A7366` |
| `--fh-focus` | `#F2EDE4` |
| Success dot, chip, text | `#5FB37F`, `#1F3A2B`, `#9ED1B1` |
| Info dot, chip, text | `#6E93BA`, `#1E2F40`, `#A9C4DE` |
| Danger dot, chip, text | `#D6735F`, `#3A1F1A`, `#E8B3A8` |
| Neutral chip | `--fh-paper` with `--fh-hairline` edge, `--fh-ink-2` text |
| Gold | unchanged |

Correction from the review: the canvas night caption `#948C7E` measures 4.48 to 1 on the night tray, just under AA, so captions inside the voice panel and AI notes would fail at night. Night ink 3 is now smoke `#9A9183`: about 5.8 to 1 on night plaster, 5.3 on night paper and 4.8 on the night tray.

At night the onyx stage stays `#16140F` and sits almost level with night plaster (about 1.02 to 1). That matches the night render, where the whole screen reads as the stage; the gold hairline carries the edge. The dock moves to `#1E1C16` so it still reads as a separate layer. Changed in Phase 2: stages and vault cards paint `--fh-stage`, which is onyx by day and `#24211B` with a faint gold edge (`--fh-stage-edge`) at night, about 1.13 to 1 against night plaster, so they stay visible; linen on it measures 13.8 to 1 and smoke 5.2 to 1.

### 5.6 Type

Fonts: **Barlow** (400, 500, 600) and **Barlow Condensed** (500, 600). **Bebas Neue** stays for the FIELDHORSE wordmark only. DM Sans is retired from the interface.

Self host the fonts so the PWA works offline. Confirmed on npm on October 10, 2026: `@fontsource/barlow`, `@fontsource/barlow-condensed` and `@fontsource/bebas-neue`, all at 5.3.0. Use `font-display: swap`. Today the fonts come from Google Fonts through a `<link>` in `index.html`; Phase 1 removes that link and its preconnects. The CSP in `netlify.toml` then no longer needs `fonts.googleapis.com` or `fonts.gstatic.com`.

| Role | Face | Size and line | Weight |
|---|---|---|---|
| Hero sentence (Today) | Barlow Condensed | 38 / 40 | 600 |
| Page title | Barlow Condensed | 34 / 36 to 36 / 40 | 600 |
| Big number (Money, Portal total) | Barlow Condensed | 52 / 54 | 600 |
| Bar total (Quote) | Barlow Condensed | 30 / 32 | 600 |
| Section title | Barlow | 18 / 24 | 600 |
| Row title, row money | Barlow | 17 / 22 | 600 |
| Body | Barlow | 16 / 22 | 400 |
| Secondary line | Barlow | 15 / 20 | 400 |
| Meta | Barlow | 14 / 18 | 500 |
| Caption, timestamp | Barlow | 13 / 16 | 500 |
| Tab label (only exception below 13) | Barlow | 12 / 14 | 500, 600 active |

Rules: sentence case everywhere, never all caps labels, `font-variant-numeric: tabular-nums` on the app root, money always shows cents, inputs are 16 px so iOS never zooms. The abbreviated money in `KpiTile` (`moneyK`, such as "$49.9k") breaks the cents rule; the screens that use it switch to full amounts as they are rebuilt.

### 5.7 Space, shape, depth, motion

* Spacing scale: 4, 8, 12, 16, 20, 24, 32, 48. Phone gutter 20. Desktop gutter 28.
* Radius: chips 7, buttons and inputs 12, large buttons 14, cards and panels 14, photo cards 18, vault card 22, sheet top corners 22, dock 28, Capture coin round. This replaces the single 10 px radius the current tokens use everywhere.
* Touch: primary actions 56 tall, anything tappable at least 48 (inline 36 px buttons get a 44 px hit area), 8 px between targets.
* Elevation:
  * Flat: hairline only. Default for lists.
  * Tray: paper with a hairline, 5 to 6 px padding around a hero card (the double bezel).
  * Raised: `0 18px 30px -18px rgba(60,40,10,.45), 0 2px 6px rgba(60,40,10,.08)`. Photo card and vault card only.
  * Overlay: `0 16px 28px -14px rgba(22,20,15,.55)`. Dock, sheets, toasts, command palette.
* Grain: about 3 percent noise, only on onyx, drawn on a fixed `pointer-events: none` layer so it never repaints during scroll.
* Motion: keep the existing `--ease`, `--ease-out` and `--ease-mechanical` curves. Press: move down 1 px and darken, Capture coin scales to 0.96. Sheets rise in 280 ms and leave in 180 ms. Lists stagger 30 ms per row for the first 8 rows on first load only. Under `prefers-reduced-motion`, use fades only.
* Z layers: keep the existing `--z-nav`, `--z-modal`, `--z-cmdk`, `--z-banner` (45) and `--z-overlay` (100). `--z-toast` does not exist yet; Phase 1 adds it above `--z-modal` and below `--z-cmdk`.

### 5.8 Icons

Keep `lucide-react`. Wrap it in one `Icon` component that forces `strokeWidth={1.75}`, round caps and joins, and sizes 18, 22 and 24. No emoji anywhere. Icon only buttons always carry `aria-label`.

## 6. Token migration

`tokens.css` today defaults to the dark v3 theme, with a `[data-theme='light']` block, a `[data-theme='dark']` block and a `prefers-color-scheme` block. It uses DM Sans and Bebas Neue and sets 2 px radii. `global.css` is about 275 KB, and `v3.css` and `fixes-2026-07.css` layer on top.

1. Add the `--fh-` tokens from section 5 at the top of `tokens.css`.
2. Make Day the default. The `[data-theme='dark']` block becomes Night and points at the section 5.5 values. The theme lives in four places that must change together:
   * `src/styles/tokens.css`
   * `src/contexts/ThemeContext.tsx` (`THEME_COLOR`, the stored key `fh:theme`, the dark default)
   * the pre paint script in `index.html`, whose sha256 hash sits in the CSP in `netlify.toml` and must be updated with any edit
   * `theme_color` and `background_color` (`#141414` today) in the manifest in `vite.config.js`
3. Point the existing names at the new tokens so current screens restyle without edits. The `--v3-` family carries most of the app (for example `--v3-primary` has about 309 uses and `--font-body` about 682), so it must be mapped along with the older names:
   * `--v3-bg`, `--surface-0` and `--fh-canvas` to `--fh-plaster`; `--v3-surface` and `--surface-1` to `--fh-paper`; `--v3-surface-2` and `--surface-2` to `--fh-tray`
   * `--v3-text` and `--ink-strong` to `--fh-ink`; `--v3-text-secondary`, `--ink-muted` and `--linen-muted` to `--fh-ink-2`; `--v3-text-muted` and `--v3-text-faint` to `--fh-ink-3`
   * `--v3-border` and `--rule` to `--fh-hairline`; `--v3-border-strong` to `--fh-edge`
   * `--v3-primary` stays `#C9963A`. The text safe tokens added on October 9 (`--v3-primary-text`, `--v3-danger-text`, `--v3-success-text`) keep a value that passes 4.5 to 1 on the new ground in each theme; the contrast test covers them.
   * `--stage-*` and `--v3-stage-*` to the jewel status values in 5.4
   * `--font-body` to Barlow, `--font-display` to Barlow Condensed, with a new `--font-wordmark` for Bebas Neue
   * radius tokens to the section 5.7 scale
   * `--fh-gold` is already referenced in `global.css` with a `#C9963A` fallback, so defining it changes nothing there.
4. Build new screens on new components (section 7) that read only `--fh-` tokens.
5. In Phase 7, delete CSS that no screen uses any more and the effect components nobody renders (`src/components/fx/Aurora`, `ScanLine`, `GridPattern`, `Spotlight` and similar), after confirming with a search. On October 10, `Spotlight` was still rendered by `PourWindow.tsx`, and `Aurora` and `GridPattern` by `ResetPassword.tsx` and `PartnerInvite.tsx`; Phases 2 and 5 restyle those screens first.

## 7. Components

New components live in `src/components/fh/`. Each one reads only `--fh-` tokens, has hover, pressed, focus, disabled and loading states where they apply, and supports Day and Night. Reuse the existing shadcn wrappers in `src/components/ui/` underneath. They sit on the umbrella `radix-ui` package (Dialog, Switch, Tabs, Tooltip and more), with `vaul` for the drawer, `cmdk` for `ui/command.tsx` and `sonner` for toasts. The repo also has `src/lib/tabs.ts` and `src/lib/useModalFocus.ts` for keyboard tabs and modal focus.

| Component | What it is | Notes |
|---|---|---|
| `Button` | Primary (brushed gold), secondary (paper with edge), quiet (text), destructive (red text, separate), mini (36 tall, 44 hit area) | One primary per screen. Loading shows a skeleton bar inside the button, never a spinner. |
| `IconButton` | 44 or 48 round or rounded square | `aria-label` required |
| `Field` | Label above, input with `--fh-edge-strong` outline, helper below, error replaces helper | Error says what is wrong and how to fix it |
| `Chip` | Status chip from 5.4 | Always a word, never only a color |
| `SyncPill` | Synced, Syncing, Offline with queued count | Reads `outbox.ts` and `captureOutbox.ts` state |
| `StageRail` | Five segments Lead, Quote, Job, Invoice, Closed | Done segments `--fh-ink-4`, current gold with bold label, future hairline. Optional note line under each label on desktop. See the stage rule below. |
| `Row` | Hairline list row: who and what on the left, money and next on the right | 64 px minimum, whole row is the link |
| `SpineEntry` | Time column, line and marker, title, subline, optional photos | Green filled marker for passed and paid events |
| `OnyxStage` | The one dark band per screen | Grain layer, optional warm glow top right, gold hairline at the bottom |
| `PhotoCard` | Photo in a paper tray, scrim, text in linen | Falls back to an onyx stage with no photo |
| `VaultCard` | Onyx card in a paper tray with the big number | Money and desktop facts panel |
| `Monogram` | Company badge: logo from `profiles.logo_url`, else initials in brushed gold on onyx with a gold edge | `src/components/Monogram.tsx` today is an unused Fieldhorse app mark; the new badge replaces it |
| `Dock` | Floating onyx capsule, five items, brass Capture coin | Replaces `BottomNav.tsx` and keeps its role filter |
| `Sheet` | Bottom sheet with grabber and paper surface | Built on `vaul`; swipe down closes; confirm before closing with unsaved changes |
| `Toast` | Onyx toast with an Undo action | Built on `sonner` through `AppToaster.tsx` and `lib/toast.ts`; `toastUndo` already holds 8 seconds; clears the Dynamic Island |
| `Skeleton` | Shaped like the data it stands in for | Replace spinners |
| `EmptyState` | Icon, one line, the one action that fills it | Jobs empty state offers "Import from Jobber" (`/import`) |
| `KeyCap` | Small key label for desktop shortcuts | Command palette and buttons |

**Stage rule.** Pipeline v2 (migration 047) retired `invoice` as a stage: invoices are `fh_invoices` rows against a job, and `invoice` is kept only as a legacy alias of `job` (`lib/stages.ts`). The rail therefore derives its fourth segment:

| Record | Current segment |
|---|---|
| `stage` is `lead` | Lead |
| `stage` is `quote` | Quote |
| `stage` is `job` or `invoice`, `completed_at` empty | Job |
| `stage` is `job` or `invoice`, `completed_at` set ("work done, money out") | Invoice |
| `stage` is `closed` | Closed |
| `stage` is `lost` | No current segment; a neutral "Lost" chip sits beside the rail |

## 8. Navigation

### 8.1 Phone: the dock

| Slot | Label | Route | Built from |
|---|---|---|---|
| 1 | Today | `/` | `Home.tsx` |
| 2 | Jobs | `/work` | `Work.tsx` (keep the `/leads`, `/quotes`, `/jobs` and `/pipeline` redirects and the detail routes) |
| 3 | Capture | opens `CaptureSheet` | `CaptureFab.tsx` folds into the dock; keep ⌘J, which `CaptureSheet.tsx` handles today |
| 4 | Money | `/invoices` | `Invoices.tsx`; Reports link goes to `/analytics` |
| 5 | Inbox | `/inbox` (new) | Phase 6. Until then the slot shows Schedule (`/schedule`) so the dock never points at an empty screen (decision D2). |

Items follow the role filter, so a crew member without money access sees Today, Jobs, Capture and Schedule. The Capture coin stays in the middle of whatever items remain.

Dock spec: onyx capsule (`--fh-dock`), 16 px from each side, floating above the home indicator with safe area padding, 28 radius, overlay shadow. Active item in linen with a 4 px gold dot under the label; inactive in smoke. Capture is a 56 px brushed gold coin raised above the capsule, ink plus icon. Scroll content gets bottom padding so nothing hides behind the dock. The dock hides while the keyboard is open (see `src/styles/mobile-keyboard-fix.css`), on full screen flows, and on detail screens that carry their own onyx action capsule (Job in 9.4, Quote in 9.6), as the glamor Job render shows. Those capsules keep the camera and microphone, so Capture is still one tap away.

### 8.2 Phone: workspace menu

Tapping the company monogram opens a sheet that replaces the old "More tools" drawer. Items are filtered by role with `canViewRoute`, as the drawer does today:

* Work: Schedule, Estimates (`/bid`), Forecast (`/pour-window`), Clients, Field reports (`/notes`)
* Team: Crew home (`/crew`), Tasks, Timesheets, Team
* Office: Subs, Partners, Sub portal, Activity, Compose, Import, Settings (message templates live at `/settings#templates`)
* Day, Night and Auto, as a small three way control. Settings is owner and admin only, so crew need this here.
* Sign out, set apart at the bottom

Decision D4: the monogram sits at the top left of the phone header on every screen, with search and the bell at the right, so every route in this menu is two taps from anywhere and search is one. When Today gets its own onyx stage in Phase 2, the same three controls move onto the stage.

### 8.3 Desktop: sidebar

Onyx sidebar, 232 px, built from the existing `DesktopSidebar.tsx`. Top: monogram, company name, city. Search field with ⌘K. Items: Today, Schedule, Jobs, Money, Inbox (Phase 6), Customers (`/clients`), Reports (`/analytics`), Automations (only when the Growth screens exist). A collapsible "Team and office" group holds the remaining routes from 8.2. Bottom: Settings, then the signed in person. Active item: linen text, a 3 px gold bar on the left edge, faint warm highlight. Inactive: smoke text, thin linen icons. Focus rings use `--fh-focus-on-onyx`.

## 9. Screens

Every screen follows: one onyx stage, one gold action, hairline lists on plaster, no nested card stacks, empty and loading and error states drawn.

### 9.1 Welcome and Login (`Login.tsx`), Phase 5

* Top 62 percent: a photo of finished work fading into onyx. Use real Parker Construction or Shyld photos, not stock and not AI images. Until real photos exist, show onyx with grain only.
* FIELDHORSE wordmark, FIELD in brushed gold, HORSE in linen, gold hairline under it.
* Line: "Run every job like a captain."
* Brushed gold "Sign in", outlined linen "Create a workspace", small smoke line "Bring your jobs over from Jobber in a few minutes."
* Existing sign in, reset and invite flows stay as they are.

### 9.2 Today (`Home.tsx`), Phase 2

* Onyx stage (top about 46 percent): monogram (opens the workspace menu), company name, `SyncPill`, notifications bell (`NotificationsBell.tsx`). Date line. Hero sentence. Weather and pour line from the existing pour window and weather logic. Gold hairline at the bottom.
* Next stop `PhotoCard` overlapping the stage edge: newest `fh_job_files` row with `kind = 'photo'` for that job, label "Next stop, 7:30 am", job name, "Navigate" pill that opens maps.
* Needs an answer: top 3 items from `lib/homeDashboard.ts`, each a `Row` with a dot, title, subline and one mini action (Remind, Nudge, Reply, Close job). "See all" when there are more.
* Your day: today's schedule rows with time, job, one line of detail, address and Navigate. "Week" opens `/schedule`.
* The hero sentence is built in code from counts, never by the model. Patterns:
  * stops today and a first pour: "Three stops. First pour at 7:30."
  * stops, no pour: "Two stops. First at 9:00."
  * nothing scheduled: "Clear day." with the line "Nothing on the schedule."
* Night variant (after local sunset, section 10): "Pour went clean. Two things before tomorrow." pattern, "Today, done" list with Done and Paid chips, and "Tomorrow".

### 9.3 Jobs (`Work.tsx`), Phase 2

* Condensed title "Jobs", search and filter icon buttons.
* Stage tabs with counts: All, Leads, Quotes, Jobs, Done (decision D3). Lost sits behind the filter button. Gold 2 px underline on the active tab. Invoices stay on the Money screen. The old `?stage=active` and `?stage=lost` links keep working.
* Grouped `Row` lists with a group total ("$49,875.00 in progress").
* Row: name, job line, amount, then a chip or a gray next step.
* The existing board layouts in `Work.tsx` stay available on desktop as a view toggle.

### 9.4 Job and the Spine (`ContactDetail`, `/jobs/:id`), Phase 2

* Full bleed cover photo header (newest job photo) fading into an onyx band with the job title, client and address in linen, gold hairline below. Translucent dark back and more buttons on the photo. "14 photos" pill opens the gallery.
* No photo: the onyx band alone with the same text.
* `StageRail` (stage rule in section 7), then the money strip: Contract, Paid, Balance, margin chip (green 30 percent and up, neutral 15 to 30, red under 15, always with the number).
* Quick actions: Call, Message, Navigate, Photos.
* The Spine: one timeline of everything on the job, newest first: notes and voice notes (`fh_notes`), photos and files (`fh_job_files`), messages, payments, schedule events, stage moves (`fh_stage_transitions`), inspections, partner changes. Build a `jobTimeline` helper modeled on `lib/clientTimeline.ts`. "Add" opens Capture already attached to this job.
* Bottom bar: onyx capsule with camera and microphone buttons and one brushed gold action that follows the stage (Send quote, Schedule, Create invoice, Close job). The dock hides on this screen (8.1).
* Contact info, milestones, documents and partners move into a "Details" sheet on phone and into the facts panel on desktop. Nothing is removed.

### 9.5 Capture (`CaptureSheet.tsx`), Phase 2

* Paper sheet with grabber over a dimmed screen.
* Voice panel on `--fh-tray`: "Heard", waveform, duration, the transcript, "Filed as" chips (kind, action, time, job), the location hint line with "Change", brushed gold "Save" and secondary "Edit".
* "Or start with" list: Photo, Note, Lead, Quote, Invoice, Expense, Time.
* Keep every trust rule: confirm before write, `normalizeIntent()` validation (`lib/captureIntelligence.ts`), save as note fallback, offline outbox.

### 9.6 Quote editor, Phase 3

The quote editor lives inside the job detail and `Bid.tsx`; confirm the exact components while planning Phase 3.

* Title "Quote" with a status chip, client and address.
* AI note on `--fh-tray` with a small gold sparkle: "Drafted from your rate card and Tuesday's site notes. Edit any line."
* Line items as rows: name, detail line (quantity at unit rate), amount. "Add a line".
* Optional upgrade panel with a photo thumbnail and a switch.
* Bottom onyx capsule: "Total" label, total in linen, deposit line, brushed gold "Send for approval". The dock hides on this screen (8.1).
* "Preview as Marco" opens the customer view (9.9).

### 9.7 Money (`Invoices.tsx`), Phase 3

* `VaultCard`: "Collected this week", big number, gold hairline, then Due this week, October so far, Margin. Monogram top right.
* Groups: Overdue (with Remind), Due soon, Waiting on approval (sent quotes), Paid (last 10 days).
* "Reports" opens `/analytics`.
* Numbers come from `lib/invoices.ts`, `lib/rollups.ts` and payments; no new queries unless a rollup is missing.

### 9.8 Inbox (`/inbox`), Phase 6

* Built on what the database already has, as typed in `src/lib/database.types.ts`: the `fh_v_inbox` view, `fh_conversations`, `fh_messages`, `fh_agent_runs`, and the `fh_agent_run_approve` and `fh_agent_run_reject` functions. The Growth Engine documents (`GROWTH_ENGINE.md`, `SCHEMA_REFERENCE.md`, `prompts/GROWTH_FRONTEND_PROMPT.md`) are not in this repository; push them before Phase 6 if they exist elsewhere.
* Thread: header with name and a job chip, sent bubbles in ink with linen text, received bubbles on paper.
* AI draft panel: "Draft reply", editable text, an optional linked action as a checkbox ("Also move Thursday's visit to 11:30"), brushed gold "Send and move visit", quiet "Just send". Draft mode only; nothing sends without the tap.
* Composer with dictation and a dark send button.

### 9.9 Customer portal (`PublicDoc.tsx`, `/p/:token`), Phase 5

* Add a new theme to `components/documents/proposalThemes.tsx` and make it the default for new documents.
* Cover photo of the job (or of the contractor's best finished work) fading into onyx. Contractor monogram, name, "Licensed and insured" line from `profiles.insured_text`, call button.
* Headline: "Hi Marco, your quote is ready." Address line. Gold hairline.
* Total panel in a paper tray: total, deposit sentence.
* "What's included" rows, optional upgrade switch, "What happens next" numbered steps (a real sequence, so numbers are right here).
* Bottom onyx capsule: brushed gold "Approve and pay $9,229.00", linen link "Ask Jesse a question first".
* "Powered by Fieldhorse" small at the very bottom.
* Approval, signature (`SignaturePad.tsx`) and payment link (`lib/payLink.ts`) logic stay as they are.

### 9.10 Desktop Schedule (`Schedule.tsx`), Phase 4

* Toolbar: title with the date range, Today, previous and next, Week, Month, Crew segmented control, brushed gold "New job".
* Week grid on a paper panel, hourly hairlines, today column tinted with a gold dot and a 2 px gold now line.
* Event blocks by status color with title and one detail line. Finished work in muted plaster.
* Right rail: Unscheduled cards with drag handles (drag onto the week through `@dnd-kit/core`, which was removed as unused on October 9 and comes back in this phase), then Crew this week with hours.

### 9.11 Desktop Job, Phase 4

* Photo banner with title and actions (Message, Schedule, brushed gold Create invoice with key cap I).
* Full width `StageRail` with notes.
* Two columns: the Spine with a composer on top; the facts panel with a `VaultCard` for balance, then Customer, Address with map, Crew, Documents, Shared with.
* Uses the existing `DetailListRail` layout where it fits.

### 9.12 Command palette (`CommandPalette.tsx`), Phase 4

* Centered paper panel over a 45 percent scrim, search field with esc key cap.
* Groups: Jobs, Actions (with key caps I, M, N), Customers, Documents.
* Footer: arrows to move, enter to open, esc to close.

### 9.13 States, all phases

* Empty: one line and the one action that fills the list.
* Loading: skeletons shaped like the content. No spinners.
* Error: under the field, says what happened and how to fix it. Data errors use `DataErrorState.tsx` with a retry.
* Offline: a calm band ("No signal here. 3 changes are saved on this phone and will sync when you're back."), the sync pill shows Offline with a count, every toast still offers Undo.

## 10. Day and Night

* Extend `ThemeContext` with three modes: Auto (default, decision D1), Day, Night. The choice lives in Settings and in the workspace menu. Everyone starts in Auto once Phase 1 ships, because the old `fh:theme` key was written on every launch and cannot tell a real choice from the old dark default.
* Auto switches to Night at local sunset and back at sunrise, using `profiles.location_lat` and `profiles.location_lon`. The times are computed in the app with the standard NOAA sunrise equation instead of fetched from Open Meteo, so Auto works offline and needs no extra request (`lib/weather.ts` does not ask Open Meteo for sunrise or sunset today). Fall back to 7 pm and 7 am when there is no location.
* The theme must be right on the first frame. The app caches today's and tomorrow's sunrise and sunset in local storage, and the pre paint script in `index.html` picks Day or Night from them (or the 7 pm and 7 am fallback). Update the script's sha256 hash in the CSP in `netlify.toml` with it.
* Night uses the same layouts. Only the token values change.

## 11. Photography rules

* Photos are the contractor's own job photos from `fh_job_files`. No stock and no AI images in production.
* Cover photo rule: newest `kind = 'photo'` file on the job. A pinned cover is a later feature.
* Load thumbnails for lists and full size only in headers and the gallery. The Supabase organization (FieldCap) was on the Free plan on October 10, 2026, and as far as I know Supabase Storage image transformations need a paid plan; check the current Supabase pricing page before relying on them. Until then, make a small thumbnail in the browser when a photo is uploaded and store it beside the original. Photos uploaded before that keep loading full size, lazily, until a backfill runs.
* Every line of text over a photo sits on `--fh-scrim`.
* Always reserve the image box with `aspect-ratio` so nothing jumps while loading.

## 12. Accessibility

* Contrast pairs, measured from the hex values above with the WCAG formula on October 10, 2026. The automated test must assert each one in its theme:

| Pair | Measured | Needs |
|---|---|---|
| Ink on plaster | 14.3 to 1 | 4.5 |
| Ink on paper | 16.6 to 1 | 4.5 |
| Ink 2 on plaster | 7.1 to 1 | 4.5 |
| Ink 3 on plaster | 5.0 to 1 | 4.5 |
| Ink 3 on tray | 5.5 to 1 | 4.5 |
| Linen on onyx | 15.8 to 1 | 4.5 |
| Smoke on onyx | 5.9 to 1 | 4.5 |
| Smoke on the night dock | 5.5 to 1 | 4.5 |
| Ink on gold, middle | 6.6 to 1 | 4.5 |
| Ink on gold, bottom stop | 4.8 to 1 | 4.5 |
| Chip text on chip fill, Day | 7.0 to 7.4 to 1 | 4.5 |
| Chip text on chip fill, Night | 7.2 to 8.2 to 1 | 4.5 |
| Night ink 3 on night plaster | 5.8 to 1 | 4.5 |
| Night ink 3 on night tray | 4.8 to 1 | 4.5 |
| Edge strong on paper (input outline) | 3.6 to 1 | 3 |
| Night edge strong on night paper | 3.5 to 1 | 3 |
| Linen focus ring on onyx | 15.8 to 1 | 3 |
| Ink 4 on plaster (done rail segment) | 3.1 to 1 | 3 |

* Gold dots and underlines on plaster measure about 2.2 to 1 and do not reach 3 to 1 on their own, so every gold marker sits next to a bold ink label that carries the meaning.
* Real `button`, `a` and `input` elements, labels above inputs, `aria-label` on icon buttons, visible focus rings (2 px `--fh-focus` on plaster and paper, 2 px `--fh-focus-on-onyx` on any onyx surface), focus moves to the main heading on route change, toasts use `aria-live="polite"`.
* Text scales with system settings without clipping; long names wrap instead of truncating where there is room.

## 13. Verification

* `npm run test:all` passes after every phase, and so does `npm run audit:design`, which Phase 1 moves from the old six color palette and single radius to the scales in section 5.
* A unit test that reads the token values and asserts every pair in section 12 meets its threshold in Day and Night.
* Playwright screenshots for each finished screen at 390 by 844 (Day and Night) and 1440 by 900, kept as baselines in `tests/`.
* Manual check on Jesse's iPhone as an installed PWA: safe areas, dock above the home indicator, keyboard hides the dock, toasts clear the Dynamic Island, voice capture still records.
* Before each deploy, confirm `dist/` has **no** `_redirects` file. All redirects live in `netlify.toml`: the `/assets/*` rule that returns a real 404 for missing files, then the `/*` to `/index.html` fallback. A `_redirects` file would be read first and its catch all would hide the asset rule. The live site was checked on October 10: a missing asset returns 404 and app routes return 200.

## 14. Risks

* **Size of the old CSS.** About 275 KB in `global.css` plus overlays. Mapping old token names onto new values keeps old screens working while new ones are built; dead CSS is only deleted in Phase 7.
* **Day becomes the default for everyone.** People who never picked a theme open the app in Day the first time Phase 1 ships, and older screens that were drawn dark first get their first real daylight use. Expect a round of fixes in Phase 1 on screens the light theme sweep of October 9 did not reach.
* **Where the code lives.** Cloud sessions work from the GitHub repository only. Anything that exists only in the OneDrive folder (the Growth Engine documents, the marketing site, local renders) is invisible to them until it is pushed. On a Windows machine, mark the OneDrive folder "Always keep on this device" before a long session so builds and git do not stall.
* **Font change.** Switching from DM Sans to Barlow shifts line lengths everywhere. Expect wrapping fixes in older screens during Phase 1.
* **Inbox timing.** Phase 6 depends on the Growth frontend work; the dock shows Schedule in that slot until it ships.
* **Photo weight.** Full bleed photos on slow job site connections, with no image transformations on the Free plan. Upload time thumbnails, lazy loading below the fold and reserved boxes keep this in check.

## 15. Open questions for Jesse

1. Can you send two or three real photos of finished Parker Construction or Shyld work for the Welcome screen and the portal fallback?
2. Should Night switch on automatically at sunset, or start in Day until someone turns it on? Built as Auto for now (D1).
3. Settled: the fifth dock slot shows Schedule until the Inbox ships (D2).

## 16. Review log, October 10, 2026

Every claim in the October 9 draft was checked against the `main` branch at `d40f137`, the production database types and the live site. What changed:

| Section | What the draft said | What the code shows | Change made |
|---|---|---|---|
| 2 | Renders are copied into `docs/design/2026-10-redesign/` | The folder did not exist in the repository | Copied all 19 renders from the canvas assets (checksums matched) as JPEG |
| 3, 9.8 | Growth Engine documents and the marketing site are in the repo | `GROWTH_ENGINE.md`, `SCHEMA_REFERENCE.md`, `prompts/GROWTH_FRONTEND_PROMPT.md`, `website/` and `FieldhorseSite.jsx` were never committed | Phase 6 points at the database types, which do include the inbox tables |
| 4 | Roles are owner, partner, field and guest | `org_role` is owner, admin, manager, foreman, crew; partners are per job; subs use the sub portal | Roles restated; role filtering made explicit |
| 4 | Upserts debounce at 800 ms with `updated_by` on every save | No 800 ms upsert, no `updated_by` column; realtime cache refresh debounces at 1200 ms | Constraint restated as "keep current sync" |
| 4 | Voice through MediaRecorder plus Whisper | Voice uses the Web Speech API; there is no transcription function | Constraint restated |
| 4 | Trust rules in `NORTH_STAR.md` | It had been moved to `docs/archive/` on October 9 | Moved back to `docs/NORTH_STAR.md` |
| 5.1, 5.5, 12 | Night ink 3 `#948C7E` | 4.48 to 1 on the night tray, under AA | Night ink 3 is smoke `#9A9183` (4.8 to 1) |
| 5.1, 5.5, 7 | Inputs outlined in `--fh-edge` | 1.7 to 1 on paper, under the 3 to 1 for input boundaries | Added `--fh-edge-strong` for inputs |
| 5.3, 12 | 2 px ink focus ring on Day | About 1.1 to 1 on onyx, invisible on the stage, dock and sidebar | Added `--fh-focus-on-onyx` |
| 5.2 | Text on gold | Night would turn `--fh-ink` to linen, 2.3 to 1 on gold | Gold always uses `--fh-on-gold` |
| 5.5 | Night values | No night value for `--fh-ink-4` or `--fh-hairline-soft`; the dock color had no token | Added them and `--fh-dock` |
| 5.6 | Confirm font package names | `@fontsource/barlow`, `barlow-condensed` and `bebas-neue` exist at 5.3.0; fonts load from Google Fonts today | Names confirmed; removal of the Google link noted |
| 5.7 | Keep `--z-toast` | `--z-toast` is not defined | Phase 1 adds it |
| 6 | Map `--surface-*`, `--ink-*` and `--rule` | Most screens use the `--v3-` family; the theme also lives in `index.html`, the CSP hash and the manifest | Mapping and the four theme locations added |
| 7 | Reuse shadcn and Radix | Present through the umbrella `radix-ui` package; `@dnd-kit` was removed on October 9; `KanbanBoard.tsx` does not exist | Notes corrected |
| 7, 9.4 | Rail segment "Invoice" | Migration 047 retired the invoice stage | Stage rule added, built on `completed_at` |
| 8.1, 9.4, 9.6 | Dock on every screen, plus screen capsules on Job and Quote | Two bottom capsules would stack; the glamor Job render shows no dock | Dock hides where a screen has its own capsule |
| 9.3 | Tabs All, Leads, Quotes, Jobs, Invoices | No invoice stage; Done and Lost would become unreachable | Moved to decision D3 |
| 10 | The app already asks Open Meteo for sunrise and sunset | `lib/weather.ts` does not request them | Add them; cache for the pre paint script |
| 11 | Check image transformations | The Supabase organization is on the Free plan | Thumbnails at upload time |
| 13 | Confirm `_redirects` is in `dist/` | This repo forbids a `_redirects`; it would hide the asset 404 rule | Check reversed |
| 6 | Delete effect components in Phase 7 | Still rendered by `PourWindow`, `ResetPassword` and `PartnerInvite` | Those screens assigned to Phases 2 and 5 |

All eleven contrast figures in the October 9 table matched the WCAG formula within 0.1.

## 17. Decisions, October 10, 2026

| Id | Question | Decision |
|---|---|---|
| D1 | Night at sunset by default, or Day until someone turns Night on | Auto at sunset, as the canvas note says. Not answered directly yet; a one line change if Jesse prefers Day |
| D2 | Fifth dock slot before the Inbox ships | Schedule until Phase 6 (Jesse) |
| D3 | Jobs tabs | All, Leads, Quotes, Jobs, Done, with Lost behind the filter button (Jesse) |
| D4 | Where the workspace menu and search live on a phone | Monogram at the top left of the header on every screen, search beside the bell (Jesse) |
