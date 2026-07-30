// mobile/app/(tabs)/schedule.tsx — upcoming schedule.
// Uses the shared useUpcomingEvents() hook and groups events by day, the
// same shape the web Schedule upcoming rail uses. A floating "+" opens a
// sheet to create an event (title + date + time + optional linked job);
// tapping an event opens the same sheet to edit it. A 7/30-day range
// toggle widens the window.
import { useMemo, useRef, useState } from 'react'
import { View, Text, SectionList, ActivityIndicator, Pressable, ScrollView } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Plus } from 'lucide-react-native'
import { useUpcomingEvents, useJobs, type ScheduleEvent } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground, Card, Eyebrow, theme } from '../../components/ui'
import { AddEventSheet } from '../../components/AddEventSheet'

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
  const [range, setRange] = useState<7 | 30>(7)
  const { data: events = [], isLoading } = useUpcomingEvents(user?.id, range)
  const { data: jobs = [] } = useJobs()

  const [addOpen, setAddOpen] = useState(false)
  const [editEvent, setEditEvent] = useState<ScheduleEvent | null>(null)

  function openCreate() { setEditEvent(null); setAddOpen(true) }
  function openEdit(e: ScheduleEvent) { setEditEvent(e); setAddOpen(true) }

  const listRef = useRef<SectionList<ScheduleEvent>>(null)

  const countByDay = useMemo(() => {
    const m = new Map<string, number>()
    for (const e of events) {
      if (!e.start_at) continue
      const key = new Date(e.start_at).toDateString()
      m.set(key, (m.get(key) || 0) + 1)
    }
    return m
  }, [events])

  const weekDays = useMemo(() => {
    const out: Date[] = []
    const base = new Date(); base.setHours(0, 0, 0, 0)
    for (let i = 0; i < Math.min(range, 14); i++) {
      const d = new Date(base); d.setDate(base.getDate() + i)
      out.push(d)
    }
    return out
  }, [range])

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

  function jumpToDay(d: Date) {
    const key = d.toDateString()
    const idx = sections.findIndex((s) => s.data[0]?.start_at && new Date(s.data[0].start_at).toDateString() === key)
    if (idx >= 0) {
      try { listRef.current?.scrollToLocation({ sectionIndex: idx, itemIndex: 0, viewPosition: 0, animated: true }) } catch {}
    }
  }

  return (
    <View style={{ flex: 1, paddingTop: insets.top + 10 }}>
      <ScreenBackground />
      <View style={{ paddingHorizontal: 20, paddingBottom: 12, flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between' }}>
        <View>
          <Eyebrow>Schedule</Eyebrow>
          <Text style={{ color: theme.ink, fontSize: 34, fontWeight: '800', letterSpacing: -0.5 }}>Next {range} days</Text>
        </View>
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {([7, 30] as const).map((r) => {
            const active = range === r
            return (
              <Pressable
                key={r}
                onPress={() => setRange(r)}
                style={{ borderRadius: 999, paddingHorizontal: 13, paddingVertical: 7, borderWidth: 1, borderColor: active ? theme.goldBright : theme.borderMid, backgroundColor: active ? `${theme.goldBright}26` : 'transparent' }}
              >
                <Text style={{ fontSize: 12, fontWeight: '800', color: active ? theme.goldBright : theme.inkMuted }}>{r}d</Text>
              </Pressable>
            )
          })}
        </View>
      </View>

      {/* Week strip */}
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ paddingHorizontal: 20, gap: 8, paddingBottom: 6 }}
        style={{ maxHeight: 78, flexGrow: 0 }}
      >
        {weekDays.map((d) => {
          const isToday = d.toDateString() === new Date().toDateString()
          const count = countByDay.get(d.toDateString()) || 0
          return (
            <Pressable
              key={d.toISOString()}
              onPress={() => jumpToDay(d)}
              style={{
                width: 46, borderRadius: 14, paddingVertical: 8, alignItems: 'center',
                borderWidth: 1,
                borderColor: isToday ? theme.goldBright : count > 0 ? theme.borderGold : theme.border,
                backgroundColor: isToday ? `${theme.goldBright}1f` : theme.surface
              }}
            >
              <Text style={{ color: isToday ? theme.goldBright : theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>
                {d.toLocaleDateString(undefined, { weekday: 'short' }).slice(0, 3)}
              </Text>
              <Text style={{ color: isToday ? theme.goldBright : theme.ink, fontSize: 17, fontWeight: '800', marginTop: 2 }}>{d.getDate()}</Text>
              <View style={{ width: 5, height: 5, borderRadius: 3, marginTop: 4, backgroundColor: count > 0 ? theme.goldBright : 'transparent' }} />
            </Pressable>
          )
        })}
      </ScrollView>

      {isLoading ? (
        <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}><ActivityIndicator color={theme.goldBright} /></View>
      ) : (
        <SectionList
          ref={listRef}
          sections={sections}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: insets.bottom + 100 }}
          stickySectionHeadersEnabled={false}
          onScrollToIndexFailed={() => {}}
          renderSectionHeader={({ section }) => (
            <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginTop: 18, marginBottom: 10 }}>
              {section.title}
            </Text>
          )}
          renderItem={({ item }) => (
            <Pressable onPress={() => openEdit(item)} style={{ marginBottom: 10 }}>
              <Card accent={theme.gold}>
                <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 16, paddingLeft: 18 }}>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '700' }} numberOfLines={1}>{item.title || 'Scheduled event'}</Text>
                    <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 3 }} numberOfLines={1}>{item.fh_contacts?.name || 'No job linked'}</Text>
                  </View>
                  <Text style={{ color: theme.goldBright, fontSize: 14, fontWeight: '800' }}>{item.start_at ? timeLabel(item.start_at) : ''}</Text>
                </View>
              </Card>
            </Pressable>
          )}
          ListEmptyComponent={<Text style={{ color: theme.inkMuted, textAlign: 'center', marginTop: 48 }}>A clear stretch — nothing scheduled.</Text>}
          ListFooterComponent={events.length ? <Text style={{ color: theme.inkMuted, fontSize: 10, textAlign: 'center', marginTop: 16 }}>Tap an event to edit or delete.</Text> : null}
        />
      )}

      {/* Floating add button */}
      <Pressable
        onPress={openCreate}
        style={{ position: 'absolute', right: 20, bottom: insets.bottom + 20, borderRadius: 999, shadowColor: '#C9963A', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12 }}
      >
        <LinearGradient colors={['#F0CE86', '#E4BE6F', '#C9963A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 58, height: 58, borderRadius: 999, alignItems: 'center', justifyContent: 'center' }}>
          <Plus color={theme.onGold} size={26} strokeWidth={2.8} />
        </LinearGradient>
      </Pressable>

      {user ? (
        <AddEventSheet open={addOpen} onClose={() => setAddOpen(false)} userId={user.id} jobs={jobs} editEvent={editEvent} />
      ) : null}
    </View>
  )
}
