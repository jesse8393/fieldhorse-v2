import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from './icons/Icon.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useTheme } from '../contexts/ThemeContext.jsx'

const PRIMARY = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/jobs', label: 'Jobs', icon: 'jobs' },
  { to: '/notes', label: 'Notes', icon: 'notes' },
  { to: '/schedule', label: 'Schedule', icon: 'schedule' }
]

const MORE_GROUPS = [
  {
    label: 'Money tools',
    items: [
      { to: '/bid', label: 'AI Bid Engine', icon: 'bid' },
      { to: '/compose', label: 'AI Compose', icon: 'compose' },
      { to: '/analytics', label: 'Analytics', icon: 'analytics' }
    ]
  },
  {
    label: 'Data',
    items: [
      { to: '/import', label: 'Import Data', icon: 'upload' }
    ]
  },
  {
    label: 'App',
    items: [
      { to: '/settings', label: 'Settings', icon: 'settings' }
    ]
  }
]

export default function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false)
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()

  // Lock body scroll and listen for Escape while drawer is open
  useEffect(() => {
    if (!moreOpen) return
    function onKey(e) {
      if (e.key === 'Escape') { e.preventDefault(); setMoreOpen(false) }
    }
    window.addEventListener('keydown', onKey)
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      window.removeEventListener('keydown', onKey)
      document.body.style.overflow = prev
    }
  }, [moreOpen])

  async function handleSignOut() {
    setMoreOpen(false)
    await signOut()
    navigate('/login', { replace: true })
  }

  function go(to) {
    setMoreOpen(false)
    navigate(to)
  }

  const drawer = (
    <AnimatePresence>
      {moreOpen && (
        <div className="fh-drawer-root">
          <motion.div
            key="scrim"
            className="fh-drawer__scrim"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.24 }}
            onClick={() => setMoreOpen(false)}
          />
          <motion.div
            key="drawer"
            className="fh-drawer"
            initial={{ y: '100%' }}
            animate={{ y: 0 }}
            exit={{ y: '100%' }}
            transition={{ type: 'spring', stiffness: 380, damping: 36 }}
            role="dialog"
            aria-modal="true"
            aria-label="More tools"
          >
            <div className="fh-drawer__grip" aria-hidden="true" />
            <header className="fh-drawer__head">
              <h2
                className="fh-drawer__heading"
                style={{ margin: 0 }}
              >
                CLAUDE TOOLS
              </h2>
              <button
                type="button"
                className="fh-drawer__close"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
              >
                <Icon name="x" size={18} />
              </button>
            </header>

            <div className="fh-drawer__body">
              {MORE_GROUPS.map((group) => (
                <section key={group.label} className="fh-drawer__group">
                  <div className="fh-drawer__section-label">{group.label}</div>
                  <div className="fh-drawer__grid">
                    {group.items.map((it) => (
                      <button
                        key={it.to}
                        type="button"
                        className="fh-drawer__tile"
                        onClick={() => go(it.to)}
                      >
                        <span className="fh-drawer__tile-icon">
                          <Icon name={it.icon} size={20} />
                        </span>
                        <span className="fh-drawer__tile-label">{it.label}</span>
                        <Icon name="chevron" size={14} />
                      </button>
                    ))}
                  </div>
                </section>
              ))}
            </div>

            <div className="fh-drawer__foot">
              <button type="button" className="fh-drawer__theme" onClick={toggleTheme}>
                <Icon name={theme === 'dark' ? 'sun' : 'moon'} size={16} />
                <span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
              </button>
              <button type="button" className="fh-drawer__signout" onClick={handleSignOut}>
                <Icon name="logout" size={16} />
                <span>Sign out</span>
              </button>
            </div>
          </motion.div>
        </div>
      )}
    </AnimatePresence>
  )

  return (
    <>
      <nav className="fh-nav" aria-label="Primary">
        {PRIMARY.map((item) => (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `fh-nav__item${isActive ? ' is-active' : ''}`}
          >
            {({ isActive }) => (
              <>
                <span className="fh-nav__icon">
                  <Icon name={item.icon} size={22} />
                </span>
                <span className="fh-nav__label">{item.label}</span>
                {isActive && (
                  <motion.span
                    layoutId="fh-nav-dot"
                    className="fh-nav__dot"
                    transition={{ type: 'spring', stiffness: 380, damping: 30 }}
                  />
                )}
              </>
            )}
          </NavLink>
        ))}
        <button
          type="button"
          className={`fh-nav__item${moreOpen ? ' is-active' : ''}`}
          onClick={() => setMoreOpen((v) => !v)}
          aria-expanded={moreOpen}
        >
          <span className="fh-nav__icon">
            <Icon name="more" size={22} />
          </span>
          <span className="fh-nav__label">More</span>
        </button>
      </nav>

      {typeof document !== 'undefined' && createPortal(drawer, document.body)}
    </>
  )
}
