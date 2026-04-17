import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import Icon from '../components/icons/Icon.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { SkeletonStat } from '../components/Skeleton.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { STAGES, ACTIVE_STAGES, margin } from '../lib/stages.js'

function money(n) { return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }

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

  return (
    <section className="fh-page">
      <header className="fh-page__head">
        <div>
          <span className="fh-sec-tag">
            <span className="fh-sec-tag__label">CEO dashboard</span>
          </span>
          <h1 className="fh-page__title">Analytics</h1>
        </div>
      </header>

      {loading && (
        <div className="fh-summary">
          {Array.from({ length: 8 }, (_, i) => <SkeletonStat key={i} />)}
        </div>
      )}

      {!loading && contacts.length === 0 && (
        <EmptyState
          icon="chart"
          code="DATA · INSUFFICIENT"
          title="Not enough data yet."
          sub="Add a few leads and start closing. Analytics lights up once the pipeline moves."
        />
      )}

      {!loading && contacts.length > 0 && (
        <>
          <div className="fh-summary">
            <KPI label="Pipeline" value={money(stats.pipeline)} accent />
            <KPI label="Won YTD" value={money(stats.wonYTD)} />
            <KPI label="Profit YTD" value={money(stats.profitYTD)} />
            <KPI label="Avg margin" value={`${stats.avgMargin.toFixed(0)}%`} />
            <KPI label="Close rate" value={`${stats.closeRate.toFixed(0)}%`} />
            <KPI label="Active leads" value={stats.leads} />
            <KPI label="Miles YTD" value={stats.milesYTD.toFixed(0)} />
            <KPI label="Mileage deduction" value={money(stats.mileageDeduction)} />
          </div>

          <section className="fh-section">
            <div className="fh-section__head">
              <span className="fh-section__title">Pipeline by stage</span>
            </div>
            <div className="fh-stage-bars">
              {byStage.map((s, i) => (
                <div key={s.id} className="fh-stage-bar">
                  <div className="fh-stage-bar__head">
                    <span className="fh-stage-bar__label">{s.label}</span>
                    <span className="fh-stage-bar__v">{money(s.value)} · {s.count}</span>
                  </div>
                  <div className="fh-stage-bar__rail">
                    <motion.div
                      className="fh-stage-bar__fill"
                      style={{ background: s.color }}
                      initial={{ width: 0 }}
                      animate={{ width: `${(s.value / maxStageValue) * 100}%` }}
                      transition={{ duration: 0.6, delay: i * 0.06, ease: [0.2, 0.8, 0.2, 1] }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </section>

          <section className="fh-section">
            <div className="fh-section__head">
              <span className="fh-section__title">Mileage log</span>
              <span className="fh-pill">IRS 2026 · $0.67/mi</span>
            </div>
            {mileage.length === 0 ? (
              <EmptyState
                icon="calendar"
                code="MILES · 0"
                title="No miles logged."
                sub="Log drives as you go. Every mile is $0.67 deducted at tax time."
              />
            ) : (
              <div className="fh-rows">
                {mileage.slice(0, 10).map((m) => (
                  <div key={m.id} className="fh-row">
                    <div style={{ flex: 1 }}>
                      <div className="fh-row__k">{m.purpose || 'Drive'}</div>
                      <div className="fh-row__sub">{new Date(m.drove_on).toLocaleDateString()}</div>
                    </div>
                    <div className="fh-row__v">{m.miles} mi</div>
                  </div>
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </section>
  )
}

function KPI({ label, value, accent }) {
  return (
    <div className={`fh-stat${accent ? ' fh-stat--accent' : ''}`}>
      <span className="fh-stat__k">{label}</span>
      <span className="fh-stat__v">{value}</span>
    </div>
  )
}
