// DesktopSidebar, the onyx rail at 900px and up (spec 8.3).
//
// Top: the company monogram, name and city, then search with ⌘K.
// Main list: Today, Schedule, Jobs, Money, Inbox (only when the company's
// messaging engine is on, decision D9), Customers, Reports. A
// collapsible Team and office group holds the rest, so every route the
// role allows is in reach. Bottom: Settings, then the signed in person.
//
// Mounted by AppShell only on desktop widths; global.css keeps
// .fh-desktop-sidebar hidden below 900px.

import { useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronDown, LogOut, Search } from 'lucide-react'
import Icon from './fh/Icon.tsx'
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
  const { memberships } = useMembership()
  const { canSee, hasCrew } = useNavAccess()
  const engineEnabled = useEngineEnabled()
  const [moreOpen, setMoreOpen] = useState(() => readMoreOpen(pathname))

  const company = profile?.company_name?.trim() || profile?.full_name?.trim() || 'Your workspace'
  const city = cityLine(profile?.company_address)
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
        <Monogram name={company} logoUrl={profile?.logo_url} size={40} />
        <div className="fhs-side__brand-text">
          <span className="fhs-side__company">{company}</span>
          {city && <span className="fhs-side__city">{city}</span>}
        </div>
      </div>

      <button type="button" className="fhs-side__search" onClick={openPalette} aria-label="Search everything (⌘K)">
        <Icon icon={Search} size={18} />
        <span>Search</span>
        <kbd className="fhs-side__kbd">⌘K</kbd>
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
