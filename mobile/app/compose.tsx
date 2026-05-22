// mobile/app/compose.tsx — AI message drafting.
//
// Native port of the web Compose screen. Picks a channel + intent (and
// optionally a job/contact for context), asks Claude for an on-brand
// draft, then copies it or hands off to the SMS / mail app via Linking.
// The web's server-side Resend send is omitted — the native deep-link
// handoff is the natural mobile path.
import { useMemo, useState } from 'react'
import {
  View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, Alert, Linking, Modal
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Clipboard from 'expo-clipboard'
import { Sparkles, MessageSquare, Mail, Mic, Copy, Send, Check } from 'lucide-react-native'
import { ScreenBackground, ScreenHeader, GoldButton, theme } from '../components/ui'
import { claudeMessage, claudeText } from '../lib/anthropic'
import { useJobs, useProfile, type JobRow } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'

const CHANNELS = [
  { id: 'sms', label: 'SMS', tone: 'Keep it under 160 chars. Tight. No emoji. Punctuation minimal.', Icon: MessageSquare },
  { id: 'email', label: 'Email', tone: 'Short subject line + 3-paragraph body. Professional. Signed off with the contractor name.', Icon: Mail },
  { id: 'voice', label: 'Voicemail', tone: 'Under 25 seconds spoken. Natural phrasing. Call-to-action clear.', Icon: Mic }
]

const INTENTS = [
  'First outreach to new lead',
  'Follow up after quote sent',
  'Reminder for scheduled job',
  'Change-order explanation',
  'Invoice overdue nudge',
  'Thank you after job close',
  'Weather delay notice'
]

export default function ComposeScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data: profile } = useProfile(user?.id)
  const { data: jobs = [] } = useJobs()

  const [channel, setChannel] = useState('sms')
  const [intent, setIntent] = useState(INTENTS[0])
  const [contactId, setContactId] = useState('')
  const [context, setContext] = useState('')
  const [draft, setDraft] = useState('')
  const [loading, setLoading] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)

  const contact = useMemo<JobRow | null>(() => jobs.find((j) => j.id === contactId) ?? null, [jobs, contactId])

  async function generate() {
    if (loading) return
    const ch = CHANNELS.find((c) => c.id === channel)
    setLoading(true); setDraft(''); setError(''); setCopied(false)
    try {
      const contactLine = contact
        ? `Recipient: ${contact.name}. Job: ${contact.job_title || contact.job_type || 'unknown'}. Stage: ${contact.stage}. Amount: $${contact.amount || 0}.`
        : 'Recipient: generic contact (not yet linked to a job).'
      const company = profile?.company_name || 'the contractor'
      const res = await claudeMessage({
        system: `You are a messaging assistant for a contractor's business. Write a ${ch?.label} message on behalf of ${company}. ${ch?.tone} Brand voice: jobsite-direct, no buzzwords, no naval metaphors ever, no "circle back". Sign off as ${company}; never mention any platform, app, or tool by name.`,
        messages: [{ role: 'user', content: `Intent: ${intent}\n${contactLine}\nExtra context: ${context || 'none'}\n\nReturn only the message text, no preamble.` }],
        maxTokens: 500
      })
      const text = claudeText(res)
      if (!text) throw new Error('Empty response from the assistant.')
      setDraft(text)
    } catch (e: any) {
      const msg = String(e?.message || '').toLowerCase()
      if (msg.includes('500') || msg.includes('api_key')) setError('AI not configured on the server (ANTHROPIC_API_KEY).')
      else if (msg.includes('failed') || msg.includes('network')) setError('Could not reach the AI endpoint. Check your connection.')
      else setError(e?.message || 'Draft generation failed.')
    } finally {
      setLoading(false)
    }
  }

  async function copy() {
    await Clipboard.setStringAsync(draft)
    setCopied(true)
    setTimeout(() => setCopied(false), 1800)
  }

  function send() {
    if (channel === 'sms') {
      const to = contact?.phone || ''
      Linking.openURL(`sms:${to}?body=${encodeURIComponent(draft)}`)
      return
    }
    if (channel === 'email') {
      const to = contact?.email || ''
      const subject = contact?.job_title ? `Re: ${contact.job_title}` : intent
      Linking.openURL(`mailto:${to}?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(draft)}`)
      return
    }
    Alert.alert('Voicemail script', 'Copy the script and read it when you call.')
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40, paddingHorizontal: 20 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader backLabel="Back" onBack={() => router.back()} eyebrow="Assistant" title="Compose" />
        <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 6, marginBottom: 20 }}>Draft an on-brand message, then copy or send it.</Text>

        <Text style={lbl}>Channel</Text>
        <View style={{ flexDirection: 'row', gap: 8 }}>
          {CHANNELS.map((c) => {
            const on = channel === c.id
            return (
              <Pressable key={c.id} onPress={() => setChannel(c.id)} style={[chip, on && chipOn, { flex: 1, flexDirection: 'row', justifyContent: 'center', gap: 6, alignItems: 'center' }]}>
                <c.Icon color={on ? theme.goldBright : theme.inkMuted} size={14} />
                <Text style={{ color: on ? theme.goldBright : theme.ink, fontSize: 13, fontWeight: '700' }}>{c.label}</Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={[lbl, { marginTop: 18 }]}>Intent</Text>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
          {INTENTS.map((it) => {
            const on = intent === it
            return (
              <Pressable key={it} onPress={() => setIntent(it)} style={[chip, on && chipOn]}>
                <Text style={{ color: on ? theme.goldBright : theme.ink, fontSize: 12, fontWeight: '700' }}>{it}</Text>
              </Pressable>
            )
          })}
        </View>

        <Text style={[lbl, { marginTop: 18 }]}>Link a job (optional)</Text>
        <Pressable onPress={() => setPickerOpen(true)} style={[input, { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }]}>
          <Text style={{ color: contact ? theme.ink : theme.inkFaint, fontSize: 14 }} numberOfLines={1}>
            {contact ? `${contact.name}${contact.job_title ? ` · ${contact.job_title}` : ''}` : 'No job linked'}
          </Text>
          {contact ? <Text onPress={() => setContactId('')} style={{ color: theme.inkMuted, fontSize: 13 }}>Clear</Text> : null}
        </Pressable>

        <Text style={[lbl, { marginTop: 18 }]}>Extra context (optional)</Text>
        <TextInput
          value={context}
          onChangeText={setContext}
          multiline
          placeholder="Anything specific to mention — dates, amounts, tone…"
          placeholderTextColor="rgba(242,237,228,0.4)"
          style={[input, { minHeight: 80, textAlignVertical: 'top' }]}
        />

        {error ? <Text style={{ color: theme.danger, fontSize: 14, marginTop: 16 }}>{error}</Text> : null}

        <View style={{ marginTop: 20 }}>
          <GoldButton label="Generate draft" onPress={generate} loading={loading} icon={<Sparkles color={theme.onGold} size={16} />} />
        </View>

        {draft ? (
          <View style={{ marginTop: 24 }}>
            <TextInput
              value={draft}
              onChangeText={setDraft}
              multiline
              style={[input, { minHeight: 140, textAlignVertical: 'top', fontSize: 15, lineHeight: 21 }]}
            />
            <View style={{ flexDirection: 'row', gap: 10, marginTop: 14 }}>
              <Pressable onPress={copy} style={[outlineBtn, { flex: 1 }]}>
                {copied ? <Check color={theme.success} size={16} /> : <Copy color={theme.goldBright} size={16} />}
                <Text style={{ color: theme.ink, fontWeight: '700' }}>{copied ? 'Copied' : 'Copy'}</Text>
              </Pressable>
              <Pressable onPress={send} style={[outlineBtn, { flex: 1 }]}>
                <Send color={theme.goldBright} size={16} />
                <Text style={{ color: theme.ink, fontWeight: '700' }}>{channel === 'email' ? 'Email' : channel === 'sms' ? 'Text' : 'Use'}</Text>
              </Pressable>
            </View>
          </View>
        ) : null}
      </ScrollView>

      <Modal visible={pickerOpen} transparent animationType="slide" onRequestClose={() => setPickerOpen(false)}>
        <View style={{ flex: 1, justifyContent: 'flex-end' }}>
          <Pressable style={{ flex: 1 }} onPress={() => setPickerOpen(false)} />
          <View style={{ backgroundColor: theme.surface, borderTopLeftRadius: 24, borderTopRightRadius: 24, borderTopWidth: 1, borderColor: theme.borderMid, maxHeight: '70%', paddingBottom: insets.bottom + 16 }}>
            <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800', padding: 24, paddingBottom: 12 }}>Link a job</Text>
            <ScrollView contentContainerStyle={{ paddingHorizontal: 16, paddingBottom: 12, gap: 6 }}>
              {jobs.map((j) => (
                <Pressable
                  key={j.id}
                  onPress={() => { setContactId(j.id); setPickerOpen(false) }}
                  style={{ backgroundColor: 'rgba(24,20,17,0.6)', borderRadius: 14, padding: 14, borderWidth: 1, borderColor: contactId === j.id ? theme.goldBright : theme.borderMid }}
                >
                  <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '600' }} numberOfLines={1}>{j.name}</Text>
                  <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 2 }} numberOfLines={1}>{j.job_title || j.job_type || j.stage}</Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  )
}

const lbl = { color: theme.inkMuted, fontSize: 11, fontWeight: '700' as const, letterSpacing: 1, textTransform: 'uppercase' as const, marginBottom: 8 }
const input = { backgroundColor: theme.surface, borderWidth: 1, borderColor: 'rgba(255,240,210,0.12)', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 12, color: theme.ink }
const chip = { backgroundColor: 'rgba(24,20,17,0.6)', borderWidth: 1, borderColor: theme.borderMid, borderRadius: 999, paddingHorizontal: 14, paddingVertical: 9 }
const chipOn = { borderColor: theme.goldBright, backgroundColor: 'rgba(232,184,101,0.14)' }
const outlineBtn = { flexDirection: 'row' as const, alignItems: 'center' as const, justifyContent: 'center' as const, gap: 8, backgroundColor: 'rgba(24,20,17,0.6)', borderWidth: 1, borderColor: theme.borderMid, borderRadius: 14, paddingVertical: 14 }
