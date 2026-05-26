// SnowHomeSignature — Variant A.
//
// Evolves Snow by killing the 4-up KPI template. The pipeline number
// is the screen's single hero — big, with the stage distribution
// visualized as a layered ribbon directly underneath. Everything else
// hangs off the side as supporting context.
//
//   [ HERO PIPELINE NUMBER + STAGE RIBBON ]   [ TODAY CARD ]
//   [ RISK STRIP (one row, alert-toned)   ]
//   [ NEXT MOVES (left)                   ]   [ HOT DEALS (right) ]

import { ArrowUpRight, ArrowDownRight, AlertTriangle, Clock, Briefcase, ChevronRight, Sun } from 'lucide-react'

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
  dealsAtRisk: number | null
  jobsBehind: number | null
  invoicingWeek: number | null
  todayOnSite: any[] | null
  topPipeline: any[] | null
  nextActions: any[] | null
  onGoToJobs: (filter?: string) => void
  onGoToSchedule: () => void
  onGoToInvoices: () => void
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

export default function SnowHomeSignature(props: Props) {
  const {
    firstName, now, hasCoords, tempStr, condStr,
    pipeline, trendUp, trendPct, stageBreakdown,
    dealsAtRisk, jobsBehind, invoicingWeek,
    todayOnSite, topPipeline, nextActions,
    onGoToJobs, onGoToSchedule, onGoToInvoices,
    onOpenJob, onOpenJobAtTab, onNewLead,
  } = props

  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const greeting = greetingFor(now)

  // Stage ribbon — split the pipeline bar by stage proportions
  const stages = (() => {
    const groups = { lead: 0, quote: 0, job: 0, invoice: 0 } as Record<string, number>
    for (const c of topPipeline || []) {
      const s = String(c.stage || '').toLowerCase()
      const amt = Number(c.amount || c.value || 0)
      if (s in groups) groups[s] += amt
    }
    const total = Object.values(groups).reduce((a, b) => a + b, 0) || 1
    return [
      { key: 'lead',    label: 'Leads',     amount: groups.lead,    pct: (groups.lead    / total) * 100, color: 'var(--stage-lead, #6B7CA8)' },
      { key: 'quote',   label: 'Quotes',    amount: groups.quote,   pct: (groups.quote   / total) * 100, color: 'var(--stage-quote, #B07A4A)' },
      { key: 'job',     label: 'Active',    amount: groups.job,     pct: (groups.job     / total) * 100, color: 'var(--stage-job, #4F8C5E)' },
      { key: 'invoice', label: 'Invoicing', amount: groups.invoice, pct: (groups.invoice / total) * 100, color: 'var(--stage-invoice, #C9963A)' },
    ]
  })()

  const riskCount = (dealsAtRisk || 0) + (jobsBehind || 0)

  return (
    <div style={{ padding: '24px 8px 56px', color: 'var(--v3-text)' }}>

      {/* HERO ROW — pipeline left, today right */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.6fr) minmax(0, 1fr)', gap: 20, marginBottom: 18 }}>

        {/* PIPELINE HERO */}
        <section
          onClick={() => onGoToJobs()}
          style={{
            ...panelStyle,
            padding: '28px 32px',
            cursor: 'pointer',
            position: 'relative',
            overflow: 'hidden',
          }}
        >
          {/* faint vignette */}
          <span aria-hidden style={{
            position: 'absolute', inset: 0, pointerEvents: 'none',
            background: 'radial-gradient(circle at 18% 30%, color-mix(in srgb, var(--v3-primary) 8%, transparent), transparent 55%)',
          }} />

          <div style={{ position: 'relative' }}>
            <div style={eyebrowStyle}>Active pipeline · all stages</div>

            <div style={{ display: 'flex', alignItems: 'baseline', gap: 14, marginTop: 10 }}>
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 'clamp(64px, 7vw, 88px)',
                lineHeight: 1,
                letterSpacing: '-0.01em',
                color: 'var(--v3-text)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {pipeline == null ? '—' : money(pipeline)}
              </span>
              {trendPct != null && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  fontFamily: 'var(--font-body)',
                  fontSize: 14, fontWeight: 700,
                  color: trendUp ? 'var(--v3-success-bright, #5dd47c)' : 'var(--v3-danger-bright, #ff6b6b)',
                  padding: '4px 10px', borderRadius: 999,
                  background: trendUp
                    ? 'color-mix(in srgb, var(--v3-success, #2ecc71) 12%, transparent)'
                    : 'color-mix(in srgb, var(--v3-danger, #c0392b) 12%, transparent)',
                  border: trendUp
                    ? '1px solid color-mix(in srgb, var(--v3-success, #2ecc71) 30%, transparent)'
                    : '1px solid color-mix(in srgb, var(--v3-danger, #c0392b) 30%, transparent)',
                }}>
                  {trendUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
                  {Math.abs(trendPct).toFixed(0)}%
                </span>
              )}
            </div>

            <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--v3-text-muted)', marginTop: 8 }}>
              {stageBreakdown?.active ?? 0} active jobs · {stageBreakdown?.invoice ?? 0} invoicing · {stageBreakdown?.lead ?? 0} leads in queue
            </div>

            {/* STAGE RIBBON */}
            <div style={{ marginTop: 24 }}>
              <div style={{
                display: 'flex',
                height: 10,
                borderRadius: 5,
                overflow: 'hidden',
                background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.04))',
              }}>
                {stages.map((s) => s.pct > 0 && (
                  <div key={s.key} style={{
                    width: `${s.pct}%`,
                    background: s.color,
                    transition: 'width 320ms ease',
                  }} title={`${s.label}: ${money(s.amount)}`} />
                ))}
              </div>
              <div style={{ display: 'flex', gap: 18, marginTop: 14, flexWrap: 'wrap' }}>
                {stages.map((s) => (
                  <button
                    key={s.key}
                    onClick={(e) => { e.stopPropagation(); onGoToJobs(s.key) }}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8,
                      padding: 0, border: 'none', background: 'transparent',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ width: 8, height: 8, borderRadius: 2, background: s.color }} />
                    <span style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 10, fontWeight: 700,
                      letterSpacing: '0.14em', textTransform: 'uppercase',
                      color: 'var(--v3-text-muted)',
                    }}>
                      {s.label}
                    </span>
                    <span style={{
                      fontFamily: 'var(--font-body)',
                      fontSize: 13, fontWeight: 600,
                      color: 'var(--v3-text)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {money(s.amount)}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* TODAY CARD */}
        <section style={{ ...panelStyle, padding: '20px 22px', display: 'flex', flexDirection: 'column', gap: 14 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div>
              <div style={eyebrowStyle}>{greeting}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 30, lineHeight: 1.05, color: 'var(--v3-text)', marginTop: 4 }}>
                {firstName || 'There'}.
              </div>
            </div>
            {hasCoords && tempStr && (
              <div style={{
                display: 'inline-flex', alignItems: 'center', gap: 6,
                padding: '6px 10px', borderRadius: 999,
                background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.04))',
                border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
              }}>
                <Sun size={12} color="var(--v3-primary)" />
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text)', fontVariantNumeric: 'tabular-nums' }}>{tempStr}</span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>{condStr}</span>
              </div>
            )}
          </div>
          <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text-muted)' }}>{dateLabel}</div>

          <div style={{
            display: 'flex', flexDirection: 'column', gap: 6,
            padding: '12px 14px',
            background: 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))',
            borderRadius: 4,
            border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.08))',
            marginTop: 'auto',
          }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <span style={eyebrowStyle}>On site today</span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, color: 'var(--v3-primary)', fontVariantNumeric: 'tabular-nums' }}>
                {todayOnSite == null ? '—' : todayOnSite.length}
              </span>
            </div>
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text-muted)', lineHeight: 1.5 }}>
              {todayOnSite == null
                ? 'Loading…'
                : todayOnSite.length === 0
                  ? 'No scheduled work today.'
                  : `${todayOnSite.slice(0, 3).map((r: any) => r.title || r.name || 'Job').join(' · ')}${todayOnSite.length > 3 ? `… +${todayOnSite.length - 3}` : ''}`}
            </div>
            <button
              type="button"
              onClick={onGoToSchedule}
              style={{
                marginTop: 4, alignSelf: 'flex-start',
                padding: 0, border: 'none', background: 'transparent',
                fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
                letterSpacing: '0.06em', textTransform: 'uppercase',
                color: 'var(--v3-primary)', cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', gap: 4,
              }}
            >
              Open schedule <ChevronRight size={12} />
            </button>
          </div>
        </section>
      </div>

      {/* RISK STRIP */}
      {(riskCount > 0 || (invoicingWeek ?? 0) > 0) && (
        <section style={{
          ...panelStyle,
          padding: '14px 22px',
          marginBottom: 18,
          display: 'flex',
          alignItems: 'center',
          gap: 24,
          flexWrap: 'wrap',
        }}>
          {(dealsAtRisk ?? 0) > 0 && (
            <RiskChip icon={<AlertTriangle size={13} />} tone="alert" label="Deals at risk" value={dealsAtRisk} onClick={() => onGoToJobs('risk')} />
          )}
          {(jobsBehind ?? 0) > 0 && (
            <RiskChip icon={<Clock size={13} />} tone="warn" label="Jobs behind" value={jobsBehind} onClick={() => onGoToJobs('behind')} />
          )}
          {(invoicingWeek ?? 0) > 0 && (
            <RiskChip icon={<Briefcase size={13} />} tone="gold" label="Invoicing this week" value={`${invoicingWeek}`} onClick={onGoToInvoices} money />
          )}
          <button
            type="button"
            onClick={onNewLead}
            style={{ marginLeft: 'auto', ...primaryBtn }}
          >
            + New lead
          </button>
        </section>
      )}

      {/* NEXT MOVES + HOT DEALS */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 20 }}>

        <section style={panelStyle}>
          <header style={panelHeader}>
            <span style={eyebrowStyle}>Next moves</span>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>
              {nextActions == null ? '…' : nextActions.length}
            </span>
          </header>
          {nextActions == null && <div style={emptyStyle}>Loading…</div>}
          {nextActions != null && nextActions.length === 0 && (
            <div style={emptyStyle}>Nothing waiting on you right now. Good.</div>
          )}
          {nextActions && nextActions.slice(0, 5).map((a: any, i: number) => (
            <button
              key={i}
              onClick={() => a.contactId && onOpenJobAtTab(a.contactId, a.tab)}
              style={moveRowStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <span style={{
                width: 28, height: 28, borderRadius: 6,
                background: 'color-mix(in srgb, var(--v3-primary) 14%, transparent)',
                border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
                color: 'var(--v3-primary)',
                display: 'grid', placeItems: 'center',
                fontFamily: 'var(--font-display)', fontSize: 12,
                flexShrink: 0,
              }}>{i + 1}</span>
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {a.label || a.title || 'Action'}
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', marginTop: 2 }}>
                  {a.subtitle || a.contactName || ''}
                </div>
              </div>
              <ChevronRight size={14} color="var(--v3-text-muted)" />
            </button>
          ))}
        </section>

        <section style={panelStyle}>
          <header style={panelHeader}>
            <span style={eyebrowStyle}>Hot deals</span>
            <button
              type="button"
              onClick={() => onGoToJobs()}
              style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 4, color: 'var(--v3-primary)', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700, letterSpacing: '0.06em', textTransform: 'uppercase' }}
            >
              View all <ChevronRight size={12} />
            </button>
          </header>
          {topPipeline == null && <div style={emptyStyle}>Loading…</div>}
          {topPipeline != null && topPipeline.length === 0 && (
            <div style={emptyStyle}>No deals in the pipeline yet.</div>
          )}
          {topPipeline && topPipeline.slice(0, 5).map((c: any) => (
            <button
              key={c.id}
              onClick={() => onOpenJob(c.id)}
              style={moveRowStyle}
              onMouseEnter={(e) => { e.currentTarget.style.background = 'var(--v3-surface-2, rgba(255, 240, 210, 0.03))' }}
              onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
            >
              <div style={{ flex: 1, minWidth: 0, textAlign: 'left' }}>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {c.name || 'Unnamed'}
                </div>
                <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', marginTop: 2, textTransform: 'uppercase', letterSpacing: '0.06em', fontWeight: 700 }}>
                  {c.stage || '—'}
                </div>
              </div>
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 18,
                color: 'var(--v3-primary)',
                fontVariantNumeric: 'tabular-nums',
              }}>
                {money(c.amount || c.value || 0)}
              </span>
            </button>
          ))}
        </section>
      </div>
    </div>
  )
}

