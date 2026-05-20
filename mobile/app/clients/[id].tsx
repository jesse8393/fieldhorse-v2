// mobile/app/clients/[id].tsx — Client detail.
// Stack route pushed from the Clients roster. Shows the client header
// (lifetime value / active jobs), contact actions (call / email), and
// the list of jobs linked to this client — each tappable through to the
// job detail. Reuses the shared useClientDetail() hook.
import { useMemo } from 'react'
import { View, Text, ScrollView, Pressable, ActivityIndicator, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { ChevronLeft, Phone, Mail } from 'lucide-react-native'
import { useClientDetail } from '../../lib/queries'

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
  const { id } = useLocalSearchParams<{ id: string }>()
  const { data, isPending } = useClientDetail(id)

  const client = data?.client ?? null
  const jobs = data?.jobs ?? []

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
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <Pressable onPress={() => router.back()} className="flex-row items-center mb-4" style={{ gap: 4 }}>
          <ChevronLeft color="#E8B865" size={20} />
          <Text className="text-gold-bright font-bold">Clients</Text>
        </Pressable>

        <Text className="text-ink text-3xl font-bold" numberOfLines={2}>{client.name || 'Unnamed'}</Text>
        {client.company_name ? <Text className="text-ink-muted text-sm mt-1">{client.company_name}</Text> : null}

        {/* Rollups */}
        <View className="flex-row mt-5" style={{ gap: 10 }}>
          <Stat label="Lifetime" value={money(totals.lifetime)} tone="#E8B865" />
          <Stat label="Active jobs" value={String(totals.active)} />
          <Stat label="Total jobs" value={String(jobs.length)} />
        </View>

        {/* Contact actions */}
        {(client.phone || client.email) && (
          <View className="flex-row mt-4" style={{ gap: 10 }}>
            {client.phone ? (
              <Action icon={<Phone color="#E8B865" size={16} />} label="Call" onPress={() => Linking.openURL(`tel:${client.phone}`)} />
            ) : null}
            {client.email ? (
              <Action icon={<Mail color="#E8B865" size={16} />} label="Email" onPress={() => Linking.openURL(`mailto:${client.email}`)} />
            ) : null}
          </View>
        )}

        {client.address ? (
          <>
            <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-7 mb-2">Address</Text>
            <Text className="text-ink text-sm">{client.address}</Text>
          </>
        ) : null}

        {client.notes ? (
          <>
            <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-7 mb-2">Notes</Text>
            <Text className="text-ink text-sm">{client.notes}</Text>
          </>
        ) : null}

        {/* Jobs */}
        <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-7 mb-3">Jobs</Text>
        {jobs.length === 0 ? (
          <Text className="text-ink-muted text-sm">No jobs linked to this client.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {jobs.map((j) => {
              const tint = STAGE_TINT[j.stage ?? ''] ?? '#5C5C5C'
              return (
                <Pressable
                  key={j.id}
                  onPress={() => router.push(`/jobs/${j.id}`)}
                  className="bg-surface rounded-2xl p-4 border border-[rgba(255,240,210,0.06)] flex-row items-center"
                  style={{ gap: 12 }}
                >
                  <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 3, backgroundColor: tint }} />
                  <View className="flex-1">
                    <Text className="text-ink text-base font-bold" numberOfLines={1}>{j.name || 'Untitled'}</Text>
                    <Text className="text-ink-muted text-xs mt-1" numberOfLines={1}>{j.job_title || j.job_type || '—'}</Text>
                  </View>
                  <View className="items-end">
                    <Text className="text-gold-bright text-base font-bold">{money(Number(j.amount || 0))}</Text>
                    <Text className="text-[9px] font-bold uppercase tracking-wider mt-1" style={{ color: tint }}>{j.stage}</Text>
                  </View>
                </Pressable>
              )
            })}
          </View>
        )}
      </ScrollView>
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
