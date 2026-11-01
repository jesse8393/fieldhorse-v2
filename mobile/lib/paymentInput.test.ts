import { describe, expect, it } from 'vitest'
import { paymentAmount, isCalendarDate, localDate } from './paymentInput'

describe('payment entry', () => {
  it('preserves cents without converting negative or malformed values into payments', () => {
    expect(paymentAmount('$1,234.56')).toBe(1234.56)
    expect(paymentAmount('.01')).toBe(0.01)
    for (const value of ['-50', '(50)', '50x', 'Infinity', '0', '1.234', '1.2.3']) expect(paymentAmount(value)).toBeNull()
  })
  it('rejects dates that would roll into a different month', () => {
    expect(isCalendarDate('2028-02-29')).toBe(true)
    for (const value of ['2026-02-29', '2026-02-31', '2026-13-01', '2026-01-00']) expect(isCalendarDate(value)).toBe(false)
  })
  it('uses the local calendar date in the evening', () => {
    expect(localDate(new Date(2026, 9, 31, 23, 59))).toBe('2026-10-31')
  })
})
