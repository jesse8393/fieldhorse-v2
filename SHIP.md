# Fieldhorse ship runbook

How to set up, check and release Fieldhorse. Last checked against the code on 2026-10-09.

## 1. What you need

* Node 22. The repo pins it in `.nvmrc`, `package.json` and `netlify.toml`.
* Access to the Netlify site and the Supabase project `pnmhblvslftdzfcdezbw`.
* The Netlify CLI only if you want to run the `/api` functions locally (`npm i -g netlify-cli`).

## 2. Run it locally

```bash
nvm use
npm ci
cp .env.example .env.local    # then fill in the keys, see section 3
npm run dev                   # app only, on http://localhost:5173
netlify dev                   # app plus the /api functions, on http://localhost:8888
```

Without `netlify dev`, anything that calls `/api` (email, customer links, AI, invites) fails locally. Only the deployed site and `netlify dev` run the functions.

## 3. Environment variables

`.env.example` lists every variable with a placeholder. Set the same values in Netlify under Site configuration, Environment variables. Variables that start with `VITE_` are built into the browser bundle, so never give a secret a `VITE_` name.

### Browser

| Variable | Needed | What it is |
| --- | --- | --- |
| `VITE_SUPABASE_URL` | Required | Project URL from Supabase, Settings, API. |
| `VITE_SUPABASE_ANON_KEY` | Required | The anon key from the same page. Row level security protects the data, not this key. |
| `VITE_ANTHROPIC_MODEL` | Optional | Model the browser asks for. Defaults to `claude-fable-5`. |

### Server (Netlify Functions only)

| Variable | Needed | What it is |
| --- | --- | --- |
| `SUPABASE_URL` | Required | Same value as `VITE_SUPABASE_URL`. Most functions fall back to the `VITE_` name, but the lead webhook does not, so set both. |
| `SUPABASE_SERVICE_ROLE_KEY` | Required | Service role key. Server only, it bypasses row level security. |
| `SUPABASE_ANON_KEY` | Recommended | Anon key for functions that act as the signed in user. Falls back to `VITE_SUPABASE_ANON_KEY`. |
| `ANTHROPIC_API_KEY` | Required for AI | Used by the AI notes, bid and compose features. |
| `ANTHROPIC_MODEL` | Optional | Server model. Defaults to `claude-fable-5`. |
| `RESEND_API_KEY` | Required for email | Sends quotes, invoices, invites and messages through Resend. |
| `SEND_EMAIL_FROM` | Required for email | Sender address on a domain verified in Resend. |
| `SEND_EMAIL_FROM_NAME` | Optional | Display name. Defaults to FieldHorse or Notifications depending on the email. |
| `PUBLIC_LINK_AUDIT_SALT` | Recommended | Salt for hashing visitor IP addresses on customer links. Falls back to the service role key. |
| `WEBHOOK_LEAD_RATE_LIMIT_PER_MINUTE` | Optional | Lead webhook limit per key. Defaults to 60, capped at 1000. |
| `SITE_URL` | Optional | Base URL for team invite links. Falls back to Netlify's `URL`. |
| `DOCUSIGN_INTEGRATION_KEY`, `DOCUSIGN_USER_ID`, `DOCUSIGN_ACCOUNT_ID`, `DOCUSIGN_PRIVATE_KEY` | Required for DocuSign | JWT app credentials for sending envelopes. |
| `DOCUSIGN_AUTH_BASE`, `DOCUSIGN_API_BASE` | Optional | Default to the DocuSign demo hosts. Set the production hosts when going live. |
| `DOCUSIGN_CONNECT_HMAC_KEY` | Required for DocuSign | Verifies DocuSign Connect events. Without it the webhook rejects every event. |
| `DOCUSIGN_REQUIRE_HMAC` | Optional | With `1`, a missing HMAC key returns a server error and overrides `DOCUSIGN_ALLOW_UNSIGNED`. |
| `DOCUSIGN_ALLOW_UNSIGNED` | Avoid | Set to `1` only for a temporary test. It accepts unsigned events, which anyone could forge. |

Netlify sets `URL`, `CONTEXT` and `COMMIT_REF` on its own.

## 4. Database

Production is the source of truth, and it does not match `supabase/migrations/` file for file. `supabase/README.md` lists what differs, what was applied on 2026-10-09 and the commands that bring the repo back in sync.

To change the schema:

1. Write a new numbered file in `supabase/migrations/`.
2. Apply it in the Supabase SQL editor (or with the Supabase CLI after `supabase link`).
3. Regenerate the types and commit them with the migration:

```bash
supabase gen types typescript --project-id pnmhblvslftdzfcdezbw > src/lib/database.types.ts
```

Migration 066 (nightly purge of expired rate limit rows and old link events) is written but not applied yet.

## 5. Check before you ship

```bash
npm run lint
npm run audit:rls
npm run audit:design
npm run typecheck
npm test
npm run build
npm run e2e        # Playwright with mocked data
```

CI runs the same checks on every pull request. Do not merge on red.

## 6. Deploy

Netlify builds and deploys from GitHub: merging to `main` publishes production, using `npm run build` and the functions in `netlify/functions`. A manual deploy from your machine also works:

```bash
netlify deploy --build --prod
```

On 2026-10-09 the Netlify site did not answer at all, which points to a problem at the team or account level (billing, a paused team or a removed site). Restore it in the Netlify dashboard before relying on either path.

## 7. After a deploy

`DEPLOY_CHECKLIST.md` has the short smoke test. The lead webhook can be checked with:

```bash
curl -X POST "https://fieldhorse.io/api/webhook-lead?key=<webhook key from the Import screen>" \
  -H "Content-Type: application/json" \
  -d '{"name":"Test Lead","phone":"555-0199","job_title":"Test job","amount":5000}'
```

Then delete the test lead from Work.

## 8. Roll back

In Netlify, open Deploys, pick the last good deploy and choose Publish deploy. That swaps the site and functions back right away. Database changes do not roll back with it, so write migrations that old code can live with.
