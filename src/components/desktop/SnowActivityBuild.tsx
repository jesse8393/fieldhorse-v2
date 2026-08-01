import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Activity as ActivityIcon,
  ArrowRight,
  BriefcaseBusiness,
  DollarSign,
  FileEdit,
  Receipt,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import BuildTopbar from './BuildTopbar.tsx'
import MiniMetric from '../MiniMetric.tsx'
import { SkeletonList } from '../Skeleton.tsx'

type ActivityEvent = {
  id: string
  when: Date
  contact?: { name?: string; job_title?: string }
  contactId?: string
  kind: string
  icon?: LucideIcon
  tone?: string
  title: string
  sub?: string | null
  amount?: number
}

type Props = {
  events: ActivityEvent[] | null
  hasMore: boolean
  isFetching: boolean
  onLoadOlder: () => void
}

const FILTERS = [
  { id: 'all', label: 'All', match: () => true },
  { id: 'payment', label: 'Payments', match: (event: ActivityEvent) => event.kind === 'payment' },
  { id: 'stage', label: 'Stages', match: (event: ActivityEvent) => event.kind === 'stage' },
  { id: 'invoice', label: 'Draws', match: (event: ActivityEvent) => event.kind === 'invoice' },
  { id: 'change', label: 'Changes', match: (event: ActivityEvent) => event.kind.startsWith('co_') },
]

function bucketLabel(date: Date) {
  const now = new Date()
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const timestamp = new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()
  const day = 86_400_000
  if (timestamp === today) return 'Today'
  if (timestamp === today - day) return 'Yesterday'
  if (timestamp > today - 7 * day) return 'This week'
  if (timestamp > today - 30 * day) return 'This month'
  return date.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

function money(value: number) {
  return Number(value || 0).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })
}

function eventType(event: ActivityEvent) {
  if (event.kind === 'payment') return 'Payment'
  if (event.kind === 'stage') return 'Stage'
  if (event.kind === 'invoice') return 'Draw'
  return 'Change order'
}

function toneClass(tone?: string) {
  if (tone === 'green') return 'is-good'
  if (tone === 'red') return 'is-bad'
  if (tone === 'gold') return 'is-warn'
  return 'is-neutral'
}

