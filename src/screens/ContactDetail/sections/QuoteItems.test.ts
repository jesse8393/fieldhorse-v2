// The line editor's money, through the same helpers the quote screen and
// the job builder use: what the editor fills in and what it saves.
import { describe, expect, it, vi } from 'vitest'

vi.mock('../../../lib/supabase.ts', () => ({ supabase: {} }))

const { applySuggestion, emptyDraft, draftFromRow, normalizeForDB, patchDraft } = await import('./QuoteItems.tsx')

function type(draft: any, key: string, value: unknown) {
  let next = draft
  patchDraft((fn: (d: any) => any) => { next = fn(next) }, key, value)
  return next
}

describe('the amount the editor fills in (M-10)', () => {
  it('2.5 at $4.33 is $10.83, a half cent rounded up', () => {
    let draft = { ...emptyDraft() }
    draft = type(draft, 'description', 'Saw cut joints')
    draft = type(draft, 'qty', '2.5')
    draft = type(draft, 'rate', '4.33')
    expect(draft.amount).toBe('10.83')
    expect(normalizeForDB(draft).amount).toBe(10.83)
  })

  it('a picked suggestion fills the same amount', () => {
    let draft = type({ ...emptyDraft() }, 'qty', '2.5')
    applySuggestion((fn: (d: any) => any) => { draft = fn(draft) }, { description: 'Saw cut', rate: 4.33, unit: 'lf', source: 'rates', uses: 1 })
    expect(draft.amount).toBe('10.83')
  })
})

