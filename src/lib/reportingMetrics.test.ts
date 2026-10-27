import { describe, expect, it } from 'vitest'
import { completedMonthComparison, financialYearSummary, paymentsReceivedInPeriod } from './reportingMetrics.ts'
import { profitCoverageYTD, wonYTD, computeFunnel } from './rollups.ts'

describe('reporting definitions', () => {
  const now = new Date(2026, 9, 27)
  it('keeps issued invoice amounts separate from receipts and excludes drafts, voids and future dates', () => {
    const summary = financialYearSummary([
      { status: 'sent', amount: 1000, issued_at: '2026-01-01' },
      { status: 'paid', amount: 500, issued_at: '2026-10-01' },
      { status: 'draft', amount: 7000, created_at: '2026-10-01' },
      { status: 'void', amount: 4000, issued_at: '2026-10-01' },
      { status: 'sent', amount: 2000, issued_at: '2025-12-31' },
      { status: 'sent', amount: 3000, issued_at: '2026-12-31' }
    ], [{ amount: 8000, paid_on: '2026-10-01' }], now)
    expect(summary).toEqual({ issued: 1500, received: 8000 })
  })
  it('does not count missing costs as pure profit, and preserves actual losses', () => {
    const jobs = [
      { id: 'a', stage: 'job', amount: 1000, cost: 2000, updated_at: '2026-10-01' },
      { id: 'b', stage: 'closed', amount: 100000, cost: null, updated_at: '2026-10-01' },
      { id: 'c', stage: 'job', amount: 50000, cost: 0, updated_at: '2026-10-01' }
    ]
    expect(profitCoverageYTD(jobs, [], now)).toEqual({ profit: -1000, costed: 1, total: 3, missing: 2 })
    expect(profitCoverageYTD(jobs.slice(1), [], now).profit).toBeNull()
  })
  it('compares only completed months and identifies them explicitly', () => {
    expect(completedMonthComparison([
      { label: 'Aug', period: 'August 2026', total: 63000 },
      { label: 'Sep', period: 'September 2026', total: 16000 },
      { label: 'Oct', period: 'October 2026', total: 15000, partial: true }
    ])).toEqual({ amount: -47000, label: 'September 2026 versus August 2026' })
  })
  it('uses the same through today boundary for monthly receipts, won value, profit and outcomes', () => {
    const futureTimestamp = new Date(2026, 9, 28, 12).toISOString()
    const jobs = [
      { id: 'today', stage: 'job', amount: 1000, cost: 200, updated_at: '2026-10-27', created_at: '2026-10-27' },
      { id: 'future', stage: 'job', amount: 9000, cost: 1000, updated_at: '2026-10-28', created_at: futureTimestamp }
    ]
    const payments = [{ amount: 1000, paid_on: '2026-10-27' }, { amount: 9000, paid_on: '2026-10-28' }]
    expect(paymentsReceivedInPeriod(payments, new Date(2026, 9, 1), new Date(2026, 10, 1), now)).toBe(1000)
    expect(financialYearSummary([], payments, now).received).toBe(1000)
    expect(wonYTD(jobs, [], now)).toBe(1000)
    expect(profitCoverageYTD(jobs, [], now)).toEqual({ profit: 800, costed: 1, total: 1, missing: 0 })
    expect(wonYTD(jobs, [{ contact_id: 'today', to_stage: 'job', transitioned_at: '2026-10-28T12:00:00Z' }], now)).toBe(0)
    expect(computeFunnel({ leads: [], quotes: [{ job_id: 'future', created_at: futureTimestamp, updated_at: futureTimestamp }], jobs }, 90, now).won).toBe(0)
  })
})
