// The search screen, /search (Phase 9, Task 14, D57). Below 900 px the
// header's search button comes here (the app shell takes the
// `fh:open-palette` event to this route; at 900 px and up the command
// palette answers it instead, the one keyboard overlay D57 keeps). It took
// the place of the mobile search overlay: one search field that takes
// focus on open, results grouped by kind (jobs, clients, notes, events,
// files), a failed request shown as an error with Retry, never as
// "Nothing matched", and a result that goes to its record.
//
// Uses the same universalSearch lib as the palette so result shapes and
// company scoping stay shared.

import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import { Briefcase, Calendar, ChevronLeft, ChevronRight, FileText, Paperclip, Receipt, Target, Users } from 'lucide-react'
import { universalSearch, type SearchResults } from '../lib/universalSearch.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { useOrgScope, type OrgScope } from '../lib/orgScope.ts'
import type { OrgRole } from '../lib/permissions.ts'
import Field from '../components/fh/Field.tsx'
import Icon from '../components/fh/Icon.tsx'
import IconButton from '../components/fh/IconButton.tsx'
import DataErrorState from '../components/DataErrorState.tsx'
import { hapticTap } from '../lib/haptics.ts'
import './search.css'

const DEBOUNCE_MS = 200

const KIND_META: Record<string, { icon: LucideIcon; heading: string }> = {
  lead: { icon: Target, heading: 'Leads' },
  quote: { icon: FileText, heading: 'Quotes' },
  job: { icon: Briefcase, heading: 'Jobs' },
  invoice: { icon: Receipt, heading: 'Invoices' },
  client: { icon: Users, heading: 'Clients' },
  note: { icon: FileText, heading: 'Notes' },
  event: { icon: Calendar, heading: 'Schedule' },
  file: { icon: Paperclip, heading: 'Files' }
}

// The four records first (D53), then the rest.
const GROUP_ORDER = ['leads', 'quotes', 'jobs', 'invoices', 'clients', 'notes', 'events', 'files']
const GROUP_TO_KIND: Record<string, string> = {
  leads: 'lead', quotes: 'quote', jobs: 'job', invoices: 'invoice', clients: 'client', notes: 'note', events: 'event', files: 'file'
}

export default function Search() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const orgScope = useOrgScope(user?.id)
  const { role, canSeeAllJobs, loading: membershipLoading, error: membershipError, refresh: refreshMembership } = useMembership()
  const [query, setQuery] = useState('')
  // null while idle, a result set once a query has been answered.
  const [snapshot, setSnapshot] = useState<{ userId: string; scope: OrgScope; role: OrgRole; query: string; data: SearchResults } | null>(null)
  // Drop stale rows during the render that changes access or workspace.
  const results = !membershipLoading && !membershipError && snapshot?.userId === user?.id && snapshot?.scope === orgScope && snapshot?.role === role && snapshot?.query === query.trim()
    ? snapshot.data
    : null
  const [searching, setSearching] = useState(false)
  // A failed request is not an empty result: offline on a job site, the
  // old "Nothing matched" made people think the record did not exist.
  const [searchFailed, setSearchFailed] = useState(false)
  const [retryTick, setRetryTick] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => { inputRef.current?.focus({ preventScroll: true }) }, [])

  useEffect(() => {
    const q = query.trim()
    if (!q || !user?.id) { setSnapshot(null); setSearching(false); setSearchFailed(false); return }
    setSearching(true)
    setSearchFailed(false)
    if (membershipLoading || orgScope === undefined) return
    if (membershipError || !role) { setSnapshot(null); setSearching(false); setSearchFailed(true); return }
    let cancelled = false
    const t = setTimeout(async () => {
      try {
        const data = await universalSearch(q, user.id, orgScope, role)
        if (!cancelled) setSnapshot({ userId: user.id, scope: orgScope, role, query: q, data })
      } catch {
        if (!cancelled) {
          setSnapshot(null)
          setSearchFailed(true)
        }
      } finally {
        if (!cancelled) setSearching(false)
      }
    }, DEBOUNCE_MS)
    return () => { cancelled = true; clearTimeout(t) }
  }, [query, user?.id, orgScope, role, membershipLoading, membershipError, retryTick])

  function goBack() {
    hapticTap()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/', { replace: true })
  }

  // The record takes this screen's place in history, so Back from it
  // returns to the page the search started on.
  function go(to: string) {
    hapticTap()
    navigate(to, { replace: true })
  }

  const q = query.trim()
  const searchSubjects = canSeeAllJobs ? 'jobs, clients, notes, events, and files' : 'jobs, notes, events, and files'

  return (
    <div className="fhsr">
      <header className="fhsr-head">
        <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
        <h1 className="fhsr-title">Search</h1>
      </header>

      <div className="fhsr-field">
        <Field
          ref={inputRef}
          label="Search"
          type="search"
          inputMode="search"
          enterKeyHint="search"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder={canSeeAllJobs ? 'Jobs, clients, notes, events, files' : 'Jobs, notes, events, files'}
        />
      </div>

      <div className="fhsr-body">
        {!q && <p className="fhsr-note">Type to search {searchSubjects}.</p>}
        {q && searching && <p className="fhsr-note" aria-live="polite">Searching</p>}
        {q && !searching && searchFailed && (
          <DataErrorState
            compact
            title="Search is unavailable right now."
            message="Check your connection and try again."
            onRetry={() => {
              if (membershipError || !role) void refreshMembership()
              setRetryTick((n) => n + 1)
            }}
          />
        )}
        {q && !searching && !searchFailed && results && results.total === 0 && (
          <p className="fhsr-note">Nothing matched "{q}".</p>
        )}
        {q && results && results.total > 0 && (
          <div className="fhsr-groups">
            {GROUP_ORDER.map((groupKey) => {
              const items = results[groupKey as Exclude<keyof SearchResults, 'total'>]
              if (items.length === 0) return null
              const meta = KIND_META[GROUP_TO_KIND[groupKey]]
              return (
                <section key={groupKey} className="fhsr-group" aria-labelledby={`fhsr-${groupKey}`}>
                  <h2 className="fhsr-group__title" id={`fhsr-${groupKey}`}>{meta.heading}</h2>
                  <ul className="fhsr-list">
                    {items.map((it) => {
                      const kind = KIND_META[it.kind] || KIND_META.note
                      return (
                        <li key={it.id}>
                          <button type="button" className="fhsr-row" onClick={() => go(it.to)}>
                            <span className="fhsr-row__tile" aria-hidden="true"><Icon icon={kind.icon} size={18} /></span>
                            <span className="fhsr-row__text">
                              <span className="fhsr-row__title">{it.title}</span>
                              {it.sub && <span className="fhsr-row__sub">{it.sub}</span>}
                            </span>
                            <Icon icon={ChevronRight} size={18} className="fhsr-row__chevron" />
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </section>
              )
            })}
          </div>
        )}
      </div>
    </div>
  )
}
