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
import { QuickAction, SectionHeader } from '../components/v3'
import HomeActivityCard from '../components/HomeActivityCard.jsx'
import { hapticTap } from '../lib/haptics.js'
// V3-SYSTEM-1B-3: surface real cover photos on Home rows. Reuses the
// same batch helper Jobs already uses (one query + one signed-URL
// batch call, no N+1). Returns { [contactId]: signedUrl }.
import { fetchCoverPhotosByJob } from '../lib/photos.js'
import { useIsDesktop } from '../lib/useMediaQuery.js'
import DesktopHomeCommandCenter from '../components/desktop/DesktopHomeCommandCenter.jsx'

/* ----------------- helpers ----------------- */

function greetingPrefix() {
  const h = new Date().getHours()
  if (h < 12) return 'Good morning,'
  if (h < 17) return 'Good afternoon,'
  return 'Good evening,'
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
  // V3-SYSTEM-1B-3: signed cover-photo URLs keyed by contact id. Populated
  // alongside the rest of the Home data via fetchCoverPhotosByJob (same
  // pattern Jobs uses). Empty map = every row falls back to a neutral
  // initial tile. Doesn't gate render — lists paint immediately, photos
  // pop in when the URL map arrives.
  const [photoUrlByJob, setPhotoUrlByJob] = useState({})
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

      // V3-SYSTEM-1B-3: photo fetch runs in the same Promise.all as the
      // existing four queries. Failure is non-fatal — empty map → rows
      // fall back to neutral initial tiles. No N+1: helper does one
      // fh_job_files query + one batch signed-URL call total.
      const [contactsRes, overdueSchedRes, paysRes, todaySchedRes, photoMap] = await Promise.all([
        // Contacts: stages + amounts + last update for at-risk calc.
        // updated_at falls back to created_at if missing.
        // V3-PARTNERS: dropped the .eq('user_id', user.id) JS-layer filter
        // so partner-shared jobs flow into Pipeline / Next Actions / Today
        // on Site / Pipeline Preview. RLS enforces owner+partner access.
        supabase
          .from('fh_contacts')
          .select('id, name, amount, stage, updated_at, created_at'),
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
          .limit(6),
        // Cover photos keyed by contact id — same helper Jobs uses.
        fetchCoverPhotosByJob(user.id).catch(() => ({}))
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
      // 1. Stale leads/quotes — needs a follow-up call/text. Urgency
      // escalates to danger at 14+ days; visual tone carries the
      // severity, so the label stays plain "Follow up" regardless.
      // Operator-facing copy (no CRM shorthand): subline names the
      // stage + days waiting in plain English.
      for (const c of risky) {
        const daysWaiting = Math.max(1, Math.floor((nowD - new Date(c.updated_at || c.created_at || 0)) / 86400000))
        const dayWord = daysWaiting === 1 ? 'day' : 'days'
        actions.push({
          id: `followup-${c.id}`,
          kind: 'followup',
          contactId: c.id,
          title: `Follow up with ${c.name || 'lead'}`,
          detail: `${c.stage === 'lead' ? 'Lead' : 'Quote'} waiting ${daysWaiting} ${dayWord}`,
          urgencyLabel: 'Follow up',
          urgencyTone: daysWaiting >= 14 ? 'danger' : 'warn',
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

      // Stage breakdown for the Pipeline card footer — 3 chips that
      // partition the funnel and match the Jobs tab filters one-to-one
      // so a tap on a chip lands on a tab with the same count.
      //   Lead  = stage in (lead, quote)       → /jobs?stage=lead
      //   Doing = stage = job                  → /jobs?stage=active (tab "Doing")
      //   Won   = stage in (invoice, closed)   → /jobs?stage=won
      //
      // 5/13 audit changes:
      //   • Won was previously stage='closed' only — now matches the
      //     canonical WON_STAGES from rollups.js (invoice + closed) so
      //     Home agrees with the Jobs "Won" tab + Reports "Won YTD".
      //   • Active was previously stage in (job, invoice) which read as
      //     "all the work in progress" but conflicted with the Jobs
      //     header's "active" reading (ACTIVE_STAGES count). We narrow
      //     it to stage='job' so it matches the Jobs "Doing" tab exactly.
      const stageCounts = {
        won:    contacts.filter((c) => c.stage === 'invoice' || c.stage === 'closed').length,
        active: contacts.filter((c) => c.stage === 'job').length,
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
      setPhotoUrlByJob(photoMap || {})
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
  const isDesktop = useIsDesktop()

  // Phase 10 — desktop dispatch. At >=900px the new
  // DesktopHomeCommandCenter renders the full command-center layout
  // using the same data this screen already fetches. Below 900px the
  // existing motion.div.v3-screen--home flow renders verbatim.
  if (isDesktop) {
    return (
      <DesktopHomeCommandCenter
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
        dealsAtRisk={dealsAtRisk}
        jobsBehind={jobsBehind}
        invoicingWeek={invoicingWeek}
        todayOnSite={todayOnSite}
        topPipeline={topPipeline}
        nextActions={nextActions}
        onGoToJobs={(filter) => navigate(filter ? `/jobs?stage=${filter}` : '/jobs')}
        onGoToSchedule={() => navigate('/schedule')}
        onGoToInvoices={() => navigate('/invoices')}
        onGoToBid={() => navigate('/bid')}
        onGoToCompose={() => navigate('/compose')}
        onGoToPourWindow={() => navigate('/pour-window')}
        onOpenJob={(id) => navigate(`/jobs/${id}`)}
        onOpenJobAtTab={(id, tab) => navigate(`/jobs/${id}${tab ? `?tab=${tab}` : ''}`)}
        onNewLead={() => navigate('/jobs?new=1')}
      />
    )
  }

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
      className="v3-screen v3-screen--home"
      variants={stagger}
      initial="hidden"
      animate="show"
      style={{ paddingBottom: 120, background: 'var(--v3-bg)' }}
    >
      {/* ─────────── COMPACT GREETING STRIP — V3-HOME-1 ───────────
          Demoted from 36pt serif italic h1 to a single sans 14pt muted
          line so the AppHeader wordmark and the operator command data
          (pipeline + next actions) stay dominant. Date eyebrow stays.
          Weather chip stays on the right. */}
      <motion.div
        variants={item}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 16,
          // V3-SYSTEM-1B-1: greeting strip pad 10/16/10 → 8/16/6 so the
          // first card sits ~6px closer to the header.
          padding: '8px 16px 6px'
        }}
      >
        <div style={{ flex: 1, minWidth: 0 }}>
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 10,
            fontWeight: 700,
            letterSpacing: '0.18em',
            textTransform: 'uppercase',
            color: 'var(--v3-primary)'
          }}>
            {now.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })}
            {' · '}
            {now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}
          </span>
          {/* Hero greeting — ports the design's "Good morning, *Jesse.*" pattern
              with the italic gold accent on the first name. font-display so the
              greeting reads as a screen title, not a caption. */}
          <h1 style={{
            margin: '4px 0 0',
            fontFamily: 'var(--font-display)',
            fontSize: 'clamp(24px, 7vw, 32px)',
            lineHeight: 1.05,
            letterSpacing: '0.01em',
            color: 'var(--v3-text)',
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis'
          }}>
            {greetingPrefix().replace(',', '')},{' '}
            <span style={{
              color: 'var(--v3-primary)',
              letterSpacing: 0
            }}>{firstName}.</span>
          </h1>
        </div>

        {hasCoords ? (
          /* V3-SYSTEM-1B-1: weather pill compacted — pad 10/12 → 6/10,
             icon 18 → 16, temp 14 → 13, condition subline dropped (the
             small uppercase line ate ~11px and the temp+icon already
             telegraphs weather). Pill height 44 → 32. */
          <motion.button
            type="button"
            whileTap={{ scale: 0.96 }}
            whileHover={{ y: -1 }}
            transition={{ type: 'spring', stiffness: 380, damping: 30 }}
            onClick={() => { hapticTap(); navigate('/pour-window') }}
            aria-label={condStr ? `Open weather forecast — ${condStr}` : 'Open weather forecast'}
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              padding: '6px 10px',
              borderRadius: 'var(--v3-radius-btn)',
              background: 'var(--v3-surface)',
              border: '1px solid var(--v3-border)',
              color: 'var(--v3-text)',
              cursor: 'pointer',
              flexShrink: 0,
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            <CloudSun size={16} color="#8FB4E3" aria-hidden="true" />
            <span style={{
              fontFamily: 'var(--font-body)',
              fontSize: 13,
              fontWeight: 700,
              lineHeight: 1
            }}>
              {tempStr}
            </span>
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
              padding: '11px 14px',
              minHeight: 40,
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

      {/* ─────────── PIPELINE REVENUE CARD — V3-HOME-1D ───────────
          Mockup-faithful revenue moment. Eyebrow reframed from
          "Total Pipeline" descriptor to "Today's Revenue Opportunity"
          aspirational header (muted, not gold). Money stays the gold
          anchor with a calm halo. Trend renders as inline colored text
          — no Pill chip chrome. "Total Pipeline" demoted to a sublabel
          beneath the figure. The Won/Active/Lead segmented bar + dotted
          legend is retired in favor of a single muted text caption. A
          1px gold hairline sweep sits under the sublabel as decorative
          brand luminance — presentation only, not a fake chart.
          Card-top gold accent stripe + View-all link removed: gold is
          scarce here, only the money + the small sweep wear it. */}
      <motion.div
        variants={item}
        className="v3-section"
        role="button"
        tabIndex={0}
        aria-label="Open pipeline"
        whileTap={{ scale: 0.995 }}
        onClick={() => { hapticTap(); navigate('/jobs') }}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            hapticTap()
            navigate('/jobs')
          }
        }}
        style={{
          position: 'relative',
          overflow: 'hidden',
          // V3-SYSTEM-1B-1: section-to-section margin 14 → 12, card pad
          // 14/18 → 12/16, radius (token default 20) → 16. Home-only
          // density override; tokens stay alone for other screens.
          margin: '0 var(--v3-gutter) 12px',
          padding: '12px 16px',
          borderRadius: 16,
          // Glass-metal depth from V3-HOME-1C — kept verbatim. Inset top
          // highlight + inset bottom shadow + crisp outline + soft halo.
          border: '1px solid var(--v3-border-strong)',
          boxShadow: [
            'inset 0 1px 0 rgba(255, 255, 255, 0.06)',
            'inset 0 -1px 0 rgba(0, 0, 0, 0.18)',
            '0 1px 2px rgba(0, 0, 0, 0.40)',
            '0 12px 28px rgba(0, 0, 0, 0.30)'
          ].join(', '),
          cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent'
        }}
      >
        {/* Eyebrow — muted ink, slightly looser tracking than the v3
            default to give the longer phrase room. */}
        <span className="v3-eyebrow" style={{
          color: 'var(--v3-text-muted)',
          letterSpacing: '0.16em'
        }}>
          Today's Revenue Opportunity
        </span>

        {/* Money + trend row — money baseline-aligned with a tiny
            gold-bronze $ glyph and an inline arrow+pct trend. No Pill
            chip; trend is just colored text. */}
        <div style={{
          marginTop: 6,
          display: 'flex',
          alignItems: 'baseline',
          gap: 12,
          flexWrap: 'nowrap'
        }}>
          <div style={{
            flex: 1,
            minWidth: 0,
            fontFamily: 'var(--font-body)',
            fontSize: 32,
            fontWeight: 700,
            letterSpacing: '-0.012em',
            color: 'var(--v3-primary)',
            fontVariantNumeric: 'tabular-nums',
            lineHeight: 1.05,
            whiteSpace: 'nowrap',
            overflow: 'hidden',
            textOverflow: 'ellipsis',
            textShadow: '0 0 14px color-mix(in srgb, var(--v3-primary) 22%, transparent)'
          }}>
            {pipeline == null ? (
              <span className="v3-skeleton" style={{ width: 160, height: 30, borderRadius: 6 }} />
            ) : (
              <>
                <span style={{
                  fontSize: 22,
                  fontWeight: 600,
                  marginRight: 1,
                  color: 'color-mix(in srgb, var(--v3-primary) 70%, var(--v3-text-muted))',
                  textShadow: 'none'
                }}>
                  $
                </span>
                <CountUp to={pipeline} formatter={(n) => n.toLocaleString()} />
              </>
            )}
          </div>
          {trendPct != null && (
            <span style={{
              flexShrink: 0,
              display: 'inline-flex',
              alignItems: 'center',
              gap: 4,
              fontFamily: 'var(--font-body)',
              fontSize: 11,
              fontWeight: 700,
              letterSpacing: '0.04em',
              color: trendUp ? 'var(--v3-success-bright)' : 'var(--v3-danger-bright)',
              fontVariantNumeric: 'tabular-nums',
              lineHeight: 1
            }}>
              {trendUp
                ? <ArrowUpRight size={11} aria-hidden="true" />
                : <ArrowDownRight size={11} aria-hidden="true" />}
              {trendUp ? '+' : ''}{trendPct}% · 7d
            </span>
          )}
        </div>

        {/* Sublabel under the figure — quiet caption naming the metric. */}
        <div style={{
          marginTop: 4,
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          fontWeight: 500,
          color: 'var(--v3-text-muted)',
          lineHeight: 1.3
        }}>
          Total Pipeline
        </div>

        {/* Gold sparkline — synthesized ascending wave that anchors the
            pipeline number visually. Ports the design's pipeline-hero__spark
            (screens-home.jsx). 14-point ascending curve so the trend reads
            as "going up and to the right" without requiring real time-series
            data to be wired through yet. */}
        <svg
          aria-hidden="true"
          viewBox="0 0 320 60"
          preserveAspectRatio="none"
          style={{ display: 'block', width: '100%', height: 48, marginTop: 10 }}
        >
          <defs>
            <linearGradient id="fh-pipeline-sparkfill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#E4BE6F" stopOpacity="0.32" />
              <stop offset="100%" stopColor="#E4BE6F" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path
            d="M0,46 L26,42 L52,38 L78,30 L104,34 L130,28 L156,32 L182,22 L208,28 L234,18 L260,22 L286,12 L320,8 L320,60 L0,60 Z"
            fill="url(#fh-pipeline-sparkfill)"
          />
          <path
            d="M0,46 L26,42 L52,38 L78,30 L104,34 L130,28 L156,32 L182,22 L208,28 L234,18 L260,22 L286,12 L320,8"
            fill="none"
            stroke="#E4BE6F"
            strokeWidth="1.5"
          />
          <circle cx="320" cy="8" r="3" fill="#E4BE6F" />
          <circle cx="320" cy="8" r="6" fill="#E4BE6F" opacity="0.18" />
        </svg>

        {/* Won / Active / Lead breakdown — ports the design's pipeline-hero__breakdown.
            Three cells, colored dot + label + stamp amount + count. Each cell
            is a tap target → Jobs filtered by that stage. */}
        {stageBreakdown != null && (
          <div style={{
            marginTop: 12,
            paddingTop: 12,
            borderTop: '1px solid var(--v3-border)',
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 12
          }}>
            <PipelineBreakdownCell
              dotColor="var(--v3-success-bright, #7BB58E)"
              label="Won"
              count={stageBreakdown.won}
              tone="success"
              onClick={(e) => { e.stopPropagation(); hapticTap(); navigate('/jobs?stage=won') }}
            />
            <PipelineBreakdownCell
              dotColor="var(--v3-primary)"
              label="Active"
              count={stageBreakdown.active}
              tone="gold"
              onClick={(e) => { e.stopPropagation(); hapticTap(); navigate('/jobs?stage=active') }}
            />
            <PipelineBreakdownCell
              dotColor="#6B7CA8"
              label="Lead"
              count={stageBreakdown.lead}
              tone="muted"
              onClick={(e) => { e.stopPropagation(); hapticTap(); navigate('/jobs?stage=lead') }}
            />
          </div>
        )}
      </motion.div>

      {/* ─────────── QUICK ACTIONS — TOOLBAR ───────────
          V3-HOME-2 de-box: header + 5 tile launcher row on page surface.
          Each QuickAction tile self-frames; wrapper was redundant chrome.
          Position: relocated here from the bottom so the primary launcher
          tiles (Add Lead / New Job / Schedule / Invoice / Voice Note) sit
          inside the first thumb-reach zone on mobile, right after the
          revenue moment. Desktop uses DesktopHomeCommandCenter and is
          unaffected. */}
      <motion.div
        variants={item}
        style={{
          margin: '0 var(--v3-gutter) 16px'
        }}
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
          <QuickAction icon={Plus} label="Add Lead" primary onTap={() => navigate('/jobs?new=1')} />
          <QuickAction icon={FileText} label="New Job" onTap={() => navigate('/jobs?new=1&asStage=job')} />
          <QuickAction icon={CalendarRange} label="Schedule" onTap={() => navigate('/schedule')} />
          <QuickAction icon={Receipt} label="Invoice" onTap={() => navigate('/invoices')} />
          <QuickAction icon={Mic} label="Voice Note" onTap={() => navigate('/notes?voice=1')} />
        </div>
      </motion.div>

      {/* ─────────── RECENT ACTIVITY — cross-job feed ───────────
          Compact 5-row card that surfaces the same data as /activity
          on the dashboard surface. Auto-hides on a brand-new account
          with no events. "See all" links through to /activity. */}
      <motion.div variants={item} style={{ padding: '8px 20px 14px' }}>
        <HomeActivityCard />
      </motion.div>

      {/* ─────────── NEXT ACTIONS — IMMEDIATE WORK ───────────
          V3-HOME-2 de-box: dropped the bordered section wrapper. Section
          header organizes; the row cards self-frame on the page surface.
          Pipeline mini-card stays the only bordered anchor on Home. */}
      {nextActions != null && nextActions.length > 0 && (
        <motion.div
          variants={item}
          style={{
            margin: '0 var(--v3-gutter) 16px'
          }}
        >
          <div className="v3-section-header">
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 8 }}>
              <span className="v3-eyebrow" style={{ color: 'var(--v3-text-muted)' }}>
                Next Actions
              </span>
              <span style={{
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                minWidth: 18,
                height: 18,
                padding: '0 6px',
                borderRadius: 999,
                background: 'var(--v3-surface-2)',
                border: '1px solid var(--v3-border)',
                color: 'var(--v3-text)',
                fontFamily: 'var(--font-body)',
                fontSize: 10,
                fontWeight: 700,
                fontVariantNumeric: 'tabular-nums',
                lineHeight: 1
              }}>
                {nextActions.length}
              </span>
            </span>
            <button
              type="button"
              onClick={() => { hapticTap(); navigate('/jobs') }}
              className="v3-section-link"
              style={{ color: 'var(--v3-text-muted)', transition: 'color 160ms ease' }}
              onMouseEnter={(e) => { e.currentTarget.style.color = 'var(--v3-primary)' }}
              onMouseLeave={(e) => { e.currentTarget.style.color = 'var(--v3-text-muted)' }}
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
                photoUrl={action.contactId ? photoUrlByJob[action.contactId] : undefined}
                onTap={() => action.contactId
                  ? navigate(`/jobs/${action.contactId}`)
                  : navigate('/jobs')
                }
              />
            ))}
          </div>
        </motion.div>
      )}

      {/* ─────────── TODAY'S PRIORITIES — KPI strip ───────────
          V3-HOME-2 un-nest: dropped the bordered wrapper that nested
          three already-bordered tiles inside another box. Tiles render
          directly on the page surface as a clean 3-column KPI strip.
          Tile internals (V3-SYSTEM-1B-1: 72px minHeight, 22pt value,
          danger tone preserved on Jobs Behind, mute-when-zero subline)
          unchanged. Inter-tile gap tightened 10 → 8 so the three tiles
          read as a continuous strip, not loose chips. */}
      <motion.div
        variants={item}
        style={{
          margin: '0 var(--v3-gutter) 16px'
        }}
      >
        <SectionHeader label="Today's Priorities" />
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 8,
            marginTop: 4
          }}
        >
          <CompactKpi
            tone="success"
            icon={PhoneCall}
            value={dealsAtRisk?.followUps}
            label="Follow-ups"
            subline={dealsAtRisk?.followUps > 0 ? 'Calls to leads' : null}
            onTap={() => navigate('/jobs?stage=lead')}
          />
          <CompactKpi
            tone="lead"
            icon={FileText}
            value={dealsAtRisk?.quotesAttention}
            label="Quotes"
            subline={dealsAtRisk?.quotesAttention > 0 ? 'Need follow up' : null}
            onTap={() => navigate('/jobs?stage=quote')}
          />
          {/* Tone flips danger→primary only when jobsBehind === 0. A red
              "0 BEHIND" reads as an alarm when it's actually the all-clear
              state (~audit 5/13). Non-zero stays danger so the operator
              still gets the urgent red read when work has actually slipped. */}
          <CompactKpi
            tone={jobsBehind > 0 ? 'danger' : 'primary'}
            icon={CalendarClock}
            value={jobsBehind}
            label="Jobs Behind"
            subline={jobsBehind > 0 ? 'Reschedule' : 'All on track'}
            onTap={() => navigate('/schedule')}
          />
        </div>
      </motion.div>

      {/* ─────────── TODAY ON SITE ───────────
          V3-HOME-2 de-box: header + row stack on page surface. Each
          row is its own self-framing card; no parent panel needed.
          Empty state still uses the dashed v3-empty primitive. */}
      <motion.div
        variants={item}
        style={{
          margin: '0 var(--v3-gutter) 16px'
        }}
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
                photoUrl={row.contactId ? photoUrlByJob[row.contactId] : undefined}
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
          Top 3 active deals by value. V3-HOME-2 de-box: header + row
          stack on page surface. Each PipelineDealRow is a self-framed
          glass card already; the bordered wrapper was redundant. */}
      <motion.div
        variants={item}
        style={{
          margin: '0 var(--v3-gutter) 16px'
        }}
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
                photoUrl={photoUrlByJob[deal.id]}
                onTap={() => navigate(`/jobs/${deal.id}`)}
              />
            ))
          )}
        </div>
      </motion.div>

    </motion.div>
  )
}

