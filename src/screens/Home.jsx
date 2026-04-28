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
  Activity,
  PhoneCall,
  CalendarClock,
  ChevronRight,
  Zap
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
  // Next Actions = up to 5 actionable items (stale leads, overdue jobs,
  // unsent invoices) computed from the same contacts/schedule/payments data.
  // Distinct from KPI tiles (which show counts) — these are per-job CTAs.
  const [nextActions, setNextActions] = useState(null)
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

      // Next Actions — compose 3 source streams + sort by urgency (oldest
      // last-touch wins). Capped at 5 so the section stays scannable.
      const fiveDaysAgo = new Date(nowD); fiveDaysAgo.setDate(nowD.getDate() - 5)
      const paidContactIds = new Set(
        (paysRes.data || []).map((p) => p.contact_id).filter(Boolean)
      )
      const actions = []
      // 1. Stale leads/quotes — needs a follow-up call/text. Urgency = warn
      // (yellow) — opportunity slipping but salvageable.
      for (const c of risky) {
        const daysCold = Math.max(1, Math.floor((nowD - new Date(c.updated_at || c.created_at || 0)) / 86400000))
        actions.push({
          id: `followup-${c.id}`,
          kind: 'followup',
          contactId: c.id,
          title: `Follow up with ${c.name || 'lead'}`,
          detail: `${c.stage === 'lead' ? 'Lead' : 'Quote'} cold for ${daysCold} days`,
          urgencyLabel: `${daysCold}d cold`,
          urgencyTone: daysCold >= 14 ? 'danger' : 'warn',
          urgency: new Date(c.updated_at || c.created_at || 0).getTime()
        })
      }
      // 2. Overdue jobs — needs a reschedule. Urgency = danger (red) —
      // schedule slipped, crew/customer expectations broken.
      for (const c of behind) {
        actions.push({
          id: `reschedule-${c.id}`,
          kind: 'reschedule',
          contactId: c.id,
          title: `Reschedule ${c.name || 'job'}`,
          detail: 'Job behind schedule',
          urgencyLabel: 'Overdue',
          urgencyTone: 'danger',
          urgency: 0 // top priority — sort first
        })
      }
      // 3. Invoiced jobs with no payment yet. Urgency = success (green) —
      // money in motion, action results in cash flowing in.
      for (const c of contacts) {
        if (c.stage !== 'invoice') continue
        if (paidContactIds.has(c.id)) continue
        const updated = new Date(c.updated_at || c.created_at || 0)
        if (updated > fiveDaysAgo) continue // give it 5 days to land naturally
        actions.push({
          id: `invoice-${c.id}`,
          kind: 'invoice',
          contactId: c.id,
          title: `Chase invoice for ${c.name || 'job'}`,
          detail: c.amount > 0 ? `$${Number(c.amount).toLocaleString()} owed` : 'Awaiting payment',
          urgencyLabel: 'Invoice pending',
          urgencyTone: 'success',
          urgency: updated.getTime()
        })
      }
      // Sort: lowest urgency value first (overdue=0 wins, then oldest last-touch)
      actions.sort((a, b) => a.urgency - b.urgency)
      const topActions = actions.slice(0, 5)

      setPipeline(totalPipeline)
      setPipelinePrev(prevPipeline)
      setDealsAtRisk({ count: risky.length, value: riskValue })
      setJobsBehind(behind.length)
      setInvoicingWeek(weekTotal)
      setFeed(feedRows)
      setNextActions(topActions)
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

  /* ----- Render -----
     v3 hierarchy refactor (3-tier):
       TIER 1 — HERO: dominant card on --v3-surface-2 (#1C1C22 elevated),
                 oversized money + sparkline, hover lift, deep shadow
       TIER 2 — PRIMARY KPIs: compact tiles on --v3-surface (#141418),
                 muted body + colored accent only, smaller numerics
       TIER 3 — SECONDARY: Quick Actions (primary tile gets gold halo,
                 others sit flat) + Live Feed (rows with hover lift)

     Asymmetric spacing breaks the rigid grid:
       - Greeting: 12px top → 24px bottom (more air below)
       - Hero: 28px below (most elevated → most room)
       - KPI row: 24px below
       - Section headers: 4px below
       - Quick Actions: 28px below
       - Live Feed: 40px below
  */
  return (
    <motion.div
      className="v3-screen"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 120, background: 'var(--v3-bg)' }}
    >
      {/* ─────────── GREETING + WEATHER CHIP ─────────── */}
      <motion.div
        variants={item}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          padding: '12px 20px 24px'
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
            whileHover={{ y: -1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={() => { hapticTap(); navigate('/pour-window') }}
            aria-label="Open weather forecast"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 10,
              padding: '10px 12px',
              borderRadius: 'var(--v3-radius-btn)',
              background: 'var(--v3-surface)',
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
              background: 'var(--v3-primary-soft)',
              border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
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

      {/* ─────────── TIER 1 — HERO (TODAY'S REVENUE OPPORTUNITY) ───────────
          Refinement pass: padding bumped ~30%, money scales clamp(56–84),
          radial glow + low-opacity diagonal sweep stack as the depth layer,
          stronger outdent (12px vs 20px elsewhere) so the hero reads as
          the most isolated object on the screen. Hover lift -3 (was -2). */}
      <motion.div variants={item} style={{ padding: '0 12px 36px' }}>
        <motion.div
          whileHover={{ y: -3 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          style={{
            position: 'relative',
            padding: '32px 26px 26px',
            borderRadius: 22,
            background: `
              radial-gradient(120% 80% at 100% 0%, rgba(212, 175, 55, 0.18), transparent 55%),
              linear-gradient(125deg, rgba(212, 175, 55, 0.045) 0%, transparent 38%, transparent 62%, rgba(212, 175, 55, 0.04) 100%),
              var(--v3-surface-2)
            `,
            border: '1px solid color-mix(in srgb, var(--v3-primary) 22%, transparent)',
            boxShadow: 'var(--v3-shadow-lg)',
            overflow: 'hidden'
          }}
        >
          {/* Top-right ambient sweep — adds the "command center" feel without
              reading as a flashy gradient. ~5% gold, blends out to nothing. */}
          <div aria-hidden="true" style={{
            position: 'absolute',
            top: -120, right: -100,
            width: 320, height: 320,
            borderRadius: '50%',
            background: 'radial-gradient(circle at center, rgba(212, 175, 55, 0.12), transparent 65%)',
            pointerEvents: 'none'
          }} />

          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.2em',
              textTransform: 'uppercase',
              color: 'var(--v3-text-muted)'
            }}>
              Today's Revenue Opportunity
            </span>
            {trendPct != null ? (
              <Pill tone={trendUp ? 'success' : 'danger'} icon={trendUp ? ArrowUpRight : ArrowDownRight}>
                {trendUp ? '+' : ''}{trendPct}%
              </Pill>
            ) : null}
          </div>

          <div style={{ position: 'relative', marginTop: 22, display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}>
            <div
              className="v3-money"
              style={{
                fontSize: 'clamp(56px, 14vw, 84px)',
                lineHeight: 0.95,
                letterSpacing: '0.005em',
                textShadow: '0 2px 24px rgba(212, 175, 55, 0.18)'
              }}
            >
              {pipeline == null ? (
                <span className="v3-skeleton" style={{ width: 220, height: 64, borderRadius: 6 }} />
              ) : (
                <>
                  <span style={{
                    fontSize: 'clamp(28px, 7vw, 38px)',
                    color: 'var(--v3-text-muted)',
                    verticalAlign: 'top',
                    marginRight: 4,
                    lineHeight: 1
                  }}>
                    $
                  </span>
                  <CountUp
                    to={pipeline}
                    formatter={(n) => n.toLocaleString()}
                  />
                </>
              )}
            </div>
            <div className="v3-caption" style={{ fontSize: 12 }}>vs last 7 days</div>
          </div>

          {/* Inline trend signal — answers "is this number good?" within 1 second.
              Renders only when we have a comparable previous-week value. */}
          {trendPct != null && (
            <div style={{
              position: 'relative',
              marginTop: 10,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: 700,
              letterSpacing: '0.005em',
              color: trendUp ? 'var(--v3-success-bright)' : 'var(--v3-danger-bright)',
              fontVariantNumeric: 'tabular-nums'
            }}>
              {trendUp ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
              {trendUp ? '+' : ''}{trendPct}% vs last week
              {!trendUp && (
                <span style={{
                  marginLeft: 4,
                  fontSize: 12, fontWeight: 600,
                  color: 'var(--v3-text-muted)',
                  letterSpacing: 0
                }}>
                  — needs attention
                </span>
              )}
            </div>
          )}

          <div style={{ position: 'relative', marginTop: 22, marginLeft: -10, marginRight: -10 }}>
            <Sparkline data={sparkData} color="var(--v3-primary)" height={72} />
          </div>

          <div style={{
            position: 'relative',
            marginTop: 14,
            paddingTop: 14,
            borderTop: '1px solid var(--v3-border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8
          }}>
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.14em',
              textTransform: 'uppercase',
              color: 'var(--v3-text-muted)'
            }}>
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
        </motion.div>
      </motion.div>

      {/* ─────────── NEXT ACTIONS ───────────
          Promoted ABOVE the KPI row (refinement-pass reorder): the
          operator sees what to DO before what to LOOK AT. Per-job CTAs
          tagged with urgency (danger/warn/success) so critical work
          surfaces by color, not just position. */}
      {nextActions != null && nextActions.length > 0 && (
        <>
          <motion.div variants={item} style={{ padding: '0 20px 6px' }}>
            <SectionHeader
              label="Next Actions"
              action={{ label: 'View all', onTap: () => navigate('/jobs') }}
            />
          </motion.div>
          <motion.div
            variants={item}
            style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '0 20px 28px' }}
          >
            {nextActions.map((action) => (
              <NextActionRow
                key={action.id}
                action={action}
                onTap={() => action.contactId
                  ? navigate(`/jobs/${action.contactId}`)
                  : navigate('/jobs')
                }
              />
            ))}
          </motion.div>
        </>
      )}

      {/* ─────────── TIER 2 — KPI ROW ───────────
          Compact tiles on --v3-surface. Now demoted below Next Actions:
          metrics support the work, they don't drive it. */}
      <motion.div
        variants={item}
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
          padding: '0 20px 28px'
        }}
      >
        <CompactKpi
          tone="danger"
          value={dealsAtRisk?.count}
          label="Deals At Risk"
          subline={dealsAtRisk?.value > 0 ? `$${dealsAtRisk.value.toLocaleString()}` : null}
          onTap={() => navigate('/jobs')}
        />
        <CompactKpi
          tone="primary"
          value={jobsBehind}
          label="Jobs Behind"
          onTap={() => navigate('/schedule')}
        />
        <CompactKpi
          tone="success"
          value={invoicingWeek}
          label="Invoicing This Week"
          isMoney
          onTap={() => navigate('/invoices')}
        />
      </motion.div>

      {/* ─────────── TIER 3 — QUICK ACTIONS ───────────
          Primary action (Add Lead) gets a subtle gold halo + slightly
          larger icon to break the rigid 4-col into 1-primary + 3-secondary
          without restructuring. */}
      <motion.div variants={item} style={{ padding: '0 20px 6px' }}>
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
          padding: '0 20px 28px'
        }}
      >
        <QuickAction icon={Plus} label="Add Lead" primary onTap={() => navigate('/jobs?new=1')} />
        <QuickAction icon={CalendarRange} label="Schedule Crew" onTap={() => navigate('/schedule')} />
        <QuickAction icon={Receipt} label="Send Invoice" onTap={() => navigate('/invoices')} />
        <QuickAction icon={FileText} label="New Estimate" onTap={() => navigate('/bid')} />
      </motion.div>

      {/* ─────────── TIER 3 — LIVE FEED ───────────
          Rows on --v3-surface (matches KPIs, lower than hero). Hover lift
          to invite the tap. Empty state lives quietly below. */}
      <motion.div variants={item} style={{ padding: '0 20px 6px' }}>
        <SectionHeader
          label="Live Feed"
          action={{ label: 'View all', onTap: () => navigate('/jobs') }}
        />
      </motion.div>
      <motion.div
        variants={item}
        style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 20px 40px' }}
      >
        {feed == null ? (
          <>
            <div className="v3-skeleton" style={{ height: 60, width: '100%', borderRadius: 16 }} />
            <div className="v3-skeleton" style={{ height: 60, width: '100%', borderRadius: 16, opacity: 0.6 }} />
          </>
        ) : feed.length === 0 ? (
          <div
            style={{
              padding: '24px 20px',
              borderRadius: 'var(--v3-radius-card)',
              background: 'var(--v3-surface)',
              border: '1px dashed var(--v3-border-strong)',
              textAlign: 'center'
            }}
          >
            <Activity size={22} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
            <div className="v3-caption" style={{ marginBottom: 12 }}>
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
            <motion.div
              key={row.id}
              whileHover={{ y: -1 }}
              transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            >
              <FeedRow
                type={row.type}
                title={row.title}
                detail={row.detail}
                timestamp={row.timestamp}
                pillTone={row.pillTone}
                pillLabel={row.pillLabel}
                onTap={() => row.contactId ? navigate(`/jobs/${row.contactId}`) : navigate('/jobs')}
              />
            </motion.div>
          ))
        )}
      </motion.div>
    </motion.div>
  )
}

