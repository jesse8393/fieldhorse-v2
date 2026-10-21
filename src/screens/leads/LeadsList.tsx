// The leads list, /leads (PHASE9_PLAN Task 9, SPEC D55, D65). Open and
// quoted leads from fh_leads, soonest follow up first, then the newest.
// Each row is who, what they need, and a chip when an estimate is on the
// books. A row opens the lead. New lead goes to the create screen
// (/leads/new, Task 8). Lost leads stay out of the list.
//
// The same component serves the phone and the desktop shell's 640 px
// column.

import { useMemo } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChevronLeft, Plus, Users } from 'lucide-react'
import { Button, Chip, EmptyState, IconButton, Row, SkeletonRows } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { useLeads, useLeadVisits } from '../../lib/queries.ts'
import {
  followUpLine, leadChip, leadName, leadNeed, listedLeads, nextVisitByLead, sortLeads
} from '../../lib/leadsView.ts'
import { newRecordRoute, recordRoute } from '../../lib/records.ts'
import { hapticTap } from '../../lib/haptics.ts'
import './leads.css'

export default function LeadsList() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const leadsQuery = useLeads(user?.id)
  const visitsQuery = useLeadVisits(user?.id)

  const now = new Date()
  const rows = useMemo(() => sortLeads(listedLeads(leadsQuery.data ?? [])), [leadsQuery.data])
  const visits = nextVisitByLead(visitsQuery.data, now)

  function goBack() {
    hapticTap()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/jobs')
  }

  let body
  if (leadsQuery.isPending) {
    body = <SkeletonRows rows={6} label="Loading leads" />
  } else if (leadsQuery.isError) {
    body = (
      <DataErrorState
        title="Could not load your leads"
        message="Check your connection and try again."
        actionLabel="Try again"
        onRetry={() => { void leadsQuery.refetch() }}
      />
    )
  } else if (rows.length === 0) {
    body = (
      <EmptyState
        icon={Users}
        title="No open leads."
        action={<Button variant="secondary" size="md" icon={Plus} to={newRecordRoute('lead')}>New lead</Button>}
      />
    )
  } else {
    body = (
      <ul className="fhl-rows" aria-label="Leads">
        {rows.map((lead) => {
          const chip = leadChip(lead, visits.get(lead.id))
          const next = chip
            ? <Chip label={chip.label} tone={chip.tone} />
            : followUpLine(lead, now)
          return (
            <Row
              key={lead.id}
              as="li"
              to={recordRoute('lead', lead.id)}
              title={leadName(lead)}
              subline={leadNeed(lead)}
              next={next}
            />
          )
        })}
      </ul>
    )
  }

  return (
    <div className="fhl fhl--list">
      <header className="fhl-head">
        <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
        <h1 className="fhl-list-title">Leads</h1>
        <Button variant="secondary" size="mini" icon={Plus} to={newRecordRoute('lead')}>New lead</Button>
      </header>
      {leadsQuery.isSuccess && rows.length > 0 && (
        <p className="fhl-count">{rows.length === 1 ? '1 open lead.' : `${rows.length} open leads.`}</p>
      )}
      <div className="fhl-body">{body}</div>
    </div>
  )
}
