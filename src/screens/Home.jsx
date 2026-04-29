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
  Zap,
  Mic
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
  // Stage breakdown for Pipeline card footer (mockup: Won / Active / Lead)
  const [stageBreakdown, setStageBreakdown] = useState(null)
  // Today on Site = schedule entries that start today (or are happening
  // now). Read-only fetch, no schema change. Joined with fh_contacts so
  // each row shows the job name + stage at a glance.
  const [todayOnSite, setTodayOnSite] = useState(null)
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

      const [contactsRes, overdueSchedRes, paysRes, todaySchedRes] = await Promise.all([
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
        // Today on Site — schedule entries that start today, joined with
        // contacts for name+stage. Read-only query, no schema change.
        supabase
          .from('fh_schedule')
          .select('id, contact_id, start_at, end_at, title, fh_contacts(name, stage)')
          .eq('user_id', user.id)
          .gte('start_at', todayStart.toISOString())
          .lt('start_at', todayEnd.toISOString())
          .order('start_at', { ascending: true })
          .limit(6)
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

      // Stage breakdown for the Pipeline card footer (mockup: Won/Active/Lead).
      // Won = closed, Active = job + invoice, Lead = lead + quote.
      const stageCounts = {
        won:    contacts.filter((c) => c.stage === 'closed').length,
        active: contacts.filter((c) => c.stage === 'job' || c.stage === 'invoice').length,
        lead:   contacts.filter((c) => c.stage === 'lead' || c.stage === 'quote').length
      }

      // Quotes Needing Attention — quotes with no update in 7+ days
      // (separate KPI from leads needing follow-up; the mockup splits
      // them into 3 distinct priority signals).
      const quotesAttention = contacts.filter((c) => {
        if (c.stage !== 'quote') return false
        const last = new Date(c.updated_at || c.created_at || 0)
        return last < sevenDaysAgo
      }).length

      // Follow-ups — leads (only) with no update in 7+ days.
      const followUps = contacts.filter((c) => {
        if (c.stage !== 'lead') return false
        const last = new Date(c.updated_at || c.created_at || 0)
        return last < sevenDaysAgo
      }).length

      // Today on Site — derive the rows. fh_contacts() join may be null
      // when the schedule entry has no linked contact.
      const todayRows = (todaySchedRes.data || []).map((s) => ({
        id: s.id,
        contactId: s.contact_id,
        title: s.title || s.fh_contacts?.name || 'Scheduled visit',
        clientName: s.fh_contacts?.name || null,
        stage: s.fh_contacts?.stage || null,
        startAt: s.start_at,
        endAt: s.end_at
      }))

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
      setDealsAtRisk({ count: risky.length, value: riskValue, followUps, quotesAttention })
      setJobsBehind(behind.length)
      setInvoicingWeek(weekTotal)
      setTopPipeline(topActiveDeals)
      setStageBreakdown(stageCounts)
      setTodayOnSite(todayRows)
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
        <div className="v3-caption" style={{ padding: '0 var(--v3-gutter) 12px', color: 'var(--v3-danger)' }}>
          {weatherErr}
        </div>
      ) : null}

      {/* ─────────── TIER 1 — HERO (TODAY'S REVENUE OPPORTUNITY) ───────────
          Visual-impact pass: edge-to-edge full bleed (0px horizontal padding
          inside the screen, vs 20px elsewhere) — the hero now spans the
          entire width, breaking the column completely and dominating the
          screen. Bottom reflection blob spills below the card for cinematic
          depth. Heavier shadow + gold-tinted border gain. */}
      {/* PIPELINE CARD — compact per v3 mockup. Was the giant 100px-money
          hero with stretched ambient blobs. Now: framed v3 section
          card with modest pipeline value, trend, sparkline + bottom
          breakdown row (Won / Active / Lead). */}
      <motion.div
        variants={item}
        className="v3-section v3-section--primary"
        style={{ margin: '0 var(--v3-gutter) 14px', padding: '18px' }}
      >
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
          <span className="v3-eyebrow" style={{ color: 'var(--v3-primary)' }}>Total Pipeline</span>
          {trendPct != null ? (
            <Pill tone={trendUp ? 'success' : 'danger'} icon={trendUp ? ArrowUpRight : ArrowDownRight}>
              {trendUp ? '+' : ''}{trendPct}%
            </Pill>
          ) : null}
        </div>

        <div style={{ marginTop: 10, display: 'flex', alignItems: 'baseline', gap: 10, flexWrap: 'wrap' }}>
          <div
            className="v3-money"
            style={{
              fontSize: 'clamp(40px, 9vw, 56px)',
              lineHeight: 0.95,
              letterSpacing: '-0.005em',
              color: '#FFFFFF'
            }}
          >
            {pipeline == null ? (
              <span className="v3-skeleton" style={{ width: 180, height: 48, borderRadius: 6 }} />
            ) : (
              <>
                <span style={{
                  fontSize: 'clamp(20px, 4.5vw, 28px)',
                  color: 'var(--v3-text-muted)',
                  verticalAlign: 'top',
                  marginRight: 3,
                  lineHeight: 1
                }}>
                  $
                </span>
                <CountUp to={pipeline} formatter={(n) => n.toLocaleString()} />
              </>
            )}
          </div>
          <div className="v3-caption" style={{ fontSize: 11 }}>vs last 7 days</div>
        </div>

        <div style={{ marginTop: 14, marginLeft: -8, marginRight: -8 }}>
          <Sparkline data={sparkData} color="var(--v3-primary)" height={48} />
        </div>

        {/* Stage breakdown — Won / Active / Lead as a stacked bar
            visualization. Mockup-tier financial dashboard treatment:
            single horizontal bar with 3 colored segments + a numbers
            row underneath. Replaces the prior 3-column number grid. */}
        <PipelineStackedBreakdown breakdown={stageBreakdown} />

        <button
          type="button"
          onClick={() => { hapticTap(); navigate('/jobs') }}
          className="v3-section-link"
          style={{ fontSize: 11, marginTop: 12 }}
        >
          View all jobs →
        </button>
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

      {/* ─────────── TODAY'S PRIORITIES — KPIs (mockup) ───────────
          Per v3 mockup: 3 compact KPI cards stating what needs the
          operator's attention today. Renamed from "Critical Insights"
          per the mockup spec. */}
      <motion.div
        variants={item}
        className="v3-section v3-section--quiet"
        style={{ margin: '0 var(--v3-gutter) 14px' }}
      >
        <SectionHeader label="Today's Priorities" />
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
            value={dealsAtRisk?.followUps}
            label="Follow-ups"
            subline={dealsAtRisk?.followUps > 0 ? 'Leads gone cold' : null}
            onTap={() => navigate('/jobs?filter=lead')}
          />
          <CompactKpi
            tone="primary"
            value={dealsAtRisk?.quotesAttention}
            label="Quotes"
            subline={dealsAtRisk?.quotesAttention > 0 ? 'Need attention' : null}
            onTap={() => navigate('/jobs?filter=quote')}
          />
          <CompactKpi
            tone="primary"
            value={jobsBehind}
            label="Jobs Behind"
            subline={jobsBehind > 0 ? 'Reschedule' : null}
            onTap={() => navigate('/schedule')}
          />
        </div>
      </motion.div>

      {/* ─────────── TODAY ON SITE ───────────
          Schedule entries that start today, sourced from a safe
          read-only fh_schedule query (no schema change). Polished
          empty state if no events scheduled — never shows a blank
          panel. Tap a row to jump to the linked job. */}
      <motion.div
        variants={item}
        className="v3-section"
        style={{ margin: '0 var(--v3-gutter) 14px' }}
      >
        <SectionHeader
          label="Today on Site"
          action={{ label: 'View schedule', onTap: () => navigate('/schedule') }}
        />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 4 }}>
          {todayOnSite == null ? (
            <>
              <div className="v3-skeleton" style={{ height: 52, width: '100%', borderRadius: 12 }} />
              <div className="v3-skeleton" style={{ height: 52, width: '100%', borderRadius: 12, opacity: 0.65 }} />
            </>
          ) : todayOnSite.length === 0 ? (
            <div className="v3-empty">
              <CalendarClock size={20} color="var(--v3-text-muted)" style={{ margin: '0 auto 8px' }} />
              <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', marginBottom: 4 }}>
                Nothing scheduled today.
              </div>
              <div style={{ fontSize: 12 }}>Open Schedule to plan crew visits.</div>
            </div>
          ) : (
            todayOnSite.map((row) => (
              <TodayOnSiteRow
                key={row.id}
                row={row}
                onTap={() => row.contactId
                  ? navigate(`/jobs/${row.contactId}`)
                  : navigate('/schedule')
                }
              />
            ))
          )}
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
        <SectionHeader label="Quick Actions" />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(5, 1fr)',
            gap: 8,
            marginTop: 4
          }}
        >
          <QuickAction icon={Plus} label="Add Lead" onTap={() => navigate('/jobs?new=1')} />
          <QuickAction icon={FileText} label="New Job" onTap={() => navigate('/jobs?new=1')} />
          <QuickAction icon={CalendarRange} label="Schedule" onTap={() => navigate('/schedule')} />
          <QuickAction icon={Receipt} label="Invoice" onTap={() => navigate('/invoices')} />
          <QuickAction icon={Mic} label="Voice Note" onTap={() => navigate('/notes?voice=1')} />
        </div>
      </motion.div>
    </motion.div>
  )
}

