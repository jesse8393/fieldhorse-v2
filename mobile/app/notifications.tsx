// mobile/app/notifications.tsx — notifications feed.
// Pushed from More. Lists fh_notifications newest-first; tapping marks a
// row read (and follows its link if it points at a job), and a header
// action marks everything read.
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Bell } from 'lucide-react-native'
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, type Notification } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'
import { ScreenBackground, Card, ScreenHeader, theme } from '../components/ui'

function timeAgo(iso: string) {
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString()
}

export default function NotificationsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data: items = [], isLoading } = useNotifications(user?.id)
  const markRead = useMarkNotificationRead()
  const markAll = useMarkAllNotificationsRead()

  const unread = items.filter((n) => !n.read_at).length

  function onPress(n: Notification) {
    if (!user) return
    if (!n.read_at) markRead({ id: n.id, userId: user.id })
    if (n.link && n.link.startsWith('/')) router.push(n.link as any)
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <ScreenHeader
          backLabel="More" onBack={() => router.back()} eyebrow="Notifications" title="Activity"
          right={unread > 0 ? (
            <Pressable onPress={() => user && markAll(user.id)} hitSlop={8}>
              <Text style={{ color: theme.goldBright, fontSize: 13, fontWeight: '700' }}>Mark all read</Text>
            </Pressable>
          ) : undefined}
        />

        {isLoading ? (
          <ActivityIndicator color={theme.goldBright} style={{ marginTop: 24 }} />
        ) : items.length === 0 ? (
          <View style={{ alignItems: 'center', marginTop: 64 }}>
            <Bell color="#5C5C5C" size={28} />
            <Text style={{ color: theme.inkMuted, textAlign: 'center', marginTop: 12 }}>You're all caught up.</Text>
          </View>
        ) : (
          <View style={{ gap: 10, marginTop: 20 }}>
            {items.map((n) => {
              const isUnread = !n.read_at
              return (
                <Pressable key={n.id} onPress={() => onPress(n)}>
                  <Card glow={isUnread} accent={isUnread ? theme.goldBright : undefined}>
                    <View style={{ flexDirection: 'row', gap: 10, padding: 16, paddingLeft: 18 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{n.title}</Text>
                        {n.body ? <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 3 }} numberOfLines={2}>{n.body}</Text> : null}
                        <Text style={{ color: theme.inkFaint, fontSize: 10, marginTop: 4 }}>{timeAgo(n.created_at)}</Text>
                      </View>
                    </View>
                  </Card>
                </Pressable>
              )
            })}
          </View>
        )}
      </ScrollView>
    </View>
  )
}
