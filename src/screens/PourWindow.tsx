import { lazy, Suspense, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { ChevronLeft, MapPin, Wind, Droplets, Thermometer, CloudSun, AlertTriangle, Check, X } from 'lucide-react'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { getWeather, workWindow, hourlyStrip, weatherLabel, tradeStatus, reverseGeocode, MURFREESBORO } from '../lib/weather.ts'
import { hapticTap, hapticMedium } from '../lib/haptics.ts'
import { useFhMotion } from '../lib/motion.ts'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import Spotlight from '../components/fx/Spotlight.tsx'
import CountUp from '../components/fx/CountUp.tsx'
import { Eyebrow } from '../components/v3'
const SnowForecast = lazy(() => import('../components/desktop/SnowForecastBuild.tsx'))

// Status token → brand palette mapping used across the whole screen.
// All three statuses get a solid hex fallback so the strip doesn't render
// transparent if a CSS var fails to resolve.
const TONE: Record<string, any> = {
  go:   { fg: '#2D7A4F', bg: 'rgba(45,122,79,0.16)',  border: 'rgba(45, 122, 79,0.35)', label: 'Clear to work' },
  warn: { fg: '#C9963A', bg: 'rgba(201,150,58,0.14)', border: 'rgba(201,150,58,0.35)', label: 'Tight window' },
  stop: { fg: '#C9963A', bg: 'rgba(192,57,43,0.15)',  border: 'rgba(192,57,43,0.35)',  label: 'Stand down' }
}

function statusTone(status: any) { return TONE[status] || TONE.go }

function fmtTemp(t: any) {
  return t == null ? '\u2003' : `${Math.round(t)}°`
}
function fmtHour(iso: any) {
  try {
    const d = new Date(iso)
    const h = d.getHours()
    const ampm = h >= 12 ? 'P' : 'A'
    const twelve = ((h + 11) % 12) + 1
    return `${twelve}${ampm}`
  } catch { return '\u2003' }
}
// Open-Meteo daily.time is `year month day` with no zone. `new Date("2026-04-26")`
// parses as UTC midnight, which lands on the *previous* day in any
// timezone west of UTC. Append T00:00 so it parses in the local zone.
function asLocalDate(iso: any) {
  if (!iso) return null
  if (/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    const [y, m, d] = iso.split('-').map(Number)
    return new Date(y, m - 1, d)
  }
  return new Date(iso)
}
function fmtDay(iso: any) {
  try {
    const d = asLocalDate(iso)
    return d!.toLocaleDateString(undefined, { weekday: 'short' }).toUpperCase()
  } catch { return '\u2003' }
}
function fmtDate(iso: any) {
  try {
    const d = asLocalDate(iso)
    return d!.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch { return '\u2003' }
}

export default function PourWindow() {
  const { profile, upsertProfile, refresh } = useProfile()
  const navigate = useNavigate()
  const [weather, setWeather] = useState<any>(null)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState('')
  const [cityName, setCityName] = useState('')

  const hasCoords = profile?.location_lat != null && profile?.location_lon != null
  const services = profile?.services || []

  useEffect(() => {
    let cancelled = false
    const lat = profile?.location_lat ?? MURFREESBORO.lat
    const lon = profile?.location_lon ?? MURFREESBORO.lon
    setLoading(true); setErr('')
    getWeather(lat, lon)
      .then((d) => { if (!cancelled) setWeather(d) })
      .catch((e) => { if (!cancelled) setErr(e.message || 'Forecast unavailable') })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [profile?.location_lat, profile?.location_lon])
useEffect(() => {
    let cancelled = false
    const lat = profile?.location_lat ?? MURFREESBORO.lat
    const lon = profile?.location_lon ?? MURFREESBORO.lon
    reverseGeocode(lat, lon).then((name) => {
      if (!cancelled && name) setCityName(name)
    })
    return () => { cancelled = true }
  }, [profile?.location_lat, profile?.location_lon])


  function pinLocation() {
    if (!('geolocation' in navigator)) return setErr('Geolocation not supported')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await upsertProfile({ location_lat: pos.coords.latitude, location_lon: pos.coords.longitude })
        refresh()
      },
      () => setErr('Location denied'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60 * 60 * 1000 }
    )
  }

  const currentWindow = useMemo(
    () => workWindow(weather?.current, services),
    [weather, services]
  )
  const strip = useMemo(
    () => hourlyStrip(weather?.hourly, services, 24),
    [weather, services]
  )
  const daily = useMemo(() => {
    const d = weather?.daily
    if (!d?.time) return []
    return d.time.map((t: any, i: any) => ({
      time: t,
      tMax: d.temperature_2m_max?.[i],
      tMin: d.temperature_2m_min?.[i],
      rainPct: d.precipitation_probability_max?.[i] ?? 0,
      rainSum: d.precipitation_sum?.[i] ?? 0,
      windMax: d.wind_speed_10m_max?.[i] ?? 0
    }))
  }, [weather])

  // Per-trade breakdown against *current* snapshot, what can and can't go today.
  // Dedupe services first because the profile.services array can hold duplicates
  // from older onboarding flows (saw concrete/roofing/paint/framing each twice).
  const tradeRows = useMemo(() => {
    const snap = weather?.current
    if (!snap) return []
    const seen = new Set()
    const list = (services.length ? services : ['gc']).filter((t) => {
      const k = String(t || '').toLowerCase().trim()
      if (!k || seen.has(k)) return false
      seen.add(k)
      return true
    })
    return list.map((t) => ({ trade: t, ...tradeStatus(t, snap) }))
  }, [weather, services])

  const tone = statusTone(currentWindow?.status || 'go')
  const currentCode = weather?.current?.weather_code
  const currentTemp = weather?.current?.temperature_2m
  const currentWind = weather?.current?.wind_speed_10m
  const currentHumidity = weather?.current?.relative_humidity_2m
  const currentRain = weather?.current?.precipitation ?? 0

  const { stagger, item } = useFhMotion()
  const isDesktop = useIsDesktop()

  if (isDesktop) {
    return (
      <Suspense fallback={null}>
        <SnowForecast
          loading={loading}
          err={err}
          hasCoords={hasCoords}
          cityName={cityName}
          weather={weather}
          currentWindow={currentWindow}
          daily={daily}
          tradeRows={tradeRows}
          onPinLocation={pinLocation}
          onGoToSchedule={() => navigate('/schedule')}
        />
      </Suspense>
    )
  }

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 48, position: 'relative' }}>
      {/* HEADER */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '12px 24px 12px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <button
            type="button"
            onClick={() => { hapticTap(); navigate(-1) }}
            aria-label="Back"
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, padding: '8px 12px 8px 8px', marginLeft: -6, marginBottom: 4, borderRadius: 10, background: 'transparent', border: 'none', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer' }}
          >
            <ChevronLeft size={14} />
            Home
          </button>
          <h1 className="fh-font-serif" style={{ margin: '0', fontSize: 24, lineHeight: 1.1, letterSpacing: 0, fontWeight: 400, color: 'var(--ink-strong)' }}>
            Forecast
          </h1>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={() => { hapticMedium(); pinLocation() }}
          aria-label={hasCoords ? 'Pin again location' : 'Pin location for weather'}
          style={{
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: 10,
            border: hasCoords ? '1px solid rgba(201,150,58,0.3)' : '1px solid var(--rule)',
            background: hasCoords ? 'rgba(201,150,58,0.1)' : 'var(--surface-2)',
            color: hasCoords ? 'var(--field-gold-bright)' : 'var(--ink-strong)',
            display: 'grid',
            placeItems: 'center',
            cursor: 'pointer'
          }}
        >
          <MapPin size={20} />
        </motion.button>
      </motion.div>

      {/* LOCATION / ERROR STRIP */}
      <motion.div variants={item} style={{ padding: '0 24px 12px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '4px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600 }}>
          <MapPin size={11} color="var(--field-gold-bright)" />
          {hasCoords
            ? (cityName || `${(profile.location_lat as any).toFixed(2)}, ${(profile.location_lon as any).toFixed(2)}`)
            : (cityName || 'Murfreesboro, TN')}
        </div>
        {err && (
          <div role="alert" style={{ marginTop: 8, fontSize: 12, color: 'var(--alert-red)', fontFamily: 'var(--font-body)' }}>
            {err}
          </div>
        )}
      </motion.div>

      {/* TODAY HERO */}
      <motion.div className="fh-card-raised"
        variants={item}
        style={{
          position: 'relative',
          overflow: 'hidden',
          margin: '0 20px 14px',
          padding: '24px 24px 24px',
          borderRadius: 10,
          background: 'linear-gradient(135deg, rgba(20, 20, 20,0.9), rgba(20, 20, 20,0.6))',
          border: `1px solid ${tone.border}`
        }}
      >
        <Spotlight />
        <Spotlight style={{ animationDelay: '-1.5s' }} />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', position: 'relative', gap: 12 }}>
          <div style={{ minWidth: 0, flex: 1 }}>
            <Eyebrow as="div" style={{ color: 'var(--ink-muted)' }}>
              Today · {weatherLabel(currentCode)}
            </Eyebrow>
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 10 }}>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, letterSpacing: 0, lineHeight: 0.9, color: 'var(--ink-strong)' }}>
                {loading || currentTemp == null ? '\u2003' : Math.round(currentTemp)}
              </span>
              <span style={{ fontFamily: 'var(--font-display)', fontSize: 24, color: 'var(--ink-muted)', marginTop: 6 }}>°F</span>
            </div>
          </div>
          <div
            aria-hidden="true"
            style={{ flexShrink: 0, width: 56, height: 56, borderRadius: 10, background: 'linear-gradient(135deg, #5C5C5C, #141414)', display: 'grid', placeItems: 'center' }}
          >
            <CloudSun size={26} color="#F2EDE4" />
          </div>
        </div>

        {/* Status banner */}
        <div
          style={{
            marginTop: 16,
            display: 'flex',
            alignItems: 'center',
            gap: 12,
            padding: '12px 12px',
            borderRadius: 10,
            background: tone.bg,
            border: `1px solid ${tone.border}`,
            position: 'relative'
          }}
        >
          <span
            aria-hidden="true"
            style={{ width: 10, height: 10, borderRadius: 10, background: tone.fg, boxShadow: `0 0 12px ${tone.fg}99` }}
          />
          <div style={{ minWidth: 0, flex: 1 }}>
            <Eyebrow as="div" style={{ color: tone.fg }}>
              {currentWindow.label || tone.label}
            </Eyebrow>
            {currentWindow.reasons?.length > 0 && (
              <div style={{ marginTop: 2, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)' }}>
                {currentWindow.reasons.slice(0, 3).join(' · ')}
              </div>
            )}
          </div>
        </div>

        {/* Metric trio */}
        <div style={{ marginTop: 14, display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, position: 'relative' }}>
          <Metric Icon={Wind} label="Wind" value={currentWind != null ? `${Math.round(currentWind)}` : '\u2003'} unit="mph" />
          <Metric Icon={Droplets} label="Rain now" value={`${(currentRain || 0).toFixed(2)}`} unit='in/h' />
          <Metric Icon={Thermometer} label="Humidity" value={currentHumidity != null ? `${Math.round(currentHumidity)}` : '\u2003'} unit="%" />
        </div>
      </motion.div>

      {/* 24-HOUR STRIP */}
      {strip.length > 0 && (
        <motion.section variants={item} style={{ padding: '0 0 16px' }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '0 24px 12px' }}>
            <Eyebrow style={{ color: 'var(--ink-muted)' }}>
              Next 24 hours
            </Eyebrow>
            <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-faint)' }}>· swipe</span>
          </header>
          <div
            style={{
              display: 'flex',
              gap: 8,
              padding: '4px 24px 4px',
              overflowX: 'auto',
              scrollbarWidth: 'none',
              WebkitOverflowScrolling: 'touch'
            }}
          >
            {strip.map((h, i) => {
              const t = statusTone(h.status)
              const hr = new Date(h.time).getHours()
              const isMarker = hr === 0 || hr === 6 || hr === 12 || hr === 18
              const markerLabel = hr === 0 ? '12A' : hr === 6 ? '6A' : hr === 12 ? '12P' : '6P'
              return (
                <div
                  key={i}
                  style={{
                    flexShrink: 0,
                    width: 48,
                    padding: '12px 4px 12px',
                    borderRadius: 10,
                    background: 'var(--surface-2)',
                    border: '1px solid var(--rule)',
                    display: 'flex',
                    flexDirection: 'column',
                    alignItems: 'center',
                    gap: 8,
                    position: 'relative'
                  }}
                >
                  {isMarker && (
                    <span
                      aria-hidden="true"
                      style={{
                        position: 'absolute',
                        top: 0,
                        left: '50%',
                        transform: 'translateX(-50%)',
                        width: '2px',
                        height: '2px',
                        background: 'rgba(201,150,58,0.2)'
                      }}
                    />
                  )}
                  {/* Single time label per cell. The previous render had
                      both fmtHour and a markerLabel that printed "12A" /
                      "6A" / "12P" / "6P" twice, stacked vertically.
                      Marker hours now just get a slightly bolder color. */}
                  <span style={{ fontSize: 12, fontWeight: isMarker ? 800 : 700, color: isMarker ? 'var(--field-gold-bright)' : 'var(--ink-muted)', fontFamily: 'var(--font-body)', letterSpacing: 0 }}>
                    {fmtHour(h.time)}
                  </span>
                  <span
                    aria-hidden="true"
                    style={{ width: 8, height: 8, borderRadius: 10, background: t.fg, boxShadow: `0 0 8px ${t.fg}99` }}
                  />
                  <span style={{ fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--ink-strong)', letterSpacing: 0 }}>
                    {fmtTemp(h.temp)}
                  </span>
                  <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-faint)' }}>
                    {Math.round(h.rain || 0)}%
                  </span>
                </div>
              )
            })}
          </div>
        </motion.section>
      )}

      {/* 3-DAY CARDS */}
      {daily.length > 0 && (
        <motion.section variants={item} className="v3-section" style={{ margin: '0 var(--v3-gutter) 14px' }}>
          <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
            <Eyebrow style={{ color: 'var(--ink-muted)' }}>
              Forecast
            </Eyebrow>
          </header>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {daily.map((d: any, i: any) => {
              // Aggregate status for a given day: worst of midday-ish hours
              const dayStatus = dayAggregateStatus(weather, services, d.time)
              const t = statusTone(dayStatus)
              return (
                <div
                  key={d.time}
                  style={{
                    position: 'relative',
                    overflow: 'hidden',
                    padding: '12px 16px 12px 24px',
                    borderRadius: 10,
                    background: 'linear-gradient(180deg, var(--surface-2) 0%, var(--surface-2) 100%)',
                    border: '1px solid var(--rule)'
                  }}
                >
                  <span
                    aria-hidden="true"
                    style={{ position: 'absolute', left: 0, top: 10, bottom: 10, width: 3, borderRadius: '0 3px 3px 0', background: t.fg, boxShadow: `0 0 10px ${t.fg}99` }}
                  />
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                        <span style={{ fontFamily: 'var(--font-display)', fontSize: 16, letterSpacing: 0, color: i === 0 ? 'var(--field-gold-bright)' : 'var(--ink-strong)' }}>
                          {i === 0 ? 'TODAY' : fmtDay(d.time)}
                        </span>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)' }}>
                          {fmtDate(d.time)}
                        </span>
                      </div>
                      <div style={{ marginTop: 4, display: 'flex', alignItems: 'center', gap: 12, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)', flexWrap: 'wrap' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Droplets size={11} />
                          {Math.round(d.rainPct)}%
                        </span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                          <Wind size={11} />
                          {Math.round(d.windMax)} mph
                        </span>
                        <Eyebrow style={{ gap: 4, padding: '4px 8px', borderRadius: 10, background: t.bg, border: `1px solid ${t.border}`, color: t.fg }}>
                          {dayStatus === 'go' ? 'GO' : dayStatus === 'warn' ? 'TIGHT' : 'STOP'}
                        </Eyebrow>
                      </div>
                    </div>
                    <div style={{ flexShrink: 0, textAlign: 'right' }}>
                      <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: 0, color: 'var(--ink-strong)', lineHeight: 1 }}>
                        {fmtTemp(d.tMax)}
                      </div>
                      <div style={{ marginTop: 2, fontFamily: 'var(--font-display)', fontSize: 14, color: 'var(--ink-faint)', letterSpacing: 0 }}>
                        {fmtTemp(d.tMin)}
                      </div>
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </motion.section>
      )}

      {/* PER-TRADE BREAKDOWN */}
      <motion.section variants={item} className="v3-section" style={{ margin: '0 var(--v3-gutter) 14px' }}>
        <header style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 10 }}>
          <Eyebrow style={{ color: 'var(--ink-muted)' }}>
            Trades on your list · today
          </Eyebrow>
        </header>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          {tradeRows.length === 0 && (
            <div style={{ padding: '12px 16px', borderRadius: 10, background: 'var(--surface-2)', border: '1px dashed var(--rule)', color: 'var(--ink-muted)', fontSize: 12, fontFamily: 'var(--font-body)' }}>
              Awaiting current conditions.
            </div>
          )}
          {tradeRows.map((r) => {
            const t = statusTone(r.status)
            const Glyph = r.status === 'go' ? Check : r.status === 'warn' ? AlertTriangle : X
            return (
              <div
                key={r.trade}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 12px',
                  borderRadius: 10,
                  background: 'var(--surface-2)',
                  border: '1px solid var(--rule)'
                }}
              >
                <span
                  aria-hidden="true"
                  style={{ flexShrink: 0, width: 28, height: 28, borderRadius: 10, background: t.bg, border: `1px solid ${t.border}`, display: 'grid', placeItems: 'center', color: t.fg }}
                >
                  <Glyph size={14} strokeWidth={2.4} />
                </span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: 'var(--ink-strong)', textTransform: 'capitalize' }}>
                    {r.trade}
                  </div>
                  {r.status !== 'go' && r.reasons?.length > 0 ? (
                    <div style={{ marginTop: 2, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-muted)' }}>
                      {r.trade.toLowerCase()}: {r.reasons[0].toLowerCase()}
                    </div>
                  ) : (
                    <div style={{ marginTop: 2, fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-faint)' }}>
                      Within spec
                    </div>
                  )}
                </div>
                <Eyebrow style={{ flexShrink: 0, padding: '4px 8px', borderRadius: 10, background: t.bg, border: `1px solid ${t.border}`, color: t.fg }}>
                  {r.status === 'go' ? 'GO' : r.status === 'warn' ? 'TIGHT' : 'STOP'}
                </Eyebrow>
              </div>
            )
          })}
        </div>
      </motion.section>
    </motion.div>
  )
}

