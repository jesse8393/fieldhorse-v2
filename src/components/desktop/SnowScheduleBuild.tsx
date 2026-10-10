// SnowScheduleBuild, desktop /schedule (spec 9.10, render
// base/desktop-schedule.jpg, decision D10).
//
// The desktop entry for /schedule at 900 px and wider. A toolbar (title
// with the date range, weather, Today, previous and next, Day, Week and
// Month, and the screen's one brushed gold action, New job), a paper board
// of hourly slots, and a right rail: the Unscheduled tray (jobs in the job
// stage with no visit from today on), Crew this week when visits carry
// assigned_to, and Up next with New event. Dragging a tray card onto a
// slot schedules the job there; the card's Schedule button is the
// keyboard and touch way in.
//
// The board is built from lib/scheduleBoard.ts (layout and wording) and
// lib/scheduleWrite.ts (the write); this file owns the drag and drop.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type Collision,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter
} from '@dnd-kit/core'
import { useQuery } from '@tanstack/react-query'
import { ChevronLeft, ChevronRight, Plus } from 'lucide-react'
import { Button, IconButton } from '../fh'
import TopbarWeather from './TopbarWeather.tsx'
import BoardGrid from './schedule/BoardGrid.tsx'
import MonthGrid from './schedule/MonthGrid.tsx'
import { CrewThisWeek, TrayCardFace, UnscheduledTray, UpNext } from './schedule/Rail.tsx'
import type { BoardEvent, BoardView } from './schedule/types.ts'
import './schedule/schedule.css'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useOrgScope } from '../../lib/orgScope.ts'
import {
  useInvalidateSchedule,
  useJobs,
  useScheduleEvents,
  type JobRow
} from '../../lib/queries.ts'
import { orgMembersList, type OrgMember } from '../../lib/orgApi.ts'
import { toast, toastError, toastSuccess, toastUndo } from '../../lib/toast.ts'
import {
  boardHours,
  crewHours,
  dayLabel,
  jobLabel,
  monthLabel,
  parseSlotId,
  slotId,
  slotToRange,
  timeLabel,
  timeRangeLabel,
  unscheduledJobs,
  weekRangeLabel,
  ymdKey
} from '../../lib/scheduleBoard.ts'
import { createScheduleEvent, deleteScheduleEvent } from '../../lib/scheduleWrite.ts'

type EventRow = BoardEvent

// Loosely typed inputs so we accept whatever shape the parent Schedule
// screen passes (events can be null while loading, view is a plain
// string at the call-site, etc.).
type Props = {
  events: EventRow[] | null
  upcoming: EventRow[] | null
  loading: boolean
  cursor: Date
  setCursor: (d: Date) => void
  view: string
  setView: (v: any) => void
  /** The forecast the screen already fetched; null while it loads, left out when the screen did not fetch one. */
  weather?: any
  onAddEvent: () => void
  /** New job in the toolbar: the one primary action on this screen. */
  onNewJob?: () => void
  /** A tray card's Schedule button: the Add event sheet with the job preset. */
  onScheduleJob?: (job: JobRow) => void
  onOpenEvent?: (event: EventRow) => void
}

const VIEWS: { key: BoardView; label: string }[] = [
  { key: 'day', label: 'Day' },
  { key: 'week', label: 'Week' },
  { key: 'month', label: 'Month' }
]

const FULL_WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

function addDays(d: Date, n: number) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)
}

// The clock the board reads, refreshed each minute so the now line and
// the past slots keep up without a reload.
function useNow(intervalMs = 60_000) {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => {
    const timer = window.setInterval(() => setNow(new Date()), intervalMs)
    return () => window.clearInterval(timer)
  }, [intervalMs])
  return now
}

// How far the pointer or keyboard is from the slot under the dragged
// card's grip: a drop lands on the slot that holds the pointer, or, for
// the keyboard, the point just inside the card's top left corner.
const PROBE = 16
const slotCollision: CollisionDetection = ({ droppableContainers, droppableRects, pointerCoordinates, collisionRect }) => {
  const probe = pointerCoordinates ?? { x: collisionRect.left + PROBE, y: collisionRect.top + PROBE }
  const hits: Collision[] = []
  for (const container of droppableContainers) {
    const rect = droppableRects.get(container.id)
    if (!rect) continue
    if (probe.x >= rect.left && probe.x < rect.right && probe.y >= rect.top && probe.y < rect.bottom) {
      hits.push({ id: container.id, data: { droppableContainer: container, value: 0 } })
    }
  }
  return hits
}

