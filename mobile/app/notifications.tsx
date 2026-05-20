// mobile/app/notifications.tsx — notifications feed.
// Pushed from More. Lists fh_notifications newest-first; tapping marks a
// row read (and follows its link if it points at a job), and a header
// action marks everything read.
import { View, Text, ScrollView, Pressable, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft, Bell } from 'lucide-react-native'
import { useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead, type Notification } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'

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
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <Pressable onPress={() => router.back()} className="flex-row items-center mb-4" style={{ gap: 4 }}>
          <ChevronLeft color="#E8B865" size={20} />
          <Text className="text-gold-bright font-bold">More</Text>
        </Pressable>

        <View className="flex-row items-end justify-between mb-5">
          <View>
            <Text className="text-gold-bright text-[10px] font-bold tracking-[2px] uppercase">Notifications</Text>
            <Text className="text-ink text-3xl font-bold">Activity</Text>
          </View>
          {unread > 0 ? (
            <Pressable onPress={() => user && markAll(user.id)} hitSlop={8}>
              <Text className="text-gold-bright text-sm font-bold">Mark all read</Text>
            </Pressable>
          ) : null}
        </View>

        {isLoading ? (
          <ActivityIndicator color="#E8B865" />
        ) : items.length === 0 ? (
          <View className="items-center mt-16">
            <Bell color="#5C5C5C" size={28} />
            <Text className="text-ink-muted text-center mt-3">You're all caught up.</Text>
          </View>
        ) : (
          <View style={{ gap: 8 }}>
            {items.map((n) => {
              const isUnread = !n.read_at
              return (
                <Pressable
                  key={n.id}
                  onPress={() => onPress(n)}
                  className="rounded-2xl p-4 border flex-row"
                  style={{
                    gap: 12,
                    backgroundColor: isUnread ? 'rgba(232,184,101,0.08)' : '#161311',
                    borderColor: isUnread ? 'rgba(232,184,101,0.25)' : 'rgba(255,240,210,0.06)'
                  }}
                >
                  <View style={{ width: 8 }}>
                    {isUnread ? <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: '#E8B865', marginTop: 6 }} /> : null}
                  </View>
                  <View className="flex-1">
                    <Text className="text-ink text-sm font-bold" numberOfLines={1}>{n.title}</Text>
                    {n.body ? <Text className="text-ink-muted text-xs mt-1" numberOfLines={2}>{n.body}</Text> : null}
                    <Text className="text-ink-muted text-[10px] mt-1">{timeAgo(n.created_at)}</Text>
                  </View>
                </Pressable>
              )
            })}
          </View>
        )}
      </ScrollView>
    </View>
  )
}
