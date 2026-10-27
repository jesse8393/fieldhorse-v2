import { describe, expect, it } from 'vitest'
import { businessMileageRate, mileageYearSummary } from './mileageRates.ts'

describe('dated business mileage rates', () => {
  it('uses the official rate on both sides of the July 2026 change', () => {
    expect(businessMileageRate('2026-06-30')).toBe(0.725)
    expect(businessMileageRate('2026-07-01')).toBe(0.76)
    expect(businessMileageRate('2025-12-31')).toBe(0.70)
    expect(businessMileageRate('2027-01-01')).toBeNull()
    expect(businessMileageRate('2026-02-31')).toBeNull()
  })
  it('sums rates per trip and excludes prior years and future trips', () => {
    expect(mileageYearSummary([
      { drove_on: '2026-06-30', miles: 100 },
      { drove_on: '2026-07-01', miles: 100 },
      { drove_on: '2025-12-31', miles: 100 },
      { drove_on: '2026-12-31', miles: 100 }
    ], new Date(2026, 9, 27))).toEqual({ miles: 200, deduction: 148.5, missingRates: 0 })
  })
  it('never invents a deduction for an unverified year', () => {
    expect(mileageYearSummary([{ drove_on: '2027-01-01', miles: 100 }], new Date(2027, 0, 2)))
      .toEqual({ miles: 100, deduction: null, missingRates: 1 })
  })
})
