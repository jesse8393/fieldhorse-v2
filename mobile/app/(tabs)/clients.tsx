// mobile/app/(tabs)/clients.tsx — Clients roster.
// Uses the shared useClientsBundle() hook (clients + jobs + payments)
// and computes per-client lifetime / active-count rollups natively —
// the same rollup math the web Clients screen uses.
import { useMemo, useState } from 'react'
import { View, Text, FlatList, TextInput, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useClientsBundle, type Client } from '../../lib/queries'
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
  const { user } = useAuth()
  const { data: bundle, isLoading } = useClientsBundle(user?.id)
  const [search, setSearch] = useState('')

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
          renderItem={({ item }) => <ClientCard client={item} roll={rollups.get(item.id)} />}
          ListEmptyComponent={<Text className="text-ink-muted text-center mt-12">No clients yet.</Text>}
        />
      )}
    </View>
  )
}

function ClientCard({ client, roll }: { client: Client; roll?: Roll }) {
  const initial = (client.name || '·').trim().charAt(0).toUpperCase()
  return (
    <View
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
    </View>
  )
}
