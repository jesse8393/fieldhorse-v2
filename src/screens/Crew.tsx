// Crew — /crew. The foreman/crew landing page.
//
// Read-mostly view of the punching user's own data:
//   - Today's schedule slice (fh_schedule rows where assigned_to is
//     the caller, OR all rows in their org if assigned_to isn't set)
//   - Active punch + clock-in/out controls (fh_time_punches)
//   - Own task list (fh_job_todos belonging to user_id) plus a
//     truthful "not-tracked" hint when no tasks exist
//
// No financial data (revenue, AR, won deals). Foreman+crew never see
// $ amounts. Build chrome stays consistent with the owner dashboard.

import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, Calendar, Clock, MapPin, PlayCircle, Search, Square,
  ListChecks, AlertTriangle, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { supabase } from '../lib/supabase.ts'
import {
  getActivePunch, punchIn, punchOut, listMyRecentPunches, workedMinutes,
  type TimePunch,
} from '../lib/timePunches.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'

type ScheduleRow = {
  id: string
  title: string | null
  start_at: string | null
  end_at: string | null
  description: string | null
  contact_id: string | null
}

type TodoRow = {
  id: string
  text: string
  job_id: string
  due_at: string | null
  done: boolean
  completed_at: string | null
}

function fmtTime(iso: string | null): string {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  } catch { return '—' }
}

