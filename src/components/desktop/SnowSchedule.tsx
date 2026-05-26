// SnowSchedule — desktop /schedule in the Snow direction.
//
// Drop-in for DesktopScheduleWorkspace. Agenda-first composition:
//
//   [Header: eyebrow + Schedule + view picker + + Event]
//   [KPI row: This week · Today · Tomorrow · Next 7 days]
//   [Date range strip with prev/next chevrons + Today button]
//   [Day cards stacked: weekday + date + event rows]
//
// View picker switches the cursor's range (day/week/month). Each event
// row shows time + title + contact chip. Click → opens the event sheet
// (parent handles).

import { useMemo } from 'react'
import { ChevronLeft, ChevronRight, Plus, Calendar as CalIcon, MapPin } from 'lucide-react'

type Event = {
  id: string
  title?: string | null
  description?: string | null
  start_at: string | null
  end_at?: string | null
  contact_id?: string | null
  location?: string | null
}

type Props = {
  events: Event[] | null
  upcoming: Event[] | null
  loading: boolean
  cursor: Date
  setCursor: (d: Date | ((prev: Date) => Date)) => void
  view: 'day' | 'week' | 'month' | string
  setView: (v: string) => void
  onAddEvent: () => void
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + n)
  return out
}
function startOfWeek(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  x.setDate(x.getDate() - x.getDay())
  return x
}
function startOfDay(d: Date): Date {
  const x = new Date(d)
  x.setHours(0, 0, 0, 0)
  return x
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate()
}
function fmtTime(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
}
function fmtDayLabel(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'short', day: 'numeric' })
}
function fmtRangeLabel(view: string, cursor: Date): string {
  if (view === 'day') return fmtDayLabel(cursor)
  if (view === 'week') {
    const s = startOfWeek(cursor)
    const e = addDays(s, 6)
    const sStr = s.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
    const eStr = e.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    return `${sStr} to ${eStr}`
  }
  return cursor.toLocaleDateString(undefined, { month: 'long', year: 'numeric' })
}

