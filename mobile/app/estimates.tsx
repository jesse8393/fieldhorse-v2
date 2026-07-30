// mobile/app/estimates.tsx, proposals/estimates pipeline list.
import { useState } from 'react'
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { FileSignature, Sparkles } from 'lucide-react-native'
import { useEstimates, type EstimateRow } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'
import { ScreenBackground, Card, ScreenHeader, theme } from '../components/ui'

function money(n: number) { return `$${Math.round(n).toLocaleString()}` }

function statusMeta(r: EstimateRow): { label: string; tint: string } {
  if (r.expired) return { label: 'EXPIRED', tint: theme.danger }
  switch (r.status) {
    case 'accepted': case 'approved': case 'won': case 'signed': return { label: 'ACCEPTED', tint: theme.success }
    case 'declined': case 'rejected': case 'lost': return { label: 'DECLINED', tint: theme.danger }
    case 'viewed': case 'opened': return { label: 'VIEWED', tint: theme.goldBright }
    case 'sent': return { label: 'SENT', tint: '#5C5C5C' }
    default: return { label: 'DRAFT', tint: theme.inkMuted }
  }
}

type Filter = 'all' | 'open' | 'accepted'
function matches(r: EstimateRow, f: Filter) {
  if (f === 'all') return true
  const m = statusMeta(r).label
  if (f === 'accepted') return m === 'ACCEPTED'
  return m === 'SENT' || m === 'VIEWED' || m === 'DRAFT'
}

export default function EstimatesScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data, isLoading } = useEstimates(user?.id)
  const [filter, setFilter] = useState<Filter>('all')

  const rows = (data?.rows ?? []).filter((r) => matches(r, filter))

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}>
        <ScreenHeader
          backLabel="More"
          onBack={() => router.back()}
          eyebrow="Estimates"
          title="Proposals"
          right={(
            <Pressable onPress={() => router.push('/bid')} style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }} hitSlop={8}>
              <Sparkles color={theme.goldBright} size={15} />
              <Text style={{ color: theme.goldBright, fontSize: 14, fontWeight: '700' }}>AI estimate</Text>
            </Pressable>
          )}
        />

        {isLoading ? (
          <ActivityIndicator color={theme.goldBright} style={{ marginTop: 24 }} />
        ) : (data?.rows.length ?? 0) === 0 ? (
          <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 24 }}>No estimates yet. Build a quote on a job and send it, it'll track here.</Text>
        ) : (
          <>
            <Card glow style={{ marginTop: 16, marginBottom: 18 }}>
              <View style={{ flexDirection: 'row', padding: 16 }}>
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.ink, fontSize: 24, fontWeight: '800' }}>{money(data?.openValue ?? 0)}</Text>
                  <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase', marginTop: 2 }}>Open value</Text>
                </View>
                <View style={{ width: 1, backgroundColor: theme.border, marginHorizontal: 14 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.success, fontSize: 24, fontWeight: '800' }}>{money(data?.acceptedValue ?? 0)}</Text>
                  <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase', marginTop: 2 }}>Accepted</Text>
                </View>
                <View style={{ width: 1, backgroundColor: theme.border, marginHorizontal: 14 }} />
                <View style={{ flex: 1 }}>
                  <Text style={{ color: theme.goldBright, fontSize: 24, fontWeight: '800' }}>{data?.winRate ?? 0}%</Text>
                  <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase', marginTop: 2 }}>Win rate</Text>
                </View>
              </View>
            </Card>

            <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
              {(['all', 'open', 'accepted'] as const).map((f) => (
                <Pressable key={f} onPress={() => setFilter(f)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: filter === f ? theme.goldBright : theme.borderMid, backgroundColor: filter === f ? `${theme.goldBright}26` : 'transparent' }}>
                  <Text style={{ color: filter === f ? theme.goldBright : theme.inkMuted, fontSize: 14, fontWeight: '700', textTransform: 'capitalize' }}>{f}</Text>
                </Pressable>
              ))}
            </View>

            <View style={{ gap: 12 }}>
              {rows.map((r) => {
                const m = statusMeta(r)
                return (
                  <Card key={r.id} accent={m.tint}>
                    <Pressable onPress={() => router.push(`/jobs/${r.id}`)} style={{ flexDirection: 'row', alignItems: 'center', padding: 16, paddingLeft: 16, gap: 12 }}>
                      <View style={{ width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: `${m.tint}1f`, borderWidth: 1, borderColor: `${m.tint}44` }}>
                        <FileSignature color={m.tint} size={18} />
                      </View>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{r.name || 'Untitled'}</Text>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 4 }}>
                          <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: `${m.tint}55`, backgroundColor: `${m.tint}1f` }}>
                            <Text style={{ color: m.tint, fontSize: 12, fontWeight: '800', letterSpacing: 0 }}>{m.label}</Text>
                          </View>
                          {r.sentAt ? <Text style={{ color: theme.inkMuted, fontSize: 12 }}>Sent {new Date(r.sentAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</Text> : null}
                        </View>
                      </View>
                      <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '800' }}>{money(r.amount)}</Text>
                    </Pressable>
                  </Card>
                )
              })}
              {rows.length === 0 ? <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 4 }}>Nothing in this filter.</Text> : null}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  )
}