function fmtDayHeading(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

function fmtMinutes(min: number): string {
  if (min < 60) return `${min}m`
  const h = Math.floor(min / 60)
  const m = min % 60
  return m === 0 ? `${h}h` : `${h}h ${m}m`
}

export default function Crew() {
  const navigate = useNavigate()
  const { user } = useAuth()
  const { orgName, role, loading: memLoading } = useMembership()

  const [activePunch, setActivePunch] = useState<TimePunch | null>(null)
  const [recentPunches, setRecentPunches] = useState<TimePunch[]>([])
  const [schedule, setSchedule] = useState<ScheduleRow[]>([])
  const [tasks, setTasks] = useState<TodoRow[]>([])
  const [loading, setLoading] = useState(true)
  const [punching, setPunching] = useState(false)
  // Re-render the meter every minute so the active-shift timer ticks.
  const [, setNowTick] = useState(0)

  useEffect(() => {
    if (!activePunch) return
    const t = window.setInterval(() => setNowTick((n) => n + 1), 60_000)
    return () => window.clearInterval(t)
  }, [activePunch])

  const load = useCallback(async () => {
    if (!user) return
    setLoading(true)
    try {
      // Today window (local midnight to local midnight + 1 day, ISO)
      const start = new Date()
      start.setHours(0, 0, 0, 0)
      const end = new Date(start)
      end.setDate(end.getDate() + 1)

      const [active, recent, schedRes, todoRes] = await Promise.all([
        getActivePunch(user.id),
        listMyRecentPunches(user.id, 10),
        supabase
          .from('fh_schedule')
          .select('id, title, start_at, end_at, description, contact_id')
          .gte('start_at', start.toISOString())
          .lt('start_at', end.toISOString())
          .order('start_at', { ascending: true }),
        supabase
          .from('fh_job_todos')
          .select('id, text, job_id, due_at, done, completed_at')
          // Show tasks assigned to me, OR — if no assigned_to is set —
          // tasks I created. This lets the page work both for the
          // owner-of-one (legacy: every task user_id = self) and for
          // multi-member orgs (managers assign via assigned_to).
          .or(`assigned_to.eq.${user.id},and(assigned_to.is.null,user_id.eq.${user.id})`)
          .eq('done', false)
          .order('due_at', { ascending: true, nullsFirst: false })
          .limit(8),
      ])
      setActivePunch(active)
      setRecentPunches(recent)
      setSchedule(((schedRes.data || []) as ScheduleRow[]))
      setTasks(((todoRes.data || []) as TodoRow[]))
    } finally {
      setLoading(false)
    }
  }, [user])

  useEffect(() => { if (!memLoading) load() }, [memLoading, load])

  async function doClockIn() {
    if (!user || punching) return
    setPunching(true)
    try {
      const p = await punchIn({ userId: user.id })
      setActivePunch(p)
      toastSuccess('Clocked in')
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('one_active_per_user')) {
        toastError('Already clocked in', 'Refresh to see the active shift.')
        await load()
      } else {
        toastError('Clock-in failed', msg || '')
      }
    } finally {
      setPunching(false)
    }
  }

  async function doClockOut() {
    if (!user || punching || !activePunch) return
    setPunching(true)
    try {
      await punchOut({ punchId: activePunch.id })
      setActivePunch(null)
      toastSuccess('Clocked out')
      await load()
    } catch (e: any) {
      toastError('Clock-out failed', e?.message || '')
    } finally {
      setPunching(false)
    }
  }

  // Today minutes = sum of completed punches with punch_in_at today + active worked
  const todayMs = (() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const startMs = start.getTime()
    let total = 0
    for (const p of recentPunches) {
      const inMs = new Date(p.punch_in_at).getTime()
      if (inMs < startMs) continue
      total += workedMinutes(p)
    }
    if (activePunch && new Date(activePunch.punch_in_at).getTime() >= startMs) {
      total += workedMinutes(activePunch)
    }
    return total
  })()

  return (
    <div className="fh-build-page" data-build-screen="Crew" data-build-route="/crew">
      <header className="fh-build-topbar fh-build-topbar--no-cta">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
        >
          <Search size={14} />
          <span>Search jobs, clients, invoices, notes...</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="fh-build-topbar__meta">
          <span>{orgName || 'Field crew'}</span>
          <span className="fh-build-vline" />
          <span style={{ opacity: 0.6 }}>Weather not set</span>
        </div>
        <button
          className="fh-build-icon-btn"
          type="button"
          onClick={() => navigate('/activity')}
          aria-label="Open activity"
          title="Activity"
        >
          <Bell size={16} />
        </button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">{fmtDayHeading(new Date())}</div>
            <h1 className="fh-build-title">RUN YOUR DAY.</h1>
          </div>

          <div className={`fh-build-focus fh-build-window-card is-${activePunch ? 'good' : 'neutral'}`}>
            <div className="fh-build-eyebrow">
              {activePunch ? 'On the clock' : 'Not clocked in'}
            </div>
            <p style={{ fontSize: 17, fontWeight: 700, color: '#f4f1ea', margin: '8px 0 4px' }}>
              {activePunch
                ? `Since ${fmtTime(activePunch.punch_in_at)}`
                : 'Ready when you are.'}
            </p>
            {activePunch && (
              <p style={{ margin: 0, color: 'rgba(245,242,234,.62)', fontSize: 12 }}>
                {fmtMinutes(workedMinutes(activePunch))} this shift
              </p>
            )}
            <div style={{ marginTop: 12 }}>
              {activePunch ? (
                <button
                  type="button"
                  className="fh-build-primary-btn"
                  onClick={doClockOut}
                  disabled={punching}
                  style={{ background: '#ee4942', color: '#fff' }}
                >
                  <Square size={13} /> {punching ? 'Clocking out…' : 'Clock out'}
                </button>
              ) : (
                <button
                  type="button"
                  className="fh-build-primary-btn"
                  onClick={doClockIn}
                  disabled={punching}
                >
                  <PlayCircle size={13} /> {punching ? 'Clocking in…' : 'Clock in'}
                </button>
              )}
            </div>
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Today on the clock" value={fmtMinutes(todayMs)} accent />
            <MiniMetric label="Today's events" value={String(schedule.length)} />
            <MiniMetric label="Open tasks" value={String(tasks.length)} tone={tasks.length > 0 ? 'warn' : undefined} />
            <MiniMetric label="Your role" value={role || '—'} />
          </div>
        </section>

        <section className="fh-build-content-grid fh-build-content-grid--schedule">
          <div className="fh-build-detail-main">
            {/* Today's schedule */}
            <section className="fh-build-card">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">
                  <Calendar size={11} style={{ display: 'inline', marginRight: 6, verticalAlign: '-1px' }} />
                  Today's schedule
                </div>
                <button
                  type="button"
                  onClick={() => navigate('/schedule')}
                  style={{ background: 'transparent', border: 'none', color: 'var(--v3-primary, #c9963a)', cursor: 'pointer', fontSize: 11, fontWeight: 700, letterSpacing: '.06em', textTransform: 'uppercase' }}
                >
                  Full schedule →
                </button>
              </header>
              {loading ? (
                <div className="fh-build-table__empty">Loading…</div>
              ) : schedule.length === 0 ? (
                <div className="fh-build-table__empty">Nothing on the books today.</div>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {schedule.map((ev) => (
                    <li
                      key={ev.id}
                      style={{
                        display: 'grid',
                        gridTemplateColumns: '120px 1fr auto',
                        gap: 16,
                        padding: '14px 22px',
                        borderTop: '1px solid rgba(255,255,255,.06)',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ color: 'var(--v3-primary, #c9963a)', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        <Clock size={11} style={{ display: 'inline', marginRight: 6, verticalAlign: '-1px' }} />
                        {fmtTime(ev.start_at)}{ev.end_at ? ` – ${fmtTime(ev.end_at)}` : ''}
                      </span>
                      <strong style={{ color: '#f4f1ea', fontSize: 13, fontWeight: 700 }}>
                        {ev.title || 'Untitled event'}
                      </strong>
                      {ev.contact_id ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/jobs/${ev.contact_id}`)}
                          style={{ background: 'transparent', border: 'none', color: 'rgba(245,242,234,.55)', cursor: 'pointer', fontSize: 11, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <MapPin size={11} /> Job <ChevronRight size={11} />
                        </button>
                      ) : (
                        <span style={{ color: 'rgba(245,242,234,.30)', fontSize: 11 }}>—</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </section>

            {/* Recent punches */}
            <section className="fh-build-card">
              <header className="fh-build-card-head">
                <div className="fh-build-eyebrow">
                  <Clock size={11} style={{ display: 'inline', marginRight: 6, verticalAlign: '-1px' }} />
                  Recent shifts
                </div>
              </header>
              {loading ? (
                <div className="fh-build-table__empty">Loading…</div>
              ) : recentPunches.length === 0 ? (
                <div className="fh-build-table__empty">No shifts logged yet.</div>
              ) : (
                <ul style={{ margin: 0, padding: 0, listStyle: 'none' }}>
                  {recentPunches.map((p) => {
                    const day = p.punch_in_at ? new Date(p.punch_in_at) : null
                    return (
                      <li
                        key={p.id}
                        style={{
                          display: 'grid',
                          gridTemplateColumns: '130px 110px 1fr 90px',
                          gap: 14,
                          padding: '12px 22px',
                          borderTop: '1px solid rgba(255,255,255,.06)',
                          alignItems: 'center',
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: '#f4f1ea', fontWeight: 600 }}>
                          {day ? day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : '—'}
                        </span>
                        <span style={{ color: 'rgba(245,242,234,.55)' }}>
                          {fmtTime(p.punch_in_at)} – {p.punch_out_at ? fmtTime(p.punch_out_at) : 'now'}
                        </span>
                        <span>
                          {p.approved_at ? (
                            <span className="fh-build-dot is-good">Approved</span>
                          ) : p.flagged ? (
                            <span className="fh-build-dot is-warn">Flagged</span>
                          ) : p.punch_out_at ? (
                            <span className="fh-build-dot is-neutral">Pending</span>
                          ) : (
                            <span className="fh-build-dot is-good">Active</span>
                          )}
                        </span>
                        <span style={{ textAlign: 'right', color: '#f4f1ea', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
                          {fmtMinutes(workedMinutes(p))}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>
          </div>

          <aside className="fh-build-rail fh-build-rail--page">
            {/* Open tasks */}
            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">
                <ListChecks size={11} style={{ display: 'inline', marginRight: 6, verticalAlign: '-1px' }} />
                Your tasks
              </div>
              {tasks.length === 0 ? (
                <>
                  <strong>None open</strong>
                  <span>Nothing assigned to you right now.</span>
                </>
              ) : (
                <ul className="fh-build-rail-list" style={{ marginTop: 10 }}>
                  {tasks.slice(0, 6).map((t) => {
                    const overdue = t.due_at && new Date(t.due_at).getTime() < Date.now()
                    return (
                      <li
                        key={t.id}
                        style={{ gridTemplateColumns: 'auto 1fr', cursor: 'pointer' }}
                        onClick={() => navigate(`/jobs/${t.job_id}`)}
                      >
                        <span style={{ color: overdue ? '#ee4942' : 'var(--v3-primary, #c9963a)' }}>
                          {overdue ? <AlertTriangle size={11} /> : <Clock size={11} />}
                        </span>
                        <span className="fh-build-rail-list__title" title={t.text}>
                          {t.text}
                        </span>
                      </li>
                    )
                  })}
                </ul>
              )}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Timesheets</div>
              <strong>Pending review</strong>
              <span>Your manager approves shifts at the end of the week.</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Field reports</div>
              <strong>Capture in /notes</strong>
              <span>Snap a photo, dictate a note, AI organizes the rest.</span>
              <button
                type="button"
                className="fh-build-rail-card__action"
                onClick={() => navigate('/notes')}
              >
                Open notes <ChevronRight size={13} />
              </button>
            </section>
          </aside>
        </section>
      </main>
    </div>
  )
}

function MiniMetric({ label, value, accent, tone }: { label: string; value: string; accent?: boolean; tone?: 'warn' | 'bad' }) {
  return (
    <div className="fh-build-mini">
      <strong style={{
        color: tone === 'bad' ? '#ee4942' : tone === 'warn' ? '#e0a141' : accent ? 'var(--v3-primary, #c9963a)' : undefined,
        textTransform: label === 'Your role' ? 'capitalize' : undefined,
      }}>
        {value}
      </strong>
      <span>{label}</span>
    </div>
  )
}
