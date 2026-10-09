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
