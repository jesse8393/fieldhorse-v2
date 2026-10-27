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
import RecordPicker from '../../components/RecordPicker.tsx'
import CrewAllocation from './CrewAllocation.tsx'
import { useMembership } from '../../contexts/MembershipContext.tsx'
import { eventAssignees, canAllocateCrew, allocationConflicts, fetchAllocationEvents, allocationWriteError } from '../../lib/scheduleAllocation.ts'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { supabase } from '../../lib/supabase.ts'
import { useOrgScope } from '../../lib/orgScope.ts'
import { useInvalidateSchedule, useCompanyJobs, useLeads, useQuotes, type JobRow, type LeadRow, type QuoteRow } from '../../lib/queries.ts'
import { createScheduleEvents } from '../../lib/scheduleWrite.ts'
import { toastError, toastSuccess } from '../../lib/toast.ts'
import { todayYmd, toYmd } from '../../lib/dates.ts'
import { localDateTimeMs, eventDurationMs, scheduleOccurrences } from '../../lib/scheduleDates.ts'
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
  assigned_to?: string | null
  assigned_user_ids?: string[] | null
}

const REPEAT = [
  { value: 'once', label: 'One time' },
  { value: 'series', label: 'Recurring series' }
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

async function fetchEvent(id: string, userId: string, orgId: string | null): Promise<EventRow | null> {
  const query = supabase
    .from('fh_schedule')
    .select('*')
    .eq('id', id)
  const { data, error } = await (orgId ? query.eq('org_id', orgId) : query.eq('user_id', userId)).maybeSingle()
  if (error) throw error
  return (data as EventRow | null) ?? null
}

export default function EventNew() {
  const { eventId } = useParams()
  const { user } = useAuth()
  const orgScope = useOrgScope(user?.id)
  const [eventState, setEventState] = useState<{ status: 'loading' | 'ready' | 'missing' | 'failed'; row: EventRow | null }>(
    () => ({ status: eventId ? 'loading' : 'ready', row: null })
  )
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    if (!eventId || !user?.id || orgScope === undefined) return
    let alive = true
    setEventState({ status: 'loading', row: null })
    fetchEvent(eventId, user.id, orgScope)
      .then((row) => { if (alive) setEventState({ status: row ? 'ready' : 'missing', row }) })
      .catch(() => { if (alive) setEventState({ status: 'failed', row: null }) })
    return () => { alive = false }
  }, [eventId, attempt, user?.id, orgScope])

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

  return <EventForm key={`${orgScope || 'personal'}:${eventState.row?.id ?? 'new'}`} event={eventState.row} />
}

