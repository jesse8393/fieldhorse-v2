// DesktopSidebar, the onyx rail at 900px and up (spec 8.3).
//
// Top: the company monogram, the short company name the phone header
// shows (two lines at most, the full name in its title) and the city
// (PHASE8_PLAN.md Task 14). The city and the logo come from the person's
// profile, so they show only in a workspace that is the company the
// person runs. Then search with ⌘K and a quiet Capture row with its key
// cap (⌘J on a Mac, Ctrl J elsewhere), which opens Universal Capture the
// way the dock coin does on a phone (PHASE8_PLAN.md Task 13, D33). There
// is no floating capture button on a desktop any more: it covered page
// content and made a second gold element on pages meant to have one.
// Under Capture, a New row with its own key cap (⌘N or Ctrl N) opens the
// New screen, the one place a lead, quote, job, invoice or client starts
// (PHASE9_PLAN Task 8, D58).
// Main list: Today, Schedule, Jobs, Money, Inbox (only when the company's
// messaging engine is on, decision D9), Customers, Reports. A
// collapsible Team and office group holds the rest, so every route the
// role allows is in reach. Bottom: Settings, then the signed in person.
//
// Mounted by AppShell only on desktop widths; global.css keeps
// .fh-desktop-sidebar hidden below 900px.

import { useEffect, useMemo, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, Mic, Plus, Search } from 'lucide-react'
import Icon from './fh/Icon.tsx'
import KeyCap from './fh/KeyCap.tsx'
import Monogram, { initialsFor } from './fh/Monogram.tsx'
import OrgSwitcher from './OrgSwitcher.tsx'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { prefetchRoute } from '../lib/routePrefetch.ts'
import { SETTINGS, SIDEBAR_MORE, isActive, sidebarPrimary, type NavItem } from '../lib/navItems.ts'
import { useEngineEnabled } from '../lib/inbox.ts'
import { useNavAccess } from '../lib/useNavAccess.ts'
import { cityLine } from '../lib/companyLine.ts'
import { headerFullName, headerName, profileCompanyIsWorkspace } from '../lib/headerName.ts'
import { openCapture } from '../lib/captureAttach.ts'
import { browserEnv, desktopShortcut } from '../lib/shortcutKeys.ts'

const MORE_KEY = 'fh:sidebar-more-open'

function readMoreOpen(pathname: string) {
  try {
    const stored = localStorage.getItem(MORE_KEY)
    if (stored === '1') return true
    if (stored === '0') return false
  } catch { /* private mode */ }
  // Open by default when the current route lives in the group.
  return SIDEBAR_MORE.some((g) => g.items.some((it) => isActive(it, pathname)))
}

function openPalette() {
  window.dispatchEvent(new CustomEvent('fh:open-palette'))
}

function SidebarLink({ item, pathname, onGo }: { item: NavItem; pathname: string; onGo: (to: string) => void }) {
  const active = isActive(item, pathname)
  return (
    <li>
      <button
        type="button"
        className={`fhs-side__link${active ? ' is-active' : ''}`}
        aria-current={active ? 'page' : undefined}
        // Hover intent warms the lazy route chunk.
        onMouseEnter={() => prefetchRoute(item.to)}
        onFocus={() => prefetchRoute(item.to)}
        onClick={() => onGo(item.to)}
      >
        <Icon icon={item.icon} size={18} />
        <span>{item.label}</span>
      </button>
    </li>
  )
}

