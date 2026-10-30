import { CalendarDays, ArrowUpRight } from 'lucide-react'
import { useNow } from '../../lib/useNow.ts'

export type JobVisit = { id?: string; title?: string | null; start_at?: string | null; end_at?: string | null }

/** Current visit first, otherwise the next start. Invalid dates never reach the UI. */
export function nextJobVisit(visits: JobVisit[], now = Date.now()): JobVisit | undefined {
  return visits.filter(visit => {
    const start = Date.parse(visit.start_at || '')
    const end = Date.parse(visit.end_at || '')
    return Number.isFinite(start) && (start >= now || (Number.isFinite(end) && end > now))
  }).sort((a, b) => Date.parse(a.start_at!) - Date.parse(b.start_at!))[0]
}

export default function JobVisitSummary({ visits = [], onOpen }: { visits?: JobVisit[]; onOpen?: () => void }) {
  const now = useNow().getTime()
  const visit = nextJobVisit(visits, now)
  const start = visit?.start_at ? new Date(visit.start_at) : null
  const end = visit?.end_at ? new Date(visit.end_at) : null
  const current = start && start.getTime() <= now
  const dateLabel = start?.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' })
  const timeLabel = start?.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })
  const endLabel = end && start && end.getTime() > start.getTime()
    ? `${end.toDateString() !== start.toDateString() ? `${end.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })} · ` : ''}${end.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : null
  return <section className="fh-job-visit" aria-label={current ? 'Current job visit' : 'Next job visit'}>
    <div className="fh-job-visit__label"><CalendarDays size={17} aria-hidden="true" />{visit ? current ? 'Current visit' : 'Next visit' : 'Schedule'}</div>
    <h2>{visit?.title || (visit ? 'Job visit' : 'Plan your next visit')}</h2>
    <p>{visit ? `${dateLabel} · ${timeLabel}${endLabel ? ` to ${endLabel}` : ''}` : 'No upcoming visits scheduled.'}</p>
    {onOpen && <button type="button" onClick={onOpen}>{visit ? 'View schedule' : 'Schedule a visit'}<ArrowUpRight size={16} aria-hidden="true" /></button>}
  </section>
}
