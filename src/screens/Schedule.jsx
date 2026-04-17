import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { motion } from 'framer-motion'
import Icon from '../components/icons/Icon.jsx'
import ActionSheet, { SheetField, SheetChipRow } from '../components/ActionSheet.jsx'
import EmptyState from '../components/EmptyState.jsx'
import { SkeletonList } from '../components/Skeleton.jsx'
import SpecTabs from '../components/SpecTabs.jsx'
import { supabase } from '../lib/supabase.js'
import { useAuth } from '../contexts/AuthContext.jsx'
import { useProfile } from '../contexts/ProfileContext.jsx'
import { getWeather, workWindow } from '../lib/weather.js'

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
  const [view, setView] = useState('day')
  const [cursor, setCursor] = useState(() => startOfDay(new Date()))
  const [events, setEvents] = useState([])
  const [loading, setLoading] = useState(true)
  const [weather, setWeather] = useState(null)
  const [addOpen, setAddOpen] = useState(false)

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
      .gte('starts_at', range.start.toISOString())
      .lt('starts_at', range.end.toISOString())
      .order('starts_at', { ascending: true })
    setEvents(data || [])
    setLoading(false)
  }, [user, range.start, range.end])

  useEffect(() => { load() }, [load])

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

  return (
    <section className="fh-page">
      <header className="fh-page__head">
        <div>
          <span className="fh-sec-tag">
            <span className="fh-sec-tag__label">Calendar</span>
          </span>
          <h1 className="fh-page__title">Schedule</h1>
        </div>
        <button type="button" className="fh-btn fh-btn--gold" onClick={() => setAddOpen(true)}>
          <Icon name="plus" size={18} />
          <span>New event</span>
        </button>
      </header>

      {hasCoords && (
        <div className={`fh-weatherbar fh-weatherbar--${windowRead.status}`}>
          <span className="fh-weatherbar__dot" />
          <span className="fh-weatherbar__label">{windowRead.label}</span>
          {windowRead.reasons.length > 0 && <span className="fh-weatherbar__reason">{windowRead.reasons.join(' · ')}</span>}
        </div>
      )}

      <div className="fh-sched-bar">
        <SpecTabs
          options={VIEWS}
          value={view}
          onChange={setView}
          ariaLabel="Calendar view"
        />
        <div className="fh-sched-bar__nav">
          <button type="button" className="fh-iconbtn" onClick={() => shift(-1)} aria-label="Previous"><Icon name="chevron" size={16} style={{ transform: 'rotate(180deg)' }} /></button>
          <span className="fh-sched-bar__cur">{view === 'month'
            ? cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
            : view === 'week'
              ? `Week of ${fmtDate(addDays(cursor, -cursor.getDay()))}`
              : fmtDate(cursor)}
          </span>
          <button type="button" className="fh-iconbtn" onClick={() => shift(1)} aria-label="Next"><Icon name="chevron" size={16} /></button>
          <button type="button" className="fh-btn fh-btn--ghost" onClick={() => setCursor(startOfDay(new Date()))}>Today</button>
        </div>
      </div>

      {loading && <SkeletonList rows={5} card={false} />}

      {!loading && view === 'day' && <DayView events={events} onClick={(id) => navigate(`/jobs/${id}`)} onAdd={() => setAddOpen(true)} />}
      {!loading && view === 'week' && <WeekView start={addDays(cursor, -cursor.getDay())} events={events} onClick={(id) => navigate(`/jobs/${id}`)} />}
      {!loading && view === 'month' && <MonthView cursor={cursor} events={events} onDay={(d) => { setCursor(d); setView('day') }} />}

      <AddEventSheet
        open={addOpen}
        userId={user?.id}
        onClose={() => setAddOpen(false)}
        onSaved={() => { setAddOpen(false); load() }}
      />
    </section>
  )
}

function DayView({ events, onClick, onAdd }) {
  if (events.length === 0) {
    return (
      <EmptyState
        icon="calendar"
        code="DAY · CLEAR"
        title="Nothing scheduled."
        sub="Queue something up. Crew runs smoother when the day's on the board."
        action={onAdd ? 'Add event' : undefined}
        onAction={onAdd}
      />
    )
  }
  return (
    <ul className="fh-timeline">
      {events.map((e, i) => (
        <motion.li
          key={e.id}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: Math.min(i * 0.03, 0.2) }}
          className="fh-tl-item"
          onClick={() => e.contact_id && onClick(e.contact_id)}
          role={e.contact_id ? 'button' : undefined}
        >
          <span className="fh-tl-item__time">{fmtTime(e.starts_at)}</span>
          <span className="fh-tl-item__body">
            <span className="fh-tl-item__title">{e.title}</span>
            {e.fh_contacts?.name && <span className="fh-tl-item__sub">{e.fh_contacts.name}</span>}
          </span>
        </motion.li>
      ))}
    </ul>
  )
}

