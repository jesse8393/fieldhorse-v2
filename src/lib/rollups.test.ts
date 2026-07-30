import { describe, it, expect } from 'vitest'
import {
  rollupJobs, rollupByClient, closeRate, avgMargin, wonYTD, profitYTD, computeFunnel
} from './rollups.ts'

const jobs = [
  { id: 'a', client_id: 'c1', amount: 1000, cost: 600,  stage: 'job',     updated_at: '2026-03-01' },
  { id: 'b', client_id: 'c1', amount: 500,             stage: 'invoice', updated_at: '2026-02-01' },
  { id: 'c', client_id: 'c2', amount: 2000, cost: 2000, stage: 'closed',  updated_at: '2026-01-15' },
  { id: 'd', client_id: 'c2', amount: 300,             stage: 'lead',    updated_at: '2026-04-01' },
  { id: 'e', client_id: 'c2', amount: 800,             stage: 'lost',    updated_at: '2025-12-01' }
]
const payments = [
  { contact_id: 'a', amount: 400 },
  { contact_id: 'b', amount: 500 }, // invoice paid in full
  { contact_id: 'c', amount: 2000 }
]

describe('rollupJobs', () => {
  it('aggregates lifetime / outstanding / counts / paid correctly', () => {
    const r = rollupJobs(jobs, payments)
    expect(r.lifetime).toBe(3500)       // won deals only: a 1000 + b 500 + c 2000 (lost/lead excluded)
    expect(r.outstanding).toBe(600)     // billing stages: a 600 + b 0 + c 0
    expect(r.activeCount).toBe(3)       // lead/quote/job/invoice → a,b,d
    expect(r.wonCount).toBe(3)          // every job is a won deal → a,b,c
    expect(r.paidTotal).toBe(2900)
  })

  it('never reports negative outstanding (overpaid clips to 0)', () => {
    const r = rollupJobs(
      [{ id: 'x', amount: 100, stage: 'invoice' }],
      [{ contact_id: 'x', amount: 250 }]
    )
    expect(r.outstanding).toBe(0)
  })

  it('keeps closed-with-balance jobs in outstanding (matches statements/A-R); lost stays out', () => {
    const r = rollupJobs(
      [{ id: 'x', amount: 1000, stage: 'closed' }, { id: 'y', amount: 500, stage: 'lost' }],
      []
    )
    expect(r.outstanding).toBe(1000)  // closed but unpaid still owed
    expect(r.lifetime).toBe(1000)     // lost bid is not lifetime value
  })

  it('adds approved change orders to the contract (pending ones ignored)', () => {
    const r = rollupJobs(
      [{ id: 'x', amount: 10000, stage: 'job' }],
      [{ contact_id: 'x', amount: 10000 }],
      [
        { contact_id: 'x', amount: 2000, status: 'approved' },
        { contact_id: 'x', amount: 900, status: 'pending' }
      ]
    )
    expect(r.outstanding).toBe(2000)  // base paid in full; approved CO still owed
    expect(r.lifetime).toBe(12000)
  })

  it('ignores rounding dust ≤ $0.50, same as statements', () => {
    const r = rollupJobs(
      [{ id: 'x', amount: 1000.5, stage: 'job' }],
      [{ contact_id: 'x', amount: 1000 }]
    )
    expect(r.outstanding).toBe(0)
  })

  it('returns zeros for empty/null inputs', () => {
    const r = rollupJobs(null, null)
    expect(r).toEqual({ lifetime: 0, outstanding: 0, activeCount: 0, wonCount: 0, paidTotal: 0 })
  })
})

describe('rollupByClient', () => {
  it('splits totals per client and attributes payments via their job', () => {
    const byClient = rollupByClient(jobs, payments)
    expect(byClient.get('c1')).toMatchObject({ lifetime: 1500, outstanding: 600, activeCount: 2, wonCount: 2, paidTotal: 900 })
    expect(byClient.get('c2')).toMatchObject({ lifetime: 2000, outstanding: 0, activeCount: 1, wonCount: 1, paidTotal: 2000 })
  })

  it('routes change orders to the right client via their job', () => {
    const byClient = rollupByClient(jobs, payments, [{ contact_id: 'a', amount: 250, status: 'approved' }])
    expect(byClient.get('c1')?.outstanding).toBe(850) // a: 1000 + 250 - 400
    expect(byClient.get('c2')?.outstanding).toBe(0)
  })
})

