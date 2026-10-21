import { Suspense } from 'react'
import type { ReactNode } from 'react'
import { Routes, Route, Navigate, useParams, useSearchParams, useLocation } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext.tsx'
import { useProfile } from './contexts/ProfileContext.tsx'
import { useMediaQuery } from './lib/useMediaQuery.ts'
import { lazyWithRetry as lazy } from './lib/lazyWithRetry.ts'
import AppShell from './components/AppShell.tsx'

// Eager, must be in main bundle
//   Login: gates everything; can't lazy-load the login screen
//   Home: the post-auth landing screen; lazy here would flash a spinner
//         on every cold app open, defeats premium feel
import Home from './screens/Home.tsx'
import NotFound from './screens/NotFound.tsx'
import Login from './screens/Login.tsx'

// Lazy, every other route. Each becomes its own chunk.
// Initial JS bundle drops from ~1.47 MB to ~400 KB on first paint;
// remaining chunks fetch on-demand as the user navigates. lazyWithRetry
// reloads once when a deploy has replaced a chunk (see lib/lazyWithRetry.ts).
const ResetPassword  = lazy(() => import('./screens/ResetPassword.tsx'))
const Onboarding     = lazy(() => import('./screens/Onboarding.tsx'))
const PartnerInvite  = lazy(() => import('./screens/PartnerInvite.tsx'))
const OrgInvite      = lazy(() => import('./screens/OrgInvite.tsx'))
const Team           = lazy(() => import('./screens/Team.tsx'))
const Crew           = lazy(() => import('./screens/Crew.tsx'))
const Timesheets     = lazy(() => import('./screens/Timesheets.tsx'))
const Tasks          = lazy(() => import('./screens/Tasks.tsx'))
const SubPortal      = lazy(() => import('./screens/SubPortal.tsx'))
const Privacy        = lazy(() => import('./screens/Privacy.tsx'))
const Terms          = lazy(() => import('./screens/Terms.tsx'))
const Work           = lazy(() => import('./screens/Work.tsx'))
const ContactDetail  = lazy(() => import('./screens/ContactDetail/index.tsx'))
const DetailListRail = lazy(() => import('./components/desktop/DetailListRail.tsx'))
const Clients        = lazy(() => import('./screens/Clients.tsx'))
const ClientDetail   = lazy(() => import('./screens/ClientDetail.tsx'))
const Notes          = lazy(() => import('./screens/Notes.tsx'))
const Schedule       = lazy(() => import('./screens/Schedule.tsx'))
const Activity       = lazy(() => import('./screens/Activity.tsx'))
const PublicDoc      = lazy(() => import('./screens/PublicDoc.tsx'))
const Bid            = lazy(() => import('./screens/Bid.tsx'))
const Compose        = lazy(() => import('./screens/Compose.tsx'))
const Analytics      = lazy(() => import('./screens/Analytics.tsx'))
const Importer       = lazy(() => import('./screens/Importer.tsx'))
const Settings       = lazy(() => import('./screens/Settings.tsx'))
const PourWindow     = lazy(() => import('./screens/PourWindow.tsx'))
const Subs           = lazy(() => import('./screens/Subs.tsx'))
const Partners       = lazy(() => import('./screens/Partners.tsx'))
const SubDetail      = lazy(() => import('./screens/SubDetail.tsx'))
const Invoices       = lazy(() => import('./screens/Invoices.tsx'))
const Landing        = lazy(() => import('./screens/Landing.tsx'))
// The invoice screens (Phase 9, D57, D62): /invoices/:id is an fh_invoices
// row; its payment, edit and remind flows are routes of their own. A job's
// money lives at /jobs/:id?tab=financials (JobMoney).
const InvoiceDetail  = lazy(() => import('./screens/invoices/InvoiceDetail.tsx'))
const InvoicePayment = lazy(() => import('./screens/invoices/InvoicePayment.tsx'))
const InvoiceEdit    = lazy(() => import('./screens/invoices/InvoiceEdit.tsx'))
const InvoiceRemind  = lazy(() => import('./screens/invoices/InvoiceRemind.tsx'))
const Inbox          = lazy(() => import('./screens/inbox/Inbox.tsx'))
const Notifications  = lazy(() => import('./screens/Notifications.tsx'))
// Leads have their own list and screen (PHASE9_PLAN Task 9, decision D65).
const LeadsList      = lazy(() => import('./screens/leads/LeadsList.tsx'))
const LeadDetail     = lazy(() => import('./screens/leads/LeadDetail.tsx'))
const New            = lazy(() => import('./screens/New.tsx'))
const LeadNew        = lazy(() => import('./screens/leads/LeadNew.tsx'))
const QuoteNew       = lazy(() => import('./screens/quotes/QuoteNew.tsx'))
const JobNew         = lazy(() => import('./screens/jobs/JobNew.tsx'))
const InvoiceNew     = lazy(() => import('./screens/invoices/InvoiceNew.tsx'))
const ClientNew      = lazy(() => import('./screens/clients/ClientNew.tsx'))
// Quotes are records of their own (Phase 9, D53, D65): a list, the quote
// and its three screens for terms, the preview and approval.
const QuotesList     = lazy(() => import('./screens/quotes/QuotesList.tsx'))
const QuoteDetail    = lazy(() => import('./screens/quotes/QuoteDetail.tsx'))
const QuoteTerms     = lazy(() => import('./screens/quotes/QuoteTerms.tsx'))
const QuotePreview   = lazy(() => import('./screens/quotes/QuotePreview.tsx'))
const QuoteApprove   = lazy(() => import('./screens/quotes/QuoteApprove.tsx'))
// The job's action screens and the event screen took the place of the
// job page's and the Schedule's sheets (Phase 9, Task 13, D57).
const JobPayment     = lazy(() => import('./screens/jobs/JobPayment.tsx'))
// The screens that took the place of the last pop ups (Task 14, D57).
const Capture        = lazy(() => import('./screens/Capture.tsx'))
const Workspace      = lazy(() => import('./screens/Workspace.tsx'))
const SearchScreen   = lazy(() => import('./screens/Search.tsx'))
const ClientStatement = lazy(() => import('./screens/clients/ClientStatement.tsx'))
const ClientsMerge   = lazy(() => import('./screens/clients/ClientsMerge.tsx'))
const MilesNew       = lazy(() => import('./screens/MilesNew.tsx'))
const SubNew         = lazy(() => import('./screens/SubNew.tsx'))
const TeamInvite     = lazy(() => import('./screens/TeamInvite.tsx'))
const SubPortalProfile = lazy(() => import('./screens/SubPortalProfile.tsx'))
const JobPartner     = lazy(() => import('./screens/jobs/JobPartner.tsx'))
const JobComplete    = lazy(() => import('./screens/jobs/JobComplete.tsx'))
const JobMore        = lazy(() => import('./screens/jobs/JobMore.tsx'))
const JobFollowUp    = lazy(() => import('./screens/jobs/JobFollowUp.tsx'))
const EventNew       = lazy(() => import('./screens/schedule/EventNew.tsx'))
// The redesign component sheet, in development builds only: the
// condition is a build time constant, so production drops the chunk.
const DesignSheet    = import.meta.env.DEV ? lazy(() => import('./screens/DesignSheet.tsx')) : null

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  const { pathname } = useLocation()
  if (loading) return <AppLoading label="Checking session" />
  if (!session) {
    // A logged out visitor at the root gets the marketing page, not a
    // login wall. Deep links into the app still bounce to /login.
    if (pathname === '/') return <Landing />
    return <Navigate to="/login" replace />
  }
  return children
}

