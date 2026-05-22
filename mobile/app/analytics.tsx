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
    let pipeline = 0, won = 0, active = 0, wonCount = 0, lostCount = 0
    const byStage = new Map<string, { count: number; value: number }>()
    const byType = new Map<string, { won: number; lost: number }>()
    const marginSamples: number[] = []
    for (const j of jobs) {
      const amt = Number(j.amount || 0)
      const cost = Number(j.cost || 0)
      const stage = j.stage ?? ''
      const cur = byStage.get(stage) || { count: 0, value: 0 }
      cur.count += 1; cur.value += amt
      byStage.set(stage, cur)
      if (ACTIVE.has(stage)) { pipeline += amt; active += 1 }
      if (stage === 'closed') {
        won += amt; wonCount += 1
        if (amt > 0 && cost > 0) marginSamples.push((amt - cost) / amt)
      }
      if (stage === 'lost') lostCount += 1
      if (stage === 'closed' || stage === 'lost') {
        const t = (j.job_type || 'Other').trim() || 'Other'
        const r = byType.get(t) || { won: 0, lost: 0 }
        if (stage === 'closed') r.won += 1; else r.lost += 1
        byType.set(t, r)
      }
    }
    const collected = (bundle?.payments ?? []).reduce((s, p) => s + Number(p.amount || 0), 0)

    // Collected revenue per month, last 6 months (oldest → newest).
    const monthly: { label: string; value: number }[] = []
    const monthIdx = new Map<string, number>()
    const now = new Date()
    for (let i = 5; i >= 0; i--) {
      const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
      monthIdx.set(`${d.getFullYear()}-${d.getMonth()}`, monthly.length)
      monthly.push({ label: d.toLocaleDateString(undefined, { month: 'short' }), value: 0 })
    }
    for (const p of bundle?.payments ?? []) {
      if (!p.paid_on) continue
      const d = new Date(p.paid_on)
      if (Number.isNaN(d.getTime())) continue
      const idx = monthIdx.get(`${d.getFullYear()}-${d.getMonth()}`)
      if (idx != null) monthly[idx].value += Number(p.amount || 0)
    }

    const decided = wonCount + lostCount
    const closeRate = (wonCount >= 1 && lostCount >= 1 && decided >= 3) ? Math.round((wonCount / decided) * 100) : null
    const avgMargin = marginSamples.length ? Math.round((marginSamples.reduce((s, m) => s + m, 0) / marginSamples.length) * 100) : null

    const winByType = [...byType.entries()]
      .map(([type, r]) => ({ type, ...r, total: r.won + r.lost, rate: Math.round((r.won / (r.won + r.lost)) * 100) }))
      .filter((r) => r.total > 0)
      .sort((a, b) => b.total - a.total)
      .slice(0, 6)

    const clientName = new Map((bundle?.clients ?? []).map((c) => [c.id, c.name || 'Unnamed']))
    const byClient = new Map<string, number>()
    for (const j of bundle?.jobs ?? []) {
      if (!j.client_id) continue
      byClient.set(j.client_id, (byClient.get(j.client_id) || 0) + Number(j.amount || 0))
    }
    const topClients = [...byClient.entries()]
      .map(([id, value]) => ({ id, name: clientName.get(id) || 'Unnamed', value }))
      .filter((c) => c.value > 0)
      .sort((a, b) => b.value - a.value)
      .slice(0, 5)

    return { pipeline, won, active, collected, byStage, total: jobs.length, closeRate, avgMargin, winByType, topClients, monthly }
  }, [jobs, bundle])

  const maxStageValue = Math.max(1, ...STAGES.map((s) => stats.byStage.get(s)?.value ?? 0))
  const maxClientValue = Math.max(1, ...stats.topClients.map((c) => c.value))

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
              <Kpi label="Close rate" value={stats.closeRate != null ? `${stats.closeRate}%` : '—'} tone={theme.goldBright} />
              <Kpi label="Avg margin" value={stats.avgMargin != null ? `${stats.avgMargin}%` : '—'} tone={theme.success} />
            </View>

            {stats.monthly.some((m) => m.value > 0) ? (
              <>
                <SectionLabel style={{ marginTop: 28, marginBottom: 12 }}>Collected — last 6 months</SectionLabel>
                <Card>
                  <View style={{ padding: 16 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 120, gap: 8 }}>
                      {stats.monthly.map((m, i) => {
                        const max = Math.max(1, ...stats.monthly.map((x) => x.value))
                        const h = Math.max(2, Math.round((m.value / max) * 96))
                        return (
                          <View key={i} style={{ flex: 1, alignItems: 'center', justifyContent: 'flex-end' }}>
                            {m.value > 0 ? <Text style={{ color: theme.inkMuted, fontSize: 9, fontWeight: '700', marginBottom: 4 }}>{money(m.value)}</Text> : null}
                            <View style={{ width: '70%', height: h, borderRadius: 6, backgroundColor: m.value > 0 ? theme.goldBright : 'rgba(255,240,210,0.08)' }} />
                          </View>
                        )
                      })}
                    </View>
                    <View style={{ flexDirection: 'row', justifyContent: 'space-between', gap: 8, marginTop: 8 }}>
                      {stats.monthly.map((m, i) => (
                        <Text key={i} style={{ flex: 1, textAlign: 'center', color: theme.inkMuted, fontSize: 10, fontWeight: '700' }}>{m.label}</Text>
                      ))}
                    </View>
                  </View>
                </Card>
              </>
            ) : null}

            {stats.winByType.length > 0 ? (
              <>
                <SectionLabel style={{ marginTop: 28, marginBottom: 12 }}>Win rate by job type</SectionLabel>
                <Card>
                  <View style={{ padding: 16, gap: 14 }}>
                    {stats.winByType.map((r) => (
                      <View key={r.type}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                          <Text style={{ color: theme.ink, fontSize: 13, fontWeight: '700' }}>{r.type} <Text style={{ color: theme.inkMuted }}>· {r.won}/{r.total} won</Text></Text>
                          <Text style={{ color: theme.goldBright, fontSize: 13, fontWeight: '800' }}>{r.rate}%</Text>
                        </View>
                        <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,240,210,0.06)', overflow: 'hidden' }}>
                          <View style={{ width: `${r.rate}%`, height: 8, borderRadius: 4, backgroundColor: theme.success }} />
                        </View>
                      </View>
                    ))}
                  </View>
                </Card>
              </>
            ) : null}

            {stats.topClients.length > 0 ? (
              <>
                <SectionLabel style={{ marginTop: 28, marginBottom: 12 }}>Top clients by value</SectionLabel>
                <Card>
                  <View style={{ padding: 16, gap: 14 }}>
                    {stats.topClients.map((c) => (
                      <View key={c.id}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 5 }}>
                          <Text style={{ color: theme.ink, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{c.name}</Text>
                          <Text style={{ color: theme.goldBright, fontSize: 13, fontWeight: '800' }}>{money(c.value)}</Text>
                        </View>
                        <View style={{ height: 8, borderRadius: 4, backgroundColor: 'rgba(255,240,210,0.06)', overflow: 'hidden' }}>
                          <View style={{ width: `${Math.round((c.value / maxClientValue) * 100)}%`, height: 8, borderRadius: 4, backgroundColor: theme.goldBright }} />
                        </View>
                      </View>
                    ))}
                  </View>
                </Card>
              </>
            ) : null}

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
