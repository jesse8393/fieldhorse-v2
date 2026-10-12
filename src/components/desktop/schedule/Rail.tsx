// The right rail of the desktop Schedule (spec 9.10): the Unscheduled
// tray with draggable job cards, Crew this week with hours (only when
// visits carry assigned_to), and the Up next list so every visit in the
// next days stays one click away.

import { useLayoutEffect, useRef, useState } from 'react'
import { useDraggable } from '@dnd-kit/core'
import { GripVertical, Plus } from 'lucide-react'
import { Button, Icon, SkeletonRows } from '../../fh'
import { capTray, hoursLabel, jobLabel, jobSubline, timeLabel, TRAY_LIMIT, WEEKDAYS } from '../../../lib/scheduleBoard.ts'
import type { JobRow } from '../../../lib/queries.ts'
import type { BoardEvent } from './types.ts'

export const TRAY_HINT_ID = 'fhsch-tray-hint'

/** The face of a tray card, shared by the card in the list and the one in the drag overlay. */
export function TrayCardFace({ job, floating = false }: { job: JobRow; floating?: boolean }) {
  const sub = jobSubline(job)
  const address = job.address?.trim()
  return (
    <>
      <span className="fhsch-handle__dots" aria-hidden="true">
        <Icon icon={GripVertical} size={22} />
      </span>
      <div className="fhsch-card__text">
        <h3 className="fhsch-card__title" id={floating ? undefined : `fhsch-card-${job.id}`}>{jobLabel(job)}</h3>
        {sub && <p className="fhsch-card__line">{sub}</p>}
        {address && <p className="fhsch-card__line fhsch-card__line--soft">{address}</p>}
      </div>
    </>
  )
}

type TrayCardProps = {
  job: JobRow
  /** False in Month view, where there is no hour to drop on. */
  canDrag: boolean
  /** A drop of this job is saving: the card waits, dimmed, and neither drags nor schedules. */
  saving: boolean
  onSchedule: (job: JobRow) => void
}

function TrayCard({ job, canDrag, saving, onSchedule }: TrayCardProps) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `job:${job.id}`,
    data: { job },
    disabled: !canDrag || saving
  })
  return (
    <article
      ref={setNodeRef}
      className={`fhsch-card${isDragging ? ' is-dragging' : ''}${saving ? ' is-saving' : ''}`}
      aria-busy={saving || undefined}
    >
      <button
        type="button"
        ref={setActivatorNodeRef}
        className="fhsch-handle"
        {...attributes}
        {...listeners}
        aria-label={`Drag ${jobLabel(job)} onto the week`}
      >
        <Icon icon={GripVertical} size={22} />
      </button>
      <div className="fhsch-card__text">
        <h3 className="fhsch-card__title" id={`fhsch-card-${job.id}`}>{jobLabel(job)}</h3>
        {jobSubline(job) && <p className="fhsch-card__line">{jobSubline(job)}</p>}
        {job.address?.trim() && <p className="fhsch-card__line fhsch-card__line--soft">{job.address.trim()}</p>}
      </div>
      <div className="fhsch-card__action">
        <Button
          variant="secondary"
          size="mini"
          aria-describedby={`fhsch-card-${job.id}`}
          disabled={saving}
          onClick={() => onSchedule(job)}
        >
          Schedule
        </Button>
        {saving && <span className="fhsch-card__saving">Saving</span>}
      </div>
    </article>
  )
}

type TrayProps = {
  /** Null until both the jobs and the visits from today on are in. */
  jobs: JobRow[] | null
  /** True while either list is still on its first load. */
  loading: boolean
  /** True when either list failed: alone when there is nothing to show, above the cards when a reload failed. */
  failed: boolean
  hasAnyJob: boolean
  /** False in Month view: the cards hold still and the hint says to switch to Week. */
  canDrag: boolean
  /** Jobs whose drop is saving. */
  saving: ReadonlySet<string>
  onRetry: () => void
  onSchedule: (job: JobRow) => void
}

