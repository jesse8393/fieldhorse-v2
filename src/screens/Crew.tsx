// Crew, /crew. The foreman/crew landing page.
//
// Read-mostly view of the punching user's own data:
//   - Today's schedule slice (fh_schedule rows where assigned_to is
//     the caller, OR all rows in their org if assigned_to isn't set)
//   - Active punch + clock in/out controls (fh_time_punches)
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
  getActivePunch, punchIn, punchOut, listMyRecentPunches, workedMinutes, fetchMyDefaultRate,
  type TimePunch,
} from '../lib/timePunches.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { recalcCost } from '../lib/stages.ts'

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
  if (!iso) return '\u2003'
  try {
    return new Date(iso).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  } catch { return '\u2003' }
}

function fmtDayHeading(d: Date): string {
  return d.toLocaleDateString(undefined, { weekday: 'long', month: 'long', day: 'numeric' })
}

// Duration formatter for the display-font (Bebas Neue) metrics on Crew.
// Bebas Neue has only uppercase glyphs, so "0m" silently rendered as
// "0M" / "1h 30m" → "1H 30M" which the audit flagged as a bug. Using
// HH:MM digits and ":" avoids the case-sensitivity issue, they look
// identical in any font.
function fmtMinutes(min: number): string {
  const h = Math.floor(min / 60)
  const m = min % 60
  return `${h}:${String(m).padStart(2, '0')}`
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
  // Which job the next clock in attaches to. Defaults to today's first
  // scheduled job so a punch is never orphaned when there's an obvious
  // one; '' means "no job" (general shift), which is still valid.
  const [clockJobId, setClockJobId] = useState<string>('')
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
          // Show tasks assigned to me, OR, if no assigned_to is set :
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

  // Today's jobs, deduped by contact_id, the pick-list for clock in.
  // Schedule rows carry the event title which doubles as a good label.
  const todayJobs = (() => {
    const seen = new Map<string, string>()
    for (const ev of schedule) {
      if (ev.contact_id && !seen.has(ev.contact_id)) {
        seen.set(ev.contact_id, ev.title || 'Job')
      }
    }
    return Array.from(seen, ([id, label]) => ({ id, label }))
  })()

  // Default the clock in job to today's first scheduled job once loaded,
  // but never override a choice the user already made.
  useEffect(() => {
    if (!clockJobId && todayJobs.length > 0) setClockJobId(todayJobs[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [schedule])

  async function doClockIn() {
    if (!user || punching) return
    setPunching(true)
    try {
      const p = await punchIn({ userId: user.id, contactId: clockJobId || null })
      setActivePunch(p)
      toastSuccess('Clocked in')
    } catch (e: any) {
      const msg = String(e?.message || '')
      if (msg.includes('one_active_per_user')) {
        toastError('Already clocked in', 'Refresh to see the active shift.')
        await load()
      } else {
        toastError('Clock in failed', msg || '')
      }
    } finally {
      setPunching(false)
    }
  }

  async function doClockOut() {
    if (!user || punching || !activePunch) return
    setPunching(true)
    try {
      // Snapshot the member's current rate onto the punch (allowed
      // once, NULL→value, by the 054 guard). Without it the shift
      // priced at whatever the rate happens to be when job cost is
      // next computed, a raise retroactively repriced old shifts.
      const rate = await fetchMyDefaultRate(user.id, activePunch.org_id).catch(() => null)
      await punchOut({ punchId: activePunch.id, hourlyRate: rate ?? undefined })
      // Push the new labor hours into the job's cached cost right away :
      // without this, Home KPIs and margins didn't move until the owner
      // happened to touch an unrelated expense on the job.
      if (activePunch.contact_id) {
        recalcCost(activePunch.contact_id, user.id).catch(() => {})
      }
      setActivePunch(null)
      toastSuccess('Clocked out')
      await load()
    } catch (e: any) {
      toastError('Clock out failed', e?.message || '')
    } finally {
      setPunching(false)
    }
  }

  // Today minutes = completed punches today + the active shift. The
  // recent list has no punch_out filter, so the ACTIVE punch is in it
  // too, skip it there or the running shift counts twice ("Today on
  // the clock 6:00" three hours into a shift).
  const todayMs = (() => {
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const startMs = start.getTime()
    let total = 0
    for (const p of recentPunches) {
      if (activePunch && p.id === activePunch.id) continue
      if (!p.punch_out_at) continue
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
            <h1 className="fh-build-title">CREW</h1>
          </div>

          <div className={`fh-build-focus fh-build-window-card is-${activePunch ? 'good' : 'neutral'}`}>
            <div className="fh-build-eyebrow">
              {activePunch ? 'On the clock' : 'Not clocked in'}
            </div>
            <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--v3-text)', margin: '8px 0 4px' }}>
              {activePunch
                ? `Since ${fmtTime(activePunch.punch_in_at)}`
                : 'Ready when you are.'}
            </p>
            {activePunch && (
              <p style={{ margin: 0, color: 'var(--v3-text-muted)', fontSize: 12 }}>
                {fmtMinutes(workedMinutes(activePunch))} this shift
              </p>
            )}
            {!activePunch && todayJobs.length > 0 && (
              <label style={{ display: 'block', marginTop: 12 }}>
                <span style={{ display: 'block', fontSize: 12, letterSpacing: 0, textTransform: 'uppercase', color: 'var(--v3-text-muted)', marginBottom: 4 }}>
                  Clock in to
                </span>
                <select
                  value={clockJobId}
                  onChange={(e) => setClockJobId(e.target.value)}
                  disabled={punching}
                  style={{
                    width: '100%', background: 'rgba(20, 20, 20,.25)', color: 'var(--v3-text)',
                    border: '1px solid var(--v3-border-mid)', borderRadius: 10,
                    padding: '8px 12px', fontSize: 14, fontWeight: 600,
                  }}
                >
                  {todayJobs.map((j) => (
                    <option key={j.id} value={j.id} style={{ color: '#141414' }}>{j.label}</option>
                  ))}
                  <option value="" style={{ color: '#141414' }}>No specific job</option>
                </select>
              </label>
            )}
            <div style={{ marginTop: 12 }}>
              {activePunch ? (
                <button
                  type="button"
                  className="fh-build-primary-btn"
                  onClick={doClockOut}
                  disabled={punching}
                  style={{ background: 'var(--v3-danger-bright)', color: '#F2EDE4' }}
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
            <MiniMetric label="Your role" value={role || '\u2003'} />
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
                  style={{ background: 'transparent', border: 'none', color: 'var(--v3-primary, #C9963A)', cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: 0, textTransform: 'uppercase' }}
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
                        padding: '12px 24px',
                        borderTop: '1px solid var(--v3-glass-tint-2)',
                        alignItems: 'center',
                      }}
                    >
                      <span style={{ color: 'var(--v3-primary, #C9963A)', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                        <Clock size={11} style={{ display: 'inline', marginRight: 6, verticalAlign: '-1px' }} />
                        {fmtTime(ev.start_at)}{ev.end_at ? ` to ${fmtTime(ev.end_at)}` : ''}
                      </span>
                      <strong style={{ color: 'var(--v3-text)', fontSize: 14, fontWeight: 700 }}>
                        {ev.title || 'Untitled event'}
                      </strong>
                      {ev.contact_id ? (
                        <button
                          type="button"
                          onClick={() => navigate(`/jobs/${ev.contact_id}`)}
                          style={{ background: 'transparent', border: 'none', color: 'var(--v3-text-muted)', cursor: 'pointer', fontSize: 12, display: 'inline-flex', alignItems: 'center', gap: 4 }}
                        >
                          <MapPin size={11} /> Job <ChevronRight size={11} />
                        </button>
                      ) : (
                        <span style={{ color: 'var(--v3-text-faint)', fontSize: 12 }}>{' '}</span>
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
                          gap: 12,
                          padding: '12px 24px',
                          borderTop: '1px solid var(--v3-glass-tint-2)',
                          alignItems: 'center',
                          fontSize: 12,
                        }}
                      >
                        <span style={{ color: 'var(--v3-text)', fontWeight: 600 }}>
                          {day ? day.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : ''}
                        </span>
                        <span style={{ color: 'var(--v3-text-muted)' }}>
                          {fmtTime(p.punch_in_at)} to {p.punch_out_at ? fmtTime(p.punch_out_at) : 'now'}
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
                        <span style={{ textAlign: 'right', color: 'var(--v3-text)', fontVariantNumeric: 'tabular-nums', fontWeight: 600 }}>
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
                        <span style={{ color: overdue ? 'var(--v3-danger-bright)' : 'var(--v3-primary, #C9963A)' }}>
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
              <strong data-empty>Shifts reviewed weekly</strong>
              {/* The owner IS the manager, "your manager approves your
                  shifts" read as nonsense on a solo operator's screen. */}
              <span>
                {role === 'owner' || role === 'admin'
                  ? 'You review and approve shifts under Timesheets.'
                  : 'Your manager approves shifts at the end of the week.'}
              </span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Field reports</div>
              <strong data-empty>Capture from the field</strong>
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
        color: tone === 'bad' ? 'var(--v3-danger-bright)' : tone === 'warn' ? '#C9963A' : accent ? 'var(--v3-primary, #C9963A)' : undefined,
        textTransform: label === 'Your role' ? 'capitalize' : undefined,
      }}>
        {value}
      </strong>
      <span>{label}</span>
    </div>
  )
}
