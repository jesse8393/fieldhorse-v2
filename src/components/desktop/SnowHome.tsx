// Desktop Home — Snow-direction rebuild.
//
// Replaces DesktopHomeCommandCenter as the dispatch target from Home.tsx
// at >=900px. Drop-in: same prop signature, but the visual model is
// flat, dense, dashboard-first instead of phone-card-stretched:
//
//   [page header — eyebrow + greeting]
//   [4-up KPI tiles — Pipeline · Active · Won YTD · Margin]
//   [pipeline-by-stage bars        | up next list]
//   [recent activity TABLE         |             ]
//
// Visual rules (Snow target):
//   - Dark surface (var(--v3-bg))
//   - 1px hairline borders, not chunky rounded cards
//   - 12-14px body, 28-32px hero numbers, eyebrows 10/11px uppercase
//   - DM Sans body, Bebas Neue display numbers, tabular-nums on money
//   - One brand accent (gold) per surface, no chrome
//   - Real <table> for activity — sortable later, hoverable now

import { ArrowDownRight, ArrowUpRight, ArrowRight } from 'lucide-react'

type Props = {
  firstName: string
  now: Date
  // weather block kept for parity but rendered as a quiet chip, not the hero
  hasCoords: boolean
  tempStr: string
  condStr: string
  weatherErr: any
  pinLocation: () => void
  // KPI
  pipeline: number | null
  trendUp: boolean
  trendPct: number | null
  stageBreakdown: { won?: number; active?: number; lead?: number; invoice?: number } | null
  dealsAtRisk: number | null
  jobsBehind: number | null
  invoicingWeek: number | null
  // Lists
  todayOnSite: any[] | null
  topPipeline: any[] | null
  nextActions: any[] | null
  // Nav
  onGoToJobs: (filter?: string) => void
  onGoToSchedule: () => void
  onGoToInvoices: () => void
  onGoToBid: () => void
  onGoToCompose: () => void
  onGoToPourWindow: () => void
  onOpenJob: (id: string) => void
  onOpenJobAtTab: (id: string, tab?: string) => void
  onNewLead: () => void
}

