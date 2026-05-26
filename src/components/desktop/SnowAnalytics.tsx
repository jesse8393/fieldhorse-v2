// SnowAnalytics — desktop /analytics in the Snow direction.
//
// New desktop dispatch on Analytics.tsx at >=900px. Dashboard
// composition: KPI row + revenue chart + top clients table +
// pipeline distribution.

import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'

type Stats = {
  pipeline: number
  wonYTD: number
  profitYTD: number
  avgMargin: number | null
  avgMarginNote: string
  leads: number
  quotes: number
  jobs: number
  closedCount: number
  lostCount: number
  closeRate: number | null
  closeRateNote: string
  milesYTD: number
  mileageDeduction: number
}

type StageRow = {
  id: string
  label: string
  color: string
  icon: string
  count: number
  value: number
}

type RevenueRow = { week: string; amount: number }
type ClientRow = { name: string; amount: number }

type Props = {
  loading: boolean
  stats: Stats
  byStage: StageRow[]
  revenueByMonth: RevenueRow[]
  topClients: ClientRow[]
}

function money(n: number) {
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `$${Math.round(n / 1_000)}K`
  return `$${Math.round(n).toLocaleString()}`
}
function fullMoney(n: number) {
  return n.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}
function fmtPct(n: number | null) {
  if (n == null) return '—'
  return `${Math.round(n)}%`
}

