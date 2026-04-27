import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Calculator, MessageSquare, BarChart3, Upload, Settings as SettingsIcon, LogOut, ChevronRight, Moon, Sun, Hammer, Receipt, CloudSun } from 'lucide-react'
import Icon from './icons/Icon.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useTheme } from '../contexts/ThemeContext.jsx'
import { Switch } from '@/components/ui/switch'

const PRIMARY = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/jobs', label: 'Jobs', icon: 'jobs' },
  { to: '/clients', label: 'Clients', icon: 'clients' },
  { to: '/schedule', label: 'Schedule', icon: 'schedule' }
]

const MORE_GROUPS = [
  {
    label: 'Money tools',
    items: [
      { to: '/bid', label: 'AI Bid Engine', Icon: Calculator },
      { to: '/invoices', label: 'Invoices', Icon: Receipt },
      { to: '/compose', label: 'AI Compose', Icon: MessageSquare },
      { to: '/analytics', label: 'Analytics', Icon: BarChart3 }
    ]
  },
  {
    label: 'People',
    items: [
      { to: '/subs', label: 'Sub directory', Icon: Hammer }
    ]
  },
  {
    label: 'Field',
    items: [
      // Forecast was unreachable from the nav — only entry was the
      // weather card on Home. Surface it here so it's discoverable
      // from any screen.
      { to: '/pour-window', label: 'Forecast', Icon: CloudSun }
    ]
  },
  {
    label: 'Data',
    items: [
      { to: '/import', label: 'Import Data', Icon: Upload }
    ]
  },
  {
    label: 'App',
    items: [
      { to: '/settings', label: 'Settings', Icon: SettingsIcon }
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
            <header className="fh-drawer__head" style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 10, padding: '4px 20px 16px' }}>
              <div style={{ minWidth: 0, flex: 1 }}>
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
                  Shortcuts
                </span>
                <h2
                  className="fh-font-serif"
                  style={{ margin: '4px 0 0', fontSize: 'clamp(22px, 6vw, 28px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
                >
                  More{' '}
                  <em className="fh-font-serif-italic fh-text-gradient-gold">tools.</em>
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                style={{ flexShrink: 0, width: 32, height: 32, borderRadius: 10, border: '1px solid var(--rule)', background: 'var(--surface-2)', color: 'var(--ink-strong)', display: 'grid', placeItems: 'center', cursor: 'pointer' }}
              >
                <X size={16} />
              </button>
            </header>

            <div className="fh-drawer__body" style={{ padding: '0 20px', display: 'flex', flexDirection: 'column', gap: 18 }}>
              {MORE_GROUPS.map((group) => (
                <section key={group.label}>
                  <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: 8 }}>
                    {group.label}
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    {group.items.map((it) => {
                      const I = it.Icon
                      return (
                        <button
                          key={it.to}
                          type="button"
                          onClick={() => go(it.to)}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 12,
                            padding: '12px 14px',
                            borderRadius: 12,
                            background: 'var(--surface-2)',
                            border: '1px solid var(--rule)',
                            color: 'var(--ink-strong)',
                            fontFamily: 'var(--font-body)',
                            fontSize: 14,
                            fontWeight: 600,
                            cursor: 'pointer',
                            textAlign: 'left',
                            minHeight: 44,
                            width: '100%'
                          }}
                        >
                          <span
                            aria-hidden="true"
                            style={{ flexShrink: 0, width: 34, height: 34, borderRadius: 10, display: 'grid', placeItems: 'center', background: 'rgba(201,150,58,0.12)', border: '1px solid rgba(201,150,58,0.3)', color: 'var(--field-gold-bright)' }}
                          >
                            <I size={16} />
                          </span>
                          <span style={{ flex: 1 }}>{it.label}</span>
                          <ChevronRight size={14} color="var(--ink-faint)" />
                        </button>
                      )
                    })}
                  </div>
                </section>
              ))}
            </div>

            <div className="fh-drawer__foot" style={{ padding: '18px 20px 24px', display: 'flex', flexDirection: 'column', gap: 10 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 14px', borderRadius: 12, background: 'var(--surface-2)', border: '1px solid var(--rule)' }}>
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600 }}>
                  {theme === 'dark' ? <Moon size={16} color="var(--field-gold-bright)" /> : <Sun size={16} color="var(--field-gold-bright)" />}
                  {theme === 'dark' ? 'Dark theme' : 'Light theme'}
                </span>
                <Switch
                  checked={theme === 'dark'}
                  onCheckedChange={() => toggleTheme()}
                  aria-label="Toggle dark theme"
                />
              </div>
              <motion.button
                type="button"
                whileTap={{ scale: 0.97 }}
                onClick={handleSignOut}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  gap: 8,
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'rgba(192,57,43,0.12)',
                  border: '1px solid rgba(192,57,43,0.35)',
                  color: 'var(--alert-red)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                minHeight: 44
                }}
              >
                <LogOut size={16} />
                Sign out
              </motion.button>
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
