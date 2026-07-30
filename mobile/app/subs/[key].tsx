// mobile/app/subs/[key].tsx, subcontractor vendor profile.
// :key is encodeURIComponent(phone||name lowercased). Create-on-demand
// fh_sub_profiles, edit contact / insurance / business / payment / notes,
// insurance-expiry badge, and read-only job history. Doc uploads defer.
import { useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, Pressable, ActivityIndicator, TextInput, Alert, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useLocalSearchParams, useRouter } from 'expo-router'
import { Phone, Mail, ShieldCheck, FileText, IdCard } from 'lucide-react-native'
import { useSubDetail, useCreateSubProfile, useUpdateSubProfile, type SubProfile } from '../../lib/queries'
import { useAuth } from '../../contexts/AuthContext'
import { ScreenBackground, Card, ScreenHeader, theme } from '../../components/ui'

type Form = {
  name: string; company: string; phone: string; email: string; address: string; trades: string
  insurance_carrier: string; insurance_policy: string; insurance_expires_on: string
  ein: string; license_number: string; payment_method: string; payment_handle: string; notes: string
}
const EMPTY: Form = { name: '', company: '', phone: '', email: '', address: '', trades: '', insurance_carrier: '', insurance_policy: '', insurance_expires_on: '', ein: '', license_number: '', payment_method: '', payment_handle: '', notes: '' }

function seed(p: SubProfile | null): Form {
  if (!p) return EMPTY
  return {
    name: p.name || '', company: p.company || '', phone: p.phone || '', email: p.email || '', address: p.address || '',
    trades: (p.trades || []).join(', '), insurance_carrier: p.insurance_carrier || '', insurance_policy: p.insurance_policy || '',
    insurance_expires_on: p.insurance_expires_on || '', ein: p.ein || '', license_number: p.license_number || '',
    payment_method: p.payment_method || '', payment_handle: p.payment_handle || '', notes: p.notes || ''
  }
}

function expiryNote(iso: string | null) {
  if (!iso) return null
  const days = Math.floor((new Date(iso).getTime() - Date.now()) / 86400000)
  if (days < 0) return { txt: `Expired ${Math.abs(days)}d ago`, tint: theme.danger }
  if (days <= 30) return { txt: `Expires in ${days}d`, tint: '#C9963A' }
  return { txt: `Renews in ${days}d`, tint: theme.success }
}

