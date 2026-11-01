// mobile/components/PaymentSheet.tsx, record a payment against a job.
// Mirrors web src/components/V3PaymentSheet.tsx: amount, method
// (cash/check/ACH/card), and date. Used by invoice detail and job detail.
import { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable } from 'react-native'
import { useLogPayment } from '../lib/queries'
import { BottomSheet, SheetField, GoldButton, theme } from './ui'
import { paymentAmount, localDate, isCalendarDate } from '../lib/paymentInput'

const METHODS = ['cash', 'check', 'ach', 'card']

const today = localDate

type Props = {
  open: boolean; onClose: () => void; userId: string; contactId: string
  balance?: number | null; onLogged?: () => void
}

export function PaymentSheet({ open, onClose, userId, contactId, balance, onLogged }: Props) {
  const logPayment = useLogPayment()
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('check')
  const [date, setDate] = useState(today())
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setAmount(balance && balance > 0 ? balance.toFixed(2) : '')
    setMethod('check'); setDate(today()); setErr(null)
  }, [open, balance])

  async function submit() {
    if (savingRef.current) return
    const amt = paymentAmount(amount)
    if (amt == null) { setErr('Enter a positive payment amount with up to two decimal places.'); return }
    if (!isCalendarDate(date.trim())) { setErr('Enter a valid date as YYYY-MM-DD.'); return }
    savingRef.current = true
    setSaving(true); setErr(null)
    try {
      const { error } = await logPayment({ contactId, userId, amount: amt, method, paidOn: date.trim() })
      if (error) { setErr(error.message); return }
      onClose()
      onLogged?.()
    } catch { setErr("Couldn't save the payment. Check your connection and try again.") }
    finally { savingRef.current = false; setSaving(false) }
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Record payment">
      {balance != null && balance > 0 ? (
        <Text style={{ color: theme.inkMuted, fontSize: 14, marginBottom: 14 }}>Balance: ${balance.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</Text>
      ) : null}
      <SheetField label="Amount ($)" value={amount} onChange={setAmount} keyboardType="numeric" placeholder="0" autoFocus />

      <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 8 }}>Method</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {METHODS.map((m) => {
          const on = method === m
          return (
            <Pressable key={m} onPress={() => setMethod(m)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: on ? theme.goldBright : theme.borderMid, backgroundColor: on ? `${theme.goldBright}26` : theme.bg }}>
              <Text style={{ color: on ? theme.goldBright : theme.inkMuted, fontSize: 14, fontWeight: '700', textTransform: 'uppercase' }}>{m}</Text>
            </Pressable>
          )
        })}
      </View>

      <SheetField label="Date" value={date} onChange={setDate} placeholder="year month day" />

      {err ? <Text style={{ color: theme.danger, fontSize: 14, marginBottom: 12 }}>{err}</Text> : null}
      <GoldButton label="Save payment" onPress={submit} loading={saving} />
    </BottomSheet>
  )
}
