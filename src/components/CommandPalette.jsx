import { useEffect, useState } from 'react'
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
  BarChart3, Upload, Settings, Plus, Mic
} from 'lucide-react'

const QUICK_ACTIONS = [
  { id: 'newLead', label: 'New lead', hint: 'Open pipeline card', icon: Plus, to: '/jobs?new=1' },
  { id: 'voice', label: 'Voice capture', hint: 'Dictate a note', icon: Mic, to: '/notes?voice=1' }
]
const NAV_ITEMS = [
  { id: 'home', label: 'Home', hint: 'Morning brief', icon: Home, to: '/' },
  { id: 'jobs', label: 'Jobs', hint: 'Pipeline', icon: Briefcase, to: '/jobs' },
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

export default function CommandPalette() {
  const [open, setOpen] = useState(false)
  const navigate = useNavigate()

  useEffect(() => {
    function onKey(e) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        setOpen((v) => !v)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  function run(item) {
    setOpen(false)
    navigate(item.to)
  }

  function renderGroup(heading, items) {
    return (
      <CommandGroup heading={heading}>
        {items.map((it) => {
          const I = it.icon
          return (
            <CommandItem key={it.id} onSelect={() => run(it)} className="ui:gap-3">
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
    <CommandDialog open={open} onOpenChange={setOpen}>
      <CommandInput placeholder="Search jobs, contacts, screens..." />
      <CommandList>
        <CommandEmpty>No results.</CommandEmpty>
        {renderGroup('Quick actions', QUICK_ACTIONS)}
        <CommandSeparator />
        {renderGroup('Navigate', NAV_ITEMS)}
        <CommandSeparator />
        {renderGroup('Money tools', MONEY_ITEMS)}
        <CommandSeparator />
        {renderGroup('System', SYSTEM_ITEMS)}
      </CommandList>
    </CommandDialog>
  )
}
