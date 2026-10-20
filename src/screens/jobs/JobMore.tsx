// The job's More screen, /jobs/:id/more (Phase 9, Task 13, D57). It took
// the place of the more sheet on the phone: the less frequent actions as
// rows (edit, the client, a follow up, a visit, a partner, mark lost) with
// Delete job apart at the bottom, which asks with a second tap. Each row
// is a route of its own; Back returns to the job.

import { useEffect, useRef } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { ChevronLeft } from 'lucide-react'
import { Button, IconButton, Row, SkeletonRows } from '../../components/fh'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useMembership } from '../../contexts/MembershipContext.tsx'
import { supabase } from '../../lib/supabase.ts'
import { markLost } from '../../lib/pipeline.ts'
import { followUpMeta } from '../../lib/followUp.ts'
import { newRecordRoute, recordRoute } from '../../lib/records.ts'
import { toastError, toastSuccess } from '../../lib/toast.ts'
import { hapticError } from '../../lib/haptics.ts'
import { useSecondTap } from '../../lib/secondTap.ts'
import { useJobScreen } from './jobScreen.tsx'
import '../new/new.css'

export default function JobMore() {
  const { id = '' } = useParams()
  const { user, data, home, goBack } = useJobScreen(id)
  const navigate = useNavigate()
  const membership = useMembership()
  const deleteTap = useSecondTap()
  const lostTap = useSecondTap()
  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [data.loading])

  const contact = data.contact
  const stage = String(contact?.stage || '').toLowerCase()
  const canMoveMoney = !membership.loading && membership.canCreateFinancialDocs
  // Deleting a job is owner only, inside the viewer's own company.
  const canDelete = !!contact && !membership.loading && membership.canBillOrDelete
    && (!contact.org_id || contact.org_id === membership.orgId)
  const isOwnerView = !!user?.id && contact?.user_id === user.id
  // A contact row still at a sales stage can be marked lost; a won job cannot.
  const canMarkLost = canMoveMoney && (stage === 'lead' || stage === 'quote')
  const followUp = followUpMeta(contact?.follow_up_on ?? null)

  async function remove() {
    if (!contact || !canDelete) return
    const name = contact.name || 'this job'
    // By id only: the owner deletes any job in the company and RLS scopes
    // the tenant. The select turns a zero row delete into a visible failure.
    const { data: removed, error } = await supabase.from('fh_contacts').delete().eq('id', contact.id).select('id')
    if (error) { toastError("Couldn't delete this job", error.message || 'Check your connection and try again.'); return }
    if (!removed || removed.length === 0) {
      toastError("This job wasn't deleted", 'It may already be gone, or your account cannot delete it.')
      return
    }
    toastSuccess('Deleted', `${name} and everything attached removed`)
    navigate('/jobs', { replace: true })
  }

  async function lost() {
    if (!contact || !canMarkLost) return
    hapticError()
    const res: any = await markLost(contact)
    if (res?.error) { toastError("Couldn't mark lost", res.error.message || 'Try again'); return }
    await data.fetchAll()
    goBack()
  }

  const title = contact ? (contact.job_title || contact.name || 'This job') : 'This job'

  return (
    <div className="fhnew">
      <header className="fhnew-head">
        <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
        <h1 className="fhnew-title" ref={titleRef} tabIndex={-1}>{title}</h1>
      </header>
      {data.loading ? (
        <div className="fhnew-body"><SkeletonRows rows={4} label="Loading the job" /></div>
      ) : !contact ? (
        <div className="fhnew-body">
          <DataErrorState
            title={data.isError ? "Couldn't load this job" : 'This job is gone'}
            message={data.isError ? 'Check your connection and try again.' : 'It may have been deleted.'}
            actionLabel={data.isError ? 'Try again' : ''}
            onRetry={() => { void data.fetchAll() }}
          />
        </div>
      ) : (
        <>
          <ul className="fhja-rows" aria-label="More actions">
            <Row as="li" title="Edit job details" to={`${home}?edit=1`} />
            {stage !== 'lost' && stage !== 'closed' && (
              <Row as="li" title="Set follow up" subline={followUp?.label} to={`${home}/follow-up`} />
            )}
            {isOwnerView && contact.client_id && (
              <Row as="li" title="Open the client" subline={data.clientSummary?.name || undefined} to={recordRoute('client', contact.client_id)} />
            )}
            <Row as="li" title="Schedule an event" to={`/schedule/new?job=${encodeURIComponent(contact.id)}`} />
            <Row as="li" title="Invite a partner" to={`${home}/partner`} />
            {canMoveMoney && stage !== 'lost' && stage !== 'closed' && (
              <Row as="li" title="Invoice this" subline="A new invoice with the balance" to={newRecordRoute('invoice', { job: contact.id })} />
            )}
          </ul>
          {(canMarkLost || canDelete) && (
            <div className="fhja-danger">
              {canMarkLost && (
                <Button variant="destructive" block onClick={() => lostTap.tap(() => { void lost() })}>
                  {lostTap.armed ? 'Tap again to mark lost' : 'Mark lost'}
                </Button>
              )}
              {canDelete && (
                <>
                  <Button variant="destructive" block onClick={() => deleteTap.tap(() => { void remove() })}>
                    {deleteTap.armed ? 'Tap again to delete' : 'Delete job'}
                  </Button>
                  {deleteTap.armed && (
                    <p className="fhja-danger__why">
                      Removing {contact.name || 'this job'} takes its {data.subs.length} subs, {data.expenses.length} expenses, {data.payments.length} payments, {data.inspections.length} inspections and {data.scheduleCount} schedule items with it, and archives its {data.notes.length} notes. This cannot be undone.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </>
      )}
    </div>
  )
}
