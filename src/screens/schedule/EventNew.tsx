// The event screen (PHASE9_PLAN Task 13, SPEC D57, D60): /schedule/new adds
// a visit, /schedule/:eventId/edit changes one. It took the place of the
// Add event sheet. The visit belongs to one record, a job (?job=, writes
// contact_id), a lead (?lead=, writes lead_id) or a quote (?quote=, writes
// quote_id), picked from one list of the three kinds. A lead's estimate
// comes prefilled: the title reads Estimate and the where line carries the
// client's name and address. Saving goes back to where the person came
// from, the Schedule when there is nowhere to go back to.

import { useEffect, useMemo, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import { Field, SkeletonRows } from '../../components/fh'
import CreateShell, { Choices } from '../new/CreateShell.tsx'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { supabase } from '../../lib/supabase.ts'
import { useOrgScope } from '../../lib/orgScope.ts'
import { useInvalidateSchedule, useJobs, useLeads, useQuotes, type JobRow, type LeadRow, type QuoteRow } from '../../lib/queries.ts'
import { createScheduleEvents } from '../../lib/scheduleWrite.ts'
import { toastError, toastSuccess } from '../../lib/toast.ts'
import { todayYmd, toYmd } from '../../lib/dates.ts'
import { localDateTimeMs, eventDurationMs } from '../../lib/scheduleDates.ts'
import { isMovedStage } from '../../lib/stages.ts'
import { jobLabel } from '../../lib/scheduleBoard.ts'
import { leadName, leadNeed } from '../../lib/leadsView.ts'
import { hapticMedium } from '../../lib/haptics.ts'
import './schedule-event.css'

type Kind = 'job' | 'lead' | 'quote'
type Link = { kind: Kind; id: string } | null

type EventRow = {
  id: string
  title: string | null
  description: string | null
  start_at: string | null
  end_at: string | null
  contact_id: string | null
  lead_id: string | null
  quote_id: string | null
}

const REPEAT = [
  { value: 'once', label: 'One time' },
  { value: 'series', label: 'Repeats, 4 times' }
]

function linkValue(link: Link): string {
  return link ? `${link.kind}:${link.id}` : ''
}

function parseLink(value: string): Link {
  const i = value.indexOf(':')
  if (i < 1) return null
  const kind = value.slice(0, i)
  if (kind !== 'job' && kind !== 'lead' && kind !== 'quote') return null
  return { kind, id: value.slice(i + 1) }
}

function linkFromRow(row: EventRow): Link {
  if (row.contact_id) return { kind: 'job', id: row.contact_id }
  if (row.lead_id) return { kind: 'lead', id: row.lead_id }
  if (row.quote_id) return { kind: 'quote', id: row.quote_id }
  return null
}

/** The client's name and address on one line, the where of a visit. */
function whereLine(client: { name?: string | null; address?: string | null } | null | undefined): string {
  return [client?.name?.trim(), client?.address?.trim()].filter(Boolean).join(', ')
}

async function fetchEvent(id: string): Promise<EventRow | null> {
  const { data, error } = await supabase
    .from('fh_schedule')
    .select('id, title, description, start_at, end_at, contact_id, lead_id, quote_id')
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as EventRow | null) ?? null
}

export default function EventNew() {
  const { eventId } = useParams()
  const [eventState, setEventState] = useState<{ status: 'loading' | 'ready' | 'missing' | 'failed'; row: EventRow | null }>(
    () => ({ status: eventId ? 'loading' : 'ready', row: null })
  )
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!eventId) return
    let alive = true
    setEventState({ status: 'loading', row: null })
    fetchEvent(eventId)
      .then((row) => { if (alive) setEventState({ status: row ? 'ready' : 'missing', row }) })
      .catch(() => { if (alive) setEventState({ status: 'failed', row: null }) })
    return () => { alive = false }
  }, [eventId, attempt])

  if (eventId && eventState.status !== 'ready') {
    return (
      <CreateShell title="Edit event" saveLabel="Save changes" backTo="/schedule" saving onSave={() => {}}>
        {eventState.status === 'loading' ? (
          <SkeletonRows rows={4} label="Loading the event" />
        ) : (
          <DataErrorState
            title="Couldn't load the event"
            message={eventState.status === 'missing' ? 'This event is gone.' : 'Check your connection and try again.'}
            actionLabel={eventState.status === 'missing' ? '' : 'Try again'}
            onRetry={() => setAttempt((n) => n + 1)}
          />
        )}
      </CreateShell>
    )
  }

  return <EventForm key={eventState.row?.id ?? 'new'} event={eventState.row} />
}

