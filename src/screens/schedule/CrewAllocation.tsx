import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { orgMembersList, type OrgMember } from '../../lib/orgApi.ts'
import { allocationConflicts, fetchAllocationEvents, type AllocationEvent, type VisitWindow } from '../../lib/scheduleAllocation.ts'

type Props = { orgId: string; visits: VisitWindow[]; assignedIds: string[]; onChange: (ids: string[]) => void; editingId?: string; disabled?: boolean; readOnly?: boolean }

export default function CrewAllocation({ orgId, visits, assignedIds, onChange, editingId, disabled, readOnly }: Props) {
  const [members, setMembers] = useState<OrgMember[]>([])
  const [events, setEvents] = useState<AllocationEvent[]>([])
  const [rosterState, setRosterState] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [availability, setAvailability] = useState<'loading' | 'ready' | 'failed'>('loading')
  const [attempt, setAttempt] = useState(0)
  const [search, setSearch] = useState('')

  useEffect(() => {
    let alive = true
    setMembers([])
    setRosterState('loading')
    orgMembersList().then((result) => {
      if (!alive) return
      if (result.org_id !== orgId) { setRosterState('failed'); return }
      setMembers(result.members)
      setRosterState('ready')
    }).catch(() => { if (alive) setRosterState('failed') })
    return () => { alive = false }
  }, [orgId, attempt])

  useEffect(() => {
    let alive = true
    setEvents([])
    setAvailability('loading')
    if (!visits.length) return () => { alive = false }
    const timer = window.setTimeout(() => {
      fetchAllocationEvents(orgId, visits).then((rows) => {
        if (alive) { setEvents(rows); setAvailability('ready') }
      }).catch(() => { if (alive) setAvailability('failed') })
    }, 250)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [orgId, visits, attempt])

  const conflicts = useMemo(() => allocationConflicts(visits, members.map((member) => member.user_id), events, editingId), [visits, members, events, editingId])
  const shown = members.filter((member) => [member.name, member.email, member.role].join(' ').toLowerCase().includes(search.trim().toLowerCase()))
  const missing = assignedIds.filter((id) => !members.some((member) => member.user_id === id))
  const selectedConflicts = conflicts.filter((conflict) => assignedIds.includes(conflict.userId))
  const unavailable = rosterState === 'failed' || availability === 'failed'

  return (
    <section className="fhev-crew" aria-label="Crew allocation">
      <div className="fhev-crew__heading"><h2>Crew availability</h2><span>{assignedIds.length} assigned</span></div>
      <p>Availability reflects this company's recorded visits for every date in this event. Other companies and unrecorded time off are not included. Add time off as a crew visit to reserve it.</p>
      {readOnly && <p>Only an owner, admin or manager can assign crew or move an assigned visit.</p>}
      {unavailable && <div role="status" className="fhev-crew__error"><p>{rosterState === 'failed' ? 'Team roster unavailable.' : 'Crew scheduling unavailable. Availability could not be verified.'} Unassigned visits can still be saved.</p><button type="button" onClick={() => setAttempt((n) => n + 1)}>Try again</button></div>}
      {rosterState === 'loading' && <p role="status">Loading team roster</p>}
      {rosterState === 'ready' && <>
        <label className="fhev-crew__search">Find crew<input type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search name or role" /></label>
        {shown.length === 0 && <p>{members.length ? 'No matching team members.' : 'No active team members.'}</p>}
        <div className="fhev-crew__members">
          {shown.map((member) => {
            const busy = conflicts.filter((conflict) => conflict.userId === member.user_id)
            const checked = assignedIds.includes(member.user_id)
            return <label key={member.user_id} className="fhev-crew__member">
              <input type="checkbox" checked={checked} disabled={disabled || readOnly || availability !== 'ready' || (!checked && busy.length > 0)}
                onChange={() => onChange(checked ? assignedIds.filter((id) => id !== member.user_id) : [...assignedIds, member.user_id])} />
              <span><strong>{member.name || member.email || `Member ${member.user_id.slice(0, 8)}`}</strong><small>{member.role} · {availability !== 'ready' ? 'Availability unknown' : busy.length ? `${busy.length} ${busy.length === 1 ? 'conflict' : 'conflicts'}` : 'No scheduled conflicts'}</small></span>
            </label>
          })}
        </div>
      </>}
      {missing.length > 0 && rosterState === 'ready' && <div className="fhev-crew__error"><p>{missing.length} assigned {missing.length === 1 ? 'person is' : 'people are'} absent from the current roster. Check before saving.</p>{!readOnly && <button type="button" disabled={disabled} onClick={() => onChange(assignedIds.filter((id) => !missing.includes(id)))}>Remove unavailable members</button>}</div>}
      {selectedConflicts.length > 0 && availability === 'ready' && <div className="fhev-crew__error" role="alert"><p>Resolve these conflicts before saving.</p><ul>{selectedConflicts.map((conflict, index) => <li key={`${conflict.userId}-${conflict.eventId}-${index}`}>
        {members.find((member) => member.user_id === conflict.userId)?.name || 'Selected crew'}: {conflict.eventId ? <Link to={`/schedule/${encodeURIComponent(conflict.eventId)}/edit`}>{conflict.title}</Link> : conflict.title}, {new Date(conflict.start_at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}
      </li>)}</ul></div>}
      {availability === 'loading' && visits.length > 0 && <p role="status">Checking all visit dates</p>}
    </section>
  )
}
