import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from '@/components/ui/command'
import {
  BarChart3,
  Briefcase,
  Calendar,
  Calculator,
  ClipboardCheck,
  FileText,
  Home,
  Image as ImageIcon,
  LineChart,
  MessageSquare,
  Mic,
  Paperclip,
  Plus,
  Receipt,
  Settings,
  Target,
  Upload,
  Users,
  UsersRound,
} from 'lucide-react'
import { universalSearch } from '../lib/universalSearch.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'

const QUICK_ACTIONS = [
  { id: 'capture', label: 'Capture anything', hint: 'Voice, text, receipt, or photo', icon: Mic, event: 'fh:open-capture' },
  { id: 'newLead', label: 'New lead', hint: 'Add opportunity to Lead Desk', icon: Plus, to: '/leads?new=1' },
  { id: 'newQuote', label: 'New quote', hint: 'Start a proposal with scope', icon: FileText, to: '/quotes?new=1' },
  { id: 'newJob', label: 'New job', hint: 'Create active work', icon: Briefcase, to: '/jobs?new=1&asStage=job' },
  { id: 'followups', label: 'Work follow-ups', hint: 'Ranked Lead Desk queue', icon: Target, to: '/leads?stage=open' },
  { id: 'collect', label: 'Collect money', hint: 'Invoices and balances', icon: Receipt, to: '/invoices' },
  { id: 'compose', label: 'Draft message', hint: 'AI compose for customers', icon: MessageSquare, to: '/compose' },
]

function homeHint() {
  const h = new Date().getHours()
  if (h < 12) return 'Morning revenue brief'
  if (h < 17) return 'Afternoon command brief'
  return 'Evening closeout'
}

const NAV_ITEMS = [
  { id: 'home', label: 'Command Center', hint: homeHint(), icon: Home, to: '/' },
  { id: 'work', label: 'Work & Deals', hint: 'Every deal, lead to done, one list', icon: Briefcase, to: '/work' },
  { id: 'clients', label: 'Clients', hint: 'Customer profiles', icon: Users, to: '/clients' },
  { id: 'schedule', label: 'Schedule', hint: 'Day, week, and month planning', icon: Calendar, to: '/schedule' },
]

const REVENUE_ITEMS = [
  { id: 'bid', label: 'Estimates', hint: 'Scope to number', icon: Calculator, to: '/bid' },
  { id: 'invoices', label: 'Invoices', hint: 'Collect and reconcile', icon: Receipt, to: '/invoices' },
  { id: 'analytics', label: 'Analytics', hint: 'Pipeline and margin', icon: BarChart3, to: '/analytics' },
  { id: 'forecast', label: 'Forecast', hint: 'Pour window and capacity', icon: LineChart, to: '/pour-window' },
]

const SYSTEM_ITEMS = [
  { id: 'notes', label: 'Activity feed', hint: 'Notes and field intelligence', icon: FileText, to: '/notes' },
  { id: 'tasks', label: 'Tasks', hint: 'Owner queue', icon: ClipboardCheck, to: '/tasks' },
  { id: 'team', label: 'Team', hint: 'Roles and operators', icon: UsersRound, to: '/team' },
  { id: 'import', label: 'Import data', hint: 'CSV and webhooks', icon: Upload, to: '/import' },
  { id: 'settings', label: 'Settings', hint: 'Profile, templates, billing', icon: Settings, to: '/settings' },
]

