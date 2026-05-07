import { NavLink, useNavigate } from 'react-router-dom'
import {
  Home as HomeIcon,
  Briefcase,
  Users,
  Calendar,
  Calculator,
  Receipt,
  BarChart3,
  Hammer,
  MessageSquare,
  Upload,
  CloudSun,
  Settings as SettingsIcon,
  Moon,
  Sun,
  LogOut
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useTheme } from '../contexts/ThemeContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'

/**
 * DesktopSidebar — Phase 1 of the Responsive Desktop Command Center.
 *
 * Visible only at >=900px (CSS-controlled via .fh-desktop-sidebar in
 * global.css). At narrow widths the existing BottomNav remains the
 * navigation surface and this sidebar is display:none, so the mobile
 * experience is unchanged.
 *
 * Mirrors the NAV_ITEMS roster from BottomNav's drawer so the desktop
 * surface offers the same destinations without forcing the user into
 * a "More" affordance — sidebar = persistent nav, drawer was a phone
 * compromise.
 *
 * Sidebar is position:fixed; left:0; top:0; bottom:0 with width 240px.
 * AppShell pads .fh-app__main left by the same width on desktop so
 * content never sits underneath the rail.
 */

const PRIMARY_NAV = [
  { to: '/',            label: 'Home',          Icon: HomeIcon,        end: true },
  { to: '/jobs',        label: 'Jobs',          Icon: Briefcase },
  { to: '/clients',     label: 'Clients',       Icon: Users },
  { to: '/schedule',    label: 'Schedule',      Icon: Calendar }
]

const SECONDARY_NAV = [
  { to: '/bid',         label: 'Estimates',     Icon: Calculator },
  { to: '/invoices',    label: 'Invoices',      Icon: Receipt },
  { to: '/analytics',   label: 'Reports',       Icon: BarChart3 },
  { to: '/subs',        label: 'Subs',          Icon: Hammer },
  { to: '/compose',     label: 'AI Compose',    Icon: MessageSquare },
  { to: '/import',      label: 'Import',        Icon: Upload },
  { to: '/pour-window', label: 'Forecast',      Icon: CloudSun },
  { to: '/settings',    label: 'Settings',      Icon: SettingsIcon }
]

export default function DesktopSidebar() {
  const navigate = useNavigate()
  const { signOut, user } = useAuth()
  const { theme, toggleTheme } = useTheme()
  const { profile } = useProfile()

  const userEmail = user?.email || ''
  const company = profile?.company_name?.trim()
  const logoSrc = profile?.logo_url

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <aside className="fh-desktop-sidebar" aria-label="Primary navigation">
      <div className="fh-desktop-sidebar__brand">
        <span className="fh-desktop-sidebar__wordmark">
          <span style={{ color: 'var(--field-gold)' }}>FIELD</span>
          <span style={{ color: 'var(--ink-strong)' }}>HORSE</span>
        </span>
        {(logoSrc || company) && (
          <div className="fh-desktop-sidebar__tenant">
            {logoSrc ? (
              <img
                src={logoSrc}
                alt={company || 'Company logo'}
                onError={(e) => { e.currentTarget.style.display = 'none' }}
              />
            ) : (
              <span>{company}</span>
            )}
          </div>
        )}
      </div>

      <nav className="fh-desktop-sidebar__nav" aria-label="Primary">
        <SidebarSection items={PRIMARY_NAV} />
        <div className="fh-desktop-sidebar__divider" aria-hidden="true" />
        <SidebarSection items={SECONDARY_NAV} eyebrow="Tools" />
      </nav>

      <div className="fh-desktop-sidebar__foot">
        <div className="fh-desktop-sidebar__account">
          <span className="fh-desktop-sidebar__account-eyebrow">Account</span>
          {userEmail && (
            <span className="fh-desktop-sidebar__account-email" title={userEmail}>
              {userEmail}
            </span>
          )}
        </div>
        <button
          type="button"
          className="fh-desktop-sidebar__icon-btn"
          onClick={() => toggleTheme()}
          aria-label={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
          title={theme === 'dark' ? 'Switch to light theme' : 'Switch to dark theme'}
        >
          {theme === 'dark' ? <Moon size={14} /> : <Sun size={14} />}
        </button>
        <button
          type="button"
          className="fh-desktop-sidebar__icon-btn"
          onClick={handleSignOut}
          aria-label="Sign out"
          title="Sign out"
        >
          <LogOut size={14} />
        </button>
      </div>
    </aside>
  )
}

function SidebarSection({ items, eyebrow }) {
  return (
    <div className="fh-desktop-sidebar__group">
      {eyebrow && (
        <span className="fh-desktop-sidebar__eyebrow">{eyebrow}</span>
      )}
      <ul className="fh-desktop-sidebar__list">
        {items.map((it) => {
          const I = it.Icon
          return (
            <li key={it.to}>
              <NavLink
                to={it.to}
                end={it.end}
                className={({ isActive }) =>
                  `fh-desktop-sidebar__link${isActive ? ' is-active' : ''}`
                }
              >
                <span className="fh-desktop-sidebar__link-icon" aria-hidden="true">
                  <I size={15} />
                </span>
                <span className="fh-desktop-sidebar__link-label">{it.label}</span>
              </NavLink>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