export default function SnowAnalytics({ loading, stats, byStage, revenueByMonth, topClients }: Props) {
  const totalStageValue = Math.max(1, byStage.reduce((s, r) => s + r.value, 0))

  return (
    <div style={{ padding: '20px 8px 48px', color: 'var(--v3-text)' }}>

      {/* HEADER ============================================ */}
      <header style={{ marginBottom: 20 }}>
        <div style={eyebrowStyle}>Reports · Year to date</div>
        <h1 style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontSize: 32, lineHeight: 1.05, letterSpacing: '0.01em', color: 'var(--v3-text)' }}>
          Analytics
        </h1>
      </header>

      {/* KPI ROW ============================================ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <KPITile label="Pipeline value"   value={money(stats.pipeline)} accent />
        <KPITile label="Won YTD"           value={money(stats.wonYTD)}   sub={`Profit ${money(stats.profitYTD)}`} />
        <KPITile label="Close rate"        value={fmtPct(stats.closeRate)} sub={stats.closeRateNote} />
        <KPITile label="Avg margin"        value={fmtPct(stats.avgMargin)} sub={stats.avgMarginNote} />
      </div>

      {/* CHART + STAGE PANEL ============================== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.6fr 1fr', gap: 12, marginBottom: 18 }}>
        <section style={panelStyle}>
          <header style={panelHeader}>
            <span style={panelTitle}>Revenue trend</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>Last 13 weeks</span>
          </header>
          <div style={{ padding: '14px 18px 18px', height: 280 }}>
            {loading ? (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>Loading…</div>
            ) : revenueByMonth.length === 0 ? (
              <div style={{ display: 'grid', placeItems: 'center', height: '100%', color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)', fontSize: 13 }}>No data yet.</div>
            ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={revenueByMonth} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                  <defs>
                    <linearGradient id="snow-rev-fill" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%"  stopColor="var(--v3-primary, #C9963A)" stopOpacity={0.45} />
                      <stop offset="100%" stopColor="var(--v3-primary, #C9963A)" stopOpacity={0} />
                    </linearGradient>
                  </defs>
                  <CartesianGrid strokeDasharray="3 3" stroke="rgba(255, 240, 210, 0.06)" vertical={false} />
                  <XAxis dataKey="week" tick={{ fontSize: 11, fill: 'var(--v3-text-muted)' }} stroke="rgba(255, 240, 210, 0.10)" />
                  <YAxis tick={{ fontSize: 11, fill: 'var(--v3-text-muted)' }} stroke="rgba(255, 240, 210, 0.10)" tickFormatter={(v) => `$${Math.round(v / 1000)}K`} />
                  <Tooltip
                    contentStyle={{
                      background: 'var(--v3-surface, #141110)',
                      border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
                      borderRadius: 4,
                      fontFamily: 'var(--font-body)',
                      fontSize: 12
                    }}
                    labelStyle={{ color: 'var(--v3-text-muted)' }}
                    formatter={(v: any) => [fullMoney(Number(v)), 'Revenue']}
                  />
                  <Area type="monotone" dataKey="amount" stroke="var(--v3-primary, #C9963A)" strokeWidth={2} fill="url(#snow-rev-fill)" />
                </AreaChart>
              </ResponsiveContainer>
            )}
          </div>
        </section>

        <section style={panelStyle}>
          <header style={panelHeader}>
            <span style={panelTitle}>Pipeline by stage</span>
          </header>
          <ul style={{ listStyle: 'none', padding: '12px 18px 18px', margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
            {byStage.filter((r) => r.count > 0).map((r) => {
              const pct = Math.round((r.value / totalStageValue) * 100)
              return (
                <li key={r.id} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: r.color, boxShadow: `0 0 8px ${r.color}66` }} />
                  <span style={{ minWidth: 78, fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--v3-text)' }}>{r.label}</span>
                  <div style={{ flex: 1, height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 999, overflow: 'hidden' }}>
                    <span style={{ display: 'block', width: `${Math.max(2, pct)}%`, height: '100%', background: r.color, borderRadius: 999 }} />
                  </div>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums', minWidth: 24, textAlign: 'right' }}>{r.count}</span>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'right' }}>{money(r.value)}</span>
                </li>
              )
            })}
            {byStage.every((r) => r.count === 0) && (
              <li style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text-muted)' }}>No deals yet.</li>
            )}
          </ul>
        </section>
      </div>

      {/* TOP CLIENTS TABLE ================================== */}
      <section style={panelStyle}>
        <header style={panelHeader}>
          <span style={panelTitle}>Top clients</span>
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>By lifetime value</span>
        </header>
        <table style={{ width: '100%', borderCollapse: 'collapse' }}>
          <thead>
            <tr>
              <th style={thStyle}>Rank</th>
              <th style={thStyle}>Client</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Revenue (90 days)</th>
            </tr>
          </thead>
          <tbody>
            {loading && <tr><td colSpan={3} style={{ ...tdStyle, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '24px 16px' }}>Loading…</td></tr>}
            {!loading && topClients.length === 0 && (
              <tr><td colSpan={3} style={{ ...tdStyle, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '32px 16px' }}>No clients with revenue yet.</td></tr>
            )}
            {!loading && topClients.slice(0, 10).map((c, i) => (
              <tr key={`${c.name}-${i}`} style={{ transition: 'background 120ms ease' }}
                  onMouseEnter={(e) => (e.currentTarget.style.background = 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))')}
                  onMouseLeave={(e) => (e.currentTarget.style.background = 'transparent')}>
                <td style={{ ...tdStyle, fontFamily: 'var(--font-display)', fontSize: 13, color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums', width: 50 }}>{i + 1}</td>
                <td style={tdStyle}>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--v3-text)' }}>{c.name || 'Unnamed'}</span>
                </td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--v3-primary)' }}>{fullMoney(c.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* SECONDARY KPI ROW ================================= */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginTop: 18 }}>
        <KPITile label="Mileage YTD" value={`${Math.round(stats.milesYTD).toLocaleString()} mi`} sub={`${fullMoney(stats.mileageDeduction)} deduction`} />
        <KPITile label="Leads in pipeline" value={String(stats.leads)} />
        <KPITile label="Quotes outstanding" value={String(stats.quotes)} />
      </div>
    </div>
  )
}

// ============================================================
// PRIMITIVES
// ============================================================

function KPITile({ label, value, sub, subTone, accent }: any) {
  const valColor = accent ? 'var(--v3-primary)' : 'var(--v3-text)'
  return (
    <div style={{
      background: 'var(--v3-surface, #141110)',
      border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
      borderRadius: 6,
      padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 8,
      minHeight: 104
    }}>
      <span style={eyebrowStyle}>{label}</span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 30, lineHeight: 1, letterSpacing: '-0.01em', color: valColor, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: subTone === 'warn' ? 'var(--v3-primary)' : 'var(--v3-text-muted)' }}>{sub}</span>}
    </div>
  )
}

// ============================================================
// STYLES
// ============================================================

const eyebrowStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
  letterSpacing: '0.18em', textTransform: 'uppercase',
  color: 'var(--v3-text-muted)'
}

const panelStyle: React.CSSProperties = {
  background: 'var(--v3-surface, #141110)',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  borderRadius: 6,
  overflow: 'hidden'
}

const panelHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '14px 18px 10px',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.08))'
}

const panelTitle: React.CSSProperties = { ...eyebrowStyle }

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
  letterSpacing: '0.14em', textTransform: 'uppercase',
  color: 'var(--v3-text-muted)',
  padding: '12px 16px',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))'
}

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))',
  verticalAlign: 'middle'
}
