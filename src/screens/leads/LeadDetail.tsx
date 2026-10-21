// The lead screen, /leads/:id (PHASE9_PLAN Task 9, SPEC D53, D55, D57,
// D60). A lead is information from a customer who has no quote yet. The
// screen shows who (the client's name and phone with Call and Message),
// where (the address with Navigate), what they need, notes saved in place
// on blur with the sync pill, the next estimate visit when one is booked,
// the two buttons Schedule estimate and Quote this, Mark lost with a
// second tap on the same button, and the notes left on the contact row
// the migration moved, under Earlier notes. No sheet, no dialog.
//
// The id may be an old fh_contacts id (a link saved before the move) or a
// contact that still lives on fh_contacts. When no fh_leads row has the
// id, the screen renders `fallback`, the old detail screen, which follows
// origin_contact_id to the new lead itself (MovedRecordRedirect).

import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { CalendarPlus, ChevronLeft, FileText, MessageSquare, Navigation, Phone } from 'lucide-react'
import { Button, Chip, Field, IconButton, SkeletonRows, SyncPill } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { supabase } from '../../lib/supabase.ts'
import { useLead, useInvalidateLeads, leadKey, type LeadRow } from '../../lib/queries.ts'
import { markLeadLost } from '../../lib/leads.ts'
import { leadName, leadNeed, scheduleEstimateRoute, visitDay, visitTime } from '../../lib/leadsView.ts'
import { newRecordRoute, recordRoute } from '../../lib/records.ts'
import { navigateHrefHere } from '../../lib/todayView.ts'
import { resilientUpdate } from '../../lib/outbox.ts'
import { formatPhone } from '../../lib/utils.ts'
import { hapticTap } from '../../lib/haptics.ts'
import { toastError } from '../../lib/toast.ts'
import './leads.css'

type Visit = { id: string; title: string | null; start_at: string | null; end_at: string | null }
type Note = { id: string; text: string | null; created_at: string | null; category: string | null }

/** The 4 seconds the second tap has before Mark lost goes back to resting (D57). */
const CONFIRM_MS = 4000

async function fetchNextVisit(leadId: string): Promise<Visit | null> {
  const { data, error } = await supabase
    .from('fh_schedule')
    .select('id, title, start_at, end_at')
    .eq('lead_id', leadId)
    .gte('start_at', new Date().toISOString())
    .order('start_at', { ascending: true })
    .limit(1)
  if (error) throw error
  return ((data ?? []) as Visit[])[0] ?? null
}

// Notes on the lead itself and notes left on the contact row it came
// from, newest first. Two reads rather than one or() so each stays a
// plain index lookup.
async function fetchEarlierNotes(leadId: string, originContactId: string | null): Promise<Note[]> {
  const own = supabase.from('fh_notes').select('id, text, created_at, category').eq('lead_id', leadId)
  const origin = originContactId
    ? supabase.from('fh_notes').select('id, text, created_at, category').eq('contact_id', originContactId)
    : null
  const [a, b] = await Promise.all([own, origin])
  if (a.error) throw a.error
  if (b?.error) throw b.error
  const seen = new Set<string>()
  const out: Note[] = []
  for (const n of [...((a.data ?? []) as Note[]), ...((b?.data ?? []) as Note[])]) {
    if (!n.text?.trim() || seen.has(n.id)) continue
    seen.add(n.id)
    out.push(n)
  }
  return out.sort((x, y) => (y.created_at ?? '').localeCompare(x.created_at ?? ''))
}

