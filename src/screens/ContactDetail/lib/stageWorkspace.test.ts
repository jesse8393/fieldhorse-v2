import { describe, it, expect } from 'vitest'
import { tabsForStage, resolveTabForStage } from './stageWorkspace.ts'

describe('tabsForStage', () => {
  it('shows the quote builder while still selling (lead/quote)', () => {
    // Lead is intentionally minimal — no selections/materials/COs yet,
    // those land once the deal advances to quote and the operator
    // starts authoring scope.
    expect(tabsForStage('lead')).toEqual(['overview', 'quote', 'details', 'files'])
    // Quote stage exposes the full pre-job authoring surface:
    // selections (finish picks), materials (procurement), and change
    // orders (live amendments to the quote in progress).
    expect(tabsForStage('quote')).toEqual([
      'overview', 'quote', 'details', 'selections', 'materials', 'change_orders', 'files'
    ])
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
    // ALL_TABS is the safety net when the stage key is missing or
    // unrecognized — surface every section so the operator can still
    // navigate everywhere instead of getting locked out of features.
    const all = [
      'overview', 'quote', 'details', 'financials', 'files',
      'logs', 'selections', 'materials', 'change_orders'
    ]
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
