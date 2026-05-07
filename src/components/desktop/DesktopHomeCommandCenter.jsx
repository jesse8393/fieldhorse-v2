import { useMemo } from 'react'
import {
  CloudSun, MapPin, ArrowUpRight, ArrowDownRight,
  ArrowRight, ChevronRight, AlertTriangle, Zap, Receipt,
  CalendarClock, Plus, Sparkles
} from 'lucide-react'
import { hapticTap } from '../../lib/haptics.js'

/**
 * DesktopHomeCommandCenter — Phase 10 desktop composition for / at >=900px.
 *
 * Mirrors _reference/fieldhorse-v3-design/desktop.jsx::DesktopHome but
 * uses real Home data via props. Below 900px Home.jsx renders the
 * existing mobile motion.div tree verbatim.
 *
 *   ┌─ greeting strip ──────────────────────────────────────────────┐
 *   │ {date} eyebrow · weather chip                                 │
 *   │ Good morning, {Name}.                                         │
 *   │ {summary line: crews on / pipeline / invoicing}              │
 *   ├─ hero + priorities (2fr / 1fr) ─────────────────────────────┤
 *   │ ┌─────────── pipeline hero ─────────────┐  ┌─ priorities ─┐ │
 *   │ │ Today's revenue opportunity            │  │ Follow-ups   │ │
 *   │ │ $XXX,XXX                       trend↑  │  │ Quotes       │ │
 *   │ │  (sparkline placeholder bar)           │  │ Invoicing    │ │
 *   │ │  Won · {n}  Active · {n}  Lead · {n}   │  └──────────────┘ │
 *   │ └────────────────────────────────────────┘                    │
 *   ├─ today on site (2fr) + pipeline preview (1fr) ──────────────┤
 *   │ ┌─────────── today on site ─────────────┐  ┌─ pipeline ───┐ │
 *   │ │ time · client · meta · status pill     │  │ deal · stage │ │
 *   │ │ time · client · meta · status pill     │  │  · amount     │ │
 *   │ └────────────────────────────────────────┘  └──────────────┘ │
 *   ├─ next actions (full width list) ────────────────────────────┤
 *   │ urgency · title · meta                              [→]      │
 *   └─────────────────────────────────────────────────────────────┘
 */

function money(n) {
  const v = Number(n || 0)
  if (!v) return '$0'
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function shortMoney(n) {
  const v = Number(n || 0)
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 10_000) return `$${Math.round(v / 1_000)}K`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return money(v)
}

