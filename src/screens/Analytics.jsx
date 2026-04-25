import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts'
import { TrendingUp, BarChart3, DollarSign, Target, Car, Plus } from 'lucide-react'
import { SkeletonStat } from '../components/Skeleton.jsx'
import CountUp from '../components/fx/CountUp.jsx'
import LogMilesSheet from '../components/LogMilesSheet.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { STAGES, ACTIVE_STAGES, margin } from '../lib/stages.js'
import { toastSuccess } from '../lib/toast.js'
import { hapticTap, hapticMedium } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'

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
    const pipeline = contacts.filter((c) => ACTIVE_STAGES.includes(c.stage)).reduce((s, c) => s + Number(c.amount || 0), 0)
    const wonYTD = contacts.filter((c) => c.stage === 'closed').reduce((s, c) => s + Number(c.amount || 0), 0)
    const costYTD = contacts.filter((c) => c.stage === 'closed').reduce((s, c) => s + Number(c.cost || 0), 0)
    const profitYTD = wonYTD - costYTD
    const withMargin = contacts.filter((c) => c.amount > 0 && c.cost > 0)
    const avgMargin = withMargin.length ? withMargin.reduce((s, c) => s + margin(c), 0) / withMargin.length : 0
    const leads = contacts.filter((c) => c.stage === 'lead').length
    const quotes = contacts.filter((c) => c.stage === 'quote').length
    const jobs = contacts.filter((c) => c.stage === 'job').length
    const closedCount = contacts.filter((c) => c.stage === 'closed').length
    const lostCount = contacts.filter((c) => c.stage === 'lost').length
    const closeRate = (closedCount + lostCount) > 0 ? (closedCount / (closedCount + lostCount)) * 100 : 0
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
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* HEADER */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '10px 20px 14px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            CEO dashboard
          </span>
          <h1 className="fh-font-serif" style={{ margin: '4px 0 0', fontSize: 'clamp(22px, 6vw, 30px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}>
            CEO{' '}
            read.
          </h1>
        </div>
        <div
          aria-hidden="true"
          style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 14, border: '1px solid rgba(201,150,58,0.3)', background: 'rgba(201,150,58,0.1)', display: 'grid', placeItems: 'center', color: 'var(--field-gold-bright)' }}
        >
          <BarChart3 size={20} />
        </div>
      </motion.div>

      {loading && (
        <motion.div variants={item} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 20px 16px' }}>
          {Array.from({ length: 8 }, (_, i) => <SkeletonStat key={i} />)}
        </motion.div>
      )}

      {!loading && contacts.length === 0 && (
        <motion.div variants={item} style={{ padding: '32px 20px', margin: '0 20px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
          <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)', marginBottom: 4 }}>Not enough data yet.</div>
          <div style={{ fontSize: 12 }}>Add a few leads and start closing. Analytics lights up once the pipeline moves.</div>
        </motion.div>
      )}

      {!loading && contacts.length > 0 && (
        <>
          {/* KPI GRID */}
          <motion.div variants={item} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, padding: '0 20px 16px' }}>
            <KPI label="Pipeline" to={stats.pipeline} format={fmtMoneyCompact} Icon={TrendingUp} gold />
            <KPI label="Won YTD" to={stats.wonYTD} format={fmtMoneyCompact} Icon={DollarSign} gold />
            <KPI label="Profit YTD" to={stats.profitYTD} format={fmtMoneyCompact} Icon={DollarSign} gold />
            <KPI label="Avg margin" to={stats.avgMargin} format={fmtPct} Icon={Target} />
            <KPI label="Close rate" to={stats.closeRate} format={fmtPct} Icon={Target} />
            <KPI label="Active leads" to={stats.leads} format={fmtInt} Icon={TrendingUp} />
            <KPI label="Miles YTD" to={stats.milesYTD} format={fmtInt} Icon={Car} />
            <KPI label="Mileage deduction" to={stats.mileageDeduction} format={fmtMoneyCompact} Icon={Car} />
          </motion.div>

          {/* PIPELINE BY STAGE */}
          {/* PIPELINE TREND — 12-week area chart */}
          <motion.section variants={item} style={{ padding: '0 20px 18px' }}>
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 6, marginBottom: 10 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <TrendingUp size={13} color="var(--field-gold-bright)" />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
                  Pipeline trend · 12 wks
                </span>
              </div>
              <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--ink-faint)' }}>
                Active value
              </span>
            </header>
            <div style={{ height: 120, padding: '6px 0', borderRadius: 14, background: 'rgba(255,255,255,0.025)', border: '1px solid var(--rule)' }}>
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
            </div>
          </motion.section>

          <motion.section variants={item} style={{ padding: '0 20px 20px' }}>
            <header style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
              <BarChart3 size={13} color="var(--field-gold-bright)" />
              <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
                Pipeline by stage
              </span>
            </header>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {byStage.map((s, i) => {
                const widthPct = (s.value / maxStageValue) * 100
                return (
                  <div key={s.id}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                      <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: 'var(--ink-strong)' }}>
                        <span style={{ width: 6, height: 6, borderRadius: '50%', background: s.color, boxShadow: `0 0 8px ${s.color}99` }} />
                        {s.label}
                      </span>
                      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)' }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.02em', color: 'var(--ink-strong)' }}>{fmtMoneyCompact(s.value)}</span>
                        <span style={{ color: 'var(--ink-faint)' }}>·</span>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.02em', color: 'var(--ink-muted)' }}>{s.count}</span>
                      </span>
                    </div>
                    <div style={{ height: 6, borderRadius: 999, background: 'rgba(255,255,255,0.06)', overflow: 'hidden' }}>
                      <motion.div
                        initial={{ width: 0 }}
                        animate={{ width: `${widthPct}%` }}
                        transition={{ duration: 0.65, delay: i * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
                        style={{
                          height: '100%',
                          borderRadius: 999,
                          background: `linear-gradient(90deg, ${s.color}, var(--field-gold-bright))`,
                          boxShadow: `0 0 10px ${s.color}55, 0 0 14px rgba(232,176,76,0.25)`
                        }}
                      />
                    </div>
                  </div>
                )
              })}
            </div>
          </motion.section>

          {/* MILEAGE LOG */}
          <motion.section variants={item} style={{ padding: '0 20px 24px' }}>
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10, flexWrap: 'wrap' }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Car size={13} color="var(--field-gold-bright)" />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
                  Mileage log
                </span>
              </div>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
                <span style={{ padding: '3px 9px', borderRadius: 999, background: 'rgba(201,150,58,0.12)', border: '1px solid rgba(201,150,58,0.3)', color: 'var(--field-gold-bright)', fontFamily: 'var(--font-display)', fontSize: 10, fontWeight: 400, letterSpacing: '0.1em' }}>
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
                    border: 'none',
                    background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                    color: 'var(--onyx)',
                    fontFamily: 'var(--font-display)',
                    fontSize: 11,
                    letterSpacing: '0.12em',
                    cursor: 'pointer',
                    boxShadow: '0 4px 12px rgba(201,150,58,0.3)'
                  }}
                >
                  <Plus size={12} />
                  LOG MILES
                </motion.button>
              </div>
            </header>
            {mileage.length === 0 ? (
              <div style={{ padding: '24px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)', marginBottom: 4 }}>No miles logged.</div>
                <div style={{ fontSize: 12 }}>Log drives as you go. Every mile is $0.67 deducted at tax time.</div>
              </div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {mileage.slice(0, 10).map((m) => (
                  <div key={m.id} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)' }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)' }}>{m.purpose || 'Drive'}</div>
                      <div style={{ fontSize: 11, color: 'var(--ink-muted)', marginTop: 2 }}>{new Date(m.drove_on).toLocaleDateString()}</div>
                    </div>
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.02em' }}>{m.miles} mi</div>
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
        padding: '14px 14px 16px',
        borderRadius: 14,
        background: gold ? 'linear-gradient(135deg, rgba(30,20,10,0.9), rgba(20,15,10,0.6))' : 'rgba(255,255,255,0.03)',
        border: gold ? '1px solid rgba(201,150,58,0.35)' : '1px solid var(--rule)',
        minHeight: 92
      }}
    >
      {Icon && <Icon size={14} style={{ position: 'absolute', top: 12, right: 12, color: gold ? 'var(--field-gold-bright)' : 'rgba(201,150,58,0.4)' }} />}
      <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>{label}</div>
      <div
        className={gold ? 'fh-text-gradient-gold' : undefined}
        style={{
          fontFamily: 'var(--font-display)',
          fontSize: 30,
          letterSpacing: '0.01em',
          lineHeight: 1,
          marginTop: 10,
          color: gold ? undefined : 'var(--ink-strong)'
        }}
      >
        <CountUp to={Number(to || 0)} duration={0.9} formatter={format} />
      </div>
    </div>
  )
}