/* ============================================================
   CompactKpi — Tier-2 KPI tile. Smaller than v3 KpiTile primitive,
   color confined to the value + 1px top accent bar. Hover lift.
   Internal CountUp from the v3 primitive is replaced here with the
   home's own CountUp wiring (already imported above) so we control
   the size + skeleton state.
   ============================================================ */

const COMPACT_TONE = {
  primary: { color: 'var(--v3-primary)',         soft: 'rgba(212, 175, 55, 0.10)' },
  success: { color: 'var(--v3-success-bright)',  soft: 'rgba(46, 204, 113, 0.10)' },
  danger:  { color: 'var(--v3-danger-bright)',   soft: 'rgba(192, 57, 43, 0.10)'  }
}

function CompactKpi({ tone = 'primary', value, label, subline, isMoney, onTap }) {
  const t = COMPACT_TONE[tone] || COMPACT_TONE.primary

  return (
    <motion.button
      type="button"
      onClick={() => { hapticTap(); onTap?.() }}
      whileTap={{ scale: 0.97 }}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      style={{
        position: 'relative',
        textAlign: 'left',
        padding: '14px 12px 12px',
        borderRadius: 14,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        color: 'var(--v3-text)',
        cursor: 'pointer',
        minHeight: 88,
        WebkitTapHighlightColor: 'transparent',
        overflow: 'hidden'
      }}
    >
      {/* 2px accent bar at top — the only chromatic signal on the tile */}
      <span aria-hidden="true" style={{
        position: 'absolute', top: 0, left: 0, right: 0, height: 2,
        background: t.color, opacity: 0.85
      }} />

      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 26,
        color: t.color,
        lineHeight: 1,
        marginBottom: 8,
        minHeight: 26,
        fontVariantNumeric: 'tabular-nums'
      }}>
        {value == null ? (
          <span className="v3-skeleton" style={{ width: 44, height: 22, borderRadius: 4 }} />
        ) : isMoney ? (
          <>
            <span style={{
              fontSize: 14, color: 'var(--v3-text-muted)',
              verticalAlign: 'top', marginRight: 1
            }}>
              $
            </span>
            <CountUp
              to={Number(value) || 0}
              formatter={(n) => {
                if (n >= 1000) return `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}K`
                return n.toLocaleString()
              }}
            />
          </>
        ) : (
          <CountUp to={Number(value) || 0} />
        )}
      </div>

      <div style={{
        fontFamily: 'var(--font-body)',
        fontSize: 11,
        fontWeight: 600,
        color: 'var(--v3-text)',
        lineHeight: 1.3,
        letterSpacing: '-0.005em'
      }}>
        {label}
      </div>

      {subline ? (
        <div style={{
          marginTop: 4,
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          fontWeight: 700,
          color: t.color,
          fontVariantNumeric: 'tabular-nums'
        }}>
          {subline}
        </div>
      ) : null}
    </motion.button>
  )
}