export default function SubDetailScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { key: rawKey } = useLocalSearchParams<{ key: string }>()
  const key = decodeURIComponent(rawKey || '')
  const { data, isPending } = useSubDetail(key, user?.id)
  const createProfile = useCreateSubProfile()
  const updateProfile = useUpdateSubProfile()

  const [form, setForm] = useState<Form>(EMPTY)
  const [saving, setSaving] = useState(false)
  const profile = data?.profile ?? null

  useEffect(() => { setForm(seed(profile)) }, [profile?.id])

  const dirty = useMemo(() => profile && JSON.stringify(form) !== JSON.stringify(seed(profile)), [form, profile])
  const set = (k: keyof Form) => (v: string) => setForm((f) => ({ ...f, [k]: v }))

  async function onCreate() {
    if (!user || !data) return
    setSaving(true)
    const { error } = await createProfile({ userId: user.id, key, name: data.displayName, phone: data.displayPhone || null, trades: data.trades })
    setSaving(false)
    if (error) Alert.alert("Couldn't create profile", error.message)
  }

  async function onSave() {
    if (!user || !profile) return
    if (!form.name.trim()) { Alert.alert('Name required', 'Give the vendor a name.'); return }
    setSaving(true)
    const trades = form.trades.split(',').map((t) => t.trim()).filter(Boolean)
    const patch: Partial<Omit<SubProfile, 'id'>> = {
      name: form.name.trim(), company: form.company.trim() || null, phone: form.phone.trim() || null, email: form.email.trim() || null,
      address: form.address.trim() || null, trades: trades.length ? trades : null, insurance_carrier: form.insurance_carrier.trim() || null,
      insurance_policy: form.insurance_policy.trim() || null, insurance_expires_on: form.insurance_expires_on.trim() || null,
      ein: form.ein.trim() || null, license_number: form.license_number.trim() || null, payment_method: form.payment_method.trim() || null,
      payment_handle: form.payment_handle.trim() || null, notes: form.notes.trim() || null
    }
    const { error } = await updateProfile({ id: profile.id, userId: user.id, key, patch })
    setSaving(false)
    if (error) Alert.alert("Couldn't save", error.message)
  }

  if (isPending) return <View style={{ flex: 1 }}><ScreenBackground /><ActivityIndicator color={theme.goldBright} style={{ marginTop: insets.top + 80 }} /></View>
  if (!data) return (
    <View style={{ flex: 1 }}><ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingHorizontal: 24 }}>
        <ScreenHeader backLabel="Subs" onBack={() => router.back()} eyebrow="Vendor profile" title="Not found" />
      </ScrollView>
    </View>
  )

  const exp = expiryNote(form.insurance_expires_on || null)

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + (profile ? 96 : 24), paddingHorizontal: 24 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader backLabel="Subs" onBack={() => router.back()} eyebrow="Vendor profile" title={data.displayName} />

        {/* contact + KPI */}
        <Card glow style={{ marginTop: 16, marginBottom: 18 }}>
          <View style={{ padding: 16 }}>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              {data.displayPhone ? (
                <Pressable onPress={() => Linking.openURL(`tel:${data.displayPhone}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Phone color={theme.goldBright} size={13} /><Text style={{ color: theme.ink, fontSize: 14, fontWeight: '600' }}>{data.displayPhone}</Text>
                </Pressable>
              ) : null}
              {profile?.email ? (
                <Pressable onPress={() => Linking.openURL(`mailto:${profile.email}`)} style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                  <Mail color={theme.goldBright} size={13} /><Text style={{ color: theme.ink, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{profile.email}</Text>
                </Pressable>
              ) : null}
            </View>
            <View style={{ flexDirection: 'row', marginTop: 16 }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.goldBright, fontSize: 20, fontWeight: '800' }}>${data.billed.toLocaleString()}</Text>
                <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase', marginTop: 2 }}>Billed across {data.jobs.length} job{data.jobs.length === 1 ? '' : 's'}</Text>
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800' }}>{data.trades.length}</Text>
                <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase', marginTop: 2 }}>{data.trades.join(' · ') || 'No trade set'}</Text>
              </View>
            </View>
          </View>
        </Card>

        {!profile ? (
          <Card style={{ marginBottom: 18 }}>
            <View style={{ padding: 24, alignItems: 'center' }}>
              <IdCard color={theme.goldBright} size={26} />
              <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700', marginTop: 10 }}>No vendor profile yet</Text>
              <Text style={{ color: theme.inkMuted, fontSize: 14, textAlign: 'center', marginTop: 4, lineHeight: 19 }}>Create one to track insurance, license, EIN and payment details for this sub.</Text>
              <Pressable onPress={onCreate} disabled={saving} style={{ marginTop: 16, paddingHorizontal: 24, paddingVertical: 12, borderRadius: 10, backgroundColor: theme.goldBright, opacity: saving ? 0.5 : 1 }}>
                <Text style={{ color: theme.onGold, fontWeight: '800', fontSize: 14 }}>{saving ? 'Creating…' : 'Create profile'}</Text>
              </Pressable>
            </View>
          </Card>
        ) : (
          <>
            <Section title="Contact">
              <Field label="Name" value={form.name} onChange={set('name')} />
              <Field label="Company" value={form.company} onChange={set('company')} />
              <Field label="Phone" value={form.phone} onChange={set('phone')} keyboard="phone-pad" />
              <Field label="Email" value={form.email} onChange={set('email')} keyboard="email-address" />
              <Field label="Address" value={form.address} onChange={set('address')} />
              <Field label="Trades (comma separated)" value={form.trades} onChange={set('trades')} />
            </Section>

            <Section title="Insurance" icon={<ShieldCheck color={theme.goldBright} size={13} />} badge={exp ? { txt: exp.txt, tint: exp.tint } : undefined}>
              <Field label="Carrier" value={form.insurance_carrier} onChange={set('insurance_carrier')} />
              <Field label="Policy #" value={form.insurance_policy} onChange={set('insurance_policy')} />
              <Field label="Expires (year month day)" value={form.insurance_expires_on} onChange={set('insurance_expires_on')} placeholder="2026-12-31" />
            </Section>

            <Section title="Business">
              <Field label="EIN" value={form.ein} onChange={set('ein')} />
              <Field label="License #" value={form.license_number} onChange={set('license_number')} />
            </Section>

            <Section title="Payment">
              <Field label="Method" value={form.payment_method} onChange={set('payment_method')} placeholder="ACH, check, Zelle…" />
              <Field label="Handle / acct (no full routing #)" value={form.payment_handle} onChange={set('payment_handle')} />
            </Section>

            <Section title="Documents">
              <DocRow label="COI (insurance)" onFile={!!profile.coi_path} />
              <DocRow label="W9" onFile={!!profile.w9_path} />
              <DocRow label="License" onFile={!!profile.license_path} />
              <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 8 }}>Upload documents from the web app for now.</Text>
            </Section>

            <Section title="Notes">
              <TextInput value={form.notes} onChangeText={set('notes')} multiline placeholder="Anything worth remembering…" placeholderTextColor={theme.inkMuted} style={{ color: theme.ink, fontSize: 14, lineHeight: 21, minHeight: 70, textAlignVertical: 'top', backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 10, padding: 12 }} />
            </Section>
          </>
        )}

        {/* Job history */}
        {data.jobs.length > 0 ? (
          <>
            <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginTop: 8, marginBottom: 10 }}>Job history</Text>
            <View style={{ gap: 8 }}>
              {data.jobs.map((j) => (
                <Pressable key={j.id} onPress={() => j.contactId && router.push(`/jobs/${j.contactId}`)} disabled={!j.contactId}>
                  <Card>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: 12 }}>
                      <View style={{ flex: 1 }}>
                        <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '600' }} numberOfLines={1}>{j.contactName || '(Directory entry)'}</Text>
                        {j.jobTitle ? <Text style={{ color: theme.inkMuted, fontSize: 12 }} numberOfLines={1}>{j.jobTitle}</Text> : null}
                      </View>
                      <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }}>{j.rate > 0 ? `$${j.rate.toLocaleString()}` : '\u2003'}</Text>
                    </View>
                  </Card>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}
      </ScrollView>

      {profile ? (
        <View style={{ position: 'absolute', left: 0, right: 0, bottom: 0, paddingHorizontal: 24, paddingTop: 12, paddingBottom: insets.bottom + 12, backgroundColor: 'rgba(20, 20, 20,0.92)', borderTopWidth: 1, borderTopColor: theme.border }}>
          <Pressable onPress={onSave} disabled={!dirty || saving} style={{ alignItems: 'center', paddingVertical: 12, borderRadius: 10, backgroundColor: theme.goldBright, opacity: !dirty || saving ? 0.5 : 1 }}>
            <Text style={{ color: theme.onGold, fontWeight: '800', fontSize: 14 }}>{saving ? 'Saving…' : dirty ? 'Save changes' : 'Saved'}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  )
}

function Section({ title, icon, badge, children }: { title: string; icon?: React.ReactNode; badge?: { txt: string; tint: string }; children: React.ReactNode }) {
  return (
    <View style={{ marginBottom: 18 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 }}>
        {icon}
        <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase' }}>{title}</Text>
        {badge ? (
          <View style={{ marginLeft: 'auto', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: `${badge.tint}55`, backgroundColor: `${badge.tint}1f` }}>
            <Text style={{ color: badge.tint, fontSize: 12, fontWeight: '800', letterSpacing: 0 }}>{badge.txt.toUpperCase()}</Text>
          </View>
        ) : null}
      </View>
      <Card><View style={{ padding: 12, gap: 12 }}>{children}</View></Card>
    </View>
  )
}

function Field({ label, value, onChange, keyboard, placeholder }: { label: string; value: string; onChange: (v: string) => void; keyboard?: 'phone-pad' | 'email-address'; placeholder?: string }) {
  return (
    <View>
      <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 5 }}>{label}</Text>
      <TextInput value={value} onChangeText={onChange} keyboardType={keyboard} autoCapitalize={keyboard === 'email-address' ? 'none' : 'sentences'} placeholder={placeholder} placeholderTextColor={theme.inkFaint}
        style={{ color: theme.ink, fontSize: 14, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 10, paddingHorizontal: 12, paddingVertical: 12 }} />
    </View>
  )
}

function DocRow({ label, onFile }: { label: string; onFile: boolean }) {
  return (
    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
      <FileText color={onFile ? theme.success : theme.inkMuted} size={15} />
      <Text style={{ color: theme.ink, fontSize: 14, flex: 1 }}>{label}</Text>
      <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, borderWidth: 1, borderColor: onFile ? `${theme.success}55` : theme.borderMid, backgroundColor: onFile ? `${theme.success}1f` : 'transparent' }}>
        <Text style={{ color: onFile ? theme.success : theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0 }}>{onFile ? 'ON FILE' : 'MISSING'}</Text>
      </View>
    </View>
  )
}
