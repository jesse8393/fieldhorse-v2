// mobile/components/MarkCompleteSheet.tsx, close out a job.
// Record completed work without hiding an unpaid job from collections.
import { useEffect, useRef, useState } from 'react'
import { View, Text, Pressable } from 'react-native'
import { randomUUID } from 'expo-crypto'
import { useUpdateJob, useLogPayment } from '../lib/queries'
import { BottomSheet, SheetField, GoldButton, theme } from './ui'
import { moneyAmount, paymentAmount } from '../lib/paymentInput'

const METHODS = ['cash', 'check', 'ach', 'card']

type Props = {
  open: boolean; onClose: () => void; userId: string; contactId: string
  currentAmount?: number | null; balance?: number | null
}

export function MarkCompleteSheet({ open, onClose, userId, contactId, currentAmount, balance }: Props) {
  const updateJob = useUpdateJob()
  const logPayment = useLogPayment()

  const [finalAmount, setFinalAmount] = useState('')
  const [recordPay, setRecordPay] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [method, setMethod] = useState('check')
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)
  const openedFor = useRef<string | null>(null)
  const paymentId = useRef<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (!open) { openedFor.current = null; return }
    if (openedFor.current === contactId) return
    openedFor.current = contactId
    paymentId.current = null
    setFinalAmount(currentAmount != null ? currentAmount.toFixed(2) : '')
    setRecordPay(false)
    setPayAmount(balance && balance > 0 ? balance.toFixed(2) : '')
    setMethod('check'); setErr(null)
  }, [open, contactId, currentAmount, balance])

  async function submit() {
    if (savingRef.current) return
    const amt = finalAmount.trim() ? moneyAmount(finalAmount, { allowZero: true }) : undefined
    if (amt === null) { setErr('Enter a valid nonnegative contract amount.'); return }
    const pay = recordPay ? paymentAmount(payAmount) : null
    if (recordPay && pay === null) { setErr('Enter a valid positive payment amount.'); return }
    savingRef.current = true
    setSaving(true); setErr(null)
    let paymentSaved = false
    try {
      if (amt != null && amt !== Number(currentAmount || 0)) {
        const { error } = await updateJob({ contactId, amount: amt })
        if (error) { setErr(error.message); return }
      }
      if (recordPay && pay !== null) {
        paymentId.current ||= randomUUID()
        const { error } = await logPayment({ id: paymentId.current, contactId, userId, amount: pay, method })
        if (error) { setErr(error.message); return }
        paymentSaved = true
        // Retrying a refused completion must not repeat a confirmed payment.
        setRecordPay(false)
        setPayAmount('')
      }
      const { error } = await updateJob({ contactId, completedAt: new Date().toISOString() })
      if (error) { setErr(`${paymentSaved ? 'Payment saved. ' : ''}${error.message}`); return }
      onClose()
    } catch {
      setErr(`${paymentSaved ? 'Payment saved. ' : ''}Completion could not save. Please retry.`)
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  return (
    <BottomSheet open={open} onClose={() => { if (!savingRef.current) onClose() }} title="Mark complete">
      <Text style={{ color: theme.inkMuted, fontSize: 14, marginBottom: 16 }}>Confirm completed work and base amount. Approved changes remain included in balances.</Text>
      <SheetField label="Base contract amount ($)" value={finalAmount} onChange={setFinalAmount} editable={!saving} keyboardType="numeric" placeholder="0" />

      <Pressable disabled={saving} onPress={() => setRecordPay((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: recordPay ? 14 : 18 }}>
        <View style={{ width: 22, height: 22, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: recordPay ? theme.goldBright : theme.borderMid, backgroundColor: recordPay ? theme.goldBright : 'transparent' }}>
          {recordPay ? <Text style={{ color: theme.onGold, fontSize: 14, fontWeight: '900' }}>✓</Text> : null}
        </View>
        <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }}>Record a final payment</Text>
      </Pressable>

      {recordPay ? (
        <>
          <SheetField label="Payment amount ($)" value={payAmount} onChange={setPayAmount} editable={!saving} keyboardType="numeric" placeholder="0" />
          <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 8 }}>Method</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
            {METHODS.map((m) => {
              const on = method === m
              return (
                <Pressable key={m} disabled={saving} onPress={() => setMethod(m)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: on ? theme.goldBright : theme.borderMid, backgroundColor: on ? `${theme.goldBright}26` : theme.bg }}>
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
