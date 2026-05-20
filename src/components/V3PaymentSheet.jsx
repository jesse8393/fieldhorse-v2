// src/components/V3PaymentSheet.jsx
//
// Payment recorder — NOT a card processor. Records what the contractor
// already collected (cash / check / ACH / card receipt / other) against
// the job. Wires logPayment() from pipeline.ts which:
//   - inserts to fh_payments with the contact's user_id
//   - re-aggregates and auto-closes the contact when overpaid
//   - fires the paid-in-full haptic + toast cascade
//
// Rebuilt onto the v3 Vaul Drawer chrome (was a bespoke createPortal
// dialog despite the V3 name — was a stealth offender in the chrome
// audit). Same form fields, same success state, same kbd handling.

import { useEffect, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { DollarSign, Check, X } from 'lucide-react'
import { logPayment } from '../lib/pipeline.ts'
import { toastSuccess, toastError } from '../lib/toast.js'
import { hapticTap } from '../lib/haptics.js'
import { useDrawerKeyboard } from '../lib/useDrawerKeyboard.js'

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

// Payment kinds (migration 022). Tags a payment so the invoice balance
// can call out retainage / deposits separately from ongoing progress.
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
  // Drawer always opens when this component is mounted; parent controls
  // mount via AnimatePresence. The local open=true keeps Vaul happy.
  const [open, setOpen] = useState(true)
  const { formRef, drawerStyle, formStyle } = useDrawerKeyboard(open)

  async function submit(e) {
    e?.preventDefault()
    if (saving) return
    const numeric = Number(amount)
    if (!Number.isFinite(numeric) || numeric <= 0) {
      toastError('Enter an amount', 'Amount must be greater than zero.')
      return
    }
    setSaving(true)
    try {
      await logPayment(contact, { amount: numeric, method, kind, reference, paid_on: paidOn })
      hapticTap()
      setSuccess(true)
      toastSuccess('Payment recorded', `${money(numeric)} · ${methodLabel(method)}`)
      setTimeout(() => { onLogged?.() }, 700)
    } catch (err) {
      toastError("Couldn't record payment", err?.message || 'Try again in a moment.')
      setSaving(false)
    }
  }

  function requestClose(v) {
    if (v) return
    if (saving) return
    setOpen(false)
    setTimeout(() => onClose?.(), 200)
  }

  const numeric = Number(amount) || 0
  const showsAmount = amount !== '' && Number.isFinite(numeric) && numeric > 0
  const overage = numeric > Number(balance || 0)
  const labelStyle = { fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }

  return (
    <Drawer open={open} onOpenChange={requestClose}>
      <DrawerContent
        className="ui:max-w-full ui:overflow-x-hidden"
        style={drawerStyle}
      >
        <DrawerHeader className="ui:text-left" style={{ maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            <DollarSign size={12} />
            Record payment
          </div>
          <DrawerTitle asChild>
            <h2
              className="fh-font-serif"
              style={{ margin: '6px 0 0', fontSize: 'clamp(22px, 6vw, 28px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}
            >
              Log what was paid.
            </h2>
          </DrawerTitle>
          <DrawerDescription
            style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}
          >
            {contact?.name
              ? <>Records a payment against <strong style={{ color: 'var(--ink-strong)' }}>{contact.name}</strong>. This is a receipt log — not a card processor.</>
              : <>Records a payment against this job. This is a receipt log — not a card processor.</>}
          </DrawerDescription>
        </DrawerHeader>

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
              color: 'var(--signal-green, #4ade80)'
            }}>
              <Check size={26} strokeWidth={2.5} />
            </span>
            <div style={{
              fontFamily: 'var(--font-display)', fontSize: 28,
              color: 'var(--ink-strong)',
              fontVariantNumeric: 'tabular-nums'
            }}>
              {money(numeric)}
            </div>
            <div style={{
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
              color: 'var(--ink-muted)',
              letterSpacing: '0.04em'
            }}>
              Recorded · {methodLabel(method)}
            </div>
          </div>
        ) : (
          <form
            ref={formRef}
            onSubmit={submit}
            style={formStyle({ gap: 14 })}
          >
            {/* AMOUNT — display-font input */}
            <div>
              <label style={{ ...labelStyle, display: 'block', marginBottom: 8 }} htmlFor="v3-pay-amount">
                Amount
              </label>
              <div style={{
                display: 'flex', alignItems: 'baseline', gap: 8,
                padding: '10px 14px',
                borderRadius: 14,
                background: 'var(--surface-2)',
                border: '1px solid var(--rule)',
                scrollMarginTop: 96, scrollMarginBottom: 140
              }}>
                <span style={{
                  fontFamily: 'var(--font-display)',
                  fontSize: 28,
                  color: showsAmount ? 'var(--field-gold-bright)' : 'var(--ink-muted)',
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
                  disabled={saving}
                  style={{
                    flex: 1, minWidth: 0,
                    background: 'transparent',
                    border: 'none', outline: 'none',
                    color: 'var(--ink-strong)',
                    fontFamily: 'var(--font-display)',
                    fontSize: 28,
                    lineHeight: 1.1,
                    padding: 0,
                    fontVariantNumeric: 'tabular-nums'
                  }}
                />
              </div>
              <div style={{
                marginTop: 6,
                display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                fontFamily: 'var(--font-body)', fontSize: 11,
                color: overage ? 'var(--field-gold-bright)' : 'var(--ink-muted)',
                fontVariantNumeric: 'tabular-nums'
              }}>
                <span>
                  {Number(balance) > 0
                    ? `Balance ${money(balance)}${overage ? ' · overage' : ''}`
                    : 'No outstanding balance'}
                </span>
                {Number(balance) > 0 && Number(amount) !== Math.round(Number(balance)) && Number(amount) > 0 && (
                  <button
                    type="button"
                    onClick={() => setAmount(String(Math.round(Number(balance))))}
                    style={{
                      background: 'transparent', border: 'none',
                      color: 'var(--field-gold-bright)',
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

            {/* METHOD chips */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={labelStyle}>Method</span>
              <div role="radiogroup" aria-label="Payment method" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {METHODS.map((m) => {
                  const on = method === m.value
                  return (
                    <button
                      key={m.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => { hapticTap(); setMethod(m.value) }}
                      disabled={saving}
                      style={chipStyle(on, saving)}
                    >
                      {m.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* KIND chips */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={labelStyle}>Kind</span>
              <div role="radiogroup" aria-label="Payment kind" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {PAYMENT_KINDS.map((k) => {
                  const on = kind === k.value
                  return (
                    <button
                      key={k.value}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => { hapticTap(); setKind(k.value) }}
                      disabled={saving}
                      style={chipStyle(on, saving)}
                    >
                      {k.label}
                    </button>
                  )
                })}
              </div>
            </div>

            {/* REFERENCE — only for check / card / ach */}
            {method !== 'cash' && method !== 'other' && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                <span style={labelStyle}>
                  {method === 'check' ? 'Check number' : method === 'card' ? 'Last 4 / receipt' : 'Reference'}
                </span>
                <input
                  type="text"
                  value={reference}
                  onChange={(e) => setReference(e.target.value)}
                  placeholder={method === 'check' ? '1234' : method === 'card' ? '#0000' : 'Optional'}
                  disabled={saving}
                  style={fieldStyle}
                />
              </label>
            )}

            {/* PAID ON */}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={labelStyle}>Paid on</span>
              <input
                type="date"
                value={paidOn}
                onChange={(e) => setPaidOn(e.target.value)}
                disabled={saving}
                style={fieldStyle}
              />
            </label>

            {/* Honesty note */}
            <div style={{
              fontFamily: 'var(--font-body)', fontSize: 11, lineHeight: 1.5,
              color: 'var(--ink-faint, var(--ink-muted))'
            }}>
              Records the receipt — doesn't process card or ACH. Log here after you've taken payment.
            </div>

            {/* Action footer */}
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1.4fr', gap: 10, marginTop: 4 }}>
              <button
                type="button"
                onClick={() => requestClose(false)}
                disabled={saving}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  padding: '12px 14px', borderRadius: 12,
                  background: 'var(--surface-2)', border: '1px solid var(--rule)',
                  color: 'var(--ink-strong)',
                  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                  cursor: saving ? 'wait' : 'pointer'
                }}
              >
                <X size={14} />
                Cancel
              </button>
              <motion.button
                type="submit"
                whileTap={{ scale: saving || !showsAmount ? 1 : 0.98 }}
                disabled={saving || !showsAmount}
                style={{
                  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  padding: '12px 14px', borderRadius: 12, border: 'none',
                  background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
                  color: 'var(--onyx)',
                  fontFamily: 'var(--font-display)', fontSize: 14, letterSpacing: '0.14em',
                  cursor: saving || !showsAmount ? 'not-allowed' : 'pointer',
                  boxShadow: '0 6px 16px rgba(201,150,58,0.3)',
                  opacity: saving || !showsAmount ? 0.55 : 1
                }}
              >
                <Check size={14} />
                {saving ? 'RECORDING…' : showsAmount ? `RECORD ${money(numeric)}` : 'RECORD PAYMENT'}
              </motion.button>
            </div>
          </form>
        )}
      </DrawerContent>
    </Drawer>
  )
}

const fieldStyle = {
  padding: '11px 14px',
  borderRadius: 12,
  background: 'var(--surface-2)',
  border: '1px solid var(--rule)',
  color: 'var(--ink-strong)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  scrollMarginTop: 96,
  scrollMarginBottom: 140
}

function chipStyle(active, disabled) {
  return {
    padding: '7px 12px',
    borderRadius: 999,
    border: active
      ? '1px solid rgba(201,150,58,0.4)'
      : '1px solid var(--rule)',
    background: active
      ? 'rgba(201,150,58,0.14)'
      : 'var(--surface-2)',
    color: active
      ? 'var(--field-gold-bright)'
      : 'var(--ink-muted)',
    fontFamily: 'var(--font-body)',
    fontSize: 12,
    fontWeight: 700,
    cursor: disabled ? 'wait' : 'pointer',
    transition: 'all 160ms ease'
  }
}

function methodLabel(value) {
  const m = METHODS.find((x) => x.value === value)
  return m ? m.label : 'Payment'
}
