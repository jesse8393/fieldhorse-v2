import { describe, it, expect } from 'vitest'
import { computeJobHealth } from './jobHealth.ts'

const past = (mins: number) => new Date(Date.now() - mins * 60_000).toISOString()
const future = (mins: number) => new Date(Date.now() + mins * 60_000).toISOString()

describe('computeJobHealth', () => {
  it('returns unknown with no contact', () => {
    const h = computeJobHealth({})
    expect(h.tier).toBe('unknown')
    expect(h.score).toBe(0)
  })

  it('scores 100 / good when fully done, paid, and on schedule', () => {
    const h = computeJobHealth({
      contact: { amount: 1000, milestones: [{ done: true }, { done: true }] },
      payments: [{ amount: 1000 }],
      scheduleItems: [{ end_at: future(60) }]
    })
    expect(h.score).toBe(100)
    expect(h.tier).toBe('good')
  })

  it('weights milestones 50 / payments 30 / schedule 20', () => {
    // half milestones (25) + no pay (0) + on-track (20) = 45 → behind
    const h = computeJobHealth({
      contact: { amount: 1000, milestones: [{ done: true }, { done: false }] },
      payments: [],
      scheduleItems: []
    })
    expect(h.score).toBe(45)
    expect(h.tier).toBe('behind')
  })

  it('zeroes the schedule component when something is overdue', () => {
    const onTrack = computeJobHealth({
      contact: { amount: 1000, milestones: [{ done: true }] },
      payments: [{ amount: 1000 }],
      scheduleItems: [{ end_at: future(60) }]
    })
    const overdue = computeJobHealth({
      contact: { amount: 1000, milestones: [{ done: true }] },
      payments: [{ amount: 1000 }],
      scheduleItems: [{ end_at: past(60) }]
    })
    expect(onTrack.score - overdue.score).toBe(20)
    expect(overdue.breakdown?.schedule).toBe('overdue')
  })

  it('caps the payment ratio at 100% (overpayment does not inflate)', () => {
    const h = computeJobHealth({
      contact: { amount: 1000, milestones: [] },
      payments: [{ amount: 5000 }],
      scheduleItems: []
    })
    // 0 milestones + payment capped at 30 + on-track 20 = 50
    expect(h.breakdown?.payments?.pct).toBe(100)
    expect(h.score).toBe(50)
  })

  it('reports a breakdown with milestone/payment percentages', () => {
    const h = computeJobHealth({
      contact: { amount: 2000, milestones: [{ done: true }, { done: false }, { done: false }, { done: false }] },
      payments: [{ amount: 500 }],
      scheduleItems: []
    })
    expect(h.breakdown?.milestones).toMatchObject({ done: 1, total: 4, pct: 25 })
    expect(h.breakdown?.payments).toMatchObject({ paid: 500, amount: 2000, pct: 25 })
  })
})
