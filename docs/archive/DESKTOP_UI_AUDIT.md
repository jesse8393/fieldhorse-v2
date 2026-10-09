# Desktop UI/UX Audit

**Target reference:** [Snow Dashboard UI Kit (Figma Community)](https://www.figma.com/design/G79pAYGQPGyyR0Pv5gz4VY/Snow-Dashboard-UI-Kit--Community-) — dark, dense, table-heavy SaaS dashboard. Modern desktop vibe: persistent left rail, KPI tiles top, real sortable tables, multi-pane detail, hover everywhere, keyboard shortcuts.

**Diagnosis in one paragraph:** the foundation is there — a layout-mode router, a `DesktopSidebar`, dedicated `Desktop*` composition components for Home, Jobs, Clients, Schedule, Job Detail, a Cmd+K command palette, and the full shadcn + Radix primitives library. But the patterns rendering inside that foundation are mobile patterns enlarged. Every list is a card grid (no tables). Every action goes through a bottom drawer (no right-click). Detail screens are forced into a 440px column on a 27" monitor because the layout-mode router pins them to `mobile-frame`. The bottom nav still renders at desktop widths. There are zero hover states or tooltips in the entire `src/components/desktop/` directory. That's why it reads as a phone app — not because the design is bad, but because the desktop conventions that signal "real website" are missing.

---

## What's already in place (keep)

- **`shadcn` + Radix primitives + `cmdk` + `vaul` + `clsx` + `tailwind-merge` + `class-variance-authority`** — every dep needed to build a Snow-grade desktop UI ships in `package.json`. No new framework choice required.
- **Layout-mode router** at `src/components/AppShell.tsx:55-90`. Three modes (`mobile-frame`, `prose`, `responsive`) keyed off path. The architecture for desktop-vs-mobile divergence exists.
- **`DesktopSidebar`** at `src/components/DesktopSidebar.tsx` — persistent 240px left rail at ≥900px with primary + secondary nav. The real desktop nav pattern.
- **`Desktop*` composition components** at `src/components/desktop/` — five files (Home, Jobs, Clients, Schedule, Job Detail). Skeletons present.
- **Cmd+K command palette** at `src/components/CommandPalette.tsx:73` — global shortcut wired. Linear/Notion-style entry point exists.
- **Responsive breakpoint at 900px** — a sensible split. Phones, narrow tablets, and the rest.

The foundation is fine. The patterns living on it are wrong.

---

## The "phone app stretched" tells

### Severity 1 — visible the second a user lands on desktop

**FH-D-001 · BLOCKER** — Detail screens are pinned to a 440px column on desktop.
`src/components/AppShell.tsx:55-90` — `layoutForPath()` returns `'responsive'` for `/`, `/jobs`, `/clients` etc. but **deliberately omits `/jobs/:id` and `/clients/:id`** so they fall through to `mobile-frame`. The comment on line 68-71 acknowledges this is intentional. Result: at `src/styles/global.css:2256` the `.fh-app--layout-mobile-frame .fh-app__main-inner { max-width: 440px }` rule clamps every deal page and every client page to 440px wide on a 27" monitor. `DesktopJobDetail.tsx` is rendered inside that column — so the elaborate desktop variant is squeezed into the phone width. **This is the worst offender; nothing else even comes close.** Fix: promote both detail routes to `'responsive'`. Author the desktop tab strip + work-area composition on the full canvas.

**FH-D-002 · BLOCKER** — Bottom nav still shows on desktop.
`src/styles/global.css` around the `fh-nav` rules at the 900px breakpoint — the bottom tab bar isn't `display: none` at desktop widths; it's just repositioned. The `DesktopSidebar` is the nav at ≥900px, and a bottom tab bar BELOW the sidebar is the #1 visual tell of "this is a phone app." Fix: `@media (min-width: 900px) { .fh-nav { display: none } }`.

### Severity 2 — desktop conventions absent

**FH-D-003 · HIGH** — Zero tables in the application UI.
`grep -rl "<table\|<thead\|<tbody" src/` returns only the four document-template files (invoice and proposal PDFs). Every list view in the app is a card grid. Snow Dashboard is built on tables. Jobs, Clients, Invoices, Payments, Subs, Activity — every list is a table candidate (sortable columns, density variants, multi-select via shift-click, column visibility, frozen left/right columns, virtual scrolling for 1000+ rows). **The single highest-leverage change to make it feel desktop.** Build a `<DataTable>` primitive on `@tanstack/react-table` (not currently installed; add it).

**FH-D-004 · HIGH** — Zero hover states or tooltips in `src/components/desktop/`.
`grep -l ":hover\|whileHover" src/components/desktop/` returns nothing. Desktop UX *is* hover — tooltip on every icon button, hover-reveal of row actions, hover-preview on cards, hover lift on tiles. Snow Dashboard uses hover on nearly every interactive element. Currently every icon button is mystery meat at hover. Fix: ship a `<Tooltip>` wrapper (Radix tooltip is in deps) on every icon button + `hover:` rules in Tailwind on every card and row.

**FH-D-005 · HIGH** — No multi-pane / master-detail layouts.
Jobs at desktop is still a single-column grid filling the canvas. Snow-style pattern: list on left (compact row, 40-60px tall), selected job's detail right (filling the remaining canvas). No round-trip navigation — click in list, detail loads in place. Same for Clients. Same for Invoices. Fix: add a `<MasterDetail>` shell that takes a list + detail render fn, wires URL state for which row is selected.

**FH-D-006 · HIGH** — No right-click context menus.
Every job-card action goes through a tap → bottom drawer pattern (Vaul). Desktop convention: right-click a job → context menu with Mark complete, Mark lost, Log payment, Copy link, Delete. Radix provides `@radix-ui/react-context-menu` (it's already a peer of installed primitives). Fix: wrap `<JobCard>` and table rows with `<ContextMenu>`.

**FH-D-007 · MEDIUM** — Card variants are oversized at desktop.
`src/components/v3/JobCard.tsx` is a photo-heavy card tuned for one-handed scanning. On a wide canvas it reads as "huge tiles." Snow Dashboard's row variant: 40-60px tall, thumbnail + two-line meta + money column + stage chip + last-touch stamp, fits 12-15 per screen. Fix: add a `<JobRow>` companion to `<JobCard>`; toggle via a view picker (Cards · List · Table).

**FH-D-008 · MEDIUM** — `+` FAB is a mobile pattern.
`src/screens/Jobs.tsx` floats a "+" bottom-right (FAB). Desktop convention: `+ New lead` in the page toolbar, top-right. Their current Jobs *does* have a desktop "New lead" button per `src/screens/Jobs.tsx:333-341`, but the FAB still also shows. Hide the FAB at ≥900px.

### Severity 3 — polish that compounds

**FH-D-009 · MEDIUM** — Hit targets sized for thumbs, not cursors.
44pt minimum is the iOS HIG. Desktop targets work fine at 28-32px. Header icon buttons at `AppHeader.tsx:118, :143` are 34×34 — too small for iOS per the earlier mobile audit (FH-038) but on desktop they read as cramped *and* the 8px gap between them feels mobile-tight. Fix: ship a `--ds-cursor` size variant on icon buttons; at desktop, render at 32×32 with 12px gap and proper hover bg.

**FH-D-010 · MEDIUM** — Sidebar is fixed-width, no collapse.
`DesktopSidebar.tsx` is 240px wide always. Desktop convention: collapse to icons (~60px) with a pin/unpin toggle, persisted in localStorage. Snow Dashboard's sidebar collapses. Reclaims ~180px of canvas for the work area. Fix: add a `sidebar-collapsed` state in `ProfileContext.preferences`, toggle button at the rail bottom.

**FH-D-011 · MEDIUM** — Keyboard shortcuts stop at Cmd+K.
The palette is wired. Beyond that, `grep -rn "addEventListener.*keydown\|metaKey" src/` returns only ActionSheet's Cmd+Enter to commit. Snow Dashboard / Linear / Notion all have:
- `g` then `j` jump to Jobs, `g c` to Clients, `g h` to Home
- `j` / `k` to navigate rows in a list
- `c` to create new
- `?` to show shortcut overlay
- `/` to focus search
- `esc` to close any modal
Fix: add a `useKeyboardShortcut` hook + a `<ShortcutsOverlay>` modal. The data layer (route nav, list focus state) is already there via React Router + React Query.

**FH-D-012 · MEDIUM** — Drag-and-drop is wired but unused on the Jobs board.
`@dnd-kit/core` and `@dnd-kit/sortable` are in `package.json`. `grep -l "DndContext\|useDraggable" src/` returns only `KanbanBoard.tsx`. The grouped Jobs view (Leads / Quotes / Active / Invoicing) is the natural kanban — drag a card from one stage to the next, calling `transitionStage`. Pure desktop affordance. Fix: wire `@dnd-kit` on the existing grouped layout.

**FH-D-013 · LOW** — AppHeader composition reads as phone.
`src/components/AppHeader.tsx` puts the FH monogram left, the contractor's company name centered (clamped 12-18px), and three 34px icon buttons right. Desktop convention: logo top-left, **persistent search input** center (Cmd+K open inline, not just shortcut-triggered), profile/notifications/settings cluster right. Fix: render an inline search input in the header at ≥900px instead of just the magnifying-glass icon.

**FH-D-014 · LOW** — No empty-state illustrations.
Empty states (no jobs, no clients, no notes) are text-only ("No jobs match that filter."). Snow Dashboard uses illustrated empty states — small SVG + headline + CTA. Cheap to add via a single `<EmptyState>` component.

**FH-D-015 · LOW** — No light theme toggle.
Brand spec lists Linen `#F2EDE4` as a real background. Tokens exist for both light and dark in `tokens.css`. There's a `ThemeContext` and `next-themes` dep but no toggle in the UI. Desktop convention: theme toggle in user menu, persisted.

---

## Why Snow Dashboard is the right reference

Snow Dashboard maps onto what you already have:
- Dark by default — matches your Onyx default.
- Tailwind-based — drops into your existing config.
- shadcn-compatible primitives — your Radix install covers most of it.
- Tables, KPI tiles, sidebar nav, command palette, dropdowns, dialogs — the missing pieces above are each a Snow component.
- Density is generous-but-tight (not airy phone-app), exactly the corrective.

What you don't get from Snow alone: brand voice. The Field Gold + Bebas Neue display + DM Sans body identity stays yours. Snow is the skeleton, your tokens are the skin.

---

## Recommended sprints (one week each)

### Sprint 1 — Stop reading as a phone app (this week)
- **FH-D-001** Promote `/jobs/:id` and `/clients/:id` to `'responsive'` layout. Audit `DesktopJobDetail` works at full width; add a desktop-only context rail.
- **FH-D-002** Hide BottomNav at ≥900px. Add a `display: none` rule scoped to the responsive layout mode.
- **FH-D-004** Ship `<Tooltip>` wrapper + apply to every icon button in `AppHeader`, `DesktopSidebar`, `JobCard` action row.
- **FH-D-008** Hide the FAB at ≥900px.
- **FH-D-013** Inline persistent search input in `AppHeader` at ≥900px.

### Sprint 2 — Real tables
- **FH-D-003** Install `@tanstack/react-table`. Build `<DataTable>` primitive (sortable columns, density variants, sticky header, row hover, multi-select with shift-click, optional virtual scrolling). Add a view picker (Cards · Table) to Jobs and Clients. Default table on desktop, cards on mobile.
- **FH-D-007** Add `<JobRow>` companion to `<JobCard>` (compact 56px row variant) for the table view.

### Sprint 3 — Master-detail + density polish
- **FH-D-005** Build `<MasterDetail>` shell. Apply to Jobs (list left, detail right) and Clients.
- **FH-D-009** Ship `--ds-cursor` icon-button variant. Apply across desktop surfaces.
- **FH-D-010** Collapsible/pinnable sidebar.

### Sprint 4 — Desktop interactions
- **FH-D-006** Right-click context menus on rows + cards via `@radix-ui/react-context-menu`.
- **FH-D-011** Keyboard shortcut system + `<ShortcutsOverlay>`. Wire `g` chord, `j/k`, `c`, `/`, `?`, `esc`.
- **FH-D-012** Wire `@dnd-kit` on the grouped Jobs view → drag stage transitions.

### Sprint 5 — Snow component map + polish
- Map 8-10 specific Snow components to your real screens. Build them on shadcn primitives, brand-tokened.
- **FH-D-014** Illustrated empty states.
- **FH-D-015** Theme toggle in the user menu.

---

## What to do first (today)

Before any new design work, ship **Sprint 1** — it removes 80% of the "phone app stretched" feeling in code that's already 90% there. After that, Snow's actual components start landing in Sprint 2 with the table primitive.

Say **"start Sprint 1"** and I'll open the PR.

---

*Audit produced read-only from `claude/desktop-audit` (= `origin/main`@`ee8dfbc`). 15 findings: 2 blocker, 4 high, 6 medium, 3 low.*
