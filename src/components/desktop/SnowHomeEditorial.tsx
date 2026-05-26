// SnowHomeEditorial — Variant B.
//
// Magazine direction. Big display type, asymmetric layout, masthead
// feel. Two-column page: a left "feature" with oversized hero
// headline and the day's lead story (today on site / next move), and
// a right "rail" of dispatches (top deals, pipeline distribution,
// risks).
//
//   ─────────── MASTHEAD ───────────
//   FEATURE COLUMN              RAIL COLUMN
//   ┌────────────────┐  ┌──────────────────┐
//   │  Big greeting  │  │  Pipeline tower  │
//   │  + date        │  │  (vertical bars) │
//   │                │  │                  │
//   │  Lead story:   │  │  Hot deals       │
//   │  pipeline hero │  │                  │
//   │                │  │  Risks           │
//   │  On-site card  │  │                  │
//   └────────────────┘  └──────────────────┘

import { ChevronRight, AlertTriangle, Clock, Briefcase } from 'lucide-react'

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

export default function SnowHomeEditorial(props: Props) {
  const {
    firstName, now, hasCoords, tempStr, condStr,
    pipeline, trendUp, trendPct, stageBreakdown,
    dealsAtRisk, jobsBehind, invoicingWeek,
    todayOnSite, topPipeline, nextActions,
    onGoToJobs, onGoToSchedule, onGoToInvoices,
    onOpenJob, onOpenJobAtTab, onNewLead,
  } = props

  const dateLabel = now.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
  const issueNo = String(now.getFullYear() * 1000 + dayOfYear(now)).slice(-4)

  // Pipeline tower data
  const tower = (() => {
    const groups: Record<string, { label: string; amount: number; count: number; color: string }> = {
      lead:    { label: 'Leads',     amount: 0, count: 0, color: 'var(--stage-lead, #6B7CA8)' },
      quote:   { label: 'Quotes',    amount: 0, count: 0, color: 'var(--stage-quote, #B07A4A)' },
      job:     { label: 'Active',    amount: 0, count: 0, color: 'var(--stage-job, #4F8C5E)' },
      invoice: { label: 'Invoicing', amount: 0, count: 0, color: 'var(--stage-invoice, #C9963A)' },
    }
    for (const c of topPipeline || []) {
      const s = String(c.stage || '').toLowerCase()
      if (s in groups) { groups[s].amount += Number(c.amount || c.value || 0); groups[s].count++ }
    }
    const max = Math.max(...Object.values(groups).map((g) => g.amount), 1)
    return Object.entries(groups).map(([key, g]) => ({ key, ...g, pct: (g.amount / max) * 100 }))
  })()

  return (
    <div style={{ padding: '20px 8px 56px', background: 'var(--v3-bg)', color: 'var(--v3-text)' }}>

      {/* MASTHEAD */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        paddingBottom: 14,
        borderTop: '3px solid var(--v3-primary)',
        borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
        paddingTop: 14,
        marginBottom: 36,
      }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 18 }}>
          <span style={{
            fontFamily: 'var(--font-display)',
            fontSize: 28, lineHeight: 1, letterSpacing: '0.02em',
            color: 'var(--v3-text)',
          }}>
            FIELDHORSE
          </span>
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.22em', textTransform: 'uppercase',
            color: 'var(--v3-text-muted)',
          }}>
            Daily Dispatch · Vol. {now.getFullYear()} · No. {issueNo}
          </span>
        </div>
        <div style={{
          fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
          letterSpacing: '0.14em', textTransform: 'uppercase',
          color: 'var(--v3-text-muted)',
        }}>
          {dateLabel}{hasCoords && tempStr ? ` · ${tempStr} ${condStr}` : ''}
        </div>
      </div>

      {/* TWO-COLUMN PAGE */}
      <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 56 }}>

        {/* FEATURE COLUMN */}
        <article style={{ minWidth: 0 }}>
          <div style={{
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
            letterSpacing: '0.22em', textTransform: 'uppercase',
            color: 'var(--v3-primary)',
            marginBottom: 18,
          }}>
            ✦ Feature · The state of play
          </div>

          <h1 style={{
            margin: 0,
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(56px, 7vw, 92px)',
            lineHeight: 0.95,
            letterSpacing: '-0.015em',
            color: 'var(--v3-text)',
            fontWeight: 400,
          }}>
            {greetingFor(now)}, <span style={{ color: 'var(--v3-primary)' }}>{firstName || 'there'}</span>.
          </h1>

          <p style={{
            margin: '24px 0 0',
            fontFamily: 'var(--font-body)',
            fontSize: 18,
            lineHeight: 1.55,
            color: 'var(--v3-text-muted)',
            maxWidth: 580,
          }}>
            You're sitting on{' '}
            <strong style={{ color: 'var(--v3-text)' }}>{money(pipeline ?? 0)}</strong>{' '}
            of active pipeline across{' '}
            <strong style={{ color: 'var(--v3-text)' }}>{(stageBreakdown?.lead ?? 0) + (stageBreakdown?.active ?? 0) + (stageBreakdown?.invoice ?? 0)}</strong>{' '}
            open deals.
            {trendPct != null && (
              <>
                {' '}That's{' '}
                <strong style={{ color: trendUp ? 'var(--v3-success-bright, #5dd47c)' : 'var(--v3-danger-bright, #ff6b6b)' }}>
                  {trendUp ? '+' : '−'}{Math.abs(trendPct).toFixed(0)}%
                </strong>{' '}
                vs. last period.
              </>
            )}
          </p>

          {/* Pull-quote / lead */}
          <div style={{
            marginTop: 36,
            paddingLeft: 18,
            borderLeft: '3px solid var(--v3-primary)',
          }}>
            <div style={{
              fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              color: 'var(--v3-primary)',
              marginBottom: 8,
            }}>
              Today's lead
            </div>
            {nextActions == null && (
              <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--v3-text-muted)' }}>Loading…</p>
            )}
            {nextActions != null && nextActions.length === 0 && (
              <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--v3-text-muted)' }}>
                Nothing needs your hand today. Take the win.
              </p>
            )}
            {nextActions && nextActions.length > 0 && (
              <>
                <h2 style={{
                  margin: 0,
                  fontFamily: 'var(--font-display)',
                  fontSize: 32, lineHeight: 1.1,
                  color: 'var(--v3-text)',
                  fontWeight: 400,
                  letterSpacing: '-0.005em',
                }}>
                  {(nextActions[0] as any).label || 'Action waiting'}
                </h2>
                {((nextActions[0] as any).subtitle || (nextActions[0] as any).contactName) && (
                  <p style={{
                    margin: '8px 0 0',
                    fontFamily: 'var(--font-body)',
                    fontSize: 14, color: 'var(--v3-text-muted)',
                  }}>
                    On {(nextActions[0] as any).contactName || (nextActions[0] as any).subtitle}
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const a = nextActions[0] as any
                    if (a.contactId) onOpenJobAtTab(a.contactId, a.tab)
                  }}
                  style={{
                    marginTop: 16, padding: '10px 22px',
                    background: 'var(--v3-primary)',
                    color: 'var(--v3-on-primary, #141414)',
                    border: 'none', borderRadius: 4,
                    fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
                    letterSpacing: '0.08em', textTransform: 'uppercase',
                    cursor: 'pointer',
                  }}
                >
                  Take action →
                </button>
              </>
            )}
          </div>

          {/* On-site dispatch */}
          <section style={{ marginTop: 48 }}>
            <div style={{
              fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
              letterSpacing: '0.22em', textTransform: 'uppercase',
              color: 'var(--v3-text-muted)',
              marginBottom: 12,
              display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            }}>
              <span>From the field · Today on site</span>
              <button
                type="button"
                onClick={onGoToSchedule}
                style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer', fontFamily: 'inherit', fontSize: 'inherit', letterSpacing: 'inherit', textTransform: 'inherit', color: 'var(--v3-primary)' }}
              >
                See the day →
              </button>
            </div>
            {todayOnSite == null && <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--v3-text-muted)' }}>Loading…</p>}
            {todayOnSite != null && todayOnSite.length === 0 && (
              <p style={{ margin: 0, fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--v3-text-muted)' }}>
                Quiet day. No scheduled work.
              </p>
            )}
            {todayOnSite && todayOnSite.length > 0 && (
              <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 16 }}>
                {todayOnSite.slice(0, 4).map((r: any, i: number) => (
                  <li
                    key={r.id || i}
                    style={{ display: 'grid', gridTemplateColumns: '36px 1fr auto', gap: 14, alignItems: 'baseline', paddingBottom: 14, borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.08))' }}
                  >
                    <span style={{
                      fontFamily: 'var(--font-display)',
                      fontSize: 22, lineHeight: 1,
                      color: 'var(--v3-primary)',
                      fontVariantNumeric: 'tabular-nums',
                    }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <div>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 15, color: 'var(--v3-text)', fontWeight: 600 }}>
                        {r.title || r.name || 'Job'}
                      </div>
                      {(r.subtitle || r.time) && (
                        <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text-muted)', marginTop: 2 }}>
                          {r.subtitle || r.time}
                        </div>
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </article>

        {/* RAIL COLUMN */}
        <aside style={{ minWidth: 0, paddingLeft: 36, borderLeft: '1px solid var(--v3-border, rgba(255, 240, 210, 0.08))' }}>

          {/* Pipeline tower */}
          <section style={{ marginBottom: 40 }}>
            <div style={railEyebrow}>The pipeline</div>
            <div style={{
              fontFamily: 'var(--font-display)',
              fontSize: 44, lineHeight: 1,
              color: 'var(--v3-text)',
              fontVariantNumeric: 'tabular-nums',
              marginTop: 6,
            }}>
              {money(pipeline ?? 0)}
            </div>

            {/* Vertical bar tower */}
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 10,
              marginTop: 22,
              alignItems: 'end',
              height: 120,
            }}>
              {tower.map((t) => (
                <button
                  key={t.key}
                  onClick={() => onGoToJobs(t.key)}
                  style={{ display: 'flex', flexDirection: 'column', justifyContent: 'flex-end', gap: 8, background: 'transparent', border: 'none', cursor: 'pointer', padding: 0 }}
                >
                  <div style={{
                    width: '100%',
                    height: `${Math.max(t.pct, 4)}%`,
                    background: t.color,
                    borderRadius: '2px 2px 0 0',
                    minHeight: 4,
                    transition: 'height 320ms ease',
                  }} />
                  <div style={{
                    fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.14em', textTransform: 'uppercase',
                    color: 'var(--v3-text-muted)',
                  }}>
                    {t.label}
                  </div>
                  <div style={{
                    fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
                    color: 'var(--v3-text)',
                    fontVariantNumeric: 'tabular-nums',
                  }}>
                    {money(t.amount)}
                  </div>
                </button>
              ))}
            </div>
          </section>

          {/* Hot deals */}
          <section style={{ marginBottom: 40 }}>
            <div style={railEyebrow}>Hot deals</div>
            {topPipeline == null && <div style={{ marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--v3-text-muted)' }}>Loading…</div>}
            {topPipeline != null && topPipeline.length === 0 && (
              <div style={{ marginTop: 12, fontFamily: 'var(--font-body)', fontSize: 13, color: 'var(--v3-text-muted)' }}>No deals.</div>
            )}
            {topPipeline && topPipeline.slice(0, 4).map((c: any, i: number) => (
              <button
                key={c.id}
                onClick={() => onOpenJob(c.id)}
                style={{
                  display: 'flex', alignItems: 'baseline', gap: 12,
                  padding: '14px 0',
                  borderBottom: i === Math.min(topPipeline.length, 4) - 1 ? 'none' : '1px solid var(--v3-border, rgba(255, 240, 210, 0.08))',
                  width: '100%',
                  background: 'transparent',
                  border: 'none',
                  borderBottomWidth: i === Math.min(topPipeline.length, 4) - 1 ? 0 : 1,
                  borderBottomStyle: 'solid',
                  borderBottomColor: 'var(--v3-border, rgba(255, 240, 210, 0.08))',
                  cursor: 'pointer',
                  textAlign: 'left',
                }}
              >
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, color: 'var(--v3-text)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {c.name || 'Unnamed'}
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--v3-text-muted)', marginTop: 3 }}>
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

          {/* Risks */}
          {((dealsAtRisk ?? 0) > 0 || (jobsBehind ?? 0) > 0 || (invoicingWeek ?? 0) > 0) && (
            <section>
              <div style={railEyebrow}>Watch list</div>
              <ul style={{ margin: '12px 0 0', padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(dealsAtRisk ?? 0) > 0 && (
                  <RiskLine icon={<AlertTriangle size={13} />} label="Deals at risk" value={dealsAtRisk} tone="alert" onClick={() => onGoToJobs('risk')} />
                )}
                {(jobsBehind ?? 0) > 0 && (
                  <RiskLine icon={<Clock size={13} />} label="Jobs running behind" value={jobsBehind} tone="warn" onClick={() => onGoToJobs('behind')} />
                )}
                {(invoicingWeek ?? 0) > 0 && (
                  <RiskLine icon={<Briefcase size={13} />} label="Invoicing this week" value={invoicingWeek} tone="gold" onClick={onGoToInvoices} />
                )}
              </ul>
            </section>
          )}

          <button
            type="button"
            onClick={onNewLead}
            style={{
              marginTop: 32, width: '100%',
              padding: '14px 18px',
              background: 'var(--v3-primary)',
              color: 'var(--v3-on-primary, #141414)',
              border: 'none', borderRadius: 4,
              fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase',
              cursor: 'pointer',
              boxShadow: '0 0 0 1px color-mix(in srgb, var(--v3-primary) 30%, transparent)',
            }}
          >
            Start a new lead
          </button>
        </aside>
      </div>
    </div>
  )
}

function RiskLine({ icon, label, value, tone, onClick }: any) {
  const color = tone === 'alert'
    ? 'var(--v3-danger-bright, #ff6b6b)'
    : tone === 'warn'
      ? '#e0a141'
      : 'var(--v3-primary)'
  return (
    <li>
      <button
        type="button"
        onClick={onClick}
        style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: 0,
          background: 'transparent', border: 'none',
          width: '100%',
          cursor: onClick ? 'pointer' : 'default',
          textAlign: 'left',
        }}
      >
        <span style={{ color, display: 'grid', placeItems: 'center', width: 18 }}>{icon}</span>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 22, lineHeight: 1,
          color: 'var(--v3-text)',
          fontVariantNumeric: 'tabular-nums',
          minWidth: 32,
        }}>
          {value}
        </span>
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 12,
          color: 'var(--v3-text-muted)',
          flex: 1,
        }}>
          {label}
        </span>
        <ChevronRight size={13} color="var(--v3-text-muted)" />
      </button>
    </li>
  )
}

function greetingFor(d: Date) {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function dayOfYear(d: Date) {
  const start = new Date(d.getFullYear(), 0, 0)
  const diff = d.getTime() - start.getTime()
  return Math.floor(diff / 86400000)
}

const railEyebrow: React.CSSProperties = {
  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
  letterSpacing: '0.22em', textTransform: 'uppercase',
  color: 'var(--v3-primary)',
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  paddingBottom: 8,
}
