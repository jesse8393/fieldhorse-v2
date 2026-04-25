import { lazy, Suspense } from 'react'
import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext.jsx'
import { useProfile } from './contexts/ProfileContext.jsx'
import AppShell from './components/AppShell.jsx'

// Eager — must be in main bundle
//   Login: gates everything; can't lazy-load the login screen
//   Home: the post-auth landing screen; lazy here would flash a spinner
//         on every cold app open, defeats premium feel
import Home from './screens/Home.jsx'
import Login from './screens/Login.jsx'

// Lazy — every other route. Each becomes its own chunk.
// Initial JS bundle drops from ~1.47 MB to ~400 KB on first paint;
// remaining chunks fetch on-demand as the user navigates.
const ResetPassword  = lazy(() => import('./screens/ResetPassword.jsx'))
const Onboarding     = lazy(() => import('./screens/Onboarding.jsx'))
const PartnerInvite  = lazy(() => import('./screens/PartnerInvite.jsx'))
const Jobs           = lazy(() => import('./screens/Jobs.jsx'))
const ContactDetail  = lazy(() => import('./screens/ContactDetail.jsx'))
const Clients        = lazy(() => import('./screens/Clients.jsx'))
const ClientDetail   = lazy(() => import('./screens/ClientDetail.jsx'))
const Notes          = lazy(() => import('./screens/Notes.jsx'))
const Schedule       = lazy(() => import('./screens/Schedule.jsx'))
const Bid            = lazy(() => import('./screens/Bid.jsx'))
const Compose        = lazy(() => import('./screens/Compose.jsx'))
const Analytics      = lazy(() => import('./screens/Analytics.jsx'))
const Importer       = lazy(() => import('./screens/Importer.jsx'))
const Settings       = lazy(() => import('./screens/Settings.jsx'))
const PourWindow     = lazy(() => import('./screens/PourWindow.jsx'))
const Subs           = lazy(() => import('./screens/Subs.jsx'))
const Invoices       = lazy(() => import('./screens/Invoices.jsx'))

function RequireAuth({ children }) {
  const { session, loading } = useAuth()
  if (loading) return null
  if (!session) return <Navigate to="/login" replace />
  return children
}

function RequireOnboarded({ children }) {
  const { loading, isOnboarded } = useProfile()
  if (loading) return null
  if (!isOnboarded) return <Navigate to="/onboarding" replace />
  return children
}

function Gated({ children }) {
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
  return null
}

export default function App() {
  return (
    <Suspense fallback={<PublicFallback />}>
      <Routes>
        <Route path="/login" element={<Login />} />
        <Route path="/reset-password" element={<ResetPassword />} />
        <Route path="/partner-invite/:token" element={<PartnerInvite />} />
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
          <Route path="/jobs" element={<Jobs />} />
          <Route path="/jobs/:id" element={<ContactDetail />} />
          <Route path="/clients" element={<Clients />} />
          <Route path="/clients/:id" element={<ClientDetail />} />
          <Route path="/notes" element={<Notes />} />
          <Route path="/schedule" element={<Schedule />} />
          <Route path="/bid" element={<Bid />} />
          <Route path="/compose" element={<Compose />} />
          <Route path="/analytics" element={<Analytics />} />
          <Route path="/import" element={<Importer />} />
          <Route path="/settings" element={<Settings />} />
          <Route path="/pour-window" element={<PourWindow />} />
          <Route path="/subs" element={<Subs />} />
          <Route path="/invoices" element={<Invoices />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
