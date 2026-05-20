// mobile/app/settings.tsx — business profile.
// Pushed from More. Edits the profiles row (company name/phone/email/
// address/website/license) that brands documents and invoices. Saves
// straight to profiles via useUpdateProfile.
import { useEffect, useState } from 'react'
import { View, Text, ScrollView, Pressable, TextInput, ActivityIndicator } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import { ChevronLeft } from 'lucide-react-native'
import { useProfile, useUpdateProfile } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'

function Field({ label, value, onChange, ...rest }: {
  label: string; value: string; onChange: (v: string) => void
} & Record<string, unknown>) {
  return (
    <>
      <Text className="text-ink-muted text-[11px] font-bold tracking-wider uppercase mb-2">{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholderTextColor="rgba(242,237,228,0.4)"
        className="bg-surface border border-[rgba(255,240,210,0.12)] rounded-xl px-4 py-3 text-ink mb-4"
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
    <View className="flex-1 bg-bg">
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: insets.bottom + 40, paddingHorizontal: 20 }}>
        <Pressable onPress={() => router.back()} className="flex-row items-center mb-4" style={{ gap: 4 }}>
          <ChevronLeft color="#E8B865" size={20} />
          <Text className="text-gold-bright font-bold">More</Text>
        </Pressable>

        <Text className="text-gold-bright text-[10px] font-bold tracking-[2px] uppercase">Settings</Text>
        <Text className="text-ink text-3xl font-bold mb-2">Business profile</Text>
        <Text className="text-ink-muted text-sm mb-6">This brands your quotes, invoices, and customer-facing documents.</Text>

        {isLoading ? (
          <ActivityIndicator color="#E8B865" />
        ) : (
          <>
            <Field label="Company name" value={name} onChange={setName} placeholder="Parker Construction" />
            <Field label="Your name" value={fullName} onChange={setFullName} placeholder="Owner / contact name" />
            <Field label="Phone" value={phone} onChange={setPhone} keyboardType="phone-pad" placeholder="(555) 555-5555" />
            <Field label="Email" value={email} onChange={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="you@company.com" />
            <Field label="Website" value={website} onChange={setWebsite} autoCapitalize="none" placeholder="company.com" />
            <Field label="Address" value={address} onChange={setAddress} placeholder="Business address" />
            <Field label="License #" value={license} onChange={setLicense} placeholder="Contractor license number" />

            <Pressable
              onPress={save}
              disabled={saving}
              className="rounded-xl py-4 items-center mt-2"
              style={{ backgroundColor: saving ? 'rgba(232,184,101,0.5)' : '#E8B865' }}
            >
              {saving ? <ActivityIndicator color="#1A120A" /> : <Text className="text-[#1A120A] font-bold">{saved ? 'Saved ✓' : 'Save profile'}</Text>}
            </Pressable>
          </>
        )}
      </ScrollView>
    </View>
  )
}
