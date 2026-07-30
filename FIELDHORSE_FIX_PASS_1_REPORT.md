# FieldHorse Fix Pass 1 Handoff

Production repository: `C:\Users\Jesse\OneDrive\Desktop\fieldhorse-v2`

Production Supabase project: `pnmhblvslftdzfcdezbw`

Branch: `codex/jobber-workflow`

## Result

Phases A through D are implemented, committed, and live on `https://fieldhorse.io`. Pull request 207 was merged to `main` as `b16ae1f31ff851ffdefc3562b85de7a4b254e488`.

The RLS migration was applied to production project `pnmhblvslftdzfcdezbw` as migration `20260730184123 audit_rls_policies`.

## Replacement Counts

Total: 7,168 replacements across 208 files.

Colors: 1,486

Radii: 1,114

Type: 1,351

Spacing: 2,573

Tracking: 644

The complete per-file ledger is in [DESIGN_SYSTEM_REPLACEMENTS.md](DESIGN_SYSTEM_REPLACEMENTS.md).

## Unresolved Tokens

No off-palette colors or non-token control/card radii remain in audited product source, native manifests, public source assets, or server generated emails.

`#0000` remains only as the example card reference placeholder in `V3PaymentSheet.tsx`. It is user-entered text, not a color declaration.

The 999px pill radius remains restricted to Badge and StatusPill components. The design audit enforces this exception.

## Verification

- `npm run audit:design`: passed across `src`, `mobile`, `netlify`, `public`, and `index.html`.
- `npm run audit:rls`: passed. `fh_app_config` has one server caller; `fh_integration_secrets` has no application caller.
- `npm run lint`: passed.
- `npm run typecheck`: passed.
- `npm test`: 21 files and 130 tests passed.
- `npm run build`: passed with 4,480 modules transformed.
- `npm run e2e`: 10 passed across desktop and mobile. Two production credential tests were skipped because no E2E account was supplied.
- `npm run qa:workflow`: 4 desktop/mobile lead to cash workflow tests passed.
- Modified Netlify functions passed `node --check`.
- `mobile/app.json` passed JSON parsing.
- Production `https://fieldhorse.io`: HTTP 200 from the merged Netlify deployment.
- Production bundle: one Collected this week label, one Owner Queue, one Revenue Opportunities card, one Job Health Preview, no Reports column, canonical gold present, and legacy gold absent.
- Production Supabase: migration `20260730184123 audit_rls_policies` applied and resulting RLS policies and grants verified.

## Files By Phase

### Preflight: Session startup and AI workflow smoke coverage

Commit: `5321236`

Files changed: 4

- `M` `mobile/contexts/AuthContext.tsx`
- `M` `src/contexts/AuthContext.tsx`
- `M` `src/lib/anthropic.ts`
- `M` `tests/e2e/public-smoke.spec.ts`

### Phase A: Canonical tokens

Commit: `4255b6e`

Files changed: 23

- `M` `mobile/app/(tabs)/_layout.tsx`
- `M` `mobile/app/(tabs)/clients.tsx`
- `M` `mobile/app/(tabs)/jobs.tsx`
- `M` `mobile/app/(tabs)/schedule.tsx`
- `M` `mobile/app/_layout.tsx`
- `M` `mobile/app/clients/[id].tsx`
- `M` `mobile/app/invoices/index.tsx`
- `M` `mobile/app/jobs/[id].tsx`
- `M` `mobile/app/login.tsx`
- `M` `mobile/app/onboarding.tsx`
- `M` `mobile/app/partners.tsx`
- `M` `mobile/app/quote/[id].tsx`
- `M` `mobile/app/subs/[key].tsx`
- `M` `mobile/components/ui.tsx`
- `M` `mobile/tailwind.config.js`
- `M` `src/components/documents/tokens.ts`
- `M` `src/screens/ContactDetail/sections/Photos.tsx`
- `M` `src/screens/LegalLayout.tsx`
- `M` `src/screens/Privacy.tsx`
- `M` `src/screens/Terms.tsx`
- `M` `src/styles/global.css`
- `M` `src/styles/tokens.css`
- `A` `src/ui/tokens.ts`

