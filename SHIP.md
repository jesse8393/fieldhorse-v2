# Fieldhorse v2 — Ship Runbook

Cut this top to bottom. Each block is copy-paste ready. No skipping.

---

## 0. Pre-flight (2 min)

On your Windows box, open a terminal in the Desktop copy:

```
cd C:\Users\Jesse\OneDrive\Documents\Claude\Projects\Command App Project\fieldhorse-v2
```

Confirm you have:
- Node 20.x (`node -v`)
- Netlify CLI (`npm i -g netlify-cli` if missing)
- Supabase dashboard tab open to project `pnmhblvslftdzfcdezbw`

---

## 1. Install deps (3 min)

```
npm install
```

Pulls `jspdf`, `jspdf-autotable`, `papaparse`, `framer-motion`, everything else.

---

## 2. Run the schema migration (5 min)

Supabase dashboard → SQL Editor → New query → paste contents of:

```
supabase/migrations/002_full_schema.sql
```

Run. Expect: fh_contacts, fh_notes, fh_schedule, fh_mileage, fh_milestones, fh_subs, fh_expenses, fh_inspections, fh_messages tables created + RLS policies scoped to `auth.uid()`.

If re-running on an existing project, migration is idempotent (uses `create table if not exists` + drop+create policies).

---

## 3. Environment variables (3 min)

### Local dev (`.env.local`)

```
VITE_SUPABASE_URL=https://pnmhblvslftdzfcdezbw.supabase.co
VITE_SUPABASE_ANON_KEY=<your anon key from Supabase → Settings → API>
VITE_ANTHROPIC_MODEL=claude-sonnet-5
```

### Netlify dashboard → Site settings → Environment variables

Add **all four**:

| Key | Value source |
| --- | --- |
| `VITE_SUPABASE_URL` | same as local |
| `VITE_SUPABASE_ANON_KEY` | same as local |
| `ANTHROPIC_API_KEY` | console.anthropic.com → API keys (server-only) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase → Settings → API → `service_role` (server-only) |
| `SUPABASE_URL` | same as VITE_SUPABASE_URL |

**Do NOT** prefix `ANTHROPIC_API_KEY` or `SUPABASE_SERVICE_ROLE_KEY` with `VITE_` — those leak to the browser. These are used only by `netlify/functions/*`.

---

## 4. Local smoke test (5 min)

```
npm run dev
```

Hit http://localhost:5173. Sign in, complete onboarding, then walk through:

- **Home** — pipeline number renders, quick actions navigate
- **Jobs** — list loads, stage spine colors correct
- **Notes** — type a blurb, click "AI parse" (needs Netlify dev for this to work — see §6)
- **Schedule** — Day/Week/Month tabs swap, weather bar shows if location pinned
- **Bid** — type a scope, click "Generate bid" (needs Netlify dev)
- **Compose** — pick a contact, generate draft (needs Netlify dev)
- **Analytics** — KPIs render, pipeline bars animate in
- **Import** — drop a CSV, see preview
- **Settings** — theme toggle flips dark/light, sign out works

---

## 5. Build check (1 min)

```
npm run build
```

Expect green. Bundle lands in `dist/`. No warnings about missing env vars.

---

## 6. Netlify dev for AI routes (optional but smart)

To test `/api/claude` and `/api/webhook-lead` locally:

```
netlify dev
```

Serves the Vite app on :8888 with functions proxied. Without this, AI calls in local dev will 404 (only prod Netlify runs the functions).

---

## 7. Deploy (2 min)

### First time:

```
netlify init
```

Link to existing site or create new. Point to `fieldhorse.io` domain.

### Every time after:

```
netlify deploy --build --prod
```

Watch output. Takes ~90s. Finished URL printed at end.

---

## 8. Post-ship verification (5 min)

On fieldhorse.io:

1. Sign in → onboarding → home ✓
2. Create a job → open detail → 7 tabs render ✓
3. Notes → voice capture (Safari/Chrome mobile) → AI parse returns JSON ✓
4. Bid → generate → Field-Gold reveal animates ✓
5. Import → generate webhook key → POST test payload:

```
curl -X POST "https://fieldhorse.io/api/webhook-lead?key=<your-key>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Lead","phone":"555-0199","job_title":"Test job","amount":5000}'
```

Expect `{"ok":true,"id":"...","stage":"lead"}` — then see the lead in Jobs.

---

## 9. Rollback (if anything breaks)

Netlify dashboard → Deploys → find last green → **Publish deploy**. Zero-downtime swap.

---

## 10. After ship

- [ ] Test PDF invoice: open any job → Invoice tab → Generate PDF → verify Field-Gold header, Onyx total band, auto-filled totals
- [ ] Test PDF proposal: Bid screen → after generate, export → verify scope block, side-by-side assumptions/risks, signature lines
- [ ] Point the Parker Construction + Shyld domains at fieldhorse.io for multi-tenant test
- [ ] Tell the beta list it's live

---

Built for the jobsite.
