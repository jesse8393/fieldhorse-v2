import StubTab from './_StubTab.jsx'

/**
 * DETAILS tab — sub-tab router.
 *
 * Sub-sections (to be built in Drop 3.1):
 *   - Milestones (contact.milestones JSONB, patch handler)
 *   - To-dos (fh_job_todos CRUD)
 *   - Scheduled (fh_schedule read-only, navigates to /schedule)
 *   - Inspections (fh_inspections CRUD + has_inspections toggle)
 *   - Invite Partner (wraps InvitePartnerSheet trigger)
 */
export default function DetailsTab(props) {
  return <StubTab name="Details" upcoming={['Milestones', 'To-dos', 'Scheduled', 'Inspections', 'Invite Partner']} />
}
