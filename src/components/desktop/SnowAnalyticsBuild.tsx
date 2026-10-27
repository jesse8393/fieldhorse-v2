// SnowAnalyticsBuild, desktop /analytics in the Build direction.
//
// Drop-in for SnowAnalytics at >=900px. Executive financial reporting,
// not generic charts.

import type { ReactNode } from 'react'
import {
  Bell,
  Search,
  TrendingUp,
  TrendingDown,
  Target,
} from 'lucide-react'
import { countNoun, money } from '../../lib/format.ts'
import MiniMetric from '../MiniMetric.tsx'
import { completedMonthComparison } from '../../lib/reportingMetrics.ts'
import LoadingValue from '../LoadingValue.tsx'
import TopbarWeather from './TopbarWeather.tsx'
import PaletteKeyCap, { paletteShortcut } from './PaletteKeyCap.tsx'

type StageRow = {
  id: string
  label?: string
  count: number
  value: number
  color?: string
}

type RevenueRow = {
  label?: string
  month?: string
  value?: number
  amount?: number
  total?: number
  period?: string
  partial?: boolean
}

type TopClient = {
  id?: string
  name: string
  total?: number
  amount?: number
  value?: number
}

// Loosely typed, parent screen passes a wider stats object with some
// fields nullable. We only read what we need.
type Stats = Record<string, any> & {
  pipeline?: number | null
  wonYTD?: number | null
  profitYTD?: number | null
  avgMargin?: number | null
  avgMarginNote?: string
  closeRate?: number | null
  closeRateNote?: string
  leads?: number | null
  milesYTD?: number | null
  mileageDeduction?: number | null
  invoiced?: number | null
  collected?: number | null
  quotes?: number | null
}

type Props = {
  /** True until the first read is in: every number shows a skeleton, never $0 or 0%. */
  loading: boolean
  stats: Stats
  byStage: StageRow[]
  revenueByMonth: RevenueRow[]
  topClients: TopClient[]
}

function pct(n: number | null | undefined) {
  // stats.avgMargin and stats.closeRate are already delivered as 0-100
  // percentage values from screens/Analytics.tsx (they multiply by 100
  // before passing). Multiplying again here gave the desktop audit a
  // "5398% margin" reading, the double-multiplication bug. Fixed by
  // formatting the value as entered. Mobile uses fmtPct which always
  // expected 0-100, so the source-of-truth was already correct.
  if (n == null) return 'Not enough data'
  const v = Number(n)
  return `${Math.round(v)}%`
}

function revenueValue(row: RevenueRow) {
  return Number(row.value ?? row.amount ?? row.total ?? 0)
}