export default function SnowSchedule(props: Props) {
  const { events, upcoming, loading, cursor, setCursor, view, setView, onAddEvent } = props

  function step(direction: number) {
    if (view === 'day') setCursor((d: Date) => addDays(d, direction))
    else if (view === 'week') setCursor((d: Date) => addDays(d, direction * 7))
    else {
      setCursor((d: Date) => {
        const x = new Date(d)
        x.setMonth(x.getMonth() + direction)
        return x
      })
    }
  }

  function jumpToday() {
    setCursor(new Date())
  }

  // Group events by day for the agenda
  const daysToShow = useMemo(() => {
    if (view === 'day') return [startOfDay(cursor)]
    if (view === 'week') {
      const s = startOfWeek(cursor)
      return Array.from({ length: 7 }, (_, i) => addDays(s, i))
    }
    // month — show every day that has at least one event, in order
    const m: Date[] = []
    const monthStart = new Date(cursor.getFullYear(), cursor.getMonth(), 1)
    const monthEnd = new Date(cursor.getFullYear(), cursor.getMonth() + 1, 0)
    for (let d = new Date(monthStart); d <= monthEnd; d = addDays(d, 1)) {
      m.push(new Date(d))
    }
    return m
  }, [view, cursor])

  const eventsByDay = useMemo(() => {
    const m = new Map<string, Event[]>()
    for (const e of events || []) {
      if (!e.start_at) continue
      const d = new Date(e.start_at)
      if (Number.isNaN(d.getTime())) continue
      const key = startOfDay(d).toISOString()
      const arr = m.get(key) || []
      arr.push(e)
      m.set(key, arr)
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => new Date(a.start_at || 0).getTime() - new Date(b.start_at || 0).getTime())
    }
    return m
  }, [events])

  // KPI counts
  const kpi = useMemo(() => {
    const now = new Date()
    const today = startOfDay(now)
    const tomorrow = addDays(today, 1)
    const inSeven = addDays(today, 7)
    const weekStart = startOfWeek(today)
    const weekEnd = addDays(weekStart, 7)
    let todayCount = 0, tomorrowCount = 0, weekCount = 0, sevenCount = 0
    for (const e of upcoming || []) {
      if (!e.start_at) continue
      const d = new Date(e.start_at)
      if (Number.isNaN(d.getTime())) continue
      if (sameDay(d, today)) todayCount++
      if (sameDay(d, tomorrow)) tomorrowCount++
      if (d >= weekStart && d < weekEnd) weekCount++
      if (d >= today && d < inSeven) sevenCount++
    }
    return { todayCount, tomorrowCount, weekCount, sevenCount }
  }, [upcoming])

  return (
    <div style={{ padding: '20px 8px 48px', color: 'var(--v3-text)' }}>

      {/* HEADER ============================================== */}
      <header style={{ display: 'flex', alignItems: 'flex-end', justifyContent: 'space-between', gap: 16, marginBottom: 20 }}>
        <div style={{ minWidth: 0 }}>
          <div style={eyebrowStyle}>Calendar</div>
          <h1 style={{ margin: '6px 0 0', fontFamily: 'var(--font-display)', fontSize: 32, lineHeight: 1.05, letterSpacing: '0.01em', color: 'var(--v3-text)' }}>Schedule</h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div role="tablist" aria-label="View" style={{ display: 'inline-flex', gap: 4, padding: 3, borderRadius: 999, background: 'var(--v3-surface, #141110)', border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))' }}>
            {(['day', 'week', 'month'] as const).map((v) => (
              <button key={v} type="button" role="tab" aria-selected={view === v} onClick={() => setView(v)} style={viewPill(view === v)}>
                {v.charAt(0).toUpperCase() + v.slice(1)}
              </button>
            ))}
          </div>
          <button type="button" onClick={onAddEvent} style={primaryBtn}>
            <Plus size={14} strokeWidth={2.5} />
            New event
          </button>
        </div>
      </header>

      {/* KPI ROW ============================================ */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: 18 }}>
        <KPITile label="Today"          value={String(kpi.todayCount)}    sub={kpi.todayCount > 0 ? 'on the books' : 'open day'} subTone={kpi.todayCount > 0 ? 'warn' : 'muted'} accent />
        <KPITile label="Tomorrow"       value={String(kpi.tomorrowCount)} sub={kpi.tomorrowCount > 0 ? 'on the books' : 'open'} />
        <KPITile label="This week"      value={String(kpi.weekCount)}     sub="Sun to Sat" />
        <KPITile label="Next 7 days"    value={String(kpi.sevenCount)}    sub="rolling" />
      </div>

      {/* DATE NAVIGATOR ===================================== */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 14 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" onClick={() => step(-1)} aria-label="Previous" style={iconBtn}>
            <ChevronLeft size={16} />
          </button>
          <button type="button" onClick={() => step(1)} aria-label="Next" style={iconBtn}>
            <ChevronRight size={16} />
          </button>
          <button type="button" onClick={jumpToday} style={ghostBtn}>Today</button>
        </div>
        <div style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, color: 'var(--v3-text)' }}>
          {fmtRangeLabel(view, cursor)}
        </div>
        <div style={{ minWidth: 120 }} />
      </div>

      {/* AGENDA ============================================= */}
      <section style={panelStyle}>
        {loading && <div style={emptyState}>Loading…</div>}
        {!loading && daysToShow.length === 0 && <div style={emptyState}>Nothing on this range.</div>}
        {!loading && daysToShow.map((d) => {
          const key = startOfDay(d).toISOString()
          const dayEvents = eventsByDay.get(key) || []
          if (view === 'month' && dayEvents.length === 0) return null
          const isToday = sameDay(d, new Date())
          return (
            <div key={key} style={dayBlockStyle}>
              <header style={{
                display: 'flex',
                alignItems: 'center',
                gap: 10,
                padding: '12px 18px',
                background: isToday ? 'color-mix(in srgb, var(--v3-primary) 8%, transparent)' : 'transparent',
                borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))'
              }}>
                <span aria-hidden="true" style={{ width: 6, height: 6, borderRadius: 999, background: isToday ? 'var(--v3-primary)' : 'var(--v3-text-muted)' }} />
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, color: isToday ? 'var(--v3-primary)' : 'var(--v3-text)', letterSpacing: '0.04em' }}>
                  {d.toLocaleDateString(undefined, { weekday: 'long' }).toUpperCase()}
                </span>
                <span style={{ fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text-muted)' }}>
                  {d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
                {dayEvents.length > 0 && (
                  <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-body)', fontSize: 10, color: 'var(--v3-text-muted)', letterSpacing: '0.1em', textTransform: 'uppercase' }}>
                    {dayEvents.length} {dayEvents.length === 1 ? 'event' : 'events'}
                  </span>
                )}
              </header>
              {dayEvents.length === 0 ? (
                <div style={{ padding: '14px 18px', fontFamily: 'var(--font-body)', fontSize: 12, color: 'var(--v3-text-muted)' }}>Nothing scheduled.</div>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
                  {dayEvents.map((e) => (
                    <li key={e.id} style={eventRowStyle}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 14, padding: '12px 18px' }}>
                        <div style={{ minWidth: 92, fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, fontVariantNumeric: 'tabular-nums', color: 'var(--v3-text)' }}>
                          {fmtTime(e.start_at || '')}{e.end_at && ` to ${fmtTime(e.end_at)}`}
                        </div>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, color: 'var(--v3-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{e.title || 'Untitled event'}</div>
                          {(e.location || e.description) && (
                            <div style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', marginTop: 2, display: 'inline-flex', alignItems: 'center', gap: 4, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 480 }}>
                              {e.location && <><MapPin size={10} /> {e.location}</>}
                              {!e.location && e.description}
                            </div>
                          )}
                        </div>
                        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--v3-primary)' }}>
                          <CalIcon size={11} style={{ verticalAlign: 'text-top', marginRight: 4 }} />
                          Event
                        </span>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )
        })}
      </section>
    </div>
  )
}