const ICON_FOR_KIND: Record<string, any> = {
  job: Briefcase,
  client: Users,
  note: FileText,
  event: Calendar,
  file: Paperclip,
  photo: ImageIcon,
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState<any>({ jobs: [], clients: [], notes: [], events: [], files: [], total: 0 })
  const [searching, setSearching] = useState(false)
  const [searchError, setSearchError] = useState('')
  const navigate = useNavigate()
  const { user } = useAuth()
  const { canViewRoute, role, loading: membershipLoading } = useMembership()

  useEffect(() => {
    function onKey(e: any) {
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
      setResults({ jobs: [], clients: [], notes: [], events: [], files: [], total: 0 })
      setSearching(false)
      setSearchError('')
    }
  }, [open])

  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setResults({ jobs: [], clients: [], notes: [], events: [], files: [], total: 0 })
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
      } catch (e: any) {
        if (!cancelled) {
          setResults({ jobs: [], clients: [], notes: [], events: [], files: [], total: 0 })
          setSearchError(e?.message || 'Search is unavailable right now.')
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

  function itemAllowed(it: any) {
    if (it.event) return true
    if (!it.to) return true
    const path = it.to.split('?')[0].split('#')[0]
    if (membershipLoading) return true
    if (role) return path === '/sub-portal' || canViewRoute(path)
    return path === '/sub-portal'
  }

  function renderEntityGroup(heading: string, items: any[], kindFallback?: string) {
    if (!items.length) return null
    return (
      <CommandGroup heading={heading}>
        {items.map((item: any) => {
          const I = ICON_FOR_KIND[item.kind || kindFallback || 'note'] || FileText
          return (
            <CommandItem
              key={item.id}
              value={`${item.id} ${item.title} ${item.sub || ''}`}
              onSelect={() => go(item.to)}
              className="ui:gap-3"
            >
              <I className="ui:text-fh-gold-bright" style={{ width: 16, height: 16, flexShrink: 0 }} />
              <div className="ui:flex ui:flex-col" style={{ minWidth: 0 }}>
                <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {item.title}
                </span>
                {item.sub && (
                  <span className="ui:text-xs ui:text-muted-foreground" style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {item.sub}
                  </span>
                )}
              </div>
            </CommandItem>
          )
        })}
      </CommandGroup>
    )
  }

  function renderNavGroup(heading: string, items: any[]) {
    if (!items.length) return null
    return (
      <CommandGroup heading={heading}>
        {items.map((it: any) => {
          const I = it.icon
          return (
            <CommandItem
              key={it.id}
              value={`${it.id} ${it.label} ${it.hint}`}
              onSelect={() => {
                if (it.event) {
                  setOpen(false)
                  window.dispatchEvent(new CustomEvent(it.event))
                } else {
                  go(it.to)
                }
              }}
              className="ui:gap-3"
            >
              <I className="ui:text-fh-gold-bright" style={{ width: 16, height: 16 }} />
              <div className="ui:flex ui:flex-col">
                <span>{it.label}</span>
                <span className="ui:text-xs ui:text-muted-foreground">{it.hint}</span>
              </div>
            </CommandItem>
          )
        })}
      </CommandGroup>
    )
  }

  const hasQuery = query.trim().length > 0
  const hasResults = results.total > 0
  const quickActions = QUICK_ACTIONS.filter(itemAllowed)
  const navItems = NAV_ITEMS.filter(itemAllowed)
  const revenueItems = REVENUE_ITEMS.filter(itemAllowed)
  const systemItems = SYSTEM_ITEMS.filter(itemAllowed)

  return (
    <CommandDialog open={open} onOpenChange={setOpen} className="fh-command-dialog">
      <CommandInput
        placeholder="Search leads, jobs, clients, notes, events, files..."
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {hasQuery ? (
          <>
            {searching && !hasResults && (
              <div className="ui:py-6 ui:text-center ui:text-sm ui:text-muted-foreground">
                Searching...
              </div>
            )}
            {!searching && searchError && <CommandEmpty>{searchError}</CommandEmpty>}
            {!searching && !searchError && !hasResults && <CommandEmpty>Nothing matched.</CommandEmpty>}
            {renderEntityGroup('Jobs', results.jobs)}
            {results.jobs.length > 0 && (results.clients.length || results.notes.length || results.events.length || results.files.length) > 0 && <CommandSeparator />}
            {renderEntityGroup('Clients', results.clients)}
            {results.clients.length > 0 && (results.notes.length || results.events.length || results.files.length) > 0 && <CommandSeparator />}
            {renderEntityGroup('Notes', results.notes)}
            {results.notes.length > 0 && (results.events.length || results.files.length) > 0 && <CommandSeparator />}
            {renderEntityGroup('Schedule', results.events)}
            {results.events.length > 0 && results.files.length > 0 && <CommandSeparator />}
            {renderEntityGroup('Files', results.files)}
          </>
        ) : (
          <>
            <CommandEmpty>Type to search across everything.</CommandEmpty>
            {renderNavGroup('Quick actions', quickActions)}
            <CommandSeparator />
            {renderNavGroup('CRM workspace', navItems)}
            <CommandSeparator />
            {renderNavGroup('Revenue tools', revenueItems)}
            <CommandSeparator />
            {renderNavGroup('System', systemItems)}
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