function RequireOnboarded({ children }: { children: ReactNode }) {
  const { loading, isOnboarded, error } = useProfile()
  if (loading) return <AppLoading label="Loading workspace" />
  // Fail open on a profile fetch error (offline cold open / transient
  // failure): an already-authenticated owner must NOT be bounced to
  // /onboarding just because the profile row couldn't load, the
  // persisted TanStack cache covers reads. Only redirect when we have a
  // clean, error-free "not onboarded" answer from the server.
  if (error) return children
  if (!isOnboarded) return <Navigate to="/onboarding" replace />
  return children
}

function Gated({ children }: { children: ReactNode }) {
  return (
    <RequireAuth>
      <RequireOnboarded>{children}</RequireOnboarded>
    </RequireAuth>
  )
}

// Top-level Suspense for the unauthenticated routes (Login is eager so
// it never suspends, but ResetPassword + PartnerInvite + Onboarding
// are all lazy and need a boundary above them). The Gated tree gets its
// own Suspense inside AppShell so the header + nav stay mounted while
// the inner screen chunk loads.
function PublicFallback() {
  return <AppLoading label="Loading Fieldhorse" />
}

function AppLoading({ label }: { label: string }) {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        minHeight: '100vh',
        display: 'grid',
        placeItems: 'center',
        background: 'var(--v3-bg, #141414)',
        color: 'var(--v3-text, #F2EDE4)',
        fontFamily: 'var(--font-body, system-ui, sans-serif)',
        padding: 24
      }}
    >
      <div style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
        <div style={{ fontFamily: 'var(--font-wordmark)', fontSize: 24, letterSpacing: 0, lineHeight: 1 }}>
          <span style={{ color: 'var(--v3-primary, #C9963A)' }}>FIELD</span>HORSE
        </div>
        <div style={{ color: 'var(--v3-text-muted, rgba(242,237,228,.55))', fontSize: 14 }}>
          {label}
        </div>
      </div>
    </div>
  )
}

