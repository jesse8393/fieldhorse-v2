# Deploy checklist

The short list for every release. `SHIP.md` has the full setup, the environment variables and the reasons behind each step.

## Before you merge

* CI is green on the pull request: lint, the two audits, typecheck, unit tests, build and the Playwright job.
* Any new migration is applied in Supabase and the regenerated `src/lib/database.types.ts` is in the same pull request.
* New environment variables are set in Netlify before the merge, not after. `VITE_` variables only take effect on the next build.
* Nothing in the diff adds a `public/_redirects`. All redirects live in `netlify.toml`; a `_redirects` file would be read first and its catch all would hide the asset rule.

## What a good build contains

`dist/` should hold `index.html`, `404.html`, `_headers`, `manifest.webmanifest`, `sw.js`, `registerSW.js`, `push-sw.js`, the PNG icons and the hashed files under `assets/`. The build writes `_headers` itself, so do not add one by hand.

## Smoke test after it goes live

Use a real account on https://fieldhorse.io, on a phone and on a desktop browser.

1. Sign in. Home loads with the pipeline total and Next actions, and no error banner.
2. Open Work, then a job. The tabs load and the job's money shows for an owner or admin.
3. Open Schedule. Today's events show, and adding an event works.
4. Open Invoices. Open an invoice and download its PDF.
5. Send yourself a customer link from a quote. It opens signed out and shows the right company name and logo.
6. Switch between light and dark (the More menu on a phone, Settings on a desktop). Text stays readable on every screen you visited.
7. If you belong to more than one company, switch companies from the sidebar or the More menu and confirm the lists change.
8. In Netlify, open Functions and check the last few minutes of logs for errors.

## If something is wrong

Roll back first, then debug. In Netlify, open Deploys, pick the last good deploy and choose Publish deploy. Database changes stay in place, so check whether the bad release ran a migration before you roll back the code.