function EventForm({ event }: { event: EventRow | null }) {
  const editing = !!event
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params] = useSearchParams()
  const orgScope = useOrgScope(user?.id)
  const invalidateSchedule = useInvalidateSchedule()

  // The three kinds of record a visit can belong to (D53).
  const jobsQuery = useJobs()
  const leadsQuery = useLeads(user?.id)
  const quotesQuery = useQuotes(user?.id)
  const jobs = useMemo<JobRow[]>(
    () => ((jobsQuery.data ?? []) as JobRow[]).filter((j) => !isMovedStage(j.stage) && j.stage !== 'lost'),
    [jobsQuery.data]
  )
  const leads = useMemo<LeadRow[]>(() => (leadsQuery.data ?? []).filter((l) => l.status !== 'lost'), [leadsQuery.data])
  const quotes = useMemo<QuoteRow[]>(() => (quotesQuery.data ?? []).filter((q) => q.status !== 'lost'), [quotesQuery.data])

  const presetLink: Link = useMemo(() => {
    if (event) return linkFromRow(event)
    const job = params.get('job')
    const lead = params.get('lead')
    const quote = params.get('quote')
    if (job) return { kind: 'job', id: job }
    if (lead) return { kind: 'lead', id: lead }
    if (quote) return { kind: 'quote', id: quote }
    return null
  }, [event, params])

  const start = event?.start_at ? new Date(event.start_at) : null
  const [title, setTitle] = useState(() => event?.title || params.get('title') || (presetLink?.kind === 'lead' ? 'Estimate' : ''))
  const [where, setWhere] = useState(event?.description || '')
  const [date, setDate] = useState(() => (start ? toYmd(start) : todayYmd()))
  const [time, setTime] = useState(() => (start ? start.toTimeString().slice(0, 5) : '08:00'))
  const [link, setLink] = useState<Link>(presetLink)
  const [repeat, setRepeat] = useState<'once' | 'series'>('once')
  const [every, setEvery] = useState('7')
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ title?: string; when?: string; save?: string }>({})
  // The where line follows the linked record until the person types one.
  const [whereTyped, setWhereTyped] = useState(!!event?.description)

  // A lead's estimate carries the client's name and address (D60); a job
  // or a quote fills the same line from its client when nothing is typed.
  useEffect(() => {
    if (whereTyped || !link) return
    let line = ''
    if (link.kind === 'lead') {
      const lead = leads.find((l) => l.id === link.id)
      line = whereLine(lead?.fh_clients)
    } else if (link.kind === 'quote') {
      const quote = quotes.find((q) => q.id === link.id)
      line = whereLine(quote?.fh_clients)
    } else {
      const job = jobs.find((j) => j.id === link.id)
      line = job ? [job.name?.trim() || job.fh_clients?.name?.trim(), job.address?.trim()].filter(Boolean).join(', ') : ''
    }
    if (line) setWhere(line)
  }, [link, leads, quotes, jobs, whereTyped])

  const listsLoading = jobsQuery.isPending || leadsQuery.isPending || quotesQuery.isPending

  async function save() {
    if (saving) return
    const next: typeof errors = {}
    if (!title.trim()) next.title = 'Give the event a title.'
    const startMs = localDateTimeMs(date, time)
    if (startMs == null) next.when = 'Pick a date and a time.'
    setErrors(next)
    if (next.title || next.when || startMs == null) return
    setSaving(true)
    try {
      if (event) {
        // Update the one row in place, keeping the event's length. Matched
        // by id only: RLS scopes the company, and .select('id') turns a zero
        // row update into a visible failure.
        const { data: updated, error } = await supabase.from('fh_schedule').update({
          title: title.trim(),
          description: where.trim() || null,
          contact_id: link?.kind === 'job' ? link.id : null,
          lead_id: link?.kind === 'lead' ? link.id : null,
          quote_id: link?.kind === 'quote' ? link.id : null,
          start_at: new Date(startMs).toISOString(),
          end_at: new Date(startMs + eventDurationMs(event)).toISOString()
        }).eq('id', event.id).select('id')
        if (error) throw new Error(error.message || 'Try again.')
        if (!updated?.length) throw new Error('The event was not changed. Refresh and try again.')
        invalidateSchedule()
        hapticMedium()
        toastSuccess('Event saved', title.trim())
        goBack()
        return
      }
      // One hour long by default, so the Live and Done filters have a window.
      // A series shares one id in the recurring column, so the Schedule can
      // remove the whole run at once.
      const everyDays = Math.max(1, Number(every) || 7)
      const seriesId = repeat === 'series' ? (crypto.randomUUID?.() || `series-${startMs}`) : null
      const row = (s: number) => ({
        userId: user?.id as string,
        orgId: orgScope ?? null,
        contactId: link?.kind === 'job' ? link.id : null,
        leadId: link?.kind === 'lead' ? link.id : null,
        quoteId: link?.kind === 'quote' ? link.id : null,
        title,
        description: where,
        start_at: new Date(s).toISOString(),
        end_at: new Date(s + 60 * 60 * 1000).toISOString(),
        recurring: seriesId
      })
      const rows = [row(startMs)]
      if (seriesId) {
        // Step by calendar days so every occurrence keeps the same local
        // start time across a daylight saving change.
        for (let i = 1; i <= 4; i++) {
          const s = localDateTimeMs(date, time, everyDays * i)
          if (s != null) rows.push(row(s))
        }
      }
      const result = await createScheduleEvents(rows)
      if ('error' in result) throw new Error(result.error)
      invalidateSchedule()
      hapticMedium()
      toastSuccess('Event scheduled', 'Added to schedule')
      goBack()
    } catch (e) {
      const message = (e as { message?: string })?.message || 'Try again.'
      setErrors({ save: message })
      toastError(event ? "Couldn't update the event" : "Couldn't save the event", message)
    } finally {
      setSaving(false)
    }
  }

  function goBack() {
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/schedule', { replace: true })
  }

  // A preset record that is not in the lists yet (still loading, or lost)
  // keeps its own option so the picker never shows None for it.
  const presetMissing = link && !(
    (link.kind === 'job' && jobs.some((j) => j.id === link.id))
    || (link.kind === 'lead' && leads.some((l) => l.id === link.id))
    || (link.kind === 'quote' && quotes.some((q) => q.id === link.id))
  )

  return (
    <CreateShell
      title={editing ? 'Edit event' : 'Add event'}
      saveLabel={editing ? 'Save changes' : 'Save event'}
      saving={saving}
      error={errors.save}
      backTo="/schedule"
      onSave={save}
    >
      <Field
        label="Title"
        value={title}
        placeholder="Pour foundation, inspection, estimate"
        autoComplete="off"
        error={errors.title}
        onChange={(e) => { setTitle(e.target.value); if (errors.title) setErrors({ ...errors, title: undefined }) }}
      />
      <div className="fhev-when">
        <Field label="Date" type="date" value={date} error={errors.when ? ' ' : undefined} onChange={(e) => setDate(e.target.value)} />
        <Field label="Time" type="time" value={time} error={errors.when} onChange={(e) => setTime(e.target.value)} />
      </div>
      <div className="fhev-pick">
        <label className="fhev-pick__label" htmlFor="fhev-link">Link to</label>
        <select
          id="fhev-link"
          className="fhev-pick__select"
          value={linkValue(link)}
          disabled={saving}
          onChange={(e) => setLink(parseLink(e.target.value))}
        >
          <option value="">None</option>
          {presetMissing && link && (
            <option value={linkValue(link)}>
              {link.kind === 'job' ? 'This job' : link.kind === 'lead' ? 'This lead' : 'This quote'}
            </option>
          )}
          {jobs.length > 0 && (
            <optgroup label="Jobs">
              {jobs.map((j) => {
                const work = j.job_title?.trim()
                return (
                  <option key={j.id} value={`job:${j.id}`}>
                    {jobLabel(j)}{work && work !== jobLabel(j) ? `, ${work}` : ''}
                  </option>
                )
              })}
            </optgroup>
          )}
          {leads.length > 0 && (
            <optgroup label="Leads">
              {leads.map((l) => (
                <option key={l.id} value={`lead:${l.id}`}>{leadName(l)}, {leadNeed(l)}</option>
              ))}
            </optgroup>
          )}
          {quotes.length > 0 && (
            <optgroup label="Quotes">
              {quotes.map((q) => (
                <option key={q.id} value={`quote:${q.id}`}>{q.fh_clients?.name?.trim() || 'Unnamed'}{q.title ? `, ${q.title}` : ''}</option>
              ))}
            </optgroup>
          )}
        </select>
        <p className="fhev-pick__helper">
          {listsLoading ? 'Loading jobs, leads and quotes.' : 'A job, a lead or a quote. The visit shows on its record.'}
        </p>
      </div>
      <Field
        label="Where"
        value={where}
        placeholder="Client and address"
        autoComplete="off"
        onChange={(e) => { setWhere(e.target.value); setWhereTyped(true) }}
      />
      {!editing && (
        <>
          <Choices label="Repeat" options={REPEAT} value={repeat} onChange={(v) => setRepeat(v === 'series' ? 'series' : 'once')} />
          {repeat === 'series' && (
            <Field
              label="Every how many days"
              type="number"
              inputMode="numeric"
              min={1}
              value={every}
              onChange={(e) => setEvery(e.target.value)}
            />
          )}
        </>
      )}
    </CreateShell>
  )
}