/* ============================================================
   PipelineStackedBreakdown — Won / Active / Lead as a stacked
   horizontal bar with a numbers row underneath. Mockup-tier
   financial dashboard treatment. Renders an empty bar with
   "—" labels while data is loading so layout doesn't shift.
   ============================================================ */
function PipelineStackedBreakdown({ breakdown }) {
  const won    = breakdown?.won    ?? 0
  const active = breakdown?.active ?? 0
  const lead   = breakdown?.lead   ?? 0
  const total  = won + active + lead
  const segments = [
    { id: 'won',    label: 'Won',    count: won,    tone: 'var(--v3-success-bright)' },
    { id: 'active', label: 'Active', count: active, tone: 'var(--v3-primary)' },
    { id: 'lead',   label: 'Lead',   count: lead,   tone: 'var(--v3-text-muted)' }
  ]
  return (
    <div style={{
      marginTop: 14,
      paddingTop: 14,
      borderTop: '1px solid var(--v3-border)'
    }}>
      {/* Stacked bar */}
      <div
        aria-hidden="true"
        style={{
          height: 8,
          borderRadius: 999,
          background: 'var(--v3-track)',
          overflow: 'hidden',
          display: 'flex',
          gap: 2
        }}
      >
        {total > 0 ? segments.map((s) => (
          <div
            key={s.id}
            style={{
              width: `${(s.count / total) * 100}%`,
              background: s.tone,
              transition: 'width 280ms cubic-bezier(0.2, 0.8, 0.2, 1)'
            }}
          />
        )) : (
          <div style={{ width: '100%', background: 'transparent' }} />
        )}
      </div>

      {/* Numbers row underneath */}
      <div style={{
        marginTop: 10,
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 12
      }}>
        {segments.map((s) => (
          <div key={s.id}>
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 6,
              fontFamily: 'var(--font-display)',
              fontSize: 22,
              lineHeight: 1,
              color: s.tone,
              fontVariantNumeric: 'tabular-nums'
            }}>
              <span aria-hidden="true" style={{
                width: 6, height: 6, borderRadius: '50%',
                background: s.tone
              }} />
              {breakdown == null ? '—' : s.count}
            </div>
            <div className="v3-eyebrow" style={{ marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ============================================================
   TodayOnSiteRow — single schedule row in Today on Site.
   Time + job/title + stage chip + chevron. Tap → linked job.
   ============================================================ */
function TodayOnSiteRow({ row, onTap }) {
  const stage = row.stage ? STAGE_DISPLAY[row.stage] : null
  const startTime = row.startAt
    ? new Date(row.startAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : ''
  return (
    <motion.button
      type="button"
      onClick={() => { hapticTap(); onTap?.() }}
      whileTap={{ scale: 0.99 }}
      whileHover={{ y: -1 }}
      transition={{ type: 'spring', stiffness: 380, damping: 30 }}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 12,
        width: '100%',
        padding: '12px 14px',
        borderRadius: 12,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border-strong)',
        color: 'var(--v3-text)',
        textAlign: 'left',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: '0 1px 0 rgba(255, 255, 255, 0.05) inset'
      }}
    >
      {/* Time slot */}
      <div style={{
        flexShrink: 0,
        minWidth: 56,
        textAlign: 'center',
        padding: '4px 8px',
        borderRadius: 8,
        background: 'var(--v3-surface-2)',
        border: '1px solid var(--v3-border)',
        fontFamily: 'var(--font-display)',
        fontSize: 13,
        color: 'var(--v3-text)',
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.02em',
        lineHeight: 1.4
      }}>
        {startTime || '—'}
      </div>
      {/* Title + client */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 14,
          fontWeight: 600,
          color: 'var(--v3-text)',
          letterSpacing: '-0.005em',
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis'
        }}>
          {row.title}
        </div>
        {stage && (
          <div style={{
            marginTop: 3,
            fontFamily: 'var(--font-body)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.10em',
            textTransform: 'uppercase',
            color: stage.color
          }}>
            {stage.label}
          </div>
        )}
      </div>
      <ChevronRight size={16} color="var(--v3-text-muted)" style={{ flexShrink: 0 }} />
    </motion.button>
  )
}

/* ============================================================
   PipelineDealRow — single deal row inside Pipeline Preview.
   Stage chip on the left + name + amount in Bebas. Hover lifts
   border/background, tap navigates to the contact.
   ============================================================ */
const STAGE_DISPLAY = {
  lead:    { label: 'Lead',    color: 'var(--v3-stage-lead)' },
  quote:   { label: 'Quote',   color: 'var(--v3-stage-quote)' },
  job:     { label: 'Job',     color: 'var(--v3-stage-active)' },
  invoice: { label: 'Invoice', color: 'var(--v3-stage-won)' }
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
        // Hover stays neutral — black/charcoal/white. Stage color
        // shows on the spine + label only (functional). No ambient
        // blue/purple bleed onto the card's halo.
        e.currentTarget.style.borderColor = 'rgba(255, 255, 255, 0.30)'
        e.currentTarget.style.background = 'var(--v3-surface-3)'
        e.currentTarget.style.boxShadow = '0 1px 0 rgba(255, 255, 255, 0.06) inset, 0 8px 24px rgba(0, 0, 0, 0.40)'
      }}
      onMouseLeave={(e) => {
        e.currentTarget.style.borderColor = 'var(--v3-border-strong)'
        e.currentTarget.style.background = 'var(--v3-surface)'
        e.currentTarget.style.boxShadow = '0 1px 0 rgba(255, 255, 255, 0.05) inset, 0 4px 14px rgba(0, 0, 0, 0.30)'
      }}
    >
      {/* Stage spine — 5px gradient. Glow removed (QA pass): blue/
          purple stages were bleeding ambient atmosphere. Functional
          color only — chip + spine carry the meaning. */}
      <span aria-hidden="true" style={{
        flexShrink: 0,
        width: 5,
        height: 36,
        borderRadius: 3,
        background: `linear-gradient(180deg, ${stage.color}, color-mix(in srgb, ${stage.color} 50%, transparent))`
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
      // Hover: lift + shift right 2px + brighter surface. Reads as a
      // control being depressed/highlighted. Hex literal so framer can
      // interpolate the colour smoothly (matches --v3-surface-2 token).
      whileHover={{
        y: -2,
        x: 2,
        backgroundColor: 'var(--v3-surface-3)'
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
