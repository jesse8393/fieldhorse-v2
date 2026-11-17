import { describe, expect, it } from 'vitest'
import { countNoun, money, moneyCents, moneyExact, moneyK } from './format.ts'

describe('countNoun', () => {
  it('uses the singular noun only for exactly one', () => {
    expect(countNoun(1, 'quote')).toBe('quote')
    expect(countNoun(0, 'quote')).toBe('quotes')
    expect(countNoun(2, 'quote')).toBe('quotes')
  })

  it('supports irregular plurals', () => {
    expect(countNoun(1, 'person', 'people')).toBe('person')
    expect(countNoun(3, 'person', 'people')).toBe('people')
  })
})

describe('money', () => {
  it('keeps the existing compact shapes', () => {
    expect(money(742)).toBe('$742')
    expect(money(84_000)).toBe('$84K')
    expect(money(1_240_000)).toBe('$1.24M')
    expect(money(null)).toBe('$0')
  })

  it('picks the unit after rounding so the boundary never reads $1000K', () => {
    expect(money(999_999)).toBe('$1.00M')
    expect(money(999_500)).toBe('$1.00M')
    expect(money(999_499)).toBe('$999K')
    expect(money(999.6)).toBe('$1K')
  })

  it('puts the sign before the currency symbol', () => {
    expect(money(-500)).toBe('-$500')
    expect(money(-1_200)).toBe('-$1K')
    expect(money(-2_500_000)).toBe('-$2.50M')
    expect(money(-0.2)).toBe('$0')
  })
})

describe('moneyK', () => {
  it('keeps the existing list card shapes', () => {
    expect(moneyK(840)).toBe('$840')
    expect(moneyK(24_400)).toBe('$24K')
    expect(moneyK(2_450)).toBe('$2.5K')
    expect(moneyK(0)).toBeNull()
  })

  it('rolls over to the next unit at the boundaries', () => {
    expect(moneyK(9_960)).toBe('$10K')
    expect(moneyK(999_999)).toBe('$1.0M')
    expect(moneyK(1_000_000)).toBe('$1.0M')
    expect(moneyK(12_500_000)).toBe('$12.5M')
    expect(moneyK(999.6)).toBe('$1.0K')
  })

  it('puts the sign before the currency symbol', () => {
    expect(moneyK(-500)).toBe('-$500')
    expect(moneyK(-24_400)).toBe('-$24K')
  })
})

describe('moneyExact', () => {
  it('keeps both cent digits when the amount has cents', () => {
    expect(moneyExact(1234.5)).toBe('$1,234.50')
    expect(moneyExact(12_345.67)).toBe('$12,345.67')
  })

  // formats-6: a whole amount prints .00 the way the PDF and moneyCents
  // print it, so $6,400 never sits next to $6,400.00 for the same record.
  it('prints whole amounts with .00 and never abbreviates', () => {
    expect(moneyExact(12_000)).toBe('$12,000.00')
    expect(moneyExact(1_500_000)).toBe('$1,500,000.00')
    expect(moneyExact(null)).toBe('$0.00')
  })

  it('is the same formatter as moneyCents', () => {
    for (const n of [0, 6400, 6400.5, 1234.567, -1200, '12345.5', null, undefined, 'abc']) {
      expect(moneyExact(n as never)).toBe(moneyCents(n as never))
    }
  })

  it('puts the sign before the currency symbol', () => {
    expect(moneyExact(-1200)).toBe('-$1,200.00')
  })
})

describe('moneyCents', () => {
  it('always shows cents', () => {
    expect(moneyCents(12375)).toBe('$12,375.00')
    expect(moneyCents(9229.5)).toBe('$9,229.50')
    expect(moneyCents('6187.5')).toBe('$6,187.50')
  })

  it('puts the sign before the dollar sign and treats junk as zero', () => {
    expect(moneyCents(-1200)).toBe('-$1,200.00')
    expect(moneyCents(null)).toBe('$0.00')
    expect(moneyCents('abc')).toBe('$0.00')
  })
})
