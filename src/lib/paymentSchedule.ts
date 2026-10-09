// src/lib/paymentSchedule.ts
//
// Split a total across a percentage payment schedule (50 / 40 / 10).
// One rule for every surface that prints or bills a schedule: each
// milestone rounds to the cent on its own and the last milestone takes
// the remainder, so the milestones always add back up to the total the
// customer sees. The proposal's payment terms and the draws generated
// from those terms must use this same split or they disagree by cents.

export function splitByPercents(
  total: number | string | null | undefined,
  percents: Array<number | string | null | undefined>
): number[] {
  const totalCents = Math.round(Number(total || 0) * 100)
  const pcts = percents.map((p) => {
    const v = Number(p || 0)
    return Number.isFinite(v) ? v : 0
  })
  // The remainder lands on the last milestone that actually carries a
  // percentage, so a trailing 0% row never turns negative.
  const lastIdx = pcts.reduce((last, p, i) => (p > 0 ? i : last), -1)
  if (!Number.isFinite(totalCents) || lastIdx === -1) return pcts.map(() => 0)
  const sumPct = pcts.reduce((s, p) => s + p, 0)
  // Cents the whole schedule covers: the full total when the percentages
  // add up to 100, a proportional share when a custom schedule does not.
  const scheduleCents = Math.round((totalCents * sumPct) / 100)
  const cents = pcts.map((p, i) => (i === lastIdx ? 0 : Math.round((totalCents * p) / 100)))
  cents[lastIdx] = scheduleCents - cents.reduce((s, c) => s + c, 0)
  return cents.map((c) => c / 100)
}
