// TopbarWeather, ONE weather slot for every desktop topbar.
//
// The build screens each hardcoded "Weather not set" while Home and
// Forecast fetched real conditions, so the same header slot resolved on
// two screens and failed on six, and the two that worked could even
// disagree (UI audit #28). This component owns the fetch (shared
// module-level cache, one request per coords per 10 minutes) so every
// screen shows the same numbers or hides the slot entirely.
//
// The forecast is always for the company's own pinned spot. With no
// coordinates there is nothing to show: someone who can open Settings
// (an owner or an admin) gets a "Set location" link to the location card
// there, everyone else gets nothing (Phase 8, Task 15). It used to fall
// back to Murfreesboro's forecast and show it as if it were theirs. A
// profile that could not be read shows nothing either: its spot is
// unknown, not missing.

import { useEffect, useState } from 'react'
import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { MapPin, Sun } from 'lucide-react'
import { useProfile } from '../../contexts/ProfileContext.tsx'
import { useMembership } from '../../contexts/MembershipContext.tsx'
import { getWeather, weatherLabel } from '../../lib/weather.ts'
import './topbar-weather.css'

const TTL_MS = 10 * 60 * 1000
let cache: { key: string; at: number; data: any } | null = null
let inflight: { key: string; promise: Promise<any> } | null = null

function coordsKey(lat: number, lon: number) {
  return `${lat.toFixed(3)},${lon.toFixed(3)}`
}

function coordinate(value: unknown): number | null {
  if (value == null || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

async function cachedWeather(lat: number, lon: number) {
  const key = coordsKey(lat, lon)
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

export type TopbarWeatherProps = {
  /**
   * For a screen that already fetched the forecast: pass that snapshot and
   * this slot shows it without a second request. null means the screen is
   * still loading it (the slot stays empty); leave the prop out and the
   * slot fetches for itself, as every other screen does.
   */
  snapshot?: any
  /** Wraps whatever the slot shows in a span with this class (the job banner's pill), and draws nothing when it shows nothing. */
  className?: string
  /** Draws the topbar's thin divider before the slot, only when the slot shows something. */
  lead?: boolean
}

export default function TopbarWeather({ snapshot: given, className, lead = false }: TopbarWeatherProps = {}) {
  const { profile, loading: profileLoading, error: profileError } = useProfile()
  const { canEditSettings } = useMembership()
  // Whether the company's pinned spot is known: the profile has loaded (a
  // later read that failed keeps the row it had). After a failed first read
  // (an offline cold open, a server error) it is not known, so the slot
  // tells an owner nothing rather than to set a location they may have.
  const profileKnown = !profileLoading && (profile != null || profileError == null)
  const screenOwns = given !== undefined

  const lat = coordinate((profile as any)?.location_lat)
  const lon = coordinate((profile as any)?.location_lon)
  const located = lat != null && lon != null
  const key = located ? coordsKey(lat, lon) : null
  const [fetched, setFetched] = useState<{ key: string; data: any } | null>(() =>
    cache && key && cache.key === key ? { key, data: cache.data } : null
  )
  // A forecast fetched for another spot (the location changed) is not this one.
  const snapshot = screenOwns ? given : fetched && fetched.key === key ? fetched.data : null

  useEffect(() => {
    if (screenOwns || lat == null || lon == null) return
    let cancelled = false
    cachedWeather(lat, lon)
      .then((d) => { if (!cancelled) setFetched({ key: coordsKey(lat, lon), data: d }) })
      .catch(() => { /* header weather is decorative, fail silent */ })
    return () => { cancelled = true }
  }, [screenOwns, lat, lon])

  let body: ReactNode = null
  if (!located) {
    // No pinned spot: nothing to forecast. Wait for the profile so an owner
    // never sees the link flash before their location arrives, and say
    // nothing when it could not be read.
    if (profileKnown && canEditSettings) {
      body = (
        <Link to="/settings#location" className="fh-weather-pin">
          <MapPin size={16} aria-hidden="true" />
          Set location
        </Link>
      )
    }
  } else {
    const temp = snapshot?.current?.temperature_2m
    if (temp == null) {
      if (!(screenOwns && snapshot === null)) body = <span style={{ opacity: 0.6 }}>Weather unavailable</span>
    } else {
      const cond = weatherLabel(snapshot?.current?.weather_code)
      body = (
        <>
          <span>{Math.round(temp)}°{cond ? ` · ${cond}` : ''}</span>
          <Sun size={16} className="fh-build-sun" />
        </>
      )
    }
  }

  if (body == null) return null
  return (
    <>
      {lead && <span className="fh-build-vline" />}
      {className ? <span className={className}>{body}</span> : body}
    </>
  )
}
