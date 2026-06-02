/**
 * Job Health — composite 0..100 score answering "is this job on track?"
 *
 * Formula (Q1 decision):
 *   milestones %done       × 50  (execution progress)
 * + payments  %collected   × 30  (financial progress)
 * + schedule  on-track     × 20  (no overdue fh_schedule entries)
 *
 * Tier thresholds match the HealthDonut v3 primitive:
 *   80–100 → Good     (success green)
 *   50–79  → At Risk  (gold)
 *    0–49  → Behind   (danger red)
 *
 * Caveats deliberately accepted, not bugs:
 *   - Early-stage jobs (lead/quote) naturally score low because milestones
 *     and payments are both 0%. That's accurate — there's nothing to track
 *     yet. The donut reading "Behind" on a fresh lead is informative, not
 *     misleading.
 *   - Schedule overdue is binary (0 or 1) rather than graded by how overdue
 *     because the operator only cares whether anything has slipped, not by
 *     how many days.
 *
 * Pure function. No side effects. No imports beyond what's typed in args.
 */
export function computeJobHealth({ contact, payments = [], scheduleItems = [] }: { contact?: any; payments?: any[]; scheduleItems?: any[] } = {}) {
  if (!contact) {
    return { score: 0, tier: 'unknown', label: '—', breakdown: null }
  }

  // Terminal stages override the score: a job that's closed (delivered +
  // signed off) or lost is not "at risk" or "behind" — it's done. The
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

  // Financial: paid / contracted (cap at 1 — overpayment doesn't keep adding)
  const amount = Number(contact.amount || 0)
  const paid = payments.reduce((s, p) => s + Number(p?.amount || 0), 0)
  const paymentRatio = amount > 0 ? Math.min(1, paid / amount) : 0

  // Schedule: any end_at in the past = overdue. Filter excludes rows with
  // no end_at since those are "indefinite" (e.g., a saved appointment with
  // no end time set).
  const now = Date.now()
  const hasOverdue = scheduleItems.some((s) => {
    if (!s?.end_at) return false
    return new Date(s.end_at).getTime() < now
  })
  const scheduleScore = hasOverdue ? 0 : 1

  const score = Math.round(
    milestoneRatio * 50 +
    paymentRatio * 30 +
    scheduleScore * 20
  )

  const tier = score >= 80 ? 'good' : score >= 50 ? 'risk' : 'behind'
  const label = tier === 'good' ? 'Good' : tier === 'risk' ? 'At Risk' : 'Behind'

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
