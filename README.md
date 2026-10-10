# Fieldhorse v2

Field operations app for contractors: leads, quotes, jobs, schedule, crew time, invoices and customer documents. Installable as a PWA. Multi company: every member of a company works one shared book, with what they see decided by their role.

## Stack

React 18, Vite 6 and TypeScript, TanStack Query (persisted for offline use), Supabase (Postgres with row level security, Auth, Storage, cron), Netlify Functions, the Claude API and Open-Meteo. A separate Expo app lives in `mobile/`.

## First run

```bash
nvm use            # Node 22, see .nvmrc
npm install
cp .env.example .env.local   # fill in the keys
npm run dev                  # app only
netlify dev                  # app plus the /api functions
```

## Checks

```bash
npm run lint
npm run audit:rls
npm run audit:design
npm run typecheck
npm test
npm run e2e        # Playwright; set PW_CHANNEL=chrome to use an installed Chrome
npm run build
```

CI runs all of them on every pull request.

## Structure

```
src/
  screens/      route level views
  components/   shared UI, desktop variants in components/desktop
  contexts/     Auth, Profile, Membership (active company and role), Theme
  lib/          data hooks (queries.ts, orgScope.ts), offline outbox, PDF, money and date helpers
  styles/       design tokens and global styles
netlify/functions/   server endpoints under /api (email, invites, customer links, AI, webhooks)
supabase/
  migrations/   SQL migrations; see supabase/README.md for how production differs
  functions/    edge functions captured from production
mobile/         Expo app
design/         icon source artwork
```

## Design system

The October 2026 redesign: plaster, paper and ink by day, one onyx stage per screen, brushed gold for the single main action, and a floating onyx dock on phones. Barlow for the interface, Barlow Condensed for titles and big numbers, Bebas Neue only for the FIELDHORSE wordmark, all self hosted. Day, Night and Auto (Night at local sunset) live in `src/contexts/ThemeContext.tsx`.

* Tokens: `src/styles/tokens.css` (the `--fh-` names; older names map onto them).
* Components: `src/components/fh/`, drawn in every state at `/design` while running `npm run dev`.
* Contrast: `src/styles/tokens.contrast.test.ts` holds every pair in the spec.
* Spec, phases and renders: `docs/design/2026-10-redesign/`.

## More

* `SHIP.md`: setup, environment variables and deploy runbook.
* `DEPLOY_CHECKLIST.md`: the short list to run before and after a deploy.
* `supabase/README.md`: database and edge function state.
* `AUDIT_2026-10-09.md`: the latest full audit and what changed.
* `docs/design/2026-10-redesign/SPEC.md`: the approved redesign, its phases and the concept renders beside it.
* `docs/NORTH_STAR.md`: the Universal Capture plan and its trust rules.
* `docs/archive/`: earlier audits and plans, kept for history.
