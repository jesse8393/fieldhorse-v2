// src/lib/paymentSchedule.ts
//
// Split a total across a percentage payment schedule (50 / 40 / 10).
// One rule for every surface that prints or bills a schedule: each
// milestone rounds to the cent on its own and the last milestone takes
// the remainder, so the milestones always add back up to the total the
// customer sees. The proposal's payment terms and the draws generated
// from those terms must use this same split or they disagree by cents.

import { toCents, fromCents } from './cents.ts'
import { DEFAULT_PAYMENT_SCHEDULE } from '../components/documents/PaymentTermsBlock.tsx'

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

export type TermsDraw = { title: string; amount: number; pct: number | null; notes: string | null }

/**
 * The draws "Generate from terms" makes for a job (M-16). The approved
 * terms decide them, read the way the customer's link reads them
 * (quoteMoney's deposit): a $10,000 job whose terms say "25% deposit"
 * gets a $2,500 deposit draw and a $7,500 balance, not 50 / 40 / 10.
 *
 * - blank terms: the default 50 / 40 / 10 schedule
 * - a percent or dollar deposit: the deposit, then the balance
 * - no deposit: one draw for the whole contract
 * - terms that name no deposit this can read: null, so nothing is guessed
 *
 * Amounts are split in whole cents and always add up to the total.
 */
export function drawsFromTerms({ total, termsText, deposit }: {
  total: number
  termsText: string | null | undefined
  deposit: { kind: string; pct: number | null; amount: number }
}): TermsDraw[] | null {
  const totalCents = toCents(total)
  if (totalCents <= 0) return null
  if (!String(termsText ?? '').trim()) {
    const amounts = splitByPercents(total, DEFAULT_PAYMENT_SCHEDULE.map((row) => row.pct))
    return DEFAULT_PAYMENT_SCHEDULE.map((row, i) => ({ title: `${row.pct}%, ${row.label}`, amount: amounts[i], pct: Number(row.pct), notes: row.sub || null }))
  }
  const balance = 'Balance due on completion'
  if (deposit.kind === 'percent' && deposit.pct != null && deposit.pct > 0) {
    if (deposit.pct >= 100) return [{ title: '100%, Deposit', amount: fromCents(totalCents), pct: 100, notes: null }]
    const [first, rest] = splitByPercents(total, [deposit.pct, 100 - deposit.pct])
    const restPct = Math.round((100 - deposit.pct) * 100) / 100
    return [
      { title: `${deposit.pct}%, Deposit`, amount: first, pct: deposit.pct, notes: null },
      { title: `${restPct}%, ${balance}`, amount: rest, pct: restPct, notes: null }
    ]
  }
  if (deposit.kind === 'amount') {
    const depositCents = Math.min(toCents(deposit.amount), totalCents)
    if (depositCents <= 0) return null
    const out: TermsDraw[] = [{ title: 'Deposit', amount: fromCents(depositCents), pct: null, notes: null }]
    if (totalCents - depositCents > 0) out.push({ title: balance, amount: fromCents(totalCents - depositCents), pct: null, notes: null })
    return out
  }
  if (deposit.kind === 'none') return [{ title: balance, amount: fromCents(totalCents), pct: null, notes: null }]
  return null
}
