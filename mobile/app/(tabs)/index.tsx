// mobile/app/(tabs)/index.tsx — Home dashboard.
// Mirrors the web Home: a hero "revenue opportunity" card with a gold
// sparkline + Won/Active/Lead breakdown, Quick Actions, Recent Activity,
// and a Pipeline Preview — all on the premium v3 design primitives.
import { useMemo } from 'react'
import { View, Text, ScrollView, ActivityIndicator, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { LinearGradient } from 'expo-linear-gradient'
import Svg, { Path, Defs, LinearGradient as SvgGrad, Stop, Circle } from 'react-native-svg'
import { Plus, Calendar, Users, BarChart3, DollarSign, ChevronRight, TrendingUp } from 'lucide-react-native'
import { useJobs, useClientsBundle, useRecentActivity } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground, Card, SectionLabel, theme } from '../../components/ui'

const ACTIVE = new Set(['lead', 'quote', 'job', 'invoice'])
const STAGE_TINT: Record<string, string> = { lead: '#6B7CA8', quote: '#B07A4A', job: '#4F8C5E', invoice: '#C9963A', closed: '#5C5C5C', lost: '#7d2a1f' }

function fullMoney(n: number) {
  return `$${Math.round(n).toLocaleString()}`
}
function money(n: number) {
  if (!n) return '$0'
  if (n >= 1000) return `$${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
  return `$${Math.round(n).toLocaleString()}`
}
function greeting() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning'
  if (h < 18) return 'Good afternoon'
  return 'Good evening'
}
function dateLine() {
  return new Date().toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).toUpperCase()
}

export default function HomeScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data: jobs = [], isLoading } = useJobs()
  const { data: bundle } = useClientsBundle(user?.id)
  const { data: activity = [] } = useRecentActivity(user?.id)

  const stats = useMemo(() => {
    let pipeline = 0, won = 0, active = 0, lead = 0
    for (const j of jobs) {
      const stage = j.stage ?? ''
      if (ACTIVE.has(stage)) pipeline += Number(j.amount || 0)
      if (stage === 'closed') won += 1
      else if (stage === 'lead') lead += 1
      else if (stage === 'quote' || stage === 'job' || stage === 'invoice') active += 1
    }
    return { pipeline, won, active, lead }
  }, [jobs])

  const topDeals = useMemo(() =>
    [...jobs].filter((j) => ACTIVE.has(j.stage ?? '')).sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0)).slice(0, 3)
  , [jobs])

  const name = (user?.email?.split('@')[0] || 'there')
  const display = name.charAt(0).toUpperCase() + name.slice(1)

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 14, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <Text style={{ color: theme.goldBright, fontSize: 11, fontWeight: '800', letterSpacing: 1.5 }}>{dateLine()}</Text>
        <Text style={{ fontSize: 28, fontWeight: '800', marginTop: 4, marginBottom: 18, letterSpacing: -0.5 }}>
          <Text style={{ color: theme.ink }}>{greeting()}, </Text>
          <Text style={{ color: theme.goldBright }}>{display}.</Text>
        </Text>

        {isLoading ? (
          <View style={{ alignItems: 'center', paddingVertical: 64 }}><ActivityIndicator color={theme.goldBright} /></View>
        ) : (
          <>
            {/* Hero revenue card */}
            <Card glow style={{ marginBottom: 22 }}>
              <View style={{ padding: 20 }}>
                <SectionLabel>Today's revenue opportunity</SectionLabel>
                <View style={{ flexDirection: 'row', alignItems: 'flex-end', marginTop: 10 }}>
                  <Text style={{ color: theme.goldBright, fontSize: 38, fontWeight: '800', letterSpacing: -1 }}>{fullMoney(stats.pipeline)}</Text>
                </View>
                <Text style={{ color: theme.inkMuted, fontSize: 13, marginTop: 2 }}>Total Pipeline</Text>

                {/* sparkline */}
                <View style={{ marginTop: 14 }}>
                  <Svg width="100%" height={48} viewBox="0 0 320 60" preserveAspectRatio="none">
                    <Defs>
                      <SvgGrad id="spark" x1="0" y1="0" x2="0" y2="1">
                        <Stop offset="0%" stopColor="#E4BE6F" stopOpacity="0.32" />
                        <Stop offset="100%" stopColor="#E4BE6F" stopOpacity="0" />
                      </SvgGrad>
                    </Defs>
                    <Path d="M0,46 L26,42 L52,38 L78,30 L104,34 L130,28 L156,32 L182,22 L208,28 L234,18 L260,22 L286,12 L320,8 L320,60 L0,60 Z" fill="url(#spark)" />
                    <Path d="M0,46 L26,42 L52,38 L78,30 L104,34 L130,28 L156,32 L182,22 L208,28 L234,18 L260,22 L286,12 L320,8" fill="none" stroke="#E4BE6F" strokeWidth={1.5} />
                    <Circle cx={320} cy={8} r={3} fill="#E4BE6F" />
                  </Svg>
                </View>

                {/* breakdown */}
                <View style={{ flexDirection: 'row', marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: theme.border }}>
                  <Breakdown dot={theme.success} label="Won" count={stats.won} onPress={() => router.push('/jobs')} />
                  <Breakdown dot={theme.gold} label="Active" count={stats.active} onPress={() => router.push('/jobs')} />
                  <Breakdown dot="#6B7CA8" label="Lead" count={stats.lead} onPress={() => router.push('/jobs')} />
                </View>
              </View>
            </Card>

            {/* Quick actions */}
            <SectionLabel style={{ marginBottom: 10 }}>Quick actions</SectionLabel>
            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 24 }}>
              <QuickAction icon={<Plus color={theme.onGold} size={20} strokeWidth={2.6} />} label="Add lead" primary onPress={() => router.push('/jobs')} />
              <QuickAction icon={<Calendar color={theme.goldBright} size={20} />} label="Schedule" onPress={() => router.push('/schedule')} />
              <QuickAction icon={<Users color={theme.goldBright} size={20} />} label="Clients" onPress={() => router.push('/clients')} />
              <QuickAction icon={<BarChart3 color={theme.goldBright} size={20} />} label="Reports" onPress={() => router.push('/analytics')} />
            </View>

            {/* Recent activity */}
            {activity.length > 0 ? (
              <>
                <SectionLabel style={{ marginBottom: 10 }}>Recent activity</SectionLabel>
                <Card style={{ marginBottom: 24 }}>
                  <View style={{ paddingVertical: 4 }}>
                    {activity.map((a, i) => (
                      <View key={a.id} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 14, paddingVertical: 12, borderTopWidth: i === 0 ? 0 : 1, borderTopColor: theme.border }}>
                        <View style={{ width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(91,185,122,0.14)', borderWidth: 1, borderColor: 'rgba(91,185,122,0.3)' }}>
                          <DollarSign color={theme.success} size={16} />
                        </View>
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }}>{money(a.amount)} received{a.kind === 'deposit' ? ' · deposit' : ''}</Text>
                          <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{a.name || '—'}</Text>
                        </View>
                        <Text style={{ color: theme.inkFaint, fontSize: 11 }}>{a.date ? new Date(a.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) : ''}</Text>
                      </View>
                    ))}
                  </View>
                </Card>
              </>
            ) : null}

            {/* Pipeline preview */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <SectionLabel>Pipeline preview</SectionLabel>
              <Pressable onPress={() => router.push('/jobs')} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text style={{ color: theme.goldBright, fontSize: 12, fontWeight: '700' }}>View all</Text>
                <ChevronRight color={theme.goldBright} size={14} />
              </Pressable>
            </View>
            {topDeals.length === 0 ? (
              <Text style={{ color: theme.inkMuted, fontSize: 14 }}>No active deals.</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {topDeals.map((j) => {
                  const tint = STAGE_TINT[j.stage ?? ''] ?? '#3a352e'
                  const initials = (j.name || '·').trim().split(/\s+/).slice(0, 2).map((w) => w[0]?.toUpperCase() || '').join('')
                  return (
                    <Pressable key={j.id} onPress={() => router.push(`/jobs/${j.id}`)}>
                      <Card accent={tint}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, paddingLeft: 16 }}>
                          <View style={{ width: 40, height: 40, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.border }}>
                            <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800' }}>{initials || '·'}</Text>
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{j.name || 'Untitled'}</Text>
                            <Text style={{ color: tint, fontSize: 10, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginTop: 3 }}>{j.stage}</Text>
                          </View>
                          <Text style={{ color: theme.goldBright, fontSize: 18, fontWeight: '800' }}>{money(Number(j.amount || 0))}</Text>
                        </View>
                      </Card>
                    </Pressable>
                  )
                })}
              </View>
            )}
          </>
        )}
      </ScrollView>
    </View>
  )
}

function Breakdown({ dot, label, count, onPress }: { dot: string; label: string; count: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
        <View style={{ width: 7, height: 7, borderRadius: 4, backgroundColor: dot }} />
        <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '700', letterSpacing: 0.5, textTransform: 'uppercase' }}>{label}</Text>
      </View>
      <Text style={{ color: theme.ink, fontSize: 22, fontWeight: '800', marginTop: 4 }}>{count}</Text>
      <Text style={{ color: theme.inkFaint, fontSize: 11 }}>{count === 1 ? 'deal' : 'deals'}</Text>
    </Pressable>
  )
}

function QuickAction({ icon, label, primary, onPress }: { icon: React.ReactNode; label: string; primary?: boolean; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} style={{ flex: 1 }}>
      <View style={{ borderRadius: 16, overflow: 'hidden', borderWidth: 1, borderColor: primary ? theme.borderGold : theme.border }}>
        <LinearGradient colors={primary ? ['#241D12', '#191410'] : ['#1A1613', '#131110']} start={{ x: 0, y: 0 }} end={{ x: 0, y: 1 }} style={{ alignItems: 'center', paddingVertical: 14, gap: 8 }}>
          <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: primary ? undefined : theme.surface2, borderWidth: primary ? 0 : 1, borderColor: theme.border }}>
            {primary ? (
              <LinearGradient colors={['#F0CE86', '#C9963A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center' }}>
                {icon}
              </LinearGradient>
            ) : icon}
          </View>
          <Text style={{ color: theme.ink, fontSize: 11, fontWeight: '700' }}>{label}</Text>
        </LinearGradient>
      </View>
    </Pressable>
  )
}
