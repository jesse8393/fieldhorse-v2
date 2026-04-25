import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { motion } from 'framer-motion'
import { Plus, Calendar as CalendarIcon, Clock, MapPin, ChevronLeft, ChevronRight, Trash2 } from 'lucide-react'
import { toast, toastSuccess } from '../lib/toast.js'
import ActionSheet, { SheetField, SheetChipRow } from '../components/ActionSheet.jsx'
import AddEventSheet from '../components/AddEventSheet.jsx'
import { SkeletonList } from '../components/Skeleton.jsx'
import SpecTabs from '../components/SpecTabs.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { getWeather, workWindow } from '../lib/weather.js'
import { hapticTap, hapticMedium } from '../lib/haptics.js'
import { useFhMotion } from '../lib/motion.js'

const VIEWS = [
  { value: 'day', label: 'Day' },
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' }
]

function startOfDay(d) { const x = new Date(d); x.setHours(0,0,0,0); return x }
function addDays(d, n) { const x = new Date(d); x.setDate(x.getDate() + n); return x }
function sameDay(a, b) { return a.toDateString() === b.toDateString() }
function fmtDate(d) { return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) }
function fmtTime(iso) { return iso ? new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' }) : '' }

export default function Schedule() {
  const { user } = useAuth()
  const { profile } = useProfile()
  const navigate = useNavigate()
  const [params, setParams] = useSearchParams()
  const initialCursor = (() => {
    const d = params.get('d')
    if (d && /^\d{4}-\d{2}-\d{2}$/.test(d)) {
      const [y, m, day] = d.split('-').map(Number)
      return startOfDay(new Date(y, m - 1, day))
    }
    return startOfDay(new Date())
  })()
  const [view, setView] = useState('day')
  const [cursor, setCursor] = useState(initialCursor)
  const [events, setEvents] = useState([])
  const [upcoming, setUpcoming] = useState([])
  const [loading, setLoading] = useState(true)
  const [weather, setWeather] = useState(null)
  const [addOpen, setAddOpen] = useState(false)

  // If the URL had ?d=YYYY-MM-DD, consume it once so the back button
  // doesn't keep forcing the cursor back to that day.
  useEffect(() => {
    if (params.get('d')) {
      const next = new URLSearchParams(params)
      next.delete('d')
      setParams(next, { replace: true })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  async function deleteEvent(evtId) {
    if (!evtId) return
    const { error } = await supabase.from('fh_schedule').delete().eq('id', evtId)
    if (error) {
      toast({ kind: 'error', title: "Couldn't delete", body: error.message })
      return
    }
    toastSuccess('Event deleted', 'Schedule updated')
    load()
    loadUpcoming()
  }

  const hasCoords = profile?.location_lat != null && profile?.location_lon != null

  const range = useMemo(() => {
    if (view === 'day') return { start: cursor, end: addDays(cursor, 1) }
    if (view === 'week') {
      const s = addDays(cursor, -cursor.getDay())
      return { start: s, end: addDays(s, 7) }
    }
    const s = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const e = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 1)
    return { start: s, end: e }
  }, [view, cursor])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    const { data } = await supabase
      .from('fh_schedule')
      .select('*, fh_contacts(name, stage)')
      .eq('user_id', user.id)
      .gte('start_at', range.start.toISOString())
      .lt('start_at', range.end.toISOString())
      .order('start_at', { ascending: true })
    setEvents(data || [])
    setLoading(false)
  }, [user, range.start, range.end])

  const loadUpcoming = useCallback(async () => {
    if (!user) return
    const now = new Date()
    const in7 = addDays(startOfDay(now), 7)
    const { data } = await supabase
      .from('fh_schedule')
      .select('*, fh_contacts(name, stage)')
      .eq('user_id', user.id)
      .gte('start_at', now.toISOString())
      .lt('start_at', in7.toISOString())
      .order('start_at', { ascending: true })
      .limit(8)
    setUpcoming(data || [])
  }, [user])

  useEffect(() => { load() }, [load])
  useEffect(() => { loadUpcoming() }, [loadUpcoming, addOpen])

  useEffect(() => {
    if (!hasCoords) return
    getWeather(profile.location_lat, profile.location_lon).then(setWeather).catch(() => {})
  }, [hasCoords, profile?.location_lat, profile?.location_lon])

  function shift(n) {
    if (view === 'day') setCursor((d) => addDays(d, n))
    else if (view === 'week') setCursor((d) => addDays(d, 7 * n))
    else setCursor((d) => new Date(d.getFullYear(), d.getMonth() + n, 1))
  }

  const windowRead = useMemo(
    () => workWindow(weather?.current, profile?.services || []),
    [weather, profile?.services]
  )

  const { stagger, item } = useFhMotion()

  return (
    <motion.div className="fh-screen" variants={stagger} initial="hidden" animate="show" style={{ paddingBottom: 120, position: 'relative' }}>
      {/* HEADER */}
      <motion.div variants={item} style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12, padding: '10px 20px 6px' }}>
        <div style={{ minWidth: 0, flex: 1 }}>
          <span style={{ fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--field-gold-bright)' }}>
            Calendar
          </span>
          <h1 className="fh-font-serif" style={{ margin: '4px 0 0', fontSize: 'clamp(22px, 6vw, 30px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, color: 'var(--ink-strong)' }}>
            Run the{' '}
            day.
          </h1>
        </div>
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={() => { hapticMedium(); setAddOpen(true) }}
          aria-label="New event"
          style={{
            flexShrink: 0,
            width: 44,
            height: 44,
            borderRadius: 14,
            border: 'none',
            background: 'linear-gradient(135deg, var(--field-gold-bright), var(--field-gold-deep))',
            color: 'var(--onyx)',
            cursor: 'pointer',
            display: 'grid',
            placeItems: 'center',
            boxShadow: '0 8px 20px rgba(201,150,58,0.35)'
          }}
        >
          <Plus size={20} strokeWidth={2.5} />
        </motion.button>
      </motion.div>

      {/* WEATHER STRIP */}
      {hasCoords && (
        <motion.div variants={item} className={`fh-weatherbar fh-weatherbar--${windowRead.status}`} style={{ margin: '10px 20px 0' }}>
          <span className="fh-weatherbar__dot" />
          <span className="fh-weatherbar__label">{windowRead.label}</span>
          {windowRead.reasons.length > 0 && <span className="fh-weatherbar__reason">{windowRead.reasons.join(' · ')}</span>}
        </motion.div>
      )}

      {/* UPCOMING LANE */}
      {upcoming.length > 0 && (
        <motion.section variants={item} style={{ padding: '14px 20px 0' }}>
          <header style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--ink-muted)' }}>
              <CalendarIcon size={12} />
              Upcoming · 7 days
            </span>
            <span style={{ padding: '2px 9px', borderRadius: 999, background: 'rgba(201,150,58,0.14)', border: '1px solid rgba(201,150,58,0.3)', color: 'var(--field-gold-bright)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em' }}>
              {upcoming.length}
            </span>
          </header>
          <div style={{ display: 'flex', gap: 8, overflowX: 'auto', paddingBottom: 6, WebkitOverflowScrolling: 'touch' }}>
            {upcoming.map((e, i) => {
              const fromQuote = Boolean(e.contact_id && e.fh_contacts?.name)
              const accent = fromQuote ? 'var(--field-gold-bright)' : 'var(--steel)'
              return (
                <motion.button
                  key={e.id}
                  type="button"
                  initial={{ opacity: 0, x: 12 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: Math.min(i * 0.04, 0.24), duration: 0.26, ease: [0.2, 0.8, 0.2, 1] }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => e.contact_id && navigate(`/jobs/${e.contact_id}`)}
                  style={{
                    flexShrink: 0,
                    position: 'relative',
                    width: 180,
                    padding: '12px 14px',
                    borderRadius: 14,
                    background: 'rgba(255,255,255,0.04)',
                    border: `1px solid ${fromQuote ? 'rgba(201,150,58,0.35)' : 'var(--rule)'}`,
                    color: 'var(--ink-strong)',
                    cursor: e.contact_id ? 'pointer' : 'default',
                    textAlign: 'left'
                  }}
                >
                  <span style={{ position: 'absolute', left: 0, top: 12, bottom: 12, width: 3, borderRadius: '0 3px 3px 0', background: accent, boxShadow: `0 0 8px ${accent}66` }} />
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--ink-muted)', marginBottom: 4 }}>
                    <CalendarIcon size={11} />
                    {new Date(e.start_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                    <span aria-hidden="true">·</span>
                    <Clock size={11} />
                    {fmtTime(e.start_at)}
                  </div>
                  <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                    {e.title || 'Untitled'}
                  </div>
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 4, fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: fromQuote ? 'var(--field-gold-bright)' : 'var(--ink-faint)' }}>
                    {fromQuote ? <MapPin size={10} /> : null}
                    {fromQuote ? `From quote · ${e.fh_contacts.name}` : 'Manual event'}
                  </div>
                </motion.button>
              )
            })}
          </div>
        </motion.section>
      )}

      {/* VIEW TABS + NAV */}
      <motion.div variants={item} style={{ padding: '14px 20px 10px', display: 'flex', flexDirection: 'column', gap: 10 }}>
        <SpecTabs
          options={VIEWS}
          value={view}
          onChange={setView}
          ariaLabel="Calendar view"
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => shift(-1)} aria-label="Previous" style={iconBtnStyle}>
            <ChevronLeft size={16} />
          </button>
          <span style={{ flex: 1, fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, color: 'var(--ink-strong)', textAlign: 'center' }}>
            {view === 'month'
              ? cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
              : view === 'week'
                ? `Week of ${fmtDate(addDays(cursor, -cursor.getDay()))}`
                : fmtDate(cursor)}
          </span>
          <button type="button" onClick={() => shift(1)} aria-label="Next" style={iconBtnStyle}>
            <ChevronRight size={16} />
          </button>
          <button
            type="button"
            onClick={() => setCursor(startOfDay(new Date()))}
            style={{ padding: '8px 14px', borderRadius: 10, border: '1px solid var(--rule)', background: 'rgba(255,255,255,0.04)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
          >
            Today
          </button>
        </div>
      </motion.div>

      <motion.div variants={item} style={{ padding: '0 20px 20px' }}>
        {loading && <SkeletonList rows={5} card={false} />}
        {!loading && view === 'day' && <DayView events={events} onClick={(id) => navigate(`/jobs/${id}`)} onDelete={deleteEvent} onAdd={() => setAddOpen(true)} />}
        {!loading && view === 'week' && <WeekView start={addDays(cursor, -cursor.getDay())} events={events} onClick={(id) => navigate(`/jobs/${id}`)} onDelete={deleteEvent} />}
        {!loading && view === 'month' && <MonthView cursor={cursor} events={events} onDay={(d) => { setCursor(d); setView('day') }} />}
      </motion.div>

      <AddEventSheet
        open={addOpen}
        userId={user?.id}
        onClose={() => setAddOpen(false)}
        onSaved={() => { setAddOpen(false); load() }}
      />
    </motion.div>
  )
}

const iconBtnStyle = {
  width: 36,
  height: 36,
  borderRadius: 10,
  border: '1px solid var(--rule)',
  background: 'rgba(255,255,255,0.04)',
  color: 'var(--ink-strong)',
  display: 'grid',
  placeItems: 'center',
  cursor: 'pointer'
}

function DayView({ events, onClick, onDelete, onAdd }) {
  if (events.length === 0) {
    return (
      <div style={{ padding: '32px 20px', borderRadius: 14, background: 'rgba(255,255,255,0.03)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)', marginBottom: 4 }}>Nothing scheduled.</div>
        <div style={{ fontSize: 12, marginBottom: 10 }}>Queue something up. Crew runs smoother when the day's on the board.</div>
        {onAdd && (
          <button
            type="button"
            onClick={onAdd}
            style={{ background: 'none', border: 'none', padding: 0, color: 'var(--field-gold-bright)', fontWeight: 700, fontSize: 12, cursor: 'pointer' }}
          >
            Add event →
          </button>
        )}
      </div>
    )
  }
  return (
    <ul className="fh-timeline" style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
      {events.map((e, i) => (
        <motion.li
          key={e.id}
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.04, 0.25), duration: 0.24, ease: [0.2, 0.8, 0.2, 1] }}
          style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '11px 12px', borderRadius: 12, background: 'rgba(255,255,255,0.04)', border: '1px solid var(--rule)' }}
        >
          <span style={{ flexShrink: 0, width: 62, fontFamily: 'var(--font-display)', fontSize: 13, letterSpacing: '0.04em', color: 'var(--field-gold-bright)' }}>
            {fmtTime(e.start_at)}
          </span>
          <button
            type="button"
            onClick={() => e.contact_id && onClick(e.contact_id)}
            style={{ flex: 1, minWidth: 0, background: 'transparent', border: 'none', padding: 0, textAlign: 'left', cursor: e.contact_id ? 'pointer' : 'default', color: 'var(--ink-strong)' }}
          >
            <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: 'var(--ink-strong)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
              {e.title || 'Untitled'}
            </div>
            {e.fh_contacts?.name && (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 5, marginTop: 3, padding: '2px 8px', borderRadius: 999, background: 'rgba(201,150,58,0.12)', border: '1px solid rgba(201,150,58,0.3)', color: 'var(--field-gold-bright)', fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                <MapPin size={9} />
                {e.fh_contacts.name}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={(ev) => { ev.stopPropagation(); if (onDelete && window.confirm('Delete this event?')) onDelete(e.id) }}
            aria-label="Delete event"
            style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 8, border: 'none', background: 'transparent', color: 'var(--ink-faint)', cursor: 'pointer', display: 'grid', placeItems: 'center', opacity: 0.7 }}
            onMouseEnter={(ev) => { ev.currentTarget.style.opacity = '1'; ev.currentTarget.style.color = 'var(--alert-red)' }}
            onMouseLeave={(ev) => { ev.currentTarget.style.opacity = '0.7'; ev.currentTarget.style.color = 'var(--ink-faint)' }}
          >
            <Trash2 size={14} />
          </button>
        </motion.li>
      ))}
    </ul>
  )
}

