import { useMemo } from 'react'
import { Plus, Search, Star } from 'lucide-react'
import { hapticTap, hapticMedium } from '../../lib/haptics.js'
import { ACTIVE_STAGES } from '../../lib/stages.js'

/**
 * DesktopJobsBoard — desktop-first composition for /jobs at >=900px.
 *
 * Phase 7 of the Responsive Desktop Command Center. Replaces the
 * stretched mobile JobCard grid with a real command-center board
 * patterned on _reference/fieldhorse-v3-design/desktop.jsx::DesktopJobs.
 *
 * Layout:
 *   ┌─ page header ────────────────────────────────────────────────┐
 *   │ EYEBROW · counts                       [Filter][Sort][+New]  │
 *   │ Jobs & Pipeline                                              │
 *   │ {n} total · ${k}K in motion · {needs}                        │
 *   ├─ filter row ────────────────────────────────────────────────┤
 *   │ All • Lead • Quote • Active • Won                           │
 *   ├─ jobs grid ────────────────────────────────────────────────┤
 *   │ [FEATURED row-span] [card] [card] [card]                    │
 *   │                     [card] [card] [card]                    │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * The featured card spans 2 grid rows (row-span: 2) per the handoff.
 * Standard cards are dense rows: photo or stage-tinted gradient on
 * top, body has client eyebrow + name + amount/margin + stage pill +
 * 5-segment progress bar + step counter — all real data from props.
 *
 * Data + handlers come in as props from src/screens/Jobs.jsx, which
 * keeps the existing fetch logic, RLS guards, and partner-shared
 * job behavior intact. This component is presentational; it does
 * NOT subscribe, fetch, or write.
 */

const STAGE_COLOR = {
  lead: '#6B7CA8',
  quote: '#B07A4A',
  job: '#4F8C5E',
  active: '#4F8C5E',
  invoice: '#C9963A',
  won: '#C9963A',
  closed: '#5C5C5C',
  lost: '#5C5C5C'
}

const STAGE_STEP = { lead: 1, quote: 2, job: 3, invoice: 4, closed: 5, lost: 0 }
const TOTAL_STAGES = 5

const NEXT_ACTION_HINT = {
  lead:    'Send a quote',
  quote:   'Get approval',
  job:     'Job in progress',
  invoice: 'Awaiting payment',
  closed:  'Closed',
  lost:    null
}

const TABS = [
  { id: 'all',    label: 'All' },
  { id: 'lead',   label: 'Lead' },
  { id: 'quote',  label: 'Quote' },
  { id: 'active', label: 'Active' },
  { id: 'won',    label: 'Complete' }
]

