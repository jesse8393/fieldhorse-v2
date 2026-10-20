// Pipeline transitions with haptic + toast. Wraps the stage helpers from
// stages.ts so ContactDetail fires consistent feedback on every move.

import {
  transitionStage,
  completeJob as baseCompleteJob,
  markLost as baseMarkLost,
  logPayment as baseLogPayment,
  STAGE_MAP,
  type StageId
} from './stages.ts'
import { toast, hapticMedium, hapticSuccess } from './toast.ts'
import { moneyExact } from './format.ts'
import type { Database } from './database.types.ts'

// The stage helpers only read identity + display fields, never the full
// row, declare exactly that so projected list rows (JobRow) are valid
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

// Phase 9 (D54, D61): startQuote, approveQuote and markWon are gone. A
// quote comes from Quote this on a lead and a job from Make this a job on
// a quote (lib/quotes.ts), each on a tap.

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

/**
 * What Reopen asks first (Phase 8, Task 15), the way Mark lost does: one
 * tap on a closed or lost job used to move it straight back. A closed job
 * goes back to Jobs, a lost deal back to Leads. Pass it to useConfirm().
 */
export function reopenQuestion(contact: Pick<Contact, 'stage'>) {
  return contact.stage === 'closed'
    ? { title: 'Reopen this job?', body: 'It moves back to Jobs.', confirmLabel: 'Reopen' }
    : { title: 'Reopen this deal?', body: 'It moves back to Leads.', confirmLabel: 'Reopen' }
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
  // Don't fire success UI when the write failed, the caller surfaces the
  // error (V3PaymentSheet throws on res.error). Firing a success haptic +
  // "Payment logged" toast here would contradict the caller's error toast.
  if (res && 'error' in res && (res as any).error) {
    return res
  }
  hapticSuccess()
  const paid = Number(input.amount || 0)
  // Gate the "Paid in full · moved to Closed" toast on whether stages.ts
  // ACTUALLY auto-closed. Recomputing a base-only contract here would lie
  // when the base is paid but approved change order money is still owed
  // (stages.ts closes on base + approved COs).
  const closed = !!(res && 'closed' in res && (res as any).closed)
  if (closed) {
    toast(`Paid in full · moved to Closed`, { accent: 'closed', heavy: true })
  } else {
    // Currency formatting keeps both cent digits: plain toLocaleString
    // printed $1,234.50 as "$1,234.5".
    toast(`Payment logged · ${moneyExact(paid)}`, { accent: 'gold' })
  }
  return res
}
