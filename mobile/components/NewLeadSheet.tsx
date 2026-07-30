// mobile/components/NewLeadSheet.tsx, full add-lead flow in a bottom sheet.
// Mirrors web src/components/NewLeadSheet.tsx: captures name/phone/email/
// address/job_title/job_type/stage/amount/notes/referred_by, remembers the
// last job_type, and offers a doc-intake button (camera or library photo of
// an estimate / lead card) that calls Claude vision to autofill the form.
// Rendered by both the Home "New lead" tile and the Jobs FAB.
import { useEffect, useState } from 'react'
import { View, Text, Pressable, ScrollView, ActivityIndicator, Alert } from 'react-native'
import * as ImagePicker from 'expo-image-picker'
import AsyncStorage from '@react-native-async-storage/async-storage'
import { ScanLine, Sparkles } from 'lucide-react-native'
import { useCreateLead } from '../lib/queries'
import { JOB_TYPES } from '../lib/jobTypes'
import { parseLeadFromImage } from '../lib/docIntelligence'
import { BottomSheet, SheetField, GoldButton, theme } from './ui'

const LAST_JOB_TYPE_KEY = 'fh:lastJobType'
const STAGES = [
  { value: 'lead', label: 'Lead' },
  { value: 'quote', label: 'Quote' },
  { value: 'job', label: 'Job' }
]

type Props = { open: boolean; onClose: () => void; userId: string; onCreated?: (id: string) => void }