### Phase B: Shared components and codebase design sweep

Commit: `4bc837d`

Files changed: 312

- `A` `DESIGN_SYSTEM_REPLACEMENTS.md`
- `M` `mobile/app/(tabs)/_layout.tsx`
- `M` `mobile/app/(tabs)/clients.tsx`
- `M` `mobile/app/(tabs)/index.tsx`
- `M` `mobile/app/(tabs)/jobs.tsx`
- `M` `mobile/app/(tabs)/more.tsx`
- `M` `mobile/app/(tabs)/schedule.tsx`
- `M` `mobile/app/_layout.tsx`
- `M` `mobile/app/activity.tsx`
- `M` `mobile/app/analytics.tsx`
- `M` `mobile/app/assistant.tsx`
- `M` `mobile/app/bid.tsx`
- `M` `mobile/app/clients/[id].tsx`
- `M` `mobile/app/compose.tsx`
- `M` `mobile/app/estimates.tsx`
- `M` `mobile/app/integrations.tsx`
- `M` `mobile/app/invoices/[id].tsx`
- `M` `mobile/app/invoices/index.tsx`
- `M` `mobile/app/jobs/[id].tsx`
- `M` `mobile/app/login.tsx`
- `M` `mobile/app/notes.tsx`
- `M` `mobile/app/notifications.tsx`
- `M` `mobile/app/onboarding.tsx`
- `M` `mobile/app/partners.tsx`
- `M` `mobile/app/pour-window.tsx`
- `M` `mobile/app/quote/[id].tsx`
- `M` `mobile/app/reset-password.tsx`
- `M` `mobile/app/settings.tsx`
- `M` `mobile/app/subs/[key].tsx`
- `M` `mobile/app/subs/index.tsx`
- `M` `mobile/components/AddEventSheet.tsx`
- `M` `mobile/components/DailyBriefCard.tsx`
- `M` `mobile/components/InvitePartnerSheet.tsx`
- `M` `mobile/components/MarkCompleteSheet.tsx`
- `M` `mobile/components/NewClientSheet.tsx`
- `M` `mobile/components/NewLeadSheet.tsx`
- `M` `mobile/components/PaymentSheet.tsx`
- `M` `mobile/components/SearchOverlay.tsx`
- `M` `mobile/components/ui.tsx`
- `M` `mobile/lib/anthropic.ts`
- `M` `mobile/lib/database.types.ts`
- `M` `mobile/lib/docIntelligence.ts`
- `M` `mobile/lib/integrations.ts`
- `M` `mobile/lib/invoiceHtml.ts`
- `M` `mobile/lib/jobTypes.ts`
- `M` `mobile/lib/proposalHtml.ts`
- `M` `mobile/lib/publicLink.ts`
- `M` `mobile/lib/queries.ts`
- `M` `mobile/lib/queryClient.ts`
- `M` `mobile/lib/sendDocs.ts`
- `M` `mobile/lib/weather.ts`
- `M` `package.json`
- `A` `scripts/audit-design-system.mjs`
- `A` `scripts/report-design-replacements.mjs`
- `M` `src/App.tsx`
- `M` `src/components/ActionSheet.tsx`
- `M` `src/components/AddEventSheet.tsx`
- `M` `src/components/AppErrorBoundary.tsx`
- `M` `src/components/AppHeader.tsx`
- `M` `src/components/AppShell.tsx`
- `M` `src/components/BottomNav.tsx`
- `M` `src/components/BrandLogoPicker.tsx`
- `M` `src/components/CaptureFab.tsx`
- `M` `src/components/CaptureSheet.tsx`
- `M` `src/components/ClientPicker.tsx`
- `M` `src/components/CommandPalette.tsx`
- `M` `src/components/ConfirmSheet.tsx`
- `M` `src/components/DesktopSidebar.tsx`
- `M` `src/components/DocIntakeButton.tsx`
- `M` `src/components/EmptyState.tsx`
- `M` `src/components/FieldhorseBadge.tsx`
- `M` `src/components/FieldhorseEmblem.tsx`
- `M` `src/components/HomeActivityCard.tsx`
- `M` `src/components/InstallPrompt.tsx`
- `M` `src/components/InvitePartnerSheet.tsx`
- `M` `src/components/KanbanBoard.tsx`
- `M` `src/components/LogMilesSheet.tsx`
- `M` `src/components/MarkCompleteSheet.tsx`
- `M` `src/components/MergeDuplicatesSheet.tsx`
- `M` `src/components/MiniMetric.tsx`
- `M` `src/components/MobileSearchOverlay.tsx`
- `M` `src/components/Monogram.tsx`
- `M` `src/components/NewClientSheet.tsx`
- `M` `src/components/NewLeadSheet.tsx`
- `M` `src/components/NewQuoteSheet.tsx`
- `M` `src/components/NotificationsBell.tsx`
- `M` `src/components/RouteErrorBoundary.tsx`
- `M` `src/components/SendInvoiceSheet.tsx`
- `M` `src/components/SignaturePad.tsx`
- `M` `src/components/StatementSheet.tsx`
- `M` `src/components/SwipeableRow.tsx`
- `M` `src/components/TimeClockCard.tsx`
- `M` `src/components/V3PaymentSheet.tsx`
- `M` `src/components/desktop/BuildTopbar.tsx`
- `M` `src/components/desktop/DetailListRail.tsx`
- `M` `src/components/desktop/SnowAnalyticsBuild.tsx`
- `M` `src/components/desktop/SnowClientDetailBuild.tsx`
- `M` `src/components/desktop/SnowClientsBuild.tsx`
- `M` `src/components/desktop/SnowForecastBuild.tsx`
- `M` `src/components/desktop/SnowHomeBuild.tsx`
- `M` `src/components/desktop/SnowInvoicesBuild.tsx`
- `M` `src/components/desktop/SnowJobDetailBuild.tsx`
- `M` `src/components/desktop/SnowNotesBuild.tsx`
- `M` `src/components/desktop/SnowScheduleBuild.tsx`
- `M` `src/components/desktop/SnowSettingsBuild.tsx`
- `M` `src/components/desktop/SnowSubsBuild.tsx`
- `M` `src/components/desktop/TopbarWeather.tsx`
- `M` `src/components/documents/ApprovalBlock.tsx`
- `M` `src/components/documents/BillToBlock.tsx`
- `M` `src/components/documents/ChangeOrdersBlock.tsx`
- `M` `src/components/documents/DocumentShell.tsx`
- `M` `src/components/documents/InsuranceModeBlock.tsx`
- `M` `src/components/documents/InvoiceBalanceBlock.tsx`
- `M` `src/components/documents/InvoiceTemplate.tsx`
- `M` `src/components/documents/LineItemsTable.tsx`
- `M` `src/components/documents/PaymentHistoryBlock.tsx`
- `M` `src/components/documents/PaymentTermsBlock.tsx`
- `M` `src/components/documents/PricingSummaryCard.tsx`
- `M` `src/components/documents/ProposalTemplate.tsx`
- `M` `src/components/documents/ScopeSectionCard.tsx`
- `M` `src/components/documents/format.ts`
- `M` `src/components/documents/numbers.ts`
- `M` `src/components/documents/proposalThemes.tsx`
- `M` `src/components/documents/tokens.ts`
- `M` `src/components/fx/CountUp.tsx`
- `M` `src/components/fx/GreetingTitle.tsx`
- `M` `src/components/icons/Icon.tsx`
- `M` `src/components/public/ApproveProposalBar.tsx`
- `M` `src/components/settings/RateCardEditor.tsx`
- `M` `src/components/ui/avatar.tsx`
- `M` `src/components/ui/badge.tsx`
- `M` `src/components/ui/button.tsx`
- `M` `src/components/ui/calendar.tsx`
- `M` `src/components/ui/card.tsx`
- `M` `src/components/ui/command.tsx`
- `M` `src/components/ui/dialog.tsx`
- `M` `src/components/ui/drawer.tsx`
- `M` `src/components/ui/dropdown-menu.tsx`
- `M` `src/components/ui/input.tsx`
- `M` `src/components/ui/popover.tsx`
- `M` `src/components/ui/progress.tsx`
- `M` `src/components/ui/scroll-area.tsx`
- `M` `src/components/ui/select.tsx`
- `M` `src/components/ui/sheet.tsx`
- `M` `src/components/ui/skeleton.tsx`
- `M` `src/components/ui/switch.tsx`
- `M` `src/components/ui/tabs.tsx`
- `M` `src/components/ui/textarea.tsx`
- `M` `src/components/ui/toggle-group.tsx`
- `M` `src/components/ui/toggle.tsx`
- `M` `src/components/ui/tooltip.tsx`
- `M` `src/components/v3/Button.tsx`
- `M` `src/components/v3/Card.tsx`
- `M` `src/components/v3/Eyebrow.tsx`
- `M` `src/components/v3/FeedRow.tsx`
- `M` `src/components/v3/FilterPill.tsx`
- `M` `src/components/v3/FloatingActionButton.tsx`
- `M` `src/components/v3/HealthDonut.tsx`
- `M` `src/components/v3/IconButton.tsx`
- `M` `src/components/v3/JobCard.tsx`
- `M` `src/components/v3/KpiTile.tsx`
- `M` `src/components/v3/NextActionCard.tsx`
- `M` `src/components/v3/PostedByChip.tsx`
- `M` `src/components/v3/ProgressMeter.tsx`
- `M` `src/components/v3/QuickAction.tsx`
- `M` `src/components/v3/ScreenCloser.tsx`
- `M` `src/components/v3/SegmentedTabs.tsx`
- `M` `src/components/v3/StageTimeline.tsx`
- `M` `src/components/v3/StampNumber.tsx`
- `M` `src/components/v3/StatusPill.tsx`
- `M` `src/components/v3/index.ts`
- `M` `src/contexts/AuthContext.tsx`
- `M` `src/contexts/MembershipContext.tsx`
- `M` `src/contexts/ProfileContext.tsx`
- `M` `src/contexts/ThemeContext.tsx`
- `M` `src/lib/accountAttribution.ts`
- `M` `src/lib/anthropic.ts`
- `M` `src/lib/captureActions.ts`
- `M` `src/lib/captureIntelligence.ts`
- `M` `src/lib/captureOutbox.ts`
- `M` `src/lib/clientMerge.ts`
- `M` `src/lib/clientTimeline.ts`
- `M` `src/lib/clients.ts`
- `M` `src/lib/closeout.ts`
- `M` `src/lib/csv.ts`
- `M` `src/lib/dates.ts`
- `M` `src/lib/demoSeed.ts`
- `M` `src/lib/docIntelligence.ts`
- `M` `src/lib/dueDate.test.ts`
- `M` `src/lib/dueDate.ts`
- `M` `src/lib/format.ts`
- `M` `src/lib/haptics.ts`
- `M` `src/lib/homeDashboard.test.ts`
- `M` `src/lib/homeDashboard.ts`
- `M` `src/lib/hover.ts`
- `M` `src/lib/invoices.test.ts`
- `M` `src/lib/invoices.ts`
- `M` `src/lib/jobTemplates.ts`
- `M` `src/lib/labor.ts`
- `M` `src/lib/motion.ts`
- `M` `src/lib/notifications.ts`
- `M` `src/lib/orgApi.ts`
- `M` `src/lib/outbox.ts`
- `M` `src/lib/partners.ts`
- `M` `src/lib/payLink.ts`
- `M` `src/lib/pdf.js`
- `M` `src/lib/pdf.smoke.test.ts`
- `M` `src/lib/pdfLogo.ts`
- `M` `src/lib/permissions.ts`
- `M` `src/lib/photos.ts`
- `M` `src/lib/pipeline.ts`
- `M` `src/lib/publicLink.ts`
- `M` `src/lib/push.ts`
- `M` `src/lib/queries.ts`
- `M` `src/lib/queryClient.ts`
- `M` `src/lib/rateCard.ts`
- `M` `src/lib/rollups.test.ts`
- `M` `src/lib/rollups.ts`
- `M` `src/lib/routePrefetch.ts`
- `M` `src/lib/stages.ts`
- `M` `src/lib/statement.ts`
- `M` `src/lib/subApi.ts`
- `M` `src/lib/subIdentity.ts`
- `M` `src/lib/supabase.ts`
- `M` `src/lib/timePunches.ts`
- `M` `src/lib/toast.ts`
- `M` `src/lib/universalSearch.ts`
- `M` `src/lib/useDrawerKeyboard.ts`
- `M` `src/lib/useInfiniteRender.ts`
- `M` `src/lib/useMediaQuery.ts`
- `M` `src/lib/utils.ts`
- `M` `src/lib/weather.ts`
- `M` `src/main.tsx`
- `M` `src/screens/Activity.tsx`
- `M` `src/screens/Analytics.tsx`
- `M` `src/screens/Bid.tsx`
- `M` `src/screens/ClientDetail.tsx`
- `M` `src/screens/Clients.tsx`
- `M` `src/screens/Compose.tsx`
- `M` `src/screens/ContactDetail/hooks/useJobData.ts`
- `M` `src/screens/ContactDetail/index.tsx`
- `M` `src/screens/ContactDetail/lib/jobHealth.ts`
- `M` `src/screens/ContactDetail/lib/jobNextAction.ts`
- `M` `src/screens/ContactDetail/lib/stageWorkspace.test.ts`
- `M` `src/screens/ContactDetail/lib/stageWorkspace.ts`
- `M` `src/screens/ContactDetail/sections/ActivityLog.tsx`
- `M` `src/screens/ContactDetail/sections/ApproveQuoteSheet.tsx`
- `M` `src/screens/ContactDetail/sections/ChangeOrdersSection.tsx`
- `M` `src/screens/ContactDetail/sections/DailyLogs.tsx`
- `M` `src/screens/ContactDetail/sections/Expenses.tsx`
- `M` `src/screens/ContactDetail/sections/Files.tsx`
- `M` `src/screens/ContactDetail/sections/Inspections.tsx`
- `M` `src/screens/ContactDetail/sections/InsuranceSection.tsx`
- `M` `src/screens/ContactDetail/sections/InvitePartner.tsx`
- `M` `src/screens/ContactDetail/sections/Invoice.tsx`
- `M` `src/screens/ContactDetail/sections/InvoiceDrawsSection.tsx`
- `M` `src/screens/ContactDetail/sections/Materials.tsx`
- `M` `src/screens/ContactDetail/sections/Messages.tsx`
- `M` `src/screens/ContactDetail/sections/Milestones.tsx`
- `M` `src/screens/ContactDetail/sections/Photos.tsx`
- `M` `src/screens/ContactDetail/sections/QuoteItems.tsx`
- `M` `src/screens/ContactDetail/sections/QuoteTerms.tsx`
- `M` `src/screens/ContactDetail/sections/Scheduled.tsx`
- `M` `src/screens/ContactDetail/sections/Selections.tsx`
- `M` `src/screens/ContactDetail/sections/Subs.tsx`
- `M` `src/screens/ContactDetail/sections/Todos.tsx`
- `M` `src/screens/ContactDetail/sections/composeActivityEvents.ts`
- `M` `src/screens/ContactDetail/tabs/Details.tsx`
- `M` `src/screens/ContactDetail/tabs/Files.tsx`
- `M` `src/screens/ContactDetail/tabs/Financials.tsx`
- `M` `src/screens/ContactDetail/tabs/Overview.tsx`
- `M` `src/screens/ContactDetail/tabs/Quote.tsx`
- `M` `src/screens/ContactDetail/tabs/_StubTab.tsx`
- `M` `src/screens/Crew.tsx`
- `M` `src/screens/Home.tsx`
- `M` `src/screens/Importer.tsx`
- `M` `src/screens/InvoiceDetail.tsx`
- `M` `src/screens/Invoices.tsx`
- `M` `src/screens/Landing.tsx`
- `M` `src/screens/LegalLayout.tsx`
- `M` `src/screens/Login.tsx`
- `M` `src/screens/NotFound.tsx`
- `M` `src/screens/Notes.tsx`
- `M` `src/screens/Onboarding.tsx`
- `M` `src/screens/OrgInvite.tsx`
- `M` `src/screens/PartnerInvite.tsx`
- `M` `src/screens/Partners.tsx`
- `M` `src/screens/PourWindow.tsx`
- `M` `src/screens/Privacy.tsx`
- `M` `src/screens/PublicDoc.tsx`
- `M` `src/screens/ResetPassword.tsx`
- `M` `src/screens/Schedule.tsx`
- `M` `src/screens/Settings.tsx`
- `M` `src/screens/SubDetail.tsx`
- `M` `src/screens/SubPortal.tsx`
- `M` `src/screens/Subs.tsx`
- `M` `src/screens/Tasks.tsx`
- `M` `src/screens/Team.tsx`
- `M` `src/screens/Terms.tsx`
- `M` `src/screens/Timesheets.tsx`
- `M` `src/screens/Work.tsx`
- `M` `src/styles/fixes-2026-07.css`
- `M` `src/styles/global.css`
- `M` `src/styles/mobile-keyboard-fix.css`
- `M` `src/styles/v3.css`
- `A` `src/ui/Badge.tsx`
- `A` `src/ui/Button.tsx`
- `A` `src/ui/Card.tsx`
- `A` `src/ui/DataTable.tsx`
- `A` `src/ui/EmptyState.tsx`
- `A` `src/ui/StatCard.tsx`
- `A` `src/ui/index.ts`

