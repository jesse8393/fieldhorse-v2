import { useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, BarChart3, DollarSign, Target, Car, Plus } from 'lucide-react'
import { SkeletonStat } from '../components/Skeleton.jsx'
import CountUp from '../components/fx/CountUp.jsx'
import LogMilesSheet from '../components/LogMilesSheet.jsx'
import { useAnalyticsBundle, useInvalidateAnalytics } from '../lib/queries.ts'
import { useAuth } from '../contexts/AuthContext.jsx'
import { STAGES, ACTIVE_STAGES } from '../lib/stages.ts'
import { wonYTD as wonYTDFn, profitYTD as profitYTDFn, closeRate as closeRateFn, avgMargin as avgMarginFn } from '../lib/rollups.ts'
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
  // Financial detail tables feed the "Reports & Insights" section below
  // the KPI tiles. fh_clients (id/name) lets the top-revenue list show
  // client names without N+1 lookups.
  const { data: bundle, isLoading: loading } = useAnalyticsBundle(user?.id)
  const load = useInvalidateAnalytics()
  const contacts = bundle?.contacts ?? []
  const mileage = bundle?.mileage ?? []
  const payments = bundle?.payments ?? []
  const invoices = bundle?.invoices ?? []
  const changeOrders = bundle?.changeOrders ?? []
  const clients = bundle?.clients ?? []
  const [logOpen, setLogOpen] = useState(false)

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
    // Won YTD + Profit YTD now share the rollups.ts definition with
    // Jobs/Clients (won = stage in (invoice, closed)). Was previously
    // 'closed' only, so any job sitting in 'invoice' read as $0 won.
    const wonYTD = wonYTDFn(contacts)
    const profitYTD = profitYTDFn(contacts)
    // Close rate honesty guard (5/17 — replaces Phase 11's sample-size-3
    // guard which still showed 100% when an operator had 3+ wins and 0
    // losses). Requires BOTH at least one won AND at least one lost so
    // the denominator (won + lost) is meaningful, and a total sample
    // of at least 3 so a single 1-of-1 win doesn't read as 100%.
    // Below either threshold the KPI tile renders "—" via its null branch.
    const wonCount = contacts.filter((c) => c.stage === 'invoice' || c.stage === 'closed').length
    const lostTerminalCount = contacts.filter((c) => c.stage === 'lost').length
    const terminalSample = wonCount + lostTerminalCount
    const closeRate = (wonCount >= 1 && lostTerminalCount >= 1 && terminalSample >= 3)
      ? closeRateFn(contacts) * 100
      : null
    // Subtitle tells the operator what's holding the value back when null,
    // OR contextualizes the sample size when present.
    const closeRateNote = (closeRate == null)
      ? (lostTerminalCount === 0
          ? 'No lost deals logged yet'
          : wonCount === 0
            ? 'No wins yet'
            : `Need ${3 - terminalSample} more closed deal${3 - terminalSample === 1 ? '' : 's'}`)
      : `${wonCount} won · ${lostTerminalCount} lost`
    // Avg margin honesty guard (5/17 — replaces the wonHasCost gate
    // which allowed wildly high averages when most wins had no cost
    // recorded). The shared avgMarginFn counts (amount - 0)/amount as
    // 100% margin for cost-less wins, dragging the average up to
    // 88-100% even when only one job actually has cost data. We now
    // compute the average across ONLY wins with positive cost — those
    // are the rows where margin is mathematically real. If fewer than
    // 1 such row exists, the KPI renders "—".
    const winsWithCost = contacts.filter((c) =>
      (c.stage === 'invoice' || c.stage === 'closed') &&
      Number(c.amount) > 0 &&
      Number(c.cost) > 0
    )
    const avgMargin = winsWithCost.length >= 1
      ? (winsWithCost.reduce((s, c) => {
          const a = Number(c.amount || 0)
          const k = Number(c.cost || 0)
          return s + (a - k) / a
        }, 0) / winsWithCost.length) * 100
      : null
    const avgMarginNote = (avgMargin == null)
      ? 'Log a job cost to enable'
      : `Across ${winsWithCost.length} won job${winsWithCost.length === 1 ? '' : 's'}`
    const leads = contacts.filter((c) => c.stage === 'lead').length
    const quotes = contacts.filter((c) => c.stage === 'quote').length
    const jobs = contacts.filter((c) => c.stage === 'job').length
    const closedCount = contacts.filter((c) => c.stage === 'closed').length
    const lostCount = contacts.filter((c) => c.stage === 'lost').length
    const milesYTD = mileage.reduce((s, m) => s + Number(m.miles || 0), 0)
    const mileageDeduction = milesYTD * 0.67
    return {
      pipeline, wonYTD, profitYTD, avgMargin, avgMarginNote,
      leads, quotes, jobs, closedCount, lostCount,
      closeRate, closeRateNote,
      milesYTD, mileageDeduction
    }
  }, [contacts, mileage])

  const byStage = useMemo(() => {
    return STAGES.map((s) => ({
      ...s,
      count: contacts.filter((c) => c.stage === s.id).length,
      value: contacts.filter((c) => c.stage === s.id).reduce((sum, c) => sum + Number(c.amount || 0), 0)
    }))
  }, [contacts])

  const maxStageValue = Math.max(...byStage.map((b) => b.value), 1)

  // ──────────────────────────────────────────────────────────────
  // Deeper insights — computed from the financial detail tables.
  // ──────────────────────────────────────────────────────────────

  // Revenue by month — last 6 calendar months of fh_payments,
  // bucketed by paid_on. Drives the inline bar chart.
  const revenueByMonth = useMemo(() => {
    const now = new Date()
    const buckets = []
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      const next = new Date(now.getFullYear(), now.getMonth() - i + 1, 1)
      const total = payments.reduce((s, p) => {
        const when = new Date(p.paid_on || p.created_at)
        if (Number.isNaN(when.getTime())) return s
        if (when >= d && when < next) return s + Number(p.amount || 0)
        return s
      }, 0)
      buckets.push({
        label: d.toLocaleDateString(undefined, { month: 'short' }),
        total: Math.round(total)
      })
    }
    return buckets
  }, [payments])
  const maxMonthlyRevenue = Math.max(...revenueByMonth.map((b) => b.total), 1)

  // Win rate by job_type. won = stage='closed' (or 'invoice' if you
  // count signed work as won); lost = stage='lost'. Skips types with
  // fewer than 2 outcomes so a single lucky/unlucky job doesn't
  // dominate the table.
  const winRateByType = useMemo(() => {
    const map = new Map()
    for (const c of contacts) {
      const k = c.job_type || 'Other'
      if (c.stage !== 'closed' && c.stage !== 'lost') continue
      const cur = map.get(k) || { type: k, won: 0, lost: 0 }
      if (c.stage === 'closed') cur.won++
      else cur.lost++
      map.set(k, cur)
    }
    return Array.from(map.values())
      .filter((r) => r.won + r.lost >= 2)
      .map((r) => ({
        ...r,
        total: r.won + r.lost,
        pct: Math.round((r.won / (r.won + r.lost)) * 100)
      }))
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)
  }, [contacts])

  // Top revenue clients — sums payments per contact_id, then maps to
  // the linked fh_clients.name when available. Falls back to the
  // contact name. Last 90 days only (active book of business, not
  // ancient history).
  const topClients = useMemo(() => {
    const cutoff = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000)
    const contactById = new Map(contacts.map((c) => [c.id, c]))
    const clientById = new Map(clients.map((c) => [c.id, c]))
    const totals = new Map()
    for (const p of payments) {
      const when = new Date(p.paid_on || p.created_at)
      if (Number.isNaN(when.getTime()) || when < cutoff) continue
      const c = contactById.get(p.contact_id)
      const clientName = c?.client_id ? clientById.get(c.client_id)?.name : null
      const key = clientName || c?.name || 'Unknown'
      totals.set(key, (totals.get(key) || 0) + Number(p.amount || 0))
    }
    return Array.from(totals.entries())
      .map(([name, amount]) => ({ name, amount: Math.round(amount) }))
      .sort((a, b) => b.amount - a.amount)
      .slice(0, 5)
  }, [payments, contacts, clients])
  const maxTopClient = Math.max(...topClients.map((t) => t.amount), 1)

  // Retainage outstanding — sum of fh_payments tagged retainage
  // across all contracts. This is what's been held back but not
  // released yet; the contractor sees a single KPI.
  const retainageOutstanding = useMemo(() => {
    return payments
      .filter((p) => p?.kind === 'retainage')
      .reduce((s, p) => s + Number(p.amount || 0), 0)
  }, [payments])

  // Average deposit lag — days from quote_sent_at to first payment
  // on the same contact, averaged across the last N closed deals.
  // Tracks how long the customer typically sits on a signed proposal
  // before sending the first check.
  const avgDepositLagDays = useMemo(() => {
    const firstPaymentByContact = new Map()
    for (const p of payments) {
      const when = new Date(p.paid_on || p.created_at)
      if (Number.isNaN(when.getTime())) continue
      const prev = firstPaymentByContact.get(p.contact_id)
      if (!prev || when < prev) firstPaymentByContact.set(p.contact_id, when)
    }
    const lags = []
    for (const c of contacts) {
      if (!c.quote_sent_at) continue
      const first = firstPaymentByContact.get(c.id)
      if (!first) continue
      const sent = new Date(c.quote_sent_at)
      const days = Math.max(0, (first - sent) / (24 * 60 * 60 * 1000))
      if (Number.isFinite(days)) lags.push(days)
    }
    if (lags.length === 0) return null
    const avg = lags.reduce((s, d) => s + d, 0) / lags.length
    return { avg: Math.round(avg), sample: lags.length }
  }, [contacts, payments])

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
              <KPI label="Avg Margin"        to={stats.avgMargin}        format={fmtPct}          Icon={Target} note={stats.avgMarginNote} />
              <KPI label="Close Rate"        to={stats.closeRate}        format={fmtPct}          Icon={Target} note={stats.closeRateNote} />
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

          {/* DEEPER INSIGHTS — financial detail surfaced from
              fh_payments / fh_invoices / fh_change_orders that the
              top-tile dashboard doesn't dig into. Five mini-cards on
              one rail; auto-hides individual cards when there's no
              data to show so the section never reads as empty boxes. */}
          <motion.section variants={item} style={{ padding: '8px 20px 16px' }}>
            <SectionHeader label="Deeper insights" />
            <div style={{
              marginTop: 12,
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))',
              gap: 12
            }}>
              {/* Revenue by month */}
              <InsightCard title="Revenue · last 6 months">
                <RevenueBars data={revenueByMonth} maxValue={maxMonthlyRevenue} />
              </InsightCard>

              {/* Win rate by type */}
              {winRateByType.length > 0 && (
                <InsightCard title="Win rate by job type">
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {winRateByType.map((r) => (
                      <li key={r.type} style={{ display: 'grid', gridTemplateColumns: '1fr auto auto', gap: 10, alignItems: 'center' }}>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text)' }}>
                          {r.type}
                        </span>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>
                          {r.won}/{r.total}
                        </span>
                        <span style={{
                          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                          color: r.pct >= 60 ? 'var(--v3-success-bright, #4ade80)'
                            : r.pct >= 40 ? 'var(--v3-primary-bright)'
                            : 'var(--v3-text-muted)',
                          fontVariantNumeric: 'tabular-nums', minWidth: 38, textAlign: 'right'
                        }}>
                          {r.pct}%
                        </span>
                      </li>
                    ))}
                  </ul>
                </InsightCard>
              )}

              {/* Top revenue clients (90d) */}
              {topClients.length > 0 && (
                <InsightCard title="Top clients · 90 days">
                  <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 10 }}>
                    {topClients.map((c) => (
                      <li key={c.name}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 4 }}>
                          <span style={{
                            fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text)',
                            overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '70%'
                          }}>
                            {c.name}
                          </span>
                          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: 'var(--v3-success-bright, #4ade80)', fontVariantNumeric: 'tabular-nums' }}>
                            {money(c.amount)}
                          </span>
                        </div>
                        <div style={{ height: 4, borderRadius: 99, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                          <div style={{
                            width: `${(c.amount / maxTopClient) * 100}%`,
                            height: '100%',
                            background: 'linear-gradient(90deg, var(--v3-primary-deep), var(--v3-primary))'
                          }} />
                        </div>
                      </li>
                    ))}
                  </ul>
                </InsightCard>
              )}

              {/* Retainage held + deposit lag — two stat blocks combined */}
              <InsightCard title="Cash collection telemetry">
                <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                  <div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v3-text-muted)' }}>
                      Retainage held
                    </div>
                    <div style={{ marginTop: 4, fontFamily: 'var(--font-display)', fontSize: 26, color: retainageOutstanding > 0 ? 'var(--v3-primary-bright)' : 'var(--v3-text-muted)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                      {money(retainageOutstanding)}
                    </div>
                    <div style={{ marginTop: 3, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>
                      Tagged retainage payments across the book
                    </div>
                  </div>
                  <div>
                    <div style={{ fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v3-text-muted)' }}>
                      Avg deposit lag
                    </div>
                    <div style={{ marginTop: 4, fontFamily: 'var(--font-display)', fontSize: 26, color: 'var(--v3-text)', lineHeight: 1, fontVariantNumeric: 'tabular-nums' }}>
                      {avgDepositLagDays ? `${avgDepositLagDays.avg}d` : '—'}
                    </div>
                    <div style={{ marginTop: 3, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)' }}>
                      {avgDepositLagDays
                        ? `Quote sent → first payment, n=${avgDepositLagDays.sample}`
                        : 'No deposits matched to sent quotes yet'}
                    </div>
                  </div>
                </div>
              </InsightCard>
            </div>
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

function InsightCard({ title, children }) {
  return (
    <div style={{
      padding: '16px 18px',
      background: 'var(--v3-surface)',
      border: '1px solid var(--v3-border)',
      borderRadius: 14,
      display: 'flex', flexDirection: 'column', gap: 12
    }}>
      <div style={{
        fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.16em', textTransform: 'uppercase',
        color: 'var(--v3-primary-bright)'
      }}>
        {title}
      </div>
      {children}
    </div>
  )
}

function RevenueBars({ data, maxValue }) {
  return (
    <div style={{ display: 'grid', gridTemplateColumns: `repeat(${data.length}, 1fr)`, gap: 6, alignItems: 'flex-end', height: 80 }}>
      {data.map((b) => {
        const heightPct = (b.total / maxValue) * 100
        return (
          <div key={b.label} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4 }}>
            <div title={money(b.total)} style={{
              width: '100%',
              height: `${Math.max(2, heightPct)}%`,
              background: b.total > 0
                ? 'linear-gradient(180deg, var(--v3-primary-bright), var(--v3-primary))'
                : 'rgba(255,255,255,0.06)',
              borderRadius: 4,
              minHeight: 2
            }} />
            <div style={{
              fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 600,
              color: 'var(--v3-text-muted)', letterSpacing: '0.04em',
              textTransform: 'uppercase'
            }}>
              {b.label}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function KPI({ label, to, format, Icon, gold, note }) {
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
      {note && (
        <div style={{
          marginTop: 6,
          fontFamily: 'var(--font-body)',
          fontSize: 10,
          fontWeight: 500,
          letterSpacing: '0.04em',
          color: to == null ? 'var(--v3-text-muted)' : 'var(--v3-text-muted)',
          lineHeight: 1.3,
          opacity: 0.85
        }}>
          {note}
        </div>
      )}
    </div>
  )
}
