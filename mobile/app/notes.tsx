// mobile/app/notes.tsx, field notes: capture, link to a job, feed,
// and notes grouped by job. Mirrors the web Notes hub (persistent core).
import { useMemo, useState } from 'react'
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator, Alert, Modal } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Briefcase, Clock, Trash2, ChevronRight, Archive, Check, Sparkles, Flag } from 'lucide-react-native'
import { useNotesScreen, useSaveNote, useArchiveNote, useDeleteNoteGlobal, type NoteRow } from '../lib/queries'
import { claudeMessage, claudeText } from '../lib/anthropic'
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
  const [parsing, setParsing] = useState(false)
  const [parsed, setParsed] = useState<{ category: string | null; action: string | null; whenText: string | null } | null>(null)

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

  async function parseDraft() {
    if (!draft.trim() || parsing) return
    setParsing(true)
    try {
      const res = await claudeMessage({
        system: `You extract structured fields from a contractor's field note. Return ONLY one JSON object: {"category": one of ["note","follow-up","material","risk","measurement"] or null, "action": the single most important action item as a short string or null, "when_text": any date or timeframe mentioned (e.g. "Friday", "next week") or null}. No prose, JSON only.`,
        messages: [{ role: 'user', content: draft.trim() }],
        maxTokens: 300
      })
      const m = claudeText(res).match(/\{[\s\S]*\}/)
      if (m) {
        const p = JSON.parse(m[0])
        setParsed({ category: p.category || null, action: p.action || null, whenText: p.when_text || null })
      }
    } catch {
      Alert.alert('AI parse failed', 'Could not read that note. Check your connection or save it as entered.')
    } finally {
      setParsing(false)
    }
  }

  async function onSave() {
    if (!draft.trim() || !user) return
    setSaving(true)
    const { error } = await saveNote({
      userId: user.id, text: draft.trim(), contactId,
      category: parsed?.category, action: parsed?.action, whenText: parsed?.whenText
    })
    setSaving(false)
    if (error) { Alert.alert("Couldn't save", error.message); return }
    setDraft(''); setContactId(null); setParsed(null)
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
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }} keyboardShouldPersistTaps="handled">
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
              style={{ color: theme.ink, fontSize: 14, lineHeight: 22, minHeight: 84, textAlignVertical: 'top' }}
            />
            {parsed ? (
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
                {parsed.category ? <Chip icon={<Sparkles color={theme.goldBright} size={11} />} text={parsed.category} /> : null}
                {parsed.action ? <Chip icon={<Flag color={theme.success} size={11} />} text={parsed.action} tint={theme.success} /> : null}
                {parsed.whenText ? <Chip icon={<Clock color="#5C5C5C" size={11} />} text={parsed.whenText} tint="#5C5C5C" /> : null}
              </View>
            ) : null}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: theme.border }}>
              <Pressable onPress={() => setPickOpen(true)} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', gap: 8, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.borderMid }}>
                <Briefcase color={contactId ? theme.goldBright : theme.inkMuted} size={14} />
                <Text style={{ color: contactId ? theme.ink : theme.inkMuted, fontSize: 14, fontWeight: '600', flex: 1 }} numberOfLines={1}>{linkedName || 'No job link'}</Text>
              </Pressable>
              <Pressable onPress={parseDraft} disabled={!draft.trim() || parsing} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.borderGold, backgroundColor: `${theme.goldBright}14`, opacity: !draft.trim() || parsing ? 0.5 : 1 }}>
                {parsing ? <ActivityIndicator color={theme.goldBright} size="small" /> : <Sparkles color={theme.goldBright} size={14} />}
                <Text style={{ color: theme.goldBright, fontSize: 14, fontWeight: '800' }}>AI</Text>
              </Pressable>
              <Pressable onPress={onSave} disabled={!draft.trim() || saving} style={{ borderRadius: 10, overflow: 'hidden', opacity: !draft.trim() || saving ? 0.5 : 1 }}>
                <View style={{ paddingHorizontal: 16, paddingVertical: 12, backgroundColor: theme.goldBright }}>
                  <Text style={{ color: theme.onGold, fontWeight: '800', fontSize: 14 }}>{saving ? 'Saving…' : 'Save'}</Text>
                </View>
              </Pressable>
            </View>
          </View>
        </Card>

        {/* Stats */}
        {notes.length > 0 ? (
          <View style={{ flexDirection: 'row', gap: 16, marginBottom: 18, paddingHorizontal: 4 }}>
            <Stat label="Total" value={notes.length} />
            <Stat label="24h" value={recent24} />
            <Stat label="Linked" value={linkedGroups.length} tone={theme.goldBright} />
          </View>
        ) : null}

        {isLoading ? (
          <ActivityIndicator color={theme.goldBright} style={{ marginTop: 16 }} />
        ) : (
          <>
            <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 12 }}>Recent activity</Text>
            {recent.length === 0 ? (
              <Text style={{ color: theme.inkMuted, fontSize: 14 }}>Nothing logged yet. Use the capture above.</Text>
            ) : (
              <View style={{ gap: 12 }}>
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
                <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginTop: 26, marginBottom: 12 }}>Linked to jobs</Text>
                <View style={{ gap: 16 }}>
                  {linkedGroups.map((g) => (
                    <View key={g.id}>
                      <Pressable onPress={() => router.push(`/jobs/${g.id}`)} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 10, borderWidth: 1, borderColor: theme.borderMid, backgroundColor: 'rgba(242, 237, 228,0.04)', marginBottom: 8 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
                          <Briefcase color={theme.goldBright} size={15} />
                          <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700', flex: 1 }} numberOfLines={1}>{g.name}</Text>
                          <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase' }}>{g.items.length} note{g.items.length === 1 ? '' : 's'}</Text>
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
        <Pressable onPress={() => setPickOpen(false)} style={{ flex: 1, backgroundColor: 'rgba(20, 20, 20,0.6)', justifyContent: 'flex-end' }}>
          <Pressable onPress={(e) => e.stopPropagation()} style={{ backgroundColor: theme.surface2, borderTopLeftRadius: 24, borderTopRightRadius: 24, paddingBottom: insets.bottom + 16, maxHeight: '70%' }}>
            <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '700', padding: 24, paddingBottom: 12 }}>Link to a job</Text>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12 }}>
              <Pressable onPress={() => { setContactId(null); setPickOpen(false) }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 10, marginBottom: 6, backgroundColor: 'rgba(242, 237, 228,0.03)' }}>
                <Text style={{ color: theme.ink, fontSize: 14 }}>No job link</Text>
                {contactId === null ? <Check color={theme.goldBright} size={18} /> : null}
              </Pressable>
              {contacts.map((c) => (
                <Pressable key={c.id} onPress={() => { setContactId(c.id); setPickOpen(false) }} style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, borderRadius: 10, marginBottom: 6, backgroundColor: 'rgba(242, 237, 228,0.03)' }}>
                  <Text style={{ color: theme.ink, fontSize: 14, flex: 1 }} numberOfLines={1}>{c.name || 'Unnamed'}</Text>
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
    <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
      <Text style={{ color: tone, fontSize: 20, fontWeight: '800' }}>{value}</Text>
      <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase' }}>{label}</Text>
    </View>
  )
}

