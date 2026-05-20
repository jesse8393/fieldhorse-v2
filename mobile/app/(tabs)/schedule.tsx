// mobile/app/(tabs)/schedule.tsx — upcoming schedule (next 7 days).
// Uses the shared useUpcomingEvents() hook and groups events by day,
// the same shape the web Schedule upcoming rail uses. A floating "+"
// opens a sheet to create a new event (title + date + time).
import { useMemo, useState } from 'react'
import {
  View, Text, SectionList, ActivityIndicator, Pressable, Modal,
  TextInput, KeyboardAvoidingView, Platform
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Plus } from 'lucide-react-native'
import { useUpcomingEvents, useCreateEvent, type ScheduleEvent } from '../../lib/queries'
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

function pad(n: number) {
  return String(n).padStart(2, '0')
}

// Combine a YYYY-MM-DD date and HH:MM (24h) time into a local Date,
// returning its ISO string — or null if either field doesn't parse.
function toIso(dateStr: string, timeStr: string): string | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim())
  if (!dm || !tm) return null
  const [, y, mo, d] = dm
  const hh = Number(tm[1]); const mm = Number(tm[2])
  if (hh > 23 || mm > 59) return null
  const dt = new Date(Number(y), Number(mo) - 1, Number(d), hh, mm, 0, 0)
  if (isNaN(dt.getTime())) return null
  return dt.toISOString()
}

export default function ScheduleScreen() {
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const { data: events = [], isLoading } = useUpcomingEvents(user?.id)
  const createEvent = useCreateEvent()

  const [addOpen, setAddOpen] = useState(false)
  const [title, setTitle] = useState('')
  const today = new Date()
  const [date, setDate] = useState(`${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`)
  const [time, setTime] = useState('09:00')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  async function submitEvent() {
    if (!title.trim() || !user || saving) return
    const startAt = toIso(date, time)
    if (!startAt) { setErr('Use date YYYY-MM-DD and time HH:MM.'); return }
    setErr(null)
    setSaving(true)
    const { error } = await createEvent({ userId: user.id, title: title.trim(), startAt })
    setSaving(false)
    if (error) { setErr(error.message); return }
    setAddOpen(false)
    setTitle('')
  }

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

      {/* Floating add button */}
      <Pressable
        onPress={() => setAddOpen(true)}
        className="absolute items-center justify-center rounded-full"
        style={{
          right: 20, bottom: insets.bottom + 20, width: 56, height: 56,
          backgroundColor: '#E8B865', shadowColor: '#000', shadowOpacity: 0.4,
          shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8
        }}
      >
        <Plus color="#1A120A" size={26} strokeWidth={2.6} />
      </Pressable>

      {/* New event modal */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setAddOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-5">New event</Text>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Site visit, install, inspection…"
              placeholderTextColor="rgba(242,237,228,0.4)"
              autoFocus
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <View className="flex-row" style={{ gap: 12 }}>
              <View className="flex-1">
                <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Date</Text>
                <TextInput
                  value={date}
                  onChangeText={setDate}
                  placeholder="YYYY-MM-DD"
                  placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                />
              </View>
              <View style={{ width: 110 }}>
                <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Time</Text>
                <TextInput
                  value={time}
                  onChangeText={setTime}
                  placeholder="09:00"
                  placeholderTextColor="rgba(242,237,228,0.4)"
                  className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink"
                />
              </View>
            </View>
            {err ? <Text className="text-[#f5a294] text-xs mt-3">{err}</Text> : null}
            <Pressable
              onPress={submitEvent}
              disabled={saving}
              className="rounded-xl py-4 items-center mt-5"
              style={{ backgroundColor: saving ? 'rgba(232,184,101,0.5)' : '#E8B865' }}
            >
              {saving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">Create event</Text>}
            </Pressable>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}
