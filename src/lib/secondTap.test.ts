import { describe, expect, it } from 'vitest'
import { SECOND_TAP_MIN_MS, SECOND_TAP_MS, secondTapStep } from './secondTap.ts'

describe('second tap confirmation', () => {
  it('arms on the first tap', () => {
    expect(secondTapStep(null, 1000)).toBe('arm')
  })
  it('ignores a second tap that lands too soon after arming, so a fast double tap cannot confirm', () => {
    expect(SECOND_TAP_MIN_MS).toBeGreaterThanOrEqual(400)
    expect(secondTapStep(1000, 1080)).toBe('ignore')
    expect(secondTapStep(1000, 1150)).toBe('ignore')
    expect(secondTapStep(1000, 1000 + SECOND_TAP_MIN_MS - 1)).toBe('ignore')
  })
  it('runs a deliberate second tap', () => {
    expect(secondTapStep(1000, 1000 + SECOND_TAP_MIN_MS)).toBe('run')
    expect(secondTapStep(1000, 1000 + SECOND_TAP_MS - 1)).toBe('run')
  })
})
