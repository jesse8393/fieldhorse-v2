// mobile/components/InvitePartnerSheet.tsx — invite a partner/sub to a job.
// Mirrors web src/components/InvitePartnerSheet.tsx: pick a job, enter the
// partner's email (+ optional name/role), POST to the partner-invite
// Netlify function, then surface the invite link to copy or share if the
// server didn't email it directly.
import { useEffect, useState } from 'react'
import { View, Text, Pressable, ScrollView, Share, ActivityIndicator } from 'react-native'
import * as Clipboard from 'expo-clipboard'
import { Copy, Share2, Check } from 'lucide-react-native'
import type { JobRow } from '../lib/queries'
import { BottomSheet, SheetField, GoldButton, theme } from './ui'
import { supabase } from '../lib/supabase'

const API_BASE = (process.env.EXPO_PUBLIC_API_BASE_URL as string) || 'https://fieldhorse.io'
const ROLES = [
  { value: 'subcontractor', label: 'Sub' },
  { value: 'gc', label: 'GC' },
  { value: 'partner', label: 'Partner' }
]

type Props = { open: boolean; onClose: () => void; userId: string; jobs: JobRow[]; defaultJobId?: string }

export function InvitePartnerSheet({ open, onClose, userId, jobs, defaultJobId }: Props) {
  const [jobId, setJobId] = useState<string | null>(defaultJobId ?? null)
  const [email, setEmail] = useState('')
  const [name, setName] = useState('')
  const [role, setRole] = useState('subcontractor')
  const [sending, setSending] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [readyUrl, setReadyUrl] = useState<string | null>(null)
  const [sentMsg, setSentMsg] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!open) return
    setJobId(defaultJobId ?? null); setEmail(''); setName(''); setRole('subcontractor')
    setErr(null); setReadyUrl(null); setSentMsg(null); setCopied(false)
  }, [open, defaultJobId])

  async function send() {
    const trimmed = email.trim().toLowerCase()
    if (!jobId) { setErr('Pick a job to share.'); return }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) { setErr('Enter a valid email.'); return }
    if (sending) return
    setSending(true); setErr(null); setReadyUrl(null); setSentMsg(null)
    try {
      // partner-invite now requires a Supabase JWT matching invited_by_user_id.
      const { data: sess } = await supabase.auth.getSession()
      const token = sess.session?.access_token
      const res = await fetch(`${API_BASE}/api/partner-invite`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {})
        },
        body: JSON.stringify({
          job_id: jobId,
          invited_by_user_id: userId,
          partner_email: trimmed,
          partner_name: name.trim() || null,
          partner_role: role || null,
          send_email: true
        })
      })
      const data = await res.json().catch(() => ({}))
      if (!res.ok) throw new Error(data?.detail || data?.error || `Request failed (${res.status})`)
      if (data?.sent) {
        setSentMsg(`Invite emailed to ${name.trim() || trimmed}.`)
      } else if (data?.invite_url) {
        setReadyUrl(data.invite_url)
      } else {
        setSentMsg(`Invite created for ${trimmed}.`)
      }
    } catch (e) {
      setErr((e as Error).message || 'Could not send invite.')
    } finally {
      setSending(false)
    }
  }

  async function copy() {
    if (!readyUrl) return
    await Clipboard.setStringAsync(readyUrl)
    setCopied(true); setTimeout(() => setCopied(false), 2000)
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="Invite a partner">
      {readyUrl ? (
        <>
          <Text style={{ color: theme.ink, fontSize: 15, fontWeight: '700', marginBottom: 6 }}>Invite link ready</Text>
          <Text style={{ color: theme.inkMuted, fontSize: 13, marginBottom: 14 }}>Email sending isn't configured — share this link with your partner.</Text>
          <View style={{ backgroundColor: theme.bg, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 12, padding: 14, marginBottom: 16 }}>
            <Text style={{ color: theme.goldBright, fontSize: 13 }} numberOfLines={2}>{readyUrl}</Text>
          </View>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <Pressable onPress={copy} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, paddingVertical: 13, borderWidth: 1, borderColor: theme.borderMid }}>
              {copied ? <Check color={theme.success} size={16} /> : <Copy color={theme.ink} size={16} />}
              <Text style={{ color: copied ? theme.success : theme.ink, fontWeight: '700' }}>{copied ? 'Copied' : 'Copy'}</Text>
            </Pressable>
            <Pressable onPress={() => Share.share({ message: readyUrl })} style={{ flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 7, borderRadius: 12, paddingVertical: 13, backgroundColor: theme.goldBright }}>
              <Share2 color={theme.onGold} size={16} />
              <Text style={{ color: theme.onGold, fontWeight: '800' }}>Share</Text>
            </Pressable>
          </View>
        </>
      ) : sentMsg ? (
        <>
          <View style={{ alignItems: 'center', paddingVertical: 12 }}>
            <View style={{ width: 52, height: 52, borderRadius: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(91,185,122,0.14)', borderWidth: 1, borderColor: 'rgba(91,185,122,0.4)' }}>
              <Check color={theme.success} size={26} />
            </View>
            <Text style={{ color: theme.ink, fontSize: 16, fontWeight: '700', marginTop: 12, textAlign: 'center' }}>{sentMsg}</Text>
          </View>
          <GoldButton label="Done" onPress={onClose} />
        </>
      ) : (
        <>
          <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Job to share</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }} style={{ marginBottom: 14 }}>
            {jobs.slice(0, 40).map((j) => {
              const on = jobId === j.id
              return (
                <Pressable key={j.id} onPress={() => setJobId(j.id)} style={{ paddingHorizontal: 14, paddingVertical: 9, borderRadius: 999, borderWidth: 1, borderColor: on ? theme.goldBright : theme.borderMid, backgroundColor: on ? `${theme.goldBright}26` : theme.bg }}>
                  <Text style={{ color: on ? theme.goldBright : theme.inkMuted, fontSize: 13, fontWeight: '700' }} numberOfLines={1}>{j.name || 'Untitled'}</Text>
                </Pressable>
              )
            })}
          </ScrollView>

          <SheetField label="Partner email *" value={email} onChange={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="partner@email.com" />
          <SheetField label="Name" value={name} onChange={setName} placeholder="Partner or company name" />

          <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>Role</Text>
          <View style={{ flexDirection: 'row', gap: 8, marginBottom: 18 }}>
            {ROLES.map((r) => {
              const on = role === r.value
              return (
                <Pressable key={r.value} onPress={() => setRole(r.value)} style={{ flex: 1, alignItems: 'center', paddingVertical: 11, borderRadius: 12, borderWidth: 1, borderColor: on ? theme.goldBright : theme.borderMid, backgroundColor: on ? `${theme.goldBright}26` : theme.bg }}>
                  <Text style={{ color: on ? theme.goldBright : theme.inkMuted, fontSize: 14, fontWeight: '700' }}>{r.label}</Text>
                </Pressable>
              )
            })}
          </View>

          {err ? <Text style={{ color: theme.danger, fontSize: 13, marginBottom: 12 }}>{err}</Text> : null}
          <GoldButton label={sending ? 'Sending…' : 'Send invite'} onPress={send} loading={sending} />
        </>
      )}
    </BottomSheet>
  )
}
