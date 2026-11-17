import { toCents, fromCents, sumCents } from '../../../lib/cents.ts'

/**
 * Job Health, composite 0..100 score answering "is this job on track?"
 *
 * Formula (Q1 decision):
 *   milestones %done       × 50  (execution progress)
 * + payments  %collected   × 30  (financial progress)
 * + schedule  on-track     × 20  (no overdue fh_schedule entries)
 *
 * Tier thresholds match the HealthDonut v3 primitive:
 *   80–100 → Good     (success green)
 *   50–79  → At risk  (gold)
 *    0–49  → Behind   (danger red)
 *
 * Caveats deliberately accepted, not bugs:
 *   - Early-stage jobs (lead/quote) naturally score low because milestones
 *     and payments are both 0%. That's accurate, there's nothing to track
 *     yet. The donut reading "Behind" on a fresh lead is informative, not
 *     misleading.
 *   - Schedule overdue is binary (0 or 1) rather than graded by how overdue
 *     because the operator only cares whether anything has slipped, not by
 *     how many days.
 *
 * Pure function. No side effects.
 */
export function computeJobHealth({ contact, payments = [], scheduleItems = [], changeOrders = [] }: { contact?: any; payments?: any[]; scheduleItems?: any[]; changeOrders?: any[] } = {}) {
  if (!contact) {
    return { score: 0, tier: 'unknown', label: '\u2003', breakdown: null }
  }

  // The contract is the job amount plus approved change orders (M-15), in
  // whole cents: a $10,000 job with a $5,000 approved change order and
  // $12,000 paid still has $3,000 owed, it is not overpaid.
  const amountCents = toCents(contact.amount) > 0
    ? toCents(contact.amount) + sumCents((changeOrders || []).filter((co: any) => co?.status === 'approved'), (co: any) => co.amount)
    : 0
  const paidCents = sumCents(payments, (payment: any) => payment?.amount)
  const amount = fromCents(amountCents)
  const paid = fromCents(paidCents)
  const credit = fromCents(Math.max(0, paidCents - amountCents))
  if (contact.stage !== 'lost' && amountCents > 0 && paidCents > amountCents) {
    return {
      score: 50,
      tier: 'risk',
      label: 'Overpaid',
      breakdown: {
        milestones: null,
        payments: { paid, amount, pct: 100, credit },
        schedule: null
      }
    }
  }

  // Terminal stages override the score: a job that's closed (delivered +
  // signed off) or lost is not "at risk" or "behind", it's done. The
  // composite formula treats milestones / payments / overdue events as
  // signals of in-flight risk, but those signals are meaningless once
  // the deal is no longer in flight. Previously, fully-paid completed
  // jobs read as "Behind 30%" because the saved milestones aren't
  // mirrored on contact.milestones JSON (operator marks them via the
  // closeout sheet, not the Milestones section).
  if (contact.stage === 'closed') {
    return {
      score: 100,
      tier: 'good',
      label: 'Complete',
      breakdown: { milestones: null, payments: null, schedule: 'closed' }
    }
  }
  if (contact.stage === 'lost') {
    return {
      score: 0,
      tier: 'lost',
      label: 'Lost',
      breakdown: { milestones: null, payments: null, schedule: 'lost' }
    }
  }

  // Execution: milestones complete / total
  const milestones = Array.isArray(contact.milestones) ? contact.milestones : []
  const milestonesDone = milestones.filter((m: any) => m && m.done).length
  const milestoneRatio = milestones.length > 0 ? milestonesDone / milestones.length : 0

  // Financial: paid / contracted (cap at 1, overpayment doesn't keep adding)
  const paymentRatio = amountCents > 0 ? Math.min(1, paidCents / amountCents) : 0

  // Schedule (OPS-09): behind only when the job has visits that ended and
  // none from today on. A visit this morning, or one booked tomorrow, means
  // the work is moving. Rows with no end_at are "indefinite" (a saved
  // appointment with no end time) and never count as past.
  const now = new Date()
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime()
  const timeOf = (v: unknown) => (v ? new Date(String(v)).getTime() : NaN)
  const hasPast = scheduleItems.some((s) => timeOf(s?.end_at) < now.getTime())
  const hasFromToday = scheduleItems.some((s) => {
    const t = timeOf(s?.end_at ?? s?.start_at)
    return Number.isFinite(t) && t >= startOfToday
  })
  const hasOverdue = hasPast && !hasFromToday
  const scheduleScore = hasOverdue ? 0 : 1

  const score = Math.round(
    milestoneRatio * 50 +
    paymentRatio * 30 +
    scheduleScore * 20
  )

  const tier = score >= 80 ? 'good' : score >= 50 ? 'risk' : 'behind'
  const label = tier === 'good' ? 'Good' : tier === 'risk' ? 'At risk' : 'Behind'

  return {
    score,
    tier,
    label,
    breakdown: {
      milestones: { done: milestonesDone, total: milestones.length, pct: Math.round(milestoneRatio * 100) },
      payments: { paid, amount, pct: Math.round(paymentRatio * 100) },
      schedule: hasOverdue ? 'overdue' : 'on-track'
    }
  }
}
