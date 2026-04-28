import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import {
  CloudSun,
  MapPin,
  Plus,
  CalendarRange,
  Receipt,
  FileText,
  ArrowUpRight,
  ArrowDownRight,
  Activity
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { supabase } from '../lib/supabase.js'
import { getWeather, MURFREESBORO } from '../lib/weather.js'
import { ACTIVE_STAGES } from '../lib/stages.js'
import { useFhMotion } from '../lib/motion.js'
import CountUp from '../components/fx/CountUp.jsx'
import { Card, KpiTile, QuickAction, Sparkline, SectionHeader, FeedRow, Pill } from '../components/v3'
import { hapticTap } from '../lib/haptics.js'

/* ----------------- helpers ----------------- */

function greetingPrefix() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning,'
  if (h < 17) return 'Good afternoon,'
  return 'Good evening,'
}

function formatLongDate(d) {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}

function emailFirstToken(email) {
  if (!email) return ''
  const raw = email.split('@')[0].split(/[._-]/).filter(Boolean)[0] || ''
  return raw ? raw[0].toUpperCase() + raw.slice(1) : ''
}

function displayNameFrom(profile, user) {
  // Multi-tenant guard: profile must belong to the current auth user.
  // Without this, a stale profile row left in context during a sign-out
  // → sign-in transition can leak the prior user's name onto the greeting.
  const profileMatchesUser = profile && user && profile.user_id === user.id
  const full = profileMatchesUser ? profile.full_name?.trim() : ''
  if (full) return full
  return emailFirstToken(user?.email)
}

