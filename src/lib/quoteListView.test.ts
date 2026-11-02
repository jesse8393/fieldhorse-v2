import { describe, expect, it } from 'vitest'
import { quoteListView } from './quoteListView.ts'
import type { QuoteWithClient } from '../screens/quotes/quoteShape.ts'

const now = Date.parse('2026-11-02T14:00:00Z')
const quote = (id: string, status: string, extra = {}): QuoteWithClient => ({ id, status, title: id, scope_text: '', fh_clients: { id: 'customer', name: 'Morgan Davis' }, ...extra } as QuoteWithClient)

describe('quote workspace inventory', () => {
  it('separates replies from work needing attention without misclassifying approved expiry', () => {
    const rows = [quote('draft', 'draft'), quote('sent', 'sent'), quote('viewed', 'viewed'), quote('expired', 'sent', { expires_at: '2026-11-01' }), quote('revision', 'changes_requested'), quote('approved', 'approved', { expires_at: '2026-11-01' }), quote('rejected', 'rejected')]
    expect(quoteListView(rows, '', 'all', now).counts).toEqual({ all: 7, draft: 1, waiting: 2, attention: 2, approved: 1 })
    expect(quoteListView(rows, '', 'attention', now).visible.map(q => q.id)).toEqual(['expired', 'revision'])
    expect(quoteListView(rows, '', 'approved', now).visible.map(q => q.id)).toEqual(['approved'])
  })
  it('searches customer, scope and title together while keeping inventory totals', () => {
    const rows = [quote('Patio', 'draft', { scope_text: 'Cedar framing' }), quote('Roof', 'sent')]
    expect(quoteListView(rows, ' CEDAR ', 'draft', now).visible.map(q => q.id)).toEqual(['Patio'])
    expect(quoteListView(rows, 'morgan', 'all', now).visible).toHaveLength(2)
    expect(quoteListView(rows, 'roof', 'draft', now).visible).toHaveLength(0)
    expect(quoteListView(rows, 'roof', 'draft', now).counts.all).toBe(2)
  })
  it('moves a quote into attention when its expiry passes', () => {
    const row = quote('due', 'sent', { expires_at: new Date(now + 60_000).toISOString() })
    expect(quoteListView([row], '', 'waiting', now).visible).toHaveLength(1)
    expect(quoteListView([row], '', 'attention', now + 61_000).visible).toHaveLength(1)
  })
})
