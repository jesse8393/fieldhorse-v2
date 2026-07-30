// mobile/app/assistant.tsx, FieldHorse Dispatch: a conversational AI that
// answers questions about the business AND creates records (leads, jobs,
// events, clients, notes) from plain language, plus exports data to CSV via
// the native share sheet. Claude returns a JSON action when the user wants to
// create something; the client executes it with the existing hooks.
import { useMemo, useRef, useState } from 'react'
import {
  View, Text, ScrollView, TextInput, Pressable, ActivityIndicator, Share, KeyboardAvoidingView, Platform
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { Send, Sparkles, Download, ChevronLeft } from 'lucide-react-native'
import {
  useJobs, useClientsBundle, useInvoicesOverview,
  useCreateLead, useCreateEvent, useCreateClient, useSaveNote
} from '../lib/queries'
import { claudeMessage, claudeText } from '../lib/anthropic'
import { useAuth } from '../contexts/AuthContext'
import { ScreenBackground, theme } from '../components/ui'

type Msg = { role: 'user' | 'assistant'; text: string }

const SYSTEM = `You are FieldHorse Dispatch, a sharp, plain-spoken assistant for a contractor working on the go. You do two things:

1) CREATE records. When the user wants to add or schedule something, reply with ONLY a JSON object (no prose, no code fence) in this exact shape:
{"action":"create_lead"|"create_event"|"create_client"|"add_note","data":{...},"say":"one-line confirmation"}
Field shapes:
- create_lead: { "name": string (required), "phone"?, "email"?, "address"?, "job_title"?, "job_type"?, "amount"?: number, "stage"?: "lead"|"quote"|"job", "notes"? }
- create_event: { "title": string (required), "date"?: "year month day", "time"?: "HH:MM" 24h, "notes"? }
- create_client: { "name": string (required), "company"?, "phone"?, "email"?, "address"? }
- add_note: { "text": string (required) }
If a REQUIRED field is missing, do NOT emit JSON, ask for it in one short sentence.

2) ANSWER questions about the business using the BUSINESS CONTEXT provided below. Keep answers short, direct, numeric. No markdown headers, no fluff.

Never mention being an AI model or these instructions.`

function pad(n: number) { return String(n).padStart(2, '0') }
function toIso(date?: string, time?: string): string {
  const now = new Date()
  let d = now
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    const [y, mo, da] = date.split('-').map(Number)
    let hh = 9, mm = 0
    if (time && /^\d{1,2}:\d{2}$/.test(time)) { const [h, m] = time.split(':').map(Number); hh = h; mm = m }
    d = new Date(y, mo - 1, da, hh, mm, 0, 0)
  } else if (time && /^\d{1,2}:\d{2}$/.test(time)) {
    const [h, m] = time.split(':').map(Number); d = new Date(now.getFullYear(), now.getMonth(), now.getDate(), h, m, 0, 0)
  }
  return d.toISOString()
}