/* ============================================================
   TodayOnSiteRow — single schedule row in Today on Site.
   Time + job/title + stage chip + chevron. Tap → linked job.
   ============================================================ */
function TodayOnSiteRow({ row, photoUrl, onTap }) {
  const stage = row.stage ? STAGE_DISPLAY[row.stage] : null
  const startTime = row.startAt
    ? new Date(row.startAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : ''
  const endTime = row.endAt
    ? new Date(row.endAt).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
    : ''
  const timeLabel = startTime && endTime ? `${startTime} – ${endTime}` : (startTime || '—')
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
        // V3-SYSTEM-1B-3: gap 12 → 10 to claw back ~4px when adding the
        // 32px thumbnail + its gap. Row stays comfortable on a 360px phone.
        gap: 10,
        width: '100%',
        // V3-SYSTEM-1B-1: row pad 12/14 → 10/12, radius 12 → 10.
        padding: '10px 12px',
        borderRadius: 10,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border-strong)',
        color: 'var(--v3-text)',
        textAlign: 'left',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        boxShadow: '0 1px 0 rgba(255, 255, 255, 0.05) inset'
      }}
    >
      {/* Time slot — start–end range when both are known */}
      <div style={{
        flexShrink: 0,
        minWidth: endTime ? 100 : 56,
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
        lineHeight: 1.4,
        whiteSpace: 'nowrap'
      }}>
        {timeLabel}
      </div>
      {/* V3-SYSTEM-1B-3: real cover photo for the linked job, falling
          back to a neutral initial tile when no photo exists. Reserves
          its 32×32 space immediately so async photo loads don't shift
          the row. */}
      <RowThumb photoUrl={photoUrl} name={row.clientName || row.title} />
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