### Phase C: Home dashboard and lead to cash workflow

Commit: `199a6ae`

Files changed: 21

- `M` `package.json`
- `A` `playwright.workflow.config.ts`
- `M` `scripts/qa-interact.mjs`
- `M` `scripts/qa-tour.mjs`
- `M` `src/components/desktop/SnowHomeBuild.tsx`
- `M` `src/components/desktop/SnowInvoicesBuild.tsx`
- `M` `src/components/desktop/SnowJobDetailBuild.tsx`
- `M` `src/lib/homeDashboard.ts`
- `M` `src/lib/invoices.test.ts`
- `M` `src/lib/invoices.ts`
- `M` `src/screens/ContactDetail/hooks/useJobData.ts`
- `M` `src/screens/ContactDetail/index.tsx`
- `M` `src/screens/ContactDetail/lib/jobHealth.test.ts`
- `M` `src/screens/ContactDetail/lib/jobHealth.ts`
- `M` `src/screens/ContactDetail/lib/jobNextAction.test.ts`
- `M` `src/screens/ContactDetail/lib/jobNextAction.ts`
- `M` `src/screens/ContactDetail/tabs/Overview.tsx`
- `M` `src/screens/Invoices.tsx`
- `M` `src/styles/fixes-2026-07.css`
- `M` `src/styles/global.css`
- `A` `tests/e2e/mock-workflows.spec.ts`

