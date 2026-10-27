# Database release verification

The invoice and crew allocation migrations were generated with the installed Supabase CLI. They remain unapplied to production. No production schema, record or permission was changed during this repair pass.

## Migration gate

The focused local execution described below passed. Before release, replay the complete migration history in an isolated Supabase environment and complete the simultaneous transaction and staging cases in the matrix. Use `20261027170408_invoice_billing_safeguards.sql` and `20261027170430_schedule_crew_allocation.sql` in `supabase/migrations`. Apply them through the established migration workflow.

The application changes and database guards must ship together. Frontend checks cannot enforce concurrent booking or billing limits by themselves. After local verification, apply through the approved migration process and repeat tenant and role probes in staging. Deployment and production verification remain outstanding.

## Executed local verification

On October 27, 2026, `scripts/validate-audit-sql.mjs` passed **59 checks** using PostgreSQL 18.6 through PGlite 0.5.12. This includes the original 47 checks and 12 additional canonical lead/quote inheritance checks. The package was installed only in a separate scratch runtime. No credentials or production connection were used.

Both canonical migrations executed successfully, preserved seeded legacy records and executed again without duplicating or rewriting data. Checks exercised real PostgreSQL roles, row level security, restricted functions, triggers, the GiST exclusion constraint and transaction rollback. Coverage included owner, admin, manager, crew, foreman, revoked member, outsider, anonymous and service contexts; exact invoice budget limits; invalid amounts; approved scope; existing overbilling; overlaps and adjacent visits; reservation deletion; and failed batch rollback.

Execution found three integration defects, now repaired in the migrations. Both guards run after the repository's company attribution triggers. Schedule guards also run when `contact_id` changes, preventing a parent job change from moving allocated crew into another company without checks. Finally, schedule company inheritance, allocation validation and reservation synchronization now watch `lead_id` and `quote_id` as well. Migration 092 taught the inheritance function to resolve these parents, but the original trigger did not fire for updates that named only those columns.

The final defect was reproduced with an authenticated company owner: a minimal `lead_id` update attached an allocated visit to an inaccessible company's lead without rejection. The normal event form already named `contact_id` in its update and did not bypass the guards. Regression checks now cover minimal lead/quote changes, same-company success, foreign-company rejection even for an owner of both companies, the event form's update shape, and clearing crew before a legitimate company move. All passed without changing existing policies.

This was a focused schema with synthetic records, not a replay of the entire historical migration chain. The harness loaded the actual repository company attribution functions from migrations 065 and 092, with the original schedule trigger shape from 062 before applying the new migration. Supabase authentication functions were reproduced through JWT configuration values, and representative company policies exercised the guards under restricted database roles. This does not establish deployed Supabase policy or Data API behavior.

PGlite exposes one exclusive database connection. Therefore, these tests **do not validate two simultaneous PostgreSQL sessions**, lock contention or live concurrent requests. The exclusion constraint independently rejected a conflicting reservation, and transactions rolled back correctly, but true concurrent booking and billing probes remain release gates. Live email delivery, Netlify configuration and browser to database integration were not exercised by this harness.

Run the harness with a separate PGlite installation:

```sh
PGLITE_RUNTIME=/absolute/path/to/@electric-sql/pglite node scripts/validate-audit-sql.mjs
```

## Invoice safeguards

| Case | Required result |
| --- | --- |
| Owner, admin or manager bills their own company | Positive finite amounts accepted within approved scope |
| Crew, foreman, revoked member or outsider writes money | Rejected by existing role policies and scoped guards |
| Forged job ID or invoice company mismatch | Rejected without exposing another company’s contract values |
| Negative, zero, NaN or infinite new amount | Rejected |
| Historical negative invoice | Cannot create available contract budget |
| Nonfinite stored contract or approved change order | Fails closed for review |
| Drafts plus issued invoices exceed contract | New or increased obligations rejected |
| Existing overbilled draft moves to issued | Rejected until corrected |
| Existing overbilling is reduced, paid or voided | Allowed without deleting history |
| Two concurrent drafts consume the same remaining balance | At most one succeeds; total stays within approved scope |
| Approved change orders or invoices exceed one API page | All contributing rows included |
| Delivery request omits invoice ID | Rejected |
| Invoice changes while its PDF prepares | Delivery detects stale document state or remains explicitly blocked for review |

Independent review found and reported the untracked invoice bypass, negative budget credits, draft issuance bypass and unpaged change order lookup. Code inspection confirms repairs for those four cases. Subsequent local SQL execution passed nonfinite stored scope checks, and unit tests passed stale invoice revision rejection. Real provider delivery and changes to payments during document preparation remain outside this SQL harness.

## Crew allocation

| Case | Required result |
| --- | --- |
| Owner, admin or manager assigns active company members | Accepted |
| Crew, foreman, revoked member or outsider assigns, moves or deletes an allocated event | Rejected |
| Forged foreign or revoked assignee | Rejected |
| Forged company reassignment | Rejected |
| Minimal job, lead or quote parent update crosses company | Rejected while crew remains assigned, including for a dual-company owner |
| Same-company canonical parent update | Accepted with reservations retained |
| Crew cleared before a legitimate parent company change | Accepted; subsequent reservations use the new company |
| Adjacent events | Accepted |
| Overlapping events, including midnight and recurring visits | Rejected |
| Two concurrent bookings for the same person | Exactly one succeeds |
| Event update excludes its own reservation | Accepted without a false conflict |
| Deleted event | Reservations removed |
| Legacy assigned events | Included in availability checks without rewriting history |
| Empty assignment | Existing unassigned workflows still work |
| Direct access to private reservation table or functions | No access for anon or authenticated roles |
| Missing allocation schema | Setup unavailable; no false promise of verified availability |

Availability is scoped to the selected company. The same user can have overlapping assignments in two different companies because the reservation constraint includes company scope. Cross company availability would require a separate privacy and product decision.

Inspection found no clear privilege escalation in the proposed allocation guards. Their private schema, explicit active membership checks and interval exclusion design passed the focused PostgreSQL role tests above. Simultaneous independent transactions and complete staging integration remain unverified. Unit tests of the overlap helper alone do not prove database enforcement.

## Service boundary

Team fallback uses existing row level policies and explicitly verifies complete roster permission before reading. It does not change database access. The connected database reports healthy; that does not verify Netlify credentials or the AI provider. Follow `docs/operations/service-setup.md` for those release checks.
