import { describe, it, expect } from 'vitest'
import {
  rollupJobs, rollupByClient, closeRate, avgMargin, wonYTD, profitYTD
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
