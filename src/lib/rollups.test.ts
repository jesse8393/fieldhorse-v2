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

// Task 15: the funnel reads the records themselves. A lead is created on
// fh_leads, a quote on fh_quotes, and a quote became a job when its job_id
// points at an fh_contacts row (D54). Lost is a lost lead or a quote that
// was lost, rejected or expired.
describe('computeFunnel', () => {
  const now = new Date('2026-06-12T12:00:00Z')
  const day = (n: number) => new Date(now.getTime() - n * 86400000).toISOString()
  const leads = [
    { id: 'l1', status: 'quoted', created_at: day(10), updated_at: day(8) },   // in window
    { id: 'l2', status: 'open', created_at: day(50), updated_at: day(50) },    // in window
    { id: 'l3', status: 'lost', created_at: day(120), updated_at: day(20) },   // created outside, lost inside
    { id: 'l4', status: 'lost', created_at: day(200), updated_at: day(150) }   // lost outside the window
  ]
  const quotes = [
    // a: sent, became job ja 5 days after it was made
    { id: 'qa', status: 'approved', job_id: 'ja', created_at: day(30), updated_at: day(25) },
    // b: lost 10 days after it was made
    { id: 'qb', status: 'lost', job_id: null, created_at: day(40), updated_at: day(30) },
    // c: still out
    { id: 'qc', status: 'sent', job_id: null, created_at: day(20), updated_at: day(5) },
    // d: became a job outside the window
    { id: 'qd', status: 'approved', job_id: 'jd', created_at: day(200), updated_at: day(150) }
  ]
  const jobs = [
    { id: 'ja', created_at: day(25) },
    { id: 'jd', created_at: day(150) }
  ]

  it('the funnel counts a quote that became a job as won', () => {
    const f = computeFunnel({ leads, quotes, jobs }, 90, now)
    expect(f.newLeads).toBe(2)   // l1, l2
    expect(f.quoted).toBe(3)     // qa, qb, qc
    expect(f.won).toBe(1)        // qa (qd is outside the window)
    expect(f.lost).toBe(2)       // qb, and the lead l3
  })

  it('derives rates and decision speed', () => {
    const f = computeFunnel({ leads, quotes, jobs }, 90, now)
    expect(f.winRate).toBeCloseTo(1 / 3, 5)          // 1 won / (1 won + 2 lost)
    expect(f.quoteRate).toBeCloseTo(1, 5)            // 3 quoted / 2 new, clamped to 1
    expect(f.avgDaysToDecision).toBeCloseTo(7.5, 5)  // qa 5 days, qb 10 days
  })

  it('reads the win date from the quote when its job is not in the list', () => {
    const f = computeFunnel({ leads: [], quotes: [quotes[0]], jobs: [] }, 90, now)
    expect(f.won).toBe(1)
    expect(f.avgDaysToDecision).toBeCloseTo(5, 5)
  })

  it('handles empty inputs', () => {
    const f = computeFunnel({ leads: [], quotes: [], jobs: [] }, 90, now)
    expect(f).toEqual({
      newLeads: 0, quoted: 0, won: 0, lost: 0,
      quoteRate: 0, winRate: 0, avgDaysToDecision: 0
    })
  })
})