function greetingPrefix() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function relTime(ms) {
  const t = ms instanceof Date ? ms.getTime() : Number(ms)
  if (!Number.isFinite(t)) return ''
  const d = new Date(t)
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

function stageColorVar(stage) {
  const k = String(stage || 'lead').toLowerCase()
  if (k === 'lead') return '#6B7CA8'
  if (k === 'quote') return '#B07A4A'
  if (k === 'job') return '#4F8C5E'
  if (k === 'invoice') return '#C9963A'
  if (k === 'closed') return '#5C5C5C'
  if (k === 'lost') return '#5C5C5C'
  return '#6B7CA8'
}

export default function DesktopHomeCommandCenter({
  // Identity
  firstName,
  // Time
  now,
  // Weather
  hasCoords,
  tempStr,
  condStr,
  weatherErr,
  pinLocation,
  // KPI / pipeline
  pipeline,
  trendUp,
  trendPct,
  stageBreakdown,
  dealsAtRisk,
  jobsBehind,
  invoicingWeek,
  // Lists
  todayOnSite,
  topPipeline,
  nextActions,
  // Navigation handlers
  onGoToJobs,
  onGoToSchedule,
  onGoToInvoices,
  onGoToBid,
  onGoToCompose,
  onGoToPourWindow,
  onOpenJob,
  onOpenJobAtTab,
  onNewLead
}) {
  const greeting = useMemo(() => `${greetingPrefix()}, ${firstName || 'there'}.`, [firstName])
  const dateLabel = useMemo(() => (now || new Date()).toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric'
  }), [now])

  const pipelineLoaded = pipeline != null
  const breakdown = stageBreakdown || { won: 0, active: 0, lead: 0 }
  const todayCount = todayOnSite?.length || 0
  const summaryBits = []
  if (todayCount > 0) summaryBits.push(`${todayCount} on site today`)
  if (pipelineLoaded && pipeline > 0) summaryBits.push(`${shortMoney(pipeline)} pipeline`)
  if (invoicingWeek != null && invoicingWeek > 0) summaryBits.push(`${shortMoney(invoicingWeek)} invoicing this week`)

  const followUps = dealsAtRisk?.followUps || 0
  const quotesAttention = dealsAtRisk?.quotesAttention || 0

  return (
    <div className="dt-home">
      {/* GREETING STRIP */}
      <header className="dt-home__head">
        <div className="dt-home__head-text">
          <span className="dt-home__eyebrow">{dateLabel}</span>
          <h1 className="dt-home__h1">
            {greetingPrefix()}, <em>{firstName || 'there'}.</em>
          </h1>
          {summaryBits.length > 0 && (
            <p className="dt-home__sub">
              {summaryBits.join(' · ')}
            </p>
          )}
        </div>
        {hasCoords ? (
          <button
            type="button"
            className="dt-home__weather"
            onClick={() => { hapticTap(); onGoToPourWindow?.() }}
            title="Open weather forecast"
          >
            <CloudSun size={18} aria-hidden="true" />
            <div className="dt-home__weather-text">
              <span className="dt-home__weather-temp">{tempStr}</span>
              {condStr && <span className="dt-home__weather-cond">{condStr}</span>}
            </div>
          </button>
        ) : (
          <button
            type="button"
            className="dt-home__weather dt-home__weather--unset"
            onClick={() => { hapticTap(); pinLocation?.() }}
            title="Pin location for weather"
          >
            <MapPin size={14} aria-hidden="true" />
            <span>{weatherErr || 'Pin location'}</span>
          </button>
        )}
      </header>

      {/* HERO + PRIORITIES */}
      <div className="dt-home__row dt-home__row--hero">
        <section className="dt-card dt-home__pipeline" aria-label="Pipeline">
          <div className="dt-home__pipeline-head">
            <span className="dt-home__pipeline-eyebrow">Today's revenue opportunity</span>
            {trendPct != null && (
              <span className={`dt-home__trend${trendUp ? ' dt-home__trend--up' : ' dt-home__trend--down'}`}>
                {trendUp ? <ArrowUpRight size={11} aria-hidden="true" /> : <ArrowDownRight size={11} aria-hidden="true" />}
                {Math.abs(trendPct)}% vs last 7d
              </span>
            )}
          </div>
          <div className="dt-home__pipeline-amt-row">
            <span className="dt-home__pipeline-amt">
              {pipelineLoaded ? money(pipeline) : '—'}
            </span>
            <span className="dt-home__pipeline-tag">Total pipeline</span>
          </div>

          {/* Compact gold sparkline-style ribbon — visual rhythm only,
              not a real chart. Real charting lands when we wire trend
              points; for now this carries the aesthetic from the
              handoff without faking data. */}
          <div className="dt-home__sparkline" aria-hidden="true">
            <svg viewBox="0 0 800 60" preserveAspectRatio="none" width="100%" height="60">
              <defs>
                <linearGradient id="dt-home-spark" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#E4BE6F" stopOpacity="0.32"/>
                  <stop offset="100%" stopColor="#E4BE6F" stopOpacity="0"/>
                </linearGradient>
              </defs>
              {/* A gentle flat baseline that subtly rises — not a fake
                  data series, just visual texture matching the reference. */}
              <path d="M0,48 L80,46 L160,42 L240,40 L320,36 L400,38 L480,30 L560,28 L640,22 L720,18 L800,14 L800,60 L0,60 Z" fill="url(#dt-home-spark)"/>
              <path d="M0,48 L80,46 L160,42 L240,40 L320,36 L400,38 L480,30 L560,28 L640,22 L720,18 L800,14" fill="none" stroke="#E4BE6F" strokeWidth="1.4" opacity="0.55"/>
            </svg>
          </div>

          <div className="dt-home__pipeline-foot">
            <PipelineStat label="Won" count={breakdown.won} color="var(--field-gold-bright)" />
            <PipelineStat label="Active" count={breakdown.active} color="#6FB387" />
            <PipelineStat label="Lead" count={breakdown.lead} color="#91A4D4" />
          </div>
        </section>

        <section className="dt-card dt-home__priorities" aria-label="Today's priorities">
          <div className="dt-home__priorities-head">
            <span className="dt-home__priorities-eyebrow">Today's priorities</span>
            <button type="button" className="dt-home__link" onClick={() => { hapticTap(); onGoToJobs?.() }}>
              View all
            </button>
          </div>
          <PrioRow
            icon={AlertTriangle}
            count={followUps}
            label="Follow-ups"
            sub="Leads gone cold"
            tone={followUps > 0 ? 'alert' : 'muted'}
            onClick={() => onGoToJobs?.('lead')}
          />
          <PrioRow
            icon={Zap}
            count={quotesAttention}
            label="Quotes"
            sub="Need attention"
            tone={quotesAttention > 0 ? 'warn' : 'muted'}
            onClick={() => onGoToJobs?.('quote')}
          />
          <PrioRow
            icon={Receipt}
            count={null}
            valueLabel={shortMoney(invoicingWeek || 0)}
            label="Invoicing"
            sub="Collected this week"
            tone="gold"
            onClick={onGoToInvoices}
          />
          {jobsBehind != null && jobsBehind > 0 && (
            <PrioRow
              icon={CalendarClock}
              count={jobsBehind}
              label="Behind"
              sub="Jobs need a reschedule"
              tone="alert"
              onClick={() => onGoToJobs?.('active')}
            />
          )}
        </section>
      </div>

      {/* TODAY ON SITE + PIPELINE PREVIEW */}
      <div className="dt-home__row dt-home__row--site">
        <section className="dt-card dt-home__site" aria-label="Today on site">
          <div className="dt-home__site-head">
            <span className="dt-home__priorities-eyebrow">Today on site</span>
            <button type="button" className="dt-home__link" onClick={() => { hapticTap(); onGoToSchedule?.() }}>
              View schedule <ChevronRight size={11} aria-hidden="true" />
            </button>
          </div>
          {todayCount === 0 ? (
            <p className="dt-home__empty">No site visits scheduled today.</p>
          ) : (
            <ul className="dt-home__site-list">
              {todayOnSite.slice(0, 6).map((row) => (
                <li
                  key={row.id}
                  className="dt-home__site-row"
                  onClick={() => { if (row.contactId) { hapticTap(); onOpenJob?.(row.contactId) } }}
                  role={row.contactId ? 'button' : undefined}
                  tabIndex={row.contactId ? 0 : undefined}
                  onKeyDown={(e) => {
                    if (row.contactId && (e.key === 'Enter' || e.key === ' ')) {
                      e.preventDefault(); onOpenJob?.(row.contactId)
                    }
                  }}
                  style={{ cursor: row.contactId ? 'pointer' : 'default' }}
                >
                  <div className="dt-home__site-time">
                    <span className="dt-home__site-hr">{relTime(row.startAt)}</span>
                  </div>
                  <span className="dt-home__site-rule" style={{ background: stageColorVar(row.stage) }} />
                  <div className="dt-home__site-main">
                    <span className="dt-home__site-name">{row.clientName || row.title}</span>
                    {row.title && row.clientName && row.title !== row.clientName && (
                      <span className="dt-home__site-meta">{row.title}</span>
                    )}
                  </div>
                  {row.stage && (
                    <span className="dt-pill dt-pill--gold">
                      {String(row.stage).toUpperCase()}
                    </span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="dt-card dt-home__pipe" aria-label="Pipeline preview">
          <div className="dt-home__pipe-head">
            <span className="dt-home__priorities-eyebrow">Pipeline preview</span>
            <button type="button" className="dt-home__link" onClick={() => { hapticTap(); onGoToJobs?.() }}>
              View all <ChevronRight size={11} aria-hidden="true" />
            </button>
          </div>
          {!topPipeline || topPipeline.length === 0 ? (
            <p className="dt-home__empty">No active deals.</p>
          ) : (
            <ul className="dt-home__pipe-list">
              {topPipeline.map((deal) => {
                const sc = stageColorVar(deal.stage)
                const stage = String(deal.stage || 'lead').toLowerCase()
                return (
                  <li key={deal.id}>
                    <button
                      type="button"
                      className="dt-home__pipe-row"
                      onClick={() => { hapticTap(); onOpenJob?.(deal.id) }}
                    >
                      <span className="dt-home__pipe-rule" style={{ background: sc }} />
                      <div className="dt-home__pipe-main">
                        <span className="dt-home__pipe-name">{deal.name}</span>
                        <span className="dt-home__pipe-stage">{stage.toUpperCase()}</span>
                      </div>
                      <span className="dt-home__pipe-amt">{shortMoney(deal.amount)}</span>
                      <ChevronRight size={12} aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </section>
      </div>

      {/* NEXT ACTIONS — full-width list */}
      {Array.isArray(nextActions) && nextActions.length > 0 && (
        <section className="dt-card dt-home__actions" aria-label="Next actions">
          <div className="dt-home__actions-head">
            <span className="dt-home__priorities-eyebrow">Next actions · {nextActions.length}</span>
            <span className="dt-home__actions-hint">Sorted by urgency</span>
          </div>
          <ul className="dt-home__actions-list">
            {nextActions.map((a) => (
              <li key={a.id}>
                <button
                  type="button"
                  className={`dt-home__action-row dt-home__action-row--${a.urgencyTone || 'muted'}`}
                  onClick={() => { if (a.contactId) { hapticTap(); onOpenJob?.(a.contactId) } }}
                >
                  <span className={`dt-home__action-tag dt-home__action-tag--${a.urgencyTone || 'muted'}`}>
                    {a.urgencyLabel || (a.kind || '').toUpperCase()}
                  </span>
                  <div className="dt-home__action-main">
                    <span className="dt-home__action-title">{a.title}</span>
                    {a.detail && <span className="dt-home__action-detail">{a.detail}</span>}
                  </div>
                  <ArrowRight size={13} aria-hidden="true" />
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* QUICK ACTIONS — desktop spotlight row */}
      <section className="dt-home__quick" aria-label="Quick actions">
        <button type="button" className="dt-home__quick-tile dt-home__quick-tile--primary" onClick={() => { hapticTap(); onNewLead?.() }}>
          <span className="dt-home__quick-icon"><Plus size={18} aria-hidden="true" /></span>
          <span className="dt-home__quick-label">New lead</span>
          <span className="dt-home__quick-sub">Capture a new opportunity</span>
        </button>
        <button type="button" className="dt-home__quick-tile" onClick={() => { hapticTap(); onGoToBid?.() }}>
          <span className="dt-home__quick-icon"><Receipt size={16} aria-hidden="true" /></span>
          <span className="dt-home__quick-label">Estimate</span>
          <span className="dt-home__quick-sub">Build a quick bid</span>
        </button>
        <button type="button" className="dt-home__quick-tile" onClick={() => { hapticTap(); onGoToCompose?.() }}>
          <span className="dt-home__quick-icon"><Sparkles size={16} aria-hidden="true" /></span>
          <span className="dt-home__quick-label">AI Compose</span>
          <span className="dt-home__quick-sub">Draft a message</span>
        </button>
        <button type="button" className="dt-home__quick-tile" onClick={() => { hapticTap(); onGoToSchedule?.() }}>
          <span className="dt-home__quick-icon"><CalendarClock size={16} aria-hidden="true" /></span>
          <span className="dt-home__quick-label">Schedule</span>
          <span className="dt-home__quick-sub">Plan the next visit</span>
        </button>
      </section>
    </div>
  )
}

function PipelineStat({ label, count, color }) {
  return (
    <div className="dt-home__pipeline-stat">
      <span className="dt-home__pipeline-stat-dot" style={{ background: color, boxShadow: `0 0 8px ${color}66` }} />
      <div className="dt-home__pipeline-stat-text">
        <span className="dt-home__pipeline-stat-num">{count ?? '—'}</span>
        <span className="dt-home__pipeline-stat-label">{label}</span>
      </div>
    </div>
  )
}

function PrioRow({ icon: Icon, count, valueLabel, label, sub, tone, onClick }) {
  return (
    <button
      type="button"
      className={`dt-home__prio-row dt-home__prio-row--${tone || 'muted'}`}
      onClick={() => { hapticTap(); onClick?.() }}
    >
      <span className="dt-home__prio-icon" aria-hidden="true">
        <Icon size={14} />
      </span>
      <span className="dt-home__prio-count">
        {valueLabel != null ? valueLabel : (count ?? 0)}
      </span>
      <div className="dt-home__prio-main">
        <span className="dt-home__prio-label">{label}</span>
        <span className="dt-home__prio-sub">{sub}</span>
      </div>
      <ChevronRight size={12} aria-hidden="true" />
    </button>
  )
}