function Chip({ icon, text, tint = theme.goldBright }: { icon: React.ReactNode; text: string; tint?: string }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: `${tint}55`, backgroundColor: `${tint}14` }}>
      {icon}
      <Text style={{ color: theme.ink, fontSize: 12, fontWeight: '600' }} numberOfLines={1}>{text}</Text>
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
      <Pressable onPress={onTap} style={{ padding: 12, paddingLeft: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
          <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '600', flex: 1, lineHeight: 20 }}>{title}</Text>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
            <Clock color={theme.inkMuted} size={11} />
            <Text style={{ color: theme.inkMuted, fontSize: 12 }}>{relTime(note.createdAt)}</Text>
          </View>
        </View>
        {showBody ? <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 6, lineHeight: 19 }} numberOfLines={3}>{body}</Text> : null}
        {note.action ? (
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 10, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, backgroundColor: 'rgba(45, 122, 79,0.10)', borderWidth: 1, borderColor: 'rgba(45, 122, 79,0.3)' }}>
            <Flag color={theme.success} size={12} />
            <Text style={{ color: theme.ink, fontSize: 12, fontWeight: '600', flex: 1 }} numberOfLines={2}>{note.action}{note.whenText ? ` · ${note.whenText}` : ''}</Text>
          </View>
        ) : null}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 12 }}>
          {!hideJobChip && contactName ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: theme.borderMid }}>
              <Briefcase color={theme.goldBright} size={10} />
              <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', textTransform: 'uppercase', letterSpacing: 0 }}>{contactName}</Text>
            </View>
          ) : <View style={{ flex: 1 }} />}
          <View style={{ flex: hideJobChip || !contactName ? 0 : 1 }} />
          <Pressable onPress={onArchive} hitSlop={8} style={{ padding: 8 }}><Archive color={theme.inkMuted} size={15} /></Pressable>
          <Pressable onPress={onDelete} hitSlop={8} style={{ padding: 8 }}><Trash2 color={theme.danger} size={15} /></Pressable>
        </View>
      </Pressable>
    </Card>
  )
}
