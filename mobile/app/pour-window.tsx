// mobile/app/pour-window.tsx, weather work window planner.
// Live Open-Meteo forecast (keyless), per-trade go/warn/stop against the
// contractor's services, 24h strip, 7 day cards. GPS pin again via
// expo-location, saved to profiles.location_lat/lon.
import { useEffect, useMemo, useState } from 'react'
import { View, Text, ScrollView, Pressable, ActivityIndicator, Alert } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useRouter } from 'expo-router'
import * as Location from 'expo-location'
import { MapPin, Wind, Droplets, Thermometer, CloudSun, AlertTriangle, Check, X } from 'lucide-react-native'
import { getWeather, workWindow, hourlyStrip, weatherLabel, tradeStatus, reverseGeocode, MURFREESBORO } from '../lib/weather'
import { useProfile, useSaveLocation } from '../lib/queries'
import { useAuth } from '../contexts/AuthContext'
import { ScreenBackground, Card, ScreenHeader, theme } from '../components/ui'

const TONE: Record<string, { fg: string; bg: string; border: string; label: string }> = {
  go: { fg: '#2D7A4F', bg: 'rgba(45,122,79,0.16)', border: 'rgba(45, 122, 79,0.35)', label: 'Clear to work' },
  warn: { fg: '#C9963A', bg: 'rgba(201,150,58,0.14)', border: 'rgba(201,150,58,0.35)', label: 'Tight window' },
  stop: { fg: '#C9963A', bg: 'rgba(192,57,43,0.15)', border: 'rgba(192,57,43,0.35)', label: 'Stand down' }
}
const toneOf = (s: string) => TONE[s] || TONE.go
const fmtTemp = (t: any) => (t == null ? '\u2003' : `${Math.round(t)}°`)
const fmtHour = (iso: any) => { try { const h = new Date(iso).getHours(); return `${((h + 11) % 12) + 1}${h >= 12 ? 'P' : 'A'}` } catch { return '\u2003' } }
function asLocalDate(iso: any) {
  if (!iso) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) { const [y, m, d] = iso.split('-').map(Number); return new Date(y, m - 1, d) }
  return new Date(iso)
}
const fmtDay = (iso: any) => { try { return asLocalDate(iso)!.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase() } catch { return '\u2003' } }
const fmtDate = (iso: any) => { try { return asLocalDate(iso)!.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) } catch { return '\u2003' } }

function dayAggregateStatus(weather: any, services: string[], dayIso: string) {
  const h = weather?.hourly
  if (!h?.time || !dayIso) return 'go'
  const prefix = dayIso.slice(0, 10)
  let worst = 'go'
  for (let i = 0; i < h.time.length; i++) {
    if (!String(h.time[i]).startsWith(prefix)) continue
    const hr = new Date(h.time[i]).getHours()
    if (hr < 7 || hr > 18) continue
    const w = workWindow({ temperature_2m: h.temperature_2m?.[i], precipitation: h.precipitation?.[i], wind_speed_10m: h.wind_speed_10m?.[i], relative_humidity_2m: h.relative_humidity_2m?.[i] }, services)
    if (w.status === 'stop') return 'stop'
    if (w.status === 'warn' && worst !== 'stop') worst = 'warn'
  }
  return worst
}

