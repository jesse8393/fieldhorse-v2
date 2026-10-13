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
//
// Nothing reads as empty before the reads land (Phase 8 follow up A):
// until they do, the clock card says it is checking with both clock
// buttons off, and the metrics and tasks are skeletons. If any read fails
// the card says the clock could not be checked, with the one Try again
// (the reads go out together), Clock in stays off, and the lists say they
// could not load instead of that there is nothing. A running shift that a
// read found stays on the card with Clock out, whichever other read failed:
// this is the only place to end a shift that has no job. Only the latest
// load sets state, so a read that lands late never undoes a newer one.

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Bell, Calendar, Clock, MapPin, PlayCircle, Search, Square,
  ListChecks, AlertTriangle, ChevronRight,
} from 'lucide-react'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { supabase } from '../lib/supabase.ts'
import {
  getActivePunch, punchIn, punchOut, listMyRecentPunches, workedMinutes, fetchMyDefaultRate, ALREADY_CLOCKED_OUT,
  type TimePunch,
} from '../lib/timePunches.ts'
import { toastSuccess, toastError } from '../lib/toast.ts'
import { recalcCost } from '../lib/stages.ts'
import OrgSwitcher from '../components/OrgSwitcher.tsx'
import PaletteKeyCap, { paletteShortcut } from '../components/desktop/PaletteKeyCap.tsx'
import DataErrorState from '../components/DataErrorState.tsx'
import LoadingValue from '../components/LoadingValue.tsx'
import { SkeletonRows } from '../components/fh'
import { keepFocusOnRetry } from '../lib/retryFocus.ts'

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

  // The active punch is undefined until a read of it works, and it takes
  // every read of it that works, so a running shift shows even when another
  // read failed. The lists are null until a load where all four reads
  // worked, and they come in together: the page never pairs one list with
  // an empty line for another it could not read. A later load that fails
  // keeps what an earlier one brought.
  const [activePunch, setActivePunch] = useState<TimePunch | null | undefined>(undefined)
  const [recentPunches, setRecentPunches] = useState<TimePunch[] | null>(null)
  const [schedule, setSchedule] = useState<ScheduleRow[] | null>(null)
  const [tasks, setTasks] = useState<TodoRow[] | null>(null)
  // The latest load had a read that failed, any of the four.
  const [failed, setFailed] = useState(false)
  // The latest finished read of the active punch failed. Unlike `failed`,
  // a new load does not clear it, so Try again checks the clock again
  // instead of showing an older "Not clocked in" with Clock in on.
  const [punchStale, setPunchStale] = useState(false)
  const [punching, setPunching] = useState(false)
  // Which job the next clock in attaches to. Defaults to today's first
  // scheduled job so a punch is never orphaned when there's an obvious
  // one; '' means "no job" (general shift), which is still valid.
  const [clockJobId, setClockJobId] = useState<string>('')
  // Re-render the meter every minute so the active-shift timer ticks.
  const [, setNowTick] = useState(0)
  // Each load takes the next number and sets state only while it is the
  // latest: a read that lands after a newer load, or after a clock in or
  // out, never undoes what is on screen.
  const loadSeq = useRef(0)
  useEffect(() => () => { loadSeq.current += 1 }, [])
  // The clock card, where focus waits while Try again reads again.
  const clockCardRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!activePunch) return
    const t = window.setInterval(() => setNowTick((n) => n + 1), 60_000)
    return () => window.clearInterval(t)
  }, [activePunch])

  const load = useCallback(async () => {
    if (!user) return
    const seq = ++loadSeq.current
    setFailed(false)
    // Today window (local midnight to local midnight + 1 day, ISO)
    const start = new Date()
    start.setHours(0, 0, 0, 0)
    const end = new Date(start)
    end.setDate(end.getDate() + 1)

    // The punch reads throw when they fail, here only: their other
    // callers keep getting null and an empty list. A failed read must
    // never read as "Not clocked in" with Clock in on. Each read settles
    // on its own, so one that fails does not take the others with it.
    const [active, recent, sched, todos] = await Promise.allSettled([
      getActivePunch(user.id, { throwOnError: true }),
      listMyRecentPunches(user.id, 10, { throwOnError: true }),
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
    // A newer load (or a clock in or out) has taken over.
    if (seq !== loadSeq.current) return
    if (active.status === 'fulfilled') {
      setActivePunch(active.value)
      setPunchStale(false)
    } else {
      setPunchStale(true)
    }
    if (
      active.status === 'fulfilled'
      && recent.status === 'fulfilled'
      && sched.status === 'fulfilled' && !sched.value.error
      && todos.status === 'fulfilled' && !todos.value.error
    ) {
      setRecentPunches(recent.value)
      setSchedule(((sched.value.data || []) as ScheduleRow[]))
      setTasks(((todos.value.data || []) as TodoRow[]))
    } else {
      setFailed(true)
    }
  }, [user])

  useEffect(() => { if (!memLoading) load() }, [memLoading, load])

  // A load where every read worked has brought the lists in.
  const listsLoaded = schedule !== null
  // A read of the active punch has worked: whether there is a shift is known.
  const punchKnown = activePunch !== undefined
  // Everything the card says waits on the reads: no running shift is known,
  // and either the first reads are out or the last read of the clock failed
  // and Try again is reading it again.
  const checking = !failed && !activePunch && (!listsLoaded || punchStale)
  // Try again reads everything again; focus waits on the clock card.
  const retry = () => {
    keepFocusOnRetry(clockCardRef.current)
    void load()
  }
  // A metric shows its number only once its reads are in: a skeleton while
  // they are out, and nothing at all after a read that failed.
  const metric = (ready: boolean, value: () => ReactNode, label: string) =>
    ready ? value() : failed ? '\u2003' : <LoadingValue label={label} width={56} height={20} />

  // Today's jobs, deduped by contact_id, the pick-list for clock in.
  // Schedule rows carry the event title which doubles as a good label.
  const todayJobs = (() => {
    const seen = new Map<string, string>()
    for (const ev of schedule ?? []) {
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
    // Only once the clock has been checked, and only when that worked.
    if (!user || punching || !listsLoaded || !punchKnown || failed || punchStale) return
    setPunching(true)
    try {
      const p = await punchIn({ userId: user.id, contactId: clockJobId || null })
      // A load still out read the clock before this punch: it no longer counts.
      loadSeq.current += 1
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
      if (e?.message === ALREADY_CLOCKED_OUT) {
        // It ended elsewhere, or on an older screen: its time stays as it
        // was, and the page reads the clock again.
        toastError('Already clocked out', 'This shift had already ended. Its time stays as it was.')
        await load()
      } else {
        toastError('Clock out failed', e?.message || '')
      }
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
    for (const p of recentPunches ?? []) {
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

  // Clock out and the running shift's lines, shared by the card and by the
  // error card, which keeps a shift a read found.
  const clockOutButton = (
    <button
      type="button"
      className="fh-build-primary-btn"
      onClick={doClockOut}
      disabled={punching}
      style={{ background: 'var(--v3-danger-bright)', color: '#F2EDE4' }}
    >
      <Square size={13} /> {punching ? 'Clocking out…' : 'Clock out'}
    </button>
  )
  const shiftLines = (punch: TimePunch) => (
    <>
      <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--v3-text)', margin: '8px 0 4px' }}>
        {`Since ${fmtTime(punch.punch_in_at)}`}
      </p>
      <p style={{ margin: 0, color: 'var(--v3-text-muted)', fontSize: 12 }}>
        {fmtMinutes(workedMinutes(punch))} this shift
      </p>
    </>
  )

  return (
    <div className="fh-build-page" data-build-screen="Crew" data-build-route="/crew">
      <header className="fh-build-topbar fh-build-topbar--no-cta">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
          aria-keyshortcuts={paletteShortcut().combo}
        >
          <Search size={14} />
          <span>Search jobs, clients, invoices, notes...</span>
          <PaletteKeyCap />
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
            <h1 className="fh-build-title">Crew</h1>
            {/* Only shows for people in more than one company, so a crew
                member can switch back to their own workspace on mobile. */}
            <div style={{ marginTop: 12, maxWidth: 320 }}>
              <OrgSwitcher />
            </div>
          </div>

          {/* One card in every state, so Try again can leave focus on it while
              the clock is read again. Without the focus class when the read
              failed: its button and paragraph rules would restyle the error's. */}
          <div
            ref={clockCardRef}
            className={
              failed
                ? `fh-build-window-card is-${activePunch ? 'good' : 'neutral'}`
                : checking
                  ? 'fh-build-focus fh-build-window-card is-neutral'
                  : `fh-build-focus fh-build-window-card is-${activePunch ? 'good' : 'neutral'}`
            }
            role="group"
            aria-label="Your clock"
            tabIndex={-1}
          >
            {failed ? (
              // A shift a read found stays on screen with Clock out, so a
              // crew member on weak signal can still end it; otherwise Clock
              // in waits for a read that works.
              <>
                <DataErrorState
                  compact
                  title="We couldn't check your clock."
                  message="Check your connection and try again."
                  actionLabel="Try again"
                  onRetry={retry}
                />
                {activePunch ? (
                  <>
                    <div className="fh-build-eyebrow" style={{ marginTop: 12 }}>On the clock</div>
                    {shiftLines(activePunch)}
                    <div style={{ marginTop: 12 }}>{clockOutButton}</div>
                  </>
                ) : (
                  <div style={{ marginTop: 12 }}>
                    <button type="button" className="fh-build-primary-btn" disabled>
                      <PlayCircle size={13} /> Clock in
                    </button>
                  </div>
                )}
              </>
            ) : checking ? (
              <>
                <div className="fh-build-eyebrow">Checking your clock</div>
                <p style={{ fontSize: 16, fontWeight: 700, margin: '8px 0 4px' }}>
                  <LoadingValue label="Loading your clock" width={160} height={16} />
                </p>
                <div style={{ marginTop: 12, display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  <button type="button" className="fh-build-primary-btn" disabled>
                    <PlayCircle size={13} /> Clock in
                  </button>
                  <button type="button" className="fh-build-secondary-btn" disabled>
                    <Square size={13} /> Clock out
                  </button>
                </div>
              </>
            ) : (
              <>
                <div className="fh-build-eyebrow">
                  {activePunch ? 'On the clock' : 'Not clocked in'}
                </div>
                {activePunch ? shiftLines(activePunch) : (
                  <p style={{ fontSize: 16, fontWeight: 700, color: 'var(--v3-text)', margin: '8px 0 4px' }}>
                    Ready when you are.
                  </p>
                )}
                {!activePunch && todayJobs.length > 0 && (
                  <label style={{ display: 'block', marginTop: 12 }}>
                    <span style={{ display: 'block', fontSize: 12, letterSpacing: 0, color: 'var(--v3-text-muted)', marginBottom: 4 }}>
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
                  {activePunch ? clockOutButton : (
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
              </>
            )}
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Today on the clock" value={metric(listsLoaded && punchKnown, () => fmtMinutes(todayMs), 'Loading your time today')} accent />
            <MiniMetric label="Today's events" value={metric(listsLoaded, () => String(schedule?.length ?? 0), "Loading today's events")} />
            <MiniMetric label="Open tasks" value={metric(listsLoaded, () => String(tasks?.length ?? 0), 'Loading your open tasks')} tone={tasks && tasks.length > 0 ? 'warn' : undefined} />
            <MiniMetric label="Your role" value={checking ? <LoadingValue label="Loading your role" width={56} height={20} /> : role || '\u2003'} />
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
                  style={{ background: 'transparent', border: 'none', color: 'var(--v3-primary-text)', cursor: 'pointer', fontSize: 12, fontWeight: 700, letterSpacing: 0 }}
                >
                  Full schedule →
                </button>
              </header>
              {schedule === null ? (
                <div className="fh-build-table__empty">{failed ? "Couldn't load today's schedule." : 'Loading…'}</div>
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
                      <span style={{ color: 'var(--v3-primary-text)', fontSize: 12, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
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
              {recentPunches === null ? (
                <div className="fh-build-table__empty">{failed ? "Couldn't load your recent shifts." : 'Loading…'}</div>
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
              {tasks === null ? (
                failed ? <span>Couldn't load your tasks.</span> : <SkeletonRows rows={2} label="Loading your tasks" />
              ) : tasks.length === 0 ? (
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
                        <span style={{ color: overdue ? 'var(--v3-danger-text)' : 'var(--v3-primary-text)' }}>
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

function MiniMetric({ label, value, accent, tone }: { label: string; value: ReactNode; accent?: boolean; tone?: 'warn' | 'bad' }) {
  return (
    <div className="fh-build-mini">
      <strong style={{
        color: tone === 'bad' ? 'var(--v3-danger-text)' : tone === 'warn' ? 'var(--v3-primary-text)' : accent ? 'var(--v3-primary-text)' : undefined,
        textTransform: label === 'Your role' ? 'capitalize' : undefined,
      }}>
        {value}
      </strong>
      <span>{label}</span>
    </div>
  )
}