function WeekView({ start, events, onClick, onDelete }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return (
    <div className="fh-week">
      {days.map((d) => {
        const dayEvents = events.filter((e) => sameDay(new Date(e.start_at), d))
        return (
          <div key={d.toISOString()} className="fh-week__col">
            <header className="fh-week__head">
              <span className="fh-week__dow">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="fh-week__num">{d.getDate()}</span>
            </header>
            <div className="fh-week__body">
              {dayEvents.length === 0 && <span className="fh-week__empty">—</span>}
              {dayEvents.map((e) => (
                <div key={e.id} className="fh-week__evt" style={{ position: 'relative' }}>
                  <button type="button" onClick={() => e.contact_id && onClick(e.contact_id)} style={{ background: 'transparent', border: 'none', padding: 0, textAlign: 'left', width: '100%', cursor: e.contact_id ? 'pointer' : 'default', color: 'inherit', font: 'inherit' }}>
                    <span>{fmtTime(e.start_at)}</span>
                    <strong>{e.title}</strong>
                  </button>
                  {onDelete && (
                    <button
                      type="button"
                      onClick={(ev) => { ev.stopPropagation(); if (window.confirm('Delete this event?')) onDelete(e.id) }}
                      aria-label="Delete event"
                      style={{ position: 'absolute', top: 2, right: 2, width: 22, height: 22, borderRadius: 6, border: 'none', background: 'transparent', color: 'var(--ink-faint)', cursor: 'pointer', display: 'grid', placeItems: 'center', opacity: 0.6 }}
                    >
                      <Trash2 size={11} />
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )
      })}
    </div>
  )
}

function MonthView({ cursor, events, onDay }) {
  const first = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
  const offset = first.getDay()
  const days = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0).getDate()
  const cells = []
  for (let i = 0; i < offset; i++) cells.push(null)
  for (let d = 1; d <= days; d++) cells.push(new Date(cursor.getFullYear(), cursor.getMonth(), d))
  while (cells.length % 7 !== 0) cells.push(null)

  return (
    <div className="fh-month">
      {['S','M','T','W','T','F','S'].map((d, i) => <span key={i} className="fh-month__dow">{d}</span>)}
      {cells.map((d, i) => {
        if (!d) return <div key={i} className="fh-month__cell fh-month__cell--empty" />
        const dayEvents = events.filter((e) => sameDay(new Date(e.start_at), d))
        return (
          <button key={i} type="button" className={`fh-month__cell${dayEvents.length ? ' has-events' : ''}`} onClick={() => onDay(d)}>
            <span className="fh-month__num">{d.getDate()}</span>
            {dayEvents.length > 0 && <span className="fh-month__count">{dayEvents.length}</span>}
          </button>
        )
      })}
    </div>
  )
}

