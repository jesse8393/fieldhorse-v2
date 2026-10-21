// The workspace screen, /workspace (spec 8.2; Phase 9, Task 14, D57). The
// header monogram opens it on every phone screen. It took the place of
// the workspace menu sheet and keeps everything it did: the role filter,
// the crew only Team group, the workspace switcher, sign out and the
// Auto, Day and Night control (Settings is owner and admin only). Every
// route is still two taps away: the monogram, then the row.
//
// Open it from anywhere with: window.dispatchEvent(new CustomEvent('fh:open-menu'))

import { useEffect, useRef } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { ChevronLeft, ChevronRight, LogOut } from 'lucide-react'
import Icon from '../components/fh/Icon.tsx'
import IconButton from '../components/fh/IconButton.tsx'
import Monogram from '../components/fh/Monogram.tsx'
import ThemeModeControl from '../components/fh/ThemeModeControl.tsx'
import OrgSwitcher from '../components/OrgSwitcher.tsx'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { MENU_GROUPS, isActive } from '../lib/navItems.ts'
import { useNavAccess } from '../lib/useNavAccess.ts'
import { hapticTap } from '../lib/haptics.ts'
import './workspace.css'

export default function Workspace() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { signOut, user } = useAuth()
  const { profile } = useProfile()
  const { memberships } = useMembership()
  const { canSee, hasCrew } = useNavAccess()
  const titleRef = useRef<HTMLHeadingElement>(null)

  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])

  const groups = MENU_GROUPS
    .filter((g) => !g.crewOnly || hasCrew)
    .map((g) => ({ ...g, items: g.items.filter((it) => canSee(it.to)) }))
    .filter((g) => g.items.length > 0)

  const company = profile?.company_name?.trim() || profile?.full_name?.trim() || 'Your workspace'

  // Back to the screen the monogram was tapped on.
  function goBack() {
    hapticTap()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/', { replace: true })
  }

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  function go(to: string) {
    const [pathAndSearch, hash = ''] = to.split('#')
    const [path, search = ''] = pathAndSearch.split('?')
    // The screen the row opens takes this one's place in history, so Back
    // from there returns to the page the menu was opened on.
    navigate({ pathname: path, search: search ? `?${search}` : '', hash: hash ? `#${hash}` : '' }, { replace: true })
  }

  return (
    <div className="fhws">
      <header className="fhws-head">
        <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
        <h1 className="fhws-title" ref={titleRef} tabIndex={-1}>Workspace</h1>
      </header>

      <div className="fhws-who">
        <Monogram name={company} logoUrl={profile?.logo_url} size={48} />
        <div className="fhws-who__text">
          <span className="fhws-who__company">{company}</span>
          {user?.email && <span className="fhws-who__email">{user.email}</span>}
        </div>
      </div>

      <nav className="fhws-body" aria-label="Workspace">
        {groups.map((g) => (
          <section key={g.label} className="fhws-group" aria-labelledby={`fhws-${g.label}`}>
            <h2 className="fhws-group__title" id={`fhws-${g.label}`}>{g.label}</h2>
            <ul className="fhws-list">
              {g.items.map((it) => {
                const active = isActive(it, pathname)
                return (
                  <li key={it.to}>
                    <button
                      type="button"
                      className={`fhws-row${active ? ' is-active' : ''}`}
                      aria-current={active ? 'page' : undefined}
                      onClick={() => { hapticTap(); go(it.to) }}
                    >
                      <Icon icon={it.icon} size={22} className="fhws-row__icon" />
                      <span className="fhws-row__label">{it.label}</span>
                      <Icon icon={ChevronRight} size={18} className="fhws-row__chevron" />
                    </button>
                  </li>
                )
              })}
            </ul>
          </section>
        ))}

        <section className="fhws-group fhws-group--settings">
          <ThemeModeControl />
          {memberships.length > 1 && (
            <div className="fhws-switcher">
              <OrgSwitcher />
            </div>
          )}
        </section>
      </nav>

      <footer className="fhws-foot">
        <button type="button" className="fhws-signout" onClick={handleSignOut}>
          <Icon icon={LogOut} size={22} />
          Sign out
        </button>
      </footer>
    </div>
  )
}
