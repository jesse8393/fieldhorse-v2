import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { TrendingUp, BarChart3, DollarSign, Target, Car } from 'lucide-react'
import { SkeletonStat } from '../components/Skeleton.jsx'
import CountUp from '../components/fx/CountUp.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { STAGES, ACTIVE_STAGES, margin } from '../lib/stages.js'

function money(n) { return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }
function fmtCurrency(n) { return money(n) }
function fmtPct(n) { return `${Math.round(n)}%` }
function fmtInt(n) { return String(Math.round(n)) }

export default function Analytics() {
  const { user } = useAuth()
  const [contacts, setContacts] = useState([])
  const [mileage, setMileage] = useState([])
  const [loading, setLoading] = useState(true)

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

  const stagger = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.06, delayChildren: 0.08 } } }
  const item = { hidden: { opacity: 0, y: 10 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 220, damping: 26 } } }

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* HEADER */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '20px 20px 14px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            CEO dashboard
          </span>
          <h1 className="fh-font-serif" style={{ margin: '4px 0 0', fontSize: 'clamp(22px, 6vw, 30px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}>
            CEO{' '}
            <em className="fh-font-serif-italic fh-text-gradient-gold">read.</em>
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
          <motion.div variants={item} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, padding: '0 20px 16px' }}>
            <KPI label="Pipeline" to={stats.pipeline} format={fmtCurrency} Icon={TrendingUp} accent />
            <KPI label="Won YTD" to={stats.wonYTD} format={fmtCurrency} Icon={DollarSign} />
            <KPI label="Profit YTD" to={stats.profitYTD} format={fmtCurrency} Icon={DollarSign} />
            <KPI label="Avg margin" to={stats.avgMargin} format={fmtPct} Icon={Target} />
            <KPI label="Close rate" to={stats.closeRate} format={fmtPct} Icon={Target} />
            <KPI label="Active leads" to={stats.leads} format={fmtInt} Icon={TrendingUp} />
            <KPI label="Miles YTD" to={stats.milesYTD} format={fmtInt} Icon={Car} />
            <KPI label="Mileage deduction" to={stats.mileageDeduction} format={fmtCurrency} Icon={Car} />
          </motion.div>

          {/* PIPELINE BY STAGE */}
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
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--ink-muted)' }}>
                        {money(s.value)} · {s.count}
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
            <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10, gap: 10 }}>
              <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Car size={13} color="var(--field-gold-bright)" />
                <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
                  Mileage log
                </span>
              </div>
              <span style={{ padding: '3px 9px', borderRadius: 999, background: 'rgba(201,150,58,0.12)', border: '1px solid rgba(201,150,58,0.3)', color: 'var(--field-gold-bright)', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, letterSpacing: '0.06em' }}>
                IRS 2026 · $0.67/mi
              </span>
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
                    <div style={{ fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.02em', color: 'var(--field-gold-bright)' }}>{m.miles} mi</div>
                  </div>
                ))}
              </div>
            )}
          </motion.section>
        </>
      )}
    </motion.div>
  )
}

function KPI({ label, to, format, Icon, accent }) {
  return (
    <div
      style={{
        position: 'relative',
        overflow: 'hidden',
        padding: '12px 13px',
        borderRadius: 14,
        background: accent ? 'linear-gradient(135deg, rgba(30,20,10,0.8), rgba(20,20,20,0.6))' : 'rgba(255,255,255,0.03)',
        border: accent ? '1px solid rgba(201,150,58,0.3)' : '1px solid var(--rule)'
      }}
    >
      {Icon && <Icon size={14} style={{ position: 'absolute', top: 10, right: 10, color: accent ? 'var(--field-gold-bright)' : 'rgba(201,150,58,0.4)' }} />}
      <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>{label}</div>
      <div style={{ fontFamily: 'var(--font-display)', fontSize: 22, letterSpacing: '0.02em', lineHeight: 1, marginTop: 6, color: 'var(--ink-strong)' }}>
        <CountUp to={Number(to || 0)} duration={0.9} formatter={format} />
      </div>
    </div>
  )
}