/* ============================================================
   NextActionRow — per-job CTA shown in the Next Actions section.
   Icon + tone driven by `kind`. Gold left-edge accent; flat row
   that hover-lifts to invite the tap.
   ============================================================ */

// Per-kind icon. The urgency tone (danger/warn/success) drives the row's
// accent color via URGENCY_TONE below — kind alone no longer picks color
// (an old lead can be warn OR danger depending on how cold it's gone).
const NEXT_ACTION_KIND = {
  followup:   { Icon: PhoneCall },
  reschedule: { Icon: CalendarClock },
  invoice:    { Icon: Receipt }
}

const URGENCY_TONE = {
  danger:  { color: 'var(--v3-danger-bright)',  glow: 'rgba(192, 57, 43, 0.45)' },
  warn:    { color: 'var(--v3-primary)',        glow: 'rgba(212, 175, 55, 0.45)' },
  success: { color: 'var(--v3-success-bright)', glow: 'rgba(46, 204, 113, 0.40)' }
}

function NextActionRow({ action, onTap }) {
  const kindMeta = NEXT_ACTION_KIND[action.kind] || { Icon: Zap }
  const { Icon } = kindMeta
  const tone = URGENCY_TONE[action.urgencyTone] || URGENCY_TONE.warn

  return (
    <motion.button
      type="button"
      onClick={() => { hapticTap(); onTap?.() }}
      whileTap={{ scale: 0.985 }}
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        padding: '14px 16px 14px 18px',
        borderRadius: 14,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        color: 'var(--v3-text)',
        textAlign: 'left',
        width: '100%',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        overflow: 'hidden'
      }}
    >
      {/* Left edge accent — urgency-tone color + matching glow. THIS is the
          critical-vs-optional signal. Operator scan: red bar = drop everything,
          yellow = today, green = money in motion. */}
      <span aria-hidden="true" style={{
        position: 'absolute',
        left: 0, top: 8, bottom: 8,
        width: 3,
        background: tone.color,
        borderRadius: '0 3px 3px 0',
        boxShadow: `0 0 14px ${tone.glow}`
      }} />

      <span aria-hidden="true" style={{
        flexShrink: 0,
        width: 38, height: 38,
        borderRadius: 11,
        background: 'var(--v3-surface-2)',
        border: '1px solid var(--v3-border-strong)',
        color: tone.color,
        display: 'grid',
        placeItems: 'center'
      }}>
        <Icon size={16} />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          fontWeight: 700,
          color: 'var(--v3-text)',
          letterSpacing: '-0.005em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {action.title}
        </div>
        <div style={{
          marginTop: 3,
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          color: 'var(--v3-text-muted)',
          fontVariantNumeric: 'tabular-nums'
        }}>
          {action.detail}
        </div>
      </div>

      {/* Urgency chip — short label that names the urgency in plain words.
          Color matches the spine. */}
      {action.urgencyLabel && (
        <span style={{
          flexShrink: 0,
          display: 'inline-flex',
          alignItems: 'center',
          gap: 4,
          padding: '4px 8px',
          borderRadius: 999,
          background: `color-mix(in srgb, ${tone.color} 14%, transparent)`,
          border: `1px solid color-mix(in srgb, ${tone.color} 35%, transparent)`,
          color: tone.color,
          fontFamily: 'var(--font-body)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.06em',
          textTransform: 'uppercase',
          fontVariantNumeric: 'tabular-nums',
          lineHeight: 1.2
        }}>
          <span aria-hidden="true" style={{
            width: 5, height: 5, borderRadius: '50%',
            background: tone.color
          }} />
          {action.urgencyLabel}
        </span>
      )}

      <ChevronRight size={16} color="var(--v3-text-muted)" aria-hidden="true" style={{ flexShrink: 0 }} />
    </motion.button>
  )
}
