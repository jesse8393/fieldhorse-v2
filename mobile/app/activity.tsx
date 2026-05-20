// mobile/app/activity.tsx — unified activity timeline across the business.
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { DollarSign, UserPlus, FileText, ClipboardList, StickyNote } from 'lucide-react-native'
import { useActivityFeed, type FeedItem, type FeedKind } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'
import { ScreenBackground, Card, ScreenHeader, theme } from '../components/ui'

const META: Record<FeedKind, { tint: string; Icon: any }> = {
  payment: { tint: theme.success, Icon: DollarSign },
  lead: { tint: theme.goldBright, Icon: UserPlus },
  invoice: { tint: '#5BA8E8', Icon: FileText },
  change_order: { tint: '#C9963A', Icon: ClipboardList },
  note: { tint: theme.inkMuted, Icon: StickyNote }
}

function money(n: number) { return `$${Math.round(n).toLocaleString()}` }
function dayKey(iso: string) {
  const d = new Date(iso); const t = new Date(); const y = new Date(); y.setDate(t.getDate() - 1)
  if (d.toDateString() === t.toDateString()) return 'Today'
  if (d.toDateString() === y.toDateString()) return 'Yesterday'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}
function timeOf(iso: string) { return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) }

export default function ActivityScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data, isLoading } = useActivityFeed(user?.id)

  const groups: { day: string; items: FeedItem[] }[] = []
  for (const it of data ?? []) {
    const k = dayKey(it.date)
    const last = groups[groups.length - 1]
    if (last && last.day === k) last.items.push(it)
    else groups.push({ day: k, items: [it] })
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <ScreenHeader backLabel="More" onBack={() => router.back()} eyebrow="Activity" title="What's happening" />

        {isLoading ? (
          <ActivityIndicator color={theme.goldBright} style={{ marginTop: 24 }} />
        ) : groups.length === 0 ? (
          <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 24 }}>No activity yet. As you log payments, add leads and send invoices, they'll show up here.</Text>
        ) : (
          <View style={{ marginTop: 16 }}>
            {groups.map((g) => (
              <View key={g.day} style={{ marginBottom: 22 }}>
                <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>{g.day}</Text>
                <View style={{ gap: 10 }}>
                  {g.items.map((it) => {
                    const m = META[it.kind]
                    return (
                      <Card key={it.id}>
                        <Pressable onPress={() => it.contactId && router.push(`/jobs/${it.contactId}`)} style={{ flexDirection: 'row', alignItems: 'center', padding: 14, gap: 13 }}>
                          <View style={{ width: 40, height: 40, borderRadius: 12, alignItems: 'center', justifyContent: 'center', backgroundColor: `${m.tint}1f`, borderWidth: 1, borderColor: `${m.tint}44` }}>
                            <m.Icon color={m.tint} size={18} />
                          </View>
                          <View style={{ flex: 1 }}>
                            <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                              <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '700', flex: 1 }} numberOfLines={1}>{it.title}</Text>
                              {it.amount != null ? (
                                <Text style={{ color: m.tint, fontSize: 15, fontWeight: '800', marginLeft: 8 }}>{it.kind === 'payment' ? '+' : ''}{money(it.amount)}</Text>
                              ) : null}
                            </View>
                            <Text style={{ color: theme.inkMuted, fontSize: 12.5, marginTop: 2 }} numberOfLines={1}>
                              {it.contactName || 'Unassigned'}{it.sub ? ` · ${it.sub}` : ''} · {timeOf(it.date)}
                            </Text>
                          </View>
                        </Pressable>
                      </Card>
                    )
                  })}
                </View>
              </View>
            ))}
          </View>
        )}
      </ScrollView>
    </View>
  )
}
