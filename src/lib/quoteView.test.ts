import { describe, expect, it } from 'vitest'
import {
  buildQuoteView,
  depositScheduleFromTerms,
  previewAsLabel,
  type QuoteItemRow
} from './quoteView.ts'

// Rows shaped like fh_quote_items. Only the fields the view reads matter.
function item(partial: Partial<QuoteItemRow> & { id: string }, i = 0): QuoteItemRow {
  return {
    section: null,
    description: `Line ${i}`,
    qty: 1,
    unit: null,
    rate: 0,
    amount: 0,
    notes: null,
    is_optional: false,
    is_excluded: false,
    sort_order: i,
    created_at: new Date(2026, 9, 1, 8, 0, i).toISOString(),
    ...partial
  }
}

const THREE_BASE_ONE_OPTIONAL: QuoteItemRow[] = [
  item({ id: 'a', description: 'Excavate and grade', qty: 1100, unit: 'sq ft', rate: 2, amount: 2200 }, 0),
  item({ id: 'b', description: 'Rebar, #4 at 18 in on center', qty: 1100, unit: 'sq ft', rate: 2.6, amount: 2860 }, 1),
  item({ id: 'c', description: 'Pump truck', qty: 1, unit: 'day', rate: 950, amount: 950 }, 2),
  item({ id: 'd', description: 'Stamped ashlar, charcoal release', qty: 1, rate: 4950, amount: 4950, is_optional: true }, 3)
]

describe('buildQuoteView totals', () => {
  it('sums only the base lines and lists the optional one apart', () => {
    const view = buildQuoteView(THREE_BASE_ONE_OPTIONAL)
    expect(view.baseTotal).toBe(6010)
    expect(view.lines.map((l) => l.id)).toEqual(['a', 'b', 'c'])
    expect(view.optional).toHaveLength(1)
    expect(view.optional[0]).toMatchObject({ id: 'd', title: 'Stamped ashlar, charcoal release', amount: 4950 })
    expect(view.excluded).toEqual([])
    expect(view.canSend).toBe(true)
  })

  it('keeps excluded lines out of the total and out of the lines', () => {
    const view = buildQuoteView([
      ...THREE_BASE_ONE_OPTIONAL,
      item({ id: 'e', description: 'Permit fees', qty: 1, rate: 300, amount: 300, is_excluded: true }, 4)
    ])
    expect(view.baseTotal).toBe(6010)
    expect(view.excluded.map((l) => l.id)).toEqual(['e'])
    expect(view.lines.map((l) => l.id)).toEqual(['a', 'b', 'c'])
  })

  it('adds up in cents so the total never drifts', () => {
    const view = buildQuoteView([
      item({ id: 'a', amount: 0.1 }, 0),
      item({ id: 'b', amount: 0.2 }, 1),
      item({ id: 'c', amount: 10.01 }, 2)
    ])
    expect(view.baseTotal).toBe(10.31)
  })

  it('reads amounts that arrive as strings', () => {
    const view = buildQuoteView([item({ id: 'a', qty: '2', rate: '3.5', amount: '7.00' })])
    expect(view.baseTotal).toBe(7)
    expect(view.lines[0].amount).toBe(7)
    expect(view.lines[0].detail).toBe('2 at $3.50')
  })
})

describe('buildQuoteView deposit', () => {
  it('is 50 percent of the base total, rounded to cents', () => {
    const view = buildQuoteView(THREE_BASE_ONE_OPTIONAL)
    expect(view.deposit).toEqual({ pct: 50, amount: 3005 })
    const odd = buildQuoteView([item({ id: 'a', amount: 100.01 })])
    expect(odd.deposit).toEqual({ pct: 50, amount: 50.01 })
  })

  it('never counts optional items', () => {
    const withOptional = buildQuoteView(THREE_BASE_ONE_OPTIONAL)
    const without = buildQuoteView(THREE_BASE_ONE_OPTIONAL.filter((r) => !r.is_optional))
    expect(withOptional.deposit).toEqual(without.deposit)
  })

  it('follows a payment schedule passed in, using its first step', () => {
    const view = buildQuoteView(THREE_BASE_ONE_OPTIONAL, [{ pct: 30 }, { pct: 70 }])
    expect(view.deposit).toEqual({ pct: 30, amount: 1803 })
  })
})

describe('quote with only optional items', () => {
  const view = buildQuoteView([
    item({ id: 'o1', amount: 1200, is_optional: true }, 0),
    item({ id: 'o2', amount: 800, is_optional: true }, 1)
  ])

  it('has a zero total and a zero deposit', () => {
    expect(view.baseTotal).toBe(0)
    expect(view.deposit).toEqual({ pct: 50, amount: 0 })
    expect(view.lines).toEqual([])
    expect(view.optional).toHaveLength(2)
  })

  it('cannot be sent', () => {
    expect(view.canSend).toBe(false)
  })
})

describe('an empty quote', () => {
  it('has zeros and cannot be sent', () => {
    const view = buildQuoteView([])
    expect(view).toEqual({
      lines: [],
      optional: [],
      excluded: [],
      baseTotal: 0,
      deposit: { pct: 50, amount: 0 },
      canSend: false
    })
  })
})