export function NewLeadSheet({ open, onClose, userId, onCreated }: Props) {
  const createLead = useCreateLead()
  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [jobTitle, setJobTitle] = useState('')
  const [jobType, setJobType] = useState<string>('')
  const [stage, setStage] = useState('lead')
  const [amount, setAmount] = useState('')
  const [notes, setNotes] = useState('')
  const [referredBy, setReferredBy] = useState('')
  const [saving, setSaving] = useState(false)
  const [scanning, setScanning] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    if (open) AsyncStorage.getItem(LAST_JOB_TYPE_KEY).then((v) => { if (v) setJobType(v) })
  }, [open])

  function reset() {
    setName(''); setPhone(''); setEmail(''); setAddress(''); setJobTitle('')
    setStage('lead'); setAmount(''); setNotes(''); setReferredBy(''); setErr(null)
  }

  async function pickImage(fromCamera: boolean) {
    try {
      const perm = fromCamera
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync()
      if (!perm.granted) { Alert.alert('Permission needed', `Allow ${fromCamera ? 'camera' : 'photo'} access to scan a lead.`); return }
      const res = fromCamera
        ? await ImagePicker.launchCameraAsync({ base64: true, quality: 0.5 })
        : await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], base64: true, quality: 0.5 })
      if (res.canceled || !res.assets?.[0]?.base64) return
      const asset = res.assets[0]
      setScanning(true); setErr(null)
      const parsed = await parseLeadFromImage(`data:${asset.mimeType || 'image/jpeg'};base64,${asset.base64}`)
      if (parsed.name) setName(parsed.name)
      if (parsed.phone) setPhone(parsed.phone)
      if (parsed.email) setEmail(parsed.email)
      if (parsed.address) setAddress(parsed.address)
      if (parsed.job_title) setJobTitle(parsed.job_title)
      if (parsed.job_type) setJobType(parsed.job_type)
      if (parsed.amount) setAmount(String(parsed.amount))
      if (parsed.notes) setNotes(parsed.notes)
    } catch (e) {
      setErr((e as Error).message || 'Scan failed.')
    } finally {
      setScanning(false)
    }
  }

  function scan() {
    Alert.alert('Scan a lead', 'Photograph an estimate, lead card, or business card and AI will fill the form.', [
      { text: 'Take photo', onPress: () => pickImage(true) },
      { text: 'Choose from library', onPress: () => pickImage(false) },
      { text: 'Cancel', style: 'cancel' }
    ])
  }

  async function submit() {
    if (!name.trim() || saving) { if (!name.trim()) setErr('A name is required.'); return }
    setSaving(true); setErr(null)
    const amt = amount.trim() ? Number(amount.replace(/[^0-9.]/g, '')) : undefined
    const { id, error } = await createLead({
      userId,
      name: name.trim(),
      phone: phone.trim() || undefined,
      email: email.trim() || undefined,
      address: address.trim() || undefined,
      jobTitle: jobTitle.trim() || undefined,
      jobType: jobType || undefined,
      amount: amt && !isNaN(amt) ? amt : undefined,
      stage,
      notes: notes.trim() || undefined,
      referredBy: referredBy.trim() || undefined
    })
    setSaving(false)
    if (error) { setErr(error.message); return }
    if (jobType) AsyncStorage.setItem(LAST_JOB_TYPE_KEY, jobType)
    reset()
    onClose()
    if (id) onCreated?.(id)
  }

  return (
    <BottomSheet open={open} onClose={onClose} title="New lead">
      {/* Doc intake */}
      <Pressable
        onPress={scan}
        disabled={scanning}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 12, borderRadius: 10, padding: 12, marginBottom: 18, borderWidth: 1, borderColor: theme.borderGold, backgroundColor: `${theme.goldBright}14` }}
      >
        <View style={{ width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: `${theme.goldBright}1f`, borderWidth: 1, borderColor: theme.borderGold }}>
          {scanning ? <ActivityIndicator color={theme.goldBright} size="small" /> : <ScanLine color={theme.goldBright} size={18} />}
        </View>
        <View style={{ flex: 1 }}>
          <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '800' }}>{scanning ? 'Reading photo…' : 'Scan an estimate or lead card'}</Text>
          <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 1 }}>AI fills the form from a photo</Text>
        </View>
        <Sparkles color={theme.goldBright} size={16} />
      </Pressable>

      <SheetField label="Name *" value={name} onChange={setName} placeholder="Homeowner or company" autoFocus />
      <View style={{ flexDirection: 'row', gap: 12 }}>
        <View style={{ flex: 1 }}><SheetField label="Phone" value={phone} onChange={setPhone} keyboardType="phone-pad" placeholder="(555) 555-5555" /></View>
        <View style={{ flex: 1 }}><SheetField label="Email" value={email} onChange={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="name@email.com" /></View>
      </View>
      <SheetField label="Job site address" value={address} onChange={setAddress} placeholder="Street, city" />
      <SheetField label="Job title" value={jobTitle} onChange={setJobTitle} placeholder="Kitchen remodel, full gut" />

      <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 8 }}>Job type</Text>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8, paddingBottom: 4 }} style={{ marginBottom: 14 }}>
        {JOB_TYPES.map((t) => {
          const on = jobType === t.value
          return (
            <Pressable key={t.value} onPress={() => setJobType(on ? '' : t.value)} style={{ paddingHorizontal: 12, paddingVertical: 8, borderRadius: 10, borderWidth: 1, borderColor: on ? theme.goldBright : theme.borderMid, backgroundColor: on ? `${theme.goldBright}26` : theme.bg }}>
              <Text style={{ color: on ? theme.goldBright : theme.inkMuted, fontSize: 14, fontWeight: '700' }}>{t.label}</Text>
            </Pressable>
          )
        })}
      </ScrollView>

      <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 8 }}>Stage</Text>
      <View style={{ flexDirection: 'row', gap: 8, marginBottom: 14 }}>
        {STAGES.map((s) => {
          const on = stage === s.value
          return (
            <Pressable key={s.value} onPress={() => setStage(s.value)} style={{ flex: 1, alignItems: 'center', paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: on ? theme.goldBright : theme.borderMid, backgroundColor: on ? `${theme.goldBright}26` : theme.bg }}>
              <Text style={{ color: on ? theme.goldBright : theme.inkMuted, fontSize: 14, fontWeight: '700' }}>{s.label}</Text>
            </Pressable>
          )
        })}
      </View>

      <SheetField label="Value ($)" value={amount} onChange={setAmount} keyboardType="numeric" placeholder="42000" />
      <SheetField label="Notes" value={notes} onChange={setNotes} multiline placeholder="Scope, timeline, materials, special asks…" />
      <SheetField label="Referred by" value={referredBy} onChange={setReferredBy} placeholder="Who sent them?" />

      {err ? <Text style={{ color: theme.danger, fontSize: 14, marginBottom: 12 }}>{err}</Text> : null}
      <GoldButton label="Create lead" onPress={submit} loading={saving} />
    </BottomSheet>
  )
}
