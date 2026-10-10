// Command palette (SPEC.md 9.12, render base/desktop-command.jpg).
//
// Desktop only: it opens at 900 px and up, from Control or Cmd+K or the
// `fh:open-palette` event. Below 900 px MobileSearchOverlay takes over.
//
// Search groups: Jobs, Actions (for the highlighted job), Customers,
// Documents (only when files match), then Notes and Schedule when they
// match. With nothing typed it lists the quick actions and the places to
// go. universalSearch has already filtered on the server, so cmdk's own
// matcher is off.
//
// Keyboard rule for the job actions: plain letters always type into the
// search field. A shortcut is Alt plus I, M or N (Option on a Mac), it
// fires only while this palette is open and a job, or one of its action
// rows, is highlighted, and the key caps print the modifier. There is no
// listener while the palette is closed, so typing "i" in any other text
// field does nothing. The rule itself is in lib/paletteActions.ts.

import { useEffect, useMemo, useState } from 'react'
import type { KeyboardEvent } from 'react'
import { useNavigate } from 'react-router-dom'
import { Command } from 'cmdk'
import { Dialog as DialogPrimitive } from 'radix-ui'
import {
  BarChart3,
  Briefcase,
  Calendar,
  Calculator,
  ChevronRight,
  ClipboardCheck,
  FileText,
  HardHat,
  Home,
  Image as ImageIcon,
  LineChart,
  MapPin,
  MessageSquare,
  Mic,
  NotepadText,
  Plus,
  Receipt,
  Search,
  Settings,
  Target,
  Upload,
  Users,
  UsersRound,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { Icon, KeyCap } from './fh/index.ts'
import { universalSearch } from '../lib/universalSearch.ts'
import type { SearchResult, SearchResults } from '../lib/universalSearch.ts'
import {
  actionForShortcut,
  paletteActions,
  shortcutModifier,
} from '../lib/paletteActions.ts'
import type { PaletteAction, PaletteActionId, PaletteJob } from '../lib/paletteActions.ts'
import { openCapture } from '../lib/captureAttach.ts'
import { stageLabel } from '../lib/stages.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import '../styles/command-palette.css'

type NavEntry = {
  id: string
  label: string
  hint: string
  icon: LucideIcon
  to?: string
  event?: string
}

// Target /work directly (the collapsed deal list) rather than the legacy
// board paths, so these don't round-trip through LegacyBoardRedirect and
// its stage-synonym table. asStage seeds the New-deal sheet's stage.
const QUICK_ACTIONS: NavEntry[] = [
  { id: 'capture', label: 'Capture anything', hint: 'Voice, text, receipt, or photo', icon: Mic, event: 'fh:open-capture' },
  { id: 'newLead', label: 'New lead', hint: 'Add an opportunity', icon: Plus, to: '/work?new=1' },
  { id: 'newQuote', label: 'New quote', hint: 'Start a proposal with scope', icon: FileText, to: '/work?new=1&asStage=quote' },
  { id: 'newJob', label: 'New job', hint: 'Create active work', icon: Briefcase, to: '/work?new=1&asStage=job' },
  { id: 'followups', label: 'Work follow ups', hint: 'Deals due for a touch, up top', icon: Target, to: '/work?stage=leads' },
  { id: 'collect', label: 'Collect money', hint: 'Invoices and balances', icon: Receipt, to: '/invoices' },
  { id: 'compose', label: 'Draft message', hint: 'AI compose for customers', icon: MessageSquare, to: '/compose' },
]

function homeHint() {
  const h = new Date().getHours()
  if (h < 12) return 'Morning revenue brief'
  if (h < 17) return 'Afternoon command brief'
  return 'Evening closeout'
}

const NAV_ITEMS: NavEntry[] = [
  { id: 'home', label: 'Command Center', hint: homeHint(), icon: Home, to: '/' },
  { id: 'work', label: 'Work & Deals', hint: 'Every deal, lead to done, one list', icon: Briefcase, to: '/work' },
  { id: 'clients', label: 'Clients', hint: 'Customer profiles', icon: Users, to: '/clients' },
  { id: 'schedule', label: 'Schedule', hint: 'Day, week, and month planning', icon: Calendar, to: '/schedule' },
]

const REVENUE_ITEMS: NavEntry[] = [
  { id: 'bid', label: 'Estimates', hint: 'Scope to number', icon: Calculator, to: '/bid' },
  { id: 'invoices', label: 'Invoices', hint: 'Collect and reconcile', icon: Receipt, to: '/invoices' },
  { id: 'analytics', label: 'Analytics', hint: 'Pipeline and margin', icon: BarChart3, to: '/analytics' },
  { id: 'forecast', label: 'Forecast', hint: 'Pour window and capacity', icon: LineChart, to: '/pour-window' },
]

const SYSTEM_ITEMS: NavEntry[] = [
  { id: 'notes', label: 'Activity feed', hint: 'Notes and field intelligence', icon: FileText, to: '/notes' },
  { id: 'tasks', label: 'Tasks', hint: 'Owner queue', icon: ClipboardCheck, to: '/tasks' },
  { id: 'team', label: 'Team', hint: 'Roles and operators', icon: UsersRound, to: '/team' },
  { id: 'import', label: 'Import data', hint: 'CSV and webhooks', icon: Upload, to: '/import' },
  { id: 'settings', label: 'Settings', hint: 'Profile, templates, billing', icon: Settings, to: '/settings' },
]

const ICON_FOR_KIND: Record<string, LucideIcon> = {
  job: HardHat,
  client: Users,
  note: NotepadText,
  event: Calendar,
  file: FileText,
  photo: ImageIcon,
}

const ICON_FOR_ACTION: Record<PaletteActionId, LucideIcon> = {
  invoice: FileText,
  message: MessageSquare,
  note: NotepadText,
  navigate: MapPin,
}

const EMPTY_RESULTS: SearchResults = { jobs: [], clients: [], notes: [], events: [], files: [], total: 0 }

// Row values. cmdk tracks the highlighted row by value, so these say what
// a highlight means: a job row, or an action row of a job.
const jobValue = (result: SearchResult) => result.id
const actionValue = (jobId: string, actionId: PaletteActionId) => `act:${jobId}:${actionId}`

function jobIdOfValue(value: string, jobs: SearchResult[]): string | null {
  if (value.startsWith('job:')) return jobs.find((j) => j.id === value)?.job?.id ?? null
  if (value.startsWith('act:')) return value.slice(4, value.lastIndexOf(':'))
  return null
}

function jobLine(job: PaletteJob) {
  const title = job.job_title?.trim()
  return [stageLabel(job.stage), title ? job.name : null, job.address?.trim() || null].filter(Boolean).join(', ')
}

type PaletteRowProps = {
  value: string
  icon: LucideIcon
  title: string
  sub?: string
  chevron?: boolean
  keys?: { modifier: string; key: string }
  shortcut?: string
  onSelect: () => void
}

function PaletteRow({ value, icon, title, sub, chevron, keys, shortcut, onSelect }: PaletteRowProps) {
  return (
    <Command.Item
      value={value}
      onSelect={onSelect}
      className={sub ? 'fhp-item fhp-item--rich' : 'fhp-item'}
      aria-keyshortcuts={shortcut}
    >
      <Icon icon={icon} size={22} className="fhp-item__icon" />
      <span className="fhp-item__body">
        <span className="fhp-item__title">{title}</span>
        {sub ? <span className="fhp-item__sub">{sub}</span> : null}
      </span>
      {keys ? (
        <span className="fhp-keys" aria-hidden="true">
          <KeyCap>{keys.modifier}</KeyCap>
          <KeyCap>{keys.key}</KeyCap>
        </span>
      ) : null}
      {chevron ? <Icon icon={ChevronRight} size={18} className="fhp-item__chevron" /> : null}
    </Command.Item>
  )
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<SearchResults>(EMPTY_RESULTS)
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  // The highlighted row's cmdk value, and the job the Actions group is for.
  const [highlight, setHighlight] = useState('')
  const [activeJobId, setActiveJobId] = useState<string | null>(null)
  const navigate = useNavigate()
  const { user } = useAuth()
  const { canViewRoute, canCreateFinancialDocs, role, loading: membershipLoading } = useMembership()

  const env = useMemo(
    () => (typeof navigator === 'undefined' ? {} : { userAgent: navigator.userAgent, maxTouchPoints: navigator.maxTouchPoints }),
    [],
  )
  const modifier = shortcutModifier(env)

  useEffect(() => {
    function onKey(e: globalThis.KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    function onOpenEvt() {
      if (typeof window !== 'undefined' && window.innerWidth >= 900) setOpen(true)
    }
    window.addEventListener('keydown', onKey)
    window.addEventListener('fh:open-palette', onOpenEvt)
    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('fh:open-palette', onOpenEvt)
    }
  }, [])

  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults(EMPTY_RESULTS)
      setSearching(false)
      setSearchError('')
      setHighlight('')
      setActiveJobId(null)
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setResults(EMPTY_RESULTS)
      setSearching(false)
      setSearchError('')
      return
    }
    setSearching(true)
    setSearchError('')
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const data = await universalSearch(q, user?.id)
        if (!cancelled) setResults(data)
      } catch (e: unknown) {
        if (!cancelled) {
          setResults(EMPTY_RESULTS)
          setSearchError(e instanceof Error && e.message ? e.message : 'Search is unavailable right now.')
        }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 200)
    return () => {
      cancelled = true
      clearTimeout(t)
    }
  }, [query, open, user?.id])

  function go(to: string) {
    setOpen(false)
    navigate(to)
  }

  function runAction(action: PaletteAction, job: PaletteJob) {
    setOpen(false)
    if (action.id === 'note') {
      openCapture({ jobId: job.id })
    } else if (action.event) {
      window.dispatchEvent(new CustomEvent(action.event))
    } else if (action.to?.startsWith('/')) {
      navigate(action.to)
    } else if (action.to?.startsWith('sms:')) {
      window.location.href = action.to
    } else if (action.to) {
      window.open(action.to, '_blank', 'noopener,noreferrer')
    }
  }

  function itemAllowed(it: NavEntry) {
    if (it.event) return true
    if (!it.to) return true
    const path = it.to.split('?')[0].split('#')[0]
    if (membershipLoading) return true
    if (role) return path === '/sub-portal' || canViewRoute(path)
    return path === '/sub-portal'
  }

  const jobs = results.jobs
  const activeJob =
    jobs.find((j) => j.job?.id === activeJobId)?.job ?? jobs.find((j) => j.job)?.job ?? null
  const actions = paletteActions(activeJob, !membershipLoading && canCreateFinancialDocs, env)
  // A job is highlighted when the highlight sits on a job row or on one of
  // its action rows. Only then does a shortcut run.
  const jobHighlighted = highlight.startsWith('job:') || highlight.startsWith('act:')

  function onHighlight(value: string) {
    setHighlight(value)
    const id = jobIdOfValue(value, jobs)
    if (id) setActiveJobId(id)
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    if (e.nativeEvent.isComposing || !activeJob || !jobHighlighted) return
    const hit = actionForShortcut(actions, e)
    if (!hit) return
    e.preventDefault()
    runAction(hit, activeJob)
  }

  function renderEntityGroup(heading: string, items: SearchResult[]) {
    if (!items.length) return null
    return (
      <Command.Group heading={heading} className="fhp-group">
        {items.map((item) => (
          <PaletteRow
            key={item.id}
            value={item.id}
            icon={ICON_FOR_KIND[item.kind] || FileText}
            title={item.title}
            sub={item.sub || undefined}
            chevron
            onSelect={() => go(item.to)}
          />
        ))}
      </Command.Group>
    )
  }

  function renderNavGroup(heading: string, items: NavEntry[]) {
    if (!items.length) return null
    return (
      <Command.Group heading={heading} className="fhp-group">
        {items.map((it) => (
          <PaletteRow
            key={it.id}
            value={`nav:${it.id}`}
            icon={it.icon}
            title={it.label}
            sub={it.hint}
            onSelect={() => {
              if (it.event) {
                setOpen(false)
                window.dispatchEvent(new CustomEvent(it.event))
              } else if (it.to) {
                go(it.to)
              }
            }}
          />
        ))}
      </Command.Group>
    )
  }

  const hasQuery = query.trim().length > 0
  const hasResults = results.total > 0
  const quickActions = QUICK_ACTIONS.filter(itemAllowed)
  const navItems = NAV_ITEMS.filter(itemAllowed)
  const revenueItems = REVENUE_ITEMS.filter(itemAllowed)
  const systemItems = SYSTEM_ITEMS.filter(itemAllowed)

  return (
    <DialogPrimitive.Root open={open} onOpenChange={setOpen}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fhp-scrim" />
        <DialogPrimitive.Content className="fhp-panel">
          <DialogPrimitive.Title className="fhc-vh">Command palette</DialogPrimitive.Title>
          <DialogPrimitive.Description className="fhc-vh">
            Search jobs, customers and documents, or run a quick action.
          </DialogPrimitive.Description>
          <Command
            className="fhp-cmd"
            label="Search jobs, customers and documents"
            shouldFilter={false}
            loop
            value={highlight}
            onValueChange={onHighlight}
            onKeyDown={onKeyDown}
          >
            <div className="fhp-search">
              <Icon icon={Search} size={24} />
              <Command.Input
                className="fhp-input"
                placeholder="Search jobs, customers, notes and files"
                value={query}
                onValueChange={setQuery}
              />
              <KeyCap>esc</KeyCap>
            </div>
            <Command.List className="fhp-list">
              {hasQuery ? (
                <>
                  {searching && !hasResults && (
                    <div className="fhp-note" role="status">Searching...</div>
                  )}
                  {!searching && searchError && <Command.Empty className="fhp-note">{searchError}</Command.Empty>}
                  {!searching && !searchError && !hasResults && (
                    <Command.Empty className="fhp-note">Nothing matched.</Command.Empty>
                  )}
                  {jobs.length > 0 && (
                    <Command.Group heading="Jobs" className="fhp-group">
                      {jobs.map((item) => (
                        <PaletteRow
                          key={item.id}
                          value={jobValue(item)}
                          icon={ICON_FOR_KIND.job}
                          title={item.job ? item.job.job_title?.trim() || item.job.name : item.title}
                          sub={item.job ? jobLine(item.job) : item.sub}
                          chevron
                          onSelect={() => go(item.to)}
                        />
                      ))}
                    </Command.Group>
                  )}
                  {activeJob && actions.length > 0 && (
                    <Command.Group heading="Actions" className="fhp-group">
                      {actions.map((action) => (
                        <PaletteRow
                          key={action.id}
                          value={actionValue(activeJob.id, action.id)}
                          icon={ICON_FOR_ACTION[action.id]}
                          title={action.label}
                          keys={action.key ? { modifier, key: action.key } : undefined}
                          shortcut={action.key ? `Alt+${action.key}` : undefined}
                          onSelect={() => runAction(action, activeJob)}
                        />
                      ))}
                    </Command.Group>
                  )}
                  {renderEntityGroup('Customers', results.clients)}
                  {renderEntityGroup('Documents', results.files)}
                  {renderEntityGroup('Notes', results.notes)}
                  {renderEntityGroup('Schedule', results.events)}
                </>
              ) : (
                <>
                  <Command.Empty className="fhp-note">Type to search across everything.</Command.Empty>
                  {renderNavGroup('Quick actions', quickActions)}
                  {renderNavGroup('CRM workspace', navItems)}
                  {renderNavGroup('Revenue tools', revenueItems)}
                  {renderNavGroup('System', systemItems)}
                </>
              )}
            </Command.List>
            <div className="fhp-foot">
              <span className="fhp-hint">
                <span className="fhp-hint__keys">
                  <KeyCap label="Up arrow">↑</KeyCap>
                  <KeyCap label="Down arrow">↓</KeyCap>
                </span>
                <span>to move,</span>
              </span>
              <span className="fhp-hint">
                <KeyCap label="Enter">↵</KeyCap>
                <span>to open,</span>
              </span>
              <span className="fhp-hint">
                <KeyCap>esc</KeyCap>
                <span>to close.</span>
              </span>
            </div>
          </Command>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}
