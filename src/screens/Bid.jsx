import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Calculator, Sparkles, Copy, Check, FileText } from 'lucide-react'
import { RATE_CARD, TRADE_LABELS } from '../lib/rateCard.js'
import { claudeMessage } from '../lib/anthropic.js'
import { JOB_TYPES } from '../lib/jobTypes.js'
import { toastSuccess } from '../lib/toast.js'
import { hapticMedium, hapticSuccess } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'
import CountUp from '../components/fx/CountUp.jsx'
import SectionHeader from '../components/v3/SectionHeader.jsx'
import { FilterPill } from '../components/v3'

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
  const [copied, setCopied] = useState(false)

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
        hapticSuccess(); toastSuccess('Estimate ready', money(Math.round(withMargin)))
      } else {
        setErr('AI returned no structured estimate')
      }
    } catch (e) {
      console.error('[bid] generate failed:', e)
      setErr(e.message || 'Estimate generation failed')
    } finally {
      setGenerating(false)
    }
  }

  function togglePick(t) {
    setPicks((p) => p.includes(t) ? p.filter((x) => x !== t) : [...p, t])
  }

  async function copyEstimate() {
    if (!bid || !total) return
    const lines = [
      `${bid.summary || (jobType ? `${jobType} estimate` : 'Estimate')}`,
      '',
      `Recommended price (${marginPct}% margin): ${money(Math.round(total.withMargin))}`,
      `Raw range: ${money(total.low)} – ${money(total.high)}`,
      '',
      'Line items:',
      ...(bid.line_items || []).map((li) => `  • ${li.name}${li.notes ? ` — ${li.notes}` : ''} (${li.qty || 1} ${li.unit}: ${money((li.rate_low || 0) * (li.qty || 1))} – ${money((li.rate_high || 0) * (li.qty || 1))})`),
      ...(bid.assumptions?.length ? ['', 'Assumptions:', ...bid.assumptions.map((a) => `  • ${a}`)] : []),
      ...(bid.risks?.length ? ['', 'Risks:', ...bid.risks.map((r) => `  • ${r}`)] : [])
    ]
    await navigator.clipboard.writeText(lines.join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
    toastSuccess('Estimate copied', 'Ready to paste into a proposal')
  }

  const { stagger, item } = useFhMotion()

  return (
    <motion.div
      className="v3-screen"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 120, position: 'relative', background: 'var(--v3-bg)' }}
    >
      {/* HEADER — premium estimating workspace identity */}
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
            <Calculator size={11} />
            Estimates
          </span>
          <h1 className="v3-h1" style={{ marginTop: 6 }}>
            Build a clean <em>estimate.</em>
          </h1>
          <p className="v3-caption" style={{ marginTop: 6, lineHeight: 1.5 }}>
            Describe the scope. AI turns it into a structured bid with line items, ranges, and a recommended price.
          </p>
        </div>
      </motion.div>

      {/* SCOPE INPUT CARD — primary workspace */}
      <motion.div
        variants={item}
        className="v3-section"
        style={{ margin: '0 var(--v3-gutter) 14px' }}
      >
        <SectionHeader label="Scope" />

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, marginTop: 4 }}>
          {/* Scope textarea */}
          <textarea
            value={scope}
            onChange={(e) => setScope(e.target.value)}
            rows={5}
            placeholder="1,800 sqft rambler. Demo kitchen + two baths. New cabinets, LVP throughout, tile surrounds, electrical rough-in for island. Permit pulled."
            style={{
              width: '100%',
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--v3-surface-2)',
              border: '1px solid var(--v3-border-strong)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              lineHeight: 1.5,
              outline: 'none',
              resize: 'vertical',
              minHeight: 120,
              boxSizing: 'border-box'
            }}
          />

          {/* Job type chips */}
          <div>
            <span className="v3-eyebrow" style={{ display: 'block', marginBottom: 8 }}>Job type</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {JOB_TYPES.map((jt) => (
                <FilterPill
                  key={jt.value}
                  size="sm"
                  active={jobType === jt.value}
                  onClick={() => setJobType(jt.value === jobType ? '' : jt.value)}
                >
                  {jt.label}
                </FilterPill>
              ))}
            </div>
          </div>

          {/* Trades chips */}
          <div>
            <span className="v3-eyebrow" style={{ display: 'block', marginBottom: 8 }}>Trades on job</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {TRADES.map((t) => (
                <FilterPill
                  key={t}
                  size="sm"
                  active={picks.includes(t)}
                  onClick={() => togglePick(t)}
                >
                  {TRADE_LABELS[t] || t}
                </FilterPill>
              ))}
            </div>
          </div>

          {/* Target margin slider */}
          <div>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
              <span className="v3-eyebrow">Target margin</span>
              <span style={{
                fontFamily: 'var(--font-display)',
                fontSize: 18,
                color: 'var(--v3-primary)',
                fontVariantNumeric: 'tabular-nums'
              }}>
                {marginPct}%
              </span>
            </div>
            <input
              type="range"
              min={10}
              max={50}
              step={1}
              value={marginPct}
              onChange={(e) => setMarginPct(Number(e.target.value))}
              style={{ width: '100%', accentColor: 'var(--v3-primary)' }}
            />
            <div style={{
              display: 'flex',
              justifyContent: 'space-between',
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: '0.10em',
              color: 'var(--v3-text-muted)',
              marginTop: 4
            }}>
              <span>10%</span>
              <span>30%</span>
              <span>50%</span>
            </div>
          </div>

          {/* Primary CTA */}
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => { hapticMedium(); generate() }}
            disabled={!scope.trim() || generating}
            style={{
              marginTop: 4,
              padding: '13px 18px',
              borderRadius: 12,
              border: '1px solid color-mix(in srgb, var(--v3-primary) 60%, transparent)',
              background: !scope.trim() || generating
                ? 'var(--v3-surface-2)'
                : 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
              color: !scope.trim() || generating ? 'var(--v3-text-muted)' : 'var(--v3-on-primary)',
              fontFamily: 'var(--font-body)',
              fontSize: 14,
              fontWeight: 700,
              letterSpacing: '0.04em',
              cursor: !scope.trim() || generating ? 'default' : 'pointer',
              boxShadow: !scope.trim() || generating
                ? 'none'
                : '0 0 0 3px rgba(229, 193, 88, 0.16), 0 6px 18px rgba(229, 193, 88, 0.32), 0 1px 0 rgba(255, 255, 255, 0.30) inset',
              display: 'inline-flex',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              minHeight: 48,
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            {generating ? (
              <span aria-label="Loading" style={{ width: 14, height: 14, borderRadius: '50%', border: '2px solid rgba(0,0,0,0.25)', borderTopColor: 'var(--v3-on-primary)', animation: 'fh-spin 700ms linear infinite' }} />
            ) : (
              <Sparkles size={16} />
            )}
            {generating ? 'Generating estimate…' : 'Generate Estimate'}
          </motion.button>

          {/* Error block — graceful degradation */}
          {err && (
            <div role="alert" style={{
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--v3-danger-soft)',
              border: '1px solid color-mix(in srgb, var(--v3-danger) 40%, transparent)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)',
              fontSize: 12.5,
              lineHeight: 1.5
            }}>
              <div style={{ fontWeight: 700, color: 'var(--v3-danger-bright)', marginBottom: 4 }}>AI unavailable</div>
              <div style={{ color: 'var(--v3-text-muted)', marginBottom: 10 }}>
                {err} — your scope is preserved. Fill in line items manually if you need this estimate out the door.
              </div>
              <button
                type="button"
                onClick={() => {
                  setErr('')
                  setBid({
                    summary: scope,
                    job_type: jobType || 'Renovation',
                    line_items: (picks.length ? picks : ['gc']).map((trade) => ({
                      name: TRADE_LABELS[trade] || trade,
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
                style={{
                  padding: '7px 13px',
                  borderRadius: 10,
                  border: '1px solid var(--v3-border-strong)',
                  background: 'var(--v3-surface-2)',
                  color: 'var(--v3-text)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                Fill manually →
              </button>
            </div>
          )}
        </div>
      </motion.div>

      {/* OUTPUT CARD — empty state OR generated estimate */}
      <AnimatePresence mode="wait">
        {bid && total ? (
          <motion.div
            key="result"
            variants={item}
            initial={{ opacity: 0, y: 12 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.32, ease: [0.2, 0.8, 0.2, 1] }}
            className="v3-section v3-section--primary"
            style={{ margin: '0 var(--v3-gutter) 28px' }}
          >
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, marginBottom: 12 }}>
              <span className="v3-eyebrow" style={{ color: 'var(--v3-primary)', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                <Sparkles size={11} />
                Recommended Price · {marginPct}% margin
              </span>
              <button
                type="button"
                onClick={copyEstimate}
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 5,
                  padding: '6px 10px',
                  borderRadius: 8,
                  border: '1px solid var(--v3-border-strong)',
                  background: 'var(--v3-surface-2)',
                  color: 'var(--v3-text)',
                  fontFamily: 'var(--font-body)',
                  fontSize: 11,
                  fontWeight: 600,
                  cursor: 'pointer'
                }}
              >
                {copied ? <Check size={12} /> : <Copy size={12} />}
                {copied ? 'Copied' : 'Copy'}
              </button>
            </div>

            {/* Headline price */}
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
              <motion.div
                className="v3-money"
                initial={{ scale: 0.9, opacity: 0 }}
                animate={{ scale: 1, opacity: 1 }}
                transition={{ delay: 0.1, type: 'spring', stiffness: 240, damping: 22 }}
                style={{
                  fontSize: 'clamp(40px, 9vw, 56px)',
                  lineHeight: 0.95,
                  letterSpacing: '-0.005em',
                  color: 'var(--v3-text)'
                }}
              >
                <CountUp to={Math.round(total.withMargin)} duration={0.9} prefix="$" formatter={formatThousands} />
              </motion.div>
              <span className="v3-caption" style={{ fontSize: 11 }}>
                Raw range: {money(total.low)} – {money(total.high)}
              </span>
            </div>

            {/* Summary line if present */}
            {bid.summary && (
              <p style={{
                margin: '12px 0 0',
                padding: '10px 12px',
                borderRadius: 10,
                background: 'var(--v3-surface-2)',
                border: '1px solid var(--v3-border)',
                color: 'var(--v3-text)',
                fontFamily: 'var(--font-body)',
                fontSize: 13,
                lineHeight: 1.5
              }}>
                {bid.summary}
              </p>
            )}

            {/* Line items */}
            <div style={{
              marginTop: 14,
              paddingTop: 14,
              borderTop: '1px solid var(--v3-border)'
            }}>
              <SectionHeader label="Line Items" />
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
                {bid.line_items?.map((li, i) => (
                  <motion.div
                    key={i}
                    initial={{ opacity: 0, x: -8 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.15 + i * 0.04 }}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '1fr auto auto',
                      gap: 10,
                      alignItems: 'center',
                      padding: '10px 12px',
                      borderRadius: 10,
                      background: 'var(--v3-surface)',
                      border: '1px solid var(--v3-border)'
                    }}
                  >
                    <div style={{ minWidth: 0 }}>
                      <div style={{
                        fontFamily: 'var(--font-body)',
                        fontSize: 13,
                        fontWeight: 600,
                        color: 'var(--v3-text)'
                      }}>
                        {li.name}
                      </div>
                      {li.notes && (
                        <div style={{ marginTop: 2, fontSize: 11, color: 'var(--v3-text-muted)', lineHeight: 1.4 }}>
                          {li.notes}
                        </div>
                      )}
                    </div>
                    <span style={{
                      flexShrink: 0,
                      fontFamily: 'var(--font-body)',
                      fontSize: 11,
                      color: 'var(--v3-text-muted)',
                      fontVariantNumeric: 'tabular-nums'
                    }}>
                      {li.qty || 1} {li.unit}
                    </span>
                    <span style={{
                      flexShrink: 0,
                      fontFamily: 'var(--font-display)',
                      fontSize: 13,
                      color: 'var(--v3-text)',
                      fontVariantNumeric: 'tabular-nums'
                    }}>
                      {money((li.rate_low || 0) * (li.qty || 1))} – {money((li.rate_high || 0) * (li.qty || 1))}
                    </span>
                  </motion.div>
                ))}
              </div>
            </div>

            {/* Assumptions */}
            {bid.assumptions?.length > 0 && (
              <div style={{ marginTop: 14, paddingTop: 14, borderTop: '1px solid var(--v3-border)' }}>
                <SectionHeader label="Assumptions" />
                <ul style={{ margin: '4px 0 0', paddingLeft: 18, color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.55 }}>
                  {bid.assumptions.map((a, i) => <li key={i} style={{ marginBottom: 4 }}>{a}</li>)}
                </ul>
              </div>
            )}

            {/* Risks */}
            {bid.risks?.length > 0 && (
              <div style={{
                marginTop: 14,
                padding: '12px 14px',
                borderRadius: 10,
                background: 'var(--v3-danger-soft)',
                border: '1px solid color-mix(in srgb, var(--v3-danger) 30%, transparent)'
              }}>
                <span className="v3-eyebrow" style={{ color: 'var(--v3-danger-bright)' }}>Risks</span>
                <ul style={{ margin: '6px 0 0', paddingLeft: 18, color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 13, lineHeight: 1.55 }}>
                  {bid.risks.map((r, i) => <li key={i} style={{ marginBottom: 4 }}>{r}</li>)}
                </ul>
              </div>
            )}
          </motion.div>
        ) : (
          /* Empty state — polished */
          <motion.div
            key="empty"
            variants={item}
            className="v3-section"
            style={{ margin: '0 var(--v3-gutter) 28px' }}
          >
            <div style={{
              padding: '32px 20px',
              textAlign: 'center',
              color: 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)'
            }}>
              <div style={{
                margin: '0 auto 14px',
                width: 48,
                height: 48,
                borderRadius: 14,
                background: 'var(--v3-primary-soft)',
                border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
                display: 'grid',
                placeItems: 'center',
                color: 'var(--v3-primary)'
              }}>
                <FileText size={20} />
              </div>
              <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
                Your estimate will appear here.
              </div>
              <div style={{ fontSize: 12, lineHeight: 1.5 }}>
                Describe the scope above, pick a job type and trades, then tap <strong style={{ color: 'var(--v3-primary)' }}>Generate Estimate</strong>.
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

