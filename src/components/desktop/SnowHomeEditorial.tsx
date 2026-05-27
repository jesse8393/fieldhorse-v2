// SnowHomeEditorial — magazine-direction desktop Home.
//
// Two-column "broadsheet" page: a wide feature column with a big
// display headline and lead story, and a thin rail of dispatches
// (pipeline tower, hot deals, watch list). Masthead at top.
//
// At narrow desktop widths (<1100px) the rail stacks beneath the
// feature so nothing gets crushed.

import { ChevronRight, AlertTriangle, Clock, Briefcase, ArrowUpRight, ArrowDownRight, Sun, CheckCircle2 } from 'lucide-react'

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
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(2)}M`
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

  const weekday = now.toLocaleDateString(undefined, { weekday: 'long' })
  const monthDay = now.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })
  const dateStamp = now.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
  const issueNo = String(now.getFullYear() * 1000 + dayOfYear(now)).slice(-4)

  // Pipeline tower — split totals by stage from topPipeline
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

  const totalOpen = (stageBreakdown?.lead ?? 0) + (stageBreakdown?.active ?? 0) + (stageBreakdown?.invoice ?? 0)
  const riskCount = (dealsAtRisk ?? 0) + (jobsBehind ?? 0)

  return (
    <div className="eh-page" style={{ padding: '20px 8px 56px', background: 'var(--v3-bg)', color: 'var(--v3-text)' }}>

      {/* Scoped CSS — drop cap, skeleton shimmer, responsive grid */}
      <style>{editorialCss}</style>

      {/* ─────────── MASTHEAD ─────────── */}
      <header className="eh-mast">
        <div className="eh-mast__inner">
          <div className="eh-mast__brand">
            <span className="eh-mast__wordmark">FIELDHORSE</span>
            <span className="eh-mast__tagline">The Daily Dispatch</span>
          </div>
          <div className="eh-mast__meta">
            <div className="eh-mast__metaItem eh-mast__metaItem--date">
              <span className="eh-mast__metaKicker">Today</span>
              <span className="eh-mast__metaValue">{dateStamp}</span>
            </div>
            {hasCoords && tempStr && (
              <div className="eh-mast__metaItem">
                <span className="eh-mast__metaKicker">
                  <Sun size={9} style={{ marginRight: 4, verticalAlign: '-1px' }} />
                  Weather
                </span>
                <span className="eh-mast__metaValue">{tempStr} · {condStr}</span>
              </div>
            )}
            <div className="eh-mast__metaItem">
              <span className="eh-mast__metaKicker">Issue</span>
              <span className="eh-mast__metaValue">No. {issueNo} · Vol. {now.getFullYear()}</span>
            </div>
          </div>
        </div>
      </header>

      {/* ─────────── BROADSHEET ─────────── */}
      <div className="eh-grid">

        {/* ━━━ FEATURE COLUMN ━━━ */}
        <article className="eh-feature">

          {/* Kicker eyebrow */}
          <div className="eh-kicker">
            <span className="eh-kicker__diamond">✦</span>
            <span>The state of play</span>
            <span className="eh-kicker__sep">·</span>
            <span className="eh-kicker__muted">{weekday}, {monthDay}</span>
          </div>

          {/* Headline */}
          <h1 className="eh-headline">
            {greetingFor(now)}, <span className="eh-headline__name">{firstName || 'there'}</span>.
          </h1>

          {/* Lead paragraph with drop cap */}
          {pipeline == null ? (
            <div className="eh-lead">
              <Skeleton w="92%" h={22} />
              <Skeleton w="74%" h={22} style={{ marginTop: 8 }} />
              <Skeleton w="60%" h={22} style={{ marginTop: 8 }} />
            </div>
          ) : (
            <p className="eh-lead">
              <span className="eh-dropcap">{leadOpener(pipeline)[0]}</span>
              {leadOpener(pipeline).slice(1)}
              <strong className="eh-leadHi">{money(pipeline)}</strong>
              {' '}of active pipeline across{' '}
              <strong className="eh-leadHi">{totalOpen}</strong>{' '}
              open {totalOpen === 1 ? 'deal' : 'deals'}.
              {trendPct != null && Math.abs(trendPct) >= 1 && (
                <>
                  {' '}That's{' '}
                  <span className={trendUp ? 'eh-trend eh-trend--up' : 'eh-trend eh-trend--dn'}>
                    {trendUp ? <ArrowUpRight size={13} /> : <ArrowDownRight size={13} />}
                    {Math.abs(trendPct).toFixed(0)}%
                  </span>
                  {' '}vs. last period.
                </>
              )}
            </p>
          )}

          {/* ─── TODAY'S LEAD (pull-quote) ─── */}
          <section className="eh-pullquote">
            <div className="eh-eyebrow eh-eyebrow--gold">Today's lead</div>

            {nextActions == null && (
              <div style={{ marginTop: 14 }}>
                <Skeleton w="80%" h={28} />
                <Skeleton w="50%" h={16} style={{ marginTop: 10 }} />
              </div>
            )}

            {nextActions != null && nextActions.length === 0 && (
              <div className="eh-pullquote__empty">
                <CheckCircle2 size={18} color="var(--v3-success-bright, #5dd47c)" />
                <span>Nothing needs your hand today. Take the win.</span>
              </div>
            )}

            {nextActions && nextActions.length > 0 && (
              <>
                <h2 className="eh-pullquote__title">
                  {(nextActions[0] as any).label || 'Action waiting'}
                </h2>
                {((nextActions[0] as any).subtitle || (nextActions[0] as any).contactName) && (
                  <p className="eh-pullquote__meta">
                    On <span style={{ color: 'var(--v3-text)' }}>{(nextActions[0] as any).contactName || (nextActions[0] as any).subtitle}</span>
                  </p>
                )}
                <button
                  type="button"
                  onClick={() => {
                    const a = nextActions[0] as any
                    if (a.contactId) onOpenJobAtTab(a.contactId, a.tab)
                  }}
                  className="eh-cta eh-cta--solid"
                >
                  Take action →
                </button>

                {nextActions.length > 1 && (
                  <div className="eh-alsoWaiting">
                    <div className="eh-eyebrow eh-eyebrow--muted" style={{ marginBottom: 10 }}>Also waiting</div>
                    {nextActions.slice(1, 4).map((a: any, i: number) => (
                      <button
                        key={i}
                        type="button"
                        onClick={() => a.contactId && onOpenJobAtTab(a.contactId, a.tab)}
                        className="eh-alsoRow"
                      >
                        <span className="eh-alsoRow__bullet">·</span>
                        <span className="eh-alsoRow__title">{a.label || a.title || 'Action'}</span>
                        {(a.contactName || a.subtitle) && (
                          <span className="eh-alsoRow__meta">— {a.contactName || a.subtitle}</span>
                        )}
                        <ChevronRight size={13} className="eh-alsoRow__chev" />
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </section>

          {/* ─── FROM THE FIELD ─── */}
          <section className="eh-section">
            <div className="eh-sectionHead">
              <span className="eh-eyebrow">From the field · Today on site</span>
              <button type="button" onClick={onGoToSchedule} className="eh-link">
                See the day →
              </button>
            </div>

            {todayOnSite == null && (
              <div>
                {[0, 1, 2].map((i) => (
                  <div key={i} className="eh-dispatchSkel">
                    <Skeleton w={32} h={28} />
                    <div style={{ flex: 1 }}>
                      <Skeleton w="60%" h={16} />
                      <Skeleton w="40%" h={12} style={{ marginTop: 6 }} />
                    </div>
                  </div>
                ))}
              </div>
            )}

            {todayOnSite != null && todayOnSite.length === 0 && (
              <p className="eh-emptyCopy">Quiet day. No scheduled work — a good chance to clear the lead pile.</p>
            )}

            {todayOnSite && todayOnSite.length > 0 && (
              <ul className="eh-dispatch">
                {todayOnSite.slice(0, 5).map((r: any, i: number) => (
                  <li key={r.id || i} className="eh-dispatch__row">
                    <span className="eh-dispatch__num">{String(i + 1).padStart(2, '0')}</span>
                    <div className="eh-dispatch__body">
                      {r.time && <div className="eh-dispatch__time">{r.time}</div>}
                      <div className="eh-dispatch__title">{r.title || r.name || 'Job'}</div>
                      {r.subtitle && r.subtitle !== r.time && (
                        <div className="eh-dispatch__sub">{r.subtitle}</div>
                      )}
                    </div>
                  </li>
                ))}
                {todayOnSite.length > 5 && (
                  <li className="eh-dispatch__more">
                    +{todayOnSite.length - 5} more — <button type="button" className="eh-linkInline" onClick={onGoToSchedule}>see the full day</button>
                  </li>
                )}
              </ul>
            )}
          </section>
        </article>

        {/* ━━━ RAIL COLUMN ━━━ */}
        <aside className="eh-rail">

          {/* THE PIPELINE */}
          <section className="eh-railSection">
            <div className="eh-railEyebrow">The pipeline</div>

            <div className="eh-railBigStat">
              <span className="eh-railBigStat__value">
                {pipeline == null ? <Skeleton w={140} h={44} /> : money(pipeline)}
              </span>
              {trendPct != null && pipeline != null && (
                <span className={trendUp ? 'eh-trendPill eh-trendPill--up' : 'eh-trendPill eh-trendPill--dn'}>
                  {trendUp ? <ArrowUpRight size={12} /> : <ArrowDownRight size={12} />}
                  {Math.abs(trendPct).toFixed(0)}%
                </span>
              )}
            </div>

            <div className="eh-tower">
              {tower.map((t) => (
                <button
                  key={t.key}
                  type="button"
                  onClick={() => onGoToJobs(t.key)}
                  className="eh-tower__col"
                  title={`${t.label}: ${money(t.amount)} · ${t.count} ${t.count === 1 ? 'deal' : 'deals'}`}
                >
                  <div className="eh-tower__bar" style={{ background: t.color, height: `${Math.max(t.pct, 4)}%` }} />
                  <div className="eh-tower__label">{t.label}</div>
                  <div className="eh-tower__amount">{money(t.amount)}</div>
                  <div className="eh-tower__count">{t.count} {t.count === 1 ? 'deal' : 'deals'}</div>
                </button>
              ))}
            </div>
          </section>

          {/* HOT DEALS */}
          <section className="eh-railSection">
            <div className="eh-railEyebrow">Hot deals</div>

            {topPipeline == null && (
              <div style={{ marginTop: 14 }}>
                <Skeleton w="100%" h={56} />
                <Skeleton w="100%" h={36} style={{ marginTop: 10 }} />
                <Skeleton w="100%" h={36} style={{ marginTop: 8 }} />
              </div>
            )}

            {topPipeline != null && topPipeline.length === 0 && (
              <p className="eh-emptyCopy" style={{ marginTop: 12 }}>
                No deals in the pipeline yet — <button type="button" className="eh-linkInline" onClick={onNewLead}>start one</button>.
              </p>
            )}

            {topPipeline && topPipeline.length > 0 && (
              <>
                {/* Featured first deal */}
                <button
                  type="button"
                  onClick={() => onOpenJob((topPipeline[0] as any).id)}
                  className="eh-hotFeatured"
                >
                  <div className="eh-hotFeatured__top">
                    <span className="eh-hotFeatured__rank">01</span>
                    <span className="eh-hotFeatured__stage">{(topPipeline[0] as any).stage || '—'}</span>
                  </div>
                  <div className="eh-hotFeatured__name">{(topPipeline[0] as any).name || 'Unnamed'}</div>
                  <div className="eh-hotFeatured__amount">
                    {money((topPipeline[0] as any).amount || (topPipeline[0] as any).value || 0)}
                  </div>
                </button>

                {/* Rest as compact rows */}
                {topPipeline.slice(1, 5).map((c: any, i: number) => (
                  <button
                    key={c.id}
                    type="button"
                    onClick={() => onOpenJob(c.id)}
                    className="eh-hotRow"
                  >
                    <span className="eh-hotRow__rank">{String(i + 2).padStart(2, '0')}</span>
                    <div className="eh-hotRow__body">
                      <div className="eh-hotRow__name">{c.name || 'Unnamed'}</div>
                      <div className="eh-hotRow__stage">{c.stage || '—'}</div>
                    </div>
                    <span className="eh-hotRow__amount">{money(c.amount || c.value || 0)}</span>
                  </button>
                ))}
              </>
            )}
          </section>

          {/* WATCH LIST */}
          <section className="eh-railSection">
            <div className="eh-railEyebrow">Watch list</div>
            {riskCount === 0 && (invoicingWeek ?? 0) === 0 ? (
              <div className="eh-allClear">
                <CheckCircle2 size={16} color="var(--v3-success-bright, #5dd47c)" />
                <div>
                  <div className="eh-allClear__title">All clear</div>
                  <div className="eh-allClear__sub">No deals at risk, no jobs behind.</div>
                </div>
              </div>
            ) : (
              <ul className="eh-watch">
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
            )}
          </section>

          {/* PRIMARY CTA */}
          <button type="button" onClick={onNewLead} className="eh-cta eh-cta--block">
            Start a new lead
          </button>
        </aside>
      </div>
    </div>
  )
}

/* ───────────── helpers ───────────── */

function RiskLine({ icon, label, value, tone, onClick }: any) {
  const color = tone === 'alert' ? 'var(--v3-danger-bright, #ff6b6b)'
              : tone === 'warn'  ? '#e0a141'
              :                    'var(--v3-primary)'
  return (
    <li>
      <button type="button" onClick={onClick} className="eh-watch__row">
        <span style={{ color, display: 'grid', placeItems: 'center', width: 18 }}>{icon}</span>
        <span className="eh-watch__value">{value}</span>
        <span className="eh-watch__label">{label}</span>
        <ChevronRight size={13} className="eh-watch__chev" />
      </button>
    </li>
  )
}

function Skeleton({ w, h, style }: { w?: number | string; h?: number; style?: React.CSSProperties }) {
  return (
    <span
      className="eh-skel"
      style={{ width: typeof w === 'number' ? `${w}px` : w || '100%', height: h ?? 14, display: 'block', ...style }}
      aria-hidden
    />
  )
}

function greetingFor(d: Date) {
  const h = d.getHours()
  if (h < 12) return 'Good morning'
  if (h < 17) return 'Good afternoon'
  return 'Good evening'
}

function leadOpener(_pipeline: number) {
  return "You're sitting on "
}

function dayOfYear(d: Date) {
  const start = new Date(d.getFullYear(), 0, 0)
  const diff = d.getTime() - start.getTime()
  return Math.floor(diff / 86400000)
}

/* ───────────── styles ───────────── */

const editorialCss = `
.eh-page { font-family: var(--font-body); }

