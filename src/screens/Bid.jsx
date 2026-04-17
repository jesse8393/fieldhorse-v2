import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import Icon from '../components/icons/Icon.jsx'
import { RATE_CARD } from '../lib/rateCard.js'
import { claudeMessage } from '../lib/anthropic.js'
import { JOB_TYPES } from '../lib/jobTypes.js'

const SYSTEM = `You are Fieldhorse AI Bid Engine. Given a scope description from a contractor, return JSON with: line_items (array of {name, qty, unit, rate_low, rate_high, notes}), total_low, total_high, contingency_pct, assumptions (array), risks (array). Use rates from the provided rate card when possible. Tailor line items to the job_type category provided (new build, renovation, addition, kitchen, bath, concrete, outdoor living, insurance, roofing). Return ONLY JSON.`

const TRADES = Object.keys(RATE_CARD)

function money(n) { return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }

export default function Bid() {
  const [scope, setScope] = useState('')
  const [marginPct, setMarginPct] = useState(25)
  const [generating, setGenerating] = useState(false)
  const [bid, setBid] = useState(null)
  const [err, setErr] = useState('')
  const [picks, setPicks] = useState([])
  const [jobType, setJobType] = useState('')

  const total = useMemo(() => {
    if (!bid) return null
    const low = bid.total_low || bid.line_items?.reduce((s, li) => s + (li.rate_low * (li.qty || 1)), 0) || 0
    const high = bid.total_high || bid.line_items?.reduce((s, li) => s + (li.rate_high * (li.qty || 1)), 0) || 0
    const midpoint = (low + high) / 2
    const withMargin = midpoint / (1 - marginPct / 100)
    return { low, high, midpoint, withMargin }
  }, [bid, marginPct])

  async function generate() {
    if (!scope.trim()) return
    setGenerating(true)
    setErr('')
    setBid(null)
    try {
      const rateText = TRADES.map((k) => `${k}: $${RATE_CARD[k].low}–$${RATE_CARD[k].high} per ${RATE_CARD[k].unit}`).join('; ')
      const res = await claudeMessage({
        system: `${SYSTEM}\n\nRate card: ${rateText}`,
        messages: [{
          role: 'user',
          content: `Job type: ${jobType || 'unspecified'}\nScope: ${scope}\nPre-checked trades: ${picks.join(', ') || 'none'}`
        }],
        maxTokens: 1400
      })
      const text = res?.content?.[0]?.text || ''
      const match = text.match(/\{[\s\S]*\}/)
      if (match) setBid(JSON.parse(match[0]))
      else setErr('AI returned no structured bid')
    } catch (e) {
      setErr(e.message || 'Bid generation failed')
    } finally {
      setGenerating(false)
    }
  }

  function togglePick(t) {
    setPicks((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])
  }

  return (
    <section className="fh-page">
      <header className="fh-page__head">
        <div>
          <span className="fh-sec-tag">
            <span className="fh-sec-tag__label">AI bid engine</span>
          </span>
          <h1 className="fh-page__title">Scope to number.</h1>
        </div>
      </header>

      <div className="fh-bid">
        <div className="fh-bid__scope">
          <label className="fh-field">
            <span className="fh-field__k">Scope description</span>
            <textarea
              value={scope}
              onChange={(e) => setScope(e.target.value)}
              rows={5}
              placeholder="1,800 sqft rambler. Demo kitchen + two baths. New cabinets, LVP throughout, tile surrounds, electrical rough-in for island. Permit pulled."
            />
          </label>
          <div className="fh-bid__trades">
            <span className="fh-eye">Job type</span>
            <div className="fh-chips">
              {JOB_TYPES.map((jt) => (
                <button
                  key={jt.value}
                  type="button"
                  className={`fh-chip${jobType === jt.value ? ' is-active' : ''}`}
                  onClick={() => setJobType(jt.value === jobType ? '' : jt.value)}
                >
                  {jt.label}
                </button>
              ))}
            </div>
          </div>
          <div className="fh-bid__trades">
            <span className="fh-eye">Trades on job</span>
            <div className="fh-chips">
              {TRADES.map((t) => (
                <button key={t} type="button" className={`fh-chip${picks.includes(t) ? ' is-active' : ''}`} onClick={() => togglePick(t)}>
                  {t}
                </button>
              ))}
            </div>
          </div>
          <div className="fh-bid__margin">
            <label className="fh-field">
              <span className="fh-field__k">Target margin %</span>
              <input type="range" min={10} max={50} step={1} value={marginPct} onChange={(e) => setMarginPct(Number(e.target.value))} />
              <span className="fh-bid__marginval">{marginPct}%</span>
            </label>
          </div>
          <button type="button" className="fh-btn fh-btn--gold" onClick={generate} disabled={!scope.trim() || generating}>
            <Icon name="bid" size={18} />
            {generating ? 'Crunching…' : 'Generate bid'}
          </button>
          {err && <p className="fh-err">{err}</p>}
        </div>

        <AnimatePresence>
          {bid && total && (
            <motion.div
              className="fh-bid__reveal"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
            >
              <div className="fh-bid__big">
                <span className="fh-eye">With margin ({marginPct}%)</span>
                <motion.span
                  className="fh-bid__num"
                  initial={{ scale: 0.9, opacity: 0 }}
                  animate={{ scale: 1, opacity: 1 }}
                  transition={{ delay: 0.1, type: 'spring', stiffness: 240, damping: 22 }}
                >
                  {money(total.withMargin)}
                </motion.span>
                <span className="fh-bid__range">Raw: {money(total.low)} – {money(total.high)}</span>
              </div>

              <div className="fh-bid__items">
                <span className="fh-eye">Line items</span>
                {bid.line_items?.map((li, i) => (
                  <motion.div
                    key={i}
                    className="fh-bid__li"
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.04 }}
                  >
                    <div>
                      <strong>{li.name}</strong>
                      {li.notes && <span className="fh-bid__li-note">{li.notes}</span>}
                    </div>
                    <span>{li.qty || 1} {li.unit}</span>
                    <span>{money((li.rate_low || 0) * (li.qty || 1))} – {money((li.rate_high || 0) * (li.qty || 1))}</span>
                  </motion.div>
                ))}
              </div>

              {bid.assumptions?.length > 0 && (
                <div className="fh-bid__block">
                  <span className="fh-eye">Assumptions</span>
                  <ul>{bid.assumptions.map((a, i) => <li key={i}>{a}</li>)}</ul>
                </div>
              )}
              {bid.risks?.length > 0 && (
                <div className="fh-bid__block fh-bid__block--warn">
                  <span className="fh-eye">Risks</span>
                  <ul>{bid.risks.map((r, i) => <li key={i}>{r}</li>)}</ul>
                </div>
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </section>
  )
}