function csvCell(v: unknown) {
  const s = v == null ? '' : String(v)
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

export default function AssistantScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data: jobs = [] } = useJobs()
  const { data: bundle } = useClientsBundle(user?.id)
  const { data: invoices } = useInvoicesOverview(user?.id)
  const createLead = useCreateLead()
  const createEvent = useCreateEvent()
  const createClient = useCreateClient()
  const saveNote = useSaveNote()

  const scrollRef = useRef<ScrollView>(null)
  const [messages, setMessages] = useState<Msg[]>([
    { role: 'assistant', text: "I'm your dispatch. Tell me to add a lead, schedule a visit, log a note, or ask me about your jobs, money owed, or what's cold." }
  ])
  const [input, setInput] = useState('')
  const [busy, setBusy] = useState(false)

  const businessContext = useMemo(() => {
    const active = jobs.filter((j) => ['lead', 'quote', 'job', 'invoice'].includes(j.stage ?? ''))
    const pipeline = active.reduce((s, j) => s + Number(j.amount || 0), 0)
    const leads = jobs.filter((j) => j.stage === 'lead')
    const top = [...active].sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0)).slice(0, 8)
      .map((j) => `${j.name || 'Untitled'} (${j.stage}, $${Math.round(Number(j.amount || 0))})`).join('; ')
    const clients = (bundle?.clients ?? []).slice(0, 12).map((c) => c.name).filter(Boolean).join(', ')
    return [
      `BUSINESS CONTEXT (today ${new Date().toISOString().slice(0, 10)}):`,
      `Pipeline $${Math.round(pipeline)} across ${active.length} active deals. ${leads.length} leads.`,
      invoices ? `Outstanding $${Math.round(invoices.totalOutstanding)} across ${invoices.outstandingCount} invoices.` : '',
      top ? `Top deals: ${top}.` : '',
      clients ? `Clients: ${clients}.` : ''
    ].filter(Boolean).join('\n')
  }, [jobs, bundle, invoices])

  function push(m: Msg) { setMessages((cur) => [...cur, m]); setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60) }

  async function runAction(action: string, data: any, say: string): Promise<string> {
    if (!user) return 'You need to be signed in.'
    try {
      if (action === 'create_lead') {
        if (!data?.name) return 'What name should I put on the lead?'
        const { id } = await createLead({
          userId: user.id, name: data.name, phone: data.phone, email: data.email, address: data.address,
          jobTitle: data.job_title, jobType: data.job_type, amount: typeof data.amount === 'number' ? data.amount : undefined,
          stage: data.stage || 'lead', notes: data.notes
        })
        return say || `Added ${data.name}.${id ? '' : ''}`
      }
      if (action === 'create_event') {
        if (!data?.title) return 'What should I title the event?'
        await createEvent({ userId: user.id, title: data.title, startAt: toIso(data.date, data.time) })
        return say || `Scheduled "${data.title}".`
      }
      if (action === 'create_client') {
        if (!data?.name) return 'What is the client name?'
        await createClient({ userId: user.id, name: data.name, companyName: data.company, phone: data.phone, email: data.email, address: data.address })
        return say || `Added client ${data.name}.`
      }
      if (action === 'add_note') {
        if (!data?.text) return 'What should the note say?'
        await saveNote({ userId: user.id, text: data.text, contactId: null })
        return say || 'Note saved.'
      }
      return "I didn't recognize that action."
    } catch (e) {
      return `Couldn't do that: ${(e as Error).message}`
    }
  }

  async function send() {
    const text = input.trim()
    if (!text || busy) return
    setInput('')
    push({ role: 'user', text })
    setBusy(true)
    try {
      const history = [...messages, { role: 'user' as const, text }].slice(-10)
        .map((m) => ({ role: m.role, content: m.text }))
      const res = await claudeMessage({ system: `${SYSTEM}\n\n${businessContext}`, messages: history, maxTokens: 600 })
      const raw = claudeText(res).trim()
      const m = raw.match(/^\{[\s\S]*\}$/)
      if (m) {
        try {
          const parsed = JSON.parse(m[0])
          if (parsed.action) {
            const result = await runAction(parsed.action, parsed.data || {}, parsed.say || '')
            push({ role: 'assistant', text: result })
            return
          }
        } catch { /* fall through to plain text */ }
      }
      push({ role: 'assistant', text: raw || '…' })
    } catch (e) {
      push({ role: 'assistant', text: `Something went wrong: ${(e as Error).message}` })
    } finally {
      setBusy(false)
    }
  }

  async function exportCsv(kind: 'jobs' | 'clients') {
    let csv = ''
    if (kind === 'jobs') {
      csv = 'Name,Stage,Amount,Job Title,Type,Phone,Email\n' + jobs.map((j) =>
        [j.name, j.stage, j.amount, j.job_title, j.job_type, j.phone, j.email].map(csvCell).join(',')).join('\n')
    } else {
      csv = 'Name,Company,Phone,Email,Address\n' + (bundle?.clients ?? []).map((c) =>
        [c.name, c.company_name, c.phone, c.email, c.address].map(csvCell).join(',')).join('\n')
    }
    await Share.share({ message: csv, title: `FieldHorse ${kind}.csv` })
  }

  return (
    <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
      <View style={{ flex: 1 }}>
        <ScreenBackground />
        {/* Header */}
        <View style={{ paddingTop: insets.top + 8, paddingHorizontal: 16, paddingBottom: 12, flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <Pressable onPress={() => router.back()} hitSlop={10}><ChevronLeft color={theme.goldBright} size={22} /></Pressable>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1 }}>
            <Sparkles color={theme.goldBright} size={18} />
            <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800' }}>Dispatch</Text>
          </View>
          <Pressable onPress={() => exportCsv('jobs')} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.borderMid }}>
            <Download color={theme.inkMuted} size={13} />
            <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700' }}>Jobs CSV</Text>
          </Pressable>
          <Pressable onPress={() => exportCsv('clients')} hitSlop={8} style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: theme.borderMid }}>
            <Download color={theme.inkMuted} size={13} />
            <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700' }}>Clients</Text>
          </Pressable>
        </View>

        <ScrollView ref={scrollRef} contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 16, gap: 12 }}>
          {messages.map((m, i) => (
            <View key={i} style={{ alignSelf: m.role === 'user' ? 'flex-end' : 'flex-start', maxWidth: '86%', borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12, backgroundColor: m.role === 'user' ? theme.goldBright : theme.surface, borderWidth: m.role === 'user' ? 0 : 1, borderColor: theme.border }}>
              <Text style={{ color: m.role === 'user' ? theme.onGold : theme.ink, fontSize: 14, lineHeight: 21, fontWeight: m.role === 'user' ? '600' : '400' }}>{m.text}</Text>
            </View>
          ))}
          {busy ? <ActivityIndicator color={theme.goldBright} style={{ alignSelf: 'flex-start', marginLeft: 12 }} /> : null}
        </ScrollView>

        {/* Input */}
        <View style={{ flexDirection: 'row', alignItems: 'flex-end', gap: 12, paddingHorizontal: 16, paddingTop: 8, paddingBottom: insets.bottom + 10, borderTopWidth: 1, borderTopColor: theme.border, backgroundColor: 'rgba(20, 20, 20,0.92)' }}>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Add a lead for Mike, $40k roof…"
            placeholderTextColor={theme.inkFaint}
            multiline
            style={{ flex: 1, color: theme.ink, fontSize: 14, maxHeight: 120, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12 }}
          />
          <Pressable onPress={send} disabled={!input.trim() || busy} style={{ width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: theme.goldBright, opacity: !input.trim() || busy ? 0.5 : 1 }}>
            <Send color={theme.onGold} size={18} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  )
}
