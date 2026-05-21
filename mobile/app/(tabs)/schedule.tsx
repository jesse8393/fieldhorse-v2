// mobile/app/(tabs)/schedule.tsx — upcoming schedule.
// Uses the shared useUpcomingEvents() hook and groups events by day, the
// same shape the web Schedule upcoming rail uses. A floating "+" opens a
// sheet to create an event (title + date + time + optional linked job);
// tapping an event opens the same sheet to edit it. A 7/30-day range
// toggle widens the window.
import { useMemo, useRef, useState } from 'react'
import {
  View, Text, SectionList, ActivityIndicator, Pressable, Modal,
  TextInput, KeyboardAvoidingView, Platform, Alert, ScrollView
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { LinearGradient } from 'expo-linear-gradient'
import { Plus } from 'lucide-react-native'
import {
  useUpcomingEvents, useCreateEvent, useDeleteEvent, useUpdateEvent,
  useJobs, type ScheduleEvent
} from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground, Card, Eyebrow, GoldButton, theme } from '../../components/ui'

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
        style={{ position: 'absolute', right: 20, bottom: insets.bottom + 20, borderRadius: 999, shadowColor: '#E8B865', shadowOpacity: 0.5, shadowRadius: 16, shadowOffset: { width: 0, height: 8 }, elevation: 12 }}
      >
        <LinearGradient colors={['#F0CE86', '#E4BE6F', '#C9963A']} start={{ x: 0, y: 0 }} end={{ x: 1, y: 1 }} style={{ width: 58, height: 58, borderRadius: 999, alignItems: 'center', justifyContent: 'center' }}>
          <Plus color={theme.onGold} size={26} strokeWidth={2.8} />
        </LinearGradient>
      </Pressable>

      {/* Create/edit event modal */}
      <Modal visible={addOpen} transparent animationType="slide" onRequestClose={() => setAddOpen(false)}>
        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable className="flex-1" onPress={() => setAddOpen(false)} />
          <View style={{ backgroundColor: theme.surface2, borderTopLeftRadius: 28, borderTopRightRadius: 28, padding: 24, borderTopWidth: 1, borderColor: theme.borderMid, paddingBottom: insets.bottom + 24 }}>
            <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', marginBottom: 20 }}>{editingId ? 'Edit event' : 'New event'}</Text>
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

            {err ? <Text style={{ color: theme.danger, fontSize: 12, marginTop: 12 }}>{err}</Text> : null}
            <View style={{ marginTop: 20 }}>
              <GoldButton label={editingId ? 'Save event' : 'Create event'} onPress={submitEvent} loading={saving} />
            </View>
            {editingId ? (
              <Pressable onPress={confirmDelete} style={{ borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: 'rgba(232,90,87,0.3)', backgroundColor: 'rgba(232,90,87,0.10)' }}>
                <Text style={{ color: theme.danger, fontWeight: '700' }}>Delete event</Text>
              </Pressable>
            ) : null}
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  )
}
