import { Routes, Route, Navigate } from 'react-router-dom'
import { useAuth } from './contexts/AuthContext.jsx'
import { useProfile } from './contexts/ProfileContext.jsx'
import AppShell from './components/AppShell.jsx'
import Home from './screens/Home.jsx'
import Login from './screens/Login.jsx'
import ResetPassword from './screens/ResetPassword.jsx'
import Onboarding from './screens/Onboarding.jsx'
import PartnerInvite from './screens/PartnerInvite.jsx'
import Jobs from './screens/Jobs.jsx'
import ContactDetail from './screens/ContactDetail.jsx'
import Clients from './screens/Clients.jsx'
import ClientDetail from './screens/ClientDetail.jsx'
import Notes from './screens/Notes.jsx'
import Schedule from './screens/Schedule.jsx'
import Bid from './screens/Bid.jsx'
import Compose from './screens/Compose.jsx'
import Analytics from './screens/Analytics.jsx'
import Importer from './screens/Importer.jsx'
import Settings from './screens/Settings.jsx'

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

export default function App() {
  return (
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
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  )
}
