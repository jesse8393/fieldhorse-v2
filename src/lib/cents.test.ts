import { describe, it, expect } from 'vitest'
import { toCents, fromCents, compareCents, sumCents } from './cents.ts'

describe('money in whole cents', () => {
  it('turns dollars into whole cents, rounding half up past float dust', () => {
    expect(toCents(1000.07)).toBe(100007)
    expect(toCents('1234.50')).toBe(123450)
    expect(toCents(1.005)).toBe(101)
    expect(toCents(10.825)).toBe(1083)
    expect(toCents(0.1 + 0.2)).toBe(30)
    expect(toCents(-12.345)).toBe(-1235)
  })

  it('reads blank, missing and non numeric input as zero', () => {
    expect([toCents(null), toCents(undefined), toCents(''), toCents('abc'), toCents(Number.NaN), toCents(Infinity)]).toEqual([0, 0, 0, 0, 0, 0])
  })

  it('turns cents back into dollars', () => {
    expect(fromCents(100007)).toBe(1000.07)
    expect(fromCents(0)).toBe(0)
  })

  it('sums in cents so three draws add up to their contract', () => {
    expect(500.04 + 400.03 + 100).not.toBe(1000.07)
    expect(sumCents([500.04, 400.03, 100])).toBe(100007)
    expect(sumCents([{ amount: '500.04' }, { amount: 400.03 }, null], (r) => r?.amount)).toBe(90007)
  })

  it('compares two dollar amounts by their cents', () => {
    expect(compareCents(500.04 + 400.03 + 100, 1000.07)).toBe(0)
    expect(compareCents(4999.5, 5000)).toBeLessThan(0)
    expect(compareCents(5000, 4999.99)).toBeGreaterThan(0)
  })
})