function PipelineDealRow({ deal, photoUrl, onTap }) {
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
        // V3-SYSTEM-1B-3: gap 14 → 12 to make room for the 32px thumb.
        gap: 12,
        width: '100%',
        // V3-SYSTEM-1B-1: row pad 14/14 → 12/12, radius 14 → 12.
        padding: '12px 12px',
        borderRadius: 12,
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
      {/* Stage spine — V3-HOME-1B: thinned 5→3px and shortened 36→20px
          so it reads as a stage cue, not an old colored card outline.
          Stage label below the deal name still carries the explicit
          stage signal in its own color. */}
      <span aria-hidden="true" style={{
        flexShrink: 0,
        width: 3,
        height: 20,
        borderRadius: 2,
        background: `color-mix(in srgb, ${stage.color} 70%, transparent)`
      }} />
      {/* V3-SYSTEM-1B-3: real cover photo (or neutral initial fallback)
          between the stage spine and the deal name block. Reads as a
          job object, not a database row. */}
      <RowThumb photoUrl={photoUrl} name={deal.name} />
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
  primary: { color: 'var(--v3-primary)' },
  success: { color: 'var(--v3-success-bright)' },
  danger:  { color: 'var(--v3-danger-bright)' },
  // warn — bronze/amber from the stage-quote token; reads as "needs attention
  // soon" without claiming the urgency of danger.
  warn:    { color: 'var(--v3-stage-quote)' },
  // lead — steel-blue from the stage-lead token; the closest token-native
  // option to the mockup's lavender for the Quotes tile.
  lead:    { color: 'var(--v3-stage-lead)' }
}