// Map Open-Meteo weather_code to a short label. Covers the common buckets;
// rare codes fall through to "—" so we don't lie about the conditions.
function weatherLabel(code) {
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

// Stub trend until a daily snapshot table exists. Generates 7 points
// climbing toward `target` so the spark visually agrees with the
// number above it. Marked as TODO so this gets replaced when the
// snapshot pipeline lands.
function buildSparkline(target) {
  const v = Number(target) || 0
  if (v <= 0) return Array.from({ length: 7 }, (_, i) => ({ v: 0 }))
  const start = v * 0.55
  const pts = []
  let cur = start
  for (let i = 0; i < 6; i++) {
    const wobble = 0.08 * Math.sin(i * 1.7 + v % 7)
    const rise = (v - start) / 6
    cur = cur + rise + cur * wobble * 0.15
    pts.push({ v: Math.max(0, Math.round(cur)) })
  }
  pts.push({ v: Math.round(v) })
  return pts
}

function startOfWeek(now) {
  const d = new Date(now)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - d.getDay())
  return d
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
  const [weather, setWeather] = useState(null)
  const [weatherErr, setWeatherErr] = useState('')

  // KPIs default to null (loading) so we never flash "0" before the
  // query lands — the perception bug fix carried over from v2.
  const [pipeline, setPipeline] = useState(null)
  const [pipelinePrev, setPipelinePrev] = useState(null)
  const [dealsAtRisk, setDealsAtRisk] = useState(null) // { count, value }
  const [jobsBehind, setJobsBehind] = useState(null)
  const [invoicingWeek, setInvoicingWeek] = useState(null)
  const [feed, setFeed] = useState(null)
  const [refreshTick, setRefreshTick] = useState(0)

  const hasCoords = profile?.location_lat != null && profile?.location_lon != null
  const displayName = displayNameFrom(profile, user)
  const firstName = displayName ? displayName.split(/\s+/)[0] : 'there'

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

  /* ----- KPIs + Live Feed ----- */
  useEffect(() => {
    if (!user) return
    let cancelled = false
    async function load() {
      const nowD = new Date()
      const sevenDaysAgo = new Date(nowD); sevenDaysAgo.setDate(nowD.getDate() - 7)
      const fourteenDaysAgo = new Date(nowD); fourteenDaysAgo.setDate(nowD.getDate() - 14)
      const wkStart = startOfWeek(nowD)
      const todayStart = new Date(nowD); todayStart.setHours(0, 0, 0, 0)
      const todayEnd = new Date(todayStart); todayEnd.setDate(todayEnd.getDate() + 1)

      const [contactsRes, overdueSchedRes, paysRes, recentSchedRes, recentPaysRes] = await Promise.all([
        // Contacts: stages + amounts + last update for at-risk calc.
        // updated_at falls back to created_at if missing.
        supabase
          .from('fh_contacts')
          .select('id, name, amount, stage, updated_at, created_at')
          .eq('user_id', user.id),
        // Schedule entries that should already have ended → if linked to a
        // job-stage contact, that contact is "behind schedule".
        supabase
          .from('fh_schedule')
          .select('contact_id, end_at, start_at')
          .eq('user_id', user.id)
          .lt('end_at', nowD.toISOString())
          .gte('end_at', fourteenDaysAgo.toISOString()),
        // Payments collected this week (Sun → today).
        supabase
          .from('fh_payments')
          .select('amount, created_at')
          .eq('user_id', user.id)
          .gte('created_at', wkStart.toISOString()),
        // Live Feed source #1: recent schedule entries (today ± a bit).
        supabase
          .from('fh_schedule')
          .select('id, contact_id, start_at, title')
          .eq('user_id', user.id)
          .gte('start_at', sevenDaysAgo.toISOString())
          .order('start_at', { ascending: false })
          .limit(4),
        // Live Feed source #2: most recent payments.
        supabase
          .from('fh_payments')
          .select('id, contact_id, amount, created_at')
          .eq('user_id', user.id)
          .order('created_at', { ascending: false })
          .limit(4)
      ])

      if (cancelled) return

      const contacts = contactsRes.data || []
      const contactById = new Map(contacts.map((c) => [c.id, c]))

      // Pipeline = sum of $ across active stages.
      const totalPipeline = contacts
        .filter((c) => ACTIVE_STAGES.includes(c.stage))
        .reduce((s, c) => s + Number(c.amount || 0), 0)

      // Pipeline 7 days ago = active stages whose record predates the window
      // (i.e. existed back then). Best-effort proxy until snapshot table.
      const prevPipeline = contacts
        .filter((c) => {
          if (!ACTIVE_STAGES.includes(c.stage)) return false
          const created = new Date(c.created_at || nowD)
          return created < sevenDaysAgo
        })
        .reduce((s, c) => s + Number(c.amount || 0), 0)

      // Deals At Risk = lead/quote with no update in 7+ days.
      const risky = contacts.filter((c) => {
        if (c.stage !== 'lead' && c.stage !== 'quote') return false
        const last = new Date(c.updated_at || c.created_at || 0)
        return last < sevenDaysAgo
      })
      const riskValue = risky.reduce((s, c) => s + Number(c.amount || 0), 0)

      // Jobs Behind Schedule = stage=job + has at least one schedule entry
      // whose end_at is in the past.
      const overdueContactIds = new Set(
        (overdueSchedRes.data || []).map((s) => s.contact_id).filter(Boolean)
      )
      const behind = contacts.filter((c) => c.stage === 'job' && overdueContactIds.has(c.id))

      // Invoicing this week = sum of payments collected since Sunday.
      const weekTotal = (paysRes.data || []).reduce((s, p) => s + Number(p.amount || 0), 0)

      // Live Feed = merge recent schedule + payment events, newest first.
      const schedFeed = (recentSchedRes.data || []).map((s) => {
        const c = contactById.get(s.contact_id)
        const startMs = s.start_at ? new Date(s.start_at).getTime() : 0
        const onSite = startMs && startMs <= nowD.getTime() && (nowD.getTime() - startMs) < 12 * 60 * 60 * 1000
        return {
          id: `sched-${s.id}`,
          ts: startMs,
          type: 'crew-on-site',
          title: c?.name || s.title || 'Scheduled job',
          detail: onSite ? 'Crew on site' : 'Scheduled visit',
          timestamp: s.start_at,
          pillTone: onSite ? 'success' : 'neutral',
          pillLabel: onSite ? 'On Site' : 'Upcoming',
          contactId: s.contact_id
        }
      })
      const payFeed = (recentPaysRes.data || []).map((p) => {
        const c = contactById.get(p.contact_id)
        return {
          id: `pay-${p.id}`,
          ts: p.created_at ? new Date(p.created_at).getTime() : 0,
          type: 'invoice',
          title: c?.name || 'Payment received',
          detail: `Payment $${Math.round(Number(p.amount || 0)).toLocaleString()}`,
          timestamp: p.created_at,
          pillTone: 'success',
          pillLabel: 'Paid',
          contactId: p.contact_id
        }
      })
      const feedRows = [...schedFeed, ...payFeed]
        .filter((r) => r.ts > 0)
        .sort((a, b) => b.ts - a.ts)
        .slice(0, 3)

      setPipeline(totalPipeline)
      setPipelinePrev(prevPipeline)
      setDealsAtRisk({ count: risky.length, value: riskValue })
      setJobsBehind(behind.length)
      setInvoicingWeek(weekTotal)
      setFeed(feedRows)
    }
    load()
    return () => { cancelled = true }
  }, [user, refreshTick])

  /* ----- Realtime: re-fetch on any contact change for this user ----- */
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`fh_contacts:home:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fh_contacts', filter: `user_id=eq.${user.id}` },
        () => setRefreshTick((t) => t + 1)
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user])

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
  const sparkData = useMemo(() => buildSparkline(pipeline), [pipeline])
  const trendUp = pipeline != null && pipelinePrev != null && pipeline >= pipelinePrev
  const trendPct = useMemo(() => {
    if (pipeline == null || pipelinePrev == null || pipelinePrev <= 0) return null
    const pct = ((pipeline - pipelinePrev) / pipelinePrev) * 100
    if (!Number.isFinite(pct)) return null
    return Math.round(pct)
  }, [pipeline, pipelinePrev])

  const tempStr = weather?.current?.temperature_2m != null
    ? `${Math.round(weather.current.temperature_2m)}°`
    : '—'
  const condStr = weatherLabel(weather?.current?.weather_code)

  const { stagger, item } = useFhMotion()

  /* ----- Render ----- */
  return (
    <motion.div
      className="v3-screen"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 120 }}
    >
      {/* GREETING + WEATHER CHIP */}
      <motion.div
        variants={item}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          padding: '8px 20px 16px'
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <h1 className="v3-h1">
            {greetingPrefix()} <em>{firstName}.</em>
          </h1>
          <div className="v3-caption" style={{ marginTop: 6 }}>
            {formatLongDate(now)}
          </div>
        </div>

        {hasCoords ? (
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            onClick={() => { hapticTap(); navigate('/pour-window') }}
            aria-label="Open weather forecast"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 'var(--v3-radius-btn)',
              background: 'var(--v3-surface-2)',
              border: '1px solid var(--v3-border)',
              color: 'var(--v3-text)',
              cursor: 'pointer',
              flexShrink: 0,
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            <CloudSun size={18} color="#8FB4E3" aria-hidden="true" />
            <div style={{ textAlign: 'left', lineHeight: 1.05 }}>
              <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700 }}>
                {tempStr}
              </div>
              {condStr ? (
                <div style={{ fontSize: 9, color: 'var(--v3-text-muted)', textTransform: 'uppercase', letterSpacing: '0.08em', marginTop: 2 }}>
                  {condStr}
                </div>
              ) : null}
            </div>
          </motion.button>
        ) : (
          <button
            type="button"
            onClick={pinLocation}
            aria-label="Pin location for weather"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              padding: '10px 12px',
              borderRadius: 'var(--v3-radius-btn)',
              background: 'rgba(212,175,55,0.08)',
              border: '1px solid rgba(212,175,55,0.25)',
              color: 'var(--v3-primary)',
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              fontWeight: 600,
              cursor: 'pointer',
              flexShrink: 0
            }}
          >
            <MapPin size={14} />
            Pin
          </button>
        )}
      </motion.div>
      {weatherErr && !hasCoords ? (
        <div className="v3-caption" style={{ padding: '0 20px 12px', color: 'var(--v3-danger)' }}>
          {weatherErr}
        </div>
      ) : null}

      {/* HERO — TODAY'S REVENUE OPPORTUNITY */}
      <motion.div variants={item} style={{ padding: '0 20px 16px' }}>
        <Card padding="lg" accent="hero">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span className="v3-eyebrow">Today's Revenue Opportunity</span>
            {trendPct != null ? (
              <Pill tone={trendUp ? 'success' : 'danger'} icon={trendUp ? ArrowUpRight : ArrowDownRight}>
                {trendUp ? '+' : ''}{trendPct}%
              </Pill>
            ) : null}
          </div>

          <div style={{ marginTop: 12, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
            <div className="v3-money" style={{ fontSize: 44, lineHeight: 1 }}>
              {pipeline == null ? (
                <span className="v3-skeleton" style={{ width: 140, height: 36 }} />
              ) : (
                <>
                  <span style={{ fontSize: 22, color: 'var(--v3-text-muted)', verticalAlign: 'top', marginRight: 2 }}>$</span>
                  <CountUp
                    to={pipeline}
                    formatter={(n) => n.toLocaleString()}
                  />
                </>
              )}
            </div>
            <div className="v3-caption">vs last 7 days</div>
          </div>

          <div style={{ marginTop: 14, marginLeft: -8, marginRight: -8 }}>
            <Sparkline data={sparkData} color="#D4AF37" height={56} />
          </div>

          <div style={{ marginTop: 6, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
            <span className="v3-caption" style={{ fontSize: 11 }}>
              Total Pipeline
            </span>
            <button
              type="button"
              onClick={() => { hapticTap(); navigate('/jobs') }}
              className="v3-section-link"
              style={{ fontSize: 11 }}
            >
              View all jobs →
            </button>
          </div>
        </Card>
      </motion.div>

      {/* 3-TILE KPI GRID */}
      <motion.div
        variants={item}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 8,
          padding: '0 20px 20px'
        }}
      >
        <KpiTile
          tone="danger"
          value={dealsAtRisk?.count}
          label="Deals At Risk"
          subline={dealsAtRisk?.value > 0 ? `$${dealsAtRisk.value.toLocaleString()}` : null}
          onTap={() => navigate('/jobs')}
        />
        <KpiTile
          tone="primary"
          value={jobsBehind}
          label="Jobs Behind Schedule"
          onTap={() => navigate('/schedule')}
        />
        <KpiTile
          tone="success"
          value={invoicingWeek}
          label="Invoicing This Week"
          isMoney
          onTap={() => navigate('/invoices')}
        />
      </motion.div>

      {/* QUICK ACTIONS */}
      <motion.div variants={item} style={{ padding: '0 20px 4px' }}>
        <SectionHeader
          label="Quick Actions"
          action={{ label: 'Edit', onTap: () => navigate('/settings'), showChevron: false }}
        />
      </motion.div>
      <motion.div
        variants={item}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(4, 1fr)',
          gap: 8,
          padding: '0 20px 22px'
        }}
      >
        <QuickAction icon={Plus} label="Add Lead" primary onTap={() => navigate('/jobs?new=1')} />
        <QuickAction icon={CalendarRange} label="Schedule Crew" onTap={() => navigate('/schedule')} />
        <QuickAction icon={Receipt} label="Send Invoice" onTap={() => navigate('/invoices')} />
        <QuickAction icon={FileText} label="New Estimate" onTap={() => navigate('/bid')} />
      </motion.div>

      {/* LIVE FEED */}
      <motion.div variants={item} style={{ padding: '0 20px 4px' }}>
        <SectionHeader
          label="Live Feed"
          action={{ label: 'View all', onTap: () => navigate('/jobs') }}
        />
      </motion.div>
      <motion.div
        variants={item}
        style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 20px 32px' }}
      >
        {feed == null ? (
          <>
            <div className="v3-skeleton" style={{ height: 60, width: '100%', borderRadius: 16 }} />
            <div className="v3-skeleton" style={{ height: 60, width: '100%', borderRadius: 16, opacity: 0.6 }} />
          </>
        ) : feed.length === 0 ? (
          <div
            style={{
              padding: '20px',
              borderRadius: 'var(--v3-radius-card)',
              background: 'var(--v3-surface-2)',
              border: '1px dashed var(--v3-border-strong)',
              textAlign: 'center'
            }}
          >
            <Activity size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 6px' }} />
            <div className="v3-caption" style={{ marginBottom: 10 }}>
              Quiet right now. No recent activity yet.
            </div>
            <button
              type="button"
              className="v3-btn v3-btn--secondary v3-btn--sm"
              onClick={() => navigate('/jobs?new=1')}
            >
              Add your first lead
            </button>
          </div>
        ) : (
          feed.map((row) => (
            <FeedRow
              key={row.id}
              type={row.type}
              title={row.title}
              detail={row.detail}
              timestamp={row.timestamp}
              pillTone={row.pillTone}
              pillLabel={row.pillLabel}
              onTap={() => row.contactId ? navigate(`/jobs/${row.contactId}`) : navigate('/jobs')}
            />
          ))
        )}
      </motion.div>
    </motion.div>
  )
}
