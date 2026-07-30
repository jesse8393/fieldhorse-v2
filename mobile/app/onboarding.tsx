// mobile/app/onboarding.tsx, first-run setup.
//
// Native equivalent of the web Onboarding screen. Captures the company
// name + trades (and optional location for pour condition rules), stamps
// profiles.onboarded_at, then the root layout gate moves the user into
// the tabs. Surfaces only once, the gate skips it after onboarded_at is set.
import { useMemo, useState } from 'react'
import {
  View, Text, TextInput, Pressable, ActivityIndicator, ScrollView, Alert
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as Location from 'expo-location'
import { MapPin, Check } from 'lucide-react-native'
import { useAuth } from '../contexts/AuthContext'
import { useCompleteOnboarding } from '../lib/queries'

const TRADES = [
  { key: 'concrete', label: 'Concrete' },
  { key: 'framing', label: 'Framing' },
  { key: 'roofing', label: 'Roofing' },
  { key: 'electrical', label: 'Electrical' },
  { key: 'plumbing', label: 'Plumbing' },
  { key: 'hvac', label: 'HVAC' },
  { key: 'drywall', label: 'Drywall' },
  { key: 'paint', label: 'Paint' },
  { key: 'tile', label: 'Tile' },
  { key: 'landscaping', label: 'Landscaping' },
  { key: 'excavation', label: 'Excavation' },
  { key: 'insulation', label: 'Insulation' }
]

export default function OnboardingScreen() {
  const insets = useSafeAreaInsets()
  const { user } = useAuth()
  const complete = useCompleteOnboarding()

  const [companyName, setCompanyName] = useState('')
  const [services, setServices] = useState<string[]>([])
  const [coords, setCoords] = useState<{ lat: number; lon: number } | null>(null)
  const [locStatus, setLocStatus] = useState<'idle' | 'requesting' | 'ok' | 'error'>('idle')
  const [busy, setBusy] = useState(false)

  const canSubmit = useMemo(
    () => companyName.trim().length >= 2 && services.length >= 1,
    [companyName, services]
  )

  function toggle(key: string) {
    setServices((prev) => (prev.includes(key) ? prev.filter((s) => s !== key) : [...prev, key]))
  }

  async function requestLocation() {
    setLocStatus('requesting')
    const perm = await Location.requestForegroundPermissionsAsync()
    if (!perm.granted) { setLocStatus('error'); return }
    try {
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low })
      setCoords({ lat: pos.coords.latitude, lon: pos.coords.longitude })
      setLocStatus('ok')
    } catch {
      setLocStatus('error')
    }
  }

  async function finish() {
    if (!canSubmit || busy || !user) return
    setBusy(true)
    const { error } = await complete({
      userId: user.id,
      companyName,
      services,
      lat: coords?.lat ?? null,
      lon: coords?.lon ?? null
    })
    setBusy(false)
    if (error) { Alert.alert("Couldn't save", error.message); return }
    // Root layout gate routes into the tabs once onboarded_at is set.
  }

  return (
    <View className="flex-1 bg-bg">
      <ScrollView
        contentContainerStyle={{ paddingTop: insets.top + 24, paddingBottom: insets.bottom + 120, paddingHorizontal: 24 }}
        keyboardShouldPersistTaps="handled"
      >
        <Text className="text-gold-bright text-xs font-bold tracking-[2px] uppercase mb-2">Onboarding</Text>
        <Text className="text-ink text-2xl font-bold mb-1">Set up your operation</Text>
        <Text className="text-ink-muted text-sm mb-8">A couple of details and your command center is ready.</Text>

        <Text className="text-ink-muted text-xs font-bold tracking-[0px] uppercase mb-2">Company name</Text>
        <TextInput
          value={companyName}
          onChangeText={setCompanyName}
          placeholder="Your company name"
          placeholderTextColor="rgba(242,237,228,0.4)"
          className="bg-surface border border-[rgba(242, 237, 228,0.12)] rounded-[10px] px-4 py-3 text-ink mb-7"
        />

        <Text className="text-ink-muted text-xs font-bold tracking-[0px] uppercase mb-1">Trades</Text>
        <Text className="text-ink-muted text-xs mb-3">Pick every trade you run, this configures your rate card and pour condition rules.</Text>
        <View className="flex-row flex-wrap" style={{ gap: 8 }}>
          {TRADES.map((t) => {
            const on = services.includes(t.key)
            return (
              <Pressable
                key={t.key}
                onPress={() => toggle(t.key)}
                className="flex-row items-center rounded-[10px] px-4 py-3 border"
                style={{ gap: 8, borderColor: on ? '#C9963A' : 'rgba(242, 237, 228,0.12)', backgroundColor: on ? 'rgba(201, 150, 58,0.14)' : 'rgba(20, 20, 20,0.6)' }}
              >
                {on ? <Check color="#C9963A" size={13} strokeWidth={3} /> : null}
                <Text className="text-sm font-semibold" style={{ color: on ? '#C9963A' : '#F2EDE4' }}>{t.label}</Text>
              </Pressable>
            )
          })}
        </View>
        <Text className="text-ink-muted text-xs mt-3">{services.length} trade{services.length === 1 ? '' : 's'} picked</Text>

        <Text className="text-ink-muted text-xs font-bold tracking-[0px] uppercase mb-1 mt-7">Location</Text>
        <Text className="text-ink-muted text-xs mb-3">Optional, powers local weather and pour window forecasts.</Text>
        <Pressable
          onPress={requestLocation}
          disabled={locStatus === 'requesting'}
          className="flex-row items-center bg-[rgba(20, 20, 20,0.6)] rounded-[10px] px-4 py-3 border border-[rgba(201, 150, 58,0.12)]"
          style={{ gap: 12 }}
        >
          <MapPin color={locStatus === 'ok' ? '#2D7A4F' : '#C9963A'} size={16} />
          <Text className="text-ink text-sm flex-1">
            {locStatus === 'ok' ? 'Location captured' : locStatus === 'requesting' ? 'Getting location…' : locStatus === 'error' ? 'Location unavailable, tap to retry' : 'Use my current location'}
          </Text>
          {locStatus === 'requesting' ? <ActivityIndicator size="small" color="#C9963A" /> : null}
        </Pressable>
      </ScrollView>

      <View
        className="absolute left-0 right-0 bottom-0 px-6 pt-3 bg-bg border-t border-[rgba(242, 237, 228,0.08)]"
        style={{ paddingBottom: insets.bottom + 14 }}
      >
        <Pressable
          onPress={finish}
          disabled={!canSubmit || busy}
          className="rounded-[10px] py-4 items-center"
          style={{ backgroundColor: !canSubmit || busy ? 'rgba(201, 150, 58,0.4)' : '#C9963A' }}
        >
          {busy
            ? <ActivityIndicator color="#141414" />
            : <Text className="text-[#141414] text-base font-bold">Enter command center</Text>}
        </Pressable>
      </View>
    </View>
  )
}