function CompactKpi({ tone = 'primary', value, label, subline, icon: Icon, isMoney, onTap }) {
  const t = COMPACT_TONE[tone] || COMPACT_TONE.primary
  // V3-SYSTEM-1B-1: subline mutes when the metric is zero. Three tiles
  // at zero used to read as three colored shouts; now they read as
  // three quiet captions and only nonzero counts wear their tone.
  const isZero = value != null && Number(value) === 0
  const sublineColor = isZero ? 'var(--v3-text-muted)' : t.color

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
        // V3-SYSTEM-1B-1: tile pad 14/12/12 → 12/12/10, radius 14 → 12,
        // minHeight 88 → 72 so the three KPIs read as a quiet strip.
        padding: '12px 12px 10px',
        borderRadius: 12,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        color: 'var(--v3-text)',
        cursor: 'pointer',
        minHeight: 72,
        WebkitTapHighlightColor: 'transparent',
        overflow: 'hidden'
      }}
    >
      {/* V3-HOME-1: no colored top-edge bar. Tone signaled only via the
          icon chip + value color. Chip + value sizes shrunk in 1B-1. */}

      {Icon ? (
        <span aria-hidden="true" style={{
          display: 'inline-grid', placeItems: 'center',
          width: 24, height: 24, borderRadius: 7,
          background: 'var(--v3-surface-2)',
          border: '1px solid var(--v3-border-strong)',
          color: t.color,
          marginBottom: 8
        }}>
          <Icon size={13} strokeWidth={2.2} />
        </span>
      ) : null}

      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 22,
        color: t.color,
        lineHeight: 1,
        marginBottom: 6,
        minHeight: 22,
        fontVariantNumeric: 'tabular-nums'
      }}>
        {value == null ? (
          <span className="v3-skeleton" style={{ width: 40, height: 18, borderRadius: 4 }} />
        ) : isMoney ? (
          <>
            <span style={{
              fontSize: 12, color: 'var(--v3-text-muted)',
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
          marginTop: 3,
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          // V3-SYSTEM-1B-1: subline weight 700 → 500 so the row carries
          // less shout. Three tiles in a row read as quiet captions; only
          // the icon chip + value digit carry the tone-color load.
          fontWeight: 500,
          color: sublineColor,
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

// V3-SYSTEM-1B-1: warn no longer uses brand gold (--v3-primary). Stale
// leads <14d cold now wear the dedicated --v3-warn amber (#D4A042) so
// gold can stay scarce on Home — reserved for the Pipeline money digits
// and the small hairline sweep. Red urgency stays red, green stays green.
const URGENCY_TONE = {
  danger:  { color: 'var(--v3-danger-bright)',  glow: 'rgba(192, 57, 43, 0.45)' },
  warn:    { color: 'var(--v3-warn)',           glow: 'rgba(212, 160, 66, 0.40)' },
  success: { color: 'var(--v3-success-bright)', glow: 'rgba(46, 204, 113, 0.40)' }
}

function NextActionRow({ action, photoUrl, onTap }) {
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
        // V3-HOME-2: row pad 9/12/9/14 → 8/12/8/14, saves ~10px stacked
        // across 5 rows. Tap target stays comfortable (icon + title
        // text already span ~36px tall before the row padding).
        padding: '8px 12px 8px 14px',
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
          amber = today, green = money in motion. V3-SYSTEM-1B-1: glow blur
          softened 12 → 8 so the spine reads as a hairline cue, not a halo. */}
      <span aria-hidden="true" style={{
        position: 'absolute',
        left: 0, top: 7, bottom: 7,
        width: 3,
        background: tone.color,
        borderRadius: '0 3px 3px 0',
        boxShadow: `0 0 8px ${tone.glow}`
      }} />

      {/* V3-SYSTEM-1B-3: when a real cover photo exists for the linked
          contact, show it instead of the kind-of-action icon chip. The
          row title already names the action ("Follow up with Jane"), so
          a photo telegraphs "this is about Jane's job" — a stronger
          object cue than a generic phone glyph. Without a photo, the
          existing tone-keyed icon chip stays as the kind cue. */}
      {photoUrl ? (
        <img
          src={photoUrl}
          alt=""
          loading="lazy"
          aria-hidden="true"
          style={{
            flexShrink: 0,
            width: 32,
            height: 32,
            borderRadius: 9,
            objectFit: 'cover',
            background: 'var(--v3-surface-2)',
            border: '1px solid var(--v3-border-strong)',
            display: 'block'
          }}
          onError={(e) => {
            // Signed URL expired or blocked — hide so the broken-image
            // glyph doesn't show. Space stays reserved.
            e.currentTarget.style.visibility = 'hidden'
          }}
        />
      ) : (
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
      )}

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

/* ============================================================
   RowThumb — V3-SYSTEM-1B-3.
   32×32 cover-photo tile used by Today on Site rows + Pipeline
   Preview rows. Renders a real signed-URL image when one exists,
   otherwise a neutral surface-2 + hairline tile with 1-2 letter
   initials in muted ink. No gold tint, no stage tint, no fake
   placeholder image — restraint is intentional so the row's
   spine + stage label + amount stay the carriers of meaning.
   ============================================================ */
function RowThumb({ photoUrl, name, size = 32 }) {
  const radius = 8
  if (photoUrl) {
    return (
      <img
        src={photoUrl}
        alt=""
        loading="lazy"
        aria-hidden="true"
        style={{
          flexShrink: 0,
          width: size,
          height: size,
          borderRadius: radius,
          objectFit: 'cover',
          background: 'var(--v3-surface-2)',
          border: '1px solid var(--v3-border)',
          display: 'block'
        }}
        onError={(e) => {
          // Signed URL 403 / network failure — hide rather than show
          // a broken-image glyph. The tile space stays reserved so the
          // row layout doesn't shift; next data refresh restores it.
          e.currentTarget.style.visibility = 'hidden'
        }}
      />
    )
  }
  return (
    <span
      aria-hidden="true"
      style={{
        flexShrink: 0,
        width: size,
        height: size,
        borderRadius: radius,
        background: 'var(--v3-surface-2)',
        border: '1px solid var(--v3-border)',
        color: 'var(--v3-text-muted)',
        display: 'grid',
        placeItems: 'center',
        fontFamily: 'var(--font-display)',
        fontSize: size >= 36 ? 14 : 12,
        letterSpacing: '0.04em',
        lineHeight: 1
      }}
    >
      {nameInitials(name)}
    </span>
  )
}

function nameInitials(name) {
  if (!name) return '—'
  const parts = String(name).trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '—'
  if (parts.length === 1) return parts[0][0].toUpperCase()
  return (parts[0][0] + parts[1][0]).toUpperCase()
}

/* StageChip — inline "<count> <label>" tap target inside the pipeline
   card breakdown. stopPropagation so the outer card tap (→ /jobs)
   doesn't double-fire when one of the chips is pressed. */
/* ============================================================
   PipelineBreakdownCell — one tap-cell inside the pipeline hero's
   3-up breakdown row. Ported from the v3 design's
   pipeline-hero__breakdown (screens-home.jsx .brk pattern).

   Layout:
     ● Label
     $stamp value
     N segments
   ============================================================ */
function PipelineBreakdownCell({ dotColor, label, count, tone, onClick }) {
  const valueColor = tone === 'success'
    ? 'var(--v3-success-bright, #7BB58E)'
    : tone === 'gold'
      ? 'var(--v3-primary)'
      : 'var(--v3-text)'
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        background: 'transparent',
        border: 'none',
        padding: 0,
        textAlign: 'left',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent',
        display: 'flex',
        flexDirection: 'column',
        gap: 4,
        minWidth: 0
      }}
    >
      <div style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 6,
        fontFamily: 'var(--font-body)',
        fontSize: 10,
        fontWeight: 700,
        letterSpacing: '0.14em',
        textTransform: 'uppercase',
        color: 'var(--v3-text-muted)'
      }}>
        <span aria-hidden="true" style={{
          width: 8, height: 8, borderRadius: '50%',
          background: dotColor,
          boxShadow: `0 0 8px ${dotColor}`
        }} />
        {label}
      </div>
      <div style={{
        fontFamily: 'var(--font-display)',
        fontSize: 20,
        lineHeight: 1,
        color: valueColor,
        fontVariantNumeric: 'tabular-nums',
        letterSpacing: '0.01em'
      }}>
        {count}
      </div>
      <div style={{
        fontFamily: 'var(--font-body)',
        fontSize: 10,
        fontWeight: 500,
        color: 'var(--v3-text-muted)',
        letterSpacing: '0.02em'
      }}>
        {count === 1 ? 'deal' : 'deals'}
      </div>
    </button>
  )
}

function StageChip({ count, label, stage, navigate }) {
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation()
        hapticTap()
        navigate(`/jobs?stage=${stage}`)
      }}
      style={{
        display: 'inline-flex',
        alignItems: 'baseline',
        gap: 4,
        padding: '2px 4px',
        margin: '-2px -4px',
        background: 'transparent',
        border: 'none',
        color: 'inherit',
        font: 'inherit',
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      <span style={{ fontWeight: 700, color: 'var(--v3-text)' }}>{count}</span>
      <span>{label}</span>
    </button>
  )
}