function WeekView({ start, events, onClick }) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(start, i))
  return (
    <div className="fh-week">
      {days.map((d) => {
        const dayEvents = events.filter((e) => sameDay(new Date(e.starts_at), d))
        return (
          <div key={d.toISOString()} className="fh-week__col">
            <header className="fh-week__head">
              <span className="fh-week__dow">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
              <span className="fh-week__num">{d.getDate()}</span>
            </header>
            <div className="fh-week__body">
              {dayEvents.length === 0 && <span className="fh-week__empty">—</span>}
              {dayEvents.map((e) => (
                <button key={e.id} type="button" className="fh-week__evt" onClick={() => e.contact_id && onClick(e.contact_id)}>
                  <span>{fmtTime(e.starts_at)}</span>
                  <strong>{e.title}</strong>
                </button>
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
        const dayEvents = events.filter((e) => sameDay(new Date(e.starts_at), d))
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

function AddEventSheet({ open, userId, onClose, onSaved }) {
  const [title, setTitle] = useState('')
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10))
  const [time, setTime] = useState('08:00')
  const [contactId, setContactId] = useState('')
  const [contacts, setContacts] = useState([])
  const [recurs, setRecurs] = useState(false)
  const [recurDays, setRecurDays] = useState(7)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!userId) return
    supabase.from('fh_contacts').select('id, name').eq('user_id', userId).then(({ data }) => setContacts(data || []))
  }, [userId])

  useEffect(() => {
    if (!open) {
      setTitle(''); setContactId(''); setRecurs(false); setRecurDays(7)
      setDate(new Date().toISOString().slice(0, 10))
      setTime('08:00')
    }
  }, [open])

  const step = title ? (contactId ? 3 : 2) : 1

  async function save() {
    if (!title.trim()) return
    setSaving(true)
    const starts = new Date(`${date}T${time}:00`).toISOString()
    const rows = [{ user_id: userId, contact_id: contactId || null, title: title.trim(), starts_at: starts }]
    if (recurs) {
      for (let i = 1; i <= 4; i++) {
        const next = new Date(starts)
        next.setDate(next.getDate() + recurDays * i)
        rows.push({ user_id: userId, contact_id: contactId || null, title: title.trim(), starts_at: next.toISOString() })
      }
    }
    await supabase.from('fh_schedule').insert(rows)
    setSaving(false)
    onSaved()
  }

  return (
    <ActionSheet
      open={open}
      title="New event on the board."
      accentWord="event"
      sectionLabel="New event"
      stepCount={3}
      currentStep={step}
      commitLabel={saving ? 'Committing…' : 'Commit event'}
      commitBusy={saving}
      commitDisabled={!title.trim()}
      onClose={onClose}
      onCommit={save}
    >
      <SheetField label="Title" code="01·TTL">
        <input
          autoFocus
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder="Pour foundation, inspection…"
        />
      </SheetField>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4)' }}>
        <SheetField label="Date" code="02·DAT">
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </SheetField>
        <SheetField label="Time" code="03·TIM">
          <input type="time" value={time} onChange={(e) => setTime(e.target.value)} />
        </SheetField>
      </div>
      <SheetField label="Link to job" code="04·JOB">
        <select value={contactId} onChange={(e) => setContactId(e.target.value)} className="fh-asheet-select">
          <option value="">None</option>
          {contacts.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </SheetField>
      <SheetChipRow
        label="Recurrence"
        code="05·RPT"
        value={recurs ? 'yes' : 'no'}
        options={[{ value: 'no', label: 'One-time' }, { value: 'yes', label: `Every ${recurDays} days × 4` }]}
        onChange={(v) => setRecurs(v === 'yes')}
      />
      {recurs && (
        <SheetField label="Repeat every (days)" code="06·GAP">
          <input type="number" min={1} value={recurDays} onChange={(e) => setRecurDays(Number(e.target.value) || 7)} />
        </SheetField>
      )}
    </ActionSheet>
  )
}