/**
 * ContactDetailRoute, master-detail shell for /leads/:id, /quotes/:id,
 * /jobs/:id.
 *
 * ≥1680px: a persistent list rail renders beside the detail so the
 * operator flips between records without bouncing back to the board.
 * The rail lives OUTSIDE the keyed ContactDetail, so its scroll +
 * search survive record switches. Below 1680px nothing changes, the
 * detail renders full-width exactly as before (the rail isn't even
 * mounted, so it costs nothing). The breakpoint must match the CSS:
 * fixes-2026-07.css hides the rail from 1440 to 1679px, and a mounted
 * but hidden rail still fetches the whole jobs list and listens for
 * every job change.
 *
 * key={id} gives every record a clean ContactDetail remount. This also
 * fixes a latent stale-state bug: navigating detail→detail (command
 * palette, rail) used to keep the previous record's tab/isEditing/modal
 * state because React kept the instance alive across param changes.
 */
/**
 * LegacyBoardRedirect: /work and /pipeline land on /jobs, the Jobs list
 * (Phase 9, D65). Old links, nav habits and deep links keep working: the
 * stage/view intent maps to the matching Jobs tab and every other query
 * param rides along.
 */
function LegacyBoardRedirect({ defaultStage }: { defaultStage?: string }) {
  const [params] = useSearchParams()
  const sp = new URLSearchParams(params)
  const requested = sp.get('stage') || sp.get('view') || defaultStage
  sp.delete('view')
  const mapped =
    requested === 'lead' || requested === 'new' || requested === 'leads' ? 'leads'
    : requested === 'quote' || requested === 'quoted' || requested === 'quotes' ? 'quotes'
    : requested === 'job' || requested === 'active' || requested === 'doing' || requested === 'invoice' || requested === 'won' ? 'active'
    : requested === 'closed' || requested === 'complete' || requested === 'done' ? 'done'
    : requested === 'lost' ? 'lost'
    : undefined
  if (mapped) sp.set('stage', mapped)
  else sp.delete('stage')
  const search = sp.toString()
  return <Navigate to={{ pathname: '/jobs', search: search ? `?${search}` : '' }} replace />
}

function ContactDetailRoute() {
  const { id } = useParams()
  return <ContactDetailSplit id={id} />
}

/**
 * /leads/:id (SPEC D55, D56). Leads live in their own table now, so the id
 * is first read there. An old fh_contacts id the migration moved is sent
 * on to the new record; any other contact id still opens the old detail
 * screen.
 */

/** /leads/:id: the lead screen, or the old detail screen for any other id. */
function LeadDetailRoute() {
  const { id = '' } = useParams()
  return <LeadDetail id={id} fallback={<ContactDetailSplit id={id} />} />
}

/**
 * /quotes/:id is the quote screen (Phase 9, Task 10). When no fh_quotes
 * row has the id, the old detail screen takes it: a moved row is sent on
 * to its new quote, a live contact still opens.
 */
function QuoteDetailRoute() {
  const { id = '' } = useParams()
  return <QuoteScreen><QuoteDetail fallback={<ContactDetailSplit id={id} />} /></QuoteScreen>
}

/**
 * The quote screens lay out as a 640 px column. This wrapper is the route's
 * root, so the shell's column stays full width around it (the desktop
 * route audit measures the root) while the content keeps its width.
 */
function QuoteScreen({ children }: { children: ReactNode }) {
  return <div className="fhqt-screen">{children}</div>
}

function ContactDetailSplit({ id }: { id: string | undefined }) {
  const isWide = useMediaQuery('(min-width: 1680px)')
  return (
    <div className="fh-detail-split">
      {isWide && (
        <aside className="fh-detail-split__rail">
          <Suspense fallback={null}>
            <DetailListRail />
          </Suspense>
        </aside>
      )}
      <div className="fh-detail-split__main">
        <ContactDetail key={id} />
      </div>
    </div>
  )
}

