// SnowAnalyticsBuild — desktop /analytics in the Build direction.
//
// Drop-in for SnowAnalytics at >=900px. Executive financial reporting,
// not generic charts.

import {
  Bell,
  Search,
  Sun,
  TrendingUp,
  TrendingDown,
  Target,
} from 'lucide-react'
import { money } from '../../lib/format.ts'
import MiniMetric from '../MiniMetric.tsx'

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
}

type TopClient = {
  id?: string
  name: string
  total?: number
  amount?: number
  value?: number
}

// Loosely typed — parent screen passes a wider stats object with some
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
  loading: boolean
  stats: Stats
  byStage: StageRow[]
  revenueByMonth: RevenueRow[]
  topClients: TopClient[]
}

function pct(n: number | null | undefined) {
  const v = Number(n || 0)
  return `${(v * 100).toFixed(0)}%`
}

export default function SnowAnalyticsBuild(props: Props) {
  const { loading, stats, byStage, revenueByMonth, topClients } = props

  const maxStage = Math.max(...byStage.map((b) => b.value), 1)
  const maxRev = Math.max(...revenueByMonth.map((r) => Number(r.value ?? r.amount ?? 0)), 1)

  // Derived signals for the right rail
  const strongestStage = [...byStage].sort((a, b) => b.value - a.value)[0]
  const weakestStage = [...byStage].filter((s) => s.value === 0)[0]

  // Only compute a real collection rate when BOTH invoiced and
  // collected have come through as real numbers from the parent.
  // If either side is null (no invoice/payment data loaded), the
  // Cash risk card shows "Not connected" instead of a fabricated rate.
  const collectionRate = (stats.invoiced != null && stats.collected != null && Number(stats.invoiced) > 0)
    ? (Number(stats.collected) / Number(stats.invoiced))
    : null
  const cashConnected = stats.invoiced != null && stats.collected != null

  const lastMonth = revenueByMonth[revenueByMonth.length - 1]
  const prevMonth = revenueByMonth[revenueByMonth.length - 2]
  const monthOverMonth = (lastMonth && prevMonth)
    ? Number(lastMonth.value ?? lastMonth.amount ?? 0) - Number(prevMonth.value ?? prevMonth.amount ?? 0)
    : 0

  return (
    <div className="fh-build-page" data-build-screen="SnowAnalyticsBuild">
      <header className="fh-build-topbar fh-build-topbar--no-cta">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
        >
          <Search size={14} />
          <span>Search reports, KPIs...</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="fh-build-topbar__meta">
          <span>Year to date · {new Date().getFullYear()}</span>
          <span className="fh-build-vline" />
          <span>72° · Clear</span>
          <Sun size={16} className="fh-build-sun" />
        </div>
        <button className="fh-build-icon-btn" type="button" onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))} aria-label="Open activity" title="Activity"><Bell size={16} /></button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Analytics</div>
            <h1 className="fh-build-title">KNOW THE BUSINESS.</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">Top KPIs · YTD</div>
            <p>
              {money(stats.wonYTD || 0)} won · {pct(stats.closeRate || 0)} close rate ·
              {' '}{pct(stats.avgMargin || 0)} margin
            </p>
            {stats.avgMarginNote && <p style={{ marginTop: 6 }}>{stats.avgMarginNote}</p>}
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Pipeline" value={money(stats.pipeline || 0)} accent />
            <MiniMetric label="Won YTD" value={money(stats.wonYTD || 0)} />
            <MiniMetric label="Close rate" value={pct(stats.closeRate || 0)} />
            <MiniMetric label="Avg margin" value={pct(stats.avgMargin || 0)} />
          </div>
        </section>

        {/* Secondary KPI strip. Invoiced/Collected render "Not
            connected" when the parent passes null — that's the signal
            the screen hasn't loaded an invoices/payments array yet
            (vs. an honest $0 from a user with no activity). */}
        <div className="fh-build-kpi-strip">
          <KpiCell
            label="Invoiced YTD"
            value={stats.invoiced == null ? 'Not connected' : money(stats.invoiced)}
            muted={stats.invoiced == null}
          />
          <KpiCell
            label="Collected YTD"
            value={stats.collected == null ? 'Not connected' : money(stats.collected)}
            muted={stats.collected == null}
          />
          <KpiCell label="Active leads" value={String(stats.leads || 0)} />
          <KpiCell label="Quotes out" value={String(stats.quotes || 0)} />
          <KpiCell label="Miles YTD" value={Number(stats.milesYTD || 0).toLocaleString()} />
          <KpiCell label="Mileage deduction" value={money(stats.mileageDeduction || 0)} />
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
                <div className="fh-build-eyebrow">Revenue trend · last {revenueByMonth.length}</div>
                <span className="fh-build-rel">
                  {monthOverMonth > 0 ? (
                    <span style={{ color: '#73c982', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <TrendingUp size={12} /> {money(monthOverMonth)} MoM
                    </span>
                  ) : monthOverMonth < 0 ? (
                    <span style={{ color: '#ee4942', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                      <TrendingDown size={12} /> {money(Math.abs(monthOverMonth))} MoM
                    </span>
                  ) : '—'}
                </span>
              </header>
              <div className="fh-build-trend-chart">
                {loading ? (
                  <div className="fh-build-table__empty">Loading…</div>
                ) : revenueByMonth.length === 0 ? (
                  <div className="fh-build-table__empty">No revenue history yet.</div>
                ) : revenueByMonth.map((r, i) => {
                  const v = Number(r.value ?? r.amount ?? 0)
                  const h = (v / maxRev) * 100
                  return (
                    <div key={i} className="fh-build-trend-col" title={`${r.label || r.month || ''}: ${money(v)}`}>
                      <div className="fh-build-trend-col__bar" style={{ height: `${Math.max(h, 4)}%` }} />
                      <div className="fh-build-trend-col__label">{r.label || r.month || ''}</div>
                      <div className="fh-build-trend-col__value">{money(v)}</div>
                    </div>
                  )
                })}
              </div>
            </section>

            <section className="fh-build-card fh-build-table">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">Top clients · {topClients.length}</div>
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
                    <span className="fh-build-num" style={{ color: 'var(--v3-primary, #c9963a)', fontWeight: 700 }}>{money(v)}</span>
                  </div>
                )
              })}
            </section>
          </div>

          <aside className="fh-build-rail fh-build-rail--page">
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Strongest signal</div>
              <strong>{strongestStage ? (strongestStage.label || strongestStage.id) : '—'}</strong>
              <span>{strongestStage ? `${money(strongestStage.value)} in ${strongestStage.count} deals` : 'No data yet'}</span>
              {strongestStage && <div className="fh-build-spark is-gold" />}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Weakest stage</div>
              <strong style={{ color: weakestStage ? '#e0a141' : undefined }}>
                {weakestStage ? (weakestStage.label || weakestStage.id) : 'All active'}
              </strong>
              <span>{weakestStage ? 'No movement' : 'Every stage moving'}</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Cash risk</div>
              {cashConnected ? (
                <>
                  <strong style={{
                    color: collectionRate == null
                      ? undefined
                      : Number(stats.invoiced) > Number(stats.collected) ? '#ee4942' : '#73c982',
                  }}>
                    {collectionRate != null ? pct(collectionRate) : '—'}
                  </strong>
                  <span>{collectionRate != null ? 'collection rate YTD' : 'Nothing invoiced YTD'}</span>
                  {collectionRate != null && collectionRate < 0.8 && <div className="fh-build-spark is-red" />}
                </>
              ) : (
                <>
                  <strong>Not connected</strong>
                  <span>Invoice + payment data unavailable</span>
                </>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Follow-up drag</div>
              <strong>{stats.leads || 0}</strong>
              <span>active leads waiting</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Forecast note</div>
              <strong>
                {monthOverMonth > 0 ? 'Trending up' : monthOverMonth < 0 ? 'Trending down' : 'Flat'}
              </strong>
              <span>
                {monthOverMonth !== 0 ? `${money(Math.abs(monthOverMonth))} vs prior month` : 'Hold steady'}
              </span>
              <div className="fh-build-rail-card__spark">
                <Target size={14} />
                <span>{(stats.closeRate || 0) >= 0.3 ? 'on pace' : 'tighten ops'}</span>
              </div>
            </section>
          </aside>
        </section>
      </main>
    </div>
  )
}

function KpiCell({ label, value, muted }: { label: string; value: string; muted?: boolean }) {
  return (
    <div className="fh-build-kpi-cell">
      <strong style={muted ? { color: 'rgba(245,242,234,.42)', fontSize: 14, fontWeight: 700, letterSpacing: '.08em', textTransform: 'uppercase' } : undefined}>
        {value}
      </strong>
      <span>{label}</span>
    </div>
  )
}

