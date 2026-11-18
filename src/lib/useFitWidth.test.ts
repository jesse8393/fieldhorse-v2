import { describe, expect, it } from 'vitest'
import { fitElement, fitScale } from './useFitWidth.ts'

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

// A figure whose drawn width does not shrink in step with its font: part of
// it (letter spacing, rounding) stays the same size at any scale.
function figure(room: number, natural: number, fixed: number) {
  const props = new Map<string, string>()
  return {
    clientWidth: room,
    get scrollWidth() {
      const scale = Number(props.get('--fh-fit') ?? 1)
      return Math.ceil((natural - fixed) * scale + fixed)
    },
    style: {
      setProperty: (k: string, v: string) => { props.set(k, v) },
      removeProperty: (k: string) => { props.delete(k) },
    },
    fit: () => props.get('--fh-fit'),
  }
}

describe('fitElement', () => {
  it('measures again after scaling and shrinks further until the figure is inside its box', () => {
    const el = figure(280, 340, 30)
    fitElement(el as any)
    expect(el.scrollWidth).toBeLessThanOrEqual(280)
    expect(Number(el.fit())).toBeLessThan(fitScale(280, 340))
  })

  it('leaves a figure that fits alone', () => {
    const el = figure(280, 200, 30)
    fitElement(el as any)
    expect(el.fit()).toBeUndefined()
  })
})
