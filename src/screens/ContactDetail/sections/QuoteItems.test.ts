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

describe('the amount the editor saves (M-22)', () => {
  it('an amount typed as 1.005 is saved as 1.01', () => {
    let draft = { ...emptyDraft() }
    draft = type(draft, 'description', 'Sealer')
    draft = type(draft, 'amount', '1.005')
    expect(normalizeForDB(draft).amount).toBe(1.01)
  })

  it('an edited saved line keeps its typed amount to the cent', () => {
    const draft = type(draftFromRow({ description: 'Pour', qty: 1, rate: 2000, amount: 2000 }), 'amount', '12500')
    expect(normalizeForDB(draft).amount).toBe(12500)
  })
})

describe('a lump sum line (M-17)', () => {
  it('an Amount typed on a quantity 1 line is saved as its rate too', () => {
    let draft = { ...emptyDraft() }
    draft = type(draft, 'description', 'Demo and haul off')
    draft = type(draft, 'amount', '1513')
    expect(normalizeForDB(draft)).toMatchObject({ qty: 1, rate: 1513, amount: 1513 })
  })

  it('an edited amount on a quantity 1 line moves its rate with it', () => {
    const draft = type(draftFromRow({ description: 'Pour', qty: 1, rate: 2000, amount: 2000 }), 'amount', '12500')
    expect(normalizeForDB(draft)).toMatchObject({ qty: 1, rate: 12500, amount: 12500 })
  })

  it('a line of several keeps its rate', () => {
    const draft = type(draftFromRow({ description: 'Pour', qty: 3, rate: 125, amount: 375 }), 'amount', '400')
    expect(normalizeForDB(draft)).toMatchObject({ qty: 3, rate: 125, amount: 400 })
  })
})
