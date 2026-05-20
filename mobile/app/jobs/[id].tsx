// mobile/app/jobs/[id].tsx — Job detail.
// Stack route pushed from the Jobs list / Home recent jobs. Shows the
// contact header (amount / paid / balance), client contact actions,
// a Log Payment flow, and the payments + schedule lists. Reuses the
// shared useJobDetail() + useLogPayment() hooks.
import { useMemo, useState } from 'react'
import {
  View, Text, ScrollView, Pressable, TextInput, ActivityIndicator,
  Modal, KeyboardAvoidingView, Platform, Linking
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, Phone, Mail, Plus, Pencil } from 'lucide-react-native'
import { useJobDetail, useLogPayment, useUpdateStage, useUpdateJob } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'

const STAGE_TINT: Record<string, string> = {
  lead: '#6B7CA8', quote: '#B07A4A', job: '#4F8C5E',
  invoice: '#C9963A', closed: '#5C5C5C', lost: '#7d2a1f'
}

const STAGES = ['lead', 'quote', 'job', 'invoice', 'closed', 'lost'] as const

function money(n: number) {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function JobDetailScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, isPending } = useJobDetail(id)
  const logPayment = useLogPayment()
  const updateStage = useUpdateStage()
  const updateJob = useUpdateJob()

  const [payOpen, setPayOpen] = useState(false)
  const [payAmount, setPayAmount] = useState('')
  const [paySaving, setPaySaving] = useState(false)
  const [stageSaving, setStageSaving] = useState<string | null>(null)

  const [editOpen, setEditOpen] = useState(false)
  const [editName, setEditName] = useState('')
  const [editTitle, setEditTitle] = useState('')
  const [editPhone, setEditPhone] = useState('')
  const [editEmail, setEditEmail] = useState('')
  const [editAmount, setEditAmount] = useState('')
  const [editSaving, setEditSaving] = useState(false)

  function openEdit() {
    if (!contact) return
    setEditName(contact.name || '')
    setEditTitle(contact.job_title || '')
    setEditPhone(contact.phone || '')
    setEditEmail(contact.email || '')
    setEditAmount(contact.amount != null ? String(contact.amount) : '')
    setEditOpen(true)
  }

  async function submitEdit() {
    if (!contact || editSaving) return
    setEditSaving(true)
    const amt = editAmount.trim() === '' ? null : Number(editAmount.replace(/[^0-9.]/g, ''))
    const { error } = await updateJob({
      contactId: contact.id,
      name: editName.trim(),
      jobTitle: editTitle.trim() || null,
      phone: editPhone.trim() || null,
      email: editEmail.trim() || null,
      amount: amt
    })
    setEditSaving(false)
    if (!error) setEditOpen(false)
  }

  const contact = data?.contact ?? null
  const payments = data?.payments ?? []

  const totals = useMemo(() => {
    const amount = Number(contact?.amount || 0)
    const paid = payments.reduce((s, p) => s + Number(p.amount || 0), 0)
    return { amount, paid, balance: Math.max(0, amount - paid) }
  }, [contact, payments])

  async function changeStage(next: string) {
    if (!contact || next === contact.stage || stageSaving) return
    setStageSaving(next)
    await updateStage({ contactId: contact.id, stage: next })
    setStageSaving(null)
  }

  async function submitPayment() {
    const amt = Number(payAmount.replace(/[^0-9.]/g, ''))
    if (!amt || !contact || !user) return
    setPaySaving(true)
    const { error } = await logPayment({ contactId: contact.id, userId: user.id, amount: amt })
    setPaySaving(false)
    if (!error) {
      setPayOpen(false)
      setPayAmount('')
    }
  }

  if (isPending) {
    return (
      <View className="flex-1 bg-bg items-center justify-center"><ActivityIndicator color="#E8B865" /></View>
    )
  }
  if (!contact) {
    return (
      <View className="flex-1 bg-bg items-center justify-center px-6" style={{ paddingTop: insets.top }}>
        <Pressable onPress={() => router.back()}><Text className="text-gold-bright font-bold">← Back</Text></Pressable>
        <Text className="text-ink-muted mt-4">Job not found.</Text>
      </View>
    )
  }

  const tint = STAGE_TINT[contact.stage] ?? '#5C5C5C'

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <View className="flex-row items-center justify-between mb-4">
          <Pressable onPress={() => router.back()} className="flex-row items-center" style={{ gap: 4 }}>
            <ChevronLeft color="#E8B865" size={20} />
            <Text className="text-gold-bright font-bold">Jobs</Text>
          </Pressable>
          <Pressable onPress={openEdit} className="flex-row items-center" style={{ gap: 4 }} hitSlop={8}>
            <Pencil color="#E8B865" size={16} />
            <Text className="text-gold-bright font-bold">Edit</Text>
          </Pressable>
        </View>

        <Text className="text-ink text-3xl font-bold" numberOfLines={2}>{contact.name || 'Untitled'}</Text>
        <Text className="text-xs font-bold uppercase tracking-wider mt-1" style={{ color: tint }}>{contact.stage}</Text>
        {contact.job_title || contact.job_type ? (
          <Text className="text-ink-muted text-sm mt-1">{contact.job_title || contact.job_type}</Text>
        ) : null}

        {/* Money summary */}
        <View className="flex-row mt-5" style={{ gap: 10 }}>
          <Stat label="Contract" value={money(totals.amount)} />
          <Stat label="Paid" value={money(totals.paid)} tone="#4ade80" />
          <Stat label="Balance" value={money(totals.balance)} tone="#E8B865" />
        </View>

        {/* Stage progression */}
        <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-6 mb-2">Stage</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {STAGES.map((s) => {
            const active = contact.stage === s
            const chipTint = STAGE_TINT[s]
            return (
              <Pressable
                key={s}
                onPress={() => changeStage(s)}
                disabled={!!stageSaving}
                className="rounded-full px-3.5 py-2 border flex-row items-center"
                style={{
                  gap: 6,
                  borderColor: active ? chipTint : 'rgba(255,240,210,0.12)',
                  backgroundColor: active ? chipTint : 'transparent'
                }}
              >
                {stageSaving === s ? <ActivityIndicator size="small" color="#1A120A" /> : null}
                <Text
                  className="text-xs font-bold uppercase tracking-wider"
                  style={{ color: active ? '#1A120A' : '#9b948a' }}
                >
                  {s}
                </Text>
              </Pressable>
            )
          })}
        </View>

        {/* Contact actions */}
        {(contact.phone || contact.email) && (
          <View className="flex-row mt-4" style={{ gap: 10 }}>
            {contact.phone ? (
              <Action icon={<Phone color="#E8B865" size={16} />} label="Call" onPress={() => Linking.openURL(`tel:${contact.phone}`)} />
            ) : null}
            {contact.email ? (
              <Action icon={<Mail color="#E8B865" size={16} />} label="Email" onPress={() => Linking.openURL(`mailto:${contact.email}`)} />
            ) : null}
          </View>
        )}

        {/* Log payment */}
        <Pressable
          onPress={() => setPayOpen(true)}
          className="flex-row items-center justify-center rounded-2xl py-3.5 mt-5"
          style={{ gap: 6, backgroundColor: '#E8B865' }}
        >
          <Plus color="#1A120A" size={16} />
          <Text className="text-[#1A120A] font-bold">Log payment</Text>
        </Pressable>

        {/* Payments */}
        <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-7 mb-3">Payments</Text>
        {payments.length === 0 ? (
          <Text className="text-ink-muted text-sm">No payments logged.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {payments.map((p) => (
              <View key={p.id} className="bg-surface rounded-xl p-3 border border-[rgba(255,240,210,0.06)] flex-row justify-between">
                <Text className="text-ink-muted text-sm">
                  {p.paid_on ? new Date(p.paid_on).toLocaleDateString() : '—'} · {p.method || 'payment'}
                </Text>
                <Text className="text-ink font-bold">{money(Number(p.amount || 0))}</Text>
              </View>
            ))}
          </View>
        )}
      </ScrollView>

      {/* Edit job modal */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setEditOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-5">Edit job</Text>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Name</Text>
            <TextInput
              value={editName}
              onChangeText={setEditName}
              placeholder="Homeowner or company"
              placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Job title</Text>
            <TextInput
              value={editTitle}
              onChangeText={setEditTitle}
              placeholder="Kitchen remodel, roof…"
              placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <View className="flex-row mb-4" style={{ gap: 12 }}>
              <View className="flex-1">
                <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Phone</Text>
                <TextInput
                  value={editPhone}
                  onChangeText={setEditPhone}
                  keyboardType="phone-pad"
                  placeholder="(555) 555-5555"
                  placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                />
              </View>
              <View className="flex-1">
                <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Value</Text>
                <TextInput
                  value={editAmount}
                  onChangeText={setEditAmount}
                  keyboardType="decimal-pad"
                  placeholder="$0"
                  placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                />
              </View>
            </View>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Email</Text>
            <TextInput
              value={editEmail}
              onChangeText={setEditEmail}
              keyboardType="email-address"
              autoCapitalize="none"
              placeholder="name@email.com"
              placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-5"
            />
            <Pressable
              onPress={submitEdit}
              disabled={editSaving}
              className="rounded-xl py-4 items-center"
              style={{ backgroundColor: editSaving ? 'rgba(232,184,101,0.5)' : '#E8B865' }}
            >
              {editSaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Save changes</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>

      {/* Log payment modal */}
      <Modal visible={payOpen} transparent animationType="slide" onRequestClose={() => setPayOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setPayOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-1">Log a payment</Text>
            <Text className="text-ink-muted text-sm mb-5">Balance: {money(totals.balance)}</Text>
            <TextInput
              value={payAmount}
              onChangeText={setPayAmount}
              keyboardType="decimal-pad"
              placeholder="$0"
              placeholderTextColor="rgba(242,237,228,0.4)"
              autoFocus
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink text-2xl font-bold mb-5"
            />
            <Pressable
              onPress={submitPayment}
              disabled={paySaving}
              className="rounded-xl py-4 items-center"
              style={{ backgroundColor: paySaving ? 'rgba(232,184,101,0.5)' : '#E8B865' }}
            >
              {paySaving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Save payment</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

function Stat({ label, value, tone = '#F2EDE4' }: { label: string; value: string; tone?: string }) {
  return (
    <View className="flex-1 bg-surface rounded-2xl p-3 border border-[rgba(255,240,210,0.06)]">
      <Text className="text-lg font-bold" style={{ color: tone }} numberOfLines={1}>{value}</Text>
      <Text className="text-ink-muted text-[10px] font-semibold mt-1">{label}</Text>
    </View>
  )
}

function Action({ icon, label, onPress }: { icon: import('react').ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      className="flex-1 flex-row items-center justify-center rounded-xl py-3 border border-[rgba(232,184,101,0.3)]"
      style={{ gap: 6, backgroundColor: 'rgba(232,184,101,0.10)' }}
    >
      {icon}
      <Text className="text-gold-bright font-bold">{label}</Text>
    </Pressable>
  )
}