export default function SnowActivityBuild({ events, hasMore, isFetching, onLoadOlder }: Props) {
  const [filter, setFilter] = useState('all')
  const rows = events || []

  const filterCounts = useMemo(() => Object.fromEntries(
    FILTERS.map((item) => [item.id, rows.filter(item.match).length])
  ), [rows])

  const filtered = useMemo(() => {
    const selected = FILTERS.find((item) => item.id === filter) || FILTERS[0]
    return rows.filter(selected.match)
  }, [filter, rows])

  const grouped = useMemo(() => {
    const buckets = new Map<string, ActivityEvent[]>()
    for (const event of filtered) {
      const label = bucketLabel(event.when)
      if (!buckets.has(label)) buckets.set(label, [])
      buckets.get(label)?.push(event)
    }
    return Array.from(buckets.entries())
  }, [filtered])

  const summary = useMemo(() => {
    const jobs = new Set(rows.map((event) => event.contactId).filter(Boolean))
    const payments = rows.filter((event) => event.kind === 'payment')
    const changes = rows.filter((event) => event.kind.startsWith('co_'))
    const today = rows.filter((event) => bucketLabel(event.when) === 'Today')
    const paymentTotal = payments.reduce((sum, event) => sum + Number(event.amount || 0), 0)
    const jobCounts = new Map<string, { count: number; name: string }>()
    for (const event of rows) {
      const key = event.contactId || 'unknown'
      const current = jobCounts.get(key) || {
        count: 0,
        name: event.contact?.name || event.contact?.job_title || 'Unknown job',
      }
      current.count += 1
      jobCounts.set(key, current)
    }
    const busiest = Array.from(jobCounts.values()).sort((a, b) => b.count - a.count)[0]
    return { jobs: jobs.size, payments: payments.length, changes: changes.length, today: today.length, paymentTotal, busiest }
  }, [rows])

  return (
    <div className="fh-build-page fh-activity-build" data-build-screen="SnowActivityBuild" data-build-route="/activity">
      <BuildTopbar
        searchPlaceholder="Search jobs, clients, invoices, notes..."
        meta={[
          `${rows.length.toLocaleString()} recent ${rows.length === 1 ? 'event' : 'events'}`,
          `${summary.jobs.toLocaleString()} ${summary.jobs === 1 ? 'job' : 'jobs'} represented`,
        ]}
      />

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Recent</div>
            <h1 className="fh-build-title">ACTIVITY.</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Today</div>
            <p>
              <strong>{summary.today}</strong> {summary.today === 1 ? 'update' : 'updates'} across your active work.
            </p>
            <span className="fh-activity-build__focus-meta">
              {summary.busiest ? `${summary.busiest.name} is most active` : 'Waiting for the next update'}
            </span>
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Payments" value={String(summary.payments)} accent />
            <MiniMetric label="Collected" value={money(summary.paymentTotal)} />
            <MiniMetric label="Stage moves" value={String(filterCounts.stage || 0)} />
            <MiniMetric label="Change orders" value={String(summary.changes)} />
          </div>
        </section>

        <div className="fh-build-filterbar" aria-label="Filter activity">
          {FILTERS.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`fh-build-pill${filter === item.id ? ' is-active' : ''}`}
              onClick={() => setFilter(item.id)}
              aria-pressed={filter === item.id}
            >
              {item.label}
              <span className="fh-build-pill__count">{filterCounts[item.id] || 0}</span>
            </button>
          ))}
        </div>

        <section className="fh-build-content-grid fh-build-content-grid--activity">
          <section className="fh-build-card fh-activity-ledger">
            <header className="fh-build-card-head">
              <div className="fh-build-eyebrow">Event ledger · {filtered.length.toLocaleString()}</div>
              <span className="fh-build-rel">Newest first</span>
            </header>

            {events === null && <div className="fh-activity-ledger__loading"><SkeletonList rows={7} card={false} /></div>}

            {events !== null && rows.length === 0 && (
              <div className="fh-activity-ledger__empty">
                <ActivityIcon size={22} aria-hidden="true" />
                <strong>No activity yet</strong>
                <span>Create a lead, log a payment, or send a proposal and it will appear here.</span>
              </div>
            )}

            {events !== null && rows.length > 0 && filtered.length === 0 && (
              <div className="fh-activity-ledger__empty">
                <ActivityIcon size={22} aria-hidden="true" />
                <strong>No activity in this view</strong>
                <span>Choose another filter to see recent events.</span>
              </div>
            )}

            {grouped.map(([label, items]) => (
              <section className="fh-activity-day" key={label}>
                <header className="fh-activity-day__head">
                  <span>{label}</span>
                  <span>{items.length}</span>
                </header>
                <div className="fh-activity-table__head" aria-hidden="true">
                  <span>Activity</span>
                  <span>Job</span>
                  <span>Type</span>
                  <span>When</span>
                  <span />
                </div>
                {items.map((event) => <DesktopEventRow key={event.id} event={event} />)}
              </section>
            ))}

            {events !== null && filtered.length > 0 && hasMore && (
              <div className="fh-activity-ledger__more">
                <button className="fh-build-secondary-btn" type="button" onClick={onLoadOlder} disabled={isFetching}>
                  {isFetching ? 'Loading...' : 'Load older activity'}
                </button>
              </div>
            )}
          </section>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Activity mix</div>
              <div className="fh-activity-mix">
                <ActivityMixRow icon={DollarSign} label="Payments" value={summary.payments} tone="good" />
                <ActivityMixRow icon={BriefcaseBusiness} label="Stage moves" value={filterCounts.stage || 0} tone="warn" />
                <ActivityMixRow icon={Receipt} label="Draws" value={filterCounts.invoice || 0} tone="warn" />
                <ActivityMixRow icon={FileEdit} label="Change orders" value={summary.changes} />
              </div>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Collected in view</div>
              <strong>{money(summary.paymentTotal)}</strong>
              <span>from {summary.payments} {summary.payments === 1 ? 'payment' : 'payments'}</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Most active job</div>
              <strong className="fh-activity-build__rail-title">{summary.busiest?.name || '\u2003'}</strong>
              <span>{summary.busiest ? `${summary.busiest.count} recent ${summary.busiest.count === 1 ? 'event' : 'events'}` : 'No recent activity'}</span>
            </section>

            <section className="fh-build-rail-card fh-activity-shortcuts">
              <div className="fh-build-eyebrow">Open workspace</div>
              <Link to="/work">Work and deals <ArrowRight size={12} /></Link>
              <Link to="/invoices">Invoices <ArrowRight size={12} /></Link>
              <Link to="/schedule">Schedule <ArrowRight size={12} /></Link>
            </section>
          </aside>
        </section>
      </main>
    </div>
  )
}

function DesktopEventRow({ event }: { event: ActivityEvent }) {
  const Icon = event.icon || ActivityIcon
  const jobName = event.contact?.name || event.contact?.job_title || 'Unknown job'
  return (
    <Link className="fh-activity-table__row" to={`/jobs/${event.contactId}`}>
      <span className={`fh-activity-table__icon ${toneClass(event.tone)}`} aria-hidden="true"><Icon size={15} /></span>
      <span className="fh-activity-table__event">
        <strong>{event.title}</strong>
        <span>{event.sub || '\u2003'}</span>
      </span>
      <span className="fh-build-truncate" title={jobName}>{jobName}</span>
      <span className={`fh-build-dot ${toneClass(event.tone)}`}>{eventType(event)}</span>
      <time dateTime={event.when.toISOString()}>
        {event.when.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
        <span>{event.when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</span>
      </time>
      <ArrowRight size={13} aria-hidden="true" />
    </Link>
  )
}

function ActivityMixRow({ icon: Icon, label, value, tone = 'neutral' }: {
  icon: LucideIcon
  label: string
  value: number
  tone?: 'neutral' | 'good' | 'warn'
}) {
  return (
    <div className="fh-activity-mix__row">
      <span className={`fh-activity-mix__icon is-${tone}`} aria-hidden="true"><Icon size={13} /></span>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}
