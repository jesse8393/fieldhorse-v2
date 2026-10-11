// The right rail of the desktop Schedule (spec 9.10): the Unscheduled
// tray with draggable job cards, Crew this week with hours (only when
// visits carry assigned_to), and the Up next list so every visit in the
// next days stays one click away.

import { useDraggable } from '@dnd-kit/core'
import { GripVertical, Plus } from 'lucide-react'
import { Button, Icon, SkeletonRows } from '../../fh'
import { hoursLabel, jobLabel, jobSubline, timeLabel, WEEKDAYS } from '../../../lib/scheduleBoard.ts'
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

function TrayCard({ job, onSchedule }: { job: JobRow; onSchedule: (job: JobRow) => void }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: `job:${job.id}`,
    data: { job }
  })
  return (
    <article ref={setNodeRef} className={`fhsch-card${isDragging ? ' is-dragging' : ''}`}>
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
          onClick={() => onSchedule(job)}
        >
          Schedule
        </Button>
      </div>
    </article>
  )
}

type TrayProps = {
  jobs: JobRow[]
  loading: boolean
  failed: boolean
  hasAnyJob: boolean
  onRetry: () => void
  onSchedule: (job: JobRow) => void
}

export function UnscheduledTray({ jobs, loading, failed, hasAnyJob, onRetry, onSchedule }: TrayProps) {
  return (
    <section className="fhsch-rail__section" aria-label="Unscheduled jobs">
      <h2 className="fhsch-rail__title">Unscheduled</h2>
      <p className="fhsch-rail__hint" id={TRAY_HINT_ID}>Drag onto the week, or use Schedule.</p>
      {loading ? (
        <SkeletonRows rows={3} label="Loading jobs" />
      ) : failed ? (
        <div className="fhsch-rail__empty" role="alert">
          <p>Couldn't load jobs.</p>
          <Button variant="quiet" size="mini" onClick={onRetry}>Try again</Button>
        </div>
      ) : jobs.length === 0 ? (
        <p className="fhsch-rail__empty">
          {hasAnyJob ? 'Every job has a date on the calendar.' : 'No jobs yet. Add one with New job.'}
        </p>
      ) : (
        <div className="fhsch-tray">
          {jobs.map((job) => <TrayCard key={job.id} job={job} onSchedule={onSchedule} />)}
        </div>
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
