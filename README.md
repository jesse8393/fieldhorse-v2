# Fieldhorse v2

Contractor field ops PWA. Multi-tenant SaaS rebuild.

## Stack
React 18 + Vite + Supabase + Netlify + Claude API + Open-Meteo.

## First run
```bash
npm install
cp .env.example .env.local   # fill in keys
npm run dev
```

## Structure
```
src/
  screens/      # route-level views
  components/   # shared UI
  lib/          # supabase, anthropic, weather clients
  contexts/     # AuthContext
  styles/       # tokens.css, global.css
  assets/
public/         # favicon, icons, manifest assets
```

## Brand tokens
Field Gold `#C9963A` · Onyx `#141414` · Raw Linen `#F2EDE4` · Alert Red `#C0392B` · Signal Green `#2D7A4F` (indicators only).

Bebas Neue (display) + DM Sans (body). Logo is CSS — `<Wordmark />`.

## Supabase
Project ID: `pnmhblvslftdzfcdezbw`. Fill anon key in `.env.local`.
