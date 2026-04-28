import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { NavLink, useNavigate } from 'react-router-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { X, Calculator, MessageSquare, BarChart3, Upload, Settings as SettingsIcon, LogOut, ChevronRight, Hammer, Receipt, CloudSun } from 'lucide-react'
import Icon from './icons/Icon.jsx'
import { useAuth } from '../contexts/AuthContext.jsx'

const PRIMARY = [
  { to: '/', label: 'Home', icon: 'home', end: true },
  { to: '/jobs', label: 'Jobs', icon: 'jobs' },
  { to: '/clients', label: 'Clients', icon: 'clients' },
  { to: '/schedule', label: 'Schedule', icon: 'schedule' }
]

/* Command-center grouping — by INTENT, not category. Each item carries
   a one-line caption so the drawer reads as a tour of systems, not a
   list of links. Order: revenue/work first → people → field → system. */
const MORE_GROUPS = [
  {
    label: 'Run Your Business',
    items: [
      { to: '/bid',       label: 'AI Bid Engine', Icon: Calculator, caption: 'Build estimates with AI' },
      { to: '/invoices',  label: 'Invoices',      Icon: Receipt,    caption: 'Send and chase payments' },
      { to: '/analytics', label: 'Analytics',     Icon: BarChart3,  caption: 'Pipeline + revenue trends' }
    ]
  },
  {
    label: 'People & Operations',
    items: [
      { to: '/subs',    label: 'Sub Directory', Icon: Hammer,         caption: 'Subs, trades, contacts' },
      { to: '/compose', label: 'AI Compose',    Icon: MessageSquare,  caption: 'Draft client messages' }
    ]
  },
  {
    label: 'Field & Planning',
    items: [
      { to: '/pour-window', label: 'Forecast', Icon: CloudSun, caption: 'Weather-aware pour windows' }
    ]
  },
  {
    label: 'System',
    items: [
      { to: '/import',   label: 'Import Data', Icon: Upload,       caption: 'Bring in jobs, clients, sheets' },
      { to: '/settings', label: 'Settings',    Icon: SettingsIcon, caption: 'Profile, billing, theme' }
    ]
  }
]

export default function BottomNav() {
  const [moreOpen, setMoreOpen] = useState(false)
  const navigate = useNavigate()
  const { signOut } = useAuth()

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
                  Command Center
                </span>
                <h2 className="v3-h1" style={{ marginTop: 6 }}>
                  Run your <em>company.</em>
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

            {/* BODY — each group as a v3-section, items as system-entry
                tiles. Padding overrides .fh-drawer__body legacy padding;
                explicit top/bottom values keep the first section from
                kissing the header and the last from touching the foot. */}
            <div
              className="fh-drawer__body"
              style={{
                padding: '4px var(--v3-gutter) 18px',
                display: 'flex',
                flexDirection: 'column',
                gap: 16,
                boxSizing: 'border-box'
              }}
            >
              {MORE_GROUPS.map((group, gi) => (
                <section
                  key={group.label}
                  className={gi === 0 ? 'v3-section v3-section--primary' : 'v3-section'}
                >
                  <div className="v3-section-header">
                    <span className="v3-eyebrow" style={gi === 0 ? { color: 'var(--v3-primary)' } : undefined}>
                      {group.label}
                    </span>
                  </div>
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                    {group.items.map((it) => (
                      <SystemEntryTile
                        key={it.to}
                        item={it}
                        emphasized={gi === 0}
                        onTap={() => go(it.to)}
                      />
                    ))}
                  </div>
                </section>
              ))}
            </div>

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
              {/* Theme toggle hidden during the v3 polish phase. Light
                  theme is unfinished and shouldn't be exposed to users
                  until a dedicated light-mode pass lands. Re-render the
                  switch block when ready. */}
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
   SystemEntryTile — single item inside the Command Center drawer.
   Reads as an entry point into a system (large gold icon tile, label,
   one-line caption explaining what it does), not a list row.

     [▤]  AI Bid Engine                                          ›
          Build estimates with AI

   Hover lifts the surface to surface-3 + tints the border + bumps
   the icon halo. Emphasized = stronger gold treatment for the
   "Run Your Business" group.
   ============================================================ */
function SystemEntryTile({ item, emphasized = false, onTap }) {
  const I = item.Icon
  return (
    <motion.button
      type="button"
      onClick={onTap}
      whileTap={{ scale: 0.99 }}
      whileHover={{ y: -1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        padding: '14px 14px',
        borderRadius: 14,
        background: 'var(--v3-surface)',
        border: emphasized
          ? '1px solid color-mix(in srgb, var(--v3-primary) 22%, var(--v3-border-strong))'
          : '1px solid var(--v3-border-strong)',
        color: 'var(--v3-text)',
        textAlign: 'left',
        cursor: 'pointer',
        minHeight: 64,
        WebkitTapHighlightColor: 'transparent',
        boxShadow: emphasized
          ? '0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 4px 14px rgba(0, 0, 0, 0.32), 0 4px 16px rgba(229, 193, 88, 0.10)'
          : '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 4px 14px rgba(0, 0, 0, 0.30)',
        transition: 'border-color 200ms ease, background-color 200ms ease, box-shadow 200ms ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = emphasized
          ? 'color-mix(in srgb, var(--v3-primary) 40%, transparent)'
          : 'rgba(255, 255, 255, 0.20)'
        e.currentTarget.style.background = 'var(--v3-surface-3)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = emphasized
          ? 'color-mix(in srgb, var(--v3-primary) 22%, var(--v3-border-strong))'
          : 'var(--v3-border-strong)'
        e.currentTarget.style.background = 'var(--v3-surface)'
      }}
    >
      {/* Icon tile — big, gold-tinted, premium glass */}
      <span
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: 44,
          height: 44,
          borderRadius: 12,
          display: 'grid',
          placeItems: 'center',
          background: emphasized
            ? 'linear-gradient(135deg, rgba(229, 193, 88, 0.22), rgba(229, 193, 88, 0.06))'
            : 'var(--v3-primary-soft)',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 35%, transparent)',
          color: 'var(--v3-primary)',
          boxShadow: emphasized
            ? 'inset 0 1px 0 rgba(255, 255, 255, 0.10), 0 4px 12px rgba(229, 193, 88, 0.18)'
            : 'inset 0 1px 0 rgba(255, 255, 255, 0.06)'
        }}
      >
        <I size={20} />
      </span>

      {/* Label + caption stack */}
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontFamily: 'var(--font-body)',
            fontSize: 15,
            fontWeight: 600,
            color: 'var(--v3-text)',
            letterSpacing: '-0.005em',
            lineHeight: 1.25
          }}
        >
          {item.label}
        </div>
        {item.caption ? (
          <div
            style={{
              marginTop: 3,
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              fontWeight: 400,
              color: 'var(--v3-text-muted)',
              lineHeight: 1.35
            }}
          >
            {item.caption}
          </div>
        ) : null}
      </div>

      <ChevronRight size={16} color="var(--v3-text-muted)" style={{ flexShrink: 0 }} />
    </motion.button>
  )
}
