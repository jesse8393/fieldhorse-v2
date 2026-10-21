import { Plus, Search } from 'lucide-react'
import { Link } from 'react-router-dom'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { headerName } from '../lib/headerName.ts'
import Icon from './fh/Icon.tsx'
import Monogram from './fh/Monogram.tsx'
import NotificationsBell from './NotificationsBell.tsx'

// Single entry point for search. CommandPalette opens at 900px and up; below
// it the app shell takes the same event to the /search screen (D57).
function openSearch() {
  window.dispatchEvent(new CustomEvent('fh:open-palette'))
}

// The workspace menu is the screen /workspace (D57); the shell navigates.
function openWorkspaceMenu() {
  window.dispatchEvent(new CustomEvent('fh:open-menu'))
}

/**
 * AppHeader, the shared top bar (spec 8.2, decision D4).
 *
 * Phone: the company monogram on the left opens the workspace screen, the
 * company name sits beside it, and search and the bell are on the right.
 * The menu is in the same place on every screen, so every route is two
 * taps away and search is one.
 *
 * The name is the short one (headerName): the workspace name, without
 * a trailing "Company" or "LLC". Long names wrap to two lines at 15 px
 * before anything is cut off.
 *
 * Desktop: the sidebar carries identity and navigation, so only New,
 * search and the bell show, at the right.
 */
export default function AppHeader() {
  const { profile } = useProfile()
  const { orgName } = useMembership()
  const company = headerName(orgName, profile?.company_name, profile?.full_name)
  // About as many characters as fit on one line at 17 px beside the
  // monogram and the two icons on a 390 px phone.
  const long = company.length > 20

  return (
    <header className="fh-app-header fhs-header">
      <button
        type="button"
        className="fhs-header__menu"
        aria-label="Open workspace menu"
        onClick={openWorkspaceMenu}
      >
        <Monogram name={company} logoUrl={profile?.logo_url} size={40} />
      </button>
      <span className={`fhs-header__company${long ? ' fhs-header__company--long' : ''}`}>{company}</span>
      <div className="fhs-header__actions">
        {/* One New button (D58): the full screen with Lead, Quote, Job,
            Invoice and Client. The long press menu on the dock coin is gone. */}
        <Link to="/new" className="fhs-icon-btn" aria-label="New" title="New">
          <Icon icon={Plus} size={22} />
        </Link>
        <button type="button" className="fhs-icon-btn" aria-label="Search everything" onClick={openSearch}>
          <Icon icon={Search} size={22} />
        </button>
        <NotificationsBell />
      </div>
    </header>
  )
}
