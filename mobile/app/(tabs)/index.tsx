// mobile/app/(tabs)/index.tsx — Home dashboard.
// Reuses the shared useJobs() hook (same as web) and derives the
// headline KPIs natively. No new query — the cross-screen cache means
// Jobs and Home share one fetch.
import { useMemo } from 'react'
import { View, Text, ScrollView, ActivityIndicator, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useJobs } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'

const ACTIVE = new Set(['lead', 'quote', 'job', 'invoice'])
const WON = new Set(['invoice', 'closed'])

function money(n: number) {
  if (!n) return '$0'
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return `$${Math.round(n).toLocaleString()}`
}

function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Morning'
  if (h < 18) return 'Afternoon'
  return 'Evening'
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data: jobs = [], isLoading } = useJobs()

  const stats = useMemo(() => {
    let pipeline = 0
    let won = 0
    let active = 0
    for (const j of jobs) {
      const amt = Number(j.amount || 0)
      if (ACTIVE.has(j.stage ?? '')) { pipeline += amt; active += 1 }
      if (WON.has(j.stage ?? '')) won += amt
    }
    return { pipeline, won, active }
  }, [jobs])

  const recent = jobs.slice(0, 5)

  return (
    <ScrollView
      className="flex-1 bg-bg"
      contentContainerStyle={{ paddingTop: insets.top + 12, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}
    >
      <Text className="text-gold-bright text-[10px] font-bold tracking-[2px] uppercase">{greeting()}</Text>
      <Text className="text-ink text-3xl font-bold mb-1" numberOfLines={1}>
        {user?.email?.split('@')[0] || 'there'}.
      </Text>
      <Text className="text-ink-muted text-sm mb-6">Here's the state of your pipeline.</Text>

      {isLoading ? (
        <View className="items-center justify-center py-16">
          <ActivityIndicator color="#E8B865" />
        </View>
      ) : (
        <>
          <View className="flex-row" style={{ gap: 10, marginBottom: 24 }}>
            <Kpi label="In pipeline" value={money(stats.pipeline)} tone="#E8B865" />
            <Kpi label="Won" value={money(stats.won)} tone="#4ade80" />
            <Kpi label="Active" value={String(stats.active)} tone="#F2EDE4" />
          </View>

          <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mb-3">Recent jobs</Text>
          {recent.length === 0 ? (
            <Text className="text-ink-muted text-sm">No jobs yet.</Text>
          ) : (
            <View style={{ gap: 8 }}>
              {recent.map((j) => (
                <Pressable
                  key={j.id}
                  onPress={() => router.push(`/jobs/${j.id}`)}
                  className="bg-surface rounded-2xl p-4 border border-[rgba(255,240,210,0.06)] flex-row items-center justify-between"
                >
                  <View className="flex-1 pr-3">
                    <Text className="text-ink text-base font-bold" numberOfLines={1}>{j.name || 'Untitled'}</Text>
                    <Text className="text-ink-muted text-xs mt-1" numberOfLines={1}>{j.job_title || j.job_type || '—'}</Text>
                  </View>
                  <Text className="text-gold-bright text-base font-bold">{money(Number(j.amount || 0))}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}
    </ScrollView>
  )
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }) {
  return (
    <View
      className="flex-1 bg-surface rounded-2xl p-4 border border-[rgba(255,240,210,0.06)]"
      style={{ minHeight: 88 }}
    >
      <Text className="text-2xl font-bold" style={{ color: tone }}>{value}</Text>
      <Text className="text-ink-muted text-[11px] font-semibold mt-1">{label}</Text>
    </View>
  )
}
