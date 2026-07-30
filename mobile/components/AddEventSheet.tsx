// mobile/components/AddEventSheet.tsx, schedule a job event in a bottom sheet.
// Mirrors web src/components/AddEventSheet.tsx: title, date, time, optional
// linked job, and an optional recurrence ("every N days × M"). Handles both
// create (with recurrence) and edit/delete of an existing event.
import { useEffect, useState } from 'react'
import { View, Text, Pressable, ScrollView, Alert } from 'react-native'
import { useCreateEvent, useUpdateEvent, useDeleteEvent, type ScheduleEvent, type JobRow } from '../lib/queries'
import { BottomSheet, SheetField, GoldButton, theme } from './ui'

function pad(n: number) { return String(n).padStart(2, '0') }
function dateField(d: Date) { return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}` }
function toDate(dateStr: string, timeStr: string): Date | null {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr.trim())
  const tm = /^(\d{1,2}):(\d{2})$/.exec(timeStr.trim())
  if (!dm || !tm) return null
  const hh = Number(tm[1]); const mm = Number(tm[2])
  if (hh > 23 || mm > 59) return null
  const dt = new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), hh, mm, 0, 0)
  return isNaN(dt.getTime()) ? null : dt
}

type Props = {
  open: boolean
  onClose: () => void
  userId: string
  jobs: JobRow[]
  editEvent?: ScheduleEvent | null
}

export function AddEventSheet({ open, onClose, userId, jobs, editEvent }: Props) {
  const createEvent = useCreateEvent()
  const updateEvent = useUpdateEvent()
  const deleteEvent = useDeleteEvent()

  const [title, setTitle] = useState('')
  const [date, setDate] = useState(dateField(new Date()))
  const [time, setTime] = useState('09:00')
  const [jobId, setJobId] = useState<string | null>(null)
  const [recurs, setRecurs] = useState(false)
  const [recurDays, setRecurDays] = useState('7')
  const [recurCount, setRecurCount] = useState('4')
  const [saving, setSaving] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const editing = !!editEvent

  useEffect(() => {
    if (!open) return
    setErr(null); setRecurs(false); setRecurDays('7'); setRecurCount('4')
    if (editEvent) {
      setTitle(editEvent.title || '')
      const d = editEvent.start_at ? new Date(editEvent.start_at) : new Date()
      setDate(dateField(d)); setTime(`${pad(d.getHours())}:${pad(d.getMinutes())}`)
      setJobId(editEvent.contact_id ?? null)
    } else {
      setTitle(''); setDate(dateField(new Date())); setTime('09:00'); setJobId(null)
    }
  }, [open, editEvent])

  async function submit() {
    if (!title.trim() || saving) { if (!title.trim()) setErr('A title is required.'); return }
    const start = toDate(date, time)
    if (!start) { setErr('Use date year month day and time HH:MM.'); return }
    setSaving(true); setErr(null)
    if (editing && editEvent) {
      const { error } = await updateEvent({ id: editEvent.id, userId, title: title.trim(), startAt: start.toISOString(), contactId: jobId })
      setSaving(false)
      if (error) { setErr(error.message); return }
      onClose()
      return
    }
    const count = recurs ? Math.min(24, Math.max(1, parseInt(recurCount, 10) || 1)) : 1
    const stepDays = Math.max(1, parseInt(recurDays, 10) || 7)
    for (let i = 0; i < count; i++) {
      const at = new Date(start); at.setDate(start.getDate() + i * stepDays)
      const { error } = await createEvent({ userId, title: title.trim(), startAt: at.toISOString(), contactId: jobId ?? undefined })
      if (error) { setSaving(false); setErr(error.message); return }
    }
    setSaving(false)
    onClose()
  }

  function confirmDelete() {
    if (!editEvent) return
    Alert.alert('Delete event?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: async () => { await deleteEvent({ id: editEvent.id, userId }); onClose() } }
    ])
  }

  return (
    <BottomSheet open={open} onClose={onClose} title={editing ? 'Edit event' : 'New event'}>
      <SheetField label="Title" value={title} onChange={setTitle} placeholder="Site visit, install, inspection…" autoFocus={!editing} />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><SheetField label="Date" value={date} onChange={setDate} placeholder="year month day" /></View>
        <View style={{ width: 120 }}><SheetField label="Time" value={time} onChange={setTime} placeholder="09:00" /></View>
      </View>

      <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 8 }}>Link to job (optional)</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }} style={{ marginBottom: 14 }}>
        <Pressable onPress={() => setJobId(null)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: jobId === null ? theme.goldBright : theme.borderMid, backgroundColor: jobId === null ? `${theme.goldBright}26` : theme.bg }}>
          <Text style={{ color: jobId === null ? theme.goldBright : theme.inkMuted, fontSize: 14, fontWeight: '700' }}>None</Text>
        </Pressable>
        {jobs.slice(0, 40).map((j) => {
          const on = jobId === j.id
          return (
            <Pressable key={j.id} onPress={() => setJobId(j.id)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: on ? theme.goldBright : theme.borderMid, backgroundColor: on ? `${theme.goldBright}26` : theme.bg }}>
              <Text style={{ color: on ? theme.goldBright : theme.inkMuted, fontSize: 14, fontWeight: '700' }} numberOfLines={1}>{j.name || 'Untitled'}</Text>
            </Pressable>
          )
        })}
      </ScrollView>

      {!editing ? (
        <>
          <Pressable onPress={() => setRecurs((v) => !v)} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: recurs ? 12 : 18 }}>
            <View style={{ width: 22, height: 22, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: recurs ? theme.goldBright : theme.borderMid, backgroundColor: recurs ? theme.goldBright : 'transparent' }}>
              {recurs ? <Text style={{ color: theme.onGold, fontSize: 14, fontWeight: '900' }}>✓</Text> : null}
            </View>
            <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }}>Repeats</Text>
          </Pressable>
          {recurs ? (
            <View style={{ flexDirection: 'row', gap: 12, marginBottom: 18, alignItems: 'flex-end' }}>
              <View style={{ flex: 1 }}><SheetField label="Every N days" value={recurDays} onChange={setRecurDays} keyboardType="numeric" placeholder="7" /></View>
              <View style={{ flex: 1 }}><SheetField label="Occurrences" value={recurCount} onChange={setRecurCount} keyboardType="numeric" placeholder="4" /></View>
            </View>
          ) : null}
        </>
      ) : null}

      {err ? <Text style={{ color: theme.danger, fontSize: 14, marginBottom: 12 }}>{err}</Text> : null}
      <GoldButton label={editing ? 'Save event' : 'Create event'} onPress={submit} loading={saving} />
      {editing ? (
        <Pressable onPress={confirmDelete} style={{ borderRadius: 10, paddingVertical: 12, alignItems: 'center', marginTop: 12, borderWidth: 1, borderColor: 'rgba(192, 57, 43,0.3)', backgroundColor: 'rgba(192, 57, 43,0.10)' }}>
          <Text style={{ color: theme.danger, fontWeight: '700' }}>Delete event</Text>
        </Pressable>
      ) : null}
    </BottomSheet>
  )
}