describe('line detail', () => {
  const detailOf = (row: Partial<QuoteItemRow>) =>
    buildQuoteView([item({ id: 'x', amount: 1, ...row })]).lines[0].detail

  it('reads quantity with separators, the unit, "at", then the rate with cents', () => {
    expect(detailOf({ qty: 1100, unit: 'sq ft', rate: 2 })).toBe('1,100 sq ft at $2.00')
    expect(detailOf({ qty: 160, unit: 'lf', rate: 4 })).toBe('160 lf at $4.00')
    expect(detailOf({ qty: 1, unit: 'day', rate: 950 })).toBe('1 day at $950.00')
    expect(detailOf({ qty: 2.5, unit: 'hr', rate: 85.5 })).toBe('2.5 hr at $85.50')
  })

  it('is just the rate when the quantity is 1 and there is no unit', () => {
    expect(detailOf({ qty: 1, unit: null, rate: 950 })).toBe('$950.00')
    expect(detailOf({ qty: 1, unit: '  ', rate: 12.5 })).toBe('$12.50')
  })

  it('shows a quantity without a unit when it is not 1', () => {
    expect(detailOf({ qty: 4, unit: null, rate: 25 })).toBe('4 at $25.00')
  })

  it('leaves the rate out when there is none', () => {
    expect(detailOf({ qty: 2, unit: 'loads', rate: 0 })).toBe('2 loads')
    expect(detailOf({ qty: 1, unit: null, rate: 0 })).toBe('')
  })

  it('adds the note after a comma', () => {
    expect(detailOf({ qty: 1100, unit: 'sq ft', rate: 8.5, notes: 'broom finish' })).toBe('1,100 sq ft at $8.50, broom finish')
    expect(detailOf({ qty: 1, unit: null, rate: 0, notes: 'Allowance' })).toBe('Allowance')
  })

  it('writes no hyphen, en dash or em dash of its own', () => {
    const view = buildQuoteView(THREE_BASE_ONE_OPTIONAL)
    for (const line of [...view.lines, ...view.optional]) {
      expect(line.detail).not.toMatch(/[-–—]/)
    }
  })
})

describe('line order and titles', () => {
  it('sorts by sort_order, then by creation time, then by position', () => {
    const rows = [
      item({ id: 'third', sort_order: 5, created_at: '2026-10-01T10:00:00Z' }),
      item({ id: 'first', sort_order: 1, created_at: '2026-10-01T12:00:00Z' }),
      item({ id: 'second-b', sort_order: 2, created_at: '2026-10-01T09:00:00Z' }),
      item({ id: 'second-a', sort_order: 2, created_at: '2026-10-01T08:00:00Z' })
    ]
    expect(buildQuoteView(rows).lines.map((l) => l.id)).toEqual(['first', 'second-a', 'second-b', 'third'])
  })

  it('trims titles and keeps a stand in for a blank one', () => {
    const view = buildQuoteView([
      item({ id: 'a', description: '  Pump truck  ', amount: 1 }),
      item({ id: 'b', description: '   ', amount: 1 }, 1)
    ])
    expect(view.lines.map((l) => l.title)).toEqual(['Pump truck', 'Line item'])
  })

  it('does not change the rows it was given', () => {
    const rows = [item({ id: 'b', sort_order: 2 }), item({ id: 'a', sort_order: 1 })]
    const copy = rows.map((r) => ({ ...r }))
    buildQuoteView(rows)
    expect(rows).toEqual(copy)
  })
})

describe('depositScheduleFromTerms', () => {
  it('reads the deposit percent the contractor wrote', () => {
    expect(depositScheduleFromTerms('30% deposit on signing, 70% on completion.')).toEqual([{ pct: 30 }])
    expect(depositScheduleFromTerms('A deposit of 25 percent is due at approval.')).toEqual([{ pct: 25 }])
    expect(depositScheduleFromTerms('Deposit: 40%, balance on completion')).toEqual([{ pct: 40 }])
    expect(depositScheduleFromTerms('12.5% down payment to schedule the pour')).toEqual([{ pct: 12.5 }])
  })

  it('returns null when the terms say nothing usable', () => {
    expect(depositScheduleFromTerms('')).toBeNull()
    expect(depositScheduleFromTerms(null)).toBeNull()
    expect(depositScheduleFromTerms(undefined)).toBeNull()
    expect(depositScheduleFromTerms('Net 30. 10% retainage held until punch list.')).toBeNull()
    expect(depositScheduleFromTerms('No deposit required.')).toBeNull()
    expect(depositScheduleFromTerms('0% deposit')).toBeNull()
    expect(depositScheduleFromTerms('150% deposit')).toBeNull()
  })

  it('feeds the deposit the screen shows', () => {
    const schedule = depositScheduleFromTerms('30% deposit on signing')
    const view = buildQuoteView(THREE_BASE_ONE_OPTIONAL, schedule ?? undefined)
    expect(view.deposit).toEqual({ pct: 30, amount: 1803 })
  })
})

describe('previewAsLabel', () => {
  it('uses the first name of a person', () => {
    expect(previewAsLabel('Taylor Reed')).toBe('Preview as Taylor')
    expect(previewAsLabel('Marco Castellanos')).toBe('Preview as Marco')
    expect(previewAsLabel("  Jeff  O'Neil ")).toBe('Preview as Jeff')
  })

  it('keeps a company name whole', () => {
    expect(previewAsLabel('MMC Properties')).toBe('Preview as MMC Properties')
    expect(previewAsLabel('Plumbing Bellevue')).toBe('Preview as Plumbing Bellevue')
    expect(previewAsLabel('Old Mill HOA')).toBe('Preview as Old Mill HOA')
  })

  it('falls back to a plain word for a missing or very long name', () => {
    expect(previewAsLabel('')).toBe('Preview as customer')
    expect(previewAsLabel(null)).toBe('Preview as customer')
    expect(previewAsLabel('The Castellanos Family Revocable Living Trust')).toBe('Preview as customer')
  })
})
