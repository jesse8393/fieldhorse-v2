import { Suspense, useEffect, useMemo, useState } from 'react'
import { Navigate, useNavigate } from 'react-router-dom'
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

/* ----------------- helpers ----------------- */

function greetingPrefix() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning,'
  if (h < 17) return 'Good afternoon,'
  return 'Good evening,'
}

function emailFirstToken(email: any) {
  if (!email) return ''
  const raw = email.split('@')[0].split(/[._-]/).filter(Boolean)[0] || ''
  return raw ? raw[0].toUpperCase() + raw.slice(1) : ''
}

function displayNameFrom(profile: any, user: any) {
  // Multi-tenant guard: profile must belong to the current auth user.
  // Without this, a stale profile row left in context during a sign-out
  // → sign in transition can leak the prior user's name onto the greeting.
  const profileMatchesUser = profile && user && profile.user_id === user!.id
  const full = profileMatchesUser ? profile.full_name?.trim() : ''
  if (full) return full
  return emailFirstToken(user?.email)
}

// Map Open-Meteo weather_code to a short label. Covers the common buckets;
// rare codes fall through to "\u2003" so we don't lie about the conditions.
function weatherLabel(code: any) {
  if (code == null) return ''
  if (code === 0) return 'Clear'
  if (code <= 2) return 'Partly cloudy'
  if (code <= 3) return 'Overcast'
  if (code <= 48) return 'Foggy'
  if (code <= 67) return 'Rain'
  if (code <= 77) return 'Snow'
  if (code <= 82) return 'Showers'
  if (code <= 99) return 'Storms'
  return ''
}

/* ----------------- screen ----------------- */

export default function Home() {
  const { user } = useAuth()
  const { profile, upsertProfile, refresh } = useProfile()
  const navigate = useNavigate()

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  // Weather
  const [weather, setWeather] = useState<any>(null)
  const [weatherErr, setWeatherErr] = useState('')

  const hasCoords = profile?.location_lat != null && profile?.location_lon != null
  const displayName = displayNameFrom(profile, user)
  const firstName = displayName ? displayName.split(/\s+/)[0] : 'there'
  const membership = useMembership()
  const dashboard = useHomeDashboard(user?.id, membership.orgId)
  useHomeDashboardRealtime(user?.id, membership.orgId)
  const dashboardData = dashboard.data
  const pipeline = dashboardData?.pipeline ?? null
  const pipelinePrev = dashboardData?.pipelinePrev ?? null
  const dealsAtRisk = dashboardData?.dealsAtRisk ?? null
  const jobsBehind = dashboardData?.jobsBehind ?? null
  const invoicingWeek = dashboardData?.invoicingWeek ?? null
  const topPipeline = dashboardData?.topPipeline ?? null
  const jobHealth = dashboardData?.jobHealth ?? null
  const stageBreakdown = dashboardData?.stageBreakdown ?? null
  const stageRailData = dashboardData?.stageRail ?? null
  const todayOnSite = dashboardData?.todayOnSite ?? null
  const nextActions = dashboardData?.nextActions ?? null
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

  /* ----- Derived ----- */
  const trendUp = pipeline != null && pipelinePrev != null && pipeline >= pipelinePrev
  const trendPct = useMemo(() => {
    if (pipeline == null || pipelinePrev == null || pipelinePrev <= 0) return null
    const pct = ((pipeline - pipelinePrev) / pipelinePrev) * 100
    if (!Number.isFinite(pct)) return null
    return Math.round(pct)
  }, [pipeline, pipelinePrev])

  // Empty while loading, consumers show a shimmer or ellipsis instead
  // of a printed dash (user-facing copy carries no dashes).
  const tempStr = weather?.current?.temperature_2m != null
    ? `${Math.round(weather.current.temperature_2m)}°`
    : ''
  const condStr = weatherLabel(weather?.current?.weather_code)

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

  // Phase 10, desktop dispatch. At >=900px the new
  // DesktopHomeCommandCenter renders the full command-center layout
  // using the same data this screen already fetches. Below 900px
  // TodayPhone renders, after this branch.
  if (isDesktop) {
    return (
      <Suspense fallback={null}>
        <SnowHome
          firstName={firstName}
          now={now}
          hasCoords={hasCoords}
          tempStr={tempStr}
          condStr={condStr}
          weatherErr={weatherErr}
          pinLocation={pinLocation}
          pipeline={pipeline}
          trendUp={trendUp}
          trendPct={trendPct}
          stageBreakdown={stageBreakdown}
          stageRail={stageRailData}
          jobHealth={jobHealth}
          dealsAtRisk={dealsAtRisk}
          jobsBehind={jobsBehind}
          invoicingWeek={invoicingWeek}
          todayOnSite={todayOnSite}
          topPipeline={topPipeline}
          nextActions={nextActions}
          dashboardError={dashboardError}
          onRetryDashboard={() => { dashboard.refetch() }}
          onGoToJobs={(filter: any) => navigate(filter ? `/jobs?stage=${filter}` : '/jobs')}
          onGoToPipeline={() => navigate('/pipeline')}
          onGoToLeads={(filter?: string) => navigate(filter ? `/leads?stage=${filter}` : '/leads')}
          onGoToQuotes={() => navigate('/quotes')}
          onGoToActivity={() => navigate('/activity')}
          onGoToSchedule={() => navigate('/schedule')}
          onGoToInvoices={() => navigate('/invoices')}
          onGoToBid={() => navigate('/bid')}
          onGoToCompose={() => navigate('/compose')}
          onGoToPourWindow={() => navigate('/pour-window')}
          onOpenJob={(id: any) => navigate(`/jobs/${id}`)}
          onOpenJobAtTab={(id: any, tab: any, intent: any) => navigate(jobActionPath(id, tab, intent))}
          onNewLead={() => navigate('/leads?new=1')}
        />
      </Suspense>
    )
  }

  // Phone, below 900 px: Today on its onyx stage (spec 9.2). The pipeline
  // hero, quick actions, KPI tiles and pipeline preview stay on the
  // desktop view for now; their routes are a tap away in the dock and
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
