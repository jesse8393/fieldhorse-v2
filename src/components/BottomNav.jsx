import { useState } from 'react'
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

const MORE_ITEMS = [
  { to: '/bid', label: 'AI Bid Engine', icon: 'bid' },
  { to: '/compose', label: 'AI Compose', icon: 'compose' },
  { to: '/analytics', label: 'Analytics', icon: 'analytics' },
  { to: '/import', label: 'Import Data', icon: 'upload' },
  { to: '/settings', label: 'Settings', icon: 'settings' }
]

export default function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false)
  const navigate = useNavigate()
  const { signOut } = useAuth()
  const { theme, toggleTheme } = useTheme()

  async function handleSignOut() {
    setMoreOpen(false)
    await signOut()
    navigate('/login', { replace: true })
  }

  function go(to) {
    setMoreOpen(false)
    navigate(to)
  }

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

      <AnimatePresence>
        {moreOpen && (
          <>
            <motion.div
              key="scrim"
              className="fh-scrim"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.18 }}
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
              aria-label="More"
            >
              <div className="fh-drawer__grip" aria-hidden="true" />
              <header className="fh-drawer__head">
                <span className="fh-eye">More tools</span>
                <button
                  type="button"
                  className="fh-drawer__close"
                  onClick={() => setMoreOpen(false)}
                  aria-label="Close"
                >
                  <Icon name="x" size={20} />
                </button>
              </header>
              <div className="fh-drawer__grid">
                {MORE_ITEMS.map((it) => (
                  <button
                    key={it.to}
                    type="button"
                    className="fh-drawer__tile"
                    onClick={() => go(it.to)}
                  >
                    <span className="fh-drawer__tile-icon">
                      <Icon name={it.icon} size={22} />
                    </span>
                    <span className="fh-drawer__tile-label">{it.label}</span>
                    <Icon name="chevron" size={16} />
                  </button>
                ))}
              </div>
              <div className="fh-drawer__row">
                <button type="button" className="fh-drawer__linkbtn" onClick={toggleTheme}>
                  <Icon name={theme === 'dark' ? 'sun' : 'cloud'} size={18} />
                  <span>{theme === 'dark' ? 'Light theme' : 'Dark theme'}</span>
                </button>
                <button type="button" className="fh-drawer__linkbtn fh-drawer__linkbtn--danger" onClick={handleSignOut}>
                  <Icon name="logout" size={18} />
                  <span>Sign out</span>
                </button>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  )
}
