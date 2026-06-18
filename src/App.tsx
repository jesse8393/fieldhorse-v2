import { lazy, Suspense } from 'react'
import type { ReactNode } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext.tsx'
import { useProfile } from './contexts/ProfileContext.tsx'
import AppShell from './components/AppShell.tsx'

// Eager — must be in main bundle
//   Login: gates everything; can't lazy-load the login screen
//   Home: the post-auth landing screen; lazy here would flash a spinner
//         on every cold app open, defeats premium feel
import Home from './screens/Home.tsx'
import Login from './screens/Login.tsx'

// Lazy — every other route. Each becomes its own chunk.
// Initial JS bundle drops from ~1.47 MB to ~400 KB on first paint;
// remaining chunks fetch on-demand as the user navigates.
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
const Jobs           = lazy(() => import('./screens/Jobs.tsx'))
const Leads          = lazy(() => import('./screens/Leads.tsx'))
const ContactDetail  = lazy(() => import('./screens/ContactDetail/index.tsx'))
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
const InvoiceDetail  = lazy(() => import('./screens/InvoiceDetail.tsx'))

function RequireAuth({ children }: { children: ReactNode }) {
  const { session, loading } = useAuth()
  if (loading) return <AppLoading label="Checking session" />
  if (!session) return <Navigate to="/login" replace />
  return children
}

function RequireOnboarded({ children }: { children: ReactNode }) {
  const { loading, isOnboarded } = useProfile()
  if (loading) return <AppLoading label="Loading workspace" />
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
        background: 'var(--v3-bg, #0B0907)',
        color: 'var(--v3-text, #F2EDE4)',
        fontFamily: 'var(--font-body, system-ui, sans-serif)',
        padding: 24
      }}
    >
      <div style={{ display: 'grid', gap: 12, justifyItems: 'center' }}>
        <div style={{ fontFamily: 'var(--font-display, sans-serif)', fontSize: 30, letterSpacing: '0.14em', lineHeight: 1 }}>
          <span style={{ color: 'var(--v3-primary, #C9963A)' }}>FIELD</span>HORSE
        </div>
        <div style={{ color: 'var(--v3-text-muted, rgba(242,237,228,.55))', fontSize: 13 }}>
          {label}
        </div>
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
          <Route path="/leads" element={<Leads />} />
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/:id" element={<ContactDetail />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/activity" element={<Activity />} />
          <Route path="/bid" element={<Bid />} />
          <Route path="/compose" element={<Compose />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/import" element={<Importer />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/pour-window" element={<PourWindow />} />
          <Route path="/subs" element={<Subs />} />
          <Route path="/subs/:key" element={<SubDetail />} />
          <Route path="/partners" element={<Partners />} />
          <Route path="/team" element={<Team />} />
          <Route path="/crew" element={<Crew />} />
          <Route path="/timesheets" element={<Timesheets />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/sub-portal" element={<SubPortal />} />
          <Route path="/invoices" element={<Invoices />} />
          <Route path="/invoices/:id" element={<InvoiceDetail />} />
          {/* Alias routes — these URLs exist in muscle memory / older
              links but the screens live elsewhere. Explicit redirects
              beat the silent catch-all bounce to Home. (/leads is a
              real route now — pipeline v2.) */}
          <Route path="/templates" element={<Navigate to={{ pathname: '/settings', hash: '#templates' }} replace />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
