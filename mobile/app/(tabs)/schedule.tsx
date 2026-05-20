// mobile/app/(tabs)/schedule.tsx — upcoming schedule.
// Uses the shared useUpcomingEvents() hook and groups events by day, the
// same shape the web Schedule upcoming rail uses. A floating "+" opens a
// sheet to create an event (title + date + time + optional linked job);
// tapping an event opens the same sheet to edit it. A 7/30-day range
// toggle widens the window.
import { useMemo, useState } from 'react'
import {
  View, Text, SectionList, ActivityIndicator, Pressable, Modal,
  TextInput, KeyboardAvoidingView, Platform, Alert, ScrollView
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Plus } from 'lucide-react-native'
import {
  useUpcomingEvents, useCreateEvent, useDeleteEvent, useUpdateEvent,
  useJobs, type ScheduleEvent
} from '../../lib/queries'
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

function dateField(d: Date) {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
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
  const [range, setRange] = useState<7 | 30>(7)
  const { data: events = [], isLoading } = useUpcomingEvents(user?.id, range)
  const { data: jobs = [] } = useJobs()
  const createEvent = useCreateEvent()
  const updateEvent = useUpdateEvent()
  const deleteEvent = useDeleteEvent()

  const [addOpen, setAddOpen] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(dateField(new Date()))
  const [time, setTime] = useState('09:00')
  const [jobId, setJobId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  function openCreate() {
    setEditingId(null)
    setTitle(''); setDate(dateField(new Date())); setTime('09:00'); setJobId(null)
    setErr(null); setAddOpen(true)
  }

  function openEdit(e: ScheduleEvent) {
    setEditingId(e.id)
    setTitle(e.title || '')
    const d = e.start_at ? new Date(e.start_at) : new Date()
    setDate(dateField(d))
    setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
    setJobId(e.contact_id ?? null)
    setErr(null); setAddOpen(true)
  }

  async function submitEvent() {
    if (!title.trim() || !user || saving) return
    const startAt = toIso(date, time)
    if (!startAt) { setErr('Use date YYYY-MM-DD and time HH:MM.'); return }
    setErr(null)
    setSaving(true)
    const { error } = editingId
      ? await updateEvent({ id: editingId, userId: user.id, title: title.trim(), startAt, contactId: jobId })
      : await createEvent({ userId: user.id, title: title.trim(), startAt, contactId: jobId ?? undefined })
    setSaving(false)
    if (error) { setErr(error.message); return }
    setAddOpen(false)
  }

  function confirmDelete() {
    if (!user || !editingId) return
    Alert.alert('Delete event?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete', style: 'destructive',
        onPress: async () => {
          await deleteEvent({ id: editingId, userId: user.id })
          setAddOpen(false)
        }
      }
    ])
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
      <View className="px-5 pb-3 flex-row items-end justify-between">
        <View>
          <Text className="text-gold-bright text-[10px] font-bold tracking-[2px] uppercase">Schedule</Text>
          <Text className="text-ink text-3xl font-bold">Next {range} days</Text>
        </View>
        <View className="flex-row" style={{ gap: 6 }}>
          {([7, 30] as const).map((r) => {
            const active = range === r
            return (
              <Pressable
                key={r}
                onPress={() => setRange(r)}
                className="rounded-full px-3 py-1.5 border"
                style={{ borderColor: active ? '#E8B865' : 'rgba(255,240,210,0.12)', backgroundColor: active ? '#E8B865' : 'transparent' }}
              >
                <Text className="text-xs font-bold" style={{ color: active ? '#1A120A' : '#9b948a' }}>{r}d</Text>
              </Pressable>
            )
          })}
        </View>
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
            <Pressable
              onPress={() => openEdit(item)}
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
            </Pressable>
          )}
          ListEmptyComponent={
            <Text className="text-ink-muted text-center mt-12">A clear stretch — nothing scheduled.</Text>
          }
          ListFooterComponent={
            events.length ? <Text className="text-ink-muted text-[10px] text-center mt-4">Tap an event to edit or delete.</Text> : null
          }
        />
      )}

      {/* Floating add button */}
      <Pressable
        onPress={openCreate}
        className="absolute items-center justify-center rounded-full"
        style={{
          right: 20, bottom: insets.bottom + 20, width: 56, height: 56,
          backgroundColor: '#E8B865', shadowColor: '#000', shadowOpacity: 0.4,
          shadowRadius: 12, shadowOffset: { width: 0, height: 6 }, elevation: 8
        }}
      >
        <Plus color="#1A120A" size={26} strokeWidth={2.6} />
      </Pressable>

      {/* Create/edit event modal */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setAddOpen(false)} />
          <View className="bg-surface rounded-t-3xl p-6 border-t border-[rgba(255,240,210,0.10)]" style={{ paddingBottom: insets.bottom + 24 }}>
            <Text className="text-ink text-xl font-bold mb-5">{editingId ? 'Edit event' : 'New event'}</Text>
            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Title</Text>
            <TextInput
              value={title}
              onChangeText={setTitle}
              placeholder="Site visit, install, inspection…"
              placeholderTextColor="rgba(242,237,228,0.4)"
              autoFocus={!editingId}
              className="bg-bg border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
            />
            <View className="flex-row mb-4" style={{ gap: 12 }}>
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

            <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">Link to job (optional)</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }} style={{ marginBottom: 4 }}>
              <Pressable
                onPress={() => setJobId(null)}
                className="rounded-full px-3.5 py-2 border"
                style={{ borderColor: jobId === null ? '#E8B865' : 'rgba(255,240,210,0.12)', backgroundColor: jobId === null ? '#E8B865' : 'transparent' }}
              >
                <Text className="text-xs font-bold" style={{ color: jobId === null ? '#1A120A' : '#9b948a' }}>None</Text>
              </Pressable>
              {jobs.slice(0, 30).map((j) => {
                const active = jobId === j.id
                return (
                  <Pressable
                    key={j.id}
                    onPress={() => setJobId(j.id)}
                    className="rounded-full px-3.5 py-2 border"
                    style={{ borderColor: active ? '#E8B865' : 'rgba(255,240,210,0.12)', backgroundColor: active ? '#E8B865' : 'transparent' }}
                  >
                    <Text className="text-xs font-bold" style={{ color: active ? '#1A120A' : '#9b948a' }} numberOfLines={1}>
                      {j.name || 'Untitled'}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>

            {err ? <Text className="text-[#f5a294] text-xs mt-3">{err}</Text> : null}
            <Pressable
              onPress={submitEvent}
              disabled={saving}
              className="rounded-xl py-4 items-center mt-5"
              style={{ backgroundColor: saving ? 'rgba(232,184,101,0.5)' : '#E8B865' }}
            >
              {saving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">{editingId ? 'Save event' : 'Create event'}</Text>}
            </Pressable>
            {editingId ? (
              <Pressable onPress={confirmDelete} className="rounded-xl py-3.5 items-center mt-3 border border-[rgba(232,90,87,0.3)]" style={{ backgroundColor: 'rgba(232,90,87,0.10)' }}>
                <Text className="text-[#f5a294] font-bold">Delete event</Text>
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}
