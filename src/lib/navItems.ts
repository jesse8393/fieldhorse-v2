import {
  Activity,
  BarChart3,
  Banknote,
  Briefcase,
  Calculator,
  CalendarDays,
  ClipboardCheck,
  Clock,
  CloudSun,
  FileText,
  Hammer,
  HardHat,
  Handshake,
  MessageSquare,
  PlayCircle,
  Settings,
  Sun,
  Upload,
  Users,
  UsersRound,
  type LucideIcon
} from 'lucide-react'

// Every navigation entry in the redesigned shell (spec section 8), in
// one place so the dock, the workspace menu and the desktop sidebar
// agree on names, icons and which routes light which entry.

export type NavItem = {
  to: string
  label: string
  icon: LucideIcon
  /** Lights the entry on routes other than its own. */
  match?: (pathname: string) => boolean
}

const under = (base: string) => (p: string) => p === base || p.startsWith(`${base}/`)
const jobsMatch = (p: string) => p === '/work' || p.startsWith('/leads') || p.startsWith('/quotes') || p.startsWith('/jobs')

export function isActive(item: NavItem, pathname: string) {
  return item.match ? item.match(pathname) : pathname === item.to
}

export const TODAY: NavItem = { to: '/', label: 'Today', icon: Sun, match: (p) => p === '/' }
export const JOBS: NavItem = { to: '/work', label: 'Jobs', icon: HardHat, match: jobsMatch }
export const MONEY: NavItem = { to: '/invoices', label: 'Money', icon: Banknote, match: under('/invoices') }
export const SCHEDULE: NavItem = { to: '/schedule', label: 'Schedule', icon: CalendarDays, match: under('/schedule') }
export const CUSTOMERS: NavItem = { to: '/clients', label: 'Customers', icon: Users, match: under('/clients') }
export const REPORTS: NavItem = { to: '/analytics', label: 'Reports', icon: BarChart3, match: under('/analytics') }
export const SETTINGS: NavItem = { to: '/settings', label: 'Settings', icon: Settings, match: under('/settings') }

/** The phone dock: two items, the Capture coin, two items (decision D2). */
export const DOCK_LEFT: NavItem[] = [TODAY, JOBS]
export const DOCK_RIGHT: NavItem[] = [MONEY, SCHEDULE]

const ESTIMATES: NavItem = { to: '/bid', label: 'Estimates', icon: Calculator, match: under('/bid') }
const FORECAST: NavItem = { to: '/pour-window', label: 'Forecast', icon: CloudSun, match: under('/pour-window') }
const FIELD_REPORTS: NavItem = { to: '/notes', label: 'Field reports', icon: FileText, match: under('/notes') }
const CREW_HOME: NavItem = { to: '/crew', label: 'Crew home', icon: PlayCircle, match: under('/crew') }
const TASKS: NavItem = { to: '/tasks', label: 'Tasks', icon: ClipboardCheck, match: under('/tasks') }
const TIMESHEETS: NavItem = { to: '/timesheets', label: 'Timesheets', icon: Clock, match: under('/timesheets') }
const TEAM: NavItem = { to: '/team', label: 'Team', icon: UsersRound, match: under('/team') }
const SUBS: NavItem = { to: '/subs', label: 'Subs', icon: Hammer, match: under('/subs') }
const PARTNERS: NavItem = { to: '/partners', label: 'Partners', icon: Handshake, match: under('/partners') }
const SUB_PORTAL: NavItem = { to: '/sub-portal', label: 'Sub portal', icon: Briefcase, match: under('/sub-portal') }
const ACTIVITY: NavItem = { to: '/activity', label: 'Activity', icon: Activity, match: under('/activity') }
const COMPOSE: NavItem = { to: '/compose', label: 'Compose', icon: MessageSquare, match: under('/compose') }
const IMPORT: NavItem = { to: '/import', label: 'Import', icon: Upload, match: under('/import') }

export type NavGroup = { label: string; items: NavItem[]; crewOnly?: boolean }

/** The phone workspace menu (spec 8.2). */
export const MENU_GROUPS: NavGroup[] = [
  { label: 'Work', items: [SCHEDULE, ESTIMATES, FORECAST, CUSTOMERS, FIELD_REPORTS, REPORTS] },
  { label: 'Team', crewOnly: true, items: [CREW_HOME, TASKS, TIMESHEETS, TEAM] },
  { label: 'Office', items: [SUBS, PARTNERS, SUB_PORTAL, ACTIVITY, COMPOSE, IMPORT, SETTINGS] }
]

/** The desktop sidebar's main list (spec 8.3). */
export const SIDEBAR_PRIMARY: NavItem[] = [TODAY, SCHEDULE, JOBS, MONEY, CUSTOMERS, REPORTS]

/** The sidebar's collapsible Team and office group. */
export const SIDEBAR_MORE: NavGroup[] = [
  { label: 'Work', items: [ESTIMATES, FORECAST, FIELD_REPORTS] },
  { label: 'Team', crewOnly: true, items: [CREW_HOME, TASKS, TIMESHEETS, TEAM] },
  { label: 'Office', items: [SUBS, PARTNERS, SUB_PORTAL, ACTIVITY, COMPOSE, IMPORT] }
]