export default function App() {
  return (
    <Suspense fallback={<PublicFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/partner-invite/:token" element={<PartnerInvite />} />
        <Route path="/invite/:token" element={<OrgInvite />} />
        <Route path="/p/:token" element={<PublicDoc />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/terms" element={<Terms />} />
        {DesignSheet && <Route path="/design" element={<DesignSheet />} />}
        <Route
          path="/onboarding"
          element={
            <RequireAuth>
              <Onboarding />
            </RequireAuth>
          }
        />
        <Route element={<Gated><AppShell /></Gated>}>
          <Route path="/" element={<Home />} />
          <Route path="/work" element={<LegacyBoardRedirect />} />
          {/* The New screen and the create screens (SPEC D58, D59). */}
          <Route path="/new" element={<New />} />
          <Route path="/leads/new" element={<LeadNew />} />
          <Route path="/quotes/new" element={<QuoteNew />} />
          <Route path="/jobs/new" element={<JobNew />} />
          <Route path="/invoices/new" element={<InvoiceNew />} />
          <Route path="/clients/new" element={<ClientNew />} />
          <Route path="/leads" element={<LeadsList />} />
          <Route path="/leads/:id" element={<LeadDetailRoute />} />
          <Route path="/quotes" element={<QuoteScreen><QuotesList /></QuoteScreen>} />
          <Route path="/quotes/:id" element={<QuoteDetailRoute />} />
          <Route path="/quotes/:id/terms" element={<QuoteScreen><QuoteTerms /></QuoteScreen>} />
          <Route path="/quotes/:id/preview" element={<QuoteScreen><QuotePreview /></QuoteScreen>} />
          <Route path="/quotes/:id/approve" element={<QuoteScreen><QuoteApprove /></QuoteScreen>} />
          <Route path="/pipeline" element={<LegacyBoardRedirect />} />
          <Route path="/jobs" element={<Work />} />
          <Route path="/jobs/:id" element={<ContactDetailRoute />} />
          <Route path="/jobs/:id/payment" element={<JobPayment />} />
          <Route path="/jobs/:id/partner" element={<JobPartner />} />
          <Route path="/jobs/:id/complete" element={<JobComplete />} />
          <Route path="/jobs/:id/more" element={<JobMore />} />
          <Route path="/jobs/:id/follow-up" element={<JobFollowUp />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/merge" element={<ClientsMerge />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/clients/:id/statement" element={<ClientStatement />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/schedule/new" element={<EventNew />} />
          <Route path="/schedule/:eventId/edit" element={<EventNew />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/bid" element={<Bid />} />
          <Route path="/compose" element={<Compose />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/miles/new" element={<MilesNew />} />
          <Route path="/import" element={<Importer />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/pour-window" element={<PourWindow />} />
          <Route path="/subs" element={<Subs />} />
          <Route path="/subs/new" element={<SubNew />} />
          <Route path="/subs/:key" element={<SubDetail />} />
          <Route path="/partners" element={<Partners />} />
          <Route path="/team" element={<Team />} />
          <Route path="/team/invite" element={<TeamInvite />} />
          <Route path="/crew" element={<Crew />} />
          <Route path="/timesheets" element={<Timesheets />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/sub-portal" element={<SubPortal />} />
          <Route path="/sub-portal/profile" element={<SubPortalProfile />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/invoices/:id" element={<InvoiceDetail />} />
          <Route path="/invoices/:id/payment" element={<InvoicePayment />} />
          <Route path="/invoices/:id/edit" element={<InvoiceEdit />} />
          <Route path="/invoices/:id/remind" element={<InvoiceRemind />} />
          {/* The Inbox exists only while the company's messaging engine is
              on; the screen explains itself when it is off (decision D9). */}
          <Route path="/inbox" element={<Inbox />} />
          <Route path="/inbox/:conversationId" element={<Inbox />} />
          {/* The bell's list is a screen, not a sheet (decision D64). */}
          <Route path="/notifications" element={<Notifications />} />
          <Route path="/capture" element={<Capture />} />
          <Route path="/workspace" element={<Workspace />} />
          <Route path="/search" element={<SearchScreen />} />
          {/* Alias routes, these URLs exist in muscle memory / older
              links but the screens live elsewhere. Explicit redirects
              beat the silent catch-all bounce to Home. (/leads is a
              real route now, pipeline v2.) */}
          <Route path="/templates" element={<Navigate to={{ pathname: '/settings', hash: '#templates' }} replace />} />
          {/* Real 404 inside the shell, the old silent bounce to Home
              gave a mistyped/stale link no error signal (UI audit #7). */}
          <Route path="*" element={<NotFound />} />
        </Route>
      </Routes>
    </Suspense>
  )
}
