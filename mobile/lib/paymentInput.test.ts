import { describe, expect, it } from 'vitest'
import { paymentAmount, moneyAmount, isCalendarDate, localDate } from './paymentInput'

describe('payment entry', () => {
  it('preserves cents without converting negative or malformed values into payments', () => {
    expect(paymentAmount('$1,234.56')).toBe(1234.56)
    expect(paymentAmount('.01')).toBe(0.01)
    for (const value of ['-50', '(50)', '50x', 'Infinity', '0', '1.234', '1.2.3', '1,23', '1 2', '1$2']) expect(paymentAmount(value)).toBeNull()
  })
  it('rejects dates that would roll into a different month', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true)
    for (const value of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-01-00']) expect(isCalendarDate(value)).toBe(false)
  })
  it('accepts zero contracts and signed credits only when explicitly allowed', () => {
    expect(moneyAmount('0', { allowZero: true })).toBe(0)
    expect(moneyAmount('-125.75', { allowNegative: true })).toBe(-125.75)
    expect(moneyAmount('-125.75', { allowZero: true })).toBeNull()
    for (const value of ['12oops34', '1e5', '1.001', '--20', 'Infinity']) {
      expect(moneyAmount(value, { allowZero: true, allowNegative: true })).toBeNull()
    }
  })
  it('uses the local calendar date in the evening', () => {
    expect(localDate(new Date(2026, 9, 31, 23, 59))).toBe('2026-10-31')
  })
})