const DIRECTIONS: Record<string, [number, number]> = {
  ArrowLeft: [-1, 0],
  ArrowRight: [1, 0],
  ArrowUp: [0, -1],
  ArrowDown: [0, 1]
}

function slotWords(id: unknown): string {
  const slot = parseSlotId(id)
  if (!slot) return 'somewhere that is not a time'
  const at = new Date(slot.day.getFullYear(), slot.day.getMonth(), slot.day.getDate(), slot.hour)
  return `${FULL_WEEKDAYS[slot.day.getDay()]} ${at.getMonth() + 1}/${at.getDate()} at ${timeLabel(at)}`
}

export default function SnowScheduleBuild(props: Props) {
  const {
    events: eventsIn, upcoming: upcomingIn, loading, cursor, setCursor,
    view: viewIn, setView, weather, onAddEvent, onNewJob, onScheduleJob, onOpenEvent,
  } = props

  const events = useMemo<EventRow[]>(() => eventsIn || [], [eventsIn])
  const upcoming = useMemo<EventRow[]>(() => upcomingIn || [], [upcomingIn])
  const view: BoardView = (viewIn === 'day' || viewIn === 'week' || viewIn === 'month') ? viewIn : 'week'

  const { user } = useAuth()
  const orgId = useOrgScope(user?.id)
  const now = useNow()
  const invalidateSchedule = useInvalidateSchedule()

  // The days on the board: one, the week from Sunday, or none for Month.
  const days: Date[] = useMemo(() => {
    const base = startOfDay(cursor)
    if (view === 'day') return [base]
    const weekStart = addDays(base, -base.getDay())
    return Array.from({ length: 7 }, (_, i) => addDays(weekStart, i))
  }, [cursor, view])

  // Only the visits that fall in what the board shows. The query asks for
  // that range already; this keeps the board, the empty hint and Crew this
  // week honest if a cached range still holds visits from a neighbour.
  const inView = useMemo(() => {
    if (view === 'month') {
      return events.filter((e) => {
        if (!e.start_at) return false
        const d = new Date(e.start_at)
        return d.getFullYear() === cursor.getFullYear() && d.getMonth() === cursor.getMonth()
      })
    }
    const keys = new Set(days.map(ymdKey))
    return events.filter((e) => e.start_at && keys.has(ymdKey(new Date(e.start_at))))
  }, [events, days, view, cursor])

  const rangeLabel = view === 'day'
    ? dayLabel(cursor)
    : view === 'week'
      ? weekRangeLabel(days[0], days[6])
      : monthLabel(cursor)

  // ---- The Unscheduled tray (decision D10) ----
  // Every visit from today on, whatever week the board shows, decides
  // which jobs still need a date.
  const todayKey = ymdKey(now)
  const bookedRange = useMemo(() => {
    const [y, m, d] = todayKey.split('-').map(Number)
    const from = new Date(y, m - 1, d)
    return { from: from.toISOString(), to: new Date(y, m - 1, d + 400).toISOString() }
  }, [todayKey])
  const { data: booked } = useScheduleEvents(user?.id, bookedRange.from, bookedRange.to)
  const jobsQuery = useJobs()
  const jobs = jobsQuery.data
  const trayJobs = useMemo(
    () => unscheduledJobs(jobs ?? [], (booked ?? []).map((e) => ({ contact_id: e.contact_id, start_at: e.start_at as string })), now),
    [jobs, booked, now]
  )

  // ---- Crew this week: only when visits carry assigned_to ----
  const crew = useMemo(() => crewHours(inView), [inView])
  const { data: membersData } = useQuery({
    queryKey: ['orgMembers', orgId ?? null],
    queryFn: async () => ((await orgMembersList()) as { members?: OrgMember[] }).members ?? [],
    enabled: crew.length > 0,
    staleTime: 5 * 60_000,
    retry: false
  })
  const crewRows = useMemo(() => {
    const byId = new Map((membersData ?? []).map((m) => [m.user_id, m]))
    return crew.map((c) => {
      const member = byId.get(c.id)
      return { id: c.id, hours: c.hours, name: member?.name?.trim() || member?.email?.trim() || 'Teammate' }
    })
  }, [crew, membersData])
  const crewTitle = view === 'day' ? 'Crew today' : view === 'month' ? 'Crew this month' : 'Crew this week'

  // ---- Drag and drop ----
  const [activeJob, setActiveJob] = useState<JobRow | null>(null)

  // Where the keyboard cursor is, kept here rather than read back from the
  // drag state so two quick arrow presses never land twice.
  const cursorSlot = useRef<{ day: Date; hour: number } | null>(null)
  const layout = useRef({ days, first: 7, last: 18, now })
  useEffect(() => {
    const { first, last } = boardHours(days, inView)
    layout.current = { days, first, last, now }
  })

  // Arrow keys move one slot: left and right a day, up and down an hour.
  // The first arrow lands on today at the next full hour.
  const coordinateGetter = useCallback<KeyboardCoordinateGetter>((event, { context }) => {
    const step = DIRECTIONS[event.code]
    if (!step) return undefined
    const { days: boardDays, first, last, now: clock } = layout.current
    if (boardDays.length === 0) return undefined
    event.preventDefault()
    let col: number
    let hour: number
    const current = cursorSlot.current
    if (current) {
      col = Math.min(boardDays.length - 1, Math.max(0, boardDays.findIndex((d) => ymdKey(d) === ymdKey(current.day)) + step[0]))
      hour = Math.min(last - 1, Math.max(first, current.hour + step[1]))
    } else {
      const today = boardDays.findIndex((d) => ymdKey(d) === ymdKey(clock))
      col = today >= 0 ? today : 0
      hour = Math.min(last - 1, Math.max(first, today >= 0 ? clock.getHours() + 1 : first + 2))
    }
    const day = boardDays[col]
    const rect = context.droppableRects.get(slotId(day, hour))
    if (!rect) return undefined
    cursorSlot.current = { day, hour }
    return { x: rect.left + 4, y: rect.top + 4 }
  }, [])

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(KeyboardSensor, { coordinateGetter, scrollBehavior: 'auto' })
  )

  const announcements = useMemo<Announcements>(() => {
    const name = (active: { data: { current?: unknown } }) => {
      const job = (active.data.current as { job?: JobRow } | undefined)?.job
      return job ? jobLabel(job) : 'job'
    }
    return {
      onDragStart: ({ active }) => `Picked up ${name(active)}. Use the arrow keys to choose a day and an hour, then press space to drop. Escape cancels.`,
      onDragOver: ({ active, over }) => (over ? `${name(active)} is over ${slotWords(over.id)}.` : `${name(active)} is not over a time.`),
      onDragEnd: ({ active, over }) => (over ? `Dropped ${name(active)} on ${slotWords(over.id)}.` : `${name(active)} was not dropped on a time.`),
      onDragCancel: ({ active }) => `Moving ${name(active)} was cancelled.`
    }
  }, [])

  const onDragStart = useCallback(({ active }: DragStartEvent) => {
    cursorSlot.current = null
    setActiveJob((active.data.current as { job?: JobRow } | undefined)?.job ?? null)
  }, [])

  const onDragEnd = useCallback(async ({ active, over }: DragEndEvent) => {
    cursorSlot.current = null
    setActiveJob(null)
    const slot = over ? parseSlotId(over.id) : null
    const job = (active.data.current as { job?: JobRow } | undefined)?.job
    if (!slot || !job) return
    const range = slotToRange(slot.day, slot.hour)
    // A slot that has already begun is the past: refuse, write nothing.
    if (Date.parse(range.start_at) < Date.now()) {
      toast('Pick a time from now on.')
      return
    }
    if (!user?.id) return
    const label = jobLabel(job)
    const result = await createScheduleEvent({
      userId: user.id,
      orgId: orgId ?? null,
      contactId: job.id,
      title: label,
      ...range
    })
    if ('error' in result) {
      toastError("Couldn't schedule the job", result.error)
      return
    }
    invalidateSchedule()
    const start = new Date(range.start_at)
    toastUndo(`Scheduled ${label}`, {
      description: `${dayLabel(start)}, ${timeRangeLabel(start, new Date(range.end_at))}`,
      onUndo: async () => {
        const undone = await deleteScheduleEvent(result.id)
        if ('error' in undone) {
          toastError("Couldn't undo", undone.error)
          return
        }
        invalidateSchedule()
        toastSuccess('Removed', label)
      }
    })
  }, [user?.id, orgId, invalidateSchedule])

  const onDragCancel = useCallback(() => {
    cursorSlot.current = null
    setActiveJob(null)
  }, [])

  const openDay = useCallback((day: Date) => {
    setCursor(startOfDay(day))
    setView('day')
  }, [setCursor, setView])

  const unit = view === 'day' ? 'day' : view === 'week' ? 'week' : 'month'
  const shift = (n: number) => {
    if (view === 'month') setCursor(new Date(cursor.getFullYear(), cursor.getMonth() + n, 1))
    else setCursor(addDays(cursor, (view === 'day' ? 1 : 7) * n))
  }

  const scheduleJob = useCallback((job: JobRow) => onScheduleJob?.(job), [onScheduleJob])

  return (
    <div className="fhsch fh-build-page" data-build-screen="SnowScheduleBuild">
      <header className="fhsch-toolbar">
        <div className="fhsch-toolbar__title">
          <h1 className="fhsch-title">Schedule</h1>
          <p className="fhsch-range" aria-live="polite">{rangeLabel}</p>
        </div>
        <div className="fhsch-toolbar__weather">
          <TopbarWeather snapshot={weather} />
        </div>
        <div className="fhsch-toolbar__nav">
          <Button variant="secondary" size="md" onClick={() => setCursor(startOfDay(new Date()))}>Today</Button>
          <IconButton aria-label={`Previous ${unit}`} icon={ChevronLeft} size={48} shape="square" variant="paper" onClick={() => shift(-1)} />
          <IconButton aria-label={`Next ${unit}`} icon={ChevronRight} size={48} shape="square" variant="paper" onClick={() => shift(1)} />
        </div>
        <div className="fhsch-seg" role="group" aria-label="Calendar view">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              className="fhsch-seg__opt"
              aria-pressed={view === v.key}
              onClick={() => setView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
        <div className="fhsch-toolbar__actions">
          <Button variant="primary" size="md" icon={Plus} onClick={() => onNewJob?.()}>New job</Button>
        </div>
      </header>

      <DndContext
        id="fhsch-dnd"
        sensors={sensors}
        collisionDetection={slotCollision}
        accessibility={{
          announcements,
          screenReaderInstructions: {
            draggable: 'To schedule this job, press space to pick it up, use the arrow keys to move over the week, then press space to drop it. Or use its Schedule button.'
          }
        }}
        onDragStart={onDragStart}
        onDragEnd={onDragEnd}
        onDragCancel={onDragCancel}
      >
        <div className={`fhsch-body${activeJob ? ' is-dragging' : ''}`}>
          <div className="fhsch-main">
            {view === 'month' ? (
              <MonthGrid cursor={cursor} events={events} loading={loading} now={now} onOpenDay={openDay} />
            ) : (
              <BoardGrid
                days={days}
                view={view}
                events={inView}
                loading={loading}
                now={now}
                onOpenEvent={onOpenEvent}
                onOpenDay={openDay}
              />
            )}
          </div>

          <aside className="fhsch-rail" aria-label="Unscheduled jobs, crew and up next">
            <UnscheduledTray
              jobs={trayJobs}
              loading={jobsQuery.isPending}
              failed={jobsQuery.isError}
              hasAnyJob={(jobs ?? []).length > 0}
              onRetry={() => { void jobsQuery.refetch() }}
              onSchedule={scheduleJob}
            />
            {crewRows.length > 0 && <CrewThisWeek title={crewTitle} crew={crewRows} />}
            <UpNext events={upcoming} onOpenEvent={onOpenEvent} onAddEvent={onAddEvent} />
          </aside>
        </div>

        <DragOverlay dropAnimation={null}>
          {activeJob ? (
            <article className="fhsch-card fhsch-card--floating">
              <TrayCardFace job={activeJob} floating />
            </article>
          ) : null}
        </DragOverlay>
      </DndContext>
    </div>
  )
}
