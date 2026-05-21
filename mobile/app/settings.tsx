// mobile/app/settings.tsx — business profile.
// Pushed from More. Edits the profiles row (company name/phone/email/
// address/website/license) that brands documents and invoices. Saves
// straight to profiles via useUpdateProfile.
import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TextInput, ActivityIndicator, Pressable } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { useProfile, useUpdateProfile } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'
import { ScreenBackground, ScreenHeader, GoldButton, theme } from '../components/ui'

function Field({ label, value, onChange, ...rest }: {
  label: string; value: string; onChange: (v: string) => void
} & Record<string, unknown>) {
  return (
    <>
      <Text style={{ color: theme.inkMuted, fontSize: 11, fontWeight: '800', letterSpacing: 1, textTransform: 'uppercase', marginBottom: 8 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholderTextColor={theme.inkFaint}
        style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 14, paddingHorizontal: 16, paddingVertical: 13, color: theme.ink, marginBottom: 16, fontSize: 15 }}
        {...(rest as object)}
      />
    </>
  )
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data: profile, isLoading } = useProfile(user?.id)
  const updateProfile = useUpdateProfile()

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [website, setWebsite] = useState('')
  const [license, setLicense] = useState('')
  const [fullName, setFullName] = useState('')
  const [saving, setSaving] = useState(false)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (!profile) return
    setName(profile.company_name || '')
    setPhone(profile.company_phone || '')
    setEmail(profile.company_email || '')
    setAddress(profile.company_address || '')
    setWebsite(profile.company_website || '')
    setLicense(profile.license_number || '')
    setFullName(profile.full_name || '')
  }, [profile])

  async function save() {
    if (!user || saving) return
    setSaving(true)
    const { error } = await updateProfile({
      userId: user.id,
      companyName: name.trim() || null,
      companyPhone: phone.trim() || null,
      companyEmail: email.trim() || null,
      companyAddress: address.trim() || null,
      companyWebsite: website.trim() || null,
      licenseNumber: license.trim() || null,
      fullName: fullName.trim() || null
    })
    setSaving(false)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 40, paddingHorizontal: 20 }}>
        <ScreenHeader backLabel="More" onBack={() => router.back()} eyebrow="Settings" title="Business profile" />
        <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 6, marginBottom: 22 }}>This brands your quotes, invoices, and customer-facing documents.</Text>

        {isLoading ? (
          <ActivityIndicator color={theme.goldBright} />
        ) : (
          <>
            <Field label="Company name" value={name} onChange={setName} placeholder="Parker Construction" />
            <Field label="Your name" value={fullName} onChange={setFullName} placeholder="Owner / contact name" />
            <Field label="Phone" value={phone} onChange={setPhone} keyboardType="phone-pad" placeholder="(555) 555-5555" />
            <Field label="Email" value={email} onChange={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="you@company.com" />
            <Field label="Website" value={website} onChange={setWebsite} autoCapitalize="none" placeholder="company.com" />
            <Field label="Address" value={address} onChange={setAddress} placeholder="Business address" />
            <Field label="License #" value={license} onChange={setLicense} placeholder="Contractor license number" />

            <View style={{ marginTop: 8 }}>
              <GoldButton label={saved ? 'Saved ✓' : 'Save profile'} onPress={save} loading={saving} />
            </View>

            <Pressable onPress={() => router.push('/reset-password')} style={{ marginTop: 22, alignItems: 'center' }} hitSlop={8}>
              <Text style={{ color: theme.goldBright, fontSize: 14, fontWeight: '700' }}>Change password</Text>
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  )
}
