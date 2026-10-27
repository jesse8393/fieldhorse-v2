import { describe, expect, it } from 'vitest'
import { changeTemplatePreferences, filterQuoteLibrary, quoteBucket, templatePreferences } from './estimateLibrary.ts'
import type { QuoteWithClient } from '../quotes/quoteShape.ts'

const quote = (patch: Partial<QuoteWithClient>): QuoteWithClient => ({ id: 'q-1', status: 'draft', title: 'Roof replacement', amount: 2500, updated_at: '2026-10-27T12:00:00Z', job_id: null, fh_clients: { id: 'client', name: 'Sam Lane' }, ...patch } as QuoteWithClient)

describe('quote library', () => {
  it('finds older records by customer and scope, not only title', () => {
    const rows = [quote({ id: 'older', scope_text: 'Copper flashing', updated_at: '2026-01-01T12:00:00Z' }), quote({ id: 'newer', fh_clients: { id: 'other', name: 'Taylor' } })]
    expect(filterQuoteLibrary(rows, 'copper', 'all', 'recent').map(row => row.id)).toEqual(['older'])
    expect(filterQuoteLibrary(rows, 'SAM LANE', 'all', 'recent').map(row => row.id)).toEqual(['older'])
  })
  it('removes converted quotes from the outstanding approval bucket', () => {
    expect(quoteBucket(quote({ status: 'approved', job_id: 'job' }))).toBe('converted')
    expect(quoteBucket(quote({ status: 'sent', expires_at: '2000-01-01T00:00:00Z' }))).toBe('closed')
    expect(filterQuoteLibrary([quote({ status: 'sent' }), quote({ id: 'converted', status: 'sent', job_id: 'job' })], '', 'waiting', 'recent')).toHaveLength(1)
  })
  it('combines search, lifecycle filter and stable value sorting', () => {
    const rows = [quote({ amount: 2500 }), quote({ id: 'large', amount: 5000 }), quote({ id: 'sent', status: 'sent', amount: 9000 })]
    expect(filterQuoteLibrary(rows, 'roof', 'draft', 'value').map(row => row.id)).toEqual(['large', 'q-1'])
    expect(rows[0].id).toBe('q-1')
  })
})

describe('personal template library', () => {
  it('uses conservative defaults without guessing imported origin', () => {
    expect(templatePreferences(null, 'one')).toEqual({ favorite: false, category: 'reusable' })
    expect(templatePreferences({ estimate_library: { one: { favorite: 'true', category: 'unknown' } } }, 'one')).toEqual({ favorite: false, category: 'reusable' })
  })
  it('preserves unrelated preferences and other templates', () => {
    const initial = { quote_follow_up: { enabled: true }, estimate_library: { first: { favorite: true, category: 'imported' } } }
    const changed = changeTemplatePreferences(initial, 'second', { favorite: true })
    expect(changed.quote_follow_up).toEqual(initial.quote_follow_up)
    expect(templatePreferences(changed, 'first')).toEqual({ favorite: true, category: 'imported' })
    expect(templatePreferences(changed, 'second')).toEqual({ favorite: true, category: 'reusable' })
    expect(initial.estimate_library).not.toHaveProperty('second')
  })
})
