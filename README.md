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

## Brand tokens

Field Gold `#C9963A`, Onyx `#141414`, Raw Linen `#F2EDE4`, Alert Red `#C0392B`, Signal Green `#2D7A4F` (indicators only). Bebas Neue for display, DM Sans for body.

## More

* `SHIP.md`: setup, environment variables and deploy runbook.
* `DEPLOY_CHECKLIST.md`: the short list to run before and after a deploy.
* `supabase/README.md`: database and edge function state.
* `AUDIT_2026-10-09.md`: the latest full audit and what changed.
* `docs/archive/`: earlier audits and plans, kept for history.
