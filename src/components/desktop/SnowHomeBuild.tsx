import {
  ArrowUpRight,
  BarChart3,
  Bell,
  Calendar,
  CalendarDays,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  FileText,
  MapPin,
  Plus,
  Search,
  Sun,
  Users,
} from 'lucide-react'
import { money, moneyFull } from '../../lib/format.ts'
import MiniMetric from '../MiniMetric.tsx'

type Props = {
  firstName: string
  now: Date
  hasCoords: boolean
  tempStr: string
  condStr: string
  pipeline: number | null
  trendUp: boolean
  trendPct: number | null
  stageBreakdown: { won?: number; active?: number; lead?: number; invoice?: number } | null
  // Home.tsx stores dealsAtRisk as a shape: { count, value, followUps,
  // quotesAttention, … } — older callers expect a plain number. We
  // accept either and normalize at the render site.
  dealsAtRisk: number | { count?: number; value?: number; [k: string]: any } | null
  jobsBehind: number | null
  invoicingWeek: number | null
  todayOnSite: any[] | null
  topPipeline: any[] | null
  nextActions: any[] | null
  onGoToJobs: (filter?: string) => void
  onGoToLeads?: () => void
  onGoToActivity?: () => void
  onGoToSchedule: () => void
  onGoToInvoices: () => void
  onOpenJob: (id: string) => void
  onOpenJobAtTab: (id: string, tab?: string) => void
  onNewLead: () => void
  // Optional pass-throughs from Home.tsx — accepted but unused here.
  weatherErr?: any
  pinLocation?: () => void
  onGoToBid?: () => void
  onGoToCompose?: () => void
  onGoToPourWindow?: () => void
}

function greetingFor(now: Date) {
  const h = now.getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}

// Coerces dealsAtRisk into { count, value, followUps, quotesAttention }
// regardless of upstream shape so the right-rail tile can interpolate
// primitives safely. Returns null when the data hasn't loaded yet so
// callers can render '—' instead of guessing a value.
function normalizeDealsAtRisk(
  input: number | { count?: number; value?: number; followUps?: number; quotesAttention?: number; [k: string]: any } | null | undefined,
): { count: number; value: number; followUps: number | null; quotesAttention: number | null } | null {
  if (input == null) return null
  if (typeof input === 'number') return { count: input, value: 0, followUps: null, quotesAttention: null }
  if (Array.isArray(input)) return { count: input.length, value: 0, followUps: null, quotesAttention: null }
  if (typeof input === 'object') {
    const count = typeof input.count === 'number' ? input.count : 0
    const value = typeof input.value === 'number' ? input.value : 0
    const followUps = typeof input.followUps === 'number' ? input.followUps : null
    const quotesAttention = typeof input.quotesAttention === 'number' ? input.quotesAttention : null
    return { count, value, followUps, quotesAttention }
  }
  return null
}

