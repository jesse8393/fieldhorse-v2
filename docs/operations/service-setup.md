# Team and AI service setup

Team roster management and AI drafting run through Netlify Functions. Database health alone does not configure those functions.

## Required server configuration

| Service | Variables |
| --- | --- |
| Team | `SUPABASE_URL`, `SUPABASE_PUBLISHABLE_KEY`, `SUPABASE_SECRET_KEY` |
| AI | `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `ANTHROPIC_API_KEY` |

Existing `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` values remain supported. Public keys may also use `VITE_SUPABASE_PUBLISHABLE_KEY` or `VITE_SUPABASE_ANON_KEY`. URL may use `VITE_SUPABASE_URL`.

Set server secrets in the hosting environment for Functions and the intended deploy context. Never put secret keys or the AI key in a variable beginning with `VITE_`. Rebuild and deploy after configuration changes.

Run `node scripts/check-services.mjs` inside that configured environment. It prints only configuration presence and exits unsuccessfully when Team or AI setup is incomplete. It does not validate credential values or contact providers.

## Release verification

1. Sign in as an owner and open Team. Confirm a complete roster, names, invitations and allowed management actions.
2. Switch to another workspace. Confirm the roster follows that workspace and delayed previous responses never replace it.
3. Sign in as crew. Confirm pay rates stay hidden and management actions remain unavailable.
4. Open Compose. The authenticated `GET /api/claude` readiness check should return `configured: true`. This check does not call the provider.
5. Generate a harmless test draft and confirm real provider generation. A configured key may still be invalid, revoked or out of credit.
6. Check function logs for authentication or provider failures without copying secrets into reports.

## Graceful recovery

When the roster service fails, owners, admins and managers may use a verified read only database roster under existing row level policies. Names, email, rates and management actions are unavailable there. Field roles never see a partial self only roster presented as a complete team. Invitation lookup failure shows unknown rather than zero.

Manual message writing remains available when AI cannot run. Configuration checks never send draft contents to a provider.

## Current verification boundary

The connected database reports healthy. Read only inspection confirmed the scoped roster policy and canonical quote policy. Hosting environment values were not inspected or changed. Real AI generation, full roster recovery and deployment still require the configured hosting environment and release verification above.
