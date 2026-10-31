> Historical iteration. The current implementation and review evidence are in [Workspace 06](WORKSPACE_06_IMPLEMENTATION.md).

# Light glass implementation

Review branch: `redesign/light-glass-2026-10`  
Base: `c7fc323ac9d6081c3f07a0e7646c94684df101e0`  
Date: 2026-10-28

Review images use the compiled application and synthetic sample data: [desktop job workspace](light-glass/desktop.jpg) and [phone job workspace](light-glass/mobile.jpg).

## Design and scope

The approved direction uses warm ivory, translucent navigation, dark readable text, and a restrained burnt-orange action color. This implementation applies that direction to the actual application shell, desktop and phone job workspaces, Today, and the financial summary surfaces. It preserves the job feature inventory and uses the existing data and action handlers.

The desktop sidebar becomes a shared header. Today, Schedule, Jobs, Money, and conditional Inbox remain role-filtered. More and the workspace avatar reach the complete workspace navigation, company switcher, theme settings, and sign out. Capture, Search, New, and their keyboard shortcuts remain available. The avatar uses a profile logo only when that company is the current workspace.

Jobs show identity, lifecycle status, actual job photography when available, and the current or next visit. Missing or failed images produce a compact schedule summary rather than a decorative placeholder. The visit summary refreshes every minute and on return to the tab. Activity, Tasks, and Schedule have direct shortcuts; a native grouped selector preserves every other destination. Desktop job facts stay in a stable side column. Phone finances and lifecycle details remain available in a disclosure. Call, Message, Navigate, Photos, capture, editing, scheduling, billing, and deletion remain connected to their existing handlers. Desktop deletion moves into the job actions menu, retaining its existing second-action safeguard and adding visible consequence text.

No database schema, query permissions, payment calculation, public document template, or message delivery behavior changes in this branch. This branch is a visual implementation and regression update; it does not certify completion of every earlier audit finding.

## Job inventory

All destinations retain existing role and stage filtering:

| Group | Sections |
| --- | --- |
| Progress | Activity, Daily logs |
| Work plan | Milestones, Tasks, Schedule, Inspections, Selections, Materials |
| Money | Contract balance, Invoices, Expenses, Subcontractors, Change orders, Insurance |
| Documents and people | Photos, Files, Messages, Partner access |

## Visual system

`tokens.css` supplies the shared palette and native system typography. `light-glass.css` controls the new shell and workspace composition. Existing onyx components accept an explicit paper tone, leaving their photo overlays and unrelated callers intact. Legacy gold token names remain aliases to avoid a breaking component migration.

| Token | Day value |
| --- | --- |
| Canvas | `#F3F1ED` |
| Paper | `#FFFEFC` |
| Tray | `#F7F5F1` |
| Main text | `#202126` |
| Secondary text | `#505158` |
| Muted text | `#65666D` |
| Action | `#BA4824` |
| Accent text | `#A53D1E` |

The existing contrast thresholds remain 4.5:1 for text and 3:1 for essential UI boundaries/focus. Documented day ratios include main text on canvas 14.2:1, muted text on canvas 5.1:1, white on the darkest action gradient stop 6.8:1, and strong edges on paper 3.7:1. Both theme modes and retained onyx scopes remain covered by the contrast tests. Translucency has opaque fallbacks for unsupported blur, reduced transparency, and increased contrast preferences. The browser theme-color and its pre-paint CSP hash match the new day canvas.

## Verification

- TypeScript, ESLint, design-system audit, and production build pass.
- 149 unit test files pass: 1,443 tests, including contrast, lifecycle rules, role filtering, schedule behavior, and the new current/next-visit selection cases.
- The updated browser test suite parses successfully: 1,510 cases in 49 files.
- Browser review uses the actual compiled app and synthetic fixtures. All 18 job sections open; Activity, Materials, Contract balance, and the capture attachment were inspected. The job actions menu closes with Escape and restores focus to its trigger.
- Desktop Today, Schedule, Money, and job layouts were inspected. Job layouts were checked at 320, 390, and 1024 CSS pixels and the desktop browser width. Review findings fixed include missing desktop gutters, a leftover Today divider, a squeezed tablet facts grid, and a truncated 320-pixel primary action.

The full automated browser suite has not run locally because the Playwright Chromium binary is unavailable. Run the browser CI job before merging; parsing tests and manually reviewing screens are not equivalent to executing that suite. Existing opt-in visual baselines depict the previous direction and need a reviewed refresh. Production data, real customer sends, payment writes, offline upload recovery, physical iOS/Android behavior, and screen-reader operation have not been newly exercised by this visual pass.

## Release boundary

This is a local review branch. Do not treat screenshots or successful local checks as a production deployment. No GitHub push, PR, merge, or live release is included in the local implementation. The synthetic review bootstrap is ignored and is not part of the application bundle or this commit.
