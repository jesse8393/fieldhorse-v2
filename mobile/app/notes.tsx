// mobile/app/notes.tsx — field notes: capture, link to a job, feed,
// and notes grouped by job. Mirrors the web Notes hub (persistent core).
import { useMemo, useState } from 'react'
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Modal } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Briefcase, Clock, Trash2, ChevronRight, Archive, Check } from 'lucide-react-native'
import { useNotesScreen, useSaveNote, useArchiveNote, useDeleteNoteGlobal, type NoteRow } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'
import { ScreenBackground, Card, ScreenHeader, theme } from '../components/ui'

function relTime(iso: string | null) {
  if (!iso) return ''
  const diff = Date.now() - new Date(iso).getTime()
  const m = Math.floor(diff / 60000)
  if (m < 1) return 'Just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  const d = Math.floor(h / 24)
  if (d === 1) return 'Yesterday'
  if (d < 7) return `${d}d ago`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function NotesScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data, isLoading } = useNotesScreen(user?.id)
  const saveNote = useSaveNote()
  const archiveNote = useArchiveNote()
  const deleteNote = useDeleteNoteGlobal()

  const [draft, setDraft] = useState('')
  const [contactId, setContactId] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [pickOpen, setPickOpen] = useState(false)

  const notes = data?.notes ?? []
  const contacts = data?.contacts ?? []
  const recent = useMemo(() => notes.slice(0, 8), [notes])
  const linkedName = contacts.find((c) => c.id === contactId)?.name

  const recent24 = useMemo(() => notes.filter((n) => n.createdAt && Date.now() - new Date(n.createdAt).getTime() < 86400000).length, [notes])

  const linkedGroups = useMemo(() => {
    const map = new Map<string, { id: string; name: string | null; items: NoteRow[] }>()
    for (const n of notes) {
      if (!n.contactId) continue
      let g = map.get(n.contactId)
      if (!g) { g = { id: n.contactId, name: contacts.find((c) => c.id === n.contactId)?.name ?? 'Unknown job', items: [] }; map.set(n.contactId, g) }
      g.items.push(n)
    }
    return Array.from(map.values())
  }, [notes, contacts])

  async function onSave() {
    if (!draft.trim() || !user) return
    setSaving(true)
    const { error } = await saveNote({ userId: user.id, text: draft.trim(), contactId })
    setSaving(false)
    if (error) { Alert.alert("Couldn't save", error.message); return }
    setDraft(''); setContactId(null)
  }

  function confirmDelete(id: string) {
    Alert.alert('Delete note?', 'This cannot be undone.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Delete', style: 'destructive', onPress: () => user && deleteNote({ id, userId: user.id }) }
    ])
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader backLabel="More" onBack={() => router.back()} eyebrow="Field Notes" title="Notes, fast." />

        {/* Capture */}
        <Card glow style={{ marginTop: 16, marginBottom: 18 }}>
          <View style={{ padding: 16 }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              placeholder="Capture a note from the jobsite…"
              placeholderTextColor={theme.inkMuted}
              multiline
              style={{ color: theme.ink, fontSize: 15, lineHeight: 22, minHeight: 84, textAlignVertical: 'top' }}
            />
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.border }}>
              <Pressable onPress={() => setPickOpen(true)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 7, paddingHorizontal: 12, paddingVertical: 10, borderRadius: 10, borderWidth: 1, borderColor: theme.borderMid }}>
                <Briefcase color={contactId ? theme.goldBright : theme.inkMuted} size={14} />
                <Text style={{ color: contactId ? theme.ink : theme.inkMuted, fontSize: 13, fontWeight: '600', flex: 1 }} numberOfLines={1}>{linkedName || 'No job link'}</Text>
              </Pressable>
              <Pressable onPress={onSave} disabled={!draft.trim() || saving} style={{ borderRadius: 10, overflow: 'hidden', opacity: !draft.trim() || saving ? 0.5 : 1 }}>
                <View style={{ paddingHorizontal: 18, paddingVertical: 11, backgroundColor: theme.goldBright }}>
                  <Text style={{ color: theme.onGold, fontWeight: '800', fontSize: 13 }}>{saving ? 'Saving…' : 'Save'}</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </Card>

        {/* Stats */}
        {notes.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: 18, marginBottom: 18, paddingHorizontal: 4 }}>
            <Stat label="Total" value={notes.length} />
            <Stat label="24h" value={recent24} />
            <Stat label="Linked" value={linkedGroups.length} tone={theme.goldBright} />
          </View>
        ) : null}

        {isLoading ? (
          <ActivityIndicator color={theme.goldBright} style={{ marginTop: 16 }} />
        ) : (
          <>
            <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginBottom: 12 }}>Recent activity</Text>
            {recent.length === 0 ? (
              <Text style={{ color: theme.inkMuted, fontSize: 14 }}>Nothing logged yet. Use the capture above.</Text>
            ) : (
              <View style={{ gap: 10 }}>
                {recent.map((n) => (
                  <NoteCard key={n.id} note={n} contactName={contacts.find((c) => c.id === n.contactId)?.name ?? null}
                    onTap={() => n.contactId && router.push(`/jobs/${n.contactId}`)}
                    onArchive={() => user && archiveNote({ id: n.id, userId: user.id })}
                    onDelete={() => confirmDelete(n.id)} />
                ))}
              </View>
            )}

            {linkedGroups.length > 0 ? (
              <>
                <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 2, textTransform: 'uppercase', marginTop: 26, marginBottom: 12 }}>Linked to jobs</Text>
                <View style={{ gap: 18 }}>
                  {linkedGroups.map((g) => (
                    <View key={g.id}>
                      <Pressable onPress={() => router.push(`/jobs/${g.id}`)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 12, borderWidth: 1, borderColor: theme.borderMid, backgroundColor: 'rgba(255,240,210,0.04)', marginBottom: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9, flex: 1 }}>
                          <Briefcase color={theme.goldBright} size={15} />
                          <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700', flex: 1 }} numberOfLines={1}>{g.name}</Text>
                          <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 0.5, textTransform: 'uppercase' }}>{g.items.length} note{g.items.length === 1 ? '' : 's'}</Text>
                        </View>
                        <ChevronRight color={theme.inkMuted} size={16} />
                      </Pressable>
                      <View style={{ gap: 8 }}>
                        {g.items.slice(0, 3).map((n) => (
                          <NoteCard key={n.id} note={n} contactName={null} hideJobChip
                            onTap={() => router.push(`/jobs/${g.id}`)}
                            onArchive={() => user && archiveNote({ id: n.id, userId: user.id })}
                            onDelete={() => confirmDelete(n.id)} />
                        ))}
                      </View>
                    </View>
                  ))}
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>

      {/* Job picker */}
      <Modal visible={pickOpen} transparent animationType="slide" onRequestClose={() => setPickOpen(false)}>
        <Pressable onPress={() => setPickOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(0,0,0,0.6)', justifyContent: 'flex-end' }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: theme.surface2, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 16, maxHeight: '70%' }}>
            <Text style={{ color: theme.ink, fontSize: 17, fontWeight: '700', padding: 20, paddingBottom: 12 }}>Link to a job</Text>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <Pressable onPress={() => { setContactId(null); setPickOpen(false) }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 12, marginBottom: 6, backgroundColor: 'rgba(255,240,210,0.03)' }}>
                <Text style={{ color: theme.ink, fontSize: 15 }}>No job link</Text>
                {contactId === null ? <Check color={theme.goldBright} size={18} /> : null}
              </Pressable>
              {contacts.map((c) => (
                <Pressable key={c.id} onPress={() => { setContactId(c.id); setPickOpen(false) }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 14, borderRadius: 12, marginBottom: 6, backgroundColor: 'rgba(255,240,210,0.03)' }}>
                  <Text style={{ color: theme.ink, fontSize: 15, flex: 1 }} numberOfLines={1}>{c.name || 'Unnamed'}</Text>
                  {contactId === c.id ? <Check color={theme.goldBright} size={18} /> : null}
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  )
}

