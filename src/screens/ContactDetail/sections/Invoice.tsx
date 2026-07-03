import { motion } from 'framer-motion'
import { DollarSign, Plus, Trash2 } from 'lucide-react'
import { hapticTap } from '../../../lib/haptics.ts'
import { supabase } from '../../../lib/supabase.ts'
import { useConfirm } from '../../../components/ConfirmSheet.tsx'
import { toastSuccess, toastError } from '../../../lib/toast.ts'

function money(n: any) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

/**
 * Invoice section — surfaces balance + payment history. The actual "Log
 * Payment" sheet lives in the parent shell (V3PaymentSheet) and is opened
 * via onOpenLogPayment. This section is read-mostly + one CTA.
 *
 * Payment deletion lives here (not on the Overview activity feed anymore)
 * — the payment-history list is where a mislogged payment naturally gets
 * corrected. Each row confirms before deleting since payments drive the
 * job's paid/balance numbers.
 */
export default function InvoiceSection({ contact, payments = [], paid = 0, balance = 0, onOpenLogPayment, userId, fetchAll }: any) {
  const amount = Number(contact?.amount || 0)
  const pct = amount > 0 ? Math.min(100, Math.round((paid / amount) * 100)) : 0
  const isClosed = balance <= 0.5 && amount > 0
  const confirm = useConfirm() as any

  async function deletePayment(paymentId: any, paymentAmount: any) {
    if (!paymentId || !userId) return
    const ok = await confirm({
      title: 'Delete this payment?',
      body: `Removes a ${money(paymentAmount)} payment from this job. This can't be undone — re-log it if you delete by mistake.`,
      destructive: true,
      confirmLabel: 'Delete payment'
    })
    if (!ok) return
    const { error } = await supabase
      .from('fh_payments')
      .delete()
      .eq('id', paymentId)
      .eq('user_id', userId)
    if (error) {
      toastError("Couldn't delete payment", error.message)
      return
    }
    toastSuccess('Payment deleted', `${money(paymentAmount)} removed`)
    await fetchAll?.()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 20px 24px' }}>

      {/* Balance hero */}
      <div style={{
        padding: '20px 18px',
        borderRadius: 16,
        background: 'var(--v3-surface)',
        border: isClosed
          ? '1px solid color-mix(in srgb, var(--v3-success-bright) 30%, transparent)'
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
          color: isClosed ? 'var(--v3-success-bright)' : 'var(--v3-text-muted)'
        }}>
          {isClosed ? 'Paid in full' : 'Balance due'}
        </span>
        <div>
          <div style={{
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(36px, 9vw, 52px)',
            color: isClosed ? 'var(--v3-success-bright)' : 'var(--v3-primary)',
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
          background: 'var(--v3-glass-tint-2)', overflow: 'hidden'
        }}>
          <span style={{
            position: 'absolute', inset: 0, width: `${pct}%`,
            background: isClosed ? 'var(--v3-success-bright)' : 'var(--v3-primary)',
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
              background: 'var(--v3-primary)', color: 'var(--v3-on-primary)', border: 'none',
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
            {payments.map((p: any) => (
              <li key={p.id} style={{
                display: 'flex', alignItems: 'center', gap: 12,
                padding: '12px 14px', borderRadius: 12,
                background: 'var(--v3-surface)', border: '1px solid var(--v3-border)'
              }}>
                <span aria-hidden="true" style={{
                  flexShrink: 0, width: 32, height: 32, borderRadius: 9,
                  background: 'rgba(46, 204, 113, 0.14)',
                  border: '1px solid color-mix(in srgb, var(--v3-success-bright) 30%, transparent)',
                  color: 'var(--v3-success-bright)',
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
                {userId && (
                  <button
                    type="button"
                    onClick={() => { hapticTap(); deletePayment(p.id, p.amount) }}
                    aria-label={`Delete ${money(p.amount)} payment`}
                    style={{
                      flexShrink: 0, width: 30, height: 30, borderRadius: 8,
                      display: 'grid', placeItems: 'center',
                      background: 'transparent', border: '1px solid var(--v3-border)',
                      color: 'var(--v3-text-muted)', cursor: 'pointer',
                      WebkitTapHighlightColor: 'transparent'
                    }}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}
