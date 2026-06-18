// Pipeline transitions with haptic + toast. Wraps the stage helpers from
// stages.ts so ContactDetail fires consistent feedback on every move.

import {
  transitionStage,
  startQuote as baseStartQuote,
  approveQuote as baseApproveQuote,
  completeJob as baseCompleteJob,
  markLost as baseMarkLost,
  logPayment as baseLogPayment,
  STAGE_MAP,
  type StageId
} from './stages.ts'
import { toast, hapticMedium, hapticSuccess } from './toast.ts'
import type { Database } from './database.types.ts'

type Contact = Database['public']['Tables']['fh_contacts']['Row']

function notify(stageId: string, verb = 'Moved to') {
  const s = STAGE_MAP[stageId]
  if (!s) return
  hapticMedium()
  toast(`${verb} ${s.label}`, { accent: stageId })
}

export async function startQuote(contact: Contact) {
  const res = await baseStartQuote(contact)
  if (!res.error) notify('quote')
  return res
}

export async function approveQuote(contact: Contact) {
  const res = await baseApproveQuote(contact)
  if (!res.error) {
    hapticMedium()
    const scheduleFailed = 'scheduleError' in res && !!res.scheduleError
    if (scheduleFailed) {
      toast('Moved to Job. Schedule manually.', { accent: 'job', heavy: true })
      return res
    }
    toast('Moved to Job · Scheduled for tomorrow 9am', { accent: 'job', heavy: true })
  }
  return res
}

export async function markComplete(contact: Contact) {
  const res = await baseCompleteJob(contact)
  if (!res.error) {
    hapticMedium()
    toast('Marked complete · send the final invoice', { accent: 'gold', heavy: true })
  }
  return res
}

export async function markLost(contact: Contact) {
  const res = await baseMarkLost(contact)
  if (!res.error) notify('lost', 'Marked as')
  return res
}

export async function reopen(contact: Contact) {
  // closed → job (billing adjustments / extra payments happen on the
  // job itself now that invoicing isn't a stage). lost → lead (they're
  // back in play but uncommitted).
  const next: StageId = contact.stage === 'closed' ? 'job' : 'lead'
  const res = await transitionStage(contact, next)
  if (!res.error) notify(next, 'Reopened to')
  return res
}

export async function logPayment(contact: Contact, input: { amount?: number | string | null; method?: string | null; kind?: string | null; reference?: string | null; paid_on?: string | null; invoice_id?: string | null }) {
  const res = await baseLogPayment(contact, input)
  hapticSuccess()
  const paid = Number(input.amount || 0)
  const total = res && 'total' in res ? res.total : undefined
  // Mirror the guard in stages.ts logPayment: only call this "paid in
  // full" when there's a real contract amount that's now covered.
  // Otherwise (amount=0, e.g. a freshly created quick invoice) total >= 0
  // is always true and the toast lies.
  const contractAmount = Number(contact.amount || 0)
  if (total !== undefined && contractAmount > 0 && total >= contractAmount && contact.stage !== 'closed') {
    toast(`Paid in full · moved to Closed`, { accent: 'closed', heavy: true })
  } else {
    toast(`Payment logged · $${paid.toLocaleString()}`, { accent: 'gold' })
  }
  return res
}
