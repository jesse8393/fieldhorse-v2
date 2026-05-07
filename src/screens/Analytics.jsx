import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, BarChart3, DollarSign, Target, Car, Plus } from 'lucide-react'
import { SkeletonStat } from '../components/Skeleton.jsx'
import CountUp from '../components/fx/CountUp.jsx'
import LogMilesSheet from '../components/LogMilesSheet.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { STAGES, ACTIVE_STAGES } from '../lib/stages.js'
import { wonYTD as wonYTDFn, profitYTD as profitYTDFn, closeRate as closeRateFn, avgMargin as avgMarginFn } from '../lib/rollups.js'
import { toastSuccess } from '../lib/toast.js'
import { hapticTap, hapticMedium } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'
import SectionHeader from '../components/v3/SectionHeader.jsx'

function money(n) { return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }
// Compact currency — matches Home hero pattern. Skips compaction under $1k
// so small numbers don't render as "$900" / "$0K" weirdness.
function fmtMoneyCompact(n) {
  const v = Number(n || 0)
  if (v >= 1_000_000) return `$${(v / 1_000_000).toFixed(v >= 10_000_000 ? 1 : 2)}M`
  if (v >= 1_000) return `$${(v / 1_000).toFixed(v >= 10_000 ? 0 : 1)}K`
  return `$${Math.round(v).toLocaleString()}`
}
function fmtPct(n) { return `${Math.round(n)}%` }
function fmtInt(n) { return String(Math.round(n)) }

