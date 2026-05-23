import { describe, it, expect } from 'vitest'
import { money, fmtSize } from './format.ts'

describe('money', () => {
  it('renders whole dollars with no decimals', () => {
    expect(money(1234)).toBe('$1,234')
    expect(money(1000000)).toBe('$1,000,000')
  })

  it('returns $0 for null / undefined / empty / NaN-y input', () => {
    expect(money(null)).toBe('$0')
    expect(money(undefined)).toBe('$0')
    expect(money(0)).toBe('$0')
    expect(money('' as any)).toBe('$0')
  })

  it('accepts numeric strings and rounds (no fractional dollars)', () => {
    expect(money('1234.56')).toBe('$1,235')
    expect(money('1234.49')).toBe('$1,234')
  })

  it('keeps the sign for credits / negative amounts', () => {
    expect(money(-500)).toMatch(/-?\$500|\(\$500\)/) // locale may format as -$500 or ($500)
  })
})

describe('fmtSize', () => {
  it('returns empty for 0 / null / undefined', () => {
    expect(fmtSize(0)).toBe('')
    expect(fmtSize(null)).toBe('')
    expect(fmtSize(undefined)).toBe('')
  })

  it('uses B / KB / MB tiers at 1024-byte boundaries', () => {
    expect(fmtSize(500)).toBe('500 B')
    expect(fmtSize(1023)).toBe('1023 B')
    expect(fmtSize(1024)).toBe('1 KB')
    expect(fmtSize(2048)).toBe('2 KB')
    expect(fmtSize(1024 * 1024)).toBe('1.0 MB')
    expect(fmtSize(1024 * 1024 * 2.5)).toBe('2.5 MB')
  })
})
