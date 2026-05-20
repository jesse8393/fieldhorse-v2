// mobile/app/(tabs)/schedule.tsx — upcoming schedule (next 7 days).
// Uses the shared useUpcomingEvents() hook and groups events by day,
// the same shape the web Schedule upcoming rail uses.
import { useMemo } from 'react'
import { View, Text, SectionList, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useUpcomingEvents, type ScheduleEvent } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'

function dayLabel(iso: string) {
  const d = new Date(iso)
  const today = new Date()
  const tomorrow = new Date(); tomorrow.setDate(today.getDate() + 1)
  if (d.toDateString() === today.toDateString()) return 'Today'
  if (d.toDateString() === tomorrow.toDateString()) return 'Tomorrow'
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

function timeLabel(iso: string) {
  return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { data: events = [], isLoading } = useUpcomingEvents(user?.id)

  const sections = useMemo(() => {
    const byDay = new Map<string, ScheduleEvent[]>()
    for (const e of events) {
      if (!e.start_at) continue
      const key = new Date(e.start_at).toDateString()
      if (!byDay.has(key)) byDay.set(key, [])
      byDay.get(key)!.push(e)
    }
    return Array.from(byDay.entries()).map(([, list]) => ({
      title: dayLabel(list[0].start_at as string),
      data: list
    }))
  }, [events])

  return (
    <View className="flex-1 bg-bg" style={{ paddingTop: insets.top + 8 }}>
      <View className="px-5 pb-3">
        <Text className="text-gold-bright text-[10px] font-bold tracking-[2px] uppercase">Schedule</Text>
        <Text className="text-ink text-3xl font-bold">Next 7 days</Text>
      </View>

      {isLoading ? (
        <View className="flex-1 items-center justify-center"><ActivityIndicator color="#E8B865" /></View>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 24 }}
          stickySectionHeadersEnabled={false}
          renderSectionHeader={({ section }) => (
            <Text className="text-ink-muted text-[10px] font-bold tracking-[2px] uppercase mt-5 mb-2">
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => (
            <View
              className="bg-surface rounded-2xl p-4 border border-[rgba(255,240,210,0.06)] mb-2 flex-row items-center"
              style={{ gap: 12 }}
            >
              <View style={{ width: 3, alignSelf: 'stretch', borderRadius: 3, backgroundColor: '#E8B865' }} />
              <View className="flex-1">
                <Text className="text-ink text-base font-bold" numberOfLines={1}>{item.title || 'Scheduled event'}</Text>
                <Text className="text-ink-muted text-xs mt-1" numberOfLines={1}>
                  {item.fh_contacts?.name || 'No job linked'}
                </Text>
              </View>
              <Text className="text-gold-bright text-sm font-bold">
                {item.start_at ? timeLabel(item.start_at) : ''}
              </Text>
            </View>
          )}
          ListEmptyComponent={
            <Text className="text-ink-muted text-center mt-12">A clear week — nothing scheduled.</Text>
          }
        />
      )}
    </View>
  )
}
