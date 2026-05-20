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
import { LinearGradient } from 'expo-linear-gradient'
import { Plus } from 'lucide-react-native'
import { useClientsBundle, useCreateClient, type Client } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground, Card, Eyebrow, GoldButton, theme } from '../../components/ui'

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
    <View style={{ flex: 1, paddingTop: insets.top + 10 }}>
      <ScreenBackground />
      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <Eyebrow>Clients</Eyebrow>
        <Text style={{ color: theme.ink, fontSize: 34, fontWeight: '800', letterSpacing: -0.5 }}>Roster</Text>
      </View>

      <View style={{ paddingHorizontal: 20, paddingBottom: 12 }}>
        <TextInput
          value={search}
          onChangeText={setSearch}
          placeholder="Search clients…"
          placeholderTextColor={theme.inkFaint}
          style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, color: theme.ink, fontSize: 15 }}
        />
      </View>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={theme.goldBright} /></View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100, gap: 10 }}
          renderItem={({ item }) => (
            <ClientCard client={item} roll={rollups.get(item.id)} onPress={() => router.push(`/clients/${item.id}`)} />
          )}
          ListEmptyComponent={<Text style={{ color: theme.inkMuted, textAlign: 'center', marginTop: 48 }}>No clients yet.</Text>}
        />
      )}

      {/* Floating add button */}
      <Pressable
        onPress={() => setAddOpen(true)}
        style={{
          position: 'absolute', right: 20, bottom: insets.bottom + 20, borderRadius: 999,
          shadowColor: '#E8B865', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12
        }}
      >
        <LinearGradient colors={['#F0CE86', '#E4BE6F', '#C9963A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 58, height: 58, borderRadius: 999, alignItems: 'center', justifyContent: 'center' }}>
          <Plus color={theme.onGold} size={26} strokeWidth={2.8} />
        </LinearGradient>
      </Pressable>

      {/* New client modal */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setAddOpen(false)} />
          <View style={{ backgroundColor: theme.surface2, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderTopWidth: 1, borderColor: theme.borderMid, paddingBottom: insets.bottom + 24 }}>
            <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', marginBottom: 20 }}>New client</Text>
            <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Name</Text>
            <TextInput
              value={cName} onChangeText={setCName} autoFocus
              placeholder="Client name" placeholderTextColor={theme.inkFaint}
              style={{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, color: theme.ink, marginBottom: 16 }}
            />
            <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Company (optional)</Text>
            <TextInput
              value={cCompany} onChangeText={setCCompany}
              placeholder="Company" placeholderTextColor={theme.inkFaint}
              style={{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, color: theme.ink, marginBottom: 16 }}
            />
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 20 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Phone</Text>
                <TextInput
                  value={cPhone} onChangeText={setCPhone} keyboardType="phone-pad"
                  placeholder="(555) 555-5555" placeholderTextColor={theme.inkFaint}
                  style={{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, color: theme.ink }}
                />
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Email</Text>
                <TextInput
                  value={cEmail} onChangeText={setCEmail} keyboardType="email-address" autoCapitalize="none"
                  placeholder="name@email.com" placeholderTextColor={theme.inkFaint}
                  style={{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, color: theme.ink }}
                />
              </View>
            </View>
            <GoldButton label="Create client" onPress={submitClient} loading={saving} />
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}

function ClientCard({ client, roll, onPress }: { client: Client; roll?: Roll; onPress: () => void }) {
  const initial = (client.name || '·').trim().charAt(0).toUpperCase()
  return (
    <Pressable onPress={onPress}>
      <Card>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
          <LinearGradient
            colors={['#2A2118', '#1B1612']}
            style={{ width: 46, height: 46, borderRadius: 13, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'rgba(232,184,101,0.28)' }}
          >
            <Text style={{ color: theme.goldBright, fontSize: 18, fontWeight: '800' }}>{initial}</Text>
          </LinearGradient>
          <View style={{ flex: 1 }}>
            <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{client.name || 'Unnamed'}</Text>
            <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 3 }} numberOfLines={1}>
              {client.company_name || client.email || client.phone || '—'}
            </Text>
          </View>
          <View style={{ alignItems: 'flex-end' }}>
            <Text style={{ color: theme.goldBright, fontSize: 16, fontWeight: '800' }}>{money(roll?.lifetime || 0)}</Text>
            <Text style={{ color: theme.inkMuted, fontSize: 10, marginTop: 2 }}>{roll?.active || 0} active</Text>
          </View>
        </View>
      </Card>
    </Pressable>
  )
}
