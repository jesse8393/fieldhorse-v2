import { describe, expect, it } from 'vitest'
import { fitScale } from './useFitWidth.ts'

describe('fitScale', () => {
  it('leaves a figure that fits at its own size', () => {
    expect(fitScale(310, 300)).toBe(1)
    expect(fitScale(310, 310)).toBe(1)
  })

  it('scales a figure that is too wide down to the room it has, never past it', () => {
    const scale = fitScale(310, 340)
    expect(scale).toBeLessThan(1)
    expect(340 * scale).toBeLessThanOrEqual(310)
    expect(340 * scale).toBeGreaterThan(309)
  })

  it('does nothing before the box has a width', () => {
    expect(fitScale(0, 340)).toBe(1)
    expect(fitScale(Number.NaN, 340)).toBe(1)
  })
})
