import { useState } from 'react'
import { motion } from 'framer-motion'
import { X } from 'lucide-react'
import { logPayment } from '../lib/pipeline.js'
import { toastSuccess, toastError } from '../lib/toast.js'

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

/**
 * V3PaymentSheet — shared bottom-sheet for logging a payment against a
 * contact. Used by ContactDetail (Job Detail) and Invoices (Money Owed).
 *
 * Wires the existing logPayment() from pipeline.js, which handles:
 *  - fh_payments insert with user_id from the contact
 *  - re-aggregating payments and auto-closing the contact when overpaid
 *  - haptic + toast cascade for paid-in-full
 *
 * Props:
 *  - contact: the contact (job) row with id + user_id
 *  - balance: prefilled amount (the operator can edit it before submit)
 *  - onClose: dismiss callback
 *  - onLogged: success callback (caller typically refreshes its data)
 */
export default function V3PaymentSheet({ contact, balance, onClose, onLogged }) {
  const [amount, setAmount] = useState(balance > 0 ? balance : '')
  const [method, setMethod] = useState('check')
  const [reference, setReference] = useState('')
  const [paidOn, setPaidOn] = useState(new Date().toISOString().slice(0, 10))
  const [saving, setSaving] = useState(false)

  async function submit(e) {
    e.preventDefault()
    if (saving) return
    setSaving(true)
    try {
      await logPayment(contact, { amount, method, reference, paid_on: paidOn })
      toastSuccess('Payment logged', `${money(amount)} recorded`)
      onLogged()
    } catch (err) {
      toastError("Couldn't log payment", err?.message || 'Unknown error')
      setSaving(false)
    }
  }

  // Defensive close — swallow the click so nothing behind the sheet
  // (PaymentCard title <Link>, etc.) can interpret the gesture as a
  // navigation. The sheet renders over a fixed backdrop, but rapid
  // taps near the edge can land on underlying handlers when the
  // backdrop animates in.
  function handleClose(e) {
    if (e) {
      e.preventDefault?.()
      e.stopPropagation?.()
    }
    onClose?.()
  }

  return (
    <>
      <motion.div
        onClick={handleClose}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)',
          backdropFilter: 'blur(8px)', zIndex: 80
        }}
      />
      <motion.div
        initial={{ y: 20, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        exit={{ y: 12, opacity: 0 }}
        // Cap height so the sheet never overflows the viewport. Body
        // scrolls; header + footer stay pinned. Bottom offset clears
        // the BottomNav and the safe-area inset.
        style={{
          position: 'fixed',
          left: 16, right: 16, bottom: 'max(16px, env(safe-area-inset-bottom))',
          maxWidth: 480, margin: '0 auto',
          background: 'var(--v3-surface-2)', borderRadius: 18,
          border: '1px solid var(--v3-border)', zIndex: 81,
          boxShadow: '0 24px 60px rgba(0,0,0,0.5)',
          maxHeight: 'min(85vh, 720px)',
          display: 'flex', flexDirection: 'column'
        }}
      >
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          padding: '20px 20px 14px',
          flexShrink: 0
        }}>
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
            letterSpacing: '0.18em', textTransform: 'uppercase',
            color: 'var(--v3-primary)'
          }}>
            Log Payment
          </span>
          <button
            type="button"
            onClick={handleClose}
            aria-label="Close"
            style={{
              width: 32, height: 32, borderRadius: 10, border: '1px solid var(--v3-border)',
              background: 'transparent', color: 'var(--v3-text-muted)', cursor: 'pointer',
              display: 'grid', placeItems: 'center'
            }}
          >
            <X size={16} aria-hidden="true" />
          </button>
        </div>
        <form
          onSubmit={submit}
          style={{
            display: 'flex', flexDirection: 'column',
            flex: 1, minHeight: 0
          }}
        >
          {/* Scrollable body — fields live here. flex:1 + minHeight:0
              + overflowY:auto is the standard recipe to make a flex
              child scroll inside a capped flex parent. */}
          <div style={{
            flex: 1, minHeight: 0,
            overflowY: 'auto',
            padding: '0 20px',
            display: 'flex', flexDirection: 'column', gap: 14
          }}>
            <SheetField label="Amount">
              <input
                autoFocus
                type="number"
                inputMode="decimal"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </SheetField>
            <SheetField label="Method">
              <select value={method} onChange={(e) => setMethod(e.target.value)}>
                <option value="check">Check</option>
                <option value="card">Card</option>
                <option value="cash">Cash</option>
                <option value="ach">ACH</option>
              </select>
            </SheetField>
            {method === 'check' && (
              <SheetField label="Check number">
                <input value={reference} onChange={(e) => setReference(e.target.value)} />
              </SheetField>
            )}
            <SheetField label="Paid on">
              <input type="date" value={paidOn} onChange={(e) => setPaidOn(e.target.value)} />
            </SheetField>
          </div>
          {/* Sticky footer — always visible. Top hairline separates
              from the scrolling body. */}
          <div style={{
            display: 'flex', gap: 8,
            padding: '14px 20px 20px',
            borderTop: '1px solid var(--v3-border)',
            flexShrink: 0,
            background: 'var(--v3-surface-2)'
          }}>
            <button
              type="button"
              onClick={handleClose}
              style={{
                flex: 1, padding: '12px', borderRadius: 12,
                background: 'transparent', border: '1px solid var(--v3-border)',
                color: 'var(--v3-text)', cursor: 'pointer',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600
              }}
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              style={{
                flex: 2, padding: '12px', borderRadius: 12,
                background: 'var(--v3-primary)', border: 'none', color: 'var(--v3-on-primary)',
                cursor: saving ? 'wait' : 'pointer',
                fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                letterSpacing: '0.04em',
                boxShadow: '0 8px 22px rgba(212, 175, 55, 0.32)'
              }}
            >
              {saving ? 'Saving…' : 'Log Payment'}
            </button>
          </div>
        </form>
      </motion.div>
    </>
  )
}

function SheetField({ label, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <span style={{
        fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
        letterSpacing: '0.16em', textTransform: 'uppercase',
        color: 'var(--v3-text-muted)'
      }}>
        {label}
      </span>
      <div className="v3-sheet-field">
        {children}
      </div>
      <style>{`
        .v3-sheet-field input,
        .v3-sheet-field select {
          width: 100%;
          box-sizing: border-box;
          padding: 12px 14px;
          background: var(--v3-surface);
          border: 1px solid var(--v3-border);
          border-radius: 10px;
          color: var(--v3-text);
          font-family: var(--font-body);
          font-size: 14px;
          outline: none;
          transition: border-color 160ms ease;
        }
        .v3-sheet-field input:focus,
        .v3-sheet-field select:focus {
          border-color: var(--v3-primary);
        }
      `}</style>
    </label>
  )
}