export function UnscheduledTray({ jobs, loading, failed, hasAnyJob, canDrag, saving, onRetry, onSchedule }: TrayProps) {
  // The first 50 cards, then "Show all N", so a long backlog never builds
  // hundreds of drag handles at once.
  const [showAll, setShowAll] = useState(false)
  const { shown, hidden } = capTray(jobs ?? [], showAll)
  // "Show all" unmounts itself, so focus would fall to the page. Move it to
  // the first card the button revealed instead, so the keyboard path goes on.
  const trayRef = useRef<HTMLDivElement>(null)
  const focusRevealed = useRef(false)
  useLayoutEffect(() => {
    if (!showAll || !focusRevealed.current) return
    focusRevealed.current = false
    trayRef.current?.querySelectorAll<HTMLElement>('.fhsch-handle')[TRAY_LIMIT]?.focus()
  }, [showAll])
  return (
    <section className="fhsch-rail__section" aria-label="Unscheduled jobs">
      <h2 className="fhsch-rail__title">Unscheduled</h2>
      <p className="fhsch-rail__hint" id={TRAY_HINT_ID}>
        {canDrag ? 'Drag onto the week, or use Schedule.' : 'Switch to Week to drag a job onto a day.'}
      </p>
      {loading ? (
        <SkeletonRows rows={3} label="Loading unscheduled jobs" />
      ) : (
        <>
          {failed && (
            <div className={`fhsch-rail__empty${jobs ? ' is-above' : ''}`} role="alert">
              <p>
                {jobs
                  ? "Couldn't refresh this list, so it may be out of date. Check your connection and try again."
                  : "Couldn't load unscheduled jobs. Check your connection and try again."}
              </p>
              <Button variant="quiet" size="mini" onClick={onRetry}>Try again</Button>
            </div>
          )}
          {jobs && jobs.length === 0 && (
            <p className="fhsch-rail__empty">
              {hasAnyJob ? 'Every job has a date on the calendar.' : 'No jobs yet. Add one with New job.'}
            </p>
          )}
          {jobs && jobs.length > 0 && (
            <>
              <div className="fhsch-tray" ref={trayRef}>
                {shown.map((job) => (
                  <TrayCard key={job.id} job={job} canDrag={canDrag} saving={saving.has(job.id)} onSchedule={onSchedule} />
                ))}
              </div>
              {hidden > 0 && (
                <div className="fhsch-tray__more">
                  <Button variant="secondary" size="mini" onClick={() => { focusRevealed.current = true; setShowAll(true) }}>
                    Show all {jobs.length}
                  </Button>
                </div>
              )}
            </>
          )}
        </>
      )}
    </section>
  )
}

function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : '')).toUpperCase()
}

export function CrewThisWeek({
  title,
  crew
}: {
  title: string
  crew: { id: string; name: string; hours: number }[]
}) {
  return (
    <section className="fhsch-rail__section" aria-label={title}>
      <h2 className="fhsch-rail__title">{title}</h2>
      <ul className="fhsch-crew">
        {crew.map((c) => (
          <li key={c.id} className="fhsch-crew__row">
            <span className="fhsch-crew__avatar" aria-hidden="true">{initials(c.name)}</span>
            <span className="fhsch-crew__name">{c.name}</span>
            <span className="fhsch-crew__hours">{hoursLabel(c.hours)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export function UpNext({
  events,
  onOpenEvent,
  onAddEvent
}: {
  events: BoardEvent[]
  onOpenEvent?: (event: BoardEvent) => void
  onAddEvent: () => void
}) {
  return (
    <section className="fhsch-rail__section" aria-label="Up next">
      <div className="fhsch-rail__head">
        <h2 className="fhsch-rail__title">Up next</h2>
        <Button variant="secondary" size="mini" icon={Plus} onClick={onAddEvent}>New event</Button>
      </div>
      {events.length === 0 ? (
        <p className="fhsch-rail__empty">Nothing scheduled in the next 7 days.</p>
      ) : (
        <ul className="fhsch-upnext">
          {events.slice(0, 4).map((e) => {
            const start = new Date(e.start_at as string)
            return (
              <li key={e.id}>
                <button type="button" className="fhsch-upnext__row" onClick={() => onOpenEvent?.(e)}>
                  <span className="fhsch-upnext__when">{WEEKDAYS[start.getDay()]} {timeLabel(start)}</span>
                  <span className="fhsch-upnext__title">{e.title || 'Untitled event'}</span>
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}