export default function DesktopSidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { signOut, user } = useAuth()
  const { profile } = useProfile()
  const { memberships, orgName, isOwner } = useMembership()
  const { canSee, hasCrew } = useNavAccess()
  const engineEnabled = useEngineEnabled()
  const [moreOpen, setMoreOpen] = useState(() => readMoreOpen(pathname))
  // The key caps follow the keyboard in front of the person: ⌘ on a Mac,
  // Ctrl elsewhere. Read once, the browser does not change underneath us.
  const env = useMemo(() => browserEnv(), [])
  const searchKeys = desktopShortcut('K', env)
  const captureKeys = desktopShortcut('J', env)
  const newKeys = desktopShortcut('N', env)

  // Cmd or Ctrl N opens the New screen while the sidebar is mounted, that
  // is, on a desktop. The browser's own new window shortcut gives way.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        navigate('/new')
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  // The short name the phone header shows (headerName): "Parker
  // Construction", not "Parker Constructi..." It wraps to two lines before
  // it is cut, and its title carries the full name (PHASE8_PLAN.md Task 14).
  const company = headerName(orgName, profile?.company_name, profile?.full_name)
  const companyFull = headerFullName(orgName, profile?.company_name, profile?.full_name)
  // The profile is the person's: its city and logo are the company they
  // run, so they stand beside the name only when that company is the
  // workspace shown. In a company someone else owns, its initials.
  const ownCompany = profileCompanyIsWorkspace({
    orgName,
    companyName: profile?.company_name,
    ownsWorkspace: isOwner,
    workspacesOwned: memberships.filter((m) => m.role === 'owner').length
  })
  const city = ownCompany ? cityLine(profile?.company_address) : null
  const logoUrl = ownCompany ? profile?.logo_url : null
  const person = profile?.full_name?.trim() || user?.email || ''

  const primary = sidebarPrimary(engineEnabled).filter((it) => canSee(it.to))
  const more = SIDEBAR_MORE
    .filter((g) => !g.crewOnly || hasCrew)
    .map((g) => ({ ...g, items: g.items.filter((it) => canSee(it.to)) }))
    .filter((g) => g.items.length > 0)

  function go(to: string) {
    const [pathAndSearch, hash = ''] = to.split('#')
    const [path, search = ''] = pathAndSearch.split('?')
    navigate({ pathname: path, search: search ? `?${search}` : '', hash: hash ? `#${hash}` : '' })
  }

  function toggleMore() {
    setMoreOpen((open) => {
      try { localStorage.setItem(MORE_KEY, open ? '0' : '1') } catch { /* private mode */ }
      return !open
    })
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <aside className="fh-desktop-sidebar fhs-side fh-onyx-scope fh-grain" aria-label="Primary navigation">
      <div className="fhs-side__brand">
        <Monogram name={company} logoUrl={logoUrl} size={40} />
        <div className="fhs-side__brand-text">
          <span className="fhs-side__company" title={companyFull}>{company}</span>
          {city && <span className="fhs-side__city">{city}</span>}
        </div>
      </div>

      {/* New and Search share one row, so the nav below still fits a 900 px
          window (SPEC D58). New is a square; the Search cap keeps the row's
          right edge. */}
      <div className="fhs-side__toprow">
        <Link
          to="/new"
          className="fhs-side__new"
          aria-label={`New (${newKeys.spoken})`}
          aria-keyshortcuts={newKeys.combo}
          title={`New (${newKeys.keys})`}
          onMouseEnter={() => prefetchRoute('/new')}
        >
          <Icon icon={Plus} size={18} />
        </Link>
        <button
          type="button"
          className="fhs-side__search"
          onClick={openPalette}
          aria-label={`Search everything (${searchKeys.spoken})`}
          aria-keyshortcuts={searchKeys.combo}
        >
          <Icon icon={Search} size={18} />
          <span>Search</span>
          <KeyCap aria-hidden="true">{searchKeys.keys}</KeyCap>
        </button>
      </div>

      {/* Universal Capture, the same path the dock coin takes. CaptureSheet
          also answers Cmd or Ctrl J and the palette's Capture anything. Its
          key cap lines up under the Search cap, so New sits on the Search
          row (above) rather than beside Capture. */}
      <button
        type="button"
        className="fhs-side__link fhs-side__capture"
        onClick={() => openCapture()}
        aria-label={`Capture (${captureKeys.spoken})`}
        aria-keyshortcuts={captureKeys.combo}
      >
        <Icon icon={Mic} size={18} />
        <span className="fhs-side__capture-label">Capture</span>
        <KeyCap aria-hidden="true">{captureKeys.keys}</KeyCap>
      </button>

      <nav className="fhs-side__nav" aria-label="Primary">
        <ul className="fhs-side__list">
          {primary.map((it) => <SidebarLink key={it.to} item={it} pathname={pathname} onGo={go} />)}
        </ul>

        {more.length > 0 && (
          <div className="fhs-side__more">
            <button
              type="button"
              className="fhs-side__more-toggle"
              aria-expanded={moreOpen}
              aria-controls="fhs-side-more"
              onClick={toggleMore}
            >
              <span>Team and office</span>
              <Icon icon={ChevronDown} size={18} className={`fhs-side__chevron${moreOpen ? ' is-open' : ''}`} />
            </button>
            <div id="fhs-side-more" hidden={!moreOpen}>
              {more.map((g) => (
                <ul key={g.label} className="fhs-side__list fhs-side__list--more" aria-label={g.label}>
                  {g.items.map((it) => <SidebarLink key={it.to} item={it} pathname={pathname} onGo={go} />)}
                </ul>
              ))}
            </div>
          </div>
        )}
      </nav>

      {/* Renders only for people in more than one company. It lives here,
          not only in Settings, because Settings is owner and admin only and
          someone who switches into a crew workspace must be able to switch
          back. */}
      {memberships.length > 1 && (
        <div className="fhs-side__switcher">
          <OrgSwitcher />
        </div>
      )}

      <div className="fhs-side__foot">
        {canSee(SETTINGS.to) && (
          <ul className="fhs-side__list">
            <SidebarLink item={SETTINGS} pathname={pathname} onGo={go} />
          </ul>
        )}
        <div className="fhs-side__person">
          <span className="fhs-side__avatar" aria-hidden="true">{initialsFor(person)}</span>
          <div className="fhs-side__person-text">
            <span className="fhs-side__person-name" title={person}>{person}</span>
            {profile?.full_name && user?.email && <span className="fhs-side__person-email" title={user.email}>{user.email}</span>}
          </div>
          <button type="button" className="fhs-icon-btn fhs-icon-btn--small" onClick={handleSignOut} aria-label="Sign out" title="Sign out">
            <Icon icon={LogOut} size={18} />
          </button>
        </div>
      </div>
    </aside>
  )
}
