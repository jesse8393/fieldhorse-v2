// Pipeline transitions with haptic + toast. Wraps the stage helpers from
// stages.ts so ContactDetail fires consistent feedback on every move.

import {
  transitionStage,
  startQuote as baseStartQuote,
  approveQuote as baseApproveQuote,
  markWon as baseMarkWon,
  completeJob as baseCompleteJob,
  markLost as baseMarkLost,
  logPayment as baseLogPayment,
  STAGE_MAP,
  type StageId
} from './stages.ts'
import { toast, hapticMedium, hapticSuccess } from './toast.ts'
import type { Database } from './database.types.ts'

// The stage helpers only read identity + display fields, never the full
// row — declare exactly that so projected list rows (JobRow) are valid
// inputs. A full fh_contacts Row remains assignable (superset).
type Contact = Pick<
  Database['public']['Tables']['fh_contacts']['Row'],
  'id' | 'user_id' | 'stage' | 'name' | 'job_title' | 'address' | 'amount'
>

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

// One-tap "Won" from the Leads board — moves to Job with no auto-kickoff
// event (approveQuote is the formal quote-approval path that schedules).
export async function markWon(contact: Contact) {
  const res = await baseMarkWon(contact)
  if (!res.error) {
    hapticMedium()
    toast('Marked won · moved to Job', { accent: 'job', heavy: true })
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

export async function logPayment(contact: Contact, input: { id?: string | null; amount?: number | string | null; method?: string | null; kind?: string | null; reference?: string | null; paid_on?: string | null; invoice_id?: string | null }) {
  const res = await baseLogPayment(contact, input)
  // Don't fire success UI when the write failed — the caller surfaces the
  // error (V3PaymentSheet throws on res.error). Firing a success haptic +
  // "Payment logged" toast here would contradict the caller's error toast.
  if (res && 'error' in res && (res as any).error) {
    return res
  }
  hapticSuccess()
  const paid = Number(input.amount || 0)
  // Gate the "Paid in full · moved to Closed" toast on whether stages.ts
  // ACTUALLY auto-closed. Recomputing a base-only contract here would lie
  // when the base is paid but approved change-order money is still owed
  // (stages.ts closes on base + approved COs).
  const closed = !!(res && 'closed' in res && (res as any).closed)
  if (closed) {
    toast(`Paid in full · moved to Closed`, { accent: 'closed', heavy: true })
  } else {
    toast(`Payment logged · $${paid.toLocaleString()}`, { accent: 'gold' })
  }
  return res
}
