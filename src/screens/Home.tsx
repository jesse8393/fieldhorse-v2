import { Suspense, useEffect, useState } from 'react'
import { Navigate } from 'react-router-dom'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useProfile } from '../contexts/ProfileContext.tsx'
import { getWeather, MURFREESBORO } from '../lib/weather.ts'
import { useIsDesktop } from '../lib/useMediaQuery.ts'
import { useHomeDashboard, useHomeDashboardRealtime } from '../lib/homeDashboard.ts'
import type { HomeNextAction } from '../lib/homeDashboard.ts'
import { lazyWithRetry } from '../lib/lazyWithRetry.ts'
import TodayPhone from './today/TodayPhone.tsx'
// Lazy, desktop-only variant. Home itself is an eager route (loaded
// with the main bundle) so any static import here ships SnowHome to
// mobile users too even though they never render it. Lazy keeps the
// main bundle lean; desktop sees a near-instant suspense flash since
// the chunk fetches in parallel with first paint.
const SnowHome = lazyWithRetry(() => import('../components/desktop/SnowHomeBuild.tsx'))

/* ----------------- screen ----------------- */

export default function Home() {
  const { user } = useAuth()
  const { profile, upsertProfile, refresh } = useProfile()

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Weather
  const [weather, setWeather] = useState<any>(null)
  const [weatherErr, setWeatherErr] = useState('')

  const hasCoords = profile?.location_lat != null && profile?.location_lon != null
  const membership = useMembership()
  const dashboard = useHomeDashboard(user?.id, membership.orgId)
  useHomeDashboardRealtime(user?.id, membership.orgId)
  const dashboardData = dashboard.data
  const dashboardError = dashboard.error instanceof Error
    ? dashboard.error.message
    : dashboard.error
      ? 'Dashboard data could not refresh.'
      : ''

  /* ----- Weather ----- */
  useEffect(() => {
    let cancelled = false
    const lat = profile?.location_lat ?? MURFREESBORO.lat
    const lon = profile?.location_lon ?? MURFREESBORO.lon
    setWeatherErr('')
    getWeather(lat, lon)
      .then((d) => { if (!cancelled) setWeather(d) })
      .catch((e) => { if (!cancelled) setWeatherErr(e.message || 'Forecast unavailable') })
    return () => { cancelled = true }
  }, [profile?.location_lat, profile?.location_lon])

  function pinLocation() {
    if (!('geolocation' in navigator)) return setWeatherErr('Geolocation not supported')
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        await upsertProfile({ location_lat: pos.coords.latitude, location_lon: pos.coords.longitude })
        refresh()
      },
      () => setWeatherErr('Location denied'),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60 * 60 * 1000 }
    )
  }

  const isDesktop = useIsDesktop()

  // Role-based redirect: foreman + crew don't see the owner dashboard
  // (no $ amounts, no AR, no pipeline). Send them straight to /crew,
  // which surfaces their own schedule + own punches + own tasks.
  // We wait for membership to resolve so the redirect doesn't fire
  // mid-fetch and flap the URL.
  if (!membership.loading && (membership.role === 'crew' || membership.role === 'foreman')) {
    return <Navigate to="/crew" replace />
  }

  // Sub-only redirect: an authenticated user with NO org membership
  // is, in practice, somebody who accepted a partner invite (or
  // signed up without onboarding). Land them on /sub-portal, the
  // owner dashboard would 403 every query they made. Only on a clean
  // answer: a failed membership fetch (offline cold open) also leaves
  // no role, and the cached dashboard is what that owner needs.
  if (!membership.loading && !membership.error && !membership.role && !membership.orgId) {
    return <Navigate to="/sub-portal" replace />
  }

  // Desktop, 900 px and wider: Today as a two column page (Phase 4, Task
  // 4.5), from the same bundle and the same buildTodayView as the phone.
  if (isDesktop) {
    return (
      <Suspense fallback={null}>
        <SnowHome
          bundle={dashboardData}
          loading={dashboard.isPending}
          error={dashboardError}
          onRetry={() => { dashboard.refetch() }}
          now={now}
          lat={profile?.location_lat}
          lon={profile?.location_lon}
          services={profile?.services}
          forecast={weather}
          forecastError={weatherErr}
          hasLocation={hasCoords}
          onPinLocation={pinLocation}
          actionPath={nextActionPath}
        />
      </Suspense>
    )
  }

  // Phone, below 900 px: Today on its onyx stage (spec 9.2). The pipeline
  // numbers live in Reports; their routes are a tap away in the dock and
  // the workspace menu.
  return (
    <TodayPhone
      bundle={dashboardData}
      loading={dashboard.isPending}
      error={dashboardError}
      onRetry={() => { dashboard.refetch() }}
      now={now}
      lat={profile?.location_lat}
      lon={profile?.location_lon}
      services={profile?.services}
      forecast={weather}
      forecastError={weatherErr}
      hasLocation={hasCoords}
      onPinLocation={pinLocation}
      actionPath={nextActionPath}
    />
  )
}

/* ----------------- next action links ----------------- */

function jobActionPath(contactId: any, tab?: any, intent?: any) {
  if (!contactId) return '/jobs'
  const params = new URLSearchParams()
  if (tab) params.set('tab', String(tab))
  if (intent) params.set('action', String(intent))
  const query = params.toString()
  return `/jobs/${contactId}${query ? `?${query}` : ''}`
}

function nextActionPath(action: HomeNextAction) {
  if (!action?.contactId) return '/jobs'
  return jobActionPath(action.contactId, action.tab, action.intent)
}
