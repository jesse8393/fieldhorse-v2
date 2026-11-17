import { describe, it, expect } from 'vitest'
import { money, fmtSize } from './format.ts'

describe('money', () => {
  // formats-6: whole dollars print .00, the way the PDF prints them.
  it('renders whole dollars with .00', () => {
    expect(money(1234)).toBe('$1,234.00')
    expect(money(1000000)).toBe('$1,000,000.00')
  })

  it('returns $0.00 for null / undefined / empty / NaN-y input', () => {
    expect(money(null)).toBe('$0.00')
    expect(money(undefined)).toBe('$0.00')
    expect(money(0)).toBe('$0.00')
    expect(money('' as any)).toBe('$0.00')
  })

  // M-20: job money is exact to the cent. A $4,999.50 balance read
  // "$5,000", so this used to expect whole dollars.
  it('accepts numeric strings and keeps the cents', () => {
    expect(money('1234.56')).toBe('$1,234.56')
    expect(money('1234.49')).toBe('$1,234.49')
    expect(money(4999.5)).toBe('$4,999.50')
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