/* MASTHEAD */
.eh-mast {
  border-top: 3px solid var(--v3-primary);
  border-bottom: 1px solid var(--v3-border, rgba(255, 240, 210, 0.10));
  margin-bottom: 40px;
}
.eh-mast__inner {
  display: flex; align-items: flex-end; justify-content: space-between;
  gap: 24px; padding: 18px 4px 16px; flex-wrap: wrap;
}
.eh-mast__brand { display: flex; flex-direction: column; gap: 4px; }
.eh-mast__wordmark {
  font-family: var(--font-display);
  font-size: 32px; line-height: 1; letter-spacing: 0.02em;
  color: var(--v3-text);
}
.eh-mast__tagline {
  font-family: var(--font-body); font-size: 10px; font-weight: 700;
  letter-spacing: 0.28em; text-transform: uppercase;
  color: var(--v3-text-muted);
}
.eh-mast__meta {
  display: flex; align-items: flex-end; gap: 28px;
  flex-wrap: wrap; justify-content: flex-end;
}
.eh-mast__metaItem { display: flex; flex-direction: column; gap: 3px; text-align: right; }
.eh-mast__metaKicker {
  font-size: 9px; font-weight: 700; letter-spacing: 0.20em;
  text-transform: uppercase; color: var(--v3-text-muted);
}
.eh-mast__metaValue {
  font-family: var(--font-body); font-size: 12px; font-weight: 700;
  color: var(--v3-text); font-variant-numeric: tabular-nums;
  letter-spacing: 0.02em;
}

