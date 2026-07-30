// mobile/app/settings.tsx, business profile.
// Pushed from More. Edits the profiles row (brand, customer facing details,
// trades, brand accent, service area, session) that brands quotes/invoices
// and powers the Home weather pill + Pour Window. Saves via useUpdateProfile.
import { useEffect, useState } from 'react'
import { View, Text, ScrollView, TextInput, ActivityIndicator, Pressable, Alert, Linking } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import { MapPin, LogOut, Trash2 } from 'lucide-react-native'
import { useProfile, useUpdateProfile, useSaveLocation, useDeleteAccount } from '../lib/queries'
import { reverseGeocode } from '../lib/weather'
import { useAuth } from '../contexts/AuthContext'
import { ScreenBackground, ScreenHeader, GoldButton, theme } from '../components/ui'

const TRADES = [
  { key: 'concrete', label: 'Concrete' }, { key: 'framing', label: 'Framing' },
  { key: 'roofing', label: 'Roofing' }, { key: 'electrical', label: 'Electrical' },
  { key: 'plumbing', label: 'Plumbing' }, { key: 'gc', label: 'General' },
  { key: 'paint', label: 'Paint' }, { key: 'fencing', label: 'Fencing' },
  { key: 'demo', label: 'Demolition' }, { key: 'outdoor', label: 'Landscaping' }
]

const ACCENTS = ['#C9963A', '#C0392B', '#2D7A4F', '#5C5C5C', '#C9963A', '#5C5C5C', '#2D7A4F', '#C9963A']

const ESTIMATE_TEMPLATES = [
  { key: 'classic',   name: 'Classic',   blurb: 'Editorial dark accent layout.', swatch: ['#141414', '#C9963A', '#F2EDE4'] },
  { key: 'slate',     name: 'Slate',     blurb: 'Gray header, From/For, itemized.', swatch: ['#5C5C5C', '#F2EDE4', '#F2EDE4'] },
  { key: 'mint',      name: 'Mint',      blurb: 'Green ESTIMATE wordmark.', swatch: ['#5C5C5C', '#F2EDE4', '#F2EDE4'] },
  { key: 'editorial', name: 'Editorial', blurb: 'Sand + serif, scope + breakdown.', swatch: ['#F2EDE4', '#C9963A', '#141414'] }
]

function Field({ label, value, onChange, ...rest }: {
  label: string; value: string; onChange: (v: string) => void
} & Record<string, unknown>) {
  return (
    <>
      <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 8 }}>{label}</Text>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholderTextColor={theme.inkFaint}
        style={{ backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 10, paddingHorizontal: 16, paddingVertical: 12, color: theme.ink, marginBottom: 16, fontSize: 14 }}
        {...(rest as object)}
      />
    </>
  )
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <Text style={{ color: theme.goldBright, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginTop: 28, marginBottom: 14 }}>{children}</Text>
  )
}

