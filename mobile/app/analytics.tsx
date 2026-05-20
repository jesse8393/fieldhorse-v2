// mobile/app/analytics.tsx — read-only business dashboard.
// Pushed from More. Computes KPIs from the jobs list + the clients bundle
// (which carries payments), with no extra queries: pipeline value, won
// value, collected revenue, and a per-stage pipeline breakdown.
import { useMemo } from 'react'
import { View, Text, ScrollView, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useJobs, useClientsBundle } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'
import { ScreenBackground, Card, ScreenHeader, SectionLabel, theme } from '../components/ui'

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
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <ScreenHeader backLabel="More" onBack={() => router.back()} eyebrow="Analytics" title="Business snapshot" />

        {isLoading ? (
          <ActivityIndicator color={theme.goldBright} style={{ marginTop: 24 }} />
        ) : (
          <>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 20 }}>
              <Kpi label="Pipeline" value={money(stats.pipeline)} tone={theme.goldBright} glow />
              <Kpi label="Collected" value={money(stats.collected)} tone={theme.success} />
              <Kpi label="Won (closed)" value={money(stats.won)} />
              <Kpi label="Active jobs" value={String(stats.active)} />
            </View>

            <SectionLabel style={{ marginTop: 28, marginBottom: 12 }}>Pipeline by stage</SectionLabel>
            <Card>
              <View style={{ padding: 16, gap: 14 }}>
                {STAGES.map((s) => {
                  const row = stats.byStage.get(s) || { count: 0, value: 0 }
                  const tint = STAGE_TINT[s]
                  const pct = Math.round((row.value / maxStageValue) * 100)
                  return (
                    <View key={s}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                        <Text style={{ color: theme.ink, fontSize: 13, fontWeight: '700', textTransform: 'capitalize' }}>{s} <Text style={{ color: theme.inkMuted }}>· {row.count}</Text></Text>
                        <Text style={{ color: theme.inkMuted, fontSize: 13 }}>{money(row.value)}</Text>
                      </View>
                      <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,240,210,0.06)', overflow: 'hidden' }}>
                        <View style={{ width: `${pct}%`, height: 8, borderRadius: 4, backgroundColor: tint }} />
                      </View>
                    </View>
                  )
                })}
              </View>
            </Card>

            <Text style={{ color: theme.inkMuted, fontSize: 12, textAlign: 'center', marginTop: 24 }}>{stats.total} jobs in the pipeline.</Text>
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Kpi({ label, value, tone = '#F2EDE4', glow }: { label: string; value: string; tone?: string; glow?: boolean }) {
  return (
    <Card glow={glow} style={{ width: '47.5%' }}>
      <View style={{ padding: 16 }}>
        <Text style={{ color: tone, fontSize: 24, fontWeight: '800' }} numberOfLines={1}>{value}</Text>
        <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '600', marginTop: 4 }}>{label}</Text>
      </View>
    </Card>
  )
}
