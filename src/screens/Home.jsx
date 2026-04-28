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
import { Card, KpiTile, QuickAction, Sparkline, SectionHeader, Pill } from '../components/v3'
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
  // Pipeline Preview = top 3 active deals by value (lead/quote/job/invoice).
  // Renders as a glanceable list at the bottom of Home so the operator sees
  // their highest-value open work without leaving the screen.
  const [topPipeline, setTopPipeline] = useState(null)
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

      const [contactsRes, overdueSchedRes, paysRes] = await Promise.all([
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
          .gte('created_at', wkStart.toISOString())
      ])

      if (cancelled) return

      const contacts = contactsRes.data || []

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

      // Top pipeline = highest-value active deals. Used by the Pipeline
      // Preview section. Capped at 3 to keep the home screen scannable —
      // operators tap "View all" to drill into the full board.
      const topActiveDeals = contacts
        .filter((c) => ACTIVE_STAGES.includes(c.stage))
        .sort((a, b) => Number(b.amount || 0) - Number(a.amount || 0))
        .slice(0, 3)
        .map((c) => ({
          id: c.id,
          name: c.name || 'Untitled',
          amount: Number(c.amount || 0),
          stage: c.stage
        }))

      setPipeline(totalPipeline)
      setPipelinePrev(prevPipeline)
      setDealsAtRisk({ count: risky.length, value: riskValue })
      setJobsBehind(behind.length)
      setInvoicingWeek(weekTotal)
      setTopPipeline(topActiveDeals)
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
      {/* ─────────── GREETING + WEATHER CHIP ───────────
          Tightened bottom padding 24 → 14 so the hero rides higher into
          the viewport. The greeting reads as a single beat with the
          hero, not a separate top zone. */}
      <motion.div
        variants={item}
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 16,
          padding: '12px 16px 14px'
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
          Visual-impact pass: edge-to-edge full bleed (0px horizontal padding
          inside the screen, vs 20px elsewhere) — the hero now spans the
          entire width, breaking the column completely and dominating the
          screen. Bottom reflection blob spills below the card for cinematic
          depth. Heavier shadow + gold-tinted border gain. */}
      <motion.div variants={item} style={{ padding: '0 0 20px', position: 'relative' }}>
        {/* BELOW-CARD REFLECTION — gold spill that bleeds out of the card's
            bottom edge. Reads as depth, not glow. */}
        <div aria-hidden="true" style={{
          position: 'absolute',
          left: '50%', bottom: 8,
          transform: 'translateX(-50%)',
          width: '70%', height: 80,
          borderRadius: '50%',
          background: 'radial-gradient(closest-side, rgba(212, 175, 55, 0.16), transparent 70%)',
          filter: 'blur(20px)',
          pointerEvents: 'none',
          zIndex: 0
        }} />
        <motion.div
          whileHover={{ y: -3 }}
          transition={{ type: 'spring', stiffness: 380, damping: 30 }}
          style={{
            position: 'relative',
            padding: '36px 28px 28px',
            // Hero is full-bleed; only the corners get rounded so it floats
            // on the page like a wide command-center bar.
            borderRadius: 24,
            background: `
              radial-gradient(120% 80% at 100% 0%, rgba(229, 193, 88, 0.42), transparent 55%),
              radial-gradient(80% 60% at 0% 100%, rgba(229, 193, 88, 0.22), transparent 60%),
              linear-gradient(125deg, rgba(229, 193, 88, 0.12) 0%, transparent 38%, transparent 62%, rgba(229, 193, 88, 0.12) 100%),
              var(--v3-surface-2)
            `,
            border: '1px solid color-mix(in srgb, var(--v3-primary) 60%, transparent)',
            boxShadow: 'var(--v3-shadow-hero)',
            overflow: 'hidden',
            zIndex: 1
          }}
        >
          {/* Top-right ambient sweep — bigger + brighter for premium push.
              Drifts via fh-hero-drift. */}
          <div
            aria-hidden="true"
            className="fh-hero-drift"
            style={{
              position: 'absolute',
              top: -180, right: -160,
              width: 480, height: 480,
              borderRadius: '50%',
              background: 'radial-gradient(circle at center, rgba(229, 193, 88, 0.28), transparent 65%)',
              pointerEvents: 'none'
            }}
          />

          {/* Behind-number glow — wider + brighter halo behind the $ amount.
              Real "stage spotlight" feel under the headline. */}
          <div
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 72, left: 8,
              width: 480, height: 280,
              borderRadius: '50%',
              background: 'radial-gradient(closest-side, rgba(229, 193, 88, 0.30), transparent 70%)',
              pointerEvents: 'none',
              filter: 'blur(12px)'
            }}
          />

          {/* Top edge stroke — gold gradient catches the leading edge */}
          <div aria-hidden="true" style={{
            position: 'absolute',
            top: 0,
            left: '6%',
            right: '6%',
            height: 1,
            background: 'linear-gradient(90deg, transparent 0%, rgba(229, 193, 88, 0.65) 50%, transparent 100%)',
            boxShadow: '0 0 12px rgba(229, 193, 88, 0.55)',
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
                fontSize: 'clamp(64px, 16vw, 104px)',
                lineHeight: 0.92,
                letterSpacing: '-0.005em',
                color: '#FFFFFF',
                textShadow: '0 6px 32px rgba(229, 193, 88, 0.45), 0 1px 0 rgba(255, 255, 255, 0.14)',
                filter: 'drop-shadow(0 4px 22px rgba(229, 193, 88, 0.26))'
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
              Renders only when we have a comparable previous-week value.
              Trend + attention-count read together: revenue → trend → action. */}
          {(trendPct != null || (nextActions && nextActions.length > 0)) && (
            <div style={{
              position: 'relative',
              marginTop: 10,
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              flexWrap: 'wrap'
            }}>
              {trendPct != null && (
                <div style={{
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

              {/* Attention-count signal — connects the hero number to the
                  Next Actions section directly below. Subtle: muted text +
                  small gold dot. Visible: tabular nums, tight gap. */}
              {nextActions && nextActions.length > 0 && (
                <div style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  fontFamily: 'var(--font-body)',
                  fontSize: 12,
                  fontWeight: 600,
                  color: 'var(--v3-text-muted)',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  <span aria-hidden="true" style={{
                    width: 6, height: 6, borderRadius: '50%',
                    background: 'var(--v3-primary)',
                    boxShadow: '0 0 8px rgba(212, 175, 55, 0.6)'
                  }} />
                  <strong style={{
                    color: 'var(--v3-primary)',
                    fontWeight: 700,
                    fontVariantNumeric: 'tabular-nums'
                  }}>
                    {nextActions.length}
                  </strong>
                  {nextActions.length === 1 ? 'action needs' : 'actions need'} attention today
                </div>
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

      {/* ─────────── NEXT ACTIONS — IMMEDIATE WORK ───────────
          Strongest section on the screen after the hero. Gold-tinted
          border + raised shadow + count badge in the eyebrow tells the
          operator: this is what to DO. Per-job CTAs tagged with urgency
          (danger/warn/success) so critical work surfaces by color. */}
      {nextActions != null && nextActions.length > 0 && (
        <motion.div
          variants={item}
          className="v3-section v3-section--primary"
          style={{ margin: '0 var(--v3-gutter) 14px' }}
        >
          <div className="v3-section-header">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="v3-eyebrow" style={{ color: 'var(--v3-primary)' }}>
                Next Actions
              </span>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 20,
                height: 20,
                padding: '0 7px',
                borderRadius: 999,
                background: 'var(--v3-primary)',
                color: 'var(--v3-on-primary)',
                fontFamily: 'var(--font-display)',
                fontSize: 11,
                letterSpacing: '0.04em',
                lineHeight: 1
              }}>
                {nextActions.length}
              </span>
            </span>
            <button
              type="button"
              onClick={() => { hapticTap(); navigate('/jobs') }}
              className="v3-section-link"
            >
              View all
              <ChevronRight size={12} aria-hidden="true" />
            </button>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
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
          </div>
        </motion.div>
      )}

      {/* ─────────── CRITICAL INSIGHTS — KPIs ───────────
          What needs attention but isn't an explicit action. Compact
          tiles on the quiet section variant — supports the actions
          above without competing for the eye. */}
      <motion.div
        variants={item}
        className="v3-section v3-section--quiet"
        style={{ margin: '0 var(--v3-gutter) 14px' }}
      >
        <SectionHeader label="Critical Insights" />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 10,
            marginTop: 4
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
        </div>
      </motion.div>

      {/* ─────────── PIPELINE PREVIEW ───────────
          Top 3 active deals by value. Replaces the old Live Feed:
          forward-looking ("what's open and worth most") instead of
          backward-looking ("what just happened"). Tap a row to drill
          into the contact, or "View all" to open the board. */}
      <motion.div
        variants={item}
        className="v3-section"
        style={{ margin: '0 var(--v3-gutter) 14px' }}
      >
        <SectionHeader
          label="Pipeline Preview"
          action={{ label: 'View all', onTap: () => navigate('/jobs') }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {topPipeline == null ? (
            <>
              <div className="v3-skeleton" style={{ height: 56, width: '100%', borderRadius: 12 }} />
              <div className="v3-skeleton" style={{ height: 56, width: '100%', borderRadius: 12, opacity: 0.65 }} />
            </>
          ) : topPipeline.length === 0 ? (
            <div className="v3-empty">
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
                No active deals.
              </div>
              <div style={{ fontSize: 12 }}>Add your first lead to start the pipeline.</div>
            </div>
          ) : (
            topPipeline.map((deal) => (
              <PipelineDealRow
                key={deal.id}
                deal={deal}
                onTap={() => navigate(`/jobs/${deal.id}`)}
              />
            ))
          )}
        </div>
      </motion.div>

      {/* ─────────── QUICK ACTIONS — TOOLBAR ───────────
          Demoted to the bottom of the screen as a tools toolbar.
          Equal-width tight tiles (no asymmetric primary) — the eye
          treats this as a launcher, not a CTA. Save Note / Schedule /
          Invoice / Estimate read as parallel power tools. */}
      <motion.div
        variants={item}
        className="v3-section v3-section--tight"
        style={{ margin: '0 var(--v3-gutter) 32px' }}
      >
        <SectionHeader label="Quick Tools" />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(4, 1fr)',
            gap: 8,
            marginTop: 4
          }}
        >
          <QuickAction icon={Plus} label="Add Lead" onTap={() => navigate('/jobs?new=1')} />
          <QuickAction icon={CalendarRange} label="Schedule" onTap={() => navigate('/schedule')} />
          <QuickAction icon={Receipt} label="Invoice" onTap={() => navigate('/invoices')} />
          <QuickAction icon={FileText} label="Estimate" onTap={() => navigate('/bid')} />
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ============================================================
   PipelineDealRow — single deal row inside Pipeline Preview.
   Stage chip on the left + name + amount in Bebas. Hover lifts
   border/background, tap navigates to the contact.
   ============================================================ */
const STAGE_DISPLAY = {
  lead:    { label: 'Lead',    color: '#60A5FA' },
  quote:   { label: 'Quote',   color: '#A78BFA' },
  job:     { label: 'Job',     color: 'var(--v3-success-bright)' },
  invoice: { label: 'Invoice', color: 'var(--v3-primary)' }
}

function PipelineDealRow({ deal, onTap }) {
  const stage = STAGE_DISPLAY[deal.stage] || { label: deal.stage, color: 'var(--v3-text-muted)' }
  return (
    <motion.button
      type="button"
      onClick={() => { hapticTap(); onTap?.() }}
      whileTap={{ scale: 0.99 }}
      whileHover={{ y: -2 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 14,
        width: '100%',
        padding: '14px 14px',
        borderRadius: 14,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border-strong)',
        color: 'var(--v3-text)',
        textAlign: 'left',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 4px 14px rgba(0, 0, 0, 0.30)',
        transition: 'border-color 200ms ease, background-color 200ms ease, box-shadow 200ms ease'
      }}
      onMouseEnter={(e) => {
        e.currentTarget.style.borderColor = `color-mix(in srgb, ${stage.color} 40%, var(--v3-border-strong))`
        e.currentTarget.style.background = 'var(--v3-surface-3)'
        e.currentTarget.style.boxShadow = `0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 8px 24px rgba(0, 0, 0, 0.40), 0 4px 14px ${stage.color}20`
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--v3-border-strong)'
        e.currentTarget.style.background = 'var(--v3-surface)'
        e.currentTarget.style.boxShadow = '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 4px 14px rgba(0, 0, 0, 0.30)'
      }}
    >
      {/* Stage spine — fatter (5px) + brighter glow */}
      <span aria-hidden="true" style={{
        flexShrink: 0,
        width: 5,
        height: 36,
        borderRadius: 3,
        background: `linear-gradient(180deg, ${stage.color}, color-mix(in srgb, ${stage.color} 50%, transparent))`,
        boxShadow: `0 0 14px ${stage.color}80, 0 0 24px ${stage.color}30`
      }} />
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 15,
          fontWeight: 600,
          color: 'var(--v3-text)',
          letterSpacing: '-0.005em',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
          whiteSpace: 'nowrap'
        }}>
          {deal.name}
        </div>
        <div style={{
          marginTop: 4,
          fontFamily: 'var(--font-body)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.14em',
          textTransform: 'uppercase',
          color: stage.color
        }}>
          {stage.label}
        </div>
      </div>
      <div style={{
        flexShrink: 0,
        fontFamily: 'var(--font-display)',
        fontSize: 26,
        color: 'var(--v3-text)',
        fontVariantNumeric: 'tabular-nums',
        lineHeight: 1,
        textShadow: '0 1px 0 rgba(255, 255, 255, 0.06)'
      }}>
        ${deal.amount >= 1000
          ? `${(deal.amount / 1000).toFixed(deal.amount >= 10000 ? 0 : 1)}K`
          : deal.amount.toLocaleString()}
      </div>
      <ChevronRight size={18} color="var(--v3-text-muted)" style={{ flexShrink: 0 }} />
    </motion.button>
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
      whileTap={{ scale: 0.97 }}
      // Hover: lift + shift right 2px + brighter surface. Reads as a control
      // being depressed/highlighted. Surface bump #141418 → #1A1A20 (subtle
      // brighten — never approaching --v3-surface-2 territory which would
      // collide with the card hover treatment elsewhere).
      whileHover={{
        y: -2,
        x: 2,
        backgroundColor: '#1A1A20'
      }}
      // Snappier spring (stiffness 720 / damping 26) so tap + hover both
      // read as immediate key-presses, not soft squishes.
      transition={{ type: 'spring', stiffness: 720, damping: 26 }}
      style={{
        position: 'relative',
        display: 'flex',
        alignItems: 'center',
        gap: 10,
        // Tighter again: 9/12/9/14 saves ~6px height per row.
        padding: '9px 12px 9px 14px',
        borderRadius: 12,
        // Subtle linear top-light overlay + slightly raised surface mix
        // so each row reads as a metal plate, not a list item.
        background: `
          linear-gradient(180deg, rgba(255, 255, 255, 0.022), transparent 40%),
          var(--v3-surface)
        `,
        border: '1px solid var(--v3-border-strong)',
        boxShadow: 'inset 0 1px 0 rgba(255, 255, 255, 0.05), 0 1px 2px rgba(0, 0, 0, 0.25)',
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
        left: 0, top: 7, bottom: 7,
        width: 3,
        background: tone.color,
        borderRadius: '0 3px 3px 0',
        boxShadow: `0 0 12px ${tone.glow}`
      }} />

      <span aria-hidden="true" style={{
        flexShrink: 0,
        width: 32, height: 32,
        borderRadius: 9,
        background: 'var(--v3-surface-2)',
        border: '1px solid var(--v3-border-strong)',
        color: tone.color,
        display: 'grid',
        placeItems: 'center'
      }}>
        <Icon size={14} />
      </span>

      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 13,
          fontWeight: 700,
          color: 'var(--v3-text)',
          letterSpacing: '-0.01em',
          lineHeight: 1.25,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {action.title}
        </div>
        <div style={{
          marginTop: 1,
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          lineHeight: 1.3,
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
          padding: '3px 7px',
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

      <ChevronRight size={14} color="var(--v3-text-muted)" aria-hidden="true" style={{ flexShrink: 0 }} />
    </motion.button>
  )
}
