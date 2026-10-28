import { Mic, Plus, Search } from 'lucide-react'
import { useMemo } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { headerFullName, headerName, profileCompanyIsWorkspace } from '../lib/headerName.ts'
import Icon from './fh/Icon.tsx'
import Monogram from './fh/Monogram.tsx'
import NotificationsBell from './NotificationsBell.tsx'
import { TODAY, SCHEDULE, JOBS, MONEY, INBOX, isActive } from '../lib/navItems.ts'
import { useNavAccess } from '../lib/useNavAccess.ts'
import { useEngineEnabled } from '../lib/inbox.ts'
import { prefetchRoute } from '../lib/routePrefetch.ts'
import { openCapture } from '../lib/captureAttach.ts'
import { browserEnv, desktopShortcut } from '../lib/shortcutKeys.ts'

// Single entry point for search. CommandPalette opens at 900px and up; below
// it the app shell takes the same event to the /search screen (D57).
function openSearch() {
  window.dispatchEvent(new CustomEvent('fh:open-palette'))
}

// The workspace menu is the screen /workspace (D57); the shell navigates.
function openWorkspaceMenu() {
  window.dispatchEvent(new CustomEvent('fh:open-menu'))
}

/** Shared glass navigation. The workspace menu retains every role-filtered
 * destination, workspace switching, theme controls, and sign out. */
export default function AppHeader() {
  const { profile } = useProfile()
  const { orgName, memberships, isOwner } = useMembership()
  const { pathname } = useLocation()
  const { canSee } = useNavAccess()
  const engineEnabled = useEngineEnabled()
  const env = useMemo(() => browserEnv(), [])
  const captureKeys = desktopShortcut('J', env)
  const searchKeys = desktopShortcut('K', env)
  const newKeys = desktopShortcut('N', env)
  const primary = [TODAY, SCHEDULE, JOBS, MONEY, ...(engineEnabled ? [INBOX] : [])].filter(item => canSee(item.to))
  const company = headerName(orgName, profile?.company_name, profile?.full_name)
  const companyFull = headerFullName(orgName, profile?.company_name, profile?.full_name)
  const ownCompany = profileCompanyIsWorkspace({ orgName, companyName: profile?.company_name, ownsWorkspace: isOwner, workspacesOwned: memberships.filter(m => m.role === 'owner').length })

  return (
    <header className="fh-app-header fhs-header fh-glass-header">
      <Link className="fh-glass-wordmark" to={primary[0]?.to ?? '/workspace'} aria-label="Fieldhorse home">fieldhorse<span aria-hidden="true">.</span></Link>
      <nav className="fh-glass-nav" aria-label="Primary">
        {primary.map(item => <Link key={item.to} to={item.to} aria-current={isActive(item, pathname) ? 'page' : undefined}
          onPointerEnter={() => prefetchRoute(item.to)} onFocus={() => prefetchRoute(item.to)}>{item.label}</Link>)}
        <Link to="/workspace" aria-current={pathname === '/workspace' ? 'page' : undefined}>More</Link>
      </nav>
      <button
        type="button"
        className="fhs-header__menu"
        aria-label="Open workspace menu"
        title={companyFull}
        onClick={openWorkspaceMenu}
      >
        <Monogram name={company} logoUrl={ownCompany ? profile?.logo_url : null} size={40} />
      </button>
      <div className="fhs-header__actions">
        <button type="button" className="fh-glass-capture" aria-label={`Capture (${captureKeys.spoken})`} aria-keyshortcuts={captureKeys.combo} onClick={() => openCapture()} title={`Capture a note, photo, or update (${captureKeys.keys})`}>
          <Icon icon={Mic} size={18} /><span>Capture</span>
        </button>
        {/* One New button (D58): the full screen with Lead, Quote, Job,
            Invoice and Client. The long press menu on the dock coin is gone. */}
        <Link to="/new" className="fhs-icon-btn" aria-label="New" aria-keyshortcuts={newKeys.combo} title={`New (${newKeys.keys})`}>
          <Icon icon={Plus} size={22} />
        </Link>
        <button type="button" className="fhs-icon-btn" aria-label="Search everything" aria-keyshortcuts={searchKeys.combo} title={`Search (${searchKeys.keys})`} onClick={openSearch}>
          <Icon icon={Search} size={22} />
        </button>
        <NotificationsBell />
      </div>
    </header>
  )
}
