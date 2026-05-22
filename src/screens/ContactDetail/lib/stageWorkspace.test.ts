import { describe, it, expect } from 'vitest'
import { tabsForStage, resolveTabForStage } from './stageWorkspace.ts'

describe('tabsForStage', () => {
  it('shows the quote builder while still selling (lead/quote)', () => {
    expect(tabsForStage('lead')).toEqual(['overview', 'quote', 'details', 'files'])
    expect(tabsForStage('quote')).toEqual(['overview', 'quote', 'details', 'files'])
  })

  it('exposes Financials from the job stage so invoices can be added mid-job', () => {
    expect(tabsForStage('job')).toContain('financials')
    expect(tabsForStage('invoice')).toContain('financials')
    expect(tabsForStage('closed')).toContain('financials')
  })

  it('does NOT show Financials before there is money (lead/quote)', () => {
    expect(tabsForStage('lead')).not.toContain('financials')
    expect(tabsForStage('quote')).not.toContain('financials')
  })

  it('hides the Quote tab once invoicing — a materials/quick-job invoice needs no quote', () => {
    expect(tabsForStage('invoice')).not.toContain('quote')
    expect(tabsForStage('closed')).not.toContain('quote')
  })

  it('keeps lost minimal', () => {
    expect(tabsForStage('lost')).toEqual(['overview', 'files'])
  })

  it('falls back to all tabs for unknown / missing stages', () => {
    const all = ['overview', 'quote', 'details', 'financials', 'files']
    expect(tabsForStage(undefined)).toEqual(all)
    expect(tabsForStage(null)).toEqual(all)
    expect(tabsForStage('totally-not-a-stage')).toEqual(all)
  })

  it('is case-insensitive on the stage key', () => {
    expect(tabsForStage('INVOICE')).toEqual(tabsForStage('invoice'))
  })
})

describe('resolveTabForStage', () => {
  it('honors a requested tab the stage exposes', () => {
    expect(resolveTabForStage('quote', 'quote')).toBe('quote')
    expect(resolveTabForStage('invoice', 'financials')).toBe('financials')
  })

  it('falls back to overview when the stage does not expose the requested tab', () => {
    expect(resolveTabForStage('invoice', 'quote')).toBe('overview')
    expect(resolveTabForStage('lead', 'financials')).toBe('overview')
  })

  it('falls back to overview for empty/missing requests', () => {
    expect(resolveTabForStage('job', null)).toBe('overview')
    expect(resolveTabForStage('job', undefined)).toBe('overview')
  })
})
