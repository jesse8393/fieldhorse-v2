// mobile/app/(tabs)/clients.tsx — Clients roster.
// Uses the shared useClientsBundle() hook (clients + jobs + payments)
// and computes per-client lifetime / active-count rollups natively —
// the same rollup math the web Clients screen uses.
import { useMemo, useState } from 'react'
import {
  View, Text, FlatList, TextInput, ActivityIndicator, Pressable,
  Modal, KeyboardAvoidingView, Platform
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Plus } from 'lucide-react-native'
import { useClientsBundle, useCreateClient, type Client } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'

const ACTIVE = new Set(['lead', 'quote', 'job', 'invoice'])

function money(n: number) {
  if (!n) return '$0'
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return `$${Math.round(n).toLocaleString()}`
}

type Roll = { lifetime: number; active: number }

export default function ClientsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data: bundle, isLoading } = useClientsBundle(user?.id)
  const createClient = useCreateClient()
  const [search, setSearch] = useState('')
  const [addOpen, setAddOpen] = useState(false)
  const [cName, setCName] = useState('')
  const [cCompany, setCCompany] = useState('')
  const [cPhone, setCPhone] = useState('')
  const [cEmail, setCEmail] = useState('')
  const [saving, setSaving] = useState(false)

  async function submitClient() {
    if (!cName.trim() || !user || saving) return
    setSaving(true)
    const { id, error } = await createClient({
      userId: user.id, name: cName.trim(),
      companyName: cCompany.trim() || undefined,
      phone: cPhone.trim() || undefined,
      email: cEmail.trim() || undefined
    })
    setSaving(false)
    if (!error) {
      setAddOpen(false)
      setCName(''); setCCompany(''); setCPhone(''); setCEmail('')
      if (id) router.push(`/clients/${id}`)
    }
  }

  const clients = bundle?.clients ?? []
  const jobs = bundle?.jobs ?? []

  const rollups = useMemo(() => {
    const map = new Map<string, Roll>()
    for (const j of jobs) {
      if (!j.client_id) continue
      const r = map.get(j.client_id) || { lifetime: 0, active: 0 }
      r.lifetime += Number(j.amount || 0)
      if (j.stage && ACTIVE.has(j.stage)) r.active += 1
      map.set(j.client_id, r)
    }
    return map
  }, [jobs])

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase()
    if (!q) return clients
    return clients.filter((c) =>
      [c.name, c.company_name, c.phone, c.email]
        .filter(Boolean)
        .some((s) => String(s).toLowerCase().includes(q))
    )
  }, [clients, search])

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-3">
        <Text className="text-gold-bright text-[10px] font-bold tracking-[2px] uppercase">Clients</Text>
        <Text className="text-ink text-3xl font-bold">Roster</Text>
      </View>

      <View className="px-5 pb-3">
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search clients…"
          placeholderTextColor="rgba(242,237,228,0.45)"
          className="bg-surface border border-[rgba(255,240,210,0.10)] rounded-xl px-4 py-3 text-ink"
        />
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#E8B865" /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24, gap: 8 }}
          renderItem={({ item }) => (
            <ClientCard client={item} roll={rollups.get(item.id)} onPress={() => router.push(`/clients/${item.id}`)} />
          )}
          ListEmptyComponent={<Text className="text-ink-muted text-center mt-12">No clients yet.</Text>}
        />
      )}

      {/* Floating add button */}
      <Pressable
        onPress={() => setAddOpen(true)}
        className="absolute items-center justify-center rounded-full"
        style={{
          right: 20, bottom: insets.bottom + 20, width: 56, height: 56,
          backgroundColor: '#E8B865', shadowColor: '#000', shadowOpacity: 0.4,
          shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8
        }}
      >
        <Plus color="#1A120A" size={26} strokeWidth={2.6} />
      </Pressable>

      {/* New client modal */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setAddOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-5">New client</Text>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Name</Text>
            <TextInput
              value={cName} onChangeText={setCName} autoFocus
              placeholder="Client name" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Company (optional)</Text>
            <TextInput
              value={cCompany} onChangeText={setCCompany}
              placeholder="Company" placeholderTextColor="rgba(242,237,228,0.4)"
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <View className="flex-row mb-5" style={{ gap: 12 }}>
              <View className="flex-1">
                <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Phone</Text>
                <TextInput
                  value={cPhone} onChangeText={setCPhone} keyboardType="phone-pad"
                  placeholder="(555) 555-5555" placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                />
              </View>
              <View className="flex-1">
                <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Email</Text>
                <TextInput
                  value={cEmail} onChangeText={setCEmail} keyboardType="email-address" autoCapitalize="none"
                  placeholder="name@email.com" placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                />
              </View>
            </View>
            <Pressable
              onPress={submitClient}
              disabled={saving}
              className="rounded-xl py-4 items-center"
              style={{ backgroundColor: saving ? 'rgba(232,184,101,0.5)' : '#E8B865' }}
            >
              {saving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Create client</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

function ClientCard({ client, roll, onPress }: { client: Client; roll?: Roll; onPress: () => void }) {
  const initial = (client.name || '·').trim().charAt(0).toUpperCase()
  return (
    <Pressable
      onPress={onPress}
      className="bg-surface rounded-2xl p-4 border border-[rgba(255,240,210,0.06)] flex-row items-center"
      style={{ gap: 12 }}
    >
      <View
        className="rounded-xl items-center justify-center"
        style={{ width: 44, height: 44, backgroundColor: '#1B1816', borderWidth: 1, borderColor: 'rgba(232,184,101,0.22)' }}
      >
        <Text className="text-gold-bright text-lg font-bold">{initial}</Text>
      </View>
      <View className="flex-1">
        <Text className="text-ink text-base font-bold" numberOfLines={1}>{client.name || 'Unnamed'}</Text>
        <Text className="text-ink-muted text-xs mt-1" numberOfLines={1}>
          {client.company_name || client.email || client.phone || '—'}
        </Text>
      </View>
      <View className="items-end">
        <Text className="text-gold-bright text-base font-bold">{money(roll?.lifetime || 0)}</Text>
        <Text className="text-ink-muted text-[10px] mt-1">{roll?.active || 0} active</Text>
      </View>
    </Pressable>
  )
}