### Phase D: Supabase RLS migration

Commit: `227ae09`

Files changed: 3

- `M` `package.json`
- `A` `scripts/audit-rls-policies.mjs`
- `A` `supabase/migrations/061_audit_rls_policies.sql`

### QA follow through: Browser harness, zero trends, and count copy

Commit: `a645b7c`

Files changed: 18

- `M` `playwright.config.ts`
- `M` `src/components/AddEventSheet.tsx`
- `M` `src/components/MergeDuplicatesSheet.tsx`
- `M` `src/components/NewLeadSheet.tsx`
- `M` `src/components/TimeClockCard.tsx`
- `M` `src/components/desktop/SnowAnalyticsBuild.tsx`
- `M` `src/components/desktop/SnowHomeBuild.tsx`
- `M` `src/components/desktop/SnowNotesBuild.tsx`
- `M` `src/components/desktop/SnowScheduleBuild.tsx`
- `A` `src/lib/format.test.ts`
- `M` `src/lib/format.ts`
- `M` `src/screens/Compose.tsx`
- `M` `src/screens/ContactDetail/sections/InvoiceDrawsSection.tsx`
- `M` `src/screens/ContactDetail/tabs/Overview.tsx`
- `M` `src/screens/Home.tsx`
- `M` `src/screens/Importer.tsx`
- `M` `src/screens/Onboarding.tsx`
- `M` `tests/e2e/mock-workflows.spec.ts`