describe('closeRate', () => {
  it('is won / (won + lost) over decided deals', () => {
    expect(closeRate(jobs)).toBeCloseTo(3 / 4) // won a,b,c ; lost e
  })
  it('is 0 when nothing has reached a terminal stage', () => {
    expect(closeRate([{ stage: 'lead' }, { stage: 'quote' }])).toBe(0)
    expect(closeRate([])).toBe(0)
  })
})

describe('avgMargin', () => {
  it('averages per-job margin ratios over won jobs', () => {
    // a: (1000-600)/1000 = 0.4 ; b: 1.0 ; c: 0 → mean ≈ 0.4667
    expect(avgMargin(jobs)).toBeCloseTo(0.4667, 3)
  })
  it('is 0 with no qualifying jobs', () => {
    expect(avgMargin([])).toBe(0)
    expect(avgMargin([{ stage: 'closed', amount: 0 }])).toBe(0)
  })
})

describe('wonYTD / profitYTD', () => {
  const now = new Date('2026-06-01T12:00:00')
  it('sums won amounts for this calendar year (excludes last year)', () => {
    expect(wonYTD(jobs, null, now)).toBe(3500) // a 1000 + b 500 + c 2000 ; e is 2025/lost
  })
  it('sums profit (amount - cost) for won-this-year jobs', () => {
    expect(profitYTD(jobs, null, now)).toBe(900) // a 400 + b 500 + c 0
  })
  it('anchors the win date to the transition log, not updated_at', () => {
    // c actually won in 2025, a July 2026 edit bumped its updated_at.
    // With the transition log present, c stays out of 2026's totals.
    const transitions = [
      { contact_id: 'c', to_stage: 'job', transitioned_at: '2025-11-10T09:00:00Z' },
      { contact_id: 'a', to_stage: 'job', transitioned_at: '2026-03-01T09:00:00Z' }
    ]
    expect(wonYTD(jobs, transitions, now)).toBe(1500) // a 1000 + b 500 (b falls back to updated_at)
  })
  it('lets losses subtract from profit instead of clamping at 0', () => {
    const overBudget = [
      { id: 'p1', amount: 10000, cost: 6000, stage: 'job', updated_at: '2026-03-01' },
      { id: 'p2', amount: 8000, cost: 12000, stage: 'job', updated_at: '2026-03-02' }
    ]
    expect(profitYTD(overBudget, null, now)).toBe(0) // +4000 - 4000, not +4000
  })
})

describe('computeFunnel', () => {
  const now = new Date('2026-06-12T12:00:00Z')
  const day = (n: number) => new Date(now.getTime() - n * 86400000).toISOString()
  const contacts = [
    { created_at: day(10) },  // in window
    { created_at: day(50) },  // in window
    { created_at: day(120) }  // outside 90d
  ]
  const transitions = [
    // contact A: quote → won, 5 days to decide
    { contact_id: 'a', to_stage: 'quote', transitioned_at: day(30) },
    { contact_id: 'a', to_stage: 'job',   transitioned_at: day(25) },
    // contact B: quote → lost, 10 days
    { contact_id: 'b', to_stage: 'quote', transitioned_at: day(40) },
    { contact_id: 'b', to_stage: 'lost',  transitioned_at: day(30) },
    // contact C: quoted twice (counts once), no decision yet
    { contact_id: 'c', to_stage: 'quote', transitioned_at: day(20) },
    { contact_id: 'c', to_stage: 'quote', transitioned_at: day(5) },
    // contact D: won outside the window, excluded from counts
    { contact_id: 'd', to_stage: 'quote', transitioned_at: day(200) },
    { contact_id: 'd', to_stage: 'job',   transitioned_at: day(150) }
  ]

  it('counts distinct contacts per funnel step inside the window', () => {
    const f = computeFunnel(transitions, contacts, 90, now)
    expect(f.newLeads).toBe(2)
    expect(f.quoted).toBe(3)   // a, b, c, c only once
    expect(f.won).toBe(1)      // a (d is outside window)
    expect(f.lost).toBe(1)     // b
  })

  it('derives rates and decision speed', () => {
    const f = computeFunnel(transitions, contacts, 90, now)
    expect(f.winRate).toBeCloseTo(0.5, 5)            // 1 won / (1 won + 1 lost)
    expect(f.quoteRate).toBeCloseTo(1, 5)            // 3 quoted / 2 new, clamped to 1
    expect(f.avgDaysToDecision).toBeCloseTo(7.5, 5)  // (5 + 10) / 2
  })

  it('handles empty inputs', () => {
    const f = computeFunnel([], [], 90, now)
    expect(f).toEqual({
      newLeads: 0, quoted: 0, won: 0, lost: 0,
      quoteRate: 0, winRate: 0, avgDaysToDecision: 0
    })
  })
})
