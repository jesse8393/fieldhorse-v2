import { describe, it, expect } from 'vitest'
import { tabsForStage, resolveTabForStage, stageCta, jobStage } from './stageWorkspace.ts'

// A job's stage is job, closed or lost (SPEC D55); leads and quotes are
// records of their own, so the job carries no Quote tab (Phase 9, Task 13).

describe('tabsForStage', () => {
  it('exposes Financials on a job so invoices can be added mid-job', () => {
    expect(tabsForStage('job')).toContain('financials')
    expect(tabsForStage('invoice')).toContain('financials')
    expect(tabsForStage('closed')).toContain('financials')
  })

  it('never shows a Quote tab', () => {
    for (const stage of ['job', 'invoice', 'closed', 'lost', 'lead', 'quote', undefined, null]) {
      expect(tabsForStage(stage)).not.toContain('quote')
    }
  })

  it('keeps lost minimal', () => {
    expect(tabsForStage('lost')).toEqual(['overview', 'files'])
  })

  it('reads every other stage as a job, including a missing one', () => {
    const job = tabsForStage('job')
    expect(job).toEqual(['overview', 'details', 'selections', 'materials', 'logs', 'change_orders', 'financials', 'files'])
    expect(tabsForStage('invoice')).toEqual(job)
    expect(tabsForStage('lead')).toEqual(job)
    expect(tabsForStage(undefined)).toEqual(job)
    expect(tabsForStage(null)).toEqual(job)
    expect(tabsForStage('totally-not-a-stage')).toEqual(job)
  })

  it('is case-insensitive on the stage key', () => {
    expect(tabsForStage('CLOSED')).toEqual(tabsForStage('closed'))
    expect(jobStage('LOST')).toBe('lost')
  })
})

describe('resolveTabForStage', () => {
  it('honors a requested tab the stage exposes', () => {
    expect(resolveTabForStage('job', 'materials')).toBe('materials')
    expect(resolveTabForStage('invoice', 'financials')).toBe('financials')
  })

  it('falls back to overview when the stage does not expose the requested tab', () => {
    expect(resolveTabForStage('job', 'quote')).toBe('overview')
    expect(resolveTabForStage('lost', 'financials')).toBe('overview')
  })

  it('falls back to overview for empty/missing requests', () => {
    expect(resolveTabForStage('job', null)).toBe('overview')
    expect(resolveTabForStage('job', undefined)).toBe('overview')
  })
})

describe('stageCta', () => {
  it('is Invoice this while money is owed', () => {
    expect(stageCta('job', 1200)).toEqual({ label: 'Invoice this', action: 'invoice' })
    expect(stageCta('invoice', 0.5)).toEqual({ label: 'Invoice this', action: 'invoice' })
  })

  it('is Mark complete once the balance is collected', () => {
    expect(stageCta('job', 0)).toEqual({ label: 'Mark complete', action: 'complete' })
    expect(stageCta('job', null)).toEqual({ label: 'Mark complete', action: 'complete' })
  })

  it('is Reopen on a closed or lost job, whatever the balance', () => {
    expect(stageCta('closed', 0)).toEqual({ label: 'Reopen', action: 'reopen' })
    expect(stageCta('lost', 5000)).toEqual({ label: 'Reopen', action: 'reopen' })
  })
})