export default function SettingsScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user, signOut } = useAuth()
  const { data: profile, isLoading } = useProfile(user?.id)
  const updateProfile = useUpdateProfile()
  const saveLocation = useSaveLocation()
  const deleteAccount = useDeleteAccount()
  const [deleting, setDeleting] = useState(false)

  const [name, setName] = useState('')
  const [phone, setPhone] = useState('')
  const [email, setEmail] = useState('')
  const [address, setAddress] = useState('')
  const [website, setWebsite] = useState('')
  const [license, setLicense] = useState('')
  const [fullName, setFullName] = useState('')
  const [insured, setInsured] = useState('')
  const [warranty, setWarranty] = useState('')
  const [services, setServices] = useState<string[]>([])
  const [accent, setAccent] = useState<string>(ACCENTS[0])
  const [template, setTemplate] = useState<string>('classic')
  const [cityName, setCityName] = useState<string | null>(null)
  const [pinning, setPinning] = useState(false)
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
    setInsured(profile.insured_text || '')
    setWarranty(profile.warranty_default || '')
    setServices((profile.services as string[]) || [])
    setAccent(profile.brand_accent_hex || ACCENTS[0])
    setTemplate((profile as any).estimate_template || 'classic')
  }, [profile])

  useEffect(() => {
    if (profile?.location_lat != null && profile?.location_lon != null) {
      reverseGeocode(profile.location_lat, profile.location_lon).then((n) => n && setCityName(n))
    }
  }, [profile?.location_lat, profile?.location_lon])

  function toggleTrade(key: string) {
    setServices((cur) => cur.includes(key) ? cur.filter((s) => s !== key) : [...cur, key])
  }

  async function pinLocation() {
    if (!user || pinning) return
    setPinning(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') { Alert.alert('Location needed', 'Enable location access to set your service area.'); return }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low })
      await saveLocation({ userId: user.id, lat: pos.coords.latitude, lon: pos.coords.longitude })
      const n = await reverseGeocode(pos.coords.latitude, pos.coords.longitude)
      if (n) setCityName(n)
    } catch {
      Alert.alert('Could not get location', 'Try again outdoors or check location permissions.')
    } finally {
      setPinning(false)
    }
  }

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
      fullName: fullName.trim() || null,
      insuredText: insured.trim() || null,
      warrantyDefault: warranty.trim() || null,
      services,
      brandAccentHex: accent,
      estimateTemplate: template
    })
    setSaving(false)
    if (!error) { setSaved(true); setTimeout(() => setSaved(false), 2000) }
  }

  function confirmSignOut() {
    Alert.alert('Sign out?', 'You will need to sign in again.', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Sign out', style: 'destructive', onPress: () => signOut() }
    ])
  }

  function confirmDeleteAccount() {
    Alert.alert(
      'Delete account?',
      'This permanently deletes your account and all your jobs, clients, payments, notes, and other data. This cannot be undone.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete everything', style: 'destructive',
          onPress: async () => {
            setDeleting(true)
            const { error } = await deleteAccount()
            setDeleting(false)
            if (error) { Alert.alert("Couldn't delete account", error.message); return }
            await signOut()
          }
        }
      ]
    )
  }

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 120, paddingHorizontal: 24 }} keyboardShouldPersistTaps="handled">
        <ScreenHeader backLabel="More" onBack={() => router.back()} eyebrow="Settings" title="Business profile" />
        <Text style={{ color: theme.inkMuted, fontSize: 14, marginTop: 6 }}>This brands your quotes, invoices, and customer facing documents.</Text>

        {isLoading ? (
          <ActivityIndicator color={theme.goldBright} style={{ marginTop: 24 }} />
        ) : (
          <>
            <SectionTitle>Your brand</SectionTitle>
            <Field label="Company name" value={name} onChange={setName} placeholder="Parker Construction" />
            <Field label="Your name" value={fullName} onChange={setFullName} placeholder="Owner / contact name" />

            <SectionTitle>Customer facing details</SectionTitle>
            <Field label="Phone" value={phone} onChange={setPhone} keyboardType="phone-pad" placeholder="(555) 555-5555" />
            <Field label="Email" value={email} onChange={setEmail} keyboardType="email-address" autoCapitalize="none" placeholder="you@company.com" />
            <Field label="Website" value={website} onChange={setWebsite} autoCapitalize="none" placeholder="company.com" />
            <Field label="Address" value={address} onChange={setAddress} placeholder="Business address" />
            <Field label="License #" value={license} onChange={setLicense} placeholder="Contractor license number" />
            <Field label="Insurance / insured text" value={insured} onChange={setInsured} multiline placeholder="Licensed & insured. Policy #…" />
            <Field label="Default warranty text" value={warranty} onChange={setWarranty} multiline placeholder="1-year workmanship warranty…" />

            <SectionTitle>Brand accent color</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {ACCENTS.map((c) => {
                const on = accent.toLowerCase() === c.toLowerCase()
                return (
                  <Pressable key={c} onPress={() => setAccent(c)} style={{ width: 38, height: 38, borderRadius: 10, backgroundColor: c, borderWidth: on ? 3 : 1, borderColor: on ? theme.ink : theme.border }} />
                )
              })}
            </View>

            <SectionTitle>Estimate template</SectionTitle>
            <Text style={{ color: theme.inkMuted, fontSize: 12, lineHeight: 17, marginBottom: 12 }}>
              The design used when you preview or share an estimate. Your logo and details fill in automatically.
            </Text>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 12 }}>
              {ESTIMATE_TEMPLATES.map((t) => {
                const on = template === t.key
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => setTemplate(t.key)}
                    style={{
                      width: '47%', flexGrow: 1, padding: 12, borderRadius: 10,
                      backgroundColor: on ? 'rgba(201, 150, 58,0.12)' : theme.surface,
                      borderWidth: on ? 2 : 1, borderColor: on ? theme.goldBright : theme.borderMid
                    }}
                  >
                    <View style={{ flexDirection: 'row', gap: 4, marginBottom: 8 }}>
                      {t.swatch.map((c, i) => (
                        <View key={i} style={{ width: 20, height: 20, borderRadius: 10, backgroundColor: c, borderWidth: 1, borderColor: 'rgba(20, 20, 20,0.12)' }} />
                      ))}
                    </View>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
                      <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }}>{t.name}</Text>
                      {on ? <Text style={{ color: theme.goldBright, fontSize: 12, fontWeight: '800', letterSpacing: 0 }}>SELECTED</Text> : null}
                    </View>
                    <Text style={{ color: theme.inkMuted, fontSize: 12, lineHeight: 15, marginTop: 2 }}>{t.blurb}</Text>
                  </Pressable>
                )
              })}
            </View>

            <SectionTitle>What you do</SectionTitle>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
              {TRADES.map((t) => {
                const on = services.includes(t.key)
                return (
                  <Pressable
                    key={t.key}
                    onPress={() => toggleTrade(t.key)}
                    style={{ paddingHorizontal: 12, paddingVertical: 12, borderRadius: 10, borderWidth: 1, borderColor: on ? theme.goldBright : theme.borderMid, backgroundColor: on ? `${theme.goldBright}26` : theme.surface }}
                  >
                    <Text style={{ color: on ? theme.goldBright : theme.inkMuted, fontSize: 14, fontWeight: '700' }}>{t.label}</Text>
                  </Pressable>
                )
              })}
            </View>
            <Text style={{ color: theme.inkFaint, fontSize: 12, marginTop: 10 }}>Drives your AI estimates and the Pour Window work window.</Text>

            <SectionTitle>Where you work</SectionTitle>
            <Pressable
              onPress={pinLocation}
              style={{ flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: theme.surface, borderWidth: 1, borderColor: theme.borderMid, borderRadius: 10, padding: 16 }}
            >
              <View style={{ width: 40, height: 40, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: `${theme.goldBright}1f`, borderWidth: 1, borderColor: theme.borderGold }}>
                {pinning ? <ActivityIndicator color={theme.goldBright} size="small" /> : <MapPin color={theme.goldBright} size={18} />}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }}>{cityName || 'Set your service area'}</Text>
                <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 1 }}>{cityName ? 'Tap to pin again to your current location' : 'Tap to use your current location'}</Text>
              </View>
            </Pressable>
            <Text style={{ color: theme.inkFaint, fontSize: 12, marginTop: 10 }}>Powers your Home weather pill and the Pour Window forecast.</Text>

            <View style={{ marginTop: 28 }}>
              <GoldButton label={saved ? 'Saved ✓' : 'Save changes'} onPress={save} loading={saving} />
            </View>

            <SectionTitle>Your session</SectionTitle>
            <Text style={{ color: theme.inkMuted, fontSize: 14 }}>Signed in as <Text style={{ color: theme.ink, fontWeight: '700' }}>{user?.email || '\u2003'}</Text></Text>
            <Pressable onPress={() => router.push('/reset-password')} style={{ marginTop: 16, alignItems: 'center' }} hitSlop={8}>
              <Text style={{ color: theme.goldBright, fontSize: 14, fontWeight: '700' }}>Change password</Text>
            </Pressable>
            <Pressable
              onPress={confirmSignOut}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, paddingVertical: 12, marginTop: 16, borderWidth: 1, borderColor: 'rgba(192, 57, 43,0.3)', backgroundColor: 'rgba(192, 57, 43,0.10)' }}
            >
              <LogOut color={theme.danger} size={16} />
              <Text style={{ color: theme.danger, fontWeight: '700' }}>Sign out</Text>
            </Pressable>

            <SectionTitle>Legal</SectionTitle>
            <View style={{ flexDirection: 'row', gap: 16 }}>
              <Pressable onPress={() => Linking.openURL('https://fieldhorse.io/privacy')} hitSlop={8}>
                <Text style={{ color: theme.goldBright, fontSize: 14, fontWeight: '700' }}>Privacy Policy</Text>
              </Pressable>
              <Pressable onPress={() => Linking.openURL('https://fieldhorse.io/terms')} hitSlop={8}>
                <Text style={{ color: theme.goldBright, fontSize: 14, fontWeight: '700' }}>Terms of Service</Text>
              </Pressable>
            </View>

            <Pressable
              onPress={confirmDeleteAccount}
              disabled={deleting}
              style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 8, borderRadius: 10, paddingVertical: 12, marginTop: 24, opacity: deleting ? 0.6 : 1 }}
            >
              {deleting ? <ActivityIndicator color={theme.danger} size="small" /> : <Trash2 color={theme.danger} size={15} />}
              <Text style={{ color: theme.danger, fontWeight: '700', fontSize: 14 }}>{deleting ? 'Deleting…' : 'Delete account'}</Text>
            </Pressable>
            <Text style={{ color: theme.inkFaint, fontSize: 12, textAlign: 'center', marginTop: 4 }}>Permanently deletes your account and all data.</Text>
          </>
        )}
      </ScrollView>
    </View>
  )
}
