// mobile/components/PaymentSheet.tsx, record a payment against a job.
// Mirrors web src/components/V3PaymentSheet.tsx: amount, method
// (cash/check/ACH/card), and date. Used by invoice detail and job detail.
import { useEffect, useState } from 'react'
import { View, Text, Pressable } from 'react-native'
import { useLogPayment } from '../lib/queries'
import { BottomSheet, SheetField, GoldButton, theme } from './ui'

const METHODS = ['cash', 'check', 'ach', 'card']

function today() { return new Date().toISOString().slice(0, 10) }

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
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setAmount(balance && balance > 0 ? String(Math.round(balance)) : '')
    setMethod('check'); setDate(today()); setErr(null)
  }, [open, balance])

  async function submit() {
    if (saving) return
    const amt = Number(amount.replace(/[^0-9.]/g, ''))
    if (!amt || isNaN(amt) || amt <= 0) { setErr('Enter a payment amount.'); return }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date.trim())) { setErr('Use date year month day.'); return }
    setSaving(true); setErr(null)
    const { error } = await logPayment({ contactId, userId, amount: amt, method, paidOn: date.trim() })
    setSaving(false)
    if (error) { setErr(error.message); return }
    onClose()
    onLogged?.()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Record payment">
      {balance != null && balance > 0 ? (
        <Text style={{ color: theme.inkMuted, fontSize: 14, marginBottom: 14 }}>Balance: ${Math.round(balance).toLocaleString()}</Text>
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
