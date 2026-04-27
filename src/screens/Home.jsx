import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { MapPin, CloudSun, TrendingUp, Briefcase, FileText, ChevronRight, Receipt } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { supabase } from '../lib/supabase.js'
import { getWeather, workWindow, MURFREESBORO } from '../lib/weather.js'
import { ACTIVE_STAGES } from '../lib/stages.js'
import Spotlight from '../components/fx/Spotlight.jsx'
import ShimmerBar from '../components/fx/ShimmerBar.jsx'
import GreetingTitle from '../components/fx/GreetingTitle.jsx'
import CountUp from '../components/fx/CountUp.jsx'
import { hapticTap, hapticMedium } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'

function formatDate(d) {
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }).toUpperCase()
}
function greetingPrefix() {
  const h = new Date().getHours()
  if (h < 12) return 'Morning,'
  if (h < 17) return 'Afternoon,'
  return 'Evening,'
}
function initials(name) {
  if (!name) return ''
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
}
function emailFirstToken(email) {
  if (!email) return ''
  const raw = email.split('@')[0].split(/[._-]/).filter(Boolean)[0] || ''
  return raw ? raw[0].toUpperCase() + raw.slice(1) : ''
}
function displayNameFrom(profile, user) {
  // Multi-tenant guard: only use profile.full_name when it actually belongs
  // to the currently-signed-in auth user. Without this, a stale profile
  // row left in context during a sign-out→sign-in transition can leak
  // the prior user's name onto the new user's greeting.
  const profileMatchesUser = profile && user && profile.user_id === user.id
  const full = profileMatchesUser ? profile.full_name?.trim() : ''
  if (full) return full
  return emailFirstToken(user?.email)
}

