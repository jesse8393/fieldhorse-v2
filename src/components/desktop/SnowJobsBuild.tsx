// SnowJobsBuild — desktop /jobs in the "LET'S BUILD" direction.
//
// Drop-in for SnowJobs at >=900px. Same props, same handlers — only
// the visual model changes: dark onyx surface, gold accents, compact
// command-center tables, right-side KPI rail. Built on top of the
// shared .fh-build-* CSS already in global.css plus this file's
// page-specific table grid.
//
// Includes a small view toggle (Table | Pipeline) — when Pipeline is
// selected the page renders SnowPipelineBuild against the same
// contacts array. This is how the sidebar's "Lead Desk" / "Pipeline"
// items show up in the dashboard without adding a new route.

import { useEffect, useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import {
  ArrowUpRight,
  Bell,
  ChevronRight,
  Hammer,
  LayoutList,
  Plus,
  Search,
  TrendingUp,
  KanbanSquare,
} from 'lucide-react'
import SnowPipelineBuild from './SnowPipelineBuild.tsx'
import { money, moneyFull } from '../../lib/format.ts'
import MiniMetric from '../MiniMetric.tsx'

// Map the rail's stage-grouping keys to the parent screen's TABS ids
// so clicking a stage row actually narrows the table.
function stageKeyToFilter(stageKey: string): string {
  if (stageKey === 'job' || stageKey === 'invoice') return 'active'
  if (stageKey === 'closed') return 'closed'
  return stageKey
}

type Props = {
  contacts: any[]
  filtered: any[]
  loading: boolean
  filter: string
  setFilter: (s: string) => void
  search: string
  setSearch: (s: string) => void
  photoUrlByJob?: Record<string, string>
  featuredId?: string | null
  tabCounts: Record<string, number>
  onOpenJob: (id: string) => void
  onNewLead: () => void
}

// Pipeline v2: this board shows jobs only (leads live on /leads), so
// "active" = running jobs. 'invoice' matches legacy pre-migration rows
// as an alias of 'job'.
const ACTIVE_STAGES = ['job', 'invoice']

function relTime(iso: any) {
  if (!iso) return '—'
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return '—'
  const diff = Date.now() - t
  if (diff < 60_000) return 'just now'
  if (diff < 3_600_000) return `${Math.floor(diff / 60_000)}m ago`
  if (diff < 86_400_000) return `${Math.floor(diff / 3_600_000)}h ago`
  if (diff < 7 * 86_400_000) return `${Math.floor(diff / 86_400_000)}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// Keys MUST match the parent screen's TABS ids in Jobs.tsx:
//   all, lead, quote, active (= stage 'job'), won (= stage 'invoice'|'closed')
// If these drift the parent's `filtered` memo falls back to TABS[0]
// and every filter pill behaves like "All".
const FILTERS: { key: string; label: string }[] = [
  { key: 'all',    label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'closed', label: 'Complete' },
]

export default function SnowJobsBuild(props: Props) {
  const {
    contacts, filtered, loading, filter, setFilter, search, setSearch,
    tabCounts, onOpenJob, onNewLead,
  } = props

  const navigate = useNavigate()
  const location = useLocation()

  // Lead Desk is its own route now (/leads, pipeline v2). This board is
  // always the Job Desk; ?view=pipeline still flips the kanban on.
  const params = new URLSearchParams(location.search)
  const routeView = params.get('view') // 'jobs' | 'pipeline' | null

  const [view, setView] = useState<'table' | 'pipeline'>(routeView === 'pipeline' ? 'pipeline' : 'table')

  // KPI strip — pipeline $, active count, need-eyes count, won YTD $
  const kpi = useMemo(() => {
    const pipeline = contacts
      .filter((c) => ACTIVE_STAGES.includes(c.stage as string))
      .reduce((s, c) => s + Number(c.amount || 0), 0)
    const active = contacts.filter((c) => ACTIVE_STAGES.includes(c.stage as string)).length
    const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
    const needEyes = contacts.filter((c) => {
      if (!ACTIVE_STAGES.includes(c.stage as string)) return false
      const last = new Date(c.updated_at || c.created_at || 0).getTime()
      return Number.isFinite(last) && last < sevenDaysAgo
    }).length
    const yearStart = new Date(new Date().getFullYear(), 0, 1).getTime()
    // Won = closed only. Invoicing deals are still active (money owed,
    // they're in ACTIVE_STAGES above) — counting them in both "Active
    // Pipeline" and "Won YTD" double-reported them and made this KPI
    // disagree with the Command Center rail's "Won" column ($113k vs
    // $98k in the Jun 10 spot-check).
    const wonYTD = contacts
      .filter((c) => c.stage === 'closed')
      .filter((c) => {
        const t = new Date(c.updated_at || c.created_at || 0).getTime()
        return Number.isFinite(t) && t >= yearStart
      })
      .reduce((s, c) => s + Number(c.amount || 0), 0)
    return { pipeline, active, needEyes, wonYTD }
  }, [contacts])

  // Right rail: stage counts (jobs only — leads have their own desk)
  const stages = useMemo(() => {
    const map: Record<string, { count: number; total: number; label: string }> = {
      job:     { count: 0, total: 0, label: 'Active' },
      invoice: { count: 0, total: 0, label: 'Awaiting payment' },
      closed:  { count: 0, total: 0, label: 'Complete' },
    }
    for (const c of contacts) {
      const s = String(c.stage || '').toLowerCase()
      if (s in map) {
        map[s].count++
        map[s].total += Number(c.amount || 0)
      }
    }
    return Object.entries(map).map(([key, v]) => ({ key, ...v }))
  }, [contacts])

  return (
    <div className="fh-build-page" data-build-screen="SnowJobsBuild">
      <header className="fh-build-topbar">
        <div className="fh-build-search">
          <Search size={14} />
          <input
            className="fh-build-search__input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search jobs, clients, invoices, notes..."
          />
          <kbd>⌘K</kbd>
        </div>
        <div className="fh-build-topbar__meta">
          <span>{contacts.length.toLocaleString()} contacts in book</span>
          <span className="fh-build-vline" />
          <span style={{ opacity: 0.6 }}>Weather not set</span>
        </div>
        <button
          className="fh-build-icon-btn"
          type="button"
          onClick={() => navigate('/activity')}
          aria-label="Open activity"
          title="Activity"
        >
          <Bell size={16} />
        </button>
        <button className="fh-build-new-btn" type="button" onClick={onNewLead}>
          {/* CTA label tracks the active filter so Job Desk ("Doing"
              or "Complete") shows "+ New Job" and Lead Desk ("Lead"
              or "Quote") shows "+ New Lead". "All" stays on the
              broader "New Lead" since that's still the most common
              entry. */}
          <Plus size={15} /> New Job
        </button>
      </header>

      <main className="fh-build-main">
        {/* Hero row — title + view picker + KPIs */}
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Job Desk</div>
            <h1 className="fh-build-title">RUN THE WORK.</h1>
          </div>

          <div className="fh-build-view-card">
            <div className="fh-build-eyebrow">View</div>
            <div className="fh-build-view-toggle">
              <button
                type="button"
                className={view === 'table' ? 'is-active' : ''}
                onClick={() => setView('table')}
              >
                <LayoutList size={13} /> Table
              </button>
              <button
                type="button"
                className={view === 'pipeline' ? 'is-active' : ''}
                onClick={() => setView('pipeline')}
              >
                <KanbanSquare size={13} /> Pipeline
              </button>
            </div>
            <p className="fh-build-view-card__copy">
              {view === 'table'
                ? `${filtered.length} jobs visible · ${FILTERS.find((f) => f.key === filter)?.label || 'All'}`
                : `Drag-and-drop coming soon. Read-only kanban for now.`}
            </p>
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Active contracts" value={money(kpi.pipeline)} />
            <MiniMetric label="Active jobs" value={String(kpi.active)} />
            <MiniMetric label="Need eyes (7d)" value={String(kpi.needEyes)} />
            <MiniMetric label="Won YTD" value={money(kpi.wonYTD)} />
          </div>
        </section>

        {/* Filter pills row */}
        <div className="fh-build-filterbar">
          {FILTERS.map((f) => {
            const count = f.key === 'all' ? contacts.length : (tabCounts[f.key] || 0)
            const active = filter === f.key
            return (
              <button
                key={f.key}
                type="button"
                className={`fh-build-pill${active ? ' is-active' : ''}`}
                onClick={() => setFilter(f.key)}
              >
                {f.label}
                <span className="fh-build-pill__count">{count}</span>
              </button>
            )
          })}
        </div>

        {view === 'pipeline' ? (
          <SnowPipelineBuild contacts={contacts} onOpenJob={onOpenJob} onNewLead={onNewLead} />
        ) : (
          <section className="fh-build-content-grid fh-build-content-grid--jobs">
            <section className="fh-build-card fh-build-table fh-build-jobs-table">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">
                  All jobs · {filtered.length.toLocaleString()}
                </div>
                <button type="button">Export CSV</button>
              </header>

              <div className="fh-build-table__head is-jobs">
                <span>Job</span>
                <span>Client</span>
                <span>Stage</span>
                <span>Amount</span>
                <span>Updated</span>
                <span />
              </div>

              {loading && (
                <div className="fh-build-table__empty">Loading jobs…</div>
              )}
              {!loading && filtered.length === 0 && (
                <div className="fh-build-table__empty">No jobs match. Adjust the filter or hit <button type="button" className="fh-build-inline-link" onClick={onNewLead}>+ New Job</button>.</div>
              )}
              {!loading && filtered.slice(0, 50).map((c: any) => (
                <button
                  key={c.id}
                  type="button"
                  className="fh-build-table__row is-jobs"
                  onClick={() => onOpenJob(c.id)}
                >
                  <strong className="fh-build-truncate" title={c.name}>{c.name || 'Untitled'}</strong>
                  <span className="fh-build-truncate">
                    {c.job_title || c.job_type || '—'}
                  </span>
                  <span><StagePill stage={c.stage} /></span>
                  <span className="fh-build-num">{moneyFull(c.amount || 0)}</span>
                  <span className="fh-build-rel">
                    {relTime(c.updated_at || c.created_at)}
                  </span>
                  <ChevronRight size={13} />
                </button>
              ))}

              {!loading && filtered.length > 50 && (
                <div className="fh-build-table__more">
                  Showing first 50 of {filtered.length.toLocaleString()}. Refine the filter to narrow.
                </div>
              )}
            </section>

            <aside className="fh-build-rail fh-build-rail--page">
              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">Stage breakdown</div>
                <div className="fh-build-stage-rows">
                  {stages.map((s) => (
                    <button
                      key={s.key}
                      type="button"
                      className="fh-build-stage-row"
                      onClick={() => setFilter(stageKeyToFilter(s.key))}
                    >
                      <span className={`fh-build-dot is-${stageTone(s.key)}`}>{s.label}</span>
                      <span className="fh-build-stage-row__count">{s.count}</span>
                      <span className="fh-build-stage-row__money">{money(s.total)}</span>
                    </button>
                  ))}
                </div>
              </section>

              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">Need attention</div>
                <strong>{kpi.needEyes}</strong>
                <span>jobs untouched 7+ days</span>
                <button
                  type="button"
                  className="fh-build-rail-card__action"
                  onClick={() => navigate('/leads')}
                >
                  Review leads <ChevronRight size={13} />
                </button>
              </section>

              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">Won this year</div>
                <strong>{money(kpi.wonYTD)}</strong>
                <span>booked revenue</span>
                <div className="fh-build-rail-card__spark">
                  <TrendingUp size={14} />
                  <span>tracking ahead</span>
                </div>
              </section>
            </aside>
          </section>
        )}
      </main>
    </div>
  )
}

function StagePill({ stage }: { stage: any }) {
  const s = String(stage || '').toLowerCase()
  const map: Record<string, { label: string; tone: string }> = {
    lead:    { label: 'Lead',     tone: 'warn' },
    quote:   { label: 'Quote',    tone: 'good' },
    job:     { label: 'Active',   tone: 'good' },
    invoice: { label: 'Invoicing',tone: 'warn' },
    closed:  { label: 'Closed',   tone: 'neutral' },
  }
  const entry = map[s] || { label: stage || '—', tone: 'neutral' }
  return <span className={`fh-build-dot is-${entry.tone}`}>{entry.label}</span>
}

function stageTone(key: string) {
  switch (key) {
    case 'lead':    return 'warn'
    case 'quote':   return 'good'
    case 'job':     return 'good'
    case 'invoice': return 'warn'
    default:        return 'neutral'
  }
}

// Silence "imported but not used" warnings for icons reserved for
// future use in this file.
void ArrowUpRight; void Hammer
