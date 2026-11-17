import { describe, it, expect } from 'vitest'
import { splitByPercents } from './paymentSchedule.ts'

const sum = (xs: number[]) => Math.round(xs.reduce((s, x) => s + x, 0) * 100) / 100

describe('splitByPercents', () => {
  it('rounds each milestone to the cent and reconciles to the total', () => {
    expect(splitByPercents(10005, [50, 40, 10])).toEqual([5002.5, 4002, 1000.5])
    expect(splitByPercents(1000.5, [50, 40, 10])).toEqual([500.25, 400.2, 100.05])
    expect(splitByPercents(2499.5, [50, 40, 10])).toEqual([1249.75, 999.8, 249.95])
  })

  it('always adds back up to the total', () => {
    for (const total of [1, 99.99, 10005, 33333.33, 123456.78]) {
      expect(sum(splitByPercents(total, [33, 33, 34]))).toBe(total)
      expect(sum(splitByPercents(total, [50, 40, 10]))).toBe(total)
    }
  })

  it('matches the draws generator rule (independent rounds, remainder last)', () => {
    // InvoiceDrawsSection: Math.round(total * pct) / 100 per draw, last
    // draw takes the remainder.
    const total = 3000.5
    expect(splitByPercents(total, [50, 40, 10])).toEqual([1500.25, 1200.2, 300.05])
  })

  it('covers only its share when a custom schedule does not add to 100', () => {
    expect(splitByPercents(10000, [30, 30])).toEqual([3000, 3000])
  })

  it('never pushes a trailing 0% row negative', () => {
    const rows = splitByPercents(1.01, [50, 50, 0])
    expect(rows[2]).toBe(0)
    expect(sum(rows)).toBe(1.01)
  })

  it('returns zeros for an empty or missing total', () => {
    expect(splitByPercents(0, [50, 40, 10])).toEqual([0, 0, 0])
    expect(splitByPercents(null, [50, 50])).toEqual([0, 0])
    expect(splitByPercents(1000, [])).toEqual([])
  })
})

// M-16: Generate from terms follows the deposit the approved terms name.
describe('drawsFromTerms', () => {
  it('uses 50 / 40 / 10 only when the terms are blank', async () => {
    const { drawsFromTerms } = await import('./paymentSchedule.ts')
    const plan = drawsFromTerms({ total: 10000, termsText: '   ', deposit: { kind: 'percent', pct: 50, amount: 5000 } })
    expect(plan?.map((d) => d.amount)).toEqual([5000, 4000, 1000])
    expect(plan?.map((d) => d.pct)).toEqual([50, 40, 10])
  })

  it('takes a percent deposit, then the balance', async () => {
    const { drawsFromTerms } = await import('./paymentSchedule.ts')
    const plan = drawsFromTerms({ total: 10000, termsText: '25% deposit due at signing. Balance due on completion.', deposit: { kind: 'percent', pct: 25, amount: 2500 } })
    expect(plan?.map((d) => [d.title, d.amount])).toEqual([['25%, Deposit', 2500], ['75%, Balance due on completion', 7500]])
  })

  it('takes a dollar deposit to the cent, then the balance', async () => {
    const { drawsFromTerms } = await import('./paymentSchedule.ts')
    const plan = drawsFromTerms({ total: 10000.07, termsText: '$2,500 deposit', deposit: { kind: 'amount', pct: null, amount: 2500 } })
    expect(plan?.map((d) => [d.title, d.amount])).toEqual([['Deposit', 2500], ['Balance due on completion', 7500.07]])
  })

  it('bills the whole contract once when the terms say no deposit', async () => {
    const { drawsFromTerms } = await import('./paymentSchedule.ts')
    const plan = drawsFromTerms({ total: 10000, termsText: 'No deposit. Net 30 on completion.', deposit: { kind: 'none', pct: 0, amount: 0 } })
    expect(plan?.map((d) => [d.title, d.amount])).toEqual([['Balance due on completion', 10000]])
  })

  it('makes nothing up when the terms name no deposit it can read', async () => {
    const { drawsFromTerms } = await import('./paymentSchedule.ts')
    expect(drawsFromTerms({ total: 10000, termsText: 'Paid in three parts as agreed.', deposit: { kind: 'per_terms', pct: null, amount: 0 } })).toBeNull()
  })

  it('agrees with what the customer link asks for as the deposit', async () => {
    const { drawsFromTerms } = await import('./paymentSchedule.ts')
    const { quoteMoney } = await import('./quoteMoney.ts')
    const termsText = '25% deposit due at signing. Balance due on completion.'
    const money = quoteMoney({ items: [], changeOrders: [], contactAmount: 10000, termsText, companyName: 'Parker' })
    expect(drawsFromTerms({ total: 10000, termsText, deposit: money.deposit })?.[0].amount).toBe(money.deposit.amount)
  })
})