export default function Home() {
  const { user } = useAuth()
  const { profile, upsertProfile, refresh } = useProfile()
  const navigate = useNavigate()

  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000)
    return () => clearInterval(id)
  }, [])

  const [weather, setWeather] = useState(null)
  const [weatherErr, setWeatherErr] = useState('')
  const [weatherLoading, setWeatherLoading] = useState(false)
  // KPIs default to null (not 0) so the dashboard distinguishes "loading"
  // from "you actually have $0" — prevents the "Notes count went from 0
  // to 7 when I tapped focus" perception bug where the user saw the
  // unloaded zero, then watched it pop in once the query returned.
  const [pipeline, setPipeline] = useState(null)
  const [activeCount, setActiveCount] = useState(null)
  const [notesCount, setNotesCount] = useState(null)
  const [outstanding, setOutstanding] = useState(null)
  const [todayJobs, setTodayJobs] = useState(null)
  const [weeklyTarget] = useState(25000)
  const [weeklyBooked, setWeeklyBooked] = useState(null)
  const [refreshTick, setRefreshTick] = useState(0)

  const hasCoords = profile?.location_lat != null && profile?.location_lon != null
  const displayName = displayNameFrom(profile, user)
  const firstName = displayName ? displayName.split(/\s+/)[0] : 'there'

  useEffect(() => {
    let cancelled = false
    // Always fetch SOMETHING so the weather card doesn't read "— / —".
    // If the user pinned a location, use it. Otherwise fall back to the
    // Murfreesboro default. The "Pin location for weather" button stays
    // visible so they can switch to their own coords.
    const lat = profile?.location_lat ?? MURFREESBORO.lat
    const lon = profile?.location_lon ?? MURFREESBORO.lon
    setWeatherLoading(true); setWeatherErr('')
    getWeather(lat, lon)
      .then((d) => { if (!cancelled) setWeather(d) })
      .catch((e) => { if (!cancelled) setWeatherErr(e.message || 'Forecast unavailable') })
      .finally(() => { if (!cancelled) setWeatherLoading(false) })
    return () => { cancelled = true }
  }, [profile?.location_lat, profile?.location_lon])

  const windowRead = useMemo(
    () => workWindow(weather?.current, profile?.services || []),
    [weather, profile?.services]
  )

  useEffect(() => {
    if (!user) return
    let cancelled = false
    async function load() {
      // "Crews on site" = job-stage contacts with at least one fh_schedule
      // entry in the next 7 days. Open jobs without any scheduled work
      // don't count — makes the KPI a real operational signal, not a
      // pipeline-depth metric.
      const now = new Date()
      const windowStart = new Date(now); windowStart.setHours(0, 0, 0, 0)
      const windowEnd = new Date(windowStart); windowEnd.setDate(windowEnd.getDate() + 7)

      // Single Promise.all so every KPI lands on the same render frame.
      // Notes count was previously sequenced AFTER this batch, which made
      // it appear to "change" a moment after the rest of the dashboard
      // settled.
      const [{ data: contacts }, { data: upcomingSchedule }, { data: pays }, notesRes] = await Promise.all([
        supabase
          .from('fh_contacts')
          .select('id, name, amount, stage, job_title, job_type')
          .eq('user_id', user.id),
        supabase
          .from('fh_schedule')
          .select('contact_id, start_at')
          .eq('user_id', user.id)
          .gte('start_at', windowStart.toISOString())
          .lte('start_at', windowEnd.toISOString()),
        supabase
          .from('fh_payments')
          .select('contact_id, amount')
          .eq('user_id', user.id),
        supabase
          .from('fh_notes')
          .select('id', { count: 'exact', head: true })
          .eq('user_id', user.id)
          .eq('done', false)
      ])

      if (cancelled) return
      const rows = contacts || []
      const scheduledContactIds = new Set(
        (upcomingSchedule || []).map((s) => s.contact_id).filter(Boolean)
      )
      const crewsOnSite = rows.filter(
        (c) => c.stage === 'job' && scheduledContactIds.has(c.id)
      )
      // Pipeline filter aligned with Analytics — was "any stage that
      // isn't closed/lost", which counted custom/legacy stage values
      // that Analytics filtered out. Audit caught the divergence
      // ($166K Home vs $120K Analytics). Both now use ACTIVE_STAGES.
      const totalPipeline = rows
        .filter((c) => ACTIVE_STAGES.includes(c.stage))
        .reduce((s, c) => s + Number(c.amount || 0), 0)
      const booked = rows
        .filter((c) => c.stage === 'invoice' || c.stage === 'closed')
        .reduce((s, c) => s + Number(c.amount || 0), 0)
      // Outstanding AR — sum of (amount - paid) for jobs in money pipeline.
      // Closed/lost jobs and fully-paid ones drop out automatically.
      const paidByJob = new Map()
      for (const p of pays || []) {
        if (!p.contact_id) continue
        paidByJob.set(p.contact_id, (paidByJob.get(p.contact_id) || 0) + Number(p.amount || 0))
      }
      const outstandingTotal = rows
        .filter((c) => c.stage === 'job' || c.stage === 'invoice')
        .reduce((s, c) => {
          const bal = Number(c.amount || 0) - (paidByJob.get(c.id) || 0)
          return s + Math.max(0, bal)
        }, 0)
      setOutstanding(outstandingTotal)

      setPipeline(totalPipeline)
      setActiveCount(crewsOnSite.length)
      setWeeklyBooked(booked)
      setTodayJobs(crewsOnSite.slice(0, 3))
      setNotesCount(notesRes?.count || 0)
    }
    load()
    return () => { cancelled = true }
  }, [user, refreshTick])

  // Supabase Realtime — re-fetch Home on any fh_contacts change for this user.
  // Filter is server-side via the postgres_changes config; the channel only
  // forwards rows matching the user_id. Cleanup unsubscribes on unmount.
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

  // Inline-edit greeting — preserved from previous Home, kill-list–clean copy.
  const [editingFocus, setEditingFocus] = useState(false)
  const [focusDraft, setFocusDraft] = useState(profile?.greeting || '')
  const focusRef = useRef(null)
  useEffect(() => {
    if (!editingFocus) setFocusDraft(profile?.greeting || '')
  }, [profile?.greeting, editingFocus])
  useEffect(() => {
    if (editingFocus && focusRef.current) {
      focusRef.current.focus()
      focusRef.current.select()
    }
  }, [editingFocus])
  async function saveFocus() {
    const next = focusDraft.trim().slice(0, 90)
    setEditingFocus(false)
    if (next !== (profile?.greeting || '')) {
      await upsertProfile({ greeting: next || null })
    }
  }

  const targetPct = weeklyTarget > 0 ? Math.min(100, Math.round(((weeklyBooked || 0) / weeklyTarget) * 100)) : 0
  const pourStatus = windowRead?.status || (weather ? 'ok' : '—')
  const pourGood = String(pourStatus).toLowerCase().includes('good') || String(pourStatus).toLowerCase().includes('ok')


  const { stagger, item } = useFhMotion()

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* Top bar moved to shared AppHeader in AppShell (Phase 16). */}

      {/* HERO GREETING — phase 18.4: compact stack so the dashboard
          actually appears above the fold on iPhone. Date now sits as
          a small caption above the greeting (not a chunky pill on its
          own row), subtitle tightens, focus prompt extracted to a
          full-width card below for fat-finger compliance. */}
      <motion.div variants={item} style={{ padding: '6px 20px 10px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--field-gold-bright)', marginBottom: 4 }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--field-gold-bright)' }} />
          {formatDate(now)}
        </div>
        <GreetingTitle prefix={greetingPrefix()} name={firstName} />
        <div style={{ marginTop: 4, fontSize: 12, color: 'var(--ink-muted)' }}>
          {activeCount > 0
            ? <>{activeCount} {activeCount === 1 ? 'crew' : 'crews'} on site. <span style={{ color: 'var(--signal-green)', fontWeight: 600 }}>All green.</span></>
            : 'Nothing active. Quiet day.'}
        </div>
      </motion.div>

      {/* TODAY'S FOCUS — full-width tappable card. Replaces the inline
          text-link pattern that was below 44×44 hit-target spec. */}
      <motion.div variants={item} style={{ padding: '0 20px 14px' }}>
        {editingFocus ? (
          <textarea
            ref={focusRef}
            value={focusDraft}
            onChange={(e) => setFocusDraft(e.target.value)}
            onBlur={saveFocus}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); saveFocus() }
              if (e.key === 'Escape') { setFocusDraft(profile?.greeting || ''); setEditingFocus(false) }
            }}
            maxLength={90}
            rows={2}
            placeholder="What's the focus today?"
            style={{ width: '100%', boxSizing: 'border-box', minHeight: 64, padding: '14px 16px', borderRadius: 14, background: 'var(--surface-2)', border: '1px solid rgba(201,150,58,0.3)', color: 'var(--ink-strong)', fontSize: 14, fontFamily: 'var(--font-body)', resize: 'none', outline: 'none' }}
          />
        ) : (
          <button
            type="button"
            onClick={() => setEditingFocus(true)}
            aria-label={profile?.greeting ? "Edit today's focus" : "Add today's focus"}
            style={{ width: '100%', minHeight: 56, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, padding: '14px 16px', borderRadius: 14, background: profile?.greeting ? 'var(--surface-2)' : 'rgba(201,150,58,0.06)', border: profile?.greeting ? '1px solid var(--rule)' : '1px dashed rgba(201,150,58,0.4)', color: profile?.greeting ? 'var(--ink-strong)' : 'var(--field-gold-bright)', fontSize: 14, fontFamily: 'var(--font-body)', fontWeight: profile?.greeting ? 500 : 700, cursor: 'pointer', textAlign: 'left' }}
          >
            <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {profile?.greeting || "Add today's focus"}
            </span>
            <ChevronRight size={16} color={profile?.greeting ? 'var(--ink-faint)' : 'var(--field-gold-bright)'} />
          </button>
        )}
      </motion.div>

      {/* WEEKLY TARGET CARD — Aceternity-style moving gradient border */}
      <motion.div variants={item} className="fh-fx-moving-border fh-card-raised" style={{ position: 'relative', margin: '0 20px 14px', padding: '18px 20px', borderRadius: 22, background: 'linear-gradient(135deg, rgba(30,20,10,0.8), rgba(20,20,20,0.6))', border: '1px solid rgba(201,150,58,0.2)', backdropFilter: 'blur(20px)', overflow: 'hidden' }}>
        {/* Outer pulse — 200x200 (default), phase 0 */}
        <Spotlight style={{ top: -80, right: -80 }} />
        {/* Inner pulse — smaller, more gold-saturated, behind the $ amount, 1.5s out of phase */}
        <Spotlight
          style={{
            bottom: -20,
            left: -20,
            width: 120,
            height: 120,
            background: 'radial-gradient(circle, rgba(232,176,76,0.55), transparent 55%)',
            animationDelay: '-1.5s'
          }}
        />
        <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 10, position: 'relative' }}>
          <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>Weekly target</div>
          <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 11, fontWeight: 700, color: 'var(--signal-green)', background: 'rgba(45,122,79,0.12)', border: '1px solid rgba(45,122,79,0.25)', padding: '3px 10px', borderRadius: 999 }}>
            <TrendingUp size={12} />{targetPct}%
          </div>
        </div>
        <div className="fh-money" style={{ fontFamily: 'var(--font-display)', fontSize: 52, letterSpacing: '0.01em', lineHeight: 1 }}>
          <span style={{ fontSize: 26, color: 'var(--ink-muted)', verticalAlign: 'top', marginRight: 2 }}>$</span>
          <CountUp to={weeklyBooked} />
        </div>
        <div style={{ marginTop: 14, position: 'relative' }}>
          <ShimmerBar value={targetPct} />
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-muted)' }}>
            <span><span style={{ color: 'var(--field-gold-bright)', fontWeight: 700 }}>{targetPct}%</span> of ${(weeklyTarget / 1000).toFixed(0)}K</span>
            <span>{pipeline > 0 ? `$${(pipeline / 1000).toFixed(0)}K in Pipeline` : '—'}</span>
          </div>
        </div>
      </motion.div>

      {/* WEATHER — tappable, routes to /pour-window. Trade-status pills
          live in the dedicated 3-card row below so we don't duplicate them
          here. */}
      {hasCoords ? (
        <motion.div
          variants={item}
          role="button"
          tabIndex={0}
          aria-label="Open work-window forecast"
          whileTap={{ scale: 0.98 }}
          onClick={() => { hapticTap(); navigate('/pour-window') }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); hapticTap(); navigate('/pour-window') } }}
          style={{ padding: '0 20px 14px', cursor: 'pointer' }}
        >
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderRadius: 16, background: 'var(--surface-2)', border: '1px solid var(--rule)' }}>
            <span aria-hidden="true" style={{ position: 'absolute', top: 8, right: 10, fontSize: 8, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--field-gold-bright)', opacity: 0.7 }}>
              Open →
            </span>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: 'linear-gradient(135deg, #2d3f54, #1a2535)', display: 'grid', placeItems: 'center' }}>
              <CloudSun size={18} color="#8fb4e3" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: '0.02em', lineHeight: 1, color: 'var(--ink-strong)' }}>
                {weatherLoading ? '—' : weather?.current?.temperature_2m != null ? `${Math.round(weather.current.temperature_2m)}°` : '—'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 3 }}>
                {weather?.current?.wind_speed_10m != null ? `Wind ${Math.round(weather.current.wind_speed_10m)}mph` : '—'}
              </div>
            </div>
          </div>
        </motion.div>
      ) : (
        <motion.div variants={item} style={{ padding: '0 20px 14px' }}>
          <button onClick={pinLocation} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderRadius: 16, background: 'rgba(201,150,58,0.08)', border: '1px solid rgba(201,150,58,0.25)', color: 'var(--field-gold-bright)', fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer' }}>
            <MapPin size={16} />Pin location for weather
          </button>
          {weatherErr && <div style={{ marginTop: 6, fontSize: 11, color: 'var(--alert-red)' }}>{weatherErr}</div>}
        </motion.div>
      )}


      {/* KPI CAROUSEL — phase 18.4: horizontal scroll-snap row instead
          of a 3-col grid. On 375px iPhone the prior grid gave each tile
          ~98px which crammed the K-format numbers. Now each tile is
          fixed at 160px (snaps), tiles can grow as we add more (Won
          YTD, Today's bookings, etc.) without a layout rebuild. */}
      <motion.div variants={item} style={{ padding: '0 0 20px' }}>
        <div
          className="fh-kpi-carousel"
          style={{
            display: 'flex',
            gap: 10,
            overflowX: 'auto',
            scrollSnapType: 'x mandatory',
            scrollPaddingLeft: 20,
            padding: '2px 20px 6px',
            WebkitOverflowScrolling: 'touch'
          }}
        >
          {[
            { label: 'Pipeline', value: pipeline, prefix: '$', format: (n) => n >= 1000 ? `${(n / 1000).toFixed(0)}K` : n.toLocaleString(), icon: TrendingUp, gold: true, to: '/jobs' },
            { label: 'Outstanding', value: outstanding, prefix: '$', format: (n) => n >= 1000 ? `${(n / 1000).toFixed(0)}K` : n.toLocaleString(), icon: Receipt, alert: (outstanding || 0) > 0, to: '/invoices' },
            { label: 'Crews on site', value: activeCount, format: (n) => String(n), icon: Briefcase, to: '/jobs' },
            { label: 'Notes', value: notesCount, format: (n) => String(n), icon: FileText, to: '/notes' }
          ].map((kpi) => {
            const I = kpi.icon
            const isButton = !!kpi.to
            const Tag = isButton ? 'button' : 'div'
            return (
              <Tag
                key={kpi.label}
                onClick={isButton ? () => navigate(kpi.to) : undefined}
                type={isButton ? 'button' : undefined}
                className="fh-card-raised"
                style={{
                  flexShrink: 0,
                  scrollSnapAlign: 'start',
                  width: 160,
                  position: 'relative',
                  overflow: 'hidden',
                  padding: '14px 14px 16px',
                  borderRadius: 14,
                  background: kpi.gold
                    ? 'linear-gradient(135deg, #2a1f10, #1a1208)'
                    : kpi.alert
                      ? 'linear-gradient(135deg, #2a1210, #1a0c08)'
                      : 'var(--surface-2)',
                  border: kpi.gold
                    ? '1px solid rgba(201,150,58,0.5)'
                    : kpi.alert
                      ? '1px solid rgba(192,57,43,0.5)'
                      : '1px solid var(--rule)',
                  minHeight: 86,
                  textAlign: 'left',
                  cursor: isButton ? 'pointer' : 'default',
                  color: 'inherit'
                }}
              >
                <I size={14} style={{ position: 'absolute', top: 12, right: 12, color: kpi.gold ? 'var(--field-gold-bright)' : kpi.alert ? 'var(--alert-red)' : 'rgba(201,150,58,0.4)' }} />
                <div style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>{kpi.label}</div>
                <div
                  className={kpi.gold ? 'fh-money fh-text-gradient-gold' : 'fh-money'}
                  style={{
                    fontFamily: 'var(--font-display)',
                    fontSize: 28,
                    letterSpacing: '0.01em',
                    lineHeight: 1,
                    marginTop: 8,
                    color: kpi.gold ? undefined : kpi.alert && kpi.value > 0 ? 'var(--alert-red)' : 'var(--ink-strong)',
                    minHeight: 28
                  }}
                >
                  {/* While the KPI value is null (still loading) show a
                      subtle skeleton bar instead of "0" — kills the
                      perception bug where the user sees a wrong zero
                      then watches it change a beat later. */}
                  {kpi.value == null ? (
                    <span aria-label="Loading" style={{ display: 'inline-block', width: 64, height: 18, borderRadius: 4, background: 'rgba(255,255,255,0.06)' }} />
                  ) : (
                    <CountUp to={kpi.value} prefix={kpi.prefix || ''} formatter={kpi.format} />
                  )}
                </div>
              </Tag>
            )
          })}
        </div>
      </motion.div>

      {/* TODAY ON SITE */}
      <motion.div variants={item}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '0 20px 12px' }}>
          <h3 style={{ fontFamily: 'var(--font-display)', fontSize: 15, letterSpacing: '0.14em', color: 'var(--ink-strong)', margin: 0 }}>Today on site</h3>
          <button onClick={() => navigate('/jobs')} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, color: 'var(--field-gold-bright)', fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase', background: 'none', border: 'none', cursor: 'pointer' }}>
            All <ChevronRight size={12} />
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 8, padding: '0 20px 14px' }}>
          {/* Loading skeleton — was a flash of "No active jobs yet" while
              the contacts query was still in flight. Now shows two
              shimmer rows during the first paint. */}
          {todayJobs == null ? (
            <>
              <div style={{ height: 60, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--rule)', opacity: 0.6 }} />
              <div style={{ height: 60, borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--rule)', opacity: 0.4 }} />
            </>
          ) : todayJobs.length === 0 ? (
            <div style={{ padding: '24px 20px', borderRadius: 14, background: 'var(--surface-2)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 12 }}>
              No active jobs yet. <button onClick={() => navigate('/jobs?new=1')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--field-gold-bright)', fontWeight: 700, cursor: 'pointer' }}>Add your first lead →</button>
            </div>
          ) : todayJobs.map((job) => {
            const accent = job.stage === 'job' ? 'green' : job.stage === 'quote' ? 'gold' : 'red'
            const accentColors = { green: 'var(--signal-green)', gold: 'var(--field-gold-bright)', red: 'var(--alert-red)' }
            return (
              <motion.button key={job.id} whileTap={{ scale: 0.98 }} onClick={() => navigate(`/jobs/${job.id}`)} style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 14, background: 'var(--surface-2)', border: '1px solid var(--rule)', cursor: 'pointer', textAlign: 'left' }}>
                <span style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, borderRadius: '0 3px 3px 0', background: accentColors[accent], boxShadow: `0 0 12px ${accentColors[accent]}99` }} />
                <div style={{ width: 36, height: 36, borderRadius: 11, display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', fontSize: 15, letterSpacing: '0.04em', background: `linear-gradient(135deg, ${accentColors[accent]}33, ${accentColors[accent]}11)`, color: accentColors[accent], border: `1px solid ${accentColors[accent]}33` }}>
                  {initials(job.name)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: '-0.01em', color: 'var(--ink-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{job.name || 'Untitled'}</div>
                  <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 3 }}>{job.job_type || job.job_title || '—'}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontFamily: 'var(--font-display)', fontSize: 16, letterSpacing: '0.02em', lineHeight: 1, color: 'var(--field-gold-bright)' }}>${(Number(job.amount || 0) / 1000).toFixed(1)}K</div>
                </div>
              </motion.button>
            )
          })}
        </div>
      </motion.div>
    </motion.div>
  )
}
