import { useEffect, useState, useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator
} from '@/components/ui/command'
import {
  Home, Briefcase, FileText, Calendar, Calculator, MessageSquare,
  BarChart3, Upload, Settings, Plus, Mic, Users, Image as ImageIcon,
  Paperclip
} from 'lucide-react'
import { universalSearch } from '../lib/universalSearch.ts'
import { useAuth } from '../contexts/AuthContext.jsx'

// Static nav — shown as the "empty state" when the input is blank.
// When the user starts typing, the data search results take over.
const QUICK_ACTIONS = [
  { id: 'newLead', label: 'New lead', hint: 'Open Pipeline card', icon: Plus, to: '/jobs?new=1' },
  { id: 'voice', label: 'Voice capture', hint: 'Dictate a note', icon: Mic, to: '/notes?voice=1' }
]
// Home hint adapts to time of day so the palette doesn't say
// "Morning brief" at 9 PM.
function homeHint() {
  const h = new Date().getHours()
  if (h < 12) return 'Morning brief'
  if (h < 17) return 'Afternoon brief'
  return 'Evening brief'
}
const NAV_ITEMS = [
  { id: 'home', label: 'Home', hint: homeHint(), icon: Home, to: '/' },
  { id: 'jobs', label: 'Jobs', hint: 'Pipeline', icon: Briefcase, to: '/jobs' },
  { id: 'clients', label: 'Clients', hint: 'Directory', icon: Users, to: '/clients' },
  { id: 'notes', label: 'Field notes', hint: 'Capture anything', icon: FileText, to: '/notes' },
  { id: 'schedule', label: 'Schedule', hint: 'Day / week / month', icon: Calendar, to: '/schedule' }
]
const MONEY_ITEMS = [
  { id: 'bid', label: 'AI Bid Engine', hint: 'Scope to number', icon: Calculator, to: '/bid' },
  { id: 'compose', label: 'AI Compose', hint: 'Draft a message', icon: MessageSquare, to: '/compose' },
  { id: 'analytics', label: 'Analytics', hint: 'Pipeline + margin', icon: BarChart3, to: '/analytics' }
]
const SYSTEM_ITEMS = [
  { id: 'import', label: 'Import data', hint: 'CSV + webhooks', icon: Upload, to: '/import' },
  { id: 'settings', label: 'Settings', hint: 'Profile + billing', icon: Settings, to: '/settings' }
]

const ICON_FOR_KIND = {
  job: Briefcase,
  client: Users,
  note: FileText,
  event: Calendar,
  file: Paperclip,
  photo: ImageIcon
}

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [results, setResults] = useState({ jobs: [], clients: [], notes: [], events: [], files: [], total: 0 })
  const [searching, setSearching] = useState(false)
  const navigate = useNavigate()
  const { user } = useAuth()

  // Open with ⌘K / Ctrl+K. Listens at the window level so it works
  // from anywhere — including focused inputs (preventDefault keeps
  // the browser's "find" out of the way).
  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)

    // Also listen for an in-app event so AppHeader's search button
    // can open the palette without needing a ref. Desktop-only — at
    // phone widths MobileSearchOverlay takes the event; the cmdk
    // popover doesn't render correctly on iOS Safari + Chrome.
    function onOpenEvt() {
      if (typeof window !== 'undefined' && window.innerWidth >= 900) {
        setOpen(true)
      }
    }
    window.addEventListener('fh:open-palette', onOpenEvt)

    return () => {
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('fh:open-palette', onOpenEvt)
    }
  }, [])

  // Reset state every time the dialog closes so the next open is clean.
  useEffect(() => {
    if (!open) {
      setQuery('')
      setResults({ jobs: [], clients: [], notes: [], events: [], files: [], total: 0 })
      setSearching(false)
    }
  }, [open])

  // Debounced search. Empty query → no fetch (we'll show static nav).
  useEffect(() => {
    if (!open) return
    const q = query.trim()
    if (!q) {
      setResults({ jobs: [], clients: [], notes: [], events: [], files: [], total: 0 })
      setSearching(false)
      return
    }
    setSearching(true)
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const data = await universalSearch(q, user?.id)
        if (!cancelled) setResults(data)
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, 200)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, open, user?.id])

  function go(to) {
    setOpen(false)
    navigate(to)
  }

  const hasQuery = query.trim().length > 0
  const hasResults = results.total > 0

  function renderEntityGroup(heading, items, kindFallback) {
    if (!items.length) return null
    return (
      <CommandGroup heading={heading}>
        {items.map((item) => {
          const I = ICON_FOR_KIND[item.kind || kindFallback] || FileText
          return (
            <CommandItem
              key={item.id}
              // value covers what cmdk's internal filter matches against,
              // but since we hand it pre-filtered server results, we just
              // make sure each value is unique enough not to collide.
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

  function renderNavGroup(heading, items) {
    return (
      <CommandGroup heading={heading}>
        {items.map((it) => {
          const I = it.icon
          return (
            <CommandItem key={it.id} value={`${it.id} ${it.label} ${it.hint}`} onSelect={() => go(it.to)} className="ui:gap-3">
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

  return (
    <CommandDialog
      open={open}
      onOpenChange={setOpen}
      // Custom class is the source of truth for positioning — see
      // mobile-keyboard-fix.css. Tailwind utility overrides (top-[10vh]
      // etc.) don't reliably dedupe with the ui: prefix, so we go
      // straight to a stable class with !important rules.
      className="fh-command-dialog"
    >
      <CommandInput
        placeholder="Search jobs, clients, notes, events, files…"
        value={query}
        onValueChange={setQuery}
      />
      <CommandList>
        {/* When typing: show search results (or empty/loading); skip nav.
            When idle: show the static nav lattice. */}
        {hasQuery ? (
          <>
            {searching && !hasResults && (
              <div className="ui:py-6 ui:text-center ui:text-sm ui:text-muted-foreground">
                Searching…
              </div>
            )}
            {!searching && !hasResults && <CommandEmpty>Nothing matched.</CommandEmpty>}
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
            {renderNavGroup('Quick actions', QUICK_ACTIONS)}
            <CommandSeparator />
            {renderNavGroup('Navigate', NAV_ITEMS)}
            <CommandSeparator />
            {renderNavGroup('Money tools', MONEY_ITEMS)}
            <CommandSeparator />
            {renderNavGroup('System', SYSTEM_ITEMS)}
          </>
        )}
      </CommandList>
    </CommandDialog>
  )
}
