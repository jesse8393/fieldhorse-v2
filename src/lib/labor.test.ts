import { describe, it, expect } from 'vitest'
import { punchHours } from './labor.ts'

describe('punchHours', () => {
  it('computes hours minus break', () => {
    expect(punchHours({
      punch_in_at: '2026-06-12T08:00:00Z',
      punch_out_at: '2026-06-12T16:30:00Z',
      break_minutes: 30
    })).toBeCloseTo(8, 5)
  })

  it('is 0 for open punches', () => {
    expect(punchHours({ punch_in_at: '2026-06-12T08:00:00Z', punch_out_at: null })).toBe(0)
  })

  it('never goes negative (break longer than shift, clock skew)', () => {
    expect(punchHours({
      punch_in_at: '2026-06-12T08:00:00Z',
      punch_out_at: '2026-06-12T08:10:00Z',
      break_minutes: 60
    })).toBe(0)
    expect(punchHours({
      punch_in_at: '2026-06-12T09:00:00Z',
      punch_out_at: '2026-06-12T08:00:00Z'
    })).toBe(0)
  })

  it('tolerates missing break_minutes', () => {
    expect(punchHours({
      punch_in_at: '2026-06-12T08:00:00Z',
      punch_out_at: '2026-06-12T12:00:00Z'
    })).toBeCloseTo(4, 5)
  })
})
