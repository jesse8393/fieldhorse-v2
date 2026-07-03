// DetailListRail — desktop master-detail list rail (≥1200px).
//
// Sits to the left of the job/lead/quote detail so the operator can flip
// between records without bouncing back to the board — the email-client
// pattern. The URL stays the single source of truth: every row is a plain
// navigate() to the exact same routes the list screens use, and the rail
// derives its surface (jobs / leads / quotes) from the current pathname.
// Reuses the cached useJobs() query, so mounting the rail costs zero
// extra network on top of what the boards already fetched.
//
// The rail itself persists across detail navigations (it lives OUTSIDE
// the keyed ContactDetail in App.tsx), so its scroll position and search
// text survive while the detail pane remounts clean per record.

import { useMemo, useState } from 'react'
import { useLocation, useNavigate, useParams } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Search } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useJobs, useJobsRealtime } from '../../lib/queries.ts'
import { useInfiniteRender } from '../../lib/useInfiniteRender.ts'
import { hapticTap } from '../../lib/haptics.ts'

const STAGE_META: Record<string, { label: string; color: string }> = {
  lead:    { label: 'Lead',     color: 'var(--v3-stage-lead, #6B7CA8)' },
  quote:   { label: 'Quote',    color: 'var(--v3-stage-quote, #C9963A)' },
  job:     { label: 'Active',   color: 'var(--v3-stage-active, #7BB58E)' },
  invoice: { label: 'Active',   color: 'var(--v3-stage-active, #7BB58E)' },
  closed:  { label: 'Complete', color: 'var(--v3-success-bright, #7BB58E)' },
  lost:    { label: 'Lost',     color: 'var(--v3-text-muted, rgba(242, 237, 228, 0.55))' }
}

function money(n: any) {
  const v = Number(n || 0)
  if (!v) return ''
  if (v >= 1000) return `$${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}K`
  return `$${Math.round(v).toLocaleString()}`
}

export default function DetailListRail() {
  const { id: currentId } = useParams()
  const location = useLocation()
  const navigate = useNavigate()
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const { data: contacts = [] } = useJobs()
  // Keep the rail live: without this, a rename or new record made while
  // parked on a detail page would show stale until the next board visit.
  useJobsRealtime(user?.id, queryClient)
  const [search, setSearch] = useState('')

  const surface = location.pathname.startsWith('/leads')
    ? 'leads'
    : location.pathname.startsWith('/quotes')
      ? 'quotes'
      : 'jobs'

  // Same stage buckets the corresponding board screens use.
  const rows = useMemo(() => {
    let list = contacts.filter((c: any) =>
      surface === 'leads'
        ? (c.stage === 'lead' || c.stage === 'quote' || c.stage === 'lost')
        : surface === 'quotes'
          ? c.stage === 'quote'
          : (c.stage === 'job' || c.stage === 'invoice' || c.stage === 'closed')
    )
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((c: any) =>
        [c.name, c.job_title, c.address, c.phone]
          .filter(Boolean)
          .some((s: any) => String(s).toLowerCase().includes(q))
      )
    }
    return [...list].sort((a: any, b: any) =>
      new Date(b.updated_at || b.created_at || 0).getTime()
      - new Date(a.updated_at || a.created_at || 0).getTime()
    )
  }, [contacts, surface, search])

  const { visible, sentinelRef, hasMore } = useInfiniteRender(rows, `${surface}|${search}`)

  // Route with the same logic each board uses, so a quote-stage lead
  // opens in the quote workspace, etc.
  function open(c: any) {
    if (c.id === currentId) return
    hapticTap()
    if (surface === 'quotes' || c.stage === 'quote') navigate(`/quotes/${c.id}?tab=quote`)
    else if (surface === 'leads' || c.stage === 'lead' || c.stage === 'lost') navigate(`/leads/${c.id}`)
    else navigate(`/jobs/${c.id}`)
  }

  const title = surface === 'leads' ? 'Leads' : surface === 'quotes' ? 'Quotes' : 'Jobs'

  return (
    <nav className="fh-detail-rail" aria-label={`${title} list`}>
      <div className="fh-detail-rail__head">
        <button
          type="button"
          className="fh-detail-rail__title"
          onClick={() => navigate(`/${surface}`)}
          title={`Back to the ${title} board`}
        >
          {title}
          <span className="fh-detail-rail__count">{rows.length}</span>
        </button>
        <div className="fh-detail-rail__search">
          <Search size={13} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={`Search ${title.toLowerCase()}…`}
            aria-label={`Search ${title.toLowerCase()}`}
            autoComplete="off"
          />
        </div>
      </div>

      <ul className="fh-detail-rail__list">
        {visible.map((c: any) => {
          const meta = STAGE_META[c.stage] || STAGE_META.job
          const amt = money(c.amount)
          const isActive = c.id === currentId
          return (
            <li key={c.id}>
              <button
                type="button"
                className={`fh-detail-rail__row${isActive ? ' is-active' : ''}`}
                onClick={() => open(c)}
                aria-current={isActive ? 'page' : undefined}
              >
                <span className="fh-detail-rail__dot" style={{ background: meta.color }} aria-hidden="true" />
                <span className="fh-detail-rail__body">
                  <span className="fh-detail-rail__name">{c.name || 'Unnamed'}</span>
                  <span className="fh-detail-rail__sub">
                    {c.job_title || meta.label}
                  </span>
                </span>
                {amt && <span className="fh-detail-rail__amt">{amt}</span>}
              </button>
            </li>
          )
        })}
        {hasMore && <li ref={sentinelRef as any} aria-hidden="true" style={{ height: 1 }} />}
        {rows.length === 0 && (
          <li className="fh-detail-rail__empty">
            {search ? 'No matches.' : `No ${title.toLowerCase()} yet.`}
          </li>
        )}
      </ul>
    </nav>
  )
}
