import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useLocation, useNavigate } from 'react-router-dom'
import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { ChevronRight, LogOut, X } from 'lucide-react'
import Icon from './fh/Icon.tsx'
import Monogram from './fh/Monogram.tsx'
import ThemeModeControl from './fh/ThemeModeControl.tsx'
import OrgSwitcher from './OrgSwitcher.tsx'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { MENU_GROUPS, isActive } from '../lib/navItems.ts'
import { useNavAccess } from '../lib/useNavAccess.ts'
import { lockDocumentScroll } from '../lib/documentScrollLock.ts'
import { useModalFocus } from '../lib/useModalFocus.ts'

// The workspace menu (spec 8.2): the sheet the company monogram opens
// from the header on every phone screen. It replaces the old More
// drawer and keeps everything it did: the role filter, the crew only
// Team group, the workspace switcher, sign out, the focus trap, the
// scroll lock and closing on navigation. It adds the Auto, Day and
// Night control, since Settings is owner and admin only.
//
// Open it from anywhere with: window.dispatchEvent(new CustomEvent('fh:open-menu'))

export function openWorkspaceMenu() {
  window.dispatchEvent(new CustomEvent('fh:open-menu'))
}

export default function WorkspaceMenu() {
  const [open, setOpen] = useState(false)
  const sheetRef = useRef<HTMLDivElement>(null)
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { signOut, user } = useAuth()
  const { profile } = useProfile()
  const { memberships } = useMembership()
  const { canSee, hasCrew } = useNavAccess()
  const reduceMotion = useReducedMotion()

  useModalFocus(sheetRef, open)

  useEffect(() => {
    const onOpen = () => setOpen(true)
    window.addEventListener('fh:open-menu', onOpen)
    return () => window.removeEventListener('fh:open-menu', onOpen)
  }, [])

  // Close on any navigation, whoever caused it.
  useEffect(() => { setOpen(false) }, [pathname])

  useEffect(() => {
    if (!open) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); setOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    const unlock = lockDocumentScroll()
    return () => {
      window.removeEventListener('keydown', onKey)
      unlock()
    }
  }, [open])

  const groups = MENU_GROUPS
    .filter((g) => !g.crewOnly || hasCrew)
    .map((g) => ({ ...g, items: g.items.filter((it) => canSee(it.to)) }))
    .filter((g) => g.items.length > 0)

  const company = profile?.company_name?.trim() || profile?.full_name?.trim() || 'Your workspace'

  async function handleSignOut() {
    setOpen(false)
    await signOut()
    navigate('/login', { replace: true })
  }

  function go(to: string) {
    const [pathAndSearch, hash = ''] = to.split('#')
    const [path, search = ''] = pathAndSearch.split('?')
    setOpen(false)
    navigate({ pathname: path, search: search ? `?${search}` : '', hash: hash ? `#${hash}` : '' })
  }

  const sheetMotion = reduceMotion
    ? { initial: { opacity: 0 }, animate: { opacity: 1 }, exit: { opacity: 0 } }
    : { initial: { y: '100%' }, animate: { y: 0 }, exit: { y: '100%' } }

  const content = (
    <AnimatePresence>
      {open && (
        <div className="fhs-menu-root">
          <motion.div
            key="scrim"
            className="fhs-menu__scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0, transition: { duration: 0.18 } }}
            transition={{ duration: 0.28 }}
            onClick={() => setOpen(false)}
          />
          <motion.div
            key="sheet"
            ref={sheetRef}
            className="fhs-menu"
            role="dialog"
            aria-modal="true"
            aria-label="Workspace menu"
            {...sheetMotion}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="fhs-menu__grabber" aria-hidden="true" />
            <header className="fhs-menu__head">
              <Monogram name={company} logoUrl={profile?.logo_url} size={48} />
              <div className="fhs-menu__who">
                <span className="fhs-menu__company">{company}</span>
                {user?.email && <span className="fhs-menu__email">{user.email}</span>}
              </div>
              <button type="button" className="fhs-icon-btn" aria-label="Close menu" onClick={() => setOpen(false)}>
                <Icon icon={X} size={22} />
              </button>
            </header>

            <nav className="fhs-menu__body" aria-label="Workspace">
              {groups.map((g) => (
                <section key={g.label} className="fhs-menu__group" aria-labelledby={`fhs-menu-${g.label}`}>
                  <h2 className="fhs-menu__group-title" id={`fhs-menu-${g.label}`}>{g.label}</h2>
                  <ul className="fhs-menu__list">
                    {g.items.map((it) => {
                      const active = isActive(it, pathname)
                      return (
                        <li key={it.to}>
                          <button
                            type="button"
                            className={`fhs-menu__row${active ? ' is-active' : ''}`}
                            aria-current={active ? 'page' : undefined}
                            onClick={() => go(it.to)}
                          >
                            <Icon icon={it.icon} size={22} className="fhs-menu__row-icon" />
                            <span className="fhs-menu__row-label">{it.label}</span>
                            <Icon icon={ChevronRight} size={18} className="fhs-menu__row-chevron" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              ))}

              <section className="fhs-menu__group fhs-menu__group--settings">
                <ThemeModeControl />
                {memberships.length > 1 && (
                  <div className="fhs-menu__switcher">
                    <OrgSwitcher />
                  </div>
                )}
              </section>
            </nav>

            <footer className="fhs-menu__foot">
              <button type="button" className="fhs-menu__signout" onClick={handleSignOut}>
                <Icon icon={LogOut} size={22} />
                Sign out
              </button>
            </footer>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )

  if (typeof document === 'undefined') return null
  return createPortal(content, document.body)
}
