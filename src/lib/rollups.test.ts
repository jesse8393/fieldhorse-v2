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
    expect(r.lifetime).toBe(4600)       // every job amount, all stages
    expect(r.outstanding).toBe(600)     // only billing stages: a 600 + b 0
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

  it('excludes closed/lost from outstanding', () => {
    const r = rollupJobs(
      [{ id: 'x', amount: 1000, stage: 'closed' }, { id: 'y', amount: 500, stage: 'lost' }],
      []
    )
    expect(r.outstanding).toBe(0)
    expect(r.lifetime).toBe(1500)
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
    expect(byClient.get('c2')).toMatchObject({ lifetime: 3100, outstanding: 0, activeCount: 1, wonCount: 1, paidTotal: 2000 })
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
  it('sums won amounts updated this calendar year (excludes last year)', () => {
    expect(wonYTD(jobs, now)).toBe(3500) // a 1000 + b 500 + c 2000 ; e is 2025/lost
  })
  it('sums profit (amount - cost) for won-this-year jobs', () => {
    expect(profitYTD(jobs, now)).toBe(900) // a 400 + b 500 + c 0
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
    // contact D: won outside the window — excluded from counts
    { contact_id: 'd', to_stage: 'quote', transitioned_at: day(200) },
    { contact_id: 'd', to_stage: 'job',   transitioned_at: day(150) }
  ]

  it('counts distinct contacts per funnel step inside the window', () => {
    const f = computeFunnel(transitions, contacts, 90, now)
    expect(f.newLeads).toBe(2)
    expect(f.quoted).toBe(3)   // a, b, c — c only once
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
