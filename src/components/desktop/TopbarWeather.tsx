// TopbarWeather, ONE weather slot for every desktop topbar.
//
// The build screens each hardcoded "Weather not set" while Home and
// Forecast fetched real conditions, so the same header slot resolved on
// two screens and failed on six, and the two that worked could even
// disagree (UI audit #28). This component owns the fetch (shared
// module-level cache, one request per coords per 10 minutes) so every
// screen shows the same numbers or hides the slot entirely.

import { useEffect, useState } from 'react'
import { Sun } from 'lucide-react'
import { useProfile } from '../../contexts/ProfileContext.tsx'
import { getWeather, weatherLabel, MURFREESBORO } from '../../lib/weather.ts'

const TTL_MS = 10 * 60 * 1000
let cache: { key: string; at: number; data: any } | null = null
let inflight: { key: string; promise: Promise<any> } | null = null

async function cachedWeather(lat: number, lon: number) {
  const key = `${lat.toFixed(3)},${lon.toFixed(3)}`
  if (cache && cache.key === key && Date.now() - cache.at < TTL_MS) return cache.data
  if (inflight && inflight.key === key) return inflight.promise
  const promise = getWeather(lat, lon).then((data) => {
    cache = { key, at: Date.now(), data }
    inflight = null
    return data
  }).catch((e) => {
    inflight = null
    throw e
  })
  inflight = { key, promise }
  return promise
}

// `given` is for a screen that already fetched the forecast: pass that
// snapshot and this slot shows it without a second request. null means
// the screen is still loading it (the slot stays empty); leave the prop
// out and the slot fetches for itself, as every other screen does.
export default function TopbarWeather({ snapshot: given }: { snapshot?: any } = {}) {
  const { profile } = useProfile()
  const screenOwns = given !== undefined
  const [fetched, setFetched] = useState<any>(() => cache?.data ?? null)
  const snapshot = screenOwns ? given : fetched

  const lat: number = (profile as any)?.location_lat ?? MURFREESBORO.lat
  const lon: number = (profile as any)?.location_lon ?? MURFREESBORO.lon

  useEffect(() => {
    if (screenOwns) return
    let cancelled = false
    cachedWeather(lat, lon)
      .then((d) => { if (!cancelled) setFetched(d) })
      .catch(() => { /* header weather is decorative, fail silent */ })
    return () => { cancelled = true }
  }, [screenOwns, lat, lon])

  const temp = snapshot?.current?.temperature_2m
  if (temp == null) {
    if (screenOwns && snapshot === null) return null
    return <span style={{ opacity: 0.6 }}>Weather unavailable</span>
  }
  const cond = weatherLabel(snapshot?.current?.weather_code)
  return (
    <>
      <span>{Math.round(temp)}°{cond ? ` · ${cond}` : ''}</span>
      <Sun size={16} className="fh-build-sun" />
    </>
  )
}