export default function SnowHomeBuild(props: Props) {
  const {
    firstName,
    now,
    hasCoords,
    tempStr,
    condStr,
    pipeline,
    trendUp,
    trendPct,
    stageBreakdown,
    dealsAtRisk,
    jobsBehind,
    invoicingWeek,
    todayOnSite,
    topPipeline,
    nextActions,
    onGoToJobs,
    onGoToLeads,
    onGoToActivity,
    onGoToSchedule,
    onOpenJob,
    onOpenJobAtTab,
    onNewLead,
  } = props

  const dateLabel = now.toLocaleDateString(undefined, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  })

  const pipelineRows = buildPipelineStages(topPipeline, stageBreakdown)
  const totalOppCount = pipelineRows.reduce((s, r) => s + (r.count || 0), 0)
  const queueRows = buildOwnerQueue(nextActions)
  const revenueRows = buildRevenueRows(topPipeline)
  const jobRows = buildJobHealthRows(todayOnSite)

  return (
    <div
      className="fh-build-page"
      data-build-screen="SnowHomeBuild"
      data-build-route="/"
    >
      <header className="fh-build-topbar">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => {
            if (typeof window !== 'undefined') {
              window.dispatchEvent(new CustomEvent('fh:open-palette'))
            }
          }}
          aria-label="Open command palette"
        >
          <Search size={14} />
          <span>Search jobs, clients, invoices, notes...</span>
          <kbd>⌘K</kbd>
        </button>

        <div className="fh-build-topbar__meta">
          <span>{dateLabel}</span>
          <span className="fh-build-vline" />
          {hasCoords && tempStr ? (
            <>
              <span>{tempStr}{condStr ? ` · ${condStr}` : ''}</span>
              <Sun size={16} className="fh-build-sun" />
            </>
          ) : (
            <span style={{ opacity: 0.6 }}>Weather not set</span>
          )}
        </div>

        <button
          className="fh-build-icon-btn"
          type="button"
          onClick={() => onGoToActivity?.()}
          aria-label="Open activity"
          title="Activity"
        >
          <Bell size={16} />
        </button>

        <button className="fh-build-new-btn" type="button" onClick={onNewLead}>
          <Plus size={15} />
          New
        </button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row">
          <div>
            <div className="fh-build-good">{greetingFor(now)}, {firstName || 'there'}</div>
            <h1 className="fh-build-title">LET’S BUILD.</h1>
          </div>

          <FocusCard onGoToSchedule={onGoToSchedule} />

          <div className="fh-build-mini-grid">
            <MiniMetric label="Crews on site" value={todayOnSite == null ? '—' : String(todayOnSite.length)} />
            <MiniMetric label="Reports missing" value="—" />
            <MiniMetric label="Client follow-ups" value={nextActions == null ? '—' : String(nextActions.length)} />
            <MiniMetric label="Ready to invoice" value={invoicingWeek == null ? '—' : money(invoicingWeek)} />
          </div>
        </section>

        <section className="fh-build-content-grid">
          <PipelineHero
            pipeline={pipeline}
            trendUp={trendUp}
            trendPct={trendPct}
            rows={pipelineRows}
            totalOppCount={totalOppCount}
            onGoToJobs={onGoToJobs}
          />

          <TodayCard
            todayOnSite={todayOnSite}
            activeJobsCount={stageBreakdown?.active ?? null}
            onGoToSchedule={onGoToSchedule}
            onNewLead={onNewLead}
          />

          <RightRail
            dealsAtRisk={dealsAtRisk}
            jobsBehind={jobsBehind}
            invoicingWeek={invoicingWeek}
          />

          <OwnerQueue
            rows={queueRows}
            onOpenJobAtTab={onOpenJobAtTab}
            onViewAll={onGoToActivity}
          />

          <RevenueOpportunities
            rows={revenueRows}
            onOpenJob={onOpenJob}
            onViewAll={onGoToLeads}
          />

          <JobHealthPreview
            rows={jobRows}
            onGoToJobs={onGoToJobs}
          />
        </section>
      </main>
    </div>
  )
}

function FocusCard({ onGoToSchedule }: { onGoToSchedule: () => void }) {
  return (
    <section className="fh-build-focus">
      <div className="fh-build-eyebrow">Today’s focus</div>
      <p>Open your schedule to plan today’s priorities.</p>
      <button type="button" onClick={onGoToSchedule}>
        Open Schedule <ChevronRight size={13} />
      </button>
    </section>
  )
}

function PipelineHero({ pipeline, trendUp, trendPct, rows, totalOppCount, onGoToJobs }: any) {
  const stageCount = rows.length
  const oppLabel =
    totalOppCount === 0
      ? 'No active opportunities yet'
      : `${totalOppCount} active ${totalOppCount === 1 ? 'opportunity' : 'opportunities'} across ${stageCount} ${stageCount === 1 ? 'stage' : 'stages'}`
  return (
    <section className="fh-build-card fh-build-pipeline" onClick={() => onGoToJobs()}>
      <div className="fh-build-card__overlay" />
      <div className="fh-build-eyebrow">Active Pipeline · All stages</div>

      <div className="fh-build-pipeline__top">
        <div className="fh-build-money">{pipeline == null ? '—' : moneyFull(pipeline)}</div>

        {trendPct != null && (
          <div className={trendUp ? 'fh-build-trend is-up' : 'fh-build-trend is-down'}>
            <ArrowUpRight size={13} />
            {Math.abs(trendPct).toFixed(1)}%
          </div>
        )}
      </div>

      <p className="fh-build-pipeline__copy">{oppLabel}</p>

      <div className="fh-build-stage-grid">
        {rows.map((row: any) => (
          <button
            key={row.label}
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onGoToJobs(row.key)
            }}
          >
            <span>{row.label}</span>
            <strong>{row.amount}</strong>
            <small>{row.count}</small>
          </button>
        ))}
      </div>

      <div className="fh-build-stage-line">
        {rows.map((row: any) => (
          <span key={row.label} style={{ width: row.width }} />
        ))}
      </div>
    </section>
  )
}