function EventForm({ event }: { event: EventRow | null }) {
  const editing = !!event
  const navigate = useNavigate()
  const { user } = useAuth()
  const [params] = useSearchParams()
  const orgScope = useOrgScope(user?.id)
  const membership = useMembership()
  const mayAllocate = canAllocateCrew(membership.role)
  const invalidateSchedule = useInvalidateSchedule()

  // The three kinds of record a visit can belong to (D53).
  const jobsQuery = useCompanyJobs()
  const leadsQuery = useLeads(membership.canSeeFinancials ? user?.id : undefined)
  const quotesQuery = useQuotes(membership.canSeeFinancials ? user?.id : undefined)
  const jobs = useMemo<JobRow[]>(
    () => ((jobsQuery.data ?? []) as JobRow[]).filter((j) => !isMovedStage(j.stage) && j.stage !== 'lost'),
    [jobsQuery.data]
  )
  const leads = useMemo<LeadRow[]>(() => membership.canSeeFinancials ? (leadsQuery.data ?? []).filter((l) => l.status !== 'lost') : [], [leadsQuery.data, membership.canSeeFinancials])
  const quotes = useMemo<QuoteRow[]>(() => membership.canSeeFinancials ? (quotesQuery.data ?? []).filter((q) => q.status !== 'lost') : [], [quotesQuery.data, membership.canSeeFinancials])

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
  const [occurrences, setOccurrences] = useState('5')
  const [duration, setDuration] = useState(() => String(eventDurationMs(event) / 60_000))
  const [assignedIds, setAssignedIds] = useState(() => eventAssignees(event))
  const [saving, setSaving] = useState(false)
  const [errors, setErrors] = useState<{ title?: string; when?: string; duration?: string; recurrence?: string; save?: string }>({})
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

  const listsLoading = jobsQuery.isPending || (membership.canSeeFinancials && (leadsQuery.isPending || quotesQuery.isPending))

  const visitPreview = useMemo(() => scheduleOccurrences(date, time, Number(duration), repeat === 'series' ? Number(every) : 7, repeat === 'series' ? Number(occurrences) : 1), [date, time, duration, repeat, every, occurrences])

  async function save() {
    if (saving) return
    const next: typeof errors = {}
    if (!title.trim()) next.title = 'Give the event a title.'
    const startMs = localDateTimeMs(date, time)
    if (startMs == null) next.when = 'Pick a date and a time.'
    if (!Number.isFinite(Number(duration)) || Number(duration) <= 0) next.duration = 'Enter a duration above zero.'
    if (!next.when && !next.duration && visitPreview.length === 0) next.recurrence = 'Use whole days and 2 to 52 visits.'
    if (repeat === 'series' && Number(occurrences) < 2) next.recurrence = 'Choose at least two visits.'
    setErrors(next)
    if (Object.keys(next).length || startMs == null) return
    setSaving(true)
    try {
      if (orgScope === undefined || membership.loading) throw new Error('Your workspace is still loading. Try again shortly.')
      if (assignedIds.length) {
        if (!mayAllocate) throw new Error('Only an owner, admin or manager can change an assigned visit.')
        if (!orgScope) throw new Error('Choose a company before assigning crew.')
        const latest = await fetchAllocationEvents(orgScope, visitPreview)
        if (allocationConflicts(visitPreview, assignedIds, latest, event?.id).length) throw new Error('A selected crew member has a scheduling conflict. Choose another time or crew.')
      }
      if (event) {
        // Update one row with the selected duration. Matched
        // by id only: RLS scopes the company, and .select('id') turns a zero
        // row update into a visible failure.
        const { data: updated, error } = await supabase.from('fh_schedule').update({
          title: title.trim(),
          description: where.trim() || null,
          contact_id: link?.kind === 'job' ? link.id : null,
          lead_id: link?.kind === 'lead' ? link.id : null,
          quote_id: link?.kind === 'quote' ? link.id : null,
          start_at: new Date(startMs).toISOString(),
          end_at: visitPreview[0].end_at,
          ...(mayAllocate && (assignedIds.length > 0 || eventAssignees(event).length > 0) ? { assigned_user_ids: assignedIds, assigned_to: assignedIds[0] || null } : {})
        }).eq('id', event.id).select('id')
        if (error) throw new Error(allocationWriteError(error))
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
      const seriesId = repeat === 'series' ? (crypto.randomUUID?.() || `series-${startMs}`) : null
      const row = (visit: { start_at: string; end_at: string }) => ({
        userId: user?.id as string,
        orgId: orgScope ?? null,
        contactId: link?.kind === 'job' ? link.id : null,
        leadId: link?.kind === 'lead' ? link.id : null,
        quoteId: link?.kind === 'quote' ? link.id : null,
        title,
        description: where,
        ...visit,
        recurring: seriesId,
        ...(assignedIds.length ? { assignedUserIds: assignedIds } : {})
      })
      const rows = visitPreview.map(row)
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
      <Field label="Duration in minutes" type="number" inputMode="numeric" min={1} value={duration} error={errors.duration} onChange={(e) => setDuration(e.target.value)} />
      {visitPreview[0] && <p className="fhev-pick__helper">Ends {new Date(visitPreview[0].end_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</p>}
      <RecordPicker id="fhev-link" label="Link to" value={linkValue(link)} onChange={(value) => setLink(parseLink(value))}
        disabled={saving} loading={listsLoading} clearLabel="None" placeholder="Search customer, project or address"
        error={jobsQuery.isError || (membership.canSeeFinancials && (leadsQuery.isError || quotesQuery.isError)) ? 'Some records could not load. Existing links remain selected.' : undefined}
        options={[
          ...(presetMissing && link ? [{ value: linkValue(link), label: `Linked ${link.kind}`, description: 'Unavailable in this list' }] : []),
          ...jobs.map((j) => ({ value: `job:${j.id}`, label: jobLabel(j), description: [j.job_title, j.address, j.id.slice(0, 8)].filter(Boolean).join(' · '), group: 'Jobs' })),
          ...(membership.canSeeFinancials ? leads.map((l) => ({ value: `lead:${l.id}`, label: leadName(l), description: [leadNeed(l), l.fh_clients?.address, l.id.slice(0, 8)].filter(Boolean).join(' · '), group: 'Leads' })) : []),
          ...(membership.canSeeFinancials ? quotes.map((q) => ({ value: `quote:${q.id}`, label: q.fh_clients?.name?.trim() || q.title || 'Unnamed quote', description: [q.title, q.fh_clients?.address, q.id.slice(0, 8)].filter(Boolean).join(' · '), group: 'Quotes' })) : [])
        ]} />
      <Field
        label="Where"
        value={where}
        placeholder="Client and address"
        autoComplete="off"
        onChange={(e) => { setWhere(e.target.value); setWhereTyped(true) }}
      />
      {orgScope && <CrewAllocation orgId={orgScope} visits={visitPreview} assignedIds={assignedIds} onChange={setAssignedIds} editingId={event?.id} disabled={saving} readOnly={!mayAllocate} />}
      {!editing && (
        <>
          <Choices label="Repeat" options={REPEAT} value={repeat} onChange={(v) => setRepeat(v === 'series' ? 'series' : 'once')} />
          {repeat === 'series' && (
            <>
              <div className="fhev-when">
                <Field label="Repeat every days" type="number" inputMode="numeric" min={1} step={1} value={every} onChange={(e) => setEvery(e.target.value)} />
                <Field label="Total visits" type="number" inputMode="numeric" min={2} max={52} step={1} value={occurrences} error={errors.recurrence} onChange={(e) => setOccurrences(e.target.value)} />
              </div>
              <section className="fhev-preview" aria-label="Recurring visit preview">
                <p>{visitPreview.length} visits total, including this date. Every {every || '?'} days.</p>
                <ol>{visitPreview.map((visit) => <li key={visit.start_at}>{new Date(visit.start_at).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })} until {new Date(visit.end_at).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}</li>)}</ol>
              </section>
            </>
          )}
        </>
      )}
    </CreateShell>
  )
}
