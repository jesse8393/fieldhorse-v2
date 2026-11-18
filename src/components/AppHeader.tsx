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
  const primary = [TODAY, SCHEDULE, JOBS, MONEY, ...(engineEnabled ? [INBOX] : [])].filter(item => canSee(item.to))
  const company = headerName(orgName, profile?.company_name, profile?.full_name)
  const companyFull = headerFullName(orgName, profile?.company_name, profile?.full_name)
  const ownCompany = profileCompanyIsWorkspace({ orgName, companyName: profile?.company_name, ownsWorkspace: isOwner, workspacesOwned: memberships.filter(m => m.role === 'owner').length })
  // Each control shows only when its screen will open for this person. With
  // no company role that is just the sub portal (dead-ends-2).
  const canMenu = canSee('/workspace')
  const home = primary[0]?.to ?? (canMenu ? '/workspace' : '/sub-portal')

  return (
    <header className="fh-app-header fhs-header fh-glass-header">
      <Link className="fh-glass-wordmark" to={home} aria-label="Fieldhorse home"><svg className="fh-wordmark-symbol" viewBox="0 0 28 28" fill="none" aria-hidden="true"><path d="M5 25V4h20M10 25V10h15" stroke="currentColor" strokeWidth="2.5" /></svg><span className="fh-wordmark-text">fieldhorse<span aria-hidden="true">.</span></span></Link>
      <nav className="fh-glass-nav" aria-label="Primary">
        {primary.map(item => <Link key={item.to} to={item.to} aria-current={isActive(item, pathname) ? 'page' : undefined}
          onPointerEnter={() => prefetchRoute(item.to)} onFocus={() => prefetchRoute(item.to)}>{item.label}</Link>)}
        {canMenu && <Link to="/workspace" aria-current={pathname === '/workspace' ? 'page' : undefined}>More</Link>}
      </nav>
      {canMenu && (
        <button
          type="button"
          className="fhs-header__menu"
          aria-label="Open workspace menu"
          title={companyFull}
          onClick={openWorkspaceMenu}
        >
          <Monogram name={company} logoUrl={ownCompany ? profile?.logo_url : null} size={40} />
        </button>
      )}
      <div className="fhs-header__actions">
        {canSee('/capture') && (
          <button type="button" className="fh-glass-capture" aria-label={`Capture (${captureKeys.spoken})`} aria-keyshortcuts={captureKeys.combo} onClick={() => openCapture()} title={`Capture a note, photo, or update (${captureKeys.keys})`}>
            <Icon icon={Mic} size={18} /><span>Capture</span>
          </button>
        )}
        {/* One New button (D58): the full screen with Lead, Quote, Job,
            Invoice and Client. The long press menu on the dock coin is gone.
            No key: the browser keeps Cmd or Ctrl+N for a new window (D09).
            Only for a role that may create, so crew never bounce off it. */}
        {canSee('/new') && (
          <Link to="/new" className="fhs-icon-btn" aria-label="New" title="New">
            <Icon icon={Plus} size={22} />
          </Link>
        )}
        {canSee('/search') && (
          <button type="button" className="fhs-icon-btn" aria-label="Search everything" aria-keyshortcuts={searchKeys.combo} title={`Search (${searchKeys.keys})`} onClick={openSearch}>
            <Icon icon={Search} size={22} />
          </button>
        )}
        {canSee('/notifications') && <NotificationsBell />}
      </div>
    </header>
  )
}
