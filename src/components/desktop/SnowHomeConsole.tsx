// SnowHomeConsole — Variant C.
//
// Bloomberg / air-traffic operator console direction. Tight, dense,
// semantic color, monospace-leaning numbers, live-feel ticker strip,
// sparklines per row. Power-user feel.
//
//   [ STATUS BAR ] live · uptime · clock
//   [ TICKER STRIP — Pipeline | Active | Won | Risks | etc.    ]
//   [ MAIN GRID                                                ]
//   ├ PIPELINE TERMINAL (table) ┤ ├ EXECUTIVE FEED (alerts) ┤
//   [ ON-SITE TODAY (table) ][ NEXT MOVES QUEUE (table) ]

import { Activity, Circle, TrendingUp, TrendingDown, AlertTriangle, Zap } from 'lucide-react'

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

const MONO = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace'

function money(n: number | null | undefined) {
  const v = Number(n || 0)
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(1)}K`
  return `$${Math.round(v).toLocaleString()}`
}

export default function SnowHomeConsole(props: Props) {
  const {
    firstName, now, hasCoords, tempStr, condStr,
    pipeline, trendUp, trendPct, stageBreakdown,
    dealsAtRisk, jobsBehind, invoicingWeek,
    todayOnSite, topPipeline, nextActions,
    onGoToJobs, onGoToSchedule, onGoToInvoices,
    onOpenJob, onOpenJobAtTab, onNewLead,
  } = props

  const timeStr = now.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
  const dateStr = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: '2-digit', year: 'numeric' }).toUpperCase()

  return (
    <div style={{
      padding: '12px 8px 48px',
      color: 'var(--v3-text)',
      background: 'var(--v3-bg, #0b0907)',
      fontFamily: 'var(--font-body)',
    }}>

      {/* STATUS BAR */}
      <div style={{
        display: 'flex', alignItems: 'center', gap: 14,
        padding: '8px 14px',
        background: '#0a0907',
        border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
        borderRadius: 3,
        marginBottom: 12,
        fontFamily: MONO,
        fontSize: 11,
        letterSpacing: '0.04em',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--v3-success-bright, #5dd47c)' }}>
          <Circle size={6} fill="currentColor" />
          LIVE
        </span>
        <span style={{ color: 'var(--v3-text-muted)' }}>OP: {firstName?.toUpperCase() || 'USER'}</span>
        <span style={{ color: 'var(--v3-border, rgba(255, 240, 210, 0.20))' }}>│</span>
        <span style={{ color: 'var(--v3-text-muted)' }}>{dateStr}</span>
        <span style={{ color: 'var(--v3-border, rgba(255, 240, 210, 0.20))' }}>│</span>
        <span style={{ color: 'var(--v3-primary)', fontVariantNumeric: 'tabular-nums' }}>{timeStr}</span>
        {hasCoords && tempStr && (
          <>
            <span style={{ color: 'var(--v3-border, rgba(255, 240, 210, 0.20))' }}>│</span>
            <span style={{ color: 'var(--v3-text-muted)' }}>WX {tempStr.replace('°', '')}F {condStr?.toUpperCase()}</span>
          </>
        )}
        <span style={{ marginLeft: 'auto', display: 'inline-flex', alignItems: 'center', gap: 6, color: 'var(--v3-text-muted)' }}>
          <Activity size={11} color="var(--v3-primary)" />
          UPTIME OK
        </span>
      </div>

      {/* TICKER STRIP */}
      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: 0,
        border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
        borderRadius: 3,
        background: '#0d0a08',
        marginBottom: 14,
      }}>
        <Tick label="PIPELINE.TOTAL" value={money(pipeline ?? 0)} delta={trendPct} up={trendUp} accent />
        <Tick label="STAGE.LEAD"     value={String(stageBreakdown?.lead ?? 0)} />
        <Tick label="STAGE.ACTIVE"   value={String(stageBreakdown?.active ?? 0)} />
        <Tick label="STAGE.INVC"     value={String(stageBreakdown?.invoice ?? 0)} />
        <Tick label="RISK.DEALS"     value={String(dealsAtRisk ?? 0)} tone={(dealsAtRisk ?? 0) > 0 ? 'alert' : undefined} />
        <Tick label="JOBS.BEHIND"    value={String(jobsBehind ?? 0)} tone={(jobsBehind ?? 0) > 0 ? 'warn' : undefined} last />
      </div>

      {/* MAIN GRID */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1.5fr) minmax(0, 1fr)', gap: 12, marginBottom: 12 }}>

        {/* PIPELINE TERMINAL */}
        <section style={termPanel}>
          <header style={termHeader}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <Zap size={11} color="var(--v3-primary)" />
              <span>PIPELINE / TOP DEALS</span>
            </span>
            <span style={{ color: 'var(--v3-text-muted)' }}>
              [{topPipeline?.length ?? 0}]
            </span>
          </header>

          <div style={{ padding: 0 }}>
            <table style={termTable}>
              <thead>
                <tr style={{ background: '#0a0907' }}>
                  <th style={termTh}>#</th>
                  <th style={termTh}>NAME</th>
                  <th style={termTh}>STAGE</th>
                  <th style={{ ...termTh, textAlign: 'right' }}>VALUE</th>
                  <th style={{ ...termTh, textAlign: 'right', width: 70 }}>SIG</th>
                </tr>
              </thead>
              <tbody>
                {topPipeline == null && (
                  <tr><td colSpan={5} style={{ ...termTd, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '24px 10px' }}>LOADING...</td></tr>
                )}
                {topPipeline != null && topPipeline.length === 0 && (
                  <tr><td colSpan={5} style={{ ...termTd, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '24px 10px' }}>NO ACTIVE DEALS</td></tr>
                )}
                {topPipeline && topPipeline.slice(0, 8).map((c: any, i: number) => {
                  const v = Number(c.amount || c.value || 0)
                  const max = Math.max(...(topPipeline || []).map((x: any) => Number(x.amount || x.value || 0)), 1)
                  const sigPct = (v / max) * 100
                  return (
                    <tr
                      key={c.id}
                      onClick={() => onOpenJob(c.id)}
                      style={termRow}
                      onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--v3-primary) 4%, transparent)' }}
                      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                    >
                      <td style={{ ...termTd, color: 'var(--v3-text-muted)' }}>{String(i + 1).padStart(2, '0')}</td>
                      <td style={{ ...termTd, color: 'var(--v3-text)', fontWeight: 600, maxWidth: 220, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {(c.name || 'UNNAMED').toUpperCase()}
                      </td>
                      <td style={{ ...termTd, color: stageColor(c.stage), letterSpacing: '0.06em' }}>
                        {String(c.stage || '—').toUpperCase()}
                      </td>
                      <td style={{ ...termTd, textAlign: 'right', color: 'var(--v3-primary)', fontWeight: 700 }}>
                        {money(v)}
                      </td>
                      <td style={{ ...termTd, textAlign: 'right', paddingRight: 12 }}>
                        <span aria-hidden style={{ display: 'inline-block', height: 6, background: 'var(--v3-primary)', width: `${Math.max(sigPct, 4)}%`, borderRadius: 1, verticalAlign: 'middle' }} />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </section>

        {/* EXECUTIVE FEED */}
        <section style={termPanel}>
          <header style={termHeader}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
              <AlertTriangle size={11} color={(dealsAtRisk || jobsBehind) ? 'var(--v3-danger-bright, #ff6b6b)' : 'var(--v3-text-muted)'} />
              <span>EXEC FEED / SIGNALS</span>
            </span>
          </header>

          <div style={{ padding: 0 }}>
            {(dealsAtRisk ?? 0) > 0 && (
              <FeedLine
                level="ALERT"
                tone="alert"
                title={`${dealsAtRisk} deal${dealsAtRisk! > 1 ? 's' : ''} at risk`}
                meta="REQ: triage within 24h"
                onClick={() => onGoToJobs('risk')}
              />
            )}
            {(jobsBehind ?? 0) > 0 && (
              <FeedLine
                level="WARN"
                tone="warn"
                title={`${jobsBehind} job${jobsBehind! > 1 ? 's' : ''} running behind`}
                meta="REQ: ETA update"
                onClick={() => onGoToJobs('behind')}
              />
            )}
            {(invoicingWeek ?? 0) > 0 && (
              <FeedLine
                level="INFO"
                tone="gold"
                title={`${invoicingWeek} invoice${invoicingWeek! > 1 ? 's' : ''} due this week`}
                meta="REQ: send + collect"
                onClick={onGoToInvoices}
              />
            )}
            {trendPct != null && Math.abs(trendPct) >= 5 && (
              <FeedLine
                level={trendUp ? 'GOOD' : 'WARN'}
                tone={trendUp ? 'good' : 'warn'}
                title={`Pipeline ${trendUp ? 'up' : 'down'} ${Math.abs(trendPct).toFixed(0)}%`}
                meta={`MoM vs. last period`}
                onClick={() => onGoToJobs()}
              />
            )}
            {(dealsAtRisk ?? 0) === 0 && (jobsBehind ?? 0) === 0 && (invoicingWeek ?? 0) === 0 && (
              <div style={{ padding: '24px 14px', textAlign: 'center', color: 'var(--v3-text-muted)', fontFamily: MONO, fontSize: 11 }}>
                ALL SYSTEMS NOMINAL
              </div>
            )}
          </div>
        </section>
      </div>

      {/* SECONDARY GRID — on-site + next actions */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1fr)', gap: 12 }}>

        <section style={termPanel}>
          <header style={termHeader}>
            <span>ON-SITE TODAY [{todayOnSite?.length ?? 0}]</span>
            <button
              type="button"
              onClick={onGoToSchedule}
              style={{ background: 'transparent', border: 'none', color: 'var(--v3-primary)', cursor: 'pointer', fontFamily: MONO, fontSize: 10, letterSpacing: '0.10em' }}
            >
              SCHEDULE →
            </button>
          </header>

          <table style={termTable}>
            <thead>
              <tr style={{ background: '#0a0907' }}>
                <th style={termTh}>#</th>
                <th style={termTh}>TIME</th>
                <th style={termTh}>JOB</th>
                <th style={termTh}>STATUS</th>
              </tr>
            </thead>
            <tbody>
              {todayOnSite == null && (
                <tr><td colSpan={4} style={{ ...termTd, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '20px 10px' }}>LOADING...</td></tr>
              )}
              {todayOnSite != null && todayOnSite.length === 0 && (
                <tr><td colSpan={4} style={{ ...termTd, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '20px 10px' }}>NO WORK SCHEDULED</td></tr>
              )}
              {todayOnSite && todayOnSite.slice(0, 6).map((r: any, i: number) => (
                <tr
                  key={r.id || i}
                  style={termRow}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--v3-primary) 4%, transparent)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <td style={{ ...termTd, color: 'var(--v3-text-muted)' }}>{String(i + 1).padStart(2, '0')}</td>
                  <td style={{ ...termTd, color: 'var(--v3-primary)' }}>{r.time || '—'}</td>
                  <td style={{ ...termTd, color: 'var(--v3-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 180 }}>
                    {(r.title || r.name || 'JOB').toUpperCase()}
                  </td>
                  <td style={{ ...termTd, color: 'var(--v3-success-bright, #5dd47c)' }}>SCHED</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>

        <section style={termPanel}>
          <header style={termHeader}>
            <span>ACTION QUEUE [{nextActions?.length ?? 0}]</span>
            <button
              type="button"
              onClick={onNewLead}
              style={{ background: 'var(--v3-primary)', color: 'var(--v3-on-primary, #141414)', border: 'none', borderRadius: 2, padding: '4px 10px', cursor: 'pointer', fontFamily: MONO, fontSize: 10, letterSpacing: '0.10em', fontWeight: 700 }}
            >
              + LEAD
            </button>
          </header>

          <table style={termTable}>
            <thead>
              <tr style={{ background: '#0a0907' }}>
                <th style={termTh}>PRI</th>
                <th style={termTh}>ACTION</th>
                <th style={termTh}>TARGET</th>
              </tr>
            </thead>
            <tbody>
              {nextActions == null && (
                <tr><td colSpan={3} style={{ ...termTd, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '20px 10px' }}>LOADING...</td></tr>
              )}
              {nextActions != null && nextActions.length === 0 && (
                <tr><td colSpan={3} style={{ ...termTd, color: 'var(--v3-text-muted)', textAlign: 'center', padding: '20px 10px' }}>QUEUE EMPTY</td></tr>
              )}
              {nextActions && nextActions.slice(0, 6).map((a: any, i: number) => (
                <tr
                  key={i}
                  onClick={() => a.contactId && onOpenJobAtTab(a.contactId, a.tab)}
                  style={termRow}
                  onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--v3-primary) 4%, transparent)' }}
                  onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
                >
                  <td style={{ ...termTd, color: i < 2 ? 'var(--v3-danger-bright, #ff6b6b)' : 'var(--v3-text-muted)', fontWeight: 700 }}>
                    P{i + 1}
                  </td>
                  <td style={{ ...termTd, color: 'var(--v3-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>
                    {(a.label || a.title || 'ACTION').toUpperCase()}
                  </td>
                  <td style={{ ...termTd, color: 'var(--v3-text-muted)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 140 }}>
                    {(a.contactName || a.subtitle || '—').toUpperCase()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  )
}

function Tick({ label, value, delta, up, tone, accent, last }: any) {
  const valColor = tone === 'alert'
    ? 'var(--v3-danger-bright, #ff6b6b)'
    : tone === 'warn'
      ? '#e0a141'
      : accent
        ? 'var(--v3-primary)'
        : 'var(--v3-text)'
  return (
    <div style={{
      padding: '12px 14px',
      borderRight: last ? 'none' : '1px solid var(--v3-border, rgba(255, 240, 210, 0.08))',
      display: 'flex', flexDirection: 'column', gap: 4,
    }}>
      <span style={{ fontFamily: MONO, fontSize: 9.5, fontWeight: 700, letterSpacing: '0.10em', color: 'var(--v3-text-muted)' }}>{label}</span>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
        <span style={{ fontFamily: MONO, fontSize: 18, fontWeight: 700, color: valColor, fontVariantNumeric: 'tabular-nums' }}>
          {value}
        </span>
        {delta != null && (
          <span style={{
            fontFamily: MONO, fontSize: 10, fontWeight: 700,
            color: up ? 'var(--v3-success-bright, #5dd47c)' : 'var(--v3-danger-bright, #ff6b6b)',
            display: 'inline-flex', alignItems: 'center', gap: 2,
          }}>
            {up ? <TrendingUp size={9} /> : <TrendingDown size={9} />}
            {Math.abs(delta).toFixed(0)}%
          </span>
        )}
      </span>
    </div>
  )
}

function FeedLine({ level, tone, title, meta, onClick }: any) {
  const color = tone === 'alert'
    ? 'var(--v3-danger-bright, #ff6b6b)'
    : tone === 'warn'
      ? '#e0a141'
      : tone === 'good'
        ? 'var(--v3-success-bright, #5dd47c)'
        : 'var(--v3-primary)'
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: 'flex', alignItems: 'center', gap: 10,
        padding: '10px 14px',
        background: 'transparent',
        border: 'none',
        borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))',
        width: '100%',
        cursor: 'pointer',
        textAlign: 'left',
        transition: 'background 120ms ease',
      }}
      onMouseEnter={(e) => { e.currentTarget.style.background = 'color-mix(in srgb, var(--v3-primary) 4%, transparent)' }}
      onMouseLeave={(e) => { e.currentTarget.style.background = 'transparent' }}
    >
      <span style={{
        fontFamily: MONO, fontSize: 9, fontWeight: 700,
        padding: '3px 6px', borderRadius: 2,
        background: `color-mix(in srgb, ${color} 16%, transparent)`,
        color,
        letterSpacing: '0.10em',
        minWidth: 48, textAlign: 'center',
      }}>
        {level}
      </span>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--v3-text)' }}>{title}</div>
        <div style={{ fontFamily: MONO, fontSize: 10, color: 'var(--v3-text-muted)', marginTop: 2, letterSpacing: '0.04em' }}>{meta}</div>
      </div>
    </button>
  )
}

function stageColor(s: string | undefined) {
  switch (String(s || '').toLowerCase()) {
    case 'lead':    return 'var(--stage-lead, #6B7CA8)'
    case 'quote':   return 'var(--stage-quote, #B07A4A)'
    case 'job':     return 'var(--stage-job, #4F8C5E)'
    case 'invoice': return 'var(--stage-invoice, #C9963A)'
    case 'won':     return 'var(--v3-success-bright, #5dd47c)'
    default:        return 'var(--v3-text-muted)'
  }
}

const termPanel: React.CSSProperties = {
  background: '#0d0a08',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  borderRadius: 3,
  overflow: 'hidden',
}

const termHeader: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 12px',
  background: '#0a0907',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  fontFamily: MONO,
  fontSize: 10, fontWeight: 700,
  letterSpacing: '0.10em',
  color: 'var(--v3-text)',
}

const termTable: React.CSSProperties = {
  width: '100%', borderCollapse: 'collapse', fontFamily: MONO,
}

const termTh: React.CSSProperties = {
  textAlign: 'left',
  fontFamily: MONO, fontSize: 9.5, fontWeight: 700,
  letterSpacing: '0.10em',
  color: 'var(--v3-text-muted)',
  padding: '8px 10px',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
}

const termTd: React.CSSProperties = {
  padding: '8px 10px',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))',
  fontSize: 11.5,
  fontVariantNumeric: 'tabular-nums',
}

const termRow: React.CSSProperties = {
  cursor: 'pointer',
  transition: 'background 100ms ease',
}