function TodayCard({ todayOnSite, activeJobsCount, onGoToSchedule, onNewLead }: any) {
  // Crew headcount isn't tracked yet — show '—' rather than a fake number.
  // Jobs in progress comes from the real stage breakdown.
  return (
    <section className="fh-build-card fh-build-today">
      <div className="fh-build-today__image" />
      <div className="fh-build-today__body">
        <div className="fh-build-eyebrow">Today</div>

        <div className="fh-build-today__stats">
          <div>
            <strong>{todayOnSite == null ? '—' : todayOnSite.length}</strong>
            <span>{todayOnSite?.length === 1 ? 'visit today' : 'visits today'}</span>
          </div>
          <div>
            <strong>{activeJobsCount == null ? '—' : activeJobsCount}</strong>
            <span>jobs in progress</span>
          </div>
        </div>

        <div className="fh-build-today__actions">
          <button type="button" onClick={onGoToSchedule}>
            <Calendar size={14} />
            <span>
              Schedule
              <small>View today’s schedule</small>
            </span>
            <ChevronRight size={13} />
          </button>

          <button type="button" onClick={onNewLead}>
            <FileText size={14} />
            <span>
              New Lead
              <small>Create opportunity</small>
            </span>
            <ChevronRight size={13} />
          </button>
        </div>
      </div>
    </section>
  )
}

function RightRail({ dealsAtRisk, jobsBehind, invoicingWeek }: any) {
  // dealsAtRisk may be a number (legacy), an object { count, value, followUps,
  // quotesAttention }, or null. normalizeDealsAtRisk returns null when not
  // yet loaded — render '—' rather than a fabricated number.
  const risk = normalizeDealsAtRisk(dealsAtRisk)
  const dealsValue = risk == null ? '—' : moneyFull(risk.value)
  const dealsSub =
    risk == null ? 'Loading…' : `${risk.count} ${risk.count === 1 ? 'deal' : 'deals'}`
  const jobsBehindValue = jobsBehind == null ? '—' : String(jobsBehind)
  const jobsBehindSub =
    jobsBehind == null ? 'Loading…' : jobsBehind === 0 ? 'All on track' : 'needs attention'
  const invoicingValue = invoicingWeek == null ? '—' : moneyFull(invoicingWeek)
  const invoicingSub = invoicingWeek == null ? 'Loading…' : 'this week'
  const followUpsValue =
    risk?.followUps == null ? '—' : String(risk.followUps)
  const followUpsSub = risk?.followUps == null ? 'Loading…' : 'leads waiting'
  const quotesValue =
    risk?.quotesAttention == null ? '—' : String(risk.quotesAttention)
  const quotesSub = risk?.quotesAttention == null ? 'Loading…' : 'quotes waiting'
  return (
    <aside className="fh-build-rail">
      <RailMetric title="Deals at risk" value={dealsValue} sub={dealsSub} chart="red" />
      <RailMetric title="Jobs behind" value={jobsBehindValue} sub={jobsBehindSub} chart="gold" />
      <RailMetric title="Invoicing this week" value={invoicingValue} sub={invoicingSub} />
      <RailMetric title="Follow-ups due" value={followUpsValue} sub={followUpsSub} />
      <RailMetric title="Quotes needing attention" value={quotesValue} sub={quotesSub} />
    </aside>
  )
}

function RailMetric({ title, value, sub, chart }: any) {
  return (
    <section className="fh-build-rail-card">
      <div className="fh-build-eyebrow">{title}</div>
      <strong>{value}</strong>
      <span>{sub}</span>
      {chart && <div className={`fh-build-spark is-${chart}`} />}
    </section>
  )
}

