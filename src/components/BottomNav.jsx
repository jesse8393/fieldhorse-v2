import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Calculator, MessageSquare, BarChart3, Upload, Settings as SettingsIcon, LogOut, ChevronRight, Hammer, Receipt, CloudSun, Moon, Sun, Home as HomeIcon, Briefcase, Users, Calendar } from 'lucide-react'
import Icon from './icons/Icon.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useTheme } from '../contexts/ThemeContext.jsx'

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
  const { signOut, user } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const userEmail = user?.email || ''

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
            {/* HEADER — small FH wordmark + close. Was an h1 + eyebrow
                that ate too much vertical space; the drawer is for
                navigation, not branding. */}
            <header
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 10,
                padding: '4px 18px 12px'
              }}
            >
              {/* V3-SYSTEM-1A: drawer is for navigation, not branding —
                  demote the gold "FIELD" so it reads as a quiet header,
                  not a screaming wordmark. Both halves now muted text. */}
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'baseline',
                  gap: 0,
                  fontFamily: 'var(--font-display)',
                  fontSize: 16,
                  letterSpacing: '0.14em',
                  lineHeight: 1,
                  color: 'var(--v3-text-muted)'
                }}
              >
                <span>FIELD</span>
                <span>HORSE</span>
              </span>
              <button
                type="button"
                onClick={() => setMoreOpen(false)}
                aria-label="Close"
                style={{
                  flexShrink: 0,
                  width: 32,
                  height: 32,
                  borderRadius: 999,
                  border: '1px solid var(--v3-border-strong)',
                  background: 'transparent',
                  color: 'var(--v3-text-muted)',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent'
                }}
              >
                <X size={14} />
              </button>
            </header>

            {/* BODY — flat nav list. Tighter rows, no per-row dividers.
                Spacing alone separates items. */}
            <nav
              style={{
                flex: 1,
                overflowY: 'auto',
                padding: '4px 10px 12px',
                display: 'flex',
                flexDirection: 'column',
                gap: 0,
                boxSizing: 'border-box'
              }}
              aria-label="Navigation"
            >
              {NAV_ITEMS.map((it) => (
                <NavRow key={it.to} item={it} onTap={() => go(it.to)} />
              ))}
            </nav>

            {/* ACCOUNT BLOCK — single inline row at the bottom.
                email · theme toggle (icon button) · sign out (icon button)
                Replaces the prior bulky two-card foot. */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 18px calc(14px + env(safe-area-inset-bottom, 0px))',
                borderTop: '1px solid var(--v3-border)',
                background: 'transparent'
              }}
            >
              <div
                style={{
                  flex: 1,
                  minWidth: 0,
                  display: 'flex',
                  flexDirection: 'column',
                  gap: 2
                }}
              >
                <span
                  className="v3-eyebrow"
                  style={{ color: 'var(--v3-text-muted)' }}
                >
                  Account
                </span>
                {userEmail && (
                  <span
                    style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 13,
                      fontWeight: 600,
                      color: 'var(--v3-text)',
                      whiteSpace: 'nowrap',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis'
                    }}
                  >
                    {userEmail}
                  </span>
                )}
              </div>

              <button
                type="button"
                onClick={() => toggleTheme()}
                aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
                style={{
                  flexShrink: 0,
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  border: '1px solid var(--v3-border-strong)',
                  background: 'var(--v3-surface)',
                  color: 'var(--v3-primary)',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent'
                }}
              >
                {theme === 'dark' ? <Moon size={15} /> : <Sun size={15} />}
              </button>

              <button
                type="button"
                onClick={handleSignOut}
                aria-label="Sign out"
                title="Sign out"
                style={{
                  flexShrink: 0,
                  width: 36,
                  height: 36,
                  borderRadius: 999,
                  border: '1px solid var(--v3-border-strong)',
                  background: 'var(--v3-surface)',
                  color: 'var(--v3-text-muted)',
                  display: 'grid',
                  placeItems: 'center',
                  cursor: 'pointer',
                  WebkitTapHighlightColor: 'transparent',
                  transition: 'color 140ms ease, border-color 140ms ease'
                }}
                onMouseEnter={(e) => {
                  e.currentTarget.style.color = 'var(--v3-danger-bright)'
                  e.currentTarget.style.borderColor = 'color-mix(in srgb, var(--v3-danger) 50%, transparent)'
                }}
                onMouseLeave={(e) => {
                  e.currentTarget.style.color = 'var(--v3-text-muted)'
                  e.currentTarget.style.borderColor = 'var(--v3-border-strong)'
                }}
              >
                <LogOut size={15} />
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
                  <Icon name={item.icon} size={20} />
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
            <Icon name="more" size={20} />
          </span>
          <span className="fh-nav__label">More</span>
        </button>
      </nav>

      {typeof document !== 'undefined' && createPortal(drawer, document.body)}
    </>
  )
}

/* ============================================================
   NavRow — premium navigation row.
   Tight 44px row, 28px gold icon tile, label, chevron.
   Hover paints a rounded surface-2 wash so the whole row reads
   as a tappable target. No per-row dividers — spacing alone
   separates items in the new compact drawer.
   ============================================================ */
function NavRow({ item, onTap }) {
  const I = item.Icon
  return (
    <button
      type="button"
      onClick={onTap}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '8px 10px',
        background: 'transparent',
        border: 'none',
        borderRadius: 10,
        color: 'var(--v3-text)',
        textAlign: 'left',
        cursor: 'pointer',
        minHeight: 44,
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
      {/* V3-SYSTEM-1A: row icon chips demoted from gold default to a
          neutral surface-2 chip with muted icon. Gold belongs to the
          active route (handled in the primary nav, .fh-nav__item.is-active),
          not to every drawer row. Active-state highlight in this drawer
          is a future polish item; for now all rows read as quiet nav. */}
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 28,
          height: 28,
          borderRadius: 8,
          display: 'grid',
          placeItems: 'center',
          background: 'var(--v3-surface-2)',
          border: '1px solid var(--v3-border)',
          color: 'var(--v3-text-muted)'
        }}
      >
        <I size={14} />
      </span>
      <span style={{
        flex: 1,
        fontFamily: 'var(--font-body)',
        fontSize: 14,
        fontWeight: 500,
        color: 'var(--v3-text)',
        letterSpacing: '-0.005em'
      }}>
        {item.label}
      </span>
      <ChevronRight size={14} color="var(--v3-text-muted)" style={{ flexShrink: 0 }} />
    </button>
  )
}
