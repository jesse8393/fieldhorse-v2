import { Search } from 'lucide-react'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { headerName } from '../lib/headerName.ts'
import Icon from './fh/Icon.tsx'
import Monogram from './fh/Monogram.tsx'
import NotificationsBell from './NotificationsBell.tsx'
import { openWorkspaceMenu } from './WorkspaceMenu.tsx'

// Single entry point for search. CommandPalette opens at 900px and up,
// MobileSearchOverlay below it; both listen for fh:open-palette and gate
// themselves, so only one ever opens.
function openSearch() {
  window.dispatchEvent(new CustomEvent('fh:open-palette'))
}

/**
 * AppHeader, the shared top bar (spec 8.2, decision D4).
 *
 * Phone: the company monogram on the left opens the workspace menu, the
 * company name sits beside it, and search and the bell are on the right.
 * The menu is in the same place on every screen, so every route is two
 * taps away and search is one.
 *
 * The name is the short one (headerName): the workspace name, without
 * a trailing "Company" or "LLC". Long names wrap to two lines at 15 px
 * before anything is cut off.
 *
 * Desktop: the sidebar carries identity and navigation, so only search
 * and the bell show, at the right.
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
        aria-haspopup="dialog"
        onClick={openWorkspaceMenu}
      >
        <Monogram name={company} logoUrl={profile?.logo_url} size={40} />
      </button>
      <span className={`fhs-header__company${long ? ' fhs-header__company--long' : ''}`}>{company}</span>
      <div className="fhs-header__actions">
        <button type="button" className="fhs-icon-btn" aria-label="Search everything" onClick={openSearch}>
          <Icon icon={Search} size={22} />
        </button>
        <NotificationsBell />
      </div>
    </header>
  )
}
