// mobile/app/clients/[id].tsx — Client detail.
// Stack route pushed from the Clients roster. Shows the client header
// (lifetime value / active jobs), contact actions (call / email), and
// the list of jobs linked to this client — each tappable through to the
// job detail. Reuses the shared useClientDetail() hook.
import { useMemo, useState } from 'react'
import {
  View, Text, ScrollView, Pressable, ActivityIndicator, Linking,
  Modal, KeyboardAvoidingView, Platform, TextInput, Alert
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, Phone, Mail, Pencil, Trash2 } from 'lucide-react-native'
import { useClientDetail, useUpdateClient, useDeleteClient } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground, Card, GoldButton, StagePill, theme } from '../../components/ui'

const STAGE_TINT: Record<string, string> = {
  lead: '#6B7CA8', quote: '#B07A4A', job: '#4F8C5E',
  invoice: '#C9963A', closed: '#5C5C5C', lost: '#7d2a1f'
}
const ACTIVE = new Set(['lead', 'quote', 'job', 'invoice'])

function money(n: number) {
  return Number(n || 0).toLocaleString(undefined, { style: 'currency', currency: 'USD', maximumFractionDigits: 0 })
}

export default function ClientDetailScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, isPending } = useClientDetail(id)
  const updateClient = useUpdateClient()
  const deleteClient = useDeleteClient()

  const client = data?.client ?? null
  const jobs = data?.jobs ?? []

  const [editOpen, setEditOpen] = useState(false)
  const [eName, setEName] = useState('')
  const [eCompany, setECompany] = useState('')
  const [ePhone, setEPhone] = useState('')
  const [eEmail, setEEmail] = useState('')
  const [eAddress, setEAddress] = useState('')
  const [eNotes, setENotes] = useState('')
  const [eSaving, setESaving] = useState(false)

  function openEdit() {
    if (!client) return
    setEName(client.name || '')
    setECompany(client.company_name || '')
    setEPhone(client.phone || '')
    setEEmail(client.email || '')
    setEAddress(client.address || '')
    setENotes(client.notes || '')
    setEditOpen(true)
  }

  async function submitEdit() {
    if (!client || !user || eSaving) return
    setESaving(true)
    const { error } = await updateClient({
      clientId: client.id, userId: user.id,
      name: eName.trim(), companyName: eCompany.trim() || null,
      phone: ePhone.trim() || null, email: eEmail.trim() || null,
      address: eAddress.trim() || null, notes: eNotes.trim() || null
    })
    setESaving(false)
    if (!error) setEditOpen(false)
  }

  function confirmDelete() {
    if (!client || !user) return
    Alert.alert('Delete client?', 'This removes the client record. Their jobs are kept but unlinked. This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          const { error } = await deleteClient({ id: client.id, userId: user.id })
          if (!error) { setEditOpen(false); router.back() }
        }
      }
    ])
  }

  const totals = useMemo(() => {
    const lifetime = jobs.reduce((s, j) => s + Number(j.amount || 0), 0)
    const active = jobs.filter((j) => j.stage && ACTIVE.has(j.stage)).length
    return { lifetime, active }
  }, [jobs])

  if (isPending) {
    return <View className="flex-1 bg-bg items-center justify-center"><ActivityIndicator color="#E8B865" /></View>
  }
  if (!client) {
    return (
      <View className="flex-1 bg-bg items-center justify-center px-6" style={{ paddingTop: insets.top }}>
        <Pressable onPress={() => router.back()}><Text className="text-gold-bright font-bold">← Back</Text></Pressable>
        <Text className="text-ink-muted mt-4">Client not found.</Text>
      </View>
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
          <Pressable onPress={() => router.back()} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} hitSlop={10}>
            <ChevronLeft color={theme.goldBright} size={20} />
            <Text style={{ color: theme.goldBright, fontWeight: '700' }}>Clients</Text>
          </Pressable>
          <Pressable onPress={openEdit} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} hitSlop={8}>
            <Pencil color={theme.goldBright} size={16} />
            <Text style={{ color: theme.goldBright, fontWeight: '700' }}>Edit</Text>
          </Pressable>
        </View>

        <Text style={{ color: theme.ink, fontSize: 30, fontWeight: '800', letterSpacing: -0.5 }} numberOfLines={2}>{client.name || 'Unnamed'}</Text>
        {client.company_name ? <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 2 }}>{client.company_name}</Text> : null}

        {/* Rollups */}
        <View style={{ flexDirection: 'row', marginTop: 18, gap: 10 }}>
          <Stat label="Lifetime" value={money(totals.lifetime)} tone={theme.goldBright} glow />
          <Stat label="Active jobs" value={String(totals.active)} />
          <Stat label="Total jobs" value={String(jobs.length)} />
        </View>

        {/* Contact actions */}
        {(client.phone || client.email) && (
          <View style={{ flexDirection: 'row', marginTop: 14, gap: 10 }}>
            {client.phone ? (
              <Action icon={<Phone color={theme.goldBright} size={16} />} label="Call" onPress={() => Linking.openURL(`tel:${client.phone}`)} />
            ) : null}
            {client.email ? (
              <Action icon={<Mail color={theme.goldBright} size={16} />} label="Email" onPress={() => Linking.openURL(`mailto:${client.email}`)} />
            ) : null}
          </View>
        )}

        {client.address ? (
          <>
            <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginTop: 28, marginBottom: 8 }}>Address</Text>
            <Text style={{ color: theme.ink, fontSize: 14 }}>{client.address}</Text>
          </>
        ) : null}

        {client.notes ? (
          <>
            <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginTop: 28, marginBottom: 8 }}>Notes</Text>
            <Text style={{ color: theme.ink, fontSize: 14 }}>{client.notes}</Text>
          </>
        ) : null}

        {/* Jobs */}
        <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginTop: 28, marginBottom: 12 }}>Jobs</Text>
        {jobs.length === 0 ? (
          <Text style={{ color: theme.inkMuted, fontSize: 14 }}>No jobs linked to this client.</Text>
        ) : (
          <View style={{ gap: 10 }}>
            {jobs.map((j) => {
              const tint = STAGE_TINT[j.stage ?? ''] ?? '#3a352e'
              return (
                <Pressable key={j.id} onPress={() => router.push(`/jobs/${j.id}`)}>
                  <Card accent={tint}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, paddingLeft: 18 }}>
                      <View style={{ flex: 1, paddingRight: 12 }}>
                        <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{j.name || 'Untitled'}</Text>
                        <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 3 }} numberOfLines={1}>{j.job_title || j.job_type || '—'}</Text>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: theme.goldBright, fontSize: 16, fontWeight: '800' }}>{money(Number(j.amount || 0))}</Text>
                        {j.stage ? <View style={{ marginTop: 5 }}><StagePill stage={j.stage} /></View> : null}
                      </View>
                    </View>
                  </Card>
                </Pressable>
              )
            })}
          </View>
        )}
      </ScrollView>

      {/* Edit client modal */}
      <Modal visible={editOpen} transparent animationType="slide" onRequestClose={() => setEditOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setEditOpen(false)} />
          <ScrollView
            className="bg-surface rounded-t-3xl border-t border-[rgba(255,240,210,0.10)]"
            contentContainerStyle={{ padding: 24, paddingBottom: insets.bottom + 24 }}
            style={{ maxHeight: '85%' }}
          >
            <Text className="text-ink text-xl font-bold mb-5">Edit client</Text>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Name</Text>
            <TextInput
              value={eName} onChangeText={setEName}
              placeholder="Client name" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Company</Text>
            <TextInput
              value={eCompany} onChangeText={setECompany}
              placeholder="Company (optional)" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <View className="flex-row mb-4" style={{ gap: 12 }}>
              <View className="flex-1">
                <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Phone</Text>
                <TextInput
                  value={ePhone} onChangeText={setEPhone} keyboardType="phone-pad"
                  placeholder="(555) 555-5555" placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                />
              </View>
            </View>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Email</Text>
            <TextInput
              value={eEmail} onChangeText={setEEmail} keyboardType="email-address" autoCapitalize="none"
              placeholder="name@email.com" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Address</Text>
            <TextInput
              value={eAddress} onChangeText={setEAddress}
              placeholder="Job site or billing address" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Notes</Text>
            <TextInput
              value={eNotes} onChangeText={setENotes} multiline
              placeholder="Anything worth remembering" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-5"
              style={{ minHeight: 72, textAlignVertical: 'top' }}
            />
            <GoldButton label="Save changes" onPress={submitEdit} loading={eSaving} />
            <Pressable
              onPress={confirmDelete}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14, paddingVertical: 14, marginTop: 12, borderWidth: 1, borderColor: 'rgba(232,90,87,0.3)', backgroundColor: 'rgba(232,90,87,0.10)' }}
            >
              <Trash2 color={theme.danger} size={16} />
              <Text style={{ color: theme.danger, fontWeight: '700' }}>Delete client</Text>
            </Pressable>
          </ScrollView>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

function Stat({ label, value, tone = '#F2EDE4', glow }: { label: string; value: string; tone?: string; glow?: boolean }) {
  return (
    <Card glow={glow} style={{ flex: 1 }}>
      <View style={{ padding: 14 }}>
        <Text style={{ fontSize: 18, fontWeight: '800', color: tone }} numberOfLines={1}>{value}</Text>
        <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '600', marginTop: 4 }}>{label}</Text>
      </View>
    </Card>
  )
}

function Action({ icon, label, onPress }: { icon: import('react').ReactNode; label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 14, paddingVertical: 13, borderWidth: 1, borderColor: 'rgba(232,184,101,0.3)', backgroundColor: 'rgba(232,184,101,0.10)' }}
    >
      {icon}
      <Text style={{ color: theme.goldBright, fontWeight: '700' }}>{label}</Text>
    </Pressable>
  )
}