export default function PourWindowScreen() {
  const insets = useSafeAreaInsets()
  const router = useRouter()
  const { user } = useAuth()
  const { data: profile } = useProfile(user?.id)
  const saveLocation = useSaveLocation()

  const [weather, setWeather] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [cityName, setCityName] = useState('')
  const [pinning, setPinning] = useState(false)

  const hasCoords = profile?.location_lat != null && profile?.location_lon != null
  const services = (profile?.services as string[]) || []
  const lat = profile?.location_lat ?? MURFREESBORO.lat
  const lon = profile?.location_lon ?? MURFREESBORO.lon

  useEffect(() => {
    let cancelled = false
    setLoading(true); setErr('')
    getWeather(lat, lon).then((d) => !cancelled && setWeather(d)).catch((e) => !cancelled && setErr(e.message || 'Forecast unavailable')).finally(() => !cancelled && setLoading(false))
    reverseGeocode(lat, lon).then((n) => !cancelled && n && setCityName(n))
    return () => { cancelled = true }
  }, [lat, lon])

  async function pinLocation() {
    if (!user) return
    setPinning(true)
    try {
      const { status } = await Location.requestForegroundPermissionsAsync()
      if (status !== 'granted') { setErr('Location permission denied'); return }
      const pos = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Low })
      await saveLocation({ userId: user.id, lat: pos.coords.latitude, lon: pos.coords.longitude })
    } catch {
      Alert.alert('Location unavailable', "Couldn't read your location.")
    } finally { setPinning(false) }
  }

  const currentWindow = useMemo(() => workWindow(weather?.current, services), [weather, services])
  const strip = useMemo(() => hourlyStrip(weather?.hourly, services, 24), [weather, services])
  const daily = useMemo(() => {
    const d = weather?.daily
    if (!d?.time) return []
    return d.time.map((t: any, i: number) => ({ time: t, tMax: d.temperature_2m_max?.[i], tMin: d.temperature_2m_min?.[i], rainPct: d.precipitation_probability_max?.[i] ?? 0, windMax: d.wind_speed_10m_max?.[i] ?? 0 }))
  }, [weather])
  const tradeRows = useMemo(() => {
    const snap = weather?.current
    if (!snap) return []
    const seen = new Set<string>()
    return (services.length ? services : ['gc']).filter((t) => { const k = String(t || '').toLowerCase().trim(); if (!k || seen.has(k)) return false; seen.add(k); return true })
      .map((t) => ({ trade: t, ...tradeStatus(t, snap) }))
  }, [weather, services])

  const tone = toneOf(currentWindow?.status || 'go')
  const c = weather?.current

  return (
    <View style={{ flex: 1 }}>
      <ScreenBackground />
      <ScrollView contentContainerStyle={{ paddingTop: insets.top + 10, paddingBottom: insets.bottom + 24, paddingHorizontal: 24 }}>
        <ScreenHeader backLabel="Home" onBack={() => router.back()} eyebrow="Pour Window" title="Forecast"
          right={<Pressable onPress={pinLocation} disabled={pinning} style={{ width: 44, height: 44, borderRadius: 10, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: hasCoords ? theme.borderGold : theme.borderMid, backgroundColor: hasCoords ? `${theme.goldBright}1a` : theme.surface2 }}>{pinning ? <ActivityIndicator size="small" color={theme.goldBright} /> : <MapPin color={hasCoords ? theme.goldBright : theme.ink} size={20} />}</Pressable>} />

        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8, alignSelf: 'flex-start', paddingHorizontal: 12, paddingVertical: 4, borderRadius: 10, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.borderMid, marginTop: 14 }}>
          <MapPin color={theme.goldBright} size={11} />
          <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '600' }}>{cityName || (hasCoords ? `${lat.toFixed(2)}, ${lon.toFixed(2)}` : 'Murfreesboro, TN')}</Text>
        </View>
        {err ? <Text style={{ color: theme.danger, fontSize: 12, marginTop: 8 }}>{err}</Text> : null}

        {/* Today hero */}
        <Card glow accent={tone.fg} style={{ marginTop: 14, marginBottom: 14 }}>
          <View style={{ padding: 24, paddingLeft: 24 }}>
            <View style={{ flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'space-between' }}>
              <View style={{ flex: 1 }}>
                <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase' }}>Today · {weatherLabel(c?.weather_code)}</Text>
                <View style={{ flexDirection: 'row', alignItems: 'flex-start', marginTop: 8 }}>
                  <Text style={{ color: theme.ink, fontSize: 24, fontWeight: '800', lineHeight: 64, letterSpacing: 0 }}>{loading ? '\u2003' : c?.temperature_2m != null ? Math.round(c.temperature_2m) : '\u2003'}</Text>
                  <Text style={{ color: theme.inkMuted, fontSize: 24, fontWeight: '700', marginTop: 6 }}>°F</Text>
                </View>
              </View>
              <View style={{ width: 54, height: 54, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: '#141414' }}>
                <CloudSun color="#F2EDE4" size={26} />
              </View>
            </View>

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16, padding: 12, borderRadius: 10, backgroundColor: tone.bg, borderWidth: 1, borderColor: tone.border }}>
              <View style={{ width: 10, height: 10, borderRadius: 10, backgroundColor: tone.fg }} />
              <View style={{ flex: 1 }}>
                <Text style={{ color: tone.fg, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase' }}>{currentWindow.label || tone.label}</Text>
                {currentWindow.reasons?.length ? <Text style={{ color: theme.inkMuted, fontSize: 12, marginTop: 2 }}>{currentWindow.reasons.slice(0, 3).join(' · ')}</Text> : null}
              </View>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, marginTop: 14 }}>
              <Metric Icon={Wind} label="Wind" value={c?.wind_speed_10m != null ? `${Math.round(c.wind_speed_10m)}` : '\u2003'} unit="mph" />
              <Metric Icon={Droplets} label="Rain now" value={`${(c?.precipitation || 0).toFixed(2)}`} unit="in/h" />
              <Metric Icon={Thermometer} label="Humidity" value={c?.relative_humidity_2m != null ? `${Math.round(c.relative_humidity_2m)}` : '\u2003'} unit="%" />
            </View>
          </View>
        </Card>

        {/* 24h strip */}
        {strip.length > 0 ? (
          <View style={{ marginBottom: 18 }}>
            <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 10 }}>Next 24 hours</Text>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={{ gap: 8 }}>
              {strip.map((h: any, i: number) => {
                const t = toneOf(h.status)
                return (
                  <View key={i} style={{ width: 50, paddingVertical: 12, borderRadius: 10, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.borderMid, alignItems: 'center', gap: 8 }}>
                    <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700' }}>{fmtHour(h.time)}</Text>
                    <View style={{ width: 8, height: 8, borderRadius: 10, backgroundColor: t.fg }} />
                    <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700' }}>{fmtTemp(h.temp)}</Text>
                    <Text style={{ color: theme.inkFaint, fontSize: 12 }}>{Math.round(h.rain || 0)}%</Text>
                  </View>
                )
              })}
            </ScrollView>
          </View>
        ) : null}

        {/* 7 day */}
        {daily.length > 0 ? (
          <View style={{ marginBottom: 18 }}>
            <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 10 }}>Forecast</Text>
            <View style={{ gap: 8 }}>
              {daily.map((d: any, i: number) => {
                const ds = dayAggregateStatus(weather, services, d.time)
                const t = toneOf(ds)
                return (
                  <Card key={d.time} accent={t.fg}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 12, paddingLeft: 16 }}>
                      <View style={{ flex: 1 }}>
                        <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8 }}>
                          <Text style={{ color: i === 0 ? theme.goldBright : theme.ink, fontSize: 14, fontWeight: '800', letterSpacing: 0 }}>{i === 0 ? 'TODAY' : fmtDay(d.time)}</Text>
                          <Text style={{ color: theme.inkMuted, fontSize: 12 }}>{fmtDate(d.time)}</Text>
                        </View>
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 5 }}>
                          <Text style={{ color: theme.inkMuted, fontSize: 12 }}>💧 {Math.round(d.rainPct)}%</Text>
                          <Text style={{ color: theme.inkMuted, fontSize: 12 }}>💨 {Math.round(d.windMax)} mph</Text>
                          <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border }}>
                            <Text style={{ color: t.fg, fontSize: 12, fontWeight: '800', letterSpacing: 0 }}>{ds === 'go' ? 'GO' : ds === 'warn' ? 'TIGHT' : 'STOP'}</Text>
                          </View>
                        </View>
                      </View>
                      <View style={{ alignItems: 'flex-end' }}>
                        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800' }}>{fmtTemp(d.tMax)}</Text>
                        <Text style={{ color: theme.inkFaint, fontSize: 14, fontWeight: '700' }}>{fmtTemp(d.tMin)}</Text>
                      </View>
                    </View>
                  </Card>
                )
              })}
            </View>
          </View>
        ) : null}

        {/* Per-trade */}
        <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '800', letterSpacing: 0, textTransform: 'uppercase', marginBottom: 10 }}>Trades on your list · today</Text>
        {tradeRows.length === 0 ? (
          <Text style={{ color: theme.inkMuted, fontSize: 14 }}>Awaiting current conditions.</Text>
        ) : (
          <View style={{ gap: 8 }}>
            {tradeRows.map((r: any) => {
              const t = toneOf(r.status)
              const Glyph = r.status === 'go' ? Check : r.status === 'warn' ? AlertTriangle : X
              return (
                <View key={r.trade} style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 12, borderRadius: 10, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.borderMid }}>
                  <View style={{ width: 28, height: 28, borderRadius: 10, alignItems: 'center', justifyContent: 'center', backgroundColor: t.bg, borderWidth: 1, borderColor: t.border }}>
                    <Glyph color={t.fg} size={14} strokeWidth={2.4} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Text style={{ color: theme.ink, fontSize: 14, fontWeight: '700', textTransform: 'capitalize' }}>{r.trade}</Text>
                    <Text style={{ color: r.status === 'go' ? theme.inkFaint : theme.inkMuted, fontSize: 12, marginTop: 2 }}>{r.status !== 'go' && r.reasons?.length ? r.reasons[0] : 'Within spec'}</Text>
                  </View>
                  <View style={{ paddingHorizontal: 8, paddingVertical: 4, borderRadius: 10, backgroundColor: t.bg, borderWidth: 1, borderColor: t.border }}>
                    <Text style={{ color: t.fg, fontSize: 12, fontWeight: '800', letterSpacing: 0 }}>{r.status === 'go' ? 'GO' : r.status === 'warn' ? 'TIGHT' : 'STOP'}</Text>
                  </View>
                </View>
              )
            })}
          </View>
        )}
      </ScrollView>
    </View>
  )
}

function Metric({ Icon, label, value, unit }: { Icon: any; label: string; value: string; unit: string }) {
  return (
    <View style={{ flex: 1, padding: 12, borderRadius: 10, backgroundColor: theme.surface2, borderWidth: 1, borderColor: theme.borderMid, gap: 8 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        <Icon color={theme.inkMuted} size={10} />
        <Text style={{ color: theme.inkMuted, fontSize: 12, fontWeight: '700', letterSpacing: 0, textTransform: 'uppercase' }}>{label}</Text>
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 4 }}>
        <Text style={{ color: theme.ink, fontSize: 20, fontWeight: '800' }}>{value}</Text>
        <Text style={{ color: theme.inkFaint, fontSize: 12, fontWeight: '700', textTransform: 'uppercase' }}>{unit}</Text>
      </View>
    </View>
  )
}
