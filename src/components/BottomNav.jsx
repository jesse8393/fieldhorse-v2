import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Calculator, MessageSquare, BarChart3, Upload, Settings as SettingsIcon, LogOut, ChevronRight, Hammer, Receipt, CloudSun, Moon, Sun, Home as HomeIcon, Briefcase, Users, Calendar } from 'lucide-react'
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

/* Flat navigation list per v3 mockup — reads as a clean nav drawer,
   not stacked group cards. Order matches mockup primary nav. Items
   pointing to non-existent routes (Files & Documents, Team, Help)
   are intentionally omitted; reintroduce them when those routes ship. */
const NAV_ITEMS = [
  { to: '/',            label: 'Dashboard',           Icon: HomeIcon },
  { to: '/jobs',        label: 'Jobs & Pipeline',     Icon: Briefcase },
  { to: '/clients',     label: 'Clients',             Icon: Users },
  { to: '/schedule',    label: 'Schedule',            Icon: Calendar },
  { to: '/bid',         label: 'Estimates',           Icon: Calculator },
  { to: '/invoices',    label: 'Invoices & Payments', Icon: Receipt },
  { to: '/analytics',   label: 'Reports & Insights',  Icon: BarChart3 },
  { to: '/subs',        label: 'Sub Directory',       Icon: Hammer },
  { to: '/compose',     label: 'AI Compose',          Icon: MessageSquare },
  { to: '/import',      label: 'Import Data',         Icon: Upload },
  { to: '/pour-window', label: 'Forecast',            Icon: CloudSun },
  { to: '/settings',    label: 'Settings',            Icon: SettingsIcon }
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
            {/* HEADER — Command Center identity */}
            <header
              className="fh-drawer__head"
              style={{
                display: 'flex',
                alignItems: 'flex-end',
                justifyContent: 'space-between',
                gap: 10,
                padding: '6px 20px 18px'
              }}
            >
              <div style={{ minWidth: 0, flex: 1 }}>
                <span className="v3-eyebrow" style={{ color: 'var(--v3-primary)' }}>
                  Navigation
                </span>
                <h2 className="v3-h1" style={{ marginTop: 6 }}>
                  Field<em>horse.</em>
                </h2>
              </div>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                style={{
                  flexShrink: 0,
                  width: 36,
                  height: 36,
                  borderRadius: 10,
                  border: '1px solid var(--v3-border-strong)',
                  background: 'var(--v3-surface-2)',
                  color: 'var(--v3-text)',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent'
                }}
              >
                <X size={16} />
              </button>
            </header>

            {/* BODY — flat nav list per v3 mockup. One row per
                destination, hairline separators, no stacked cards. */}
            <nav
              className="fh-drawer__body"
              style={{
                padding: '4px var(--v3-gutter) 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 0,
                boxSizing: 'border-box'
              }}
              aria-label="Navigation"
            >
              {NAV_ITEMS.map((it, i) => (
                <NavRow
                  key={it.to}
                  item={it}
                  onTap={() => go(it.to)}
                  showDivider={i < NAV_ITEMS.length - 1}
                />
              ))}
            </nav>

            {/* FOOT — theme + sign out, v3 surfaces */}
            <div
              className="fh-drawer__foot"
              style={{
                padding: '18px var(--v3-gutter) 24px',
                display: 'flex',
                flexDirection: 'column',
                gap: 10
              }}
            >
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  padding: '14px 16px',
                  borderRadius: 14,
                  background: 'var(--v3-surface-2)',
                  border: '1px solid var(--v3-border-strong)',
                  boxShadow: '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 4px 12px rgba(0, 0, 0, 0.18)'
                }}
              >
                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 10, color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600 }}>
                  {theme === 'dark' ? <Moon size={16} color="var(--v3-primary)" /> : <Sun size={16} color="var(--v3-primary)" />}
                  {theme === 'dark' ? 'Dark theme' : 'Light theme'}
                </span>
                <Switch
                  checked={theme === 'dark'}
                  onCheckedChange={() => toggleTheme()}
                  aria-label="Toggle theme"
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
                  padding: '14px 16px',
                  borderRadius: 14,
                  background: 'var(--v3-danger-soft)',
                  border: '1px solid color-mix(in srgb, var(--v3-danger) 40%, transparent)',
                  color: 'var(--v3-danger-bright)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 14,
                  fontWeight: 700,
                  cursor: 'pointer',
                  minHeight: 48,
                  WebkitTapHighlightColor: 'transparent'
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

/* ============================================================
   NavRow — single line in the flat navigation drawer.
   Per v3 mockup: gold icon, label, chevron, hairline divider.
   No card chrome, no caption, no per-item border — the whole
   list reads as a clean nav, not stacked tiles.
   ============================================================ */
function NavRow({ item, onTap, showDivider }) {
  const I = item.Icon
  return (
    <button
      type="button"
      onClick={onTap}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        padding: '14px 4px',
        background: 'transparent',
        border: 'none',
        borderBottom: showDivider ? '1px solid var(--v3-border)' : 'none',
        color: 'var(--v3-text)',
        textAlign: 'left',
        cursor: 'pointer',
        minHeight: 56,
        WebkitTapHighlightColor: 'transparent',
        transition: 'background-color 140ms ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.background = 'var(--v3-surface-2)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.background = 'transparent'
      }}
    >
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 32,
          height: 32,
          borderRadius: 8,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--v3-primary-soft)',
          color: 'var(--v3-primary)'
        }}
      >
        <I size={16} />
      </span>
      <span style={{
        flex: 1,
        fontFamily: 'var(--font-body)',
        fontSize: 15,
        fontWeight: 500,
        color: 'var(--v3-text)',
        letterSpacing: '-0.005em'
      }}>
        {item.label}
      </span>
      <ChevronRight size={16} color="var(--v3-text-muted)" style={{ flexShrink: 0 }} />
    </button>
  )
}
