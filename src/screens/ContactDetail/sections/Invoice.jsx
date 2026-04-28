import { motion } from 'framer-motion'
import { DollarSign, Plus } from 'lucide-react'
import { hapticTap } from '../../../lib/haptics.js'

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

/**
 * Invoice section — surfaces balance + payment history. The actual "Log
 * Payment" sheet lives in the parent shell (V3PaymentSheet) and is opened
 * via onOpenLogPayment. This section is read-mostly + one CTA.
 */
export default function InvoiceSection({ contact, payments = [], paid = 0, balance = 0, onOpenLogPayment }) {
  const amount = Number(contact?.amount || 0)
  const pct = amount > 0 ? Math.min(100, Math.round((paid / amount) * 100)) : 0
  const isClosed = balance <= 0.5 && amount > 0

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 20px 24px' }}>

      {/* Balance hero */}
      <div style={{
        padding: '20px 18px',
        borderRadius: 16,
        background: 'var(--v3-surface)',
        border: isClosed
          ? '1px solid color-mix(in srgb, #4ADE80 30%, transparent)'
          : '1px solid var(--v3-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 14,
        position: 'relative',
        overflow: 'hidden'
      }}>
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: isClosed ? '#4ADE80' : 'var(--v3-text-muted)'
        }}>
          {isClosed ? 'Paid in full' : 'Balance due'}
        </span>
        <div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(36px, 9vw, 52px)',
            color: isClosed ? '#4ADE80' : 'var(--v3-primary)',
            lineHeight: 1, letterSpacing: '0.01em',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {money(isClosed ? amount : balance)}
          </div>
          <div style={{
            marginTop: 8,
            fontFamily: 'var(--font-body)', fontSize: 12,
            color: 'var(--v3-text-muted)',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {money(paid)} paid of {money(amount)}
          </div>
        </div>

        {/* Progress bar */}
        <div style={{
          position: 'relative', height: 6, borderRadius: 999,
          background: 'rgba(255, 255, 255, 0.06)', overflow: 'hidden'
        }}>
          <span style={{
            position: 'absolute', inset: 0, width: `${pct}%`,
            background: isClosed ? '#4ADE80' : 'var(--v3-primary)',
            borderRadius: 999,
            transition: 'width 500ms cubic-bezier(0.2, 0.8, 0.2, 1)'
          }} />
        </div>

        {!isClosed && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={() => { hapticTap(); onOpenLogPayment?.() }}
            style={{
              marginTop: 4,
              width: '100%',
              padding: '12px 16px', borderRadius: 12,
              background: 'var(--v3-primary)', color: '#0B0B0D', border: 'none',
              fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
              letterSpacing: '0.04em', cursor: 'pointer',
              boxShadow: '0 8px 22px rgba(212, 175, 55, 0.32)',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            <DollarSign size={14} aria-hidden="true" />
            Log Payment
          </motion.button>
        )}
      </div>

      {/* Payment history */}
      <div>
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          marginBottom: 8, gap: 8
        }}>
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
            textTransform: 'uppercase', color: 'var(--v3-text-muted)'
          }}>
            Payments
          </span>
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 11,
            color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums'
          }}>
            {payments.length} logged
          </span>
        </div>

        {payments.length === 0 ? (
          <div style={{
            padding: '20px 18px', borderRadius: 14,
            background: 'var(--v3-surface)', border: '1px dashed var(--v3-border-strong)',
            color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
            fontSize: 13, textAlign: 'center', lineHeight: 1.5
          }}>
            No payments yet. Tap <strong>Log Payment</strong> when funds clear.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {payments.map((p) => (
              <li key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 12,
                background: 'var(--v3-surface)', border: '1px solid var(--v3-border)'
              }}>
                <span aria-hidden="true" style={{
                  flexShrink: 0, width: 32, height: 32, borderRadius: 9,
                  background: 'rgba(46, 204, 113, 0.14)',
                  border: '1px solid color-mix(in srgb, #4ADE80 30%, transparent)',
                  color: '#4ADE80',
                  display: 'grid', placeItems: 'center'
                }}>
                  <DollarSign size={14} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-display)', fontSize: 16,
                    color: 'var(--v3-text)',
                    fontVariantNumeric: 'tabular-nums'
                  }}>
                    {money(p.amount)}
                  </div>
                  <div style={{
                    marginTop: 2,
                    fontFamily: 'var(--font-body)', fontSize: 11,
                    color: 'var(--v3-text-muted)',
                    fontVariantNumeric: 'tabular-nums'
                  }}>
                    {p.method}{p.reference ? ` · #${p.reference}` : ''}
                  </div>
                </div>
                <span style={{
                  flexShrink: 0,
                  fontFamily: 'var(--font-body)', fontSize: 11,
                  color: 'var(--v3-text-muted)',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  {p.paid_on}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
