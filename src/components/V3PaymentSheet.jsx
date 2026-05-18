import { useEffect, useId, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion } from 'framer-motion'
import { ChevronLeft, Check } from 'lucide-react'
import { logPayment } from '../lib/pipeline.js'
import { toastSuccess, toastError } from '../lib/toast.js'
import { hapticTap } from '../lib/haptics.js'

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

const METHODS = [
  { value: 'cash',  label: 'Cash' },
  { value: 'check', label: 'Check' },
  { value: 'card',  label: 'Card' },
  { value: 'ach',   label: 'ACH' },
  { value: 'other', label: 'Other' }
]

/**
 * V3PaymentSheet — App-Store-grade payment recorder.
 *
 * NOT a card processor. This sheet records what was already collected
 * (cash / check / ACH / card receipt / other). Honest about that — see
 * the helper line under the title.
 *
 * Wires logPayment() from pipeline.js, which:
 *  - inserts to fh_payments with the contact's user_id
 *  - re-aggregates and auto-closes the contact when overpaid
 *  - fires the paid-in-full haptic + toast cascade
 *
 * Mobile keyboard safety: visualViewport listener lifts the sheet via
 * translate3d so the iOS keyboard never covers the amount field. The
 * inner form has overflow:auto so the focused input stays reachable.
 */
// Payment kinds (migration 022). Tags a payment so the invoice
// balance can call out retainage / deposits separately from ongoing
// progress payments. Most contracts only use one or two of these —
// "other" is the safe default for cash-job one-shot payments.
const PAYMENT_KINDS = [
  { value: 'deposit',   label: 'Deposit' },
  { value: 'progress',  label: 'Progress' },
  { value: 'final',     label: 'Final' },
  { value: 'retainage', label: 'Retainage' },
  { value: 'other',     label: 'Other' }
]

