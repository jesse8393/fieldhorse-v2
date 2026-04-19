import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Bell, MapPin, CloudSun, TrendingUp, Briefcase, FileText, ChevronRight } from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { supabase } from '../lib/supabase.js'
import { getWeather, workWindow } from '../lib/weather.js'
import Spotlight from '../components/fx/Spotlight.jsx'
import ShimmerBar from '../components/fx/ShimmerBar.jsx'
import GreetingTitle from '../components/fx/GreetingTitle.jsx'
import CountUp from '../components/fx/CountUp.jsx'

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
  const full = profile?.full_name?.trim()
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
  const [pipeline, setPipeline] = useState(0)
  const [activeCount, setActiveCount] = useState(0)
  const [notesCount, setNotesCount] = useState(0)
  const [todayJobs, setTodayJobs] = useState([])
  const [weeklyTarget] = useState(25000)
  const [weeklyBooked, setWeeklyBooked] = useState(0)

  const hasCoords = profile?.location_lat != null && profile?.location_lon != null
  const displayName = displayNameFrom(profile, user)
  const firstName = displayName ? displayName.split(/\s+/)[0] : 'there'
  const avatarInitials = displayName
    ? displayName.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0].toUpperCase()).join('')
    : emailFirstToken(user?.email).slice(0, 1) || '—'

  useEffect(() => {
    let cancelled = false
    if (!hasCoords) { setWeather(null); return }
    setWeatherLoading(true); setWeatherErr('')
    getWeather(profile.location_lat, profile.location_lon)
      .then((d) => { if (!cancelled) setWeather(d) })
      .catch((e) => { if (!cancelled) setWeatherErr(e.message || 'Forecast unavailable') })
      .finally(() => { if (!cancelled) setWeatherLoading(false) })
    return () => { cancelled = true }
  }, [profile?.location_lat, profile?.location_lon, hasCoords])

  const windowRead = useMemo(
    () => workWindow(weather?.current, profile?.services || []),
    [weather, profile?.services]
  )

  useEffect(() => {
    if (!user) return
    let cancelled = false
    async function load() {
      const { data: contacts } = await supabase
        .from('fh_contacts')
        .select('id, name, amount, stage, job_title, job_type')
        .eq('user_id', user.id)
      if (cancelled) return
      const rows = contacts || []
      // "N crews on site" should only count approved work — quotes aren't a
      // crew on site yet. Job + invoice (check hasn't cleared) = active work.
      const active = rows.filter((c) => ['job', 'invoice'].includes(c.stage))
      const totalPipeline = rows
        .filter((c) => c.stage !== 'closed' && c.stage !== 'lost')
        .reduce((s, c) => s + Number(c.amount || 0), 0)
      const booked = rows
        .filter((c) => c.stage === 'invoice' || c.stage === 'closed')
        .reduce((s, c) => s + Number(c.amount || 0), 0)
      setPipeline(totalPipeline)
      setActiveCount(active.length)
      setWeeklyBooked(booked)
      setTodayJobs(active.slice(0, 3))
      const { count } = await supabase
        .from('fh_notes')
        .select('id', { count: 'exact', head: true })
        .eq('user_id', user.id)
        .eq('done', false)
      if (!cancelled) setNotesCount(count || 0)
    }
    load()
    return () => { cancelled = true }
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

  const targetPct = weeklyTarget > 0 ? Math.min(100, Math.round((weeklyBooked / weeklyTarget) * 100)) : 0
  const pourStatus = windowRead?.status || (weather ? 'ok' : '—')
  const pourGood = String(pourStatus).toLowerCase().includes('good') || String(pourStatus).toLowerCase().includes('ok')

  const stagger = { hidden: { opacity: 0 }, show: { opacity: 1, transition: { staggerChildren: 0.08, delayChildren: 0.1 } } }
  const item = { hidden: { opacity: 0, y: 12 }, show: { opacity: 1, y: 0, transition: { type: 'spring', stiffness: 200, damping: 24 } } }

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* TOP BAR */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 20px 0' }}>
        <div style={{ width: 40, height: 40, borderRadius: '50%', background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))', padding: 2 }}>
          <div style={{ width: '100%', height: '100%', borderRadius: '50%', background: 'var(--surface-1)', display: 'grid', placeItems: 'center', fontFamily: 'var(--font-display)', color: 'var(--field-gold-bright)', fontSize: 14, letterSpacing: '0.05em' }}>
            {avatarInitials}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ fontFamily: 'var(--font-display)', fontSize: 18, letterSpacing: '0.14em' }}>
            <span style={{ color: 'var(--field-gold)' }}>FIELD</span>
            <span style={{ color: 'var(--ink-strong)' }}>HORSE</span>
          </span>
          <span className="fh-fx-pulse-dot" style={{ width: 6, height: 6, borderRadius: '50%', background: 'var(--signal-green)', boxShadow: '0 0 0 3px rgba(45,122,79,0.2), 0 0 8px var(--signal-green)' }} />
        </div>
        <button
          type="button"
          aria-label={notesCount > 0 ? `Notifications — ${notesCount} open note${notesCount === 1 ? '' : 's'}` : 'Notifications'}
          onClick={() => navigate('/notes')}
          style={{ width: 40, height: 40, borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', display: 'grid', placeItems: 'center', position: 'relative', color: 'var(--ink-strong)', cursor: 'pointer' }}
        >
          <Bell size={18} />
          {notesCount > 0 && <span style={{ position: 'absolute', top: 8, right: 8, width: 7, height: 7, borderRadius: '50%', background: 'var(--alert-red)', boxShadow: '0 0 0 2px var(--surface-0)' }} />}
        </button>
      </motion.div>

      {/* HERO GREETING */}
      <motion.div variants={item} style={{ padding: '24px 20px 16px' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, padding: '5px 12px', borderRadius: 999, background: 'rgba(201,150,58,0.1)', border: '1px solid rgba(201,150,58,0.2)', fontSize: 10, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: 'var(--field-gold-bright)', marginBottom: 14 }}>
          <span style={{ width: 4, height: 4, borderRadius: '50%', background: 'var(--field-gold-bright)' }} />
          {formatDate(now)}
        </div>
        <GreetingTitle prefix={greetingPrefix()} name={firstName} />
        <div style={{ marginTop: 8, fontSize: 13, color: 'var(--ink-muted)' }}>
          {activeCount > 0
            ? <>{activeCount} {activeCount === 1 ? 'crew' : 'crews'} on site. <span style={{ color: 'var(--signal-green)', fontWeight: 600 }}>All green.</span></>
            : 'Nothing active. Quiet day.'}
        </div>
        <div style={{ marginTop: 6 }}>
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
              placeholder="Add today's focus"
              style={{ width: '100%', maxWidth: 360, padding: '8px 10px', borderRadius: 10, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontSize: 13, fontFamily: 'var(--font-body)', resize: 'none', outline: 'none' }}
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingFocus(true)}
              aria-label="Edit today's focus"
              style={{ background: 'none', border: 'none', padding: 0, color: profile?.greeting ? 'var(--ink-strong)' : 'var(--ink-faint)', fontSize: 13, fontFamily: 'var(--font-body)', cursor: 'text', textAlign: 'left' }}
            >
              {profile?.greeting || "Add today's focus →"}
            </button>
          )}
        </div>
      </motion.div>

      {/* WEEKLY TARGET CARD */}
      <motion.div variants={item} style={{ position: 'relative', margin: '0 20px 14px', padding: '18px 20px', borderRadius: 22, background: 'linear-gradient(135deg, rgba(30,20,10,0.8), rgba(20,20,20,0.6))', border: '1px solid rgba(201,150,58,0.2)', backdropFilter: 'blur(20px)', overflow: 'hidden' }}>
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
        <div style={{ fontFamily: 'var(--font-display)', fontSize: 52, lineHeight: 1, letterSpacing: '0.01em', color: 'var(--ink-strong)', position: 'relative' }}>
          <span style={{ fontSize: 26, color: 'var(--ink-muted)', verticalAlign: 'top', marginRight: 2 }}>$</span>
          <CountUp to={weeklyBooked} />
        </div>
        <div style={{ marginTop: 14, position: 'relative' }}>
          <ShimmerBar value={targetPct} />
          <div style={{ marginTop: 8, display: 'flex', justifyContent: 'space-between', fontSize: 10, color: 'var(--ink-muted)' }}>
            <span><span style={{ color: 'var(--field-gold-bright)', fontWeight: 700 }}>{targetPct}%</span> of ${(weeklyTarget / 1000).toFixed(0)}K</span>
            <span>{pipeline > 0 ? `$${(pipeline / 1000).toFixed(0)}K in pipeline` : '—'}</span>
          </div>
        </div>
      </motion.div>

      {/* WEATHER + POUR */}
      {hasCoords ? (
        <motion.div variants={item} style={{ display: 'grid', gridTemplateColumns: '1.4fr 1fr', gap: 10, padding: '0 20px 14px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '13px 15px', borderRadius: 16, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)', backdropFilter: 'blur(20px)' }}>
            <div style={{ width: 36, height: 36, borderRadius: 11, background: 'linear-gradient(135deg, #2d3f54, #1a2535)', display: 'grid', placeItems: 'center' }}>
              <CloudSun size={18} color="#8fb4e3" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: '0.02em', lineHeight: 1 }}>
                {weatherLoading ? '—' : weather?.current?.temperature_2m != null ? `${Math.round(weather.current.temperature_2m)}°` : '—'}
              </div>
              <div style={{ fontSize: 10, color: 'var(--ink-muted)', marginTop: 3 }}>
                {weather?.current?.wind_speed_10m != null ? `Wind ${Math.round(weather.current.wind_speed_10m)}mph` : '—'}
              </div>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: '13px 15px', borderRadius: 16, background: pourGood ? 'linear-gradient(135deg, rgba(45,122,79,0.2), rgba(45,122,79,0.06))' : 'linear-gradient(135deg, rgba(192,57,43,0.2), rgba(192,57,43,0.06))', border: pourGood ? '1px solid rgba(78,214,147,0.25)' : '1px solid rgba(192,57,43,0.25)' }}>
            <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', color: pourGood ? 'var(--signal-green)' : 'var(--alert-red)' }}>Pour</div>
            <div style={{ fontFamily: 'var(--font-display)', fontSize: 20, letterSpacing: '0.03em', lineHeight: 1, marginTop: 3, color: pourGood ? 'var(--signal-green)' : 'var(--alert-red)' }}>{String(pourStatus).toUpperCase()}</div>
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

      {/* KPI ROW */}
      <motion.div variants={item} style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8, padding: '0 20px 20px' }}>
        {[
          { label: 'Pipeline', value: pipeline, prefix: '$', format: (n) => n >= 1000 ? `${(n / 1000).toFixed(0)}K` : n.toLocaleString(), icon: TrendingUp },
          { label: 'Active', value: activeCount, format: (n) => String(n).padStart(2, '0'), icon: Briefcase },
          { label: 'Notes', value: notesCount, format: (n) => String(n).padStart(2, '0'), icon: FileText }
        ].map((kpi) => {
          const I = kpi.icon
          return (
            <div key={kpi.label} style={{ position: 'relative', overflow: 'hidden', padding: '12px 13px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px solid var(--rule)' }}>
              <I size={14} style={{ position: 'absolute', top: 10, right: 10, color: 'rgba(201,150,58,0.4)' }} />
              <div style={{ fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>{kpi.label}</div>
              <div style={{ fontFamily: 'var(--font-display)', fontSize: 24, letterSpacing: '0.02em', lineHeight: 1, marginTop: 5 }}>
                <CountUp to={kpi.value} prefix={kpi.prefix || ''} formatter={kpi.format} />
              </div>
            </div>
          )
        })}
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
          {todayJobs.length === 0 ? (
            <div style={{ padding: '24px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontSize: 12 }}>
              No active jobs yet. <button onClick={() => navigate('/jobs?new=1')} style={{ background: 'none', border: 'none', padding: 0, color: 'var(--field-gold-bright)', fontWeight: 700, cursor: 'pointer' }}>Add your first lead →</button>
            </div>
          ) : todayJobs.map((job) => {
            const accent = job.stage === 'job' ? 'green' : job.stage === 'quote' ? 'gold' : 'red'
            const accentColors = { green: 'var(--signal-green)', gold: 'var(--field-gold-bright)', red: 'var(--alert-red)' }
            return (
              <motion.button key={job.id} whileTap={{ scale: 0.98 }} onClick={() => navigate(`/jobs/${job.id}`)} style={{ position: 'relative', overflow: 'hidden', display: 'flex', alignItems: 'center', gap: 12, padding: '13px 14px', borderRadius: 14, background: 'linear-gradient(135deg, rgba(255,255,255,0.04), rgba(255,255,255,0.02))', border: '1px solid var(--rule)', backdropFilter: 'blur(20px)', cursor: 'pointer', textAlign: 'left' }}>
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
