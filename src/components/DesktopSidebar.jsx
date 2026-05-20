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
  LogOut,
  Activity as ActivityIcon
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useProfile } from '../contexts/ProfileContext.tsx'

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
  { to: '/activity',    label: 'Activity',      Icon: ActivityIcon },
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
  const { profile } = useProfile()

  const userEmail = user?.email || ''
  const company = profile?.company_name?.trim()
  const logoSrc = profile?.logo_url

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  // Sidebar brand block — logo-first.
  //
  // Per Phase 5 user feedback: the small FH-mark + tenant-text combo
  // read as awkward. Restored the full company logo as the visual
  // anchor at the top of the rail, matching the older Parker-on-top
  // treatment. Layout stack:
  //
  //   small "FIELDHORSE" system label       (only when a tenant logo
  //                                           or company name exists,
  //                                           so the user always knows
  //                                           which product they're in)
  //   full company logo                     (max-height ~84px,
  //                                           object-fit: contain — never
  //                                           cropped, squeezed, or clipped)
  //   thin divider
  //   nav starts below
  //
  // Fallback chain when no logo_url:
  //   1. company_name → wide serif Bebas Neue wordmark
  //   2. nothing      → "FIELDHORSE" gold/ink wordmark
  const hasLogo = !!logoSrc
  const showSystemLabel = hasLogo || !!company  // when a tenant brand
                                                // is shown, label what
                                                // app it lives in.

  return (
    <aside className="fh-desktop-sidebar" aria-label="Primary navigation">
      <div className="fh-desktop-sidebar__brand">
        {showSystemLabel && (
          <span className="fh-desktop-sidebar__system-label" aria-hidden="true">
            FIELDHORSE
          </span>
        )}
        {hasLogo ? (
          <div className="fh-desktop-sidebar__logo-wrap">
            <img
              src={logoSrc}
              alt={company || 'Company logo'}
              className="fh-desktop-sidebar__logo"
              onError={(e) => {
                // Signed URL expired or 403'd — hide the img and let
                // the wordmark fallback paint on next render. We don't
                // hold a re-fetch state machine here on purpose; the
                // tenant can hard-refresh to retry.
                e.currentTarget.style.display = 'none'
              }}
            />
          </div>
        ) : company ? (
          <span className="fh-desktop-sidebar__co-wordmark" title={company}>
            {company}
          </span>
        ) : (
          <span className="fh-desktop-sidebar__co-wordmark fh-desktop-sidebar__co-wordmark--system">
            <span style={{ color: 'var(--field-gold)' }}>FIELD</span>
            <span style={{ color: 'var(--ink-strong)' }}>HORSE</span>
          </span>
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
        {/* Theme toggle hidden 5/17 — the light theme was half-implemented
            (only repainted cards, left the sidebar + canvas dark per the
            5/13 audit). Restore the button once full light parity ships
            in tokens.css / global.css. The button used to live here:
              <button onClick={toggleTheme}><Moon|Sun /></button>
            ThemeContext still drives the data-theme attribute so the
            current theme (dark by default) keeps rendering correctly. */}
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
