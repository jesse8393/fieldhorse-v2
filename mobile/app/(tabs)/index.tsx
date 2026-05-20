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
import { Plus, Calendar, Users, BarChart3, DollarSign, ChevronRight, Bell, Phone, FileText, CalendarClock } from 'lucide-react-native'
import { useJobs, useClientsBundle, useRecentActivity, useProfile, useAgenda } from '../../lib/queries'
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
  const { data: profile } = useProfile(user?.id)
  const { data: agenda } = useAgenda(user?.id)

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

  const overdue = agenda?.overdue ?? []
  const todayEvents = agenda?.today ?? []
  const priorities = useMemo(() => ({
    followUps: jobs.filter((j) => j.stage === 'lead').length,
    quotes: jobs.filter((j) => j.stage === 'quote').length,
    behind: overdue.length
  }), [jobs, overdue.length])

  const name = (user?.email?.split('@')[0] || 'there')
  const display = name.charAt(0).toUpperCase() + name.slice(1)

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        {/* Branded header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18 }}>
          <LinearGradient colors={['#F0CE86', '#C9963A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center' }}>
            <Text style={{ color: theme.onGold, fontSize: 14, fontWeight: '900', letterSpacing: 0.5 }}>FH</Text>
          </LinearGradient>
          <Text style={{ color: theme.ink, fontSize: 13, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', flex: 1, textAlign: 'center' }} numberOfLines={1}>
            {profile?.company_name || 'FieldHorse'}
          </Text>
          <Pressable onPress={() => router.push('/notifications')} hitSlop={8} style={{ width: 34, height: 34, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.border }}>
            <Bell color={theme.goldBright} size={17} />
          </Pressable>
        </View>

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

            {/* Next actions */}
            {overdue.length > 0 ? (
              <>
                <SectionLabel style={{ marginBottom: 10 }}>Next actions</SectionLabel>
                <View style={{ gap: 10, marginBottom: 24 }}>
                  {overdue.slice(0, 4).map((e) => (
                    <Pressable key={e.id} onPress={() => e.contact_id && router.push(`/jobs/${e.contact_id}`)}>
                      <Card accent={theme.danger}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, paddingLeft: 16 }}>
                          <View style={{ width: 38, height: 38, borderRadius: 11, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(232,90,87,0.12)', borderWidth: 1, borderColor: 'rgba(232,90,87,0.3)' }}>
                            <CalendarClock color={theme.danger} size={16} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>Reschedule {e.fh_contacts?.name || e.title || 'job'}</Text>
                            <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 1 }}>Behind schedule</Text>
                          </View>
                          <View style={{ paddingHorizontal: 9, paddingVertical: 4, borderRadius: 999, backgroundColor: 'rgba(232,90,87,0.14)', borderWidth: 1, borderColor: 'rgba(232,90,87,0.4)' }}>
                            <Text style={{ color: theme.danger, fontSize: 9, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>Overdue</Text>
                          </View>
                        </View>
                      </Card>
                    </Pressable>
                  ))}
                </View>
              </>
            ) : null}

            {/* Today's priorities */}
            <SectionLabel style={{ marginBottom: 10 }}>Today's priorities</SectionLabel>
            <View style={{ flexDirection: 'row', gap: 10, marginBottom: 24 }}>
              <Priority icon={<Phone color={theme.success} size={16} />} count={priorities.followUps} label="Follow-ups" sub="Calls to leads" tint={theme.success} />
              <Priority icon={<FileText color="#6B7CA8" size={16} />} count={priorities.quotes} label="Quotes" sub="Need follow up" tint="#6B7CA8" />
              <Priority icon={<CalendarClock color={theme.danger} size={16} />} count={priorities.behind} label="Behind" sub="Reschedule" tint={theme.danger} />
            </View>

            {/* Today on site */}
            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 10 }}>
              <SectionLabel>Today on site</SectionLabel>
              <Pressable onPress={() => router.push('/schedule')} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 2 }}>
                <Text style={{ color: theme.goldBright, fontSize: 12, fontWeight: '700' }}>Schedule</Text>
                <ChevronRight color={theme.goldBright} size={14} />
              </Pressable>
            </View>
            {todayEvents.length === 0 ? (
              <View style={{ borderRadius: 18, borderWidth: 1, borderStyle: 'dashed', borderColor: theme.borderMid, paddingVertical: 28, alignItems: 'center', marginBottom: 24 }}>
                <CalendarClock color={theme.inkFaint} size={22} />
                <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '700', marginTop: 8 }}>Nothing scheduled today.</Text>
                <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 2 }}>Open Schedule to plan crew visits.</Text>
              </View>
            ) : (
              <View style={{ gap: 10, marginBottom: 24 }}>
                {todayEvents.map((e) => (
                  <Pressable key={e.id} onPress={() => e.contact_id && router.push(`/jobs/${e.contact_id}`)}>
                    <Card accent={theme.gold}>
                      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14, paddingLeft: 16 }}>
                        <Calendar color={theme.goldBright} size={16} />
                        <View style={{ flex: 1 }}>
                          <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '700' }} numberOfLines={1}>{e.title || 'Scheduled event'}</Text>
                          <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 1 }} numberOfLines={1}>{e.fh_contacts?.name || 'No job linked'}</Text>
                        </View>
                        <Text style={{ color: theme.goldBright, fontSize: 13, fontWeight: '700' }}>
                          {e.start_at ? new Date(e.start_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : ''}
                        </Text>
                      </View>
                    </Card>
                  </Pressable>
                ))}
              </View>
            )}

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

function Priority({ icon, count, label, sub, tint }: { icon: React.ReactNode; count: number; label: string; sub: string; tint: string }) {
  return (
    <Card style={{ flex: 1 }}>
      <View style={{ padding: 14, minHeight: 116 }}>
        <View style={{ width: 32, height: 32, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: `${tint}1f`, borderWidth: 1, borderColor: `${tint}44` }}>
          {icon}
        </View>
        <Text style={{ color: tint, fontSize: 26, fontWeight: '800', marginTop: 10 }}>{count}</Text>
        <Text style={{ color: theme.ink, fontSize: 13, fontWeight: '700', marginTop: 2 }}>{label}</Text>
        <Text style={{ color: theme.inkMuted, fontSize: 11, marginTop: 1 }}>{sub}</Text>
      </View>
    </Card>
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