/* GRID */
.eh-grid {
  display: grid;
  grid-template-columns: minmax(0, 2fr) minmax(0, 1fr);
  gap: 64px;
}
@media (max-width: 1100px) {
  .eh-grid { grid-template-columns: minmax(0, 1fr); gap: 48px; }
  .eh-rail { padding-left: 0 !important; border-left: none !important; border-top: 1px solid var(--v3-border, rgba(255, 240, 210, 0.10)); padding-top: 36px; }
}

.eh-feature { min-width: 0; }

/* KICKER + HEADLINE */
.eh-kicker {
  display: inline-flex; align-items: center; gap: 8px;
  font-size: 11px; font-weight: 700;
  letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--v3-primary); margin-bottom: 20px;
}
.eh-kicker__diamond { font-size: 14px; }
.eh-kicker__sep { color: var(--v3-border, rgba(255, 240, 210, 0.30)); }
.eh-kicker__muted { color: var(--v3-text-muted); }

.eh-headline {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(56px, 7.2vw, 96px);
  line-height: 0.92; letter-spacing: -0.018em;
  color: var(--v3-text); font-weight: 400;
}
.eh-headline__name { color: var(--v3-primary); }

/* LEAD */
.eh-lead {
  margin: 28px 0 0;
  font-family: var(--font-body);
  font-size: 19px; line-height: 1.58;
  color: var(--v3-text-muted);
  max-width: 620px;
}
.eh-leadHi { color: var(--v3-text); font-weight: 600; }
.eh-dropcap {
  float: left;
  font-family: var(--font-display);
  font-size: 64px;
  line-height: 0.85;
  padding: 6px 10px 0 0;
  color: var(--v3-primary);
  letter-spacing: -0.02em;
}
.eh-trend {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 1px 7px; border-radius: 999px;
  font-size: 13px; font-weight: 700;
  font-variant-numeric: tabular-nums;
  vertical-align: 1px;
}
.eh-trend--up { color: var(--v3-success-bright, #5dd47c); background: color-mix(in srgb, var(--v3-success, #2ecc71) 14%, transparent); }
.eh-trend--dn { color: var(--v3-danger-bright, #ff6b6b);  background: color-mix(in srgb, var(--v3-danger, #c0392b) 14%, transparent); }

/* PULL-QUOTE */
.eh-pullquote {
  margin-top: 40px;
  padding-left: 22px;
  border-left: 3px solid var(--v3-primary);
}
.eh-eyebrow {
  font-family: var(--font-body); font-size: 10px; font-weight: 700;
  letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--v3-text-muted);
}
.eh-eyebrow--gold { color: var(--v3-primary); }
.eh-eyebrow--muted { color: var(--v3-text-muted); }
.eh-pullquote__title {
  margin: 12px 0 0;
  font-family: var(--font-display);
  font-size: 34px; line-height: 1.1;
  color: var(--v3-text); font-weight: 400;
  letter-spacing: -0.008em;
}
.eh-pullquote__meta {
  margin: 10px 0 0;
  font-family: var(--font-body); font-size: 14px;
  color: var(--v3-text-muted);
}
.eh-pullquote__empty {
  display: flex; align-items: center; gap: 12px;
  margin-top: 14px;
  font-family: var(--font-body); font-size: 15px;
  color: var(--v3-text-muted);
}
.eh-alsoWaiting { margin-top: 24px; }
.eh-alsoRow {
  display: flex; align-items: baseline; gap: 8px;
  padding: 8px 0;
  background: transparent; border: none;
  border-bottom: 1px solid var(--v3-border, rgba(255, 240, 210, 0.06));
  width: 100%; text-align: left; cursor: pointer;
  font-family: var(--font-body);
  color: var(--v3-text); font-size: 13px;
  transition: color 120ms ease;
}
.eh-alsoRow:hover { color: var(--v3-primary); }
.eh-alsoRow:last-child { border-bottom: none; }
.eh-alsoRow__bullet { color: var(--v3-primary); font-weight: 700; }
.eh-alsoRow__title { font-weight: 600; flex-shrink: 0; max-width: 260px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.eh-alsoRow__meta { color: var(--v3-text-muted); flex: 1; min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.eh-alsoRow__chev { color: var(--v3-text-muted); flex-shrink: 0; }

/* CTA */
.eh-cta {
  display: inline-flex; align-items: center; gap: 8px;
  border: none; border-radius: 4px; cursor: pointer;
  font-family: var(--font-body); font-weight: 700;
  letter-spacing: 0.08em; text-transform: uppercase;
  transition: transform 120ms ease, box-shadow 120ms ease;
}
.eh-cta--solid {
  margin-top: 20px; padding: 11px 22px;
  background: var(--v3-primary); color: var(--v3-on-primary, #141414);
  font-size: 12px;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--v3-primary) 30%, transparent);
}
.eh-cta--solid:hover { transform: translateY(-1px); box-shadow: 0 4px 14px color-mix(in srgb, var(--v3-primary) 25%, transparent); }
.eh-cta--block {
  margin-top: 28px; width: 100%; padding: 14px 18px;
  background: var(--v3-primary); color: var(--v3-on-primary, #141414);
  font-size: 13px;
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--v3-primary) 30%, transparent);
}
.eh-cta--block:hover { transform: translateY(-1px); box-shadow: 0 6px 18px color-mix(in srgb, var(--v3-primary) 30%, transparent); }

/* SECTION */
.eh-section { margin-top: 56px; }
.eh-sectionHead {
  display: flex; align-items: baseline; justify-content: space-between;
  margin-bottom: 16px;
  padding-bottom: 8px;
  border-bottom: 1px solid var(--v3-border, rgba(255, 240, 210, 0.10));
}
.eh-link {
  padding: 0; border: none; background: transparent; cursor: pointer;
  font-family: var(--font-body); font-size: 11px; font-weight: 700;
  letter-spacing: 0.10em; text-transform: uppercase;
  color: var(--v3-primary);
}
.eh-link:hover { text-decoration: underline; }
.eh-linkInline {
  background: transparent; border: none; padding: 0; cursor: pointer;
  font-family: inherit; font-size: inherit; color: var(--v3-primary);
  text-decoration: underline;
}
.eh-emptyCopy {
  margin: 0;
  font-family: var(--font-body); font-size: 14px;
  color: var(--v3-text-muted);
  line-height: 1.55;
}

/* DISPATCH */
.eh-dispatch { margin: 0; padding: 0; list-style: none; }
.eh-dispatch__row {
  display: grid; grid-template-columns: 44px 1fr;
  gap: 16px; align-items: baseline;
  padding: 16px 0;
  border-bottom: 1px solid var(--v3-border, rgba(255, 240, 210, 0.08));
}
.eh-dispatch__row:last-child { border-bottom: none; }
.eh-dispatch__num {
  font-family: var(--font-display); font-size: 24px; line-height: 1;
  color: var(--v3-primary); font-variant-numeric: tabular-nums;
}
.eh-dispatch__body { min-width: 0; }
.eh-dispatch__time {
  font-family: var(--font-body); font-size: 10px; font-weight: 700;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--v3-text-muted); margin-bottom: 4px;
}
.eh-dispatch__title {
  font-family: var(--font-body); font-size: 16px; font-weight: 600;
  color: var(--v3-text); line-height: 1.3;
}
.eh-dispatch__sub {
  font-family: var(--font-body); font-size: 12px;
  color: var(--v3-text-muted); margin-top: 4px;
}
.eh-dispatch__more {
  padding-top: 14px;
  font-family: var(--font-body); font-size: 12px;
  color: var(--v3-text-muted);
}
.eh-dispatchSkel {
  display: flex; gap: 14px; align-items: center;
  padding: 14px 0;
  border-bottom: 1px solid var(--v3-border, rgba(255, 240, 210, 0.06));
}

/* RAIL */
.eh-rail { min-width: 0; padding-left: 40px; border-left: 1px solid var(--v3-border, rgba(255, 240, 210, 0.08)); }
.eh-railSection { margin-bottom: 44px; }
.eh-railSection:last-of-type { margin-bottom: 0; }
.eh-railEyebrow {
  font-family: var(--font-body); font-size: 10px; font-weight: 700;
  letter-spacing: 0.22em; text-transform: uppercase;
  color: var(--v3-primary);
  border-bottom: 1px solid var(--v3-border, rgba(255, 240, 210, 0.10));
  padding-bottom: 10px;
}

.eh-railBigStat { display: flex; align-items: baseline; gap: 10px; margin-top: 12px; }
.eh-railBigStat__value {
  font-family: var(--font-display); font-size: 46px; line-height: 1;
  color: var(--v3-text); font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}
.eh-trendPill {
  display: inline-flex; align-items: center; gap: 2px;
  padding: 3px 8px; border-radius: 999px;
  font-family: var(--font-body); font-size: 11px; font-weight: 700;
  font-variant-numeric: tabular-nums;
}
.eh-trendPill--up { color: var(--v3-success-bright, #5dd47c); background: color-mix(in srgb, var(--v3-success, #2ecc71) 14%, transparent); border: 1px solid color-mix(in srgb, var(--v3-success, #2ecc71) 30%, transparent); }
.eh-trendPill--dn { color: var(--v3-danger-bright, #ff6b6b);  background: color-mix(in srgb, var(--v3-danger, #c0392b) 14%, transparent); border: 1px solid color-mix(in srgb, var(--v3-danger, #c0392b) 30%, transparent); }

/* TOWER */
.eh-tower {
  display: grid; grid-template-columns: repeat(4, 1fr);
  gap: 8px; margin-top: 28px;
}
.eh-tower__col {
  display: flex; flex-direction: column; align-items: stretch;
  background: transparent; border: none; padding: 0; cursor: pointer;
  text-align: left;
}
.eh-tower__bar {
  width: 100%; min-height: 6px;
  border-radius: 2px 2px 0 0;
  margin-top: auto;
  transition: opacity 120ms ease;
}
.eh-tower__col:hover .eh-tower__bar { opacity: 0.85; }
.eh-tower {
  align-items: end;
  height: 160px;
}
.eh-tower__label {
  font-family: var(--font-body); font-size: 9.5px; font-weight: 700;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--v3-text-muted);
  margin-top: 10px;
}
.eh-tower__amount {
  font-family: var(--font-body); font-size: 13px; font-weight: 600;
  color: var(--v3-text); font-variant-numeric: tabular-nums;
  margin-top: 2px;
}
.eh-tower__count {
  font-family: var(--font-body); font-size: 10px;
  color: var(--v3-text-muted); margin-top: 1px;
}

/* HOT DEALS */
.eh-hotFeatured {
  display: flex; flex-direction: column; gap: 6px;
  margin-top: 16px;
  padding: 16px 18px;
  background: color-mix(in srgb, var(--v3-primary) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--v3-primary) 24%, transparent);
  border-radius: 6px;
  width: 100%; text-align: left; cursor: pointer;
  transition: background 120ms ease, transform 120ms ease;
}
.eh-hotFeatured:hover {
  background: color-mix(in srgb, var(--v3-primary) 12%, transparent);
  transform: translateY(-1px);
}
.eh-hotFeatured__top {
  display: flex; align-items: center; gap: 10px;
}
.eh-hotFeatured__rank {
  font-family: var(--font-display); font-size: 13px;
  color: var(--v3-primary); letter-spacing: 0.04em;
  font-variant-numeric: tabular-nums;
}
.eh-hotFeatured__stage {
  font-family: var(--font-body); font-size: 9.5px; font-weight: 700;
  letter-spacing: 0.16em; text-transform: uppercase;
  color: var(--v3-text-muted);
}
.eh-hotFeatured__name {
  font-family: var(--font-body); font-size: 15px; font-weight: 600;
  color: var(--v3-text); line-height: 1.3;
  overflow: hidden; text-overflow: ellipsis;
  display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical;
}
.eh-hotFeatured__amount {
  font-family: var(--font-display); font-size: 28px; line-height: 1;
  color: var(--v3-primary); font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
  margin-top: 4px;
}

.eh-hotRow {
  display: flex; align-items: baseline; gap: 10px;
  padding: 12px 0;
  background: transparent; border: none;
  border-bottom: 1px solid var(--v3-border, rgba(255, 240, 210, 0.06));
  width: 100%; text-align: left; cursor: pointer;
  transition: padding-left 120ms ease;
}
.eh-hotRow:last-child { border-bottom: none; }
.eh-hotRow:hover { padding-left: 4px; }
.eh-hotRow__rank {
  font-family: var(--font-display); font-size: 13px;
  color: var(--v3-text-muted); font-variant-numeric: tabular-nums;
  min-width: 22px;
}
.eh-hotRow__body { flex: 1; min-width: 0; }
.eh-hotRow__name {
  font-family: var(--font-body); font-size: 13px; font-weight: 600;
  color: var(--v3-text);
  overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
}
.eh-hotRow__stage {
  font-family: var(--font-body); font-size: 9.5px; font-weight: 700;
  letter-spacing: 0.14em; text-transform: uppercase;
  color: var(--v3-text-muted); margin-top: 2px;
}
.eh-hotRow__amount {
  font-family: var(--font-display); font-size: 17px;
  color: var(--v3-primary); font-variant-numeric: tabular-nums;
}

/* WATCH LIST */
.eh-watch { margin: 14px 0 0; padding: 0; list-style: none; display: flex; flex-direction: column; gap: 12px; }
.eh-watch__row {
  display: flex; align-items: center; gap: 12px;
  padding: 0;
  background: transparent; border: none;
  width: 100%; text-align: left; cursor: pointer;
  transition: padding-left 120ms ease;
}
.eh-watch__row:hover { padding-left: 4px; }
.eh-watch__value {
  font-family: var(--font-display); font-size: 24px; line-height: 1;
  color: var(--v3-text); font-variant-numeric: tabular-nums;
  min-width: 36px;
}
.eh-watch__label {
  font-family: var(--font-body); font-size: 12px;
  color: var(--v3-text-muted); flex: 1;
}
.eh-watch__chev { color: var(--v3-text-muted); }
.eh-allClear {
  display: flex; gap: 12px; align-items: flex-start;
  margin-top: 14px;
  padding: 14px 16px;
  background: color-mix(in srgb, var(--v3-success, #2ecc71) 8%, transparent);
  border: 1px solid color-mix(in srgb, var(--v3-success, #2ecc71) 22%, transparent);
  border-radius: 6px;
}
.eh-allClear__title {
  font-family: var(--font-body); font-size: 13px; font-weight: 700;
  color: var(--v3-text);
}
.eh-allClear__sub {
  font-family: var(--font-body); font-size: 12px;
  color: var(--v3-text-muted); margin-top: 2px;
}

/* SKELETON */
@keyframes eh-shimmer { 0% { background-position: -200% 0; } 100% { background-position: 200% 0; } }
.eh-skel {
  background: linear-gradient(
    90deg,
    var(--v3-surface-2, rgba(255, 240, 210, 0.04)) 0%,
    var(--v3-border, rgba(255, 240, 210, 0.10)) 50%,
    var(--v3-surface-2, rgba(255, 240, 210, 0.04)) 100%
  );
  background-size: 200% 100%;
  animation: eh-shimmer 1.8s ease-in-out infinite;
  border-radius: 3px;
}
`