export default function Analytics() {
  const { user } = useAuth()
  const [contacts, setContacts] = useState([])
  const [mileage, setMileage] = useState([])
  const [loading, setLoading] = useState(true)
  const [logOpen, setLogOpen] = useState(false)

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const [{ data: c }, { data: m }] = await Promise.all([
      supabase.from('fh_contacts').select('*').eq('user_id', user.id),
      supabase.from('fh_mileage').select('*').eq('user_id', user.id).order('drove_on', { ascending: false })
    ])
    setContacts(c || [])
    setMileage(m || [])
    setLoading(false)
  }, [user])

  useEffect(() => { load() }, [load])

  // 12-week pipeline trend — bucket contacts by created_at week,
  // sum amount of rows still in active stages. Each bucket is Sunday-anchored.
  const trendData = useMemo(() => {
    const buckets = []
    const now = new Date()
    const sunday = new Date(now)
    sunday.setHours(0, 0, 0, 0)
    sunday.setDate(sunday.getDate() - sunday.getDay())
    for (let i = 11; i >= 0; i--) {
      const wkStart = new Date(sunday)
      wkStart.setDate(wkStart.getDate() - i * 7)
      const wkEnd = new Date(wkStart)
      wkEnd.setDate(wkEnd.getDate() + 7)
      const total = contacts
        .filter((c) => {
          const created = c.created_at ? new Date(c.created_at) : null
          if (!created) return false
          return created >= wkStart && created < wkEnd && ACTIVE_STAGES.includes(c.stage)
        })
        .reduce((s, c) => s + Number(c.amount || 0), 0)
      buckets.push({
        week: wkStart.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }),
        amount: Math.round(total)
      })
    }
    return buckets
  }, [contacts])

  const stats = useMemo(() => {
    // Pipeline = sum of all jobs in active stages.
    const pipeline = contacts.filter((c) => ACTIVE_STAGES.includes(c.stage)).reduce((s, c) => s + Number(c.amount || 0), 0)
    // Won YTD + Profit YTD now share the rollups.js definition with
    // Jobs/Clients (won = stage in (invoice, closed)). Was previously
    // 'closed' only, so any job sitting in 'invoice' read as $0 won.
    const wonYTD = wonYTDFn(contacts)
    const profitYTD = profitYTDFn(contacts)
    // Close rate as 0..1 from the shared helper, * 100 for the %.
    // Phase 11 stabilization: sample-size guard. With only 1-2
    // terminal jobs the rate reads as 100% / 0% which is misleading.
    // Need at least 3 terminal jobs (won + lost) to surface a value;
    // below that we display "—" via the KPI null branch.
    const wonCount = contacts.filter((c) => c.stage === 'invoice' || c.stage === 'closed').length
    const lostTerminalCount = contacts.filter((c) => c.stage === 'lost').length
    const terminalSample = wonCount + lostTerminalCount
    const closeRate = terminalSample >= 3 ? closeRateFn(contacts) * 100 : null
    // Avg margin as 0..1 from the shared helper, * 100 for the %.
    // Phase 11 stabilization: cost-data guard. avgMarginFn returns 1.0
    // (100%) when won jobs have null/zero cost — `(amount - 0) / amount`
    // = 1. That's a fake 100% that confuses operators. Only surface
    // the value when at least one won job has positive cost data.
    const wonHasCost = contacts.some((c) =>
      (c.stage === 'invoice' || c.stage === 'closed') &&
      Number(c.amount) > 0 &&
      Number(c.cost) > 0
    )
    const avgMargin = wonHasCost ? avgMarginFn(contacts) * 100 : null
    const leads = contacts.filter((c) => c.stage === 'lead').length
    const quotes = contacts.filter((c) => c.stage === 'quote').length
    const jobs = contacts.filter((c) => c.stage === 'job').length
    const closedCount = contacts.filter((c) => c.stage === 'closed').length
    const lostCount = contacts.filter((c) => c.stage === 'lost').length
    const milesYTD = mileage.reduce((s, m) => s + Number(m.miles || 0), 0)
    const mileageDeduction = milesYTD * 0.67
    return { pipeline, wonYTD, profitYTD, avgMargin, leads, quotes, jobs, closedCount, lostCount, closeRate, milesYTD, mileageDeduction }
  }, [contacts, mileage])

  const byStage = useMemo(() => {
    return STAGES.map((s) => ({
      ...s,
      count: contacts.filter((c) => c.stage === s.id).length,
      value: contacts.filter((c) => c.stage === s.id).reduce((sum, c) => sum + Number(c.amount || 0), 0)
    }))
  }, [contacts])

  const maxStageValue = Math.max(...byStage.map((b) => b.value), 1)

  const { stagger, item } = useFhMotion()

  return (
    <motion.div
      className="v3-screen"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 120, position: 'relative', background: 'var(--v3-bg)' }}
    >
      {/* HEADER */}
      <motion.div
        variants={item}
        style={{
          padding: '12px var(--v3-gutter) 18px',
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <span className="v3-eyebrow" style={{ color: 'var(--v3-primary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
            <BarChart3 size={11} />
            Reports & Insights
          </span>
          <h1 className="v3-h1" style={{ marginTop: 6 }}>
            Know your <em>numbers.</em>
          </h1>
          <p className="v3-caption" style={{ marginTop: 6, lineHeight: 1.5 }}>
            Pipeline, revenue, margins, and work volume — at a glance.
          </p>
        </div>
      </motion.div>

      {loading && (
        <motion.div variants={item} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 var(--v3-gutter) 16px' }}>
          {Array.from({ length: 6 }, (_, i) => <SkeletonStat key={i} />)}
        </motion.div>
      )}

      {!loading && contacts.length === 0 && (
        <motion.div variants={item} className="v3-section" style={{ margin: '0 var(--v3-gutter) 14px' }}>
          <div className="v3-empty">
            <BarChart3 size={22} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
              Not enough data yet.
            </div>
            <div style={{ fontSize: 12, lineHeight: 1.5 }}>
              Add a few leads and start closing. Analytics lights up once the pipeline moves.
            </div>
          </div>
        </motion.div>
      )}

      {!loading && contacts.length > 0 && (
        <>
          {/* KPI GRID — wrapped in a v3-section so it reads as one
              framed dashboard zone, not loose tiles on the page. */}
          <motion.div
            variants={item}
            className="v3-section"
            style={{ margin: '0 var(--v3-gutter) 14px' }}
          >
            <SectionHeader label="Owner KPIs" />
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fill, minmax(140px, 1fr))',
              gap: 10,
              marginTop: 4
            }}>
              <KPI label="Pipeline"          to={stats.pipeline}         format={fmtMoneyCompact} Icon={TrendingUp} gold />
              <KPI label="Won YTD"           to={stats.wonYTD}           format={fmtMoneyCompact} Icon={DollarSign} gold />
              <KPI label="Profit YTD"        to={stats.profitYTD}        format={fmtMoneyCompact} Icon={DollarSign} gold />
              <KPI label="Avg Margin"        to={stats.avgMargin}        format={fmtPct}          Icon={Target} />
              <KPI label="Close Rate"        to={stats.closeRate}        format={fmtPct}          Icon={Target} />
              <KPI label="Active Leads"      to={stats.leads}            format={fmtInt}          Icon={TrendingUp} />
              <KPI label="Miles YTD"         to={stats.milesYTD}         format={fmtInt}          Icon={Car} />
              <KPI label="Mileage Deduction" to={stats.mileageDeduction} format={fmtMoneyCompact} Icon={Car} />
            </div>
          </motion.div>

          {/* PIPELINE TREND — 12-week area chart */}
          <motion.section variants={item} className="v3-section" style={{ margin: '0 var(--v3-gutter) 14px' }}>
            <div className="v3-section-header">
              <span className="v3-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <TrendingUp size={11} color="var(--v3-primary)" />
                Pipeline Trend · 12 wks
              </span>
              <span className="v3-eyebrow" style={{ opacity: 0.65 }}>Active value</span>
            </div>
            <div style={{ height: 120, padding: '6px 0', borderRadius: 12, background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)', position: 'relative' }}>
              {/* Real empty state for low data — was a misleading
                  isolated bell curve at the right edge when only one or
                  two weeks had values. Now: until at least 4 weeks have
                  non-zero amounts, render a clear "not enough data" hint. */}
              {trendData.filter((d) => d.amount > 0).length < 4 ? (
                <div style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6, padding: '0 16px', textAlign: 'center' }}>
                  <div aria-hidden="true" style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 32, opacity: 0.18 }}>
                    {[16, 22, 18, 28, 24, 34].map((h, i) => (
                      <span key={i} style={{ width: 5, height: `${h}px`, borderRadius: 2, background: 'var(--field-gold-bright)' }} />
                    ))}
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: 'var(--v3-text)' }}>Not enough data yet</div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>The trend lights up once you have 4+ weeks of pipeline.</div>
                </div>
              ) : (
              <ResponsiveContainer width="100%" height="100%">
                <AreaChart data={trendData} margin={{ top: 8, right: 12, left: 12, bottom: 0 }}>
                  <defs>
                    <linearGradient id="fhPipelineGold" x1="0" y1="0" x2="0" y2="1">
                      <stop offset="0%" stopColor="#F3C65E" stopOpacity={0.55} />
                      <stop offset="100%" stopColor="#F3C65E" stopOpacity={0.02} />
                    </linearGradient>
                  </defs>
                  <XAxis dataKey="week" hide />
                  <YAxis hide />
                  <Tooltip
                    contentStyle={{ background: 'var(--surface-1)', border: '1px solid var(--rule-bold)', borderRadius: 10, fontFamily: 'var(--font-body)', fontSize: 12 }}
                    labelStyle={{ color: 'var(--ink-muted)', fontSize: 10, letterSpacing: '0.1em', textTransform: 'uppercase' }}
                    itemStyle={{ color: 'var(--field-gold-bright)', fontWeight: 700 }}
                    formatter={(v) => [fmtMoneyCompact(v), 'Pipeline']}
                  />
                  <Area
                    type="monotone"
                    dataKey="amount"
                    stroke="#F3C65E"
                    strokeWidth={2}
                    fill="url(#fhPipelineGold)"
                    dot={false}
                    activeDot={{ r: 4, fill: '#F3C65E', stroke: 'var(--onyx)', strokeWidth: 2 }}
                  />
                </AreaChart>
              </ResponsiveContainer>
              )}
            </div>
          </motion.section>

          <motion.section variants={item} className="v3-section" style={{ margin: '0 var(--v3-gutter) 14px' }}>
            <SectionHeader label="Pipeline by Stage" />
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 4 }}>
              {byStage.map((s, i) => {
                const widthPct = (s.value / maxStageValue) * 100
                return (
                  <div key={s.id}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8, fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: 'var(--v3-text)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color }} />
                        {s.label}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text-muted)' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.02em', color: 'var(--v3-text)', fontVariantNumeric: 'tabular-nums' }}>{fmtMoneyCompact(s.value)}</span>
                        <span style={{ color: 'var(--v3-text-muted)', opacity: 0.55 }}>·</span>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.02em', color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums' }}>{s.count}</span>
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: 'var(--v3-track)', overflow: 'hidden' }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${widthPct}%` }}
                        transition={{ duration: 0.65, delay: i * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
                        style={{
                          height: '100%',
                          borderRadius: 999,
                          background: `linear-gradient(90deg, ${s.color}, var(--v3-primary))`
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.section>

          {/* MILEAGE LOG */}
          <motion.section variants={item} className="v3-section" style={{ margin: '0 var(--v3-gutter) 28px' }}>
            <div className="v3-section-header">
              <span className="v3-eyebrow" style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Car size={11} color="var(--v3-primary)" />
                Mileage Log
              </span>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  padding: '3px 9px',
                  borderRadius: 999,
                  background: 'var(--v3-primary-soft)',
                  border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
                  color: 'var(--v3-primary)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.10em',
                  textTransform: 'uppercase'
                }}>
                  IRS 2026 · $0.67/mi
                </span>
                <motion.button
                  type="button"
                  whileTap={{ scale: 0.97 }}
                  onClick={() => setLogOpen(true)}
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 6,
                    padding: '7px 12px',
                    borderRadius: 10,
                    border: '1px solid color-mix(in srgb, var(--v3-primary) 60%, transparent)',
                    background: 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
                    color: 'var(--v3-on-primary)',
                    fontFamily: 'var(--font-body)',
                    fontSize: 11,
                    fontWeight: 700,
                    letterSpacing: '0.04em',
                    cursor: 'pointer',
                    WebkitTapHighlightColor: 'transparent',
                    boxShadow: '0 0 0 2px rgba(229, 193, 88, 0.14), 0 4px 10px rgba(229, 193, 88, 0.28), 0 1px 0 rgba(255, 255, 255, 0.30) inset'
                  }}
                >
                  <Plus size={12} />
                  Log miles
                </motion.button>
              </div>
            </div>
            {mileage.length === 0 ? (
              <div className="v3-empty" style={{ marginTop: 4 }}>
                <Car size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>No miles logged.</div>
                <div style={{ fontSize: 12 }}>Log drives as you go. Every mile is $0.67 deducted at tax time.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginTop: 4 }}>
                {mileage.slice(0, 10).map((m) => (
                  <div
                    key={m.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: 'var(--v3-surface)',
                      border: '1px solid var(--v3-border-strong)'
                    }}
                  >
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--v3-text)' }}>{m.purpose || 'Drive'}</div>
                      <div style={{ fontSize: 11, color: 'var(--v3-text-muted)', marginTop: 2 }}>{new Date(m.drove_on).toLocaleDateString()}</div>
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--v3-text)', fontVariantNumeric: 'tabular-nums' }}>{m.miles} mi</div>
                  </div>
                ))}
              </div>
            )}
          </motion.section>
        </>
      )}

      <LogMilesSheet
        open={logOpen}
        userId={user?.id}
        onOpenChange={setLogOpen}
        onSaved={() => { setLogOpen(false); load(); toastSuccess('Miles logged', 'Deduction updated') }}
      />
    </motion.div>
  )
}

function KPI({ label, to, format, Icon, gold }) {
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        padding: '14px 14px 14px',
        borderRadius: 12,
        background: 'var(--v3-surface)',
        border: gold
          ? '1px solid color-mix(in srgb, var(--v3-primary) 35%, var(--v3-border-strong))'
          : '1px solid var(--v3-border-strong)',
        boxShadow: gold
          ? '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 4px 12px rgba(0, 0, 0, 0.28), 0 4px 14px rgba(229, 193, 88, 0.10)'
          : '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 4px 12px rgba(0, 0, 0, 0.26)',
        minHeight: 92
      }}
    >
      {/* Top accent — 1px gold gradient stroke for emphasized tiles */}
      {gold && (
        <span aria-hidden="true" style={{
          position: 'absolute',
          top: 0,
          left: '14%',
          right: '14%',
          height: 1,
          background: 'linear-gradient(90deg, transparent 0%, rgba(229, 193, 88, 0.55) 50%, transparent 100%)',
          pointerEvents: 'none'
        }} />
      )}
      {Icon && (
        <Icon
          size={14}
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            color: gold ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
            opacity: gold ? 1 : 0.6
          }}
        />
      )}
      <div className="v3-eyebrow" style={{ paddingRight: 22 }}>{label}</div>
      <div
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 28,
          letterSpacing: '-0.005em',
          lineHeight: 1,
          marginTop: 10,
          color: gold ? 'var(--v3-primary)' : 'var(--v3-text)',
          fontVariantNumeric: 'tabular-nums',
          textShadow: gold ? '0 1px 12px rgba(229, 193, 88, 0.20)' : 'none'
        }}
      >
        {to == null ? (
          <span style={{ color: 'var(--v3-text-muted)' }}>—</span>
        ) : (
          <CountUp to={Number(to || 0)} duration={0.9} formatter={format} />
        )}
      </div>
    </div>
  )
}
