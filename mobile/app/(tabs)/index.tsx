// mobile/app/(tabs)/index.tsx — Home dashboard.
// Reuses the shared useJobs() hook (same as web) and derives the
// headline KPIs natively. Styled on the premium v3 design primitives.
import { useMemo } from 'react'
import { View, Text, ScrollView, ActivityIndicator, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useJobs } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground, Card, Eyebrow, SectionLabel, StagePill, theme } from '../../components/ui'

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
    let pipeline = 0, won = 0, active = 0
    for (const j of jobs) {
      const amt = Number(j.amount || 0)
      if (ACTIVE.has(j.stage ?? '')) { pipeline += amt; active += 1 }
      if (WON.has(j.stage ?? '')) won += amt
    }
    return { pipeline, won, active }
  }, [jobs])

  const recent = jobs.slice(0, 6)

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <Eyebrow>{greeting()}</Eyebrow>
        <Text style={{ color: theme.ink, fontSize: 34, fontWeight: '800', marginTop: 2, letterSpacing: -0.5 }} numberOfLines={1}>
          {user?.email?.split('@')[0] || 'there'}.
        </Text>
        <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 4, marginBottom: 22 }}>Here's the state of your pipeline.</Text>

        {isLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 64 }}><ActivityIndicator color={theme.goldBright} /></View>
        ) : (
          <>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 26 }}>
              <Kpi label="In pipeline" value={money(stats.pipeline)} tone={theme.goldBright} glow />
              <Kpi label="Won" value={money(stats.won)} tone={theme.success} />
              <Kpi label="Active" value={String(stats.active)} tone={theme.ink} />
            </View>

            <SectionLabel style={{ marginBottom: 12 }}>Recent jobs</SectionLabel>
            {recent.length === 0 ? (
              <Text style={{ color: theme.inkMuted, fontSize: 14 }}>No jobs yet.</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {recent.map((j) => (
                  <Pressable key={j.id} onPress={() => router.push(`/jobs/${j.id}`)}>
                    <Card accent={STAGE_ACCENT(j.stage)}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', padding: 16, paddingLeft: 18 }}>
                        <View style={{ flex: 1, paddingRight: 12 }}>
                          <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{j.name || 'Untitled'}</Text>
                          <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 3 }} numberOfLines={1}>{j.job_title || j.job_type || '—'}</Text>
                        </View>
                        <View style={{ alignItems: 'flex-end' }}>
                          <Text style={{ color: theme.goldBright, fontSize: 17, fontWeight: '800' }}>{money(Number(j.amount || 0))}</Text>
                          {j.stage ? <View style={{ marginTop: 5 }}><StagePill stage={j.stage} /></View> : null}
                        </View>
                      </View>
                    </Card>
                  </Pressable>
                ))}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function STAGE_ACCENT(stage: string | null) {
  const tints: Record<string, string> = { lead: '#6B7CA8', quote: '#B07A4A', job: '#4F8C5E', invoice: '#C9963A', closed: '#5C5C5C', lost: '#7d2a1f' }
  return tints[stage ?? ''] ?? '#3a352e'
}

function Kpi({ label, value, tone, glow }: { label: string; value: string; tone: string; glow?: boolean }) {
  return (
    <Card glow={glow} style={{ flex: 1 }}>
      <View style={{ padding: 14, minHeight: 92, justifyContent: 'center' }}>
        <Text style={{ color: tone, fontSize: 24, fontWeight: '800' }} numberOfLines={1}>{value}</Text>
        <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '600', marginTop: 4 }}>{label}</Text>
      </View>
    </Card>
  )
}