function money(n: number | null | undefined) {
  const v = Number(n || 0)
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(1)}M`
  if (v >= 1_000) return `$${Math.round(v / 1_000)}K`
  return `$${Math.round(v).toLocaleString()}`
}

function fullMoney(n: number | null | undefined) {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function SnowHome(props: Props) {
  const {
    firstName, now,
    pipeline, trendUp, trendPct, stageBreakdown,
    dealsAtRisk, jobsBehind, invoicingWeek,
    topPipeline, nextActions,
    onGoToJobs, onOpenJob,
  } = props

  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
  const won = stageBreakdown?.won ?? null
  const active = stageBreakdown?.active ?? null

  // stage rows for the pipeline panel — derive from topPipeline so widths
  // reflect real distribution
  const stageRows = (() => {
    const groups: Record<string, { count: number; total: number; label: string; tone: string }> = {
      lead:    { count: 0, total: 0, label: 'Leads',     tone: 'var(--stage-lead, #6B7CA8)'   },
      quote:   { count: 0, total: 0, label: 'Quotes',    tone: 'var(--stage-quote, #B07A4A)'  },
      job:     { count: 0, total: 0, label: 'Active',    tone: 'var(--stage-job, #4F8C5E)'    },
      invoice: { count: 0, total: 0, label: 'Invoicing', tone: 'var(--stage-invoice, #C9963A)'},
    }
    for (const c of topPipeline || []) {
      const s = c.stage as keyof typeof groups
      if (s in groups) {
        groups[s].count += 1
        groups[s].total += Number(c.amount || 0)
      }
    }
    return Object.entries(groups).map(([id, g]) => ({ id, ...g }))
  })()
  const stageMax = Math.max(1, ...stageRows.map((r) => r.total))

  // recent activity rows
  const recent = (topPipeline || []).slice(0, 8)

  return (
    <div style={{ padding: '20px 8px 48px', color: 'var(--v3-text)' }}>

      {/* PAGE HEADER ============================================= */}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 24 }}>
        <div>
          <div style={ eyebrowStyle }>{dateLabel}</div>
          <h1 style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontSize: 32, lineHeight: 1.05, letterSpacing: '0.01em', color: 'var(--v3-text)' }}>
            Good morning, <span style={{ color: 'var(--v3-primary)' }}>{firstName}.</span>
          </h1>
          <p style={{ margin: '4px 0 0', fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--v3-text-muted)' }}>Today's snapshot</p>
        </div>
        <button type="button" onClick={props.onNewLead} style={primaryBtn}>+ New lead</button>
      </header>

      {/* KPI ROW ================================================= */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <KPITile
          label="Total pipeline"
          value={pipeline == null ? '—' : money(pipeline)}
          trend={trendPct != null ? { up: trendUp, pct: trendPct, period: '7d' } : null}
          accent
        />
        <KPITile
          label="Active deals"
          value={active != null ? String(active) : '—'}
          sub={dealsAtRisk ? `${dealsAtRisk} need eyes` : 'On track'}
          subTone={dealsAtRisk ? 'warn' : 'muted'}
          onClick={() => onGoToJobs('active')}
        />
        <KPITile
          label="Won YTD"
          value={won != null ? String(won) : '—'}
          sub="deals"
          subTone="muted"
          onClick={() => onGoToJobs('won')}
        />
        <KPITile
          label="Invoicing"
          value={invoicingWeek ? fullMoney(invoicingWeek) : '$0'}
          sub={jobsBehind ? `${jobsBehind} behind schedule` : 'This week'}
          subTone={jobsBehind ? 'warn' : 'muted'}
          onClick={props.onGoToInvoices}
        />
      </div>

      {/* WORKSPACE — pipeline bars + up next ===================== */}
      <div style={{ display: 'grid', gridTemplateColumns: '1.5fr 1fr', gap: 12, marginBottom: 18 }}>

        {/* PIPELINE BARS */}
        <section style={panelStyle}>
          <header style={panelHeader}>
            <span style={panelTitle}>Pipeline by stage</span>
            <button type="button" onClick={() => onGoToJobs()} style={linkBtn}>View jobs <ArrowRight size={11} /></button>
          </header>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 18px 18px' }}>
            {stageRows.map((r) => {
              const pct = Math.max(2, Math.round((r.total / stageMax) * 100))
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => onGoToJobs(r.id === 'job' ? 'active' : r.id)}
                  style={stageRowBtn}
                >
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, minWidth: 96 }}>
                    <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: 999, background: r.tone, boxShadow: `0 0 8px ${r.tone}66` }} />
                    <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, color: 'var(--v3-text)' }}>{r.label}</span>
                  </span>
                  <div style={{ flex: 1, position: 'relative', height: 6, background: 'rgba(255,255,255,0.05)', borderRadius: 999, overflow: 'hidden', margin: '0 12px' }}>
                    <span style={{ position: 'absolute', left: 0, top: 0, bottom: 0, width: `${pct}%`, background: r.tone, borderRadius: 999 }} />
                  </div>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontVariantNumeric: 'tabular-nums', color: 'var(--v3-text-muted)', minWidth: 28, textAlign: 'right' }}>{r.count}</span>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--v3-text)', minWidth: 64, textAlign: 'right', marginLeft: 8 }}>{money(r.total)}</span>
                </button>
              )
            })}
          </div>
        </section>

        {/* UP NEXT */}
        <section style={panelStyle}>
          <header style={panelHeader}>
            <span style={panelTitle}>Up next</span>
            {nextActions && nextActions.length > 0 && (
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>{nextActions.length}</span>
            )}
          </header>
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {(!nextActions || nextActions.length === 0) && (
              <li style={emptyStateRow}>Nothing pressing. Quiet day.</li>
            )}
            {(nextActions || []).slice(0, 6).map((a, i) => (
              <li key={a.id || i}>
                <button
                  type="button"
                  onClick={() => a.contactId && onOpenJob(a.contactId)}
                  style={nextActionRow(i === 0)}
                >
                  <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: a.tone === 'danger' ? 'var(--v3-danger, #C0392B)' : a.tone === 'warn' ? 'var(--v3-primary)' : 'var(--v3-text-muted)' }} />
                  <span style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                    <span style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{a.title || a.label || 'Action'}</span>
                    {a.subtitle && (
                      <span style={{ display: 'block', fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', marginTop: 1 }}>{a.subtitle}</span>
                    )}
                  </span>
                  <ArrowRight size={12} style={{ color: 'var(--v3-text-muted)', flexShrink: 0 }} />
                </button>
              </li>
            ))}
          </ul>
        </section>
      </div>

      {/* RECENT ACTIVITY TABLE =================================== */}
      <section style={panelStyle}>
        <header style={panelHeader}>
          <span style={panelTitle}>Top pipeline</span>
          <button type="button" onClick={() => onGoToJobs()} style={linkBtn}>View all <ArrowRight size={11} /></button>
        </header>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Job</th>
              <th style={thStyle}>Stage</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Amount</th>
              <th style={{ ...thStyle, textAlign: 'right' }}>Last touch</th>
            </tr>
          </thead>
          <tbody>
            {recent.length === 0 && (
              <tr><td colSpan={4} style={{ ...tdStyle, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '24px 16px' }}>No deals yet.</td></tr>
            )}
            {recent.map((c) => (
              <tr key={c.id} onClick={() => onOpenJob(c.id)} style={trRowStyle}>
                <td style={tdStyle}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--v3-text)' }}>{c.name || 'Untitled'}</div>
                  {c.job_title && <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', marginTop: 1 }}>{c.job_title}</div>}
                </td>
                <td style={tdStyle}><StageChip stage={c.stage} /></td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--v3-text)' }}>{fullMoney(c.amount || 0)}</td>
                <td style={{ ...tdStyle, textAlign: 'right', fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>{relTime(c.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  )
}

// ============================================================
// PRIMITIVES
// ============================================================

function KPITile({ label, value, sub, subTone, trend, accent, onClick }: any) {
  const interactive = !!onClick
  const valColor = accent ? 'var(--v3-primary)' : 'var(--v3-text)'
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={!interactive}
      style={{
        textAlign: 'left',
        cursor: interactive ? 'pointer' : 'default',
        background: 'var(--v3-surface, #141110)',
        border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
        borderRadius: 6,
        padding: '16px 18px',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        minHeight: 104,
        color: 'var(--v3-text)',
        transition: 'border-color 140ms ease, background 140ms ease'
      }}
      onMouseEnter={(e) => { if (interactive) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--v3-border-strong, rgba(255, 240, 210, 0.18))' }}
      onMouseLeave={(e) => { if (interactive) (e.currentTarget as HTMLButtonElement).style.borderColor = 'var(--v3-border, rgba(255, 240, 210, 0.10))' }}
    >
      <span style={eyebrowStyle}>{label}</span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 30, lineHeight: 1, letterSpacing: '-0.01em', color: valColor, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {(trend || sub) && (
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>
          {trend && (
            <span style={{
              display: 'inline-flex', alignItems: 'center', gap: 2,
              color: trend.up ? 'var(--v3-success-bright, #4ade80)' : 'var(--v3-danger-bright, #f5a294)',
              fontWeight: 600
            }}>
              {trend.up ? <ArrowUpRight size={10} /> : <ArrowDownRight size={10} />}
              {Math.abs(trend.pct)}% / {trend.period}
            </span>
          )}
          {sub && <span style={{ color: subTone === 'warn' ? 'var(--v3-primary)' : 'var(--v3-text-muted)' }}>{sub}</span>}
        </span>
      )}
    </button>
  )
}

function StageChip({ stage }: { stage: string }) {
  const map: Record<string, { label: string; tone: string }> = {
    lead:    { label: 'Lead',    tone: 'var(--stage-lead, #6B7CA8)'  },
    quote:   { label: 'Quote',   tone: 'var(--stage-quote, #B07A4A)' },
    job:     { label: 'Active',  tone: 'var(--stage-job, #4F8C5E)'   },
    invoice: { label: 'Invoice', tone: 'var(--stage-invoice, #C9963A)'},
    closed:  { label: 'Closed',  tone: 'var(--steel, #5C5C5C)'        },
    lost:    { label: 'Lost',    tone: 'var(--v3-danger, #C0392B)'    },
  }
  const m = map[stage] || { label: stage || '—', tone: 'var(--steel)' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center', gap: 6,
      padding: '2px 8px', borderRadius: 999,
      background: `color-mix(in srgb, ${m.tone} 14%, transparent)`,
      border: `1px solid color-mix(in srgb, ${m.tone} 28%, transparent)`,
      color: m.tone,
      fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
      letterSpacing: '0.08em', textTransform: 'uppercase'
    }}>
      <span aria-hidden="true" style={{ width: 5, height: 5, borderRadius: 999, background: m.tone }} />
      {m.label}
    </span>
  )
}

function relTime(input: any) {
  if (!input) return ''
  const d = input instanceof Date ? input : new Date(input)
  if (Number.isNaN(d.getTime())) return ''
  const diffMin = Math.floor((Date.now() - d.getTime()) / 60000)
  if (diffMin < 1) return 'now'
  if (diffMin < 60) return `${diffMin}m`
  const h = Math.floor(diffMin / 60)
  if (h < 24) return `${h}h`
  const days = Math.floor(h / 24)
  if (days < 7) return `${days}d`
  if (days < 30) return `${Math.floor(days / 7)}w`
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

// ============================================================
// STYLES
// ============================================================

const eyebrowStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.18em',
  textTransform: 'uppercase',
  color: 'var(--v3-text-muted)'
}

const panelStyle: React.CSSProperties = {
  background: 'var(--v3-surface, #141110)',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  borderRadius: 6,
  overflow: 'hidden'
}

const panelHeader: React.CSSProperties = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  padding: '14px 18px 10px',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.08))'
}

const panelTitle: React.CSSProperties = {
  ...eyebrowStyle
}

const linkBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  background: 'transparent', border: 'none', padding: 0,
  fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
  letterSpacing: '0.06em', textTransform: 'uppercase',
  color: 'var(--v3-primary)', cursor: 'pointer'
}

const primaryBtn: React.CSSProperties = {
  background: 'var(--v3-primary)',
  color: 'var(--v3-on-primary, #141414)',
  border: 'none',
  borderRadius: 4,
  padding: '8px 14px',
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  fontWeight: 700,
  letterSpacing: '0.02em',
  cursor: 'pointer',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--v3-primary) 30%, transparent), 0 2px 8px color-mix(in srgb, var(--v3-primary) 20%, transparent)'
}

const stageRowBtn: React.CSSProperties = {
  display: 'flex', alignItems: 'center',
  width: '100%',
  background: 'transparent', border: 'none', padding: '4px 0',
  cursor: 'pointer',
  color: 'inherit'
}

const emptyStateRow: React.CSSProperties = {
  padding: '20px 18px',
  fontFamily: 'var(--font-body)', fontSize: 13,
  color: 'var(--v3-text-muted)',
  textAlign: 'center'
}

const nextActionRow = (first: boolean): React.CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 10,
  width: '100%', textAlign: 'left',
  background: 'transparent', border: 'none',
  padding: '12px 18px',
  borderTop: first ? 'none' : '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))',
  cursor: 'pointer',
  color: 'inherit'
})

const tableStyle: React.CSSProperties = {
  width: '100%',
  borderCollapse: 'collapse',
  fontFamily: 'var(--font-body)'
}

const thStyle: React.CSSProperties = {
  textAlign: 'left',
  fontFamily: 'var(--font-body)',
  fontSize: 10,
  fontWeight: 700,
  letterSpacing: '0.14em',
  textTransform: 'uppercase',
  color: 'var(--v3-text-muted)',
  padding: '10px 16px',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))'
}

const tdStyle: React.CSSProperties = {
  padding: '12px 16px',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))',
  verticalAlign: 'middle'
}

const trRowStyle: React.CSSProperties = {
  cursor: 'pointer',
  transition: 'background 120ms ease'
}
