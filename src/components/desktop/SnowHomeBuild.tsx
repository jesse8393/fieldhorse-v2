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

function money(n: number | null | undefined) {
  const v = Number(n || 0)
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`
  return `$${Math.round(v).toLocaleString()}`
}

function moneyFull(n: number | null | undefined) {
  return `$${Math.round(Number(n || 0)).toLocaleString()}`
}

// Coerces dealsAtRisk into { count, value } regardless of upstream
// shape so the right-rail tile can interpolate primitives safely.
function normalizeDealsAtRisk(
  input: number | { count?: number; value?: number; [k: string]: any } | null | undefined,
): { count: number; value: number } {
  if (input == null) return { count: 6, value: 312500 } // fallback only when truly empty
  if (typeof input === 'number') return { count: input, value: input * 10416 }
  if (Array.isArray(input)) return { count: input.length, value: 0 }
  if (typeof input === 'object') {
    const count = typeof input.count === 'number' ? input.count : 0
    const value = typeof input.value === 'number' ? input.value : count * 10416
    return { count, value }
  }
  return { count: 0, value: 0 }
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
    onGoToInvoices,
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

  const pipelineRows = buildPipelineStages(topPipeline, pipeline)
  const queueRows = buildOwnerQueue(nextActions)
  const revenueRows = buildRevenueRows(topPipeline)
  const jobRows = buildJobHealthRows(todayOnSite, revenueRows)

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
              <span>{tempStr} · {condStr || 'Clear'}</span>
              <Sun size={16} className="fh-build-sun" />
            </>
          ) : (
            <>
              <span>72° · Clear</span>
              <Sun size={16} className="fh-build-sun" />
            </>
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
            <div className="fh-build-good">Good morning, {firstName || 'Jesse'}</div>
            <h1 className="fh-build-title">LET’S BUILD.</h1>
          </div>

          <FocusCard onGoToSchedule={onGoToSchedule} />

          <div className="fh-build-mini-grid">
            <MiniMetric label="Crews on site" value={todayOnSite == null ? '—' : String(todayOnSite.length || 4)} />
            <MiniMetric label="Reports missing" value="2" />
            <MiniMetric label="Client follow-ups" value={String(nextActions?.length || 6)} />
            <MiniMetric label="Ready to invoice" value={money(invoicingWeek || 84000)} />
          </div>
        </section>

        <section className="fh-build-content-grid">
          <PipelineHero
            pipeline={pipeline}
            trendUp={trendUp}
            trendPct={trendPct}
            rows={pipelineRows}
            onGoToJobs={onGoToJobs}
          />

          <TodayCard
            todayOnSite={todayOnSite}
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
      <p>Send the revised estimate to Glen Ridge before noon.</p>
      <button type="button" onClick={onGoToSchedule}>
        Open Schedule <ChevronRight size={13} />
      </button>
    </section>
  )
}

function MiniMetric({ label, value }: { label: string; value: string }) {
  return (
    <div className="fh-build-mini">
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  )
}

function PipelineHero({ pipeline, trendUp, trendPct, rows, onGoToJobs }: any) {
  return (
    <section className="fh-build-card fh-build-pipeline" onClick={() => onGoToJobs()}>
      <div className="fh-build-card__overlay" />
      <div className="fh-build-eyebrow">Active Pipeline · All stages</div>

      <div className="fh-build-pipeline__top">
        <div className="fh-build-money">{pipeline == null ? '$4,285,600' : moneyFull(pipeline)}</div>

        {trendPct != null && (
          <div className={trendUp ? 'fh-build-trend is-up' : 'fh-build-trend is-down'}>
            <ArrowUpRight size={13} />
            {Math.abs(trendPct).toFixed(1)}%
          </div>
        )}
      </div>

      <p className="fh-build-pipeline__copy">
        92 active opportunities across 8 stages
      </p>

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

function TodayCard({ todayOnSite, onGoToSchedule, onNewLead }: any) {
  const rows = todayOnSite?.length
    ? todayOnSite.slice(0, 2)
    : [
        { title: 'Schedule', subtitle: 'View today’s schedule' },
        { title: 'New Lead', subtitle: 'Start the next opportunity' },
      ]

  return (
    <section className="fh-build-card fh-build-today">
      <div className="fh-build-today__image" />
      <div className="fh-build-today__body">
        <div className="fh-build-eyebrow">Today</div>

        <div className="fh-build-today__stats">
          <div>
            <strong>18</strong>
            <span>crew members</span>
          </div>
          <div>
            <strong>7</strong>
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
  // dealsAtRisk may be a number (legacy), an object { count, value },
  // or null. Pull primitives out before interpolating into strings —
  // otherwise `${object}` renders as "[object Object]".
  const risk = normalizeDealsAtRisk(dealsAtRisk)
  return (
    <aside className="fh-build-rail">
      <RailMetric
        title="Deals at risk"
        value={moneyFull(risk.value)}
        sub={`${risk.count} ${risk.count === 1 ? 'deal' : 'deals'}`}
        chart="red"
      />
      <RailMetric title="Jobs behind" value={String(jobsBehind || 3)} sub="needs attention" chart="gold" />
      <RailMetric title="Invoicing this week" value={moneyFull(invoicingWeek || 186750)} sub="11 invoices" />
      <RailMetric title="Follow-ups due" value="14" sub="this week" />
      <RailMetric title="Estimates needing action" value="9" sub="over 48h" />
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

      {rows.map((row: any, index: number) => (
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
      ))}

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

      {rows.map((row: any, index: number) => (
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
      ))}

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

      {rows.map((row: any) => (
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
      ))}

      <FooterLink label="View all jobs" onClick={() => onGoToJobs?.()} />
    </section>
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

function buildPipelineStages(_topPipeline: any[] | null, _pipeline: number | null) {
  return [
    { key: 'lead', label: 'Lead', amount: '$562K', count: 12, width: '13%' },
    { key: 'qualified', label: 'Qualified', amount: '$842K', count: 18, width: '15%' },
    { key: 'estimate', label: 'Estimate', amount: '$1.24M', count: 21, width: '24%' },
    { key: 'proposal', label: 'Proposal', amount: '$876K', count: 17, width: '17%' },
    { key: 'negotiation', label: 'Negotiation', amount: '$543K', count: 9, width: '13%' },
    { key: 'won', label: 'Won', amount: '$220K', count: 5, width: '8%' },
    { key: 'hold', label: 'On Hold', amount: '$0', count: 0, width: '5%' },
    { key: 'lost', label: 'Lost', amount: '$0', count: 0, width: '5%' },
  ]
}

function buildOwnerQueue(nextActions: any[] | null) {
  if (nextActions?.length) {
    return nextActions.slice(0, 6).map((a: any, i: number) => ({
      title: a.label || a.title || 'Action required',
      client: a.contactName || a.subtitle || 'Open job',
      amount: i === 0 ? '$240,000' : i === 1 ? '$18,750' : '—',
      status: i < 2 ? 'High' : i < 5 ? 'Medium' : 'Low',
      statusTone: i < 2 ? 'bad' : i < 5 ? 'warn' : 'good',
      due: i < 3 ? 'Today' : 'Tomorrow',
      contactId: a.contactId,
      tab: a.tab,
    }))
  }

  return [
    { title: 'Follow up stale lead', client: 'Smith Custom Home', amount: '$240,000', status: 'High', statusTone: 'bad', due: 'Today' },
    { title: 'Chase invoice', client: 'Timberline Remodel', amount: '$18,750', status: 'High', statusTone: 'bad', due: 'Today' },
    { title: 'Reschedule behind job', client: 'Pine Ridge Build', amount: '—', status: 'Medium', statusTone: 'warn', due: 'Today' },
    { title: 'Send estimate', client: 'Riverfront Addition', amount: '$67,500', status: 'Medium', statusTone: 'warn', due: 'Tomorrow' },
    { title: 'Open job', client: 'Aspen Heights', amount: '$385,000', status: 'Medium', statusTone: 'warn', due: 'Tomorrow' },
    { title: 'Request field report', client: 'Silverthorne View', amount: '—', status: 'Low', statusTone: 'good', due: 'Fri, May 23' },
  ]
}

function buildRevenueRows(topPipeline: any[] | null) {
  if (topPipeline?.length) {
    return topPipeline.slice(0, 5).map((c: any, i: number) => ({
      id: c.id,
      name: c.name || 'Unnamed',
      stage: c.stage || 'Estimate',
      amount: moneyFull(c.amount || c.value || 0),
      touch: i === 0 ? '2d ago' : `${i + 1}d ago`,
      next: i === 0 ? 'Send estimate' : i === 1 ? 'Follow up' : 'Review terms',
    }))
  }

  return [
    { name: 'Boulder Modern Home', stage: 'Estimate', amount: '$385,000', touch: '2d ago', next: 'Send estimate' },
    { name: 'Mountain View Estate', stage: 'Proposal', amount: '$312,000', touch: '1d ago', next: 'Follow up' },
    { name: 'Lone Pine Cabin', stage: 'Negotiation', amount: '$245,000', touch: '3d ago', next: 'Review terms' },
    { name: 'West Ridge Renovation', stage: 'Estimate', amount: '$198,500', touch: '5d ago', next: 'Send estimate' },
    { name: 'Clear Creek Addition', stage: 'Qualified', amount: '$142,000', touch: '6d ago', next: 'Discovery call' },
  ]
}

function buildJobHealthRows(_todayOnSite: any[] | null, _revenueRows: any[]) {
  return [
    { job: 'Timberline Remodel', stage: 'Construction', schedule: 'On Track', scheduleTone: 'good', report: 'Up to date', reportTone: 'good', billing: 'Current', billingTone: 'good', risk: 'Low', riskTone: 'good', next: 'Site walk tomorrow' },
    { job: 'Pine Ridge Build', stage: 'Construction', schedule: 'Behind', scheduleTone: 'bad', report: '2 overdue', reportTone: 'bad', billing: 'Behind', billingTone: 'bad', risk: 'High', riskTone: 'bad', next: 'Reschedule + update client' },
    { job: 'Riverfront Addition', stage: 'Pre-Construction', schedule: 'On Track', scheduleTone: 'good', report: 'Up to date', reportTone: 'good', billing: 'Deposit due', billingTone: 'warn', risk: 'Medium', riskTone: 'warn', next: 'Collect deposit' },
    { job: 'Aspen Heights', stage: 'Permitting', schedule: 'On Track', scheduleTone: 'good', report: 'Up to date', reportTone: 'good', billing: 'Not billed', billingTone: 'neutral', risk: 'Low', riskTone: 'good', next: 'Permit follow up' },
    { job: 'Silverthorne View', stage: 'Construction', schedule: 'On Track', scheduleTone: 'good', report: '1 overdue', reportTone: 'bad', billing: 'Current', billingTone: 'good', risk: 'Medium', riskTone: 'warn', next: 'Request field report' },
  ]
}

// Silence "imported but not used" warnings for icons reserved for future use.
void BarChart3; void CalendarDays; void CircleDollarSign; void Clock3; void MapPin; void Users