// Aggregate a whole day's status by sampling the daylight window (08:00–18:00)
// out of the hourly array and taking the worst per-trade read. Falls back to
// daily max values when no hourly slice matches.
function dayAggregateStatus(weather: any, services: any, dayIso: any) {
  const h = weather?.hourly
  if (!h?.time || !dayIso) return 'go'
  const dayPrefix = dayIso.slice(0, 10) // "year month day"
  let worst = 'go'
  for (let i = 0; i < h.time.length; i++) {
    if (!String(h.time[i]).startsWith(dayPrefix)) continue
    const hr = new Date(h.time[i]).getHours()
    if (hr < 7 || hr > 18) continue
    const snap = {
      temperature_2m: h.temperature_2m?.[i],
      precipitation: h.precipitation?.[i],
      wind_speed_10m: h.wind_speed_10m?.[i],
      relative_humidity_2m: h.relative_humidity_2m?.[i]
    }
    const w = workWindow(snap, services)
    if (w.status === 'stop') return 'stop'
    if (w.status === 'warn' && worst !== 'stop') worst = 'warn'
  }
  return worst
}

function Metric({ Icon, label, value, unit }: any) {
  return (
    <div
      style={{
        padding: '12px 12px 12px',
        borderRadius: 10,
        background: 'var(--surface-2)',
        border: '1px solid var(--rule)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8
      }}
    >
      <Eyebrow style={{ gap: 4, color: 'var(--ink-muted)' }}>
        {Icon && <Icon size={10} />}
        {label}
      </Eyebrow>
      <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 4 }}>
        <span style={{ fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: 0, lineHeight: 1, color: 'var(--ink-strong)' }}>
          {value}
        </span>
        {unit && (
          <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--ink-faint)', letterSpacing: 0, textTransform: 'uppercase' }}>
            {unit}
          </span>
        )}
      </span>
    </div>
  )
}
