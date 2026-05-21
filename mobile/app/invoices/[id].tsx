// mobile/app/invoices/[id].tsx — per-job billing detail (the web
// InvoiceDetail). :id is a contact id. Contract / paid / balance with a
// payment history and a Collect Payment flow. PDF/email/public-link defer.
import { useState } from 'react'
import { View, Text, ScrollView, Pressable, ActivityIndicator, Modal, TextInput, Alert, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { DollarSign, Send, Briefcase } from 'lucide-react-native'
import { useInvoiceDetail, useLogPayment } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground, Card, ScreenHeader, theme } from '../../components/ui'

function money(n: number) { return `$${Math.round(n).toLocaleString()}` }

export default function InvoiceDetailScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, isPending } = useInvoiceDetail(id)
  const logPayment = useLogPayment()

  const [payOpen, setPayOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [method, setMethod] = useState('check')
  const [saving, setSaving] = useState(false)

  if (isPending) {
    return <View style={{ flex: 1 }}><ScreenBackground /><ActivityIndicator color={theme.goldBright} style={{ marginTop: insets.top + 80 }} /></View>
  }
  if (!data) {
    return (
      <View style={{ flex: 1 }}><ScreenBackground />
        <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingHorizontal: 20 }}>
          <ScreenHeader backLabel="Invoices" onBack={() => router.back()} eyebrow="Invoice" title="Not found" />
          <Text style={{ color: theme.inkMuted, marginTop: 20 }}>This invoice could not be loaded.</Text>
        </ScrollView>
      </View>
    )
  }

  const { contact, payments, amount: total, paid, balance, pctPaid, ageDays } = data
  const isClosed = (contact.stage || '').toLowerCase() === 'closed'
  const isPaid = balance < 0.5 && total > 0
  const status = isClosed ? { label: 'CLOSED', tint: theme.inkMuted }
    : isPaid ? { label: 'PAID', tint: theme.success }
    : ageDays > 60 ? { label: 'OVERDUE', tint: theme.danger }
    : { label: 'OUTSTANDING', tint: theme.goldBright }

  async function recordPayment() {
    const amt = parseFloat(amount.replace(/[^0-9.]/g, ''))
    if (!amt || !user) return
    setSaving(true)
    const { error } = await logPayment({ contactId: contact.id, userId: user.id, amount: amt, method })
    setSaving(false)
    if (error) { Alert.alert("Couldn't record payment", error.message); return }
    setAmount(''); setPayOpen(false)
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 120, paddingHorizontal: 20 }}>
        <ScreenHeader backLabel="Invoices" onBack={() => router.back()} eyebrow="Invoice" title={contact.name || 'Invoice'} />

        {/* Hero */}
        <Card glow style={{ marginTop: 16, marginBottom: 18 }}>
          <View style={{ padding: 20 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
              <View style={{ paddingHorizontal: 10, paddingVertical: 4, borderRadius: 999, borderWidth: 1, borderColor: `${status.tint}55`, backgroundColor: `${status.tint}1f` }}>
                <Text style={{ color: status.tint, fontSize: 10, fontWeight: '800', letterSpacing: 0.8 }}>{status.label}</Text>
              </View>
              {contact.jobTitle ? <Text style={{ color: theme.inkMuted, fontSize: 13 }} numberOfLines={1}>{contact.jobTitle}</Text> : null}
            </View>
            <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '700', letterSpacing: 1, textTransform: 'uppercase', marginTop: 16 }}>Balance due</Text>
            <Text style={{ color: theme.ink, fontSize: 42, fontWeight: '800', letterSpacing: -1, marginTop: 2 }}>{money(balance)}</Text>
            <View style={{ height: 7, borderRadius: 4, overflow: 'hidden', backgroundColor: 'rgba(255,240,210,0.06)', marginTop: 14 }}>
              <View style={{ width: `${pctPaid}%`, height: '100%', backgroundColor: theme.success }} />
            </View>
            <View style={{ flexDirection: 'row', justifyContent: 'space-between', marginTop: 8 }}>
              <Text style={{ color: theme.inkMuted, fontSize: 12 }}><Text style={{ color: theme.success, fontWeight: '700' }}>{money(paid)}</Text> paid</Text>
              <Text style={{ color: theme.inkMuted, fontSize: 12 }}>of {money(total)} · {Math.round(pctPaid)}%</Text>
            </View>
          </View>
        </Card>

        {/* Service line */}
        <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>Summary</Text>
        <Card style={{ marginBottom: 18 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 }}>
            <Text style={{ color: theme.ink, fontSize: 15, flex: 1 }} numberOfLines={2}>{contact.jobTitle || contact.name || 'Contract'}</Text>
            <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '800' }}>{money(total)}</Text>
          </View>
        </Card>

        {/* Payments */}
        <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 10 }}>Payments{payments.length ? ` · ${payments.length}` : ''}</Text>
        {payments.length === 0 ? (
          <Text style={{ color: theme.inkMuted, fontSize: 14, marginBottom: 18 }}>No payments recorded yet.</Text>
        ) : (
          <View style={{ gap: 10, marginBottom: 18 }}>
            {payments.map((p) => (
              <Card key={p.id} accent={theme.success}>
                <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, paddingLeft: 16 }}>
                  <View>
                    <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '700', textTransform: 'capitalize' }}>{p.method || 'Payment'}</Text>
                    <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 2 }}>{p.paidOn ? new Date(p.paidOn).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' }) : ''}{p.reference ? ` · ${p.reference}` : ''}</Text>
                  </View>
                  <Text style={{ color: theme.success, fontSize: 16, fontWeight: '800' }}>{money(p.amount)}</Text>
                </View>
              </Card>
            ))}
          </View>
        )}

        {/* Open job */}
        <Pressable onPress={() => router.push(`/jobs/${contact.id}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 10, padding: 16, borderRadius: 14, borderWidth: 1, borderColor: theme.borderMid, backgroundColor: 'rgba(255,240,210,0.04)' }}>
          <Briefcase color={theme.goldBright} size={16} />
          <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '600', flex: 1 }}>Open job</Text>
          <Text style={{ color: theme.goldBright, fontSize: 13, fontWeight: '700' }}>View</Text>
        </Pressable>
      </ScrollView>

      {/* Sticky action bar */}
      <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, flexDirection: 'row', gap: 10, paddingHorizontal: 20, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: 'rgba(11,9,7,0.92)', borderTopWidth: 1, borderTopColor: theme.border }}>
        {contact.email ? (
          <Pressable onPress={() => Linking.openURL(`mailto:${contact.email}?subject=${encodeURIComponent('Invoice — ' + (contact.name || ''))}&body=${encodeURIComponent(`Balance due: ${money(balance)}`)}`)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, paddingVertical: 13, borderWidth: 1, borderColor: theme.borderMid }}>
            <Send color={theme.ink} size={15} />
            <Text style={{ color: theme.ink, fontWeight: '700', fontSize: 14 }}>Email</Text>
          </Pressable>
        ) : null}
        <Pressable onPress={() => setPayOpen(true)} style={{ flex: 1.4, borderRadius: 12, overflow: 'hidden' }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, paddingVertical: 13, backgroundColor: theme.goldBright }}>
            <DollarSign color={theme.onGold} size={15} />
            <Text style={{ color: theme.onGold, fontWeight: '800', fontSize: 14 }}>Collect Payment</Text>
          </View>
        </Pressable>
      </View>

      {/* Payment modal */}
      <Modal visible={payOpen} transparent animationType="slide" onRequestClose={() => setPayOpen(false)}>
        <Pressable onPress={() => setPayOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: theme.surface2, borderTopLeftRadius: 24, borderTopRightRadius: 24, padding: 22, paddingBottom: insets.bottom + 20 }}>
            <Text style={{ color: theme.goldBright, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' }}>Record payment</Text>
            <Text style={{ color: theme.ink, fontSize: 22, fontWeight: '700', marginTop: 4, marginBottom: 18 }}>Collect on {contact.name || 'job'}</Text>
            <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Amount</Text>
            <TextInput value={amount} onChangeText={setAmount} placeholder={`Balance ${money(balance)}`} placeholderTextColor={theme.inkMuted} keyboardType="decimal-pad" autoFocus style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 13, color: theme.ink, fontSize: 20, fontWeight: '700', marginBottom: 14 }} />
            <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase', marginBottom: 6 }}>Method</Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginBottom: 20 }}>
              {['check', 'card', 'cash', 'ach', 'other'].map((m) => (
                <Pressable key={m} onPress={() => setMethod(m)} style={{ paddingHorizontal: 14, paddingVertical: 8, borderRadius: 999, borderWidth: 1, borderColor: method === m ? theme.goldBright : theme.borderMid, backgroundColor: method === m ? `${theme.goldBright}26` : 'transparent' }}>
                  <Text style={{ color: method === m ? theme.goldBright : theme.inkMuted, fontSize: 13, fontWeight: '700', textTransform: 'capitalize' }}>{m}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable onPress={recordPayment} disabled={!amount.trim() || saving} style={{ alignItems: 'center', paddingVertical: 14, borderRadius: 12, backgroundColor: theme.goldBright, opacity: !amount.trim() || saving ? 0.5 : 1 }}>
              <Text style={{ color: theme.onGold, fontWeight: '800', fontSize: 15 }}>{saving ? 'Recording…' : 'Record Payment'}</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}
