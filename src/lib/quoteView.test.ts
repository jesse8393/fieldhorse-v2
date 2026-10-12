import { describe, expect, it } from 'vitest'
import {
  buildQuoteView,
  previewAsLabel,
  previewAsName,
  personFirstName,
  quoteCapsule,
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
    expect(view.money.deposit).toEqual({ kind: 'percent', pct: 50, amount: 3005 })
    const odd = buildQuoteView([item({ id: 'a', amount: 100.01 })])
    expect(odd.money.deposit).toEqual({ kind: 'percent', pct: 50, amount: 50.01 })
  })

  it('never counts optional items', () => {
    const withOptional = buildQuoteView(THREE_BASE_ONE_OPTIONAL)
    const without = buildQuoteView(THREE_BASE_ONE_OPTIONAL.filter((r) => !r.is_optional))
    expect(withOptional.money.deposit).toEqual(without.money.deposit)
  })

  it('follows the deposit the payment terms name', () => {
    const view = buildQuoteView(THREE_BASE_ONE_OPTIONAL, { termsText: '30% deposit on signing, 70% on completion.' })
    expect(view.money.deposit).toEqual({ kind: 'percent', pct: 30, amount: 1803 })
  })

  it('adds approved change orders to the total, as the customer page does', () => {
    const view = buildQuoteView(THREE_BASE_ONE_OPTIONAL, { changeOrders: [{ amount: 3990, status: 'approved' }, { amount: 500, status: 'sent' }] })
    expect(view.baseTotal).toBe(6010)
    expect(view.money.total).toBe(10000)
    expect(view.money.deposit).toEqual({ kind: 'percent', pct: 50, amount: 5000 })
  })

  it('stands in the contact amount until there is a priced line', () => {
    const view = buildQuoteView([], { contactAmount: 10000 })
    expect(view.baseTotal).toBe(0)
    expect(view.money.total).toBe(10000)
    expect(view.canSend).toBe(false)
  })
})