export default function SnowAnalyticsBuild(props: Props) {
  const { loading, stats, byStage, revenueByMonth, topClients } = props

  const maxStage = Math.max(...byStage.map((b) => b.value), 1)
  const maxRev = Math.max(...revenueByMonth.map(revenueValue), 1)

  // Derived signals for the right rail
  const strongestStage = [...byStage].sort((a, b) => b.value - a.value)[0]
  const weakestStage = [...byStage].sort((a, b) => a.value - b.value)[0]

  const comparison = completedMonthComparison(revenueByMonth)
  const monthOverMonth = comparison.amount
  const comparisonLabel = comparison.label

  // While the numbers load, a skeleton stands in each value's place.
  const pending = (label: string, width = 72) => <LoadingValue label={label} width={width} height={20} />
  const railPending = <strong>{pending('Loading', 96)}</strong>

  return (
    <div className="fh-build-page" data-build-screen="SnowAnalyticsBuild">
      <header className="fh-build-topbar fh-build-topbar--no-cta">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
          aria-keyshortcuts={paletteShortcut().combo}
        >
          <Search size={14} />
          <span>Search reports, KPIs...</span>
          <PaletteKeyCap />
        </button>
        <div className="fh-build-topbar__meta">
          <span>As of {new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}</span>
          <TopbarWeather lead />
        </div>
        <button className="fh-build-icon-btn" type="button" onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))} aria-label="Open activity" title="Activity"><Bell size={16} /></button>
      </header>

      <div className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Business</div>
            <h1 className="fh-build-title">Reports</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Business overview</div>
            {loading ? (
              <p><LoadingValue label="Loading your numbers" width={240} height={14} /></p>
            ) : (
              <>
                <p>
                  {money(stats.wonYTD || 0)} won · {pct(stats.closeRate)} win rate over 90 days ·
                  {' '}{pct(stats.avgMargin)} tracked margin
                </p>
                {stats.avgMarginNote && <p style={{ marginTop: 6 }}>{stats.avgMarginNote}</p>}
                {stats.closeRateNote && <p style={{ marginTop: 6 }}>{stats.closeRateNote}</p>}
                <p style={{ marginTop: 6 }}>Tracked profit YTD: {stats.profitYTD == null ? 'Not enough cost data' : money(stats.profitYTD)}. {stats.profitNote}</p>
              </>
            )}
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Pipeline" value={loading ? pending('Loading the pipeline') : money(stats.pipeline || 0)} accent />
            <MiniMetric label="Won YTD" value={loading ? pending('Loading won this year') : money(stats.wonYTD || 0)} />
            <MiniMetric label="Win rate · 90 days" value={loading ? pending('Loading the win rate') : pct(stats.closeRate)} />
            <MiniMetric label="Avg margin" value={loading ? pending('Loading the average margin') : pct(stats.avgMargin)} />
          </div>
        </section>

        {/* Secondary KPI strip. Invoiced/Collected render "Not
            connected" when the parent passes null, that's the signal
            the screen hasn't loaded an invoices/payments array yet
            (vs. an honest $0 from a user with no activity). */}
        <div className="fh-build-kpi-strip">
          <KpiCell
            label="Issued invoices YTD"
            value={loading ? pending('Loading invoiced this year', 64) : stats.invoiced == null ? 'Not connected' : money(stats.invoiced)}
            muted={!loading && stats.invoiced == null}
          />
          <KpiCell
            label="Collected YTD"
            value={loading ? pending('Loading collected this year', 64) : stats.collected == null ? 'Not connected' : money(stats.collected)}
            muted={!loading && stats.collected == null}
          />
          <KpiCell label="Active leads" value={loading ? pending('Loading active leads', 40) : String(stats.leads || 0)} />
          <KpiCell label="Quotes out" value={loading ? pending('Loading quotes out', 40) : String(stats.quotes || 0)} />
          <KpiCell label="Miles YTD" value={loading ? pending('Loading miles this year', 48) : Number(stats.milesYTD || 0).toLocaleString()} />
          <KpiCell label="Mileage estimate" value={loading ? pending('Loading the mileage deduction', 64) : stats.mileageDeduction == null ? 'Rate needed' : money(stats.mileageDeduction)} />
        </div>

        <section className="fh-build-content-grid fh-build-content-grid--analytics">
          <div className="fh-build-analytics-main">
            <section className="fh-build-card fh-build-chart-card">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">Pipeline by stage</div>
                <span className="fh-build-rel">{byStage.length} stages</span>
              </header>
              <div className="fh-build-stage-bars">
                {loading ? (
                  <div className="fh-build-table__empty">Loading…</div>
                ) : byStage.length === 0 ? (
                  <div className="fh-build-table__empty">No pipeline data yet.</div>
                ) : byStage.map((s) => {
                  const width = (s.value / maxStage) * 100
                  return (
                    <div key={s.id} className="fh-build-stage-bar">
                      <div className="fh-build-stage-bar__label">
                        <span>{s.label || s.id}</span>
                        <span className="fh-build-rel">{s.count} {s.count === 1 ? 'deal' : 'deals'}</span>
                      </div>
                      <div className="fh-build-stage-bar__track">
                        <div className="fh-build-stage-bar__fill" style={{ width: `${Math.max(width, 2)}%`, background: s.color || 'var(--v3-primary, #c9963a)' }} />
                      </div>
                      <div className="fh-build-stage-bar__value">{money(s.value)}</div>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="fh-build-card fh-build-chart-card">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">Revenue received · last {revenueByMonth.length} months</div>
                <span className="fh-build-rel">
                  {monthOverMonth != null && monthOverMonth > 0 ? (
                    <span style={{ color: 'var(--v3-success-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <TrendingUp size={12} /> {money(monthOverMonth)} more
                    </span>
                  ) : monthOverMonth != null && monthOverMonth < 0 ? (
                    <span style={{ color: 'var(--v3-danger-text)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <TrendingDown size={12} /> {money(Math.abs(monthOverMonth))} less
                    </span>
                  ) : '\u2003'}
                </span>
              </header>
              <p className="fh-build-rel" style={{ padding: '0 16px' }}>{comparisonLabel}. Current month shown separately as partial.</p>
              <div className="fh-build-trend-chart">
                {loading ? (
                  <div className="fh-build-table__empty">Loading…</div>
                ) : revenueByMonth.length === 0 ? (
                  <div className="fh-build-table__empty">No revenue history yet.</div>
                ) : revenueByMonth.map((r, i) => {
                  const v = revenueValue(r)
                  const h = (v / maxRev) * 100
                  return (
                    <div key={i} className="fh-build-trend-col" title={`${r.label || r.month || ''}: ${money(v)}`}>
                      <div className="fh-build-trend-col__bar" style={{ height: `${Math.max(h * 1.3, 6)}px` }} />
                      <div className="fh-build-trend-col__label">{r.label || r.month || ''}{r.partial ? ' · so far' : ''}</div>
                      <div className="fh-build-trend-col__value">{money(v)}</div>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="fh-build-card fh-build-table">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">{loading ? 'Top clients' : <>Top clients · {topClients.length}</>}</div>
              </header>
              <div className="fh-build-table__head is-topclients">
                <span>#</span>
                <span>Client</span>
                <span>Revenue</span>
              </div>
              {loading ? (
                <div className="fh-build-table__empty">Loading…</div>
              ) : topClients.length === 0 ? (
                <div className="fh-build-table__empty">No clients with revenue yet.</div>
              ) : topClients.slice(0, 10).map((c, i) => {
                const v = Number(c.total ?? c.amount ?? c.value ?? 0)
                return (
                  <div key={c.id || c.name || i} className="fh-build-table__row is-topclients">
                    <span className="fh-build-rel">{String(i + 1).padStart(2, '0')}</span>
                    <strong className="fh-build-truncate">{c.name || 'Unnamed'}</strong>
                    <span className="fh-build-num" style={{ color: 'var(--v3-primary-text)', fontWeight: 700 }}>{money(v)}</span>
                  </div>
                )
              })}
            </section>
          </div>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Largest stage</div>
              {loading ? railPending : (
                <>
                  <strong>{strongestStage ? (strongestStage.label || strongestStage.id) : '\u2003'}</strong>
                  <span>
                    {strongestStage
                      ? `${money(strongestStage.value)} in ${strongestStage.count} ${countNoun(strongestStage.count, 'deal')}`
                      : 'No data yet'}
                  </span>
                  {strongestStage && <div className="fh-build-spark is-gold" />}
                </>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Smallest stage</div>
              {loading ? railPending : (
                <>
                  <strong>{weakestStage ? (weakestStage.label || weakestStage.id) : ' '}</strong>
                  <span>
                    {weakestStage
                      ? `${money(weakestStage.value)} in ${weakestStage.count} ${countNoun(weakestStage.count, 'deal')}`
                      : 'No data yet'}
                  </span>
                </>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Recorded payments YTD</div>
              {loading ? railPending : (
                <>
                  <strong>{stats.collected == null ? 'No payments recorded' : money(stats.collected)}</strong>
                  <span>Receipts by payment date. Payments may settle invoices issued in earlier periods.</span>
                  <span>Issued invoices exclude drafts and voids. Contract value remains separate.</span>
                </>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Active leads</div>
              {loading ? railPending : (
                <>
                  <strong>{stats.leads || 0}</strong>
                  <span>currently in the pipeline</span>
                </>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Completed month comparison</div>
              {loading ? railPending : (
                <>
                  <strong>
                    {monthOverMonth == null ? 'Not enough history' : monthOverMonth > 0 ? 'Receipts increased' : monthOverMonth < 0 ? 'Receipts decreased' : 'No change'}
                  </strong>
                  <span>
                    {comparisonLabel}{monthOverMonth == null ? '' : `. ${money(Math.abs(monthOverMonth))} ${monthOverMonth > 0 ? 'more' : monthOverMonth < 0 ? 'less' : 'change'}.`}
                  </span>
                  <div className="fh-build-rail-card__spark">
                    <Target size={14} />
                    <span>{pct(stats.closeRate)} win rate over 90 days</span>
                  </div>
                </>
              )}
            </section>
          </aside>
        </section>
      </div>
    </div>
  )
}

function KpiCell({ label, value, muted }: { label: string; value: ReactNode; muted?: boolean }) {
  return (
    <div className="fh-build-kpi-cell">
      <strong style={muted ? { color: 'var(--v3-text-faint)', fontSize: 14, fontWeight: 700, letterSpacing: 0 } : undefined}>
        {value}
      </strong>
      <span>{label}</span>
    </div>
  )
}