function money(n) {
  const v = Number(n || 0)
  if (!v) return '$0'
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function kFormat(n) {
  const v = Number(n || 0)
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`
  return money(v)
}
function initials(name) {
  if (!name) return '—'
  return String(name).split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}
function stageColor(stage) {
  return STAGE_COLOR[String(stage || 'lead').toLowerCase()] || STAGE_COLOR.lead
}
function stageStep(stage) {
  return STAGE_STEP[String(stage || 'lead').toLowerCase()] ?? 0
}

export default function DesktopJobsBoard({
  contacts,
  filtered,
  loading,
  filter,
  setFilter,
  search,
  setSearch,
  photoUrlByJob,
  featuredId,
  tabCounts,
  onOpenJob,
  onNewLead
}) {
  const summary = useMemo(() => {
    const pipeline = (contacts || [])
      .filter((c) => ACTIVE_STAGES.includes(c.stage))
      .reduce((s, c) => s + Number(c.amount || 0), 0)
    const activeCount = (contacts || []).filter((c) => ACTIVE_STAGES.includes(c.stage)).length
    const needAttention = (contacts || []).filter(
      (c) => c.stage === 'quote' || c.stage === 'lead'
    ).length
    return { pipeline, activeCount, needAttention }
  }, [contacts])

  return (
    <div className="dt-jobs">
      {/* PAGE HEADER */}
      <header className="dt-jobs__head">
        <div className="dt-jobs__head-text">
          <span className="dt-jobs__eyebrow">
            {loading ? 'Loading…' : (
              <>
                <strong>{summary.activeCount}</strong> active
                {summary.pipeline > 0 && <> · <strong>{kFormat(summary.pipeline)}</strong> in motion</>}
                {summary.needAttention > 0 && <> · {summary.needAttention} need eyes today</>}
              </>
            )}
          </span>
          <h1 className="dt-jobs__h1">
            Jobs <em>&amp; Pipeline</em>
          </h1>
        </div>
        <div className="dt-jobs__head-actions">
          <div className="dt-jobs__search">
            <Search size={13} aria-hidden="true" />
            <input
              type="search"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search jobs, contacts, numbers…"
              aria-label="Search jobs"
            />
          </div>
          <button
            type="button"
            className="dt-jobs__primary"
            onClick={() => { hapticMedium(); onNewLead?.() }}
          >
            <Plus size={14} strokeWidth={2.4} />
            <span>New lead</span>
          </button>
        </div>
      </header>

      {/* FILTER ROW */}
      <div className="dt-jobs__filt-row">
        {TABS.map((t) => {
          const count = tabCounts?.[t.id]
          const on = filter === t.id
          return (
            <button
              key={t.id}
              type="button"
              className={`dt-filt${on ? ' dt-filt--on' : ''}`}
              onClick={() => { hapticTap(); setFilter(t.id) }}
            >
              {t.label}
              {count != null && <span className="dt-filt__c">{count}</span>}
            </button>
          )
        })}
        <div className="dt-jobs__filt-spacer" />
        {/* Phase 11 stabilization: removed disabled "Filter" + "Recency"
            placeholder buttons — they read as broken Coming Soon
            controls. Real advanced filter / sort UX lands when the
            features ship. */}
      </div>

      {/* JOBS GRID */}
      <div className="dt-jobs__grid">
        {loading && Array.from({ length: 6 }).map((_, i) => (
          <div key={`sk-${i}`} className="dt-job dt-job--skeleton" aria-hidden="true">
            <div className="dt-job__photo dt-job__photo--placeholder" />
            <div className="dt-job__body">
              <div className="dt-job__sk-line" style={{ width: '40%' }} />
              <div className="dt-job__sk-line" style={{ width: '70%', height: 16 }} />
              <div className="dt-job__sk-line" style={{ width: '30%', marginTop: 8 }} />
            </div>
          </div>
        ))}
        {!loading && filtered.length === 0 && (
          <div className="dt-jobs__empty">
            <p>{filter !== 'all' || search ? 'No jobs match that filter.' : 'No jobs on the board.'}</p>
            <button type="button" className="dt-jobs__primary" onClick={() => { hapticMedium(); onNewLead?.() }}>
              <Plus size={14} strokeWidth={2.4} /> Add first lead
            </button>
          </div>
        )}
        {!loading && filtered.map((c) => {
          const isFeatured = c.id === featuredId
          const photo = photoUrlByJob?.[c.id]
          const stage = String(c.stage || 'lead').toLowerCase()
          const step = stageStep(c.stage)
          const sc = stageColor(c.stage)
          const next = NEXT_ACTION_HINT[stage]
          return (
            <button
              key={c.id}
              type="button"
              className={`dt-job${isFeatured ? ' dt-job--feature' : ''}`}
              onClick={() => { hapticTap(); onOpenJob?.(c) }}
            >
              <div className="dt-job__photo">
                {photo ? (
                  <img src={photo} alt="" loading="lazy" />
                ) : (
                  <span className="dt-job__photo-mark" style={{ background: `linear-gradient(135deg, ${sc}EE, ${sc}99)` }}>
                    {initials(c.name)}
                  </span>
                )}
                {isFeatured && (
                  <span className="dt-job__topdeal">
                    <Star size={10} aria-hidden="true" /> TOP DEAL
                  </span>
                )}
              </div>
              <div className="dt-job__body">
                <div className="dt-job__client">{(c.client_name || c.fh_clients?.name || c.name || 'CLIENT').toUpperCase()}</div>
                <div className="dt-job__name">{c.job_title || c.job_type || c.name || 'Untitled'}</div>
                {isFeatured && next && (
                  <div className="dt-job__next">
                    <span className="dt-job__next-dot" />
                    <span><strong>Next:</strong> {next}</span>
                  </div>
                )}
                <div className="dt-job__row">
                  <span className="dt-job__amt">{money(c.amount)}</span>
                  {next && !isFeatured && (
                    <span className="dt-job__hint">{next}</span>
                  )}
                </div>
                <div className="dt-job__foot">
                  <span className={`dt-stage-pill dt-stage-pill--${stage}`}>{stage.toUpperCase()}</span>
                  <div className="dt-stage-bar" aria-hidden="true">
                    {Array.from({ length: TOTAL_STAGES }).map((_, k) => (
                      <span
                        key={k}
                        className={`dt-stage-bar__seg${k < step ? ' is-on' : ''}`}
                        style={k < step ? { background: sc } : undefined}
                      />
                    ))}
                  </div>
                  <span className="dt-stage-step">{step}/{TOTAL_STAGES}</span>
                </div>
              </div>
            </button>
          )
        })}
      </div>
    </div>
  )
}