describe('quote with only optional items', () => {
  const view = buildQuoteView([
    item({ id: 'o1', amount: 1200, is_optional: true }, 0),
    item({ id: 'o2', amount: 800, is_optional: true }, 1)
  ])

  it('has a zero total and a zero deposit', () => {
    expect(view.baseTotal).toBe(0)
    expect(view.money.total).toBe(0)
    expect(view.money.deposit).toEqual({ kind: 'percent', pct: 50, amount: 0 })
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
      money: {
        total: 0,
        deposit: { kind: 'percent', pct: 50, amount: 0 },
        steps: ['You approve the quote.', 'Your contractor sends you a start date.', 'You pay as the payment terms say.']
      },
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

// These cases were the depositScheduleFromTerms tests. That reader is gone:
// the deposit now comes from quoteMoney (decision D31), so each input is
// checked through buildQuoteView, and the terms that used to fall back to
// 50 percent now read as no deposit or "per the terms".
describe('deposit read from the payment terms', () => {
  const depositFor = (termsText: string | null | undefined) =>
    buildQuoteView(THREE_BASE_ONE_OPTIONAL, { termsText }).money.deposit

  it('reads the deposit percent the contractor wrote', () => {
    expect(depositFor('30% deposit on signing, 70% on completion.')).toMatchObject({ kind: 'percent', pct: 30 })
    expect(depositFor('A deposit of 25 percent is due at approval.')).toMatchObject({ kind: 'percent', pct: 25 })
    expect(depositFor('Deposit: 40%, balance on completion')).toMatchObject({ kind: 'percent', pct: 40 })
    expect(depositFor('12.5% down payment to schedule the pour')).toMatchObject({ kind: 'percent', pct: 12.5 })
  })

  it('takes the default schedule only when there are no terms', () => {
    expect(depositFor('')).toMatchObject({ kind: 'percent', pct: 50 })
    expect(depositFor(null)).toMatchObject({ kind: 'percent', pct: 50 })
    expect(depositFor(undefined)).toMatchObject({ kind: 'percent', pct: 50 })
  })

  it('reads no deposit, or payment per the terms, when the terms name no deposit', () => {
    expect(depositFor('Net 30. 10% retainage held until punch list.')).toEqual({ kind: 'per_terms', pct: null, amount: 0 })
    expect(depositFor('No deposit required.')).toEqual({ kind: 'none', pct: 0, amount: 0 })
    expect(depositFor('0% deposit')).toEqual({ kind: 'none', pct: 0, amount: 0 })
    expect(depositFor('150% deposit')).toEqual({ kind: 'per_terms', pct: null, amount: 0 })
  })

  it('feeds the deposit the screen shows', () => {
    const view = buildQuoteView(THREE_BASE_ONE_OPTIONAL, { termsText: '30% deposit on signing' })
    expect(view.money.deposit).toEqual({ kind: 'percent', pct: 30, amount: 1803 })
    expect(quoteCapsule(view.money).note).toBe('Deposit $1,803.00 at approval')
  })
})

describe('quoteCapsule', () => {
  const capsule = (termsText: string) =>
    quoteCapsule(buildQuoteView([item({ id: 'a', amount: 10000 })], { termsText }).money)

  it('prints the total with cents and the deposit due at approval', () => {
    expect(capsule('')).toEqual({ amount: '$10,000.00', note: 'Deposit $5,000.00 at approval' })
    expect(capsule('30% deposit on signing.')).toEqual({ amount: '$10,000.00', note: 'Deposit $3,000.00 at approval' })
    expect(capsule('$2,500 deposit on signing.')).toEqual({ amount: '$10,000.00', note: 'Deposit $2,500.00 at approval' })
  })

  it('says so when there is no deposit, or when the terms name none', () => {
    expect(capsule('No deposit required.')).toEqual({ amount: '$10,000.00', note: 'No deposit' })
    expect(capsule('50% down at rough in, 50% at completion.')).toEqual({ amount: '$10,000.00', note: 'Payment follows the terms' })
  })

  it('writes no dash of any kind', () => {
    for (const terms of ['', 'No deposit.', 'Net 30.', '$2,500 deposit']) {
      expect(capsule(terms).note).not.toMatch(/[-‐-―−]/)
    }
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

  it('drops a leading article and keeps the rest of a company name', () => {
    expect(previewAsLabel('The Roof Doctor')).toBe('Preview as Roof Doctor')
    expect(previewAsLabel('A Cut Above Lawn')).toBe('Preview as Cut Above Lawn')
  })

  it('reads a name written last name first', () => {
    expect(previewAsLabel('Castellanos, Marco')).toBe('Preview as Marco')
    expect(previewAsLabel("O'Neil, Jeff A.")).toBe('Preview as Jeff')
  })
})

describe('personFirstName', () => {
  it('is the first name of a person and null for a company', () => {
    expect(personFirstName('Marco Castellanos')).toBe('Marco')
    expect(personFirstName('  Jeff  O\'Neil ')).toBe('Jeff')
    expect(personFirstName('Castellanos, Marco')).toBe('Marco')
    expect(personFirstName('MMC Properties')).toBeNull()
    expect(personFirstName('The Roof Doctor')).toBeNull()
    expect(personFirstName('Acme, Inc')).toBeNull()
    expect(personFirstName('')).toBeNull()
    expect(personFirstName(null)).toBeNull()
  })

  it('reads names with accents, a name typed in capitals, and ignores a suffix', () => {
    expect(personFirstName('José García')).toBe('José')
    expect(personFirstName('Zoë Smith')).toBe('Zoë')
    expect(personFirstName('MARCO CASTELLANOS')).toBe('Marco')
    expect(personFirstName('Marco Castellanos Jr.')).toBe('Marco')
    expect(personFirstName('Marco Castellanos III')).toBe('Marco')
    expect(personFirstName('Smith, John, Jr.')).toBe('John')
    // A single word in capitals is still a company.
    expect(personFirstName('IBM')).toBeNull()
    expect(personFirstName('HOA')).toBeNull()
    expect(personFirstName('MMC Properties')).toBeNull()
  })

  it('treats A or An as an article only before two or more words, so An is a first name', () => {
    expect(personFirstName('An Nguyen')).toBe('An')
    expect(previewAsLabel('An Nguyen')).toBe('Preview as An')
    expect(personFirstName('An Affordable Plumber')).toBeNull()
    expect(previewAsLabel('An Affordable Plumber')).toBe('Preview as Affordable Plumber')
    expect(personFirstName('A Cut Above Lawn')).toBeNull()
    // An initial is not a first name to greet someone by.
    expect(personFirstName('J Smith')).toBeNull()
    expect(personFirstName('A Nguyen')).toBeNull()
  })

  // Review round 2: names the first word greeting used to get right.
  it('reads a middle initial, name particles and a title as parts of a person\'s name', () => {
    expect(personFirstName('John Q. Public')).toBe('John')
    expect(personFirstName('Marco A. Castellanos')).toBe('Marco')
    expect(personFirstName('MARCO A. CASTELLANOS')).toBe('Marco')
    expect(personFirstName('Public, John Q.')).toBe('John')
    expect(personFirstName('Maria de Souza')).toBe('Maria')
    expect(personFirstName('Ludwig van Beethoven')).toBe('Ludwig')
    expect(personFirstName('Maria de los Santos')).toBe('Maria')
    expect(personFirstName('Jan van der Berg')).toBe('Jan')
    expect(personFirstName('MARIA DE LOS SANTOS')).toBe('Maria')
    expect(personFirstName('Omar al-Rashid')).toBe('Omar')
    expect(personFirstName('de la Cruz, Maria')).toBe('Maria')
    expect(personFirstName('Dr. Marco Castellanos')).toBe('Marco')
    expect(personFirstName('MR. JOHN SMITH')).toBe('John')
    // A first name that is also a particle elsewhere is still a first name.
    expect(personFirstName('Al Smith')).toBe('Al')
    expect(personFirstName('Van Morrison')).toBe('Van')
    expect(previewAsLabel('John Q. Public')).toBe('Preview as John')
  })

  it('does not greet by a last name or an initial', () => {
    // What is left after a title or a suffix is a last name.
    expect(personFirstName('Smith, Jr.')).toBeNull()
    expect(personFirstName('Mrs. Smith')).toBeNull()
    expect(personFirstName('Dr. Castellanos')).toBeNull()
    // Initials alone are not a first name.
    expect(personFirstName('J.R. Smith')).toBeNull()
    expect(personFirstName('J. Smith')).toBeNull()
  })

  it('reads a name in capitals as a company when it starts like an acronym', () => {
    expect(personFirstName('IBM GLOBAL')).toBeNull()
    expect(personFirstName('JM EAGLE')).toBeNull()
    expect(personFirstName('ACE HVAC')).toBeNull()
    expect(personFirstName('JB CONTRACTING')).toBeNull()
    expect(personFirstName('ABC REMODELING')).toBeNull()
    expect(personFirstName('XYZ PAINTING')).toBeNull()
    expect(previewAsLabel('JB CONTRACTING')).toBe('Preview as JB CONTRACTING')
    expect(previewAsLabel('IBM GLOBAL')).toBe('Preview as IBM GLOBAL')
    // Typed in mixed case the acronym already says company.
    expect(personFirstName('IBM Global')).toBeNull()
    // A person's name in capitals still reads as a person's.
    expect(personFirstName('MARCO CASTELLANOS')).toBe('Marco')
    expect(personFirstName('JOSÉ GARCÍA')).toBe('José')
    expect(personFirstName('BOB SMITH')).toBe('Bob')
    expect(personFirstName('IAN WRIGHT')).toBe('Ian')
  })

  // Review round 3: a phone keyboard capitalizes only the first word, so
  // contact names are often saved in sentence case.
  it('reads a name typed in sentence case or in lower case as a person\'s', () => {
    expect(personFirstName('Marco castellanos')).toBe('Marco')
    expect(personFirstName('Jane smith')).toBe('Jane')
    expect(personFirstName('marco castellanos')).toBe('Marco')
    expect(personFirstName('Maria de los santos')).toBe('Maria')
    expect(personFirstName('John q. public')).toBe('John')
    expect(personFirstName('Marco castellanos jr')).toBe('Marco')
    expect(personFirstName('Castellanos, marco')).toBe('Marco')
    expect(personFirstName('MARCO castellanos')).toBe('Marco')
    // Recasing is a guess, so the in app label keeps the name as saved
    // (review round 4); the customer page still greets Marco.
    expect(previewAsLabel('Marco castellanos')).toBe('Preview as Marco castellanos')
    // A company stays a company whatever its case.
    expect(personFirstName('Sunrise roofing')).toBeNull()
    expect(personFirstName('Acme, inc')).toBeNull()
    expect(personFirstName('the roof doctor')).toBeNull()
    expect(personFirstName('jb contracting')).toBeNull()
    // In lower case, as in capitals, a first word like an acronym is a company's.
    expect(personFirstName('jm eagle')).toBeNull()
    expect(personFirstName('JM eagle')).toBeNull()
    // One word in lower case says nothing about a person.
    expect(personFirstName('marco')).toBeNull()
  })

  it('reads a household or a family business as a company, not a first name', () => {
    expect(personFirstName('Johnson Residence')).toBeNull()
    expect(personFirstName('Johnson Household')).toBeNull()
    expect(personFirstName('Lowe Bros')).toBeNull()
    expect(personFirstName('Lowe Brothers')).toBeNull()
    expect(personFirstName('Johnson residence')).toBeNull()
    expect(previewAsLabel('Johnson Residence')).toBe('Preview as Johnson Residence')
    expect(previewAsLabel('Lowe Bros')).toBe('Preview as Lowe Bros')
  })

  // Review round 4: recasing a name saved without its capitals must not undo
  // the capitals the person did type.
  it('keeps a word typed with its own inner capitals, and recases only words in all lower case or all capitals', () => {
    expect(personFirstName('DeShawn jones')).toBe('DeShawn')
    expect(personFirstName('LaToya smith')).toBe('LaToya')
    expect(personFirstName('McKenzie brown')).toBe('McKenzie')
    expect(personFirstName('JoAnn baker')).toBe('JoAnn')
    expect(personFirstName('MaryBeth carter')).toBe('MaryBeth')
    expect(personFirstName('Mary-Beth carter')).toBe('Mary-Beth')
    // A word with no capitals, or nothing but capitals, is still recased.
    expect(personFirstName('deshawn jones')).toBe('Deshawn')
    expect(personFirstName('DESHAWN JONES')).toBe('Deshawn')
    expect(personFirstName("jeff o'neil")).toBe('Jeff')
    expect(personFirstName('MARCO castellanos')).toBe('Marco')
  })

  it('reads and, or an ampersand, as joining a company rather than naming a person', () => {
    expect(personFirstName('Smith and sons')).toBeNull()
    expect(personFirstName('Smith And Sons')).toBeNull()
    expect(personFirstName('SMITH AND SONS')).toBeNull()
    expect(personFirstName('Smith & Sons')).toBeNull()
    expect(personFirstName('Smith & sons')).toBeNull()
    expect(previewAsLabel('Smith And Sons')).toBe('Preview as Smith And Sons')
  })

  it('keeps the whole name in the in app labels whenever the name was recased', () => {
    // previewAsName fills "Preview as", "Optional for" and "No email on file for".
    expect(previewAsName('Elite pools')).toBe('Elite pools')
    expect(previewAsLabel('Elite pools')).toBe('Preview as Elite pools')
    expect(previewAsName('Hill country lawn')).toBe('Hill country lawn')
    expect(previewAsName('Smith and sons')).toBe('Smith and sons')
    expect(previewAsName('DeShawn jones')).toBe('DeShawn jones')
    expect(previewAsName('MARCO CASTELLANOS')).toBe('MARCO CASTELLANOS')
    expect(previewAsName('Castellanos, marco')).toBe('Castellanos, marco')
    // Too long for the label, it falls back as a long company name does.
    expect(previewAsName('maria de los santos garcia')).toBe('customer')
    // Typed with its capitals, a person is still called by first name.
    expect(previewAsName('Marco Castellanos')).toBe('Marco')
    expect(previewAsName('DeShawn Jones')).toBe('DeShawn')
    expect(previewAsName('Castellanos, Marco')).toBe('Marco')
    expect(previewAsName('Dr. Marco Castellanos')).toBe('Marco')
  })
})
