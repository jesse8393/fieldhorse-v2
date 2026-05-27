// DesktopSidebar — grouped nav for the Build dashboard direction.
//
// Mounted in AppShell at >=900px. Below 900px the sidebar is
// display:none and the existing BottomNav remains the primary nav
// surface (mobile experience untouched).
//
// Brand area: corrected FieldHorseMark emblem + wordmark.
// Nav: four labeled groups — COMMAND / EXECUTION / INTELLIGENCE /
// SETTINGS — routed to the closest existing app routes.
// Foot: account email + sign out (preserved from the prior sidebar).

import { useLocation, useNavigate } from 'react-router-dom'
import {
  LayoutDashboard,
  Radio,
  Sparkles,
  Hammer,
  Calendar,
  FileSpreadsheet,
  Receipt,
  ClipboardCheck,
  BarChart3,
  TrendingUp,
  LineChart,
  Users,
  UsersRound,
  FileText,
  Settings as SettingsIcon,
  LogOut,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.tsx'

type Item = {
  label: string
  to: string
  Icon: any
  // Optional custom match — returns true when this item should show
  // as active for the given location pathname.
  match?: (pathname: string) => boolean
}

type Group = { label: string; items: Item[] }

const exact = (target: string) => (p: string) => p === target
const prefix = (target: string) => (p: string) => p === target || p.startsWith(target + '/')

const GROUPS: Group[] = [
  {
    label: 'Command',
    items: [
      { label: 'Command Center', to: '/',         Icon: LayoutDashboard, match: (p) => p === '/' || p === '/home' },
      { label: 'Dispatch',       to: '/compose',  Icon: Radio,           match: prefix('/compose') },
      { label: 'Lead Desk',      to: '/jobs?stage=lead', Icon: Sparkles },
      { label: 'Job Desk',       to: '/jobs',     Icon: Hammer,          match: exact('/jobs') },
    ],
  },
  {
    label: 'Execution',
    items: [
      { label: 'Schedule',       to: '/schedule', Icon: Calendar,        match: prefix('/schedule') },
      { label: 'Estimates',      to: '/bid',      Icon: FileSpreadsheet, match: prefix('/bid') },
      { label: 'Invoices',       to: '/invoices', Icon: Receipt,         match: prefix('/invoices') },
      { label: 'Field Reports',  to: '/notes',    Icon: ClipboardCheck,  match: prefix('/notes') },
    ],
  },
  {
    label: 'Intelligence',
    items: [
      { label: 'Pipeline',       to: '/jobs',     Icon: BarChart3,       match: () => false },
      { label: 'Analytics',      to: '/analytics',Icon: TrendingUp,      match: prefix('/analytics') },
      { label: 'Forecast',       to: '/pour-window', Icon: LineChart,    match: prefix('/pour-window') },
    ],
  },
  {
    label: 'Settings',
    items: [
      { label: 'Clients',        to: '/clients',  Icon: Users,           match: prefix('/clients') },
      { label: 'Teams',          to: '/subs',     Icon: UsersRound,      match: prefix('/subs') },
      { label: 'Templates',      to: '/settings', Icon: FileText,        match: () => false },
      { label: 'Settings',       to: '/settings', Icon: SettingsIcon,    match: prefix('/settings') },
    ],
  },
]

export default function DesktopSidebar() {
  const navigate = useNavigate()
  const { pathname } = useLocation()
  const { signOut, user } = useAuth()

  const userEmail = user?.email || ''

  async function handleSignOut() {
    await signOut()
    navigate('/login', { replace: true })
  }

  return (
    <aside className="fh-desktop-sidebar" aria-label="Primary navigation">
      <div className="fh-desktop-sidebar__brand fh-desktop-sidebar__brand--build">
        <FieldHorseMark />
        <div className="fh-desktop-sidebar__brand-text">
          <span className="fh-desktop-sidebar__brand-name">FieldHorse</span>
          <span className="fh-desktop-sidebar__brand-sub">Construction Command</span>
        </div>
      </div>

      <nav className="fh-desktop-sidebar__nav" aria-label="Primary">
        {GROUPS.map((group, gi) => (
          <div key={group.label} className="fh-desktop-sidebar__group">
            <span className="fh-desktop-sidebar__eyebrow fh-desktop-sidebar__eyebrow--build">
              {group.label}
            </span>
            <ul className="fh-desktop-sidebar__list">
              {group.items.map((it) => {
                const active = it.match
                  ? it.match(pathname)
                  : pathname === it.to.split('?')[0]
                const I = it.Icon
                return (
                  <li key={`${gi}-${it.label}`}>
                    <button
                      type="button"
                      className={`fh-desktop-sidebar__link${active ? ' is-active' : ''}`}
                      onClick={() => navigate(it.to)}
                    >
                      <span className="fh-desktop-sidebar__link-icon" aria-hidden="true">
                        <I size={15} />
                      </span>
                      <span className="fh-desktop-sidebar__link-label">{it.label}</span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </div>
        ))}
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

function FieldHorseMark() {
  return (
    <div className="fh-mark" aria-label="FieldHorse">
      <svg
        className="fh-mark__svg"
        viewBox="0 0 72 72"
        role="img"
        aria-hidden="true"
      >
        <defs>
          <linearGradient id="fhOrange" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="#F29A2E" />
            <stop offset="100%" stopColor="#F26A21" />
          </linearGradient>
        </defs>

        <rect
          x="2"
          y="2"
          width="68"
          height="68"
          rx="16"
          fill="#101317"
          stroke="rgba(255,255,255,.10)"
        />

        <path
          d="M18 19 H43 V29 H30 V34 H41 V44 H30 V55 H18 Z"
          fill="#F4F4F0"
        />

        <path
          d="M45 19 H55 V34 H62 V19 H72 V55 H62 V43 H55 V55 H45 Z"
          fill="url(#fhOrange)"
          transform="translate(-10 0)"
        />

        <rect
          x="36"
          y="30"
          width="10"
          height="18"
          fill="#101317"
        />
      </svg>
    </div>
  )
}