function RiskChip({ icon, tone, label, value, onClick, money: isMoney }: any) {
  const color = tone === 'alert'
    ? 'var(--v3-danger-bright, #ff6b6b)'
    : tone === 'warn'
      ? '#e0a141'
      : 'var(--v3-primary)'
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 10,
        padding: 0, border: 'none', background: 'transparent',
        cursor: onClick ? 'pointer' : 'default',
      }}
    >
      <span style={{
        width: 26, height: 26, borderRadius: 6,
        display: 'grid', placeItems: 'center',
        color,
        background: `color-mix(in srgb, ${color} 14%, transparent)`,
        border: `1px solid color-mix(in srgb, ${color} 35%, transparent)`,
      }}>{icon}</span>
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: 22, lineHeight: 1, color: 'var(--v3-text)',
        fontVariantNumeric: 'tabular-nums',
      }}>
        {isMoney ? money(value) : value}
      </span>
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 10, fontWeight: 700,
        letterSpacing: '0.14em', textTransform: 'uppercase',
        color: 'var(--v3-text-muted)',
      }}>
        {label}
      </span>
    </button>
  )
}

function greetingFor(d: Date) {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

const eyebrowStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
  letterSpacing: '0.18em', textTransform: 'uppercase',
  color: 'var(--v3-text-muted)',
}

const panelStyle: React.CSSProperties = {
  background: 'var(--v3-surface, #141110)',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  borderRadius: 6, overflow: 'hidden',
}

const panelHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '16px 20px',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.08))',
}

const emptyStyle: React.CSSProperties = {
  padding: '32px 20px',
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  color: 'var(--v3-text-muted)',
  textAlign: 'center',
}

const moveRowStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '12px 20px',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))',
  width: '100%',
  background: 'transparent',
  border: 'none',
  cursor: 'pointer',
  transition: 'background 120ms ease',
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'var(--v3-primary)',
  color: 'var(--v3-on-primary, #141414)',
  border: 'none', borderRadius: 4, padding: '8px 16px',
  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
  letterSpacing: '0.04em', cursor: 'pointer',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--v3-primary) 30%, transparent), 0 2px 8px color-mix(in srgb, var(--v3-primary) 20%, transparent)',
}