export default function V3PaymentSheet({ contact, balance, onClose, onLogged }) {
  const [amount, setAmount] = useState(balance > 0 ? String(Math.round(balance)) : '')
  const [method, setMethod] = useState('check')
  const [kind, setKind] = useState('other')
  const [reference, setReference] = useState('')
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)
  const [success, setSuccess] = useState(false)
  const [kbd, setKbd] = useState(0)
  const titleId = useId()
  const formRef = useRef(null)

  // Track iOS keyboard height so we can lift the sheet above it.
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    function update() {
      const next = Math.max(0, window.innerHeight - vv.height - (vv.offsetTop || 0))
      setKbd(next > 40 ? next : 0)
    }
    update()
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [])

  // Focus-scroll inside the form when an input gets focus (iOS Safari
  // doesn't auto-scroll inside fixed-positioned overflow containers).
  useEffect(() => {
    const form = formRef.current
    if (!form) return
    function onFocusIn(e) {
      const t = e.target
      if (!t || !t.matches?.('input, textarea, select')) return
      setTimeout(() => {
        try { t.scrollIntoView({ block: 'nearest', behavior: 'smooth' }) } catch {}
      }, 280)
    }
    form.addEventListener('focusin', onFocusIn)
    return () => form.removeEventListener('focusin', onFocusIn)
  }, [])

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    const numeric = Number(amount)
    if (!Number.isFinite(numeric) || numeric <= 0) {
      toastError('Enter an amount', 'Amount must be greater than zero.')
      return
    }
    setSaving(true)
    try {
      // logPayment normalizes method internally; 'other' falls through.
      // kind (migration 022) tags the payment for the invoice balance
      // breakdown (deposit / progress / final / retainage / other).
      await logPayment(contact, { amount: numeric, method, kind, reference, paid_on: paidOn })
      hapticTap()
      // Brief in-sheet success state before close so the operator sees
      // the confirmation, App-Store style, instead of an instant dismiss.
      setSuccess(true)
      toastSuccess('Payment recorded', `${money(numeric)} · ${methodLabel(method)}`)
      setTimeout(() => { onLogged?.() }, 700)
    } catch (err) {
      toastError("Couldn't record payment", err?.message || 'Try again in a moment.')
      setSaving(false)
    }
  }

  function handleClosePointer(e) {
    if (e) {
      e.preventDefault?.()
      e.stopPropagation?.()
    }
    onClose?.()
  }

  useEffect(() => {
    function onKey(e) {
      if (e.key === 'Escape') {
        e.preventDefault()
        onClose?.()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  if (typeof document === 'undefined') return null

  const numeric = Number(amount) || 0
  const showsAmount = amount !== '' && Number.isFinite(numeric) && numeric > 0
  const overage = numeric > Number(balance || 0)

  const sheet = (
    <>
      <motion.div
        onPointerDown={handleClosePointer}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        // Solid scrim, no blur — matches the keyboard-fix design language.
        style={{
          position: 'fixed', inset: 0,
          background: 'rgba(0, 0, 0, 0.62)',
          zIndex: 80,
          touchAction: 'none'
        }}
      />
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        onPointerDown={(e) => e.stopPropagation()}
        initial={{ y: '100%', opacity: 0.6 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: '100%', opacity: 0 }}
        transition={{ type: 'spring', stiffness: 400, damping: 36 }}
        style={{
          position: 'fixed',
          left: 0, right: 0,
          bottom: kbd,
          maxWidth: 520, margin: '0 auto',
          background: 'var(--v3-surface-2)',
          borderTopLeftRadius: 22,
          borderTopRightRadius: 22,
          border: '1px solid var(--v3-border)',
          borderBottom: 'none',
          zIndex: 81,
          boxShadow: '0 -20px 60px -12px rgba(0, 0, 0, 0.55)',
          maxHeight: kbd
            ? `calc(100dvh - ${kbd}px - env(safe-area-inset-top) - 24px)`
            : `calc(100dvh - env(safe-area-inset-top) - 24px)`,
          display: 'flex', flexDirection: 'column',
          transition: 'bottom 220ms cubic-bezier(0.16, 1, 0.3, 1), max-height 220ms cubic-bezier(0.16, 1, 0.3, 1)'
        }}
      >
        {/* Drag handle */}
        <div aria-hidden="true" style={{
          width: 44, height: 4, background: 'var(--v3-border-strong)',
          borderRadius: 999, margin: '10px auto 6px',
          flexShrink: 0
        }} />

        {/* Header — back chevron + title */}
        <div style={{
          display: 'flex', alignItems: 'center', gap: 6,
          padding: '8px 16px 12px',
          flexShrink: 0
        }}>
          <button
            type="button"
            onPointerDown={handleClosePointer}
            aria-label="Back"
            style={{
              display: 'inline-flex', alignItems: 'center', gap: 4,
              minHeight: 40, padding: '0 12px 0 6px',
              borderRadius: 10,
              background: 'transparent', border: '1px solid transparent',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
              cursor: 'pointer', WebkitTapHighlightColor: 'transparent'
            }}
          >
            <ChevronLeft size={18} aria-hidden="true" />
            Back
          </button>
          <div style={{ flex: 1, minWidth: 0, textAlign: 'center', display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span
              id={titleId}
              style={{
                fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                letterSpacing: '0.18em', textTransform: 'uppercase',
                color: 'var(--v3-primary)'
              }}
            >
              Record Payment
            </span>
            {contact?.name && (
              <span style={{
                fontFamily: 'var(--font-body)', fontSize: 12,
                color: 'var(--v3-text-muted)',
                overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap',
                padding: '0 8px'
              }}>
                {contact.name}
              </span>
            )}
          </div>
          <span style={{ width: 60 }} aria-hidden="true" />
        </div>

        {/* Success state — replaces the form briefly after a successful
            log so the operator sees the confirmation. */}
        {success ? (
          <div style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center',
            padding: '48px 20px',
            gap: 12
          }}>
            <span aria-hidden="true" style={{
              width: 56, height: 56, borderRadius: '50%',
              background: 'rgba(72, 130, 95, 0.14)',
              border: '1px solid rgba(72, 130, 95, 0.45)',
              display: 'grid', placeItems: 'center',
              color: 'var(--v3-success-bright)'
            }}>
              <Check size={26} strokeWidth={2.5} />
            </span>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 28,
              color: 'var(--v3-text)',
              fontVariantNumeric: 'tabular-nums'
            }}>
              {money(numeric)}
            </div>
            <div style={{
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
              color: 'var(--v3-text-muted)',
              letterSpacing: '0.04em'
            }}>
              Recorded · {methodLabel(method)}
            </div>
          </div>
        ) : (
          <form
            ref={formRef}
            onSubmit={submit}
            style={{
              display: 'flex', flexDirection: 'column',
              flex: 1, minHeight: 0
            }}
          >
            <div style={{
              flex: 1, minHeight: 0,
              overflowY: 'auto',
              WebkitOverflowScrolling: 'touch',
              padding: '0 20px',
              display: 'flex', flexDirection: 'column', gap: 16
            }}>
              {/* AMOUNT — large display-font input, premium feel */}
              <div>
                <label style={{
                  display: 'block',
                  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.16em', textTransform: 'uppercase',
                  color: 'var(--v3-text-muted)',
                  marginBottom: 8
                }} htmlFor="v3-pay-amount">
                  Amount
                </label>
                <div style={{
                  display: 'flex', alignItems: 'baseline', gap: 8,
                  padding: '10px 14px',
                  borderRadius: 14,
                  background: 'var(--v3-surface)',
                  border: '1px solid var(--v3-border-strong)',
                  transition: 'border-color 160ms ease, background 160ms ease',
                  scrollMarginTop: 96, scrollMarginBottom: 140
                }}>
                  <span style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 28,
                    color: showsAmount ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
                    lineHeight: 1
                  }}>
                    $
                  </span>
                  <input
                    id="v3-pay-amount"
                    autoFocus
                    type="text"
                    inputMode="decimal"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value.replace(/[^\d.]/g, ''))}
                    placeholder="0"
                    style={{
                      flex: 1, minWidth: 0,
                      background: 'transparent',
                      border: 'none', outline: 'none',
                      color: 'var(--v3-text)',
                      fontFamily: 'var(--font-display)',
                      fontSize: 28,
                      lineHeight: 1.1,
                      padding: 0,
                      fontVariantNumeric: 'tabular-nums',
                      scrollMarginTop: 96, scrollMarginBottom: 140
                    }}
                  />
                </div>
                <div style={{
                  marginTop: 6,
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  fontFamily: 'var(--font-body)', fontSize: 11,
                  color: overage ? 'var(--v3-warn, var(--v3-primary))' : 'var(--v3-text-muted)',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  <span>
                    {Number(balance) > 0
                      ? `Balance ${money(balance)}`
                      : 'Records a payment against this job'}
                  </span>
                  {Number(balance) > 0 && Number(amount) !== Math.round(Number(balance)) && Number(amount) > 0 && (
                    <button
                      type="button"
                      onClick={() => setAmount(String(Math.round(Number(balance))))}
                      style={{
                        background: 'transparent', border: 'none',
                        color: 'var(--v3-primary)',
                        fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
                        textDecoration: 'underline', textUnderlineOffset: 2,
                        cursor: 'pointer', padding: 0
                      }}
                    >
                      Pay full balance
                    </button>
                  )}
                </div>
              </div>

              {/* METHOD — segmented chips, App-Store style */}
              <div>
                <span style={{
                  display: 'block',
                  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.16em', textTransform: 'uppercase',
                  color: 'var(--v3-text-muted)',
                  marginBottom: 8
                }}>
                  Method
                </span>
                <div role="radiogroup" aria-label="Payment method" style={{
                  display: 'flex', gap: 6, flexWrap: 'wrap'
                }}>
                  {METHODS.map((m) => {
                    const on = method === m.value
                    return (
                      <button
                        key={m.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => { hapticTap(); setMethod(m.value) }}
                        style={{
                          minHeight: 40,
                          padding: '8px 14px',
                          borderRadius: 999,
                          background: on ? 'var(--v3-primary-soft)' : 'var(--v3-surface)',
                          border: on
                            ? '1px solid color-mix(in srgb, var(--v3-primary) 60%, transparent)'
                            : '1px solid var(--v3-border)',
                          color: on ? 'var(--v3-primary)' : 'var(--v3-text)',
                          fontFamily: 'var(--font-body)', fontSize: 13,
                          fontWeight: on ? 700 : 500,
                          letterSpacing: '0.02em',
                          cursor: 'pointer',
                          WebkitTapHighlightColor: 'transparent',
                          touchAction: 'manipulation',
                          transition: 'background 160ms ease, border-color 160ms ease, color 160ms ease'
                        }}
                      >
                        {m.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* KIND — tags the payment for the invoice balance
                  breakdown (deposit / progress / final / retainage).
                  Default 'other' is fine for a one-shot cash-job
                  payment; the contractor opts in to a specific kind
                  when it matters (commercial retainage, insurance
                  deductible callout, deposit-then-final flow). */}
              <div>
                <span style={{
                  display: 'block',
                  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.16em', textTransform: 'uppercase',
                  color: 'var(--v3-text-muted)',
                  marginBottom: 8
                }}>
                  Kind
                </span>
                <div role="radiogroup" aria-label="Payment kind" style={{
                  display: 'flex', gap: 6, flexWrap: 'wrap'
                }}>
                  {PAYMENT_KINDS.map((k) => {
                    const on = kind === k.value
                    return (
                      <button
                        key={k.value}
                        type="button"
                        role="radio"
                        aria-checked={on}
                        onClick={() => { hapticTap(); setKind(k.value) }}
                        style={{
                          minHeight: 36,
                          padding: '7px 12px',
                          borderRadius: 999,
                          background: on ? 'var(--v3-primary-soft)' : 'var(--v3-surface)',
                          border: on
                            ? '1px solid color-mix(in srgb, var(--v3-primary) 60%, transparent)'
                            : '1px solid var(--v3-border)',
                          color: on ? 'var(--v3-primary)' : 'var(--v3-text-secondary)',
                          fontFamily: 'var(--font-body)', fontSize: 12,
                          fontWeight: on ? 700 : 500,
                          cursor: 'pointer',
                          WebkitTapHighlightColor: 'transparent',
                          touchAction: 'manipulation',
                          transition: 'background 160ms ease, border-color 160ms ease, color 160ms ease'
                        }}
                      >
                        {k.label}
                      </button>
                    )
                  })}
                </div>
              </div>

              {/* REFERENCE — only shown for check/card/ach where there's
                  typically a number to record */}
              {method !== 'cash' && method !== 'other' && (
                <div>
                  <label style={{
                    display: 'block',
                    fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                    letterSpacing: '0.16em', textTransform: 'uppercase',
                    color: 'var(--v3-text-muted)',
                    marginBottom: 8
                  }} htmlFor="v3-pay-ref">
                    {method === 'check' ? 'Check number' : method === 'card' ? 'Last 4 / receipt' : 'Reference'}
                  </label>
                  <input
                    id="v3-pay-ref"
                    type="text"
                    value={reference}
                    onChange={(e) => setReference(e.target.value)}
                    placeholder={method === 'check' ? '1234' : method === 'card' ? '#0000' : 'Optional'}
                    style={{
                      width: '100%',
                      boxSizing: 'border-box',
                      padding: '12px 14px',
                      borderRadius: 12,
                      background: 'var(--v3-surface)',
                      border: '1px solid var(--v3-border)',
                      color: 'var(--v3-text)',
                      fontFamily: 'var(--font-body)', fontSize: 14,
                      outline: 'none',
                      scrollMarginTop: 96, scrollMarginBottom: 140
                    }}
                  />
                </div>
              )}

              {/* PAID ON */}
              <div>
                <label style={{
                  display: 'block',
                  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
                  letterSpacing: '0.16em', textTransform: 'uppercase',
                  color: 'var(--v3-text-muted)',
                  marginBottom: 8
                }} htmlFor="v3-pay-date">
                  Paid on
                </label>
                <input
                  id="v3-pay-date"
                  type="date"
                  value={paidOn}
                  onChange={(e) => setPaidOn(e.target.value)}
                  style={{
                    width: '100%',
                    boxSizing: 'border-box',
                    padding: '12px 14px',
                    borderRadius: 12,
                    background: 'var(--v3-surface)',
                    border: '1px solid var(--v3-border)',
                    color: 'var(--v3-text)',
                    fontFamily: 'var(--font-body)', fontSize: 14,
                    outline: 'none',
                    scrollMarginTop: 96, scrollMarginBottom: 140
                  }}
                />
              </div>

              {/* Honesty note — record-only, no card processing */}
              <div style={{
                fontFamily: 'var(--font-body)', fontSize: 11, lineHeight: 1.5,
                color: 'var(--v3-text-muted)',
                paddingBottom: 8
              }}>
                FieldHorse records what you collected. It doesn&apos;t process card or ACH payments — log the receipt here after you take payment.
              </div>
            </div>

            {/* Action footer — sticky to bottom of sheet, safe-area aware */}
            <div style={{
              display: 'flex', gap: 8,
              padding: '12px 16px max(12px, env(safe-area-inset-bottom))',
              borderTop: '1px solid var(--v3-border)',
              flexShrink: 0,
              background: 'var(--v3-surface-2)'
            }}>
              <button
                type="button"
                onPointerDown={handleClosePointer}
                disabled={saving}
                style={{
                  flex: 1, minHeight: 48,
                  padding: '12px', borderRadius: 12,
                  background: 'transparent', border: '1px solid var(--v3-border)',
                  color: saving ? 'var(--v3-text-muted)' : 'var(--v3-text)',
                  cursor: saving ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
                  WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation'
                }}
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={saving || !showsAmount}
                style={{
                  flex: 2, minHeight: 48,
                  padding: '12px', borderRadius: 12,
                  background: (saving || !showsAmount)
                    ? 'var(--v3-surface)'
                    : 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
                  border: (saving || !showsAmount) ? '1px solid var(--v3-border)' : 'none',
                  color: (saving || !showsAmount) ? 'var(--v3-text-muted)' : 'var(--v3-on-primary)',
                  cursor: (saving || !showsAmount) ? 'not-allowed' : 'pointer',
                  fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
                  letterSpacing: '0.04em',
                  boxShadow: (saving || !showsAmount)
                    ? 'none'
                    : '0 0 0 3px rgba(229, 193, 88, 0.10), 0 4px 12px rgba(229, 193, 88, 0.18), 0 1px 0 rgba(255, 255, 255, 0.30) inset',
                  WebkitTapHighlightColor: 'transparent', touchAction: 'manipulation'
                }}
              >
                {saving ? 'Recording…' : showsAmount ? `Record ${money(numeric)}` : 'Record Payment'}
              </button>
            </div>
          </form>
        )}
      </motion.div>
    </>
  )

  return createPortal(sheet, document.body)
}

function methodLabel(value) {
  const m = METHODS.find((x) => x.value === value)
  return m ? m.label : 'Payment'
}
