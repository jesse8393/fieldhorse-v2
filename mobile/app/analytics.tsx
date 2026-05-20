// mobile/app/analytics.tsx — read-only business dashboard.
// Pushed from More. Computes KPIs from the jobs list + the clients bundle
// (which carries payments), with no extra queries: pipeline value, won
// value, collected revenue, and a per-stage pipeline breakdown.
import { useMemo } from 'react'
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { useJobs, useClientsBundle } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'

const STAGE_TINT: Record<string, string> = {
  lead: '#6B7CA8', quote: '#B07A4A', job: '#4F8C5E', invoice: '#C9963A', closed: '#5C5C5C', lost: '#7d2a1f'
}
const STAGES = ['lead', 'quote', 'job', 'invoice', 'closed', 'lost'] as const
const ACTIVE = new Set(['lead', 'quote', 'job', 'invoice'])

function money(n: number) {
  if (!n) return '$0'
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return `$${Math.round(n).toLocaleString()}`
}

export default function AnalyticsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data: jobs = [], isLoading } = useJobs()
  const { data: bundle } = useClientsBundle(user?.id)

  const stats = useMemo(() => {
    let pipeline = 0, won = 0, active = 0
    const byStage = new Map<string, { count: number; value: number }>()
    for (const j of jobs) {
      const amt = Number(j.amount || 0)
      const stage = j.stage ?? ''
      const cur = byStage.get(stage) || { count: 0, value: 0 }
      cur.count += 1; cur.value += amt
      byStage.set(stage, cur)
      if (ACTIVE.has(stage)) { pipeline += amt; active += 1 }
      if (stage === 'closed') won += amt
    }
    const collected = (bundle?.payments ?? []).reduce((s, p) => s + Number(p.amount || 0), 0)
    return { pipeline, won, active, collected, byStage, total: jobs.length }
  }, [jobs, bundle])

  const maxStageValue = Math.max(1, ...STAGES.map((s) => stats.byStage.get(s)?.value ?? 0))

  return (
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <Pressable onPress={() => router.back()} className="flex-row items-center mb-4" style={{ gap: 4 }}>
          <ChevronLeft color="#E8B865" size={20} />
          <Text className="text-gold-bright font-bold">More</Text>
        </Pressable>

        <Text className="text-gold-bright text-[10px] font-bold tracking-[2px] uppercase">Analytics</Text>
        <Text className="text-ink text-3xl font-bold mb-5">Business snapshot</Text>

        {isLoading ? (
          <ActivityIndicator color="#E8B865" />
        ) : (
          <>
            <View className="flex-row flex-wrap" style={{ gap: 10 }}>
              <Kpi label="Pipeline" value={money(stats.pipeline)} tone="#E8B865" />
              <Kpi label="Collected" value={money(stats.collected)} tone="#4ade80" />
              <Kpi label="Won (closed)" value={money(stats.won)} />
              <Kpi label="Active jobs" value={String(stats.active)} />
            </View>

            <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-8 mb-3">Pipeline by stage</Text>
            <View style={{ gap: 10 }}>
              {STAGES.map((s) => {
                const row = stats.byStage.get(s) || { count: 0, value: 0 }
                const tint = STAGE_TINT[s]
                const pct = Math.round((row.value / maxStageValue) * 100)
                return (
                  <View key={s}>
                    <View className="flex-row items-center justify-between mb-1">
                      <Text className="text-ink text-sm font-semibold capitalize">{s} <Text className="text-ink-muted">· {row.count}</Text></Text>
                      <Text className="text-ink-muted text-sm">{money(row.value)}</Text>
                    </View>
                    <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,240,210,0.06)', overflow: 'hidden' }}>
                      <View style={{ width: `${pct}%`, height: 8, borderRadius: 4, backgroundColor: tint }} />
                    </View>
                  </View>
                )
              })}
            </View>

            <Text className="text-ink-muted text-xs text-center mt-8">{stats.total} jobs in the pipeline.</Text>
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Kpi({ label, value, tone = '#F2EDE4' }: { label: string; value: string; tone?: string }) {
  return (
    <View className="bg-surface rounded-2xl p-4 border border-[rgba(255,240,210,0.06)]" style={{ width: '47.5%' }}>
      <Text className="text-2xl font-bold" style={{ color: tone }} numberOfLines={1}>{value}</Text>
      <Text className="text-ink-muted text-[11px] font-semibold mt-1">{label}</Text>
    </View>
  )
}
