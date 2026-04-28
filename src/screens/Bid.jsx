import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Calculator, Sparkles } from 'lucide-react'
import { RATE_CARD, TRADE_LABELS } from '../lib/rateCard.js'
import { claudeMessage } from '../lib/anthropic.js'
import { JOB_TYPES } from '../lib/jobTypes.js'
import { toastSuccess } from '../lib/toast.js'
import { hapticMedium, hapticSuccess } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'
import CountUp from '../components/fx/CountUp.jsx'

const SYSTEM = `You are Fieldhorse AI Bid Engine. Given a scope description from a contractor, return JSON with: line_items (array of {name, qty, unit, rate_low, rate_high, notes}), total_low, total_high, contingency_pct, assumptions (array), risks (array). Use rates from the provided rate card when possible. Tailor line items to the job_type category provided (new build, renovation, addition, kitchen, bath, concrete, outdoor living, insurance, roofing). Return ONLY JSON.`

const TRADES = Object.keys(RATE_CARD)

function money(n) { return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 }) }
function formatThousands(n) { return Number(n || 0).toLocaleString('en-US', { maximumFractionDigits: 0 }) }

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
      if (match) {
        const parsedBid = JSON.parse(match[0])
        hapticSuccess(); setBid(parsedBid)
        const low = parsedBid.total_low || parsedBid.line_items?.reduce((s, li) => s + (li.rate_low * (li.qty || 1)), 0) || 0
        const high = parsedBid.total_high || parsedBid.line_items?.reduce((s, li) => s + (li.rate_high * (li.qty || 1)), 0) || 0
        const withMargin = ((low + high) / 2) / (1 - marginPct / 100)
        hapticSuccess(); toastSuccess('Bid ready', money(Math.round(withMargin)))
      } else {
        setErr('AI returned no structured bid')
      }
    } catch (e) {
      // Surface to console so a builder hitting "silent fail" has a
      // trail in DevTools. The visible error block below the button
      // also explains it + offers Fill Manually.
      console.error('[bid] generate failed:', e)
      setErr(e.message || 'Bid generation failed')
    } finally {
      setGenerating(false)
    }
  }

  function togglePick(t) {
    setPicks((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])
  }

  const { stagger, item } = useFhMotion()

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* HEADER */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '20px 20px 14px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            Estimates
          </span>
          <h1 className="fh-font-serif" style={{ margin: '4px 0 0', fontSize: 'clamp(22px, 6vw, 30px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}>
            Build a clean{' '}
            estimate.
          </h1>
        </div>
        <div
          aria-hidden="true"
          style={{ flexShrink: 0, width: 44, height: 44, borderRadius: 14, border: '1px solid rgba(201,150,58,0.3)', background: 'rgba(201,150,58,0.1)', display: 'grid', placeItems: 'center', color: 'var(--field-gold-bright)' }}
        >
          <Calculator size={20} />
        </div>
      </motion.div>

      {/* FORM */}
      <motion.div variants={item} className="fh-bid">
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
                  {TRADE_LABELS[t] || t}
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
          <motion.button
            type="button"
            whileTap={{ scale: 0.97 }}
            onClick={() => { hapticMedium(); generate() }}
            disabled={!scope.trim() || generating}
            style={{
              marginTop: 8,
              padding: '12px 18px',
              borderRadius: 12,
              border: 'none',
              background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
              color: 'var(--onyx)',
              fontFamily: 'var(--font-display)',
              fontSize: 15,
              letterSpacing: '0.14em',
              cursor: !scope.trim() || generating ? 'default' : 'pointer',
              boxShadow: '0 8px 20px rgba(201,150,58,0.35)',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              opacity: !scope.trim() || generating ? 0.55 : 1
            }}
          >
            {generating ? (
              <span aria-label="Loading" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(0,0,0,0.25)', borderTopColor: 'var(--onyx)', animation: 'fh-spin 700ms linear infinite' }} />
            ) : (
              <Sparkles size={16} />
            )}
            {generating ? 'CRUNCHING…' : 'GENERATE BID'}
          </motion.button>
          {/* Loud + actionable error block instead of a tiny red one-liner.
              Bid Engine was previously throwing inside generate() with no
              visible result if the Anthropic key was missing or the API
              was unreachable. Now: a clear card + "Fill manually" fallback
              that opens a blank line-item shell, matching Compose's
              graceful-degradation pattern. */}
          {err && (
            <div role="alert" style={{ marginTop: 12, padding: '12px 14px', borderRadius: 12, background: 'rgba(192,57,43,0.12)', border: '1px solid rgba(192,57,43,0.4)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 12.5, lineHeight: 1.4 }}>
              <div style={{ fontWeight: 700, color: 'var(--alert-red)', marginBottom: 4 }}>AI unavailable</div>
              <div style={{ color: 'var(--ink-muted)', marginBottom: 8 }}>{err} — your scope is preserved. Fill in line items manually if you need this bid out the door.</div>
              <button
                type="button"
                onClick={() => {
                  setErr('')
                  // Seed a blank bid shell so the line-items table renders
                  // and the user can edit it. recalcs derive from line_items.
                  setBid({
                    summary: scope,
                    job_type: jobType || 'Renovation',
                    line_items: (picks.length ? picks : ['gc']).map((trade) => ({
                      trade,
                      qty: 1,
                      unit: RATE_CARD[trade]?.unit || 'lot',
                      rate_low: RATE_CARD[trade]?.low || 0,
                      rate_high: RATE_CARD[trade]?.high || 0,
                      notes: ''
                    })),
                    risks: [],
                    assumptions: []
                  })
                }}
                style={{ padding: '6px 12px', borderRadius: 8, border: '1px solid var(--rule)', background: 'var(--surface-2)', color: 'var(--ink-strong)', fontFamily: 'var(--font-display)', fontSize: 11, letterSpacing: '0.12em', cursor: 'pointer' }}
              >
                FILL MANUALLY →
              </button>
            </div>
          )}
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
                  <CountUp to={Math.round(total.withMargin)} duration={0.9} prefix="$" formatter={formatThousands} />
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
      </motion.div>
    </motion.div>
  )
}