function OwnerQueue({ rows, onOpenJobAtTab, onViewAll }: any) {
  return (
    <section className="fh-build-card fh-build-table fh-build-owner">
      <CardHeader title="Owner Queue" />
      <div className="fh-build-table__head is-owner">
        <span>#</span>
        <span>Action</span>
        <span>Client / Job</span>
        <span>Amount</span>
        <span>Status</span>
        <span>Due</span>
      </div>

      {rows.length === 0 ? (
        <EmptyRow label="No actions queued — you’re caught up." />
      ) : (
        rows.map((row: any, index: number) => (
          <button
            key={`${row.title}-${index}`}
            type="button"
            className="fh-build-table__row is-owner"
            onClick={() => row.contactId && onOpenJobAtTab(row.contactId, row.tab)}
          >
            <span>{index + 1}</span>
            <strong>{row.title}</strong>
            <span>{row.client}</span>
            <span>{row.amount}</span>
            <span className={`fh-build-dot is-${row.statusTone}`}>{row.status}</span>
            <span>{row.due}</span>
            <ChevronRight size={13} />
          </button>
        ))
      )}

      <FooterLink label="View all tasks" onClick={onViewAll} />
    </section>
  )
}

function RevenueOpportunities({ rows, onOpenJob, onViewAll }: any) {
  return (
    <section className="fh-build-card fh-build-table fh-build-revenue">
      <CardHeader title="Revenue Opportunities" />
      <div className="fh-build-table__head is-revenue">
        <span>Job / Client</span>
        <span>Stage</span>
        <span>Amount</span>
        <span>Last touch</span>
        <span>Next step</span>
      </div>

      {rows.length === 0 ? (
        <EmptyRow label="No active deals yet — start a new lead to populate this list." />
      ) : (
        rows.map((row: any) => (
          <button
            key={row.id || row.name}
            type="button"
            className="fh-build-table__row is-revenue"
            onClick={() => row.id && onOpenJob(row.id)}
          >
            <strong>{row.name}</strong>
            <span>{row.stage}</span>
            <span>{row.amount}</span>
            <span>{row.touch}</span>
            <span>{row.next}</span>
          </button>
        ))
      )}

      <FooterLink label="View all opportunities" onClick={onViewAll} />
    </section>
  )
}

function JobHealthPreview({ rows, onGoToJobs }: any) {
  return (
    <section className="fh-build-card fh-build-table fh-build-health">
      <CardHeader title="Job Health Preview" action="Operational Risks" />
      <div className="fh-build-table__head is-health">
        <span>Job</span>
        <span>Stage</span>
        <span>Schedule</span>
        <span>Reports</span>
        <span>Billing</span>
        <span>Risk</span>
        <span>Next Action</span>
      </div>

      {rows.length === 0 ? (
        <EmptyRow label="Job-health signals not connected yet." />
      ) : (
        rows.map((row: any) => (
          <button
            key={row.job}
            type="button"
            className="fh-build-table__row is-health"
            onClick={() => onGoToJobs()}
          >
            <strong>{row.job}</strong>
            <span>{row.stage}</span>
            <span className={`fh-build-dot is-${row.scheduleTone}`}>{row.schedule}</span>
            <span className={`fh-build-dot is-${row.reportTone}`}>{row.report}</span>
            <span className={`fh-build-dot is-${row.billingTone}`}>{row.billing}</span>
            <span className={`fh-build-dot is-${row.riskTone}`}>{row.risk}</span>
            <span>{row.next}</span>
            <ChevronRight size={13} />
          </button>
        ))
      )}

      <FooterLink label="View all jobs" onClick={() => onGoToJobs?.()} />
    </section>
  )
}

function EmptyRow({ label }: { label: string }) {
  return (
    <div
      className="fh-build-table__row"
      style={{
        gridTemplateColumns: '1fr',
        color: 'rgba(255,255,255,0.55)',
        fontSize: 13,
        padding: '18px 16px',
        cursor: 'default',
      }}
    >
      <span>{label}</span>
    </div>
  )
}

function CardHeader({ title, action }: any) {
  return (
    <header className="fh-build-card-head">
      <div className="fh-build-eyebrow">{title}</div>
      {action && <button type="button">{action}</button>}
    </header>
  )
}

