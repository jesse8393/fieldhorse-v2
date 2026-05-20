// Pipeline transitions with haptic + toast. Wraps the stage helpers from
// stages.ts so ContactDetail fires consistent feedback on every move.

import {
  transitionStage,
  startQuote as baseStartQuote,
  approveQuote as baseApproveQuote,
  completeJob as baseCompleteJob,
  markLost as baseMarkLost,
  logPayment as baseLogPayment,
  STAGE_MAP
} from './stages.ts'
import { toast, hapticMedium, hapticSuccess } from './toast.js'

function notify(stageId, verb = 'Moved to') {
  const s = STAGE_MAP[stageId]
  if (!s) return
  hapticMedium()
  toast(`${verb} ${s.label}`, { accent: stageId })
}

export async function startQuote(contact) {
  const res = await baseStartQuote(contact)
  if (!res.error) notify('quote')
  return res
}

export async function approveQuote(contact) {
  const res = await baseApproveQuote(contact)
  if (!res.error) {
    hapticMedium()
    toast('Moved to Job · Scheduled for tomorrow 9am', { accent: 'job', heavy: true })
  }
  return res
}

export async function markComplete(contact) {
  const res = await baseCompleteJob(contact)
  if (!res.error) notify('invoice')
  return res
}

export async function markLost(contact) {
  const res = await baseMarkLost(contact)
  if (!res.error) notify('lost', 'Marked as')
  return res
}

export async function reopen(contact) {
  // Closed/lost → back to invoice (if amount owed) else job
  const next = contact.stage === 'closed' ? 'invoice' : 'lead'
  const res = await transitionStage(contact, next)
  if (!res.error) notify(next, 'Reopened to')
  return res
}

export async function logPayment(contact, input) {
  const res = await baseLogPayment(contact, input)
  hapticSuccess()
  const paid = Number(input.amount || 0)
  if (res && res.total !== undefined && res.total >= Number(contact.amount || 0) && contact.stage !== 'closed') {
    toast(`Paid in full · moved to Closed`, { accent: 'closed', heavy: true })
  } else {
    toast(`Payment logged · $${paid.toLocaleString()}`, { accent: 'gold' })
  }
  return res
}