// ============================================================
// PRIMITIVES
// ============================================================

function KPITile({ label, value, sub, subTone, accent }: any) {
  const valColor = accent ? 'var(--v3-primary)' : 'var(--v3-text)'
  return (
    <div style={{
      background: 'var(--v3-surface, #141110)',
      border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
      borderRadius: 6,
      padding: '16px 18px',
      display: 'flex', flexDirection: 'column', gap: 8,
      minHeight: 104
    }}>
      <span style={eyebrowStyle}>{label}</span>
      <span style={{ fontFamily: 'var(--font-display)', fontSize: 30, lineHeight: 1, letterSpacing: '-0.01em', color: valColor, fontVariantNumeric: 'tabular-nums' }}>{value}</span>
      {sub && <span style={{ fontFamily: 'var(--font-body)', fontSize: 11, color: subTone === 'warn' ? 'var(--v3-primary)' : 'var(--v3-text-muted)' }}>{sub}</span>}
    </div>
  )
}

// ============================================================
// STYLES
// ============================================================

const eyebrowStyle: React.CSSProperties = {
  fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700,
  letterSpacing: '0.18em', textTransform: 'uppercase',
  color: 'var(--v3-text-muted)'
}

const panelStyle: React.CSSProperties = {
  background: 'var(--v3-surface, #141110)',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  borderRadius: 6, overflow: 'hidden'
}

const dayBlockStyle: React.CSSProperties = {
  borderBottom: '1px solid var(--v3-border, rgba(255, 240, 210, 0.06))'
}

const eventRowStyle: React.CSSProperties = {
  borderTop: '1px solid var(--v3-border, rgba(255, 240, 210, 0.04))',
  cursor: 'pointer',
  transition: 'background 120ms ease'
}

const emptyState: React.CSSProperties = {
  padding: '32px 18px',
  fontFamily: 'var(--font-body)', fontSize: 13,
  color: 'var(--v3-text-muted)',
  textAlign: 'center'
}

const primaryBtn: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  background: 'var(--v3-primary)',
  color: 'var(--v3-on-primary, #141414)',
  border: 'none', borderRadius: 4,
  padding: '8px 14px',
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
  letterSpacing: '0.02em', cursor: 'pointer',
  boxShadow: '0 0 0 1px color-mix(in srgb, var(--v3-primary) 30%, transparent), 0 2px 8px color-mix(in srgb, var(--v3-primary) 20%, transparent)'
}

const iconBtn: React.CSSProperties = {
  display: 'inline-grid', placeItems: 'center',
  width: 32, height: 32,
  background: 'var(--v3-surface, #141110)',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  borderRadius: 4,
  color: 'var(--v3-text-muted)',
  cursor: 'pointer'
}

const ghostBtn: React.CSSProperties = {
  padding: '6px 12px',
  background: 'transparent',
  border: '1px solid var(--v3-border, rgba(255, 240, 210, 0.10))',
  borderRadius: 4,
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
  letterSpacing: '0.04em', cursor: 'pointer'
}

function viewPill(on: boolean): React.CSSProperties {
  return {
    padding: '5px 12px', borderRadius: 999, border: 'none',
    background: on ? 'var(--v3-primary)' : 'transparent',
    color: on ? 'var(--v3-on-primary, #141414)' : 'var(--v3-text-muted)',
    fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
    letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer'
  }
}
