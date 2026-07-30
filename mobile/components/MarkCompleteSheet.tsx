// mobile/components/MarkCompleteSheet.tsx, close out a job.
// Mirrors web src/components/MarkCompleteSheet.tsx: confirm the final
// contract amount, mark the job `closed`, and optionally record a final
// payment in one step.
import { useEffect, useState } from 'react'
import { View, Text, Pressable } from 'react-native'
import { useUpdateJob, useUpdateStage, useLogPayment } from '../lib/queries'
import { BottomSheet, SheetField, GoldButton, theme } from './ui'

const METHODS = ['cash', 'check', 'ach', 'card']

type Props = {
  open: boolean; onClose: () => void; userId: string; contactId: string
  currentAmount?: number | null; balance?: number | null
}

export function MarkCompleteSheet({ open, onClose, userId, contactId, currentAmount, balance }: Props) {
  const updateJob = useUpdateJob()
  const updateStage = useUpdateStage()
  const logPayment = useLogPayment()

  const [finalAmount, setFinalAmount] = useState('')
  const [recordPay, setRecordPay] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [method, setMethod] = useState('check')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) return
    setFinalAmount(currentAmount ? String(Math.round(currentAmount)) : '')
    setRecordPay(false)
    setPayAmount(balance && balance > 0 ? String(Math.round(balance)) : '')
    setMethod('check'); setErr(null)
  }, [open, currentAmount, balance])

  async function submit() {
    if (saving) return
    setSaving(true); setErr(null)
    const amt = finalAmount.trim() ? Number(finalAmount.replace(/[^0-9.]/g, '')) : undefined
    if (amt != null && !isNaN(amt) && amt !== Number(currentAmount || 0)) {
      const { error } = await updateJob({ contactId, amount: amt })
      if (error) { setSaving(false); setErr(error.message); return }
    }
    if (recordPay) {
      const pay = Number(payAmount.replace(/[^0-9.]/g, ''))
      if (pay > 0) {
        const { error } = await logPayment({ contactId, userId, amount: pay, method })
        if (error) { setSaving(false); setErr(error.message); return }
      }
    }
    const { error } = await updateStage({ contactId, stage: 'closed' })
    setSaving(false)
    if (error) { setErr(error.message); return }
    onClose()
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Mark complete">
      <Text style={{ color: theme.inkMuted, fontSize: 14, marginBottom: 16 }}>Confirm the final contract amount and close this job out.</Text>
      <SheetField label="Final amount ($)" value={finalAmount} onChange={setFinalAmount} keyboardType="numeric" placeholder="0" />

      <Pressable onPress={() => setRecordPay((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: recordPay ? 14 : 18 }}>
        <View style={{ width: 22, height: 22, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: recordPay ? theme.goldBright : theme.borderMid, backgroundColor: recordPay ? theme.goldBright : 'transparent' }}>
          {recordPay ? <Text style={{ color: theme.onGold, fontSize: 14, fontWeight: '900' }}>✓</Text> : null}
        </View>
        <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }}>Record a final payment</Text>
      </Pressable>

      {recordPay ? (
        <>
          <SheetField label="Payment amount ($)" value={payAmount} onChange={setPayAmount} keyboardType="numeric" placeholder="0" />
          <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 8 }}>Method</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
            {METHODS.map((m) => {
              const on = method === m
              return (
                <Pressable key={m} onPress={() => setMethod(m)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: on ? theme.goldBright : theme.borderMid, backgroundColor: on ? `${theme.goldBright}26` : theme.bg }}>
                  <Text style={{ color: on ? theme.goldBright : theme.inkMuted, fontSize: 14, fontWeight: '700', textTransform: 'uppercase' }}>{m}</Text>
                </Pressable>
              )
            })}
          </View>
        </>
      ) : null}

      {err ? <Text style={{ color: theme.danger, fontSize: 14, marginBottom: 12 }}>{err}</Text> : null}
      <GoldButton label="Mark job complete" onPress={submit} loading={saving} />
    </BottomSheet>
  )
}