### Repository audit closure: Server email and launch manifest sweep

Commit: `31d50d1`

Files changed: 13

- `M` `DESIGN_SYSTEM_REPLACEMENTS.md`
- `M` `index.html`
- `M` `mobile/app.json`
- `M` `netlify/functions/lib/email.js`
- `M` `netlify/functions/org-invite-create.js`
- `M` `netlify/functions/partner-invite.js`
- `M` `netlify/functions/send-certificate.js`
- `M` `netlify/functions/send-invoice.js`
- `M` `netlify/functions/send-message.js`
- `M` `netlify/functions/send-quote.js`
- `M` `netlify/functions/send-statement.js`
- `M` `scripts/audit-design-system.mjs`
- `M` `scripts/report-design-replacements.mjs`

## Migration SQL

```sql
-- 061: Close the RLS audit gaps for invitations and server-only config.
--
-- org_invites is the only table in this audit that needs direct client
-- access. Owners and admins can manage invites for an active organization
-- membership. An authenticated invitee can read only rows addressed to the
-- email in their verified Supabase JWT.
--
-- fh_app_config contains the private VAPID signing key and
-- fh_integration_secrets contains OAuth tokens. Both remain service role
-- only. RLS stays enabled and anon/authenticated retain no table grants.

alter table public.org_invites enable row level security;

drop policy if exists "org_invites_admin_read_write" on public.org_invites;
drop policy if exists "org_invites_manage_by_owner_admin" on public.org_invites;
drop policy if exists "org_invites_select_by_email" on public.org_invites;
drop policy if exists "org_invites_select_owner_admin_or_recipient" on public.org_invites;
drop policy if exists "org_invites_insert_by_owner_admin" on public.org_invites;
drop policy if exists "org_invites_delete_by_owner_admin" on public.org_invites;
drop policy if exists "org_invites_owner_admin_select" on public.org_invites;
drop policy if exists "org_invites_owner_admin_insert" on public.org_invites;
drop policy if exists "org_invites_owner_admin_delete" on public.org_invites;
drop policy if exists "org_invites_invitee_select" on public.org_invites;

create index if not exists idx_org_invites_org_id
  on public.org_invites(org_id);

create index if not exists idx_org_invites_email_lower
  on public.org_invites(lower(email));

create policy "org_invites_select_owner_admin_or_recipient"
  on public.org_invites
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.org_members m
      where m.org_id = org_invites.org_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin')
        and m.revoked_at is null
    )
    or lower(email) = lower(coalesce(((select auth.jwt()) ->> 'email'), ''))
  );

create policy "org_invites_insert_by_owner_admin"
  on public.org_invites
  for insert
  to authenticated
  with check (
    invited_by = (select auth.uid())
    and exists (
      select 1
      from public.org_members m
      where m.org_id = org_invites.org_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin')
        and m.revoked_at is null
    )
  );

create policy "org_invites_delete_by_owner_admin"
  on public.org_invites
  for delete
  to authenticated
  using (
    exists (
      select 1
      from public.org_members m
      where m.org_id = org_invites.org_id
        and m.user_id = (select auth.uid())
        and m.role in ('owner', 'admin')
        and m.revoked_at is null
    )
  );

revoke all on table public.org_invites from anon, authenticated;
grant select, insert, delete on table public.org_invites to authenticated;

alter table public.fh_app_config enable row level security;
drop policy if exists "fh_app_config_authenticated_public_read" on public.fh_app_config;
revoke all on table public.fh_app_config from anon, authenticated;

comment on table public.fh_app_config is
  'Server-only application secrets. Access is limited to the service role.';

alter table public.fh_integration_secrets enable row level security;
revoke all on table public.fh_integration_secrets from anon, authenticated;

comment on table public.fh_integration_secrets is
  'Server-only integration credentials. Access is limited to the service role.';
```