function noteDay(iso: string | null): string {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export type LeadDetailProps = {
  id: string
  /** What shows when no fh_leads row has this id: the old detail screen. */
  fallback: ReactNode
}

export default function LeadDetail({ id, fallback }: LeadDetailProps) {
  const { user } = useAuth()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const invalidateLeads = useInvalidateLeads()
  const leadQuery = useLead(id, user?.id)
  const lead = leadQuery.data ?? null

  const leadId = lead?.id
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { if (leadId) titleRef.current?.focus({ preventScroll: true }) }, [leadId])

  const visitQuery = useQuery({
    queryKey: ['leadNextVisit', id],
    queryFn: () => fetchNextVisit(id),
    enabled: !!lead
  })
  const notesQuery = useQuery({
    queryKey: ['leadEarlierNotes', id, lead?.origin_contact_id ?? null],
    queryFn: () => fetchEarlierNotes(id, lead?.origin_contact_id ?? null),
    enabled: !!lead
  })

  // Notes: the field owns its text while the person types; the row's
  // value seeds it once per lead and after each save.
  const [notes, setNotes] = useState('')
  const [notesSeeded, setNotesSeeded] = useState<string | null>(null)
  const savedNotes = useRef<string | null>(null)
  if (lead && notesSeeded !== lead.id) {
    setNotesSeeded(lead.id)
    setNotes(lead.notes ?? '')
    savedNotes.current = lead.notes ?? ''
  }

  async function saveNotes() {
    if (!lead) return
    const next = notes.trim()
    const before = (savedNotes.current ?? '').trim()
    if (next === before) return
    savedNotes.current = next
    const res = await resilientUpdate('fh_leads', { id: lead.id }, { notes: next || null }, { userId: user?.id })
    if (res.error) {
      savedNotes.current = before
      toastError('Could not save the notes.', 'Check your connection and try again.')
      return
    }
    queryClient.setQueryData<LeadRow | null>(leadKey(lead.id), (prev) => (prev ? { ...prev, notes: next || null } : prev))
    invalidateLeads()
  }

  // Mark lost: the first tap arms the button, the second within 4 seconds
  // writes (D57). No dialog.
  const [armed, setArmed] = useState(false)
  const [losing, setLosing] = useState(false)
  useEffect(() => {
    if (!armed) return
    const t = window.setTimeout(() => setArmed(false), CONFIRM_MS)
    return () => window.clearTimeout(t)
  }, [armed])

  async function handleMarkLost() {
    hapticTap()
    if (!lead || losing) return
    if (!armed) { setArmed(true); return }
    setArmed(false)
    setLosing(true)
    try {
      await markLeadLost(lead.id)
      queryClient.setQueryData<LeadRow | null>(leadKey(lead.id), (prev) => (prev ? { ...prev, status: 'lost' } : prev))
      invalidateLeads()
    } catch {
      toastError('Could not mark the lead lost.', 'Check your connection and try again.')
    } finally {
      setLosing(false)
    }
  }

  function goBack() {
    hapticTap()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/leads')
  }

  const client = lead?.fh_clients ?? null
  const phone = client?.phone?.trim() || ''
  const address = client?.address?.trim() || ''
  const visitAt = useMemo(() => {
    const iso = visitQuery.data?.start_at
    if (!iso) return null
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? null : d
  }, [visitQuery.data?.start_at])

  if (leadQuery.isPending) {
    return (
      <div className="fhl">
        <header className="fhl-head">
          <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
          <span className="fhl-head__kind">Lead</span>
        </header>
        <div className="fhl-body"><SkeletonRows rows={4} label="Loading the lead" /></div>
      </div>
    )
  }

  if (leadQuery.isError) {
    return (
      <div className="fhl">
        <header className="fhl-head">
          <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
          <span className="fhl-head__kind">Lead</span>
        </header>
        <div className="fhl-body">
          <DataErrorState
            title="Could not load this lead"
            message="Check your connection and try again."
            actionLabel="Try again"
            onRetry={() => { void leadQuery.refetch() }}
          />
        </div>
      </div>
    )
  }

  // Not a lead row: an old contact id, or a live job. The old screen
  // knows what to do with both.
  if (!lead) return <>{fallback}</>

  const lost = lead.status === 'lost'
  const quoted = lead.status === 'quoted'
  const statusChip = lost
    ? <Chip label="Lost" tone="neutral" />
    : quoted
      ? <Chip label="Quoted" tone="success" />
      : null
  const notesList = notesQuery.data ?? []

  return (
    <div className="fhl">
      <header className="fhl-head">
        <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
        <span className="fhl-head__kind">Lead</span>
        <SyncPill className="fhl-head__sync" />
      </header>

      <div className="fhl-body">
        <section className="fhl-who" aria-label="Who">
          <div className="fhl-who__top">
            <h1 className="fhl-title" ref={titleRef} tabIndex={-1}>{leadName(lead)}</h1>
            {statusChip}
          </div>
          {phone ? (
            <div className="fhl-line">
              <span className="fhl-line__text">{formatPhone(phone)}</span>
              <span className="fhl-line__actions">
                <Button variant="secondary" size="mini" icon={Phone} href={`tel:${phone}`}>Call</Button>
                <Button variant="secondary" size="mini" icon={MessageSquare} href={`sms:${phone}`}>Message</Button>
              </span>
            </div>
          ) : (
            <p className="fhl-muted">No phone number yet.</p>
          )}
          {address ? (
            <div className="fhl-line">
              <span className="fhl-line__text">{address}</span>
              <span className="fhl-line__actions">
                <Button
                  variant="secondary"
                  size="mini"
                  trailingIcon={Navigation}
                  href={navigateHrefHere(address)}
                  target="_blank"
                  rel="noreferrer"
                >
                  Navigate
                </Button>
              </span>
            </div>
          ) : (
            <p className="fhl-muted">No address yet.</p>
          )}
        </section>

        <section className="fhl-section" aria-labelledby="fhl-need-title">
          <h2 className="fhl-section__title" id="fhl-need-title">What they need</h2>
          <p className="fhl-need">{leadNeed(lead)}</p>
          {(lead.job_type || lead.source || lead.referred_by) && (
            <p className="fhl-muted">
              {[lead.job_type, lead.source && `From ${lead.source}`, lead.referred_by && lead.referred_by !== lead.source && `Referred by ${lead.referred_by}`]
                .filter(Boolean)
                .join('. ')}
            </p>
          )}
        </section>

        {!lost && (
          <div className="fhl-actions">
            <Button variant="primary" size="lg" block icon={CalendarPlus} to={scheduleEstimateRoute(lead.id)}>
              Schedule estimate
            </Button>
            {quoted && lead.quote_id ? (
              <Button variant="secondary" size="lg" block icon={FileText} to={recordRoute('quote', lead.quote_id)}>
                Open the quote
              </Button>
            ) : (
              <Button variant="secondary" size="lg" block icon={FileText} to={newRecordRoute('quote', { lead: lead.id })}>
                Quote this
              </Button>
            )}
          </div>
        )}

        {visitAt && (
          <section className="fhl-section fhl-visit" aria-label="Next estimate visit">
            <h2 className="fhl-section__title">Next estimate visit</h2>
            <p className="fhl-visit__when">
              <span className="fhl-visit__day">{visitDay(visitAt)}</span>
              <span className="fhl-visit__time">{visitTime(visitAt)}</span>
            </p>
            {visitQuery.data?.title && visitQuery.data.title !== 'Estimate' && (
              <p className="fhl-muted">{visitQuery.data.title}</p>
            )}
          </section>
        )}

        <section className="fhl-section">
          <Field
            multiline
            label="Notes"
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={() => { void saveNotes() }}
            placeholder="What they said, what to bring, what to check"
            helper="Saved when you leave the field."
            rows={4}
          />
        </section>

        {notesList.length > 0 && (
          <section className="fhl-section" aria-label="Earlier notes">
            <h2 className="fhl-section__title">Earlier notes</h2>
            <ul className="fhl-notes">
              {notesList.map((n) => (
                <li key={n.id} className="fhl-note">
                  <p className="fhl-note__text">{n.text}</p>
                  <p className="fhl-note__when">{noteDay(n.created_at)}</p>
                </li>
              ))}
            </ul>
          </section>
        )}

        {!lost && (
          <div className="fhl-lost">
            <Button
              variant={armed ? 'destructive' : 'quiet'}
              size="md"
              onClick={() => { void handleMarkLost() }}
              disabled={losing}
              aria-live="polite"
            >
              {armed ? 'Tap again to mark lost' : 'Mark lost'}
            </Button>
          </div>
        )}
      </div>
    </div>
  )
}