function FooterLink({ label, onClick }: { label: string; onClick?: () => void }) {
  return (
    <button type="button" className="fh-build-footer-link" onClick={onClick}>
      {label} <ChevronRight size={13} />
    </button>
  )
}

// Render 3 real funnel buckets (Lead/Active/Won) sourced from
// stageBreakdown, with $ totals derived from topPipeline rows whose
// stage falls into each bucket. We intentionally show 3 buckets
// rather than fabricating 8 named stages — counts are the source of
// truth, amounts are best-effort from the top-deal slice we have.
function buildPipelineStages(
  topPipeline: any[] | null,
  stageBreakdown: { won?: number; active?: number; lead?: number } | null,
) {
  const buckets: Record<string, { key: string; label: string; stages: string[] }> = {
    lead:   { key: 'lead',   label: 'Lead',   stages: ['lead', 'quote'] },
    active: { key: 'active', label: 'Active', stages: ['job'] },
    won:    { key: 'won',    label: 'Won',    stages: ['invoice', 'closed'] },
  }
  const sums: Record<string, number> = { lead: 0, active: 0, won: 0 }
  for (const deal of topPipeline || []) {
    for (const [bk, b] of Object.entries(buckets)) {
      if (b.stages.includes(String(deal.stage || '').toLowerCase())) {
        sums[bk] += Number(deal.amount || deal.value || 0)
      }
    }
  }
  const rows = (['lead', 'active', 'won'] as const).map((k) => ({
    key: buckets[k].key,
    label: buckets[k].label,
    amount: sums[k] > 0 ? money(sums[k]) : '—',
    count: stageBreakdown?.[k] ?? 0,
  }))
  const totalCount = rows.reduce((s, r) => s + r.count, 0)
  return rows.map((r) => ({
    ...r,
    width: totalCount > 0 ? `${Math.max(5, Math.round((r.count / totalCount) * 100))}%` : '33%',
  }))
}

// Map a real Next Action into the owner-queue row shape. urgencyTone
// ('danger' | 'warn' | 'success') maps to the dot tone the table uses.
// Amount/due aren't part of the action payload, so we leave them blank
// rather than invent numbers.
function buildOwnerQueue(nextActions: any[] | null) {
  if (!nextActions) return []
  return nextActions.slice(0, 6).map((a: any) => {
    const tone =
      a.urgencyTone === 'danger' ? 'bad'
      : a.urgencyTone === 'warn' ? 'warn'
      : a.urgencyTone === 'success' ? 'good'
      : 'neutral'
    const status =
      a.urgencyTone === 'danger' ? 'High'
      : a.urgencyTone === 'warn' ? 'Medium'
      : a.urgencyTone === 'success' ? 'Action'
      : '—'
    return {
      title: a.title || a.label || 'Action required',
      client: a.detail || a.contactName || a.subtitle || '',
      amount: '—',
      status,
      statusTone: tone,
      due: '—',
      contactId: a.contactId,
      tab: a.tab,
    }
  })
}

function buildRevenueRows(topPipeline: any[] | null) {
  if (!topPipeline) return []
  const stageLabel: Record<string, string> = {
    lead: 'Lead',
    quote: 'Quote',
    job: 'Job',
    invoice: 'Invoice',
    closed: 'Closed',
    lost: 'Lost',
  }
  return topPipeline.slice(0, 5).map((c: any) => ({
    id: c.id,
    name: c.name || 'Unnamed',
    stage: stageLabel[String(c.stage || '').toLowerCase()] || c.stage || '—',
    amount: moneyFull(c.amount || c.value || 0),
    touch: '—',
    next: '—',
  }))
}

// Job Health requires per-job schedule / report / billing / risk
// signals that aren't computed on Home yet. Until that data lands,
// emit zero rows — the table will render its header + empty state
// rather than fabricated rows with placeholder client names.
function buildJobHealthRows(_todayOnSite: any[] | null) {
  return [] as any[]
}

// Silence "imported but not used" warnings for icons reserved for future use.
void BarChart3; void CalendarDays; void CircleDollarSign; void Clock3; void MapPin; void Users