function Stat({ label, value, tone = theme.ink }: { label: string; value: number; tone?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 6 }}>
      <Text style={{ color: tone, fontSize: 22, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '800', letterSpacing: 1.5, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  )
}

function NoteCard({ note, contactName, hideJobChip, onTap, onArchive, onDelete }: {
  note: NoteRow; contactName: string | null; hideJobChip?: boolean; onTap: () => void; onArchive: () => void; onDelete: () => void
}) {
  const body = note.text || ''
  const firstLine = (body.split('\n').find((l) => l.trim()) || '').trim()
  const title = firstLine.slice(0, 90) || 'Untitled note'
  const showBody = body.trim() !== title.trim()
  return (
    <Card>
      <Pressable onPress={onTap} style={{ padding: 14, paddingLeft: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 10 }}>
          <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '600', flex: 1, lineHeight: 20 }}>{title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Clock color={theme.inkMuted} size={11} />
            <Text style={{ color: theme.inkMuted, fontSize: 11 }}>{relTime(note.createdAt)}</Text>
          </View>
        </View>
        {showBody ? <Text style={{ color: theme.inkMuted, fontSize: 13, marginTop: 6, lineHeight: 19 }} numberOfLines={3}>{body}</Text> : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
          {!hideJobChip && contactName ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, paddingHorizontal: 9, paddingVertical: 3, borderRadius: 999, borderWidth: 1, borderColor: theme.borderMid }}>
              <Briefcase color={theme.goldBright} size={10} />
              <Text style={{ color: theme.inkMuted, fontSize: 10, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0.5 }}>{contactName}</Text>
            </View>
          ) : <View style={{ flex: 1 }} />}
          <View style={{ flex: hideJobChip || !contactName ? 0 : 1 }} />
          <Pressable onPress={onArchive} hitSlop={8} style={{ padding: 6 }}><Archive color={theme.inkMuted} size={15} /></Pressable>
          <Pressable onPress={onDelete} hitSlop={8} style={{ padding: 6 }}><Trash2 color={theme.danger} size={15} /></Pressable>
        </View>
      </Pressable>
    </Card>
  )
}
