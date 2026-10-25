import { describe, expect, it } from 'vitest'
import { companyShortName, quoteMoney, stepsAfterApproval, type MoneyChangeOrder, type MoneyItem, type QuoteMoneyInput } from './quoteMoney.ts'

// One quote total and one deposit for the Quote tab capsule, the in app
// preview and the customer page (PHASE8_PLAN.md Task 9, decision D31).
// Every rule is checked on a $10,000 quote.

// $6,000 and $4,000 base lines make $10,000. The optional line and the
// excluded line carry prices that must never reach the total.
const TEN_K: MoneyItem[] = [
  { amount: 6000, qty: 1, rate: 6000 },
  { amount: 4000, qty: 1, rate: 4000 },
  { amount: 1500, qty: 1, rate: 1500, is_optional: true },
  { amount: 700, qty: 1, rate: 700, is_excluded: true }
]

function money(over: Partial<QuoteMoneyInput> = {}) {
  return quoteMoney({ items: TEN_K, changeOrders: [], contactAmount: 10000, termsText: '', companyName: 'Harlow Construction', ...over })
}

describe('quoteMoney total', () => {
  it('is the base lines, leaving optional and excluded lines out', () => {
    expect(money().total).toBe(10000)
  })

  it('adds approved change orders and nothing else', () => {
    const changeOrders: MoneyChangeOrder[] = [
      { amount: 1000, status: 'approved' },
      { amount: 900, status: 'sent' },
      { amount: 400, status: 'void' },
      { amount: '250', status: 'draft' }
    ]
    const m = money({ items: [{ amount: 9000 }], changeOrders, contactAmount: 9000 })
    expect(m.total).toBe(10000)
  })

  it('reads an approved status in any case and amounts that arrive as strings', () => {
    const m = money({ items: [{ amount: '9000.00' }], changeOrders: [{ amount: '1000', status: 'Approved' }] })
    expect(m.total).toBe(10000)
  })

  it('falls back to contact.amount when no line has a price', () => {
    expect(money({ items: [] }).total).toBe(10000)
    expect(money({ items: null }).total).toBe(10000)
    expect(money({ items: [{ amount: 0 }, { amount: 0, is_optional: true }] }).total).toBe(10000)
    // An excluded line is not a price on this quote.
    expect(money({ items: [{ amount: 700, is_excluded: true }] }).total).toBe(10000)
    expect(money({ items: [], contactAmount: '10000' }).total).toBe(10000)
  })

  it('adds approved change orders to the contact amount it falls back to', () => {
    const m = money({ items: [], contactAmount: 9000, changeOrders: [{ amount: 1000, status: 'approved' }] })
    expect(m.total).toBe(10000)
  })

  it('does not fall back when a line has a price, even an optional one', () => {
    // The database sets contact.amount to the base lines once a quote has
    // any line, so an optional only quote is $0.00 everywhere.
    expect(money({ items: [{ amount: 10000, is_optional: true }] }).total).toBe(0)
  })

  it('reads a line without an amount as quantity times rate', () => {
    expect(money({ items: [{ amount: null, qty: 4, rate: 2500 }] }).total).toBe(10000)
  })

  it('adds up in cents so the total never drifts', () => {
    const m = money({ items: [{ amount: 3333.33 }, { amount: 3333.33 }, { amount: 3333.34 }] })
    expect(m.total).toBe(10000)
  })
})

describe('quoteMoney deposit', () => {
  it('takes the first step of the default schedule when the terms are empty', () => {
    for (const termsText of ['', '   ', null, undefined]) {
      expect(money({ termsText }).deposit).toEqual({ kind: 'percent', pct: 50, amount: 5000 })
    }
  })

  it('gives no deposit for "no deposit" or "0%"', () => {
    for (const termsText of ['No deposit required. Net 30 after completion.', '0% deposit', 'Deposit of 0%', 'Deposit: none.', 'No deposit.']) {
      expect(money({ termsText }).deposit, termsText).toEqual({ kind: 'none', pct: 0, amount: 0 })
    }
  })

  it('gives the amount the terms name, "$2,500 deposit"', () => {
    for (const termsText of ['$2,500 deposit due at signing, balance at completion.', 'A deposit of $2,500.00 is due at approval.', '$2500 down payment to schedule the pour']) {
      expect(money({ termsText }).deposit, termsText).toEqual({ kind: 'amount', pct: null, amount: 2500 })
    }
  })

  it('never asks for more than the total', () => {
    expect(money({ termsText: '$12,000 deposit' }).deposit).toEqual({ kind: 'amount', pct: null, amount: 10000 })
  })

  it('gives the percent the terms name, "30% deposit" or "deposit of 30%"', () => {
    for (const termsText of [
      '30% deposit on signing, 70% on completion.',
      'A deposit of 30% is due at approval.',
      'Deposit: 30 percent, balance on completion',
      'Deposit is 30% of the total.',
      '30 percent deposit'
    ]) {
      expect(money({ termsText }).deposit, termsText).toEqual({ kind: 'percent', pct: 30, amount: 3000 })
    }
    expect(money({ termsText: '12.5% down payment to schedule the pour' }).deposit).toEqual({ kind: 'percent', pct: 12.5, amount: 1250 })
  })

  it('reads "50% down at rough in" as no deposit named, so payment follows the terms', () => {
    expect(money({ termsText: '50% down at rough in, 50% at completion.' }).deposit).toEqual({ kind: 'per_terms', pct: null, amount: 0 })
  })

  it('gives per_terms when the terms exist but name no deposit', () => {
    for (const termsText of ['Net 30 after completion.', 'Net 30. 10% retainage held until punch list.', 'Half down, half at the walkthrough.', '150% deposit']) {
      expect(money({ termsText }).deposit, termsText).toEqual({ kind: 'per_terms', pct: null, amount: 0 })
    }
  })

  it('takes the first deposit the terms name', () => {
    expect(money({ termsText: '30% deposit. No deposit refunds after the start date.' }).deposit).toEqual({ kind: 'percent', pct: 30, amount: 3000 })
    expect(money({ termsText: '$2,500 deposit (25%) on signing.' }).deposit).toEqual({ kind: 'amount', pct: null, amount: 2500 })
  })

  it('takes the deposit on the total with approved change orders', () => {
    const m = money({ items: [{ amount: 9000 }], changeOrders: [{ amount: 1000, status: 'approved' }], termsText: '30% deposit' })
    expect(m.deposit).toEqual({ kind: 'percent', pct: 30, amount: 3000 })
  })

  it('rounds the deposit to the cent, the same split the draws use', () => {
    const m = money({ items: [{ amount: 10000.01 }] })
    expect(m.deposit.amount).toBe(5000.01)
  })
})

describe('quoteMoney steps', () => {
  it('follows the default schedule when the terms are empty', () => {
    expect(money().steps).toEqual([
      'You approve and pay the deposit.',
      'Harlow sends you a start date.',
      'You pay 40% at material delivery and 10% at completion.'
    ])
  })

  it('points at the terms for the balance when they name a deposit', () => {
    expect(money({ termsText: '30% deposit on signing, 70% on completion.' }).steps).toEqual([
      'You approve and pay the deposit.',
      'Harlow sends you a start date.',
      'You pay the balance as the payment terms say.'
    ])
    expect(money({ termsText: '$2,500 deposit due at signing.' }).steps[0]).toBe('You approve and pay the deposit.')
  })

  it('says the balance is due after the walkthrough only when the terms say so', () => {
    expect(money({ termsText: '30% deposit, balance after the final walkthrough.' }).steps[2]).toBe('You pay the balance after the walkthrough.')
    expect(money({ termsText: '30% deposit, balance after the final walk-through.' }).steps[2]).toBe('You pay the balance after the walkthrough.')
    for (const termsText of ['', '30% deposit on signing.', 'No deposit.', 'Net 30 after completion.']) {
      expect(money({ termsText }).steps.join(' '), termsText).not.toMatch(/walkthrough/i)
    }
  })

  it('asks for no deposit when there is none or the terms name none', () => {
    const steps = [
      'You approve the quote.',
      'Harlow sends you a start date.',
      'You pay as the payment terms say.'
    ]
    expect(money({ termsText: 'No deposit required.' }).steps).toEqual(steps)
    expect(money({ termsText: '50% down at rough in, 50% at completion.' }).steps).toEqual(steps)
  })

  it('asks for no deposit on a $0.00 quote', () => {
    expect(money({ items: [], contactAmount: 0 }).steps[0]).toBe('You approve the quote.')
  })

  it('uses the first word of the company name, or a plain stand in', () => {
    expect(money({ companyName: 'Shyld' }).steps[1]).toBe('Shyld sends you a start date.')
    expect(money({ companyName: '  ' }).steps[1]).toBe('Your contractor sends you a start date.')
    expect(money({ companyName: null }).steps[1]).toBe('Your contractor sends you a start date.')
  })

  it('writes no dash of any kind in the steps', () => {
    for (const termsText of ['', '30% deposit, balance after the walk-through.', 'No deposit.', 'Net 30.']) {
      for (const step of money({ termsText }).steps) expect(step).not.toMatch(/[-‐-―−]/)
    }
  })

  // Phase 8 follow up B, bullet 4: "The Concrete Guys" printed "The sends
  // you a start date.".
  it('names the company in full when its first word cannot stand alone', () => {
    expect(money({ companyName: 'The Concrete Guys' }).steps[1]).toBe('The Concrete Guys sends you a start date.')
    expect(money({ companyName: 'Smith & Sons Paving' }).steps[1]).toBe('Smith & Sons Paving sends you a start date.')
    expect(money({ companyName: 'Harlow Construction' }).steps[1]).toBe('Harlow sends you a start date.')
  })
})

// The short name a sentence calls the company by (Phase 8 follow up B,
// bullet 4): the customer page's steps and the question link on its
// approve capsule share it.
describe('companyShortName', () => {
  it('is the first word when that word stands on its own', () => {
    expect(companyShortName('Harlow Construction')).toBe('Harlow')
    expect(companyShortName('Harlow Construction Company')).toBe('Harlow')
    expect(companyShortName('Shyld')).toBe('Shyld')
    expect(companyShortName('  Harlow   Construction  ')).toBe('Harlow')
    // Words that only begin like an article or a joining word.
    expect(companyShortName('Andersen Roofing')).toBe('Andersen')
    expect(companyShortName('Theodore Builders')).toBe('Theodore')
    expect(companyShortName('Smith Andrews Paving')).toBe('Smith')
  })

  it('is the whole name when the first word is The, A, An, My, Our or Your', () => {
    for (const name of ['The Concrete Guys', 'the concrete guys', 'A Better Roof', 'An Honest Fence', 'My Company', 'Our Town Builders', 'Your Roof Pros']) {
      expect(companyShortName(name), name).toBe(name)
    }
  })

  it('is the whole name when the next word is &, + or and', () => {
    for (const name of ['Smith & Sons Paving', 'Smith and Sons', 'Smith AND Sons', 'Smith + Jones']) {
      expect(companyShortName(name), name).toBe(name)
    }
  })

  // "Harlow, Inc." printed "Harlow, sends you a start date." and "Mr.
  // Handyman of Nashville" printed "Ask Mr. a question first": a first
  // word that ends in a comma or a period is a fragment, an abbreviation
  // or a name that goes on.
  it('is the whole name when the first word ends in a comma or a period', () => {
    for (const name of ['Harlow, Inc.', 'Smith, Jones & Co.', 'Mr. Handyman of Nashville', 'St. Louis Paving', 'J. Harlow Construction', 'J.R. Concrete']) {
      expect(companyShortName(name), name).toBe(name)
    }
    expect(money({ companyName: 'Harlow, Inc.' }).steps[1]).toBe('Harlow, Inc. sends you a start date.')
    expect(companyShortName('Mr. Handyman of Nashville', 'the contractor')).toBe('Mr. Handyman of Nashville')
    // Punctuation inside the first word, or later in the name, changes nothing.
    expect(companyShortName("Harlow's Paving")).toBe("Harlow's")
    expect(companyShortName('A1 Concrete, LLC')).toBe('A1')
    expect(companyShortName('Harlow Construction Co.')).toBe('Harlow')
  })

  it('stands in with Your contractor, or the words a sentence asks for, when there is no name', () => {
    expect(companyShortName(null)).toBe('Your contractor')
    expect(companyShortName(undefined)).toBe('Your contractor')
    expect(companyShortName('   ')).toBe('Your contractor')
    expect(companyShortName('', 'the contractor')).toBe('the contractor')
    expect(companyShortName('The Concrete Guys', 'the contractor')).toBe('The Concrete Guys')
    expect(companyShortName('Harlow Construction', 'the contractor')).toBe('Harlow')
  })
})

// What happens next once the customer has approved (Phase 8 follow up B,
// bullet 2): the approve step is done, so it goes, and a deposit still owed
// comes first.
describe('stepsAfterApproval', () => {
  it('asks for the deposit first while any of it is still owed', () => {
    expect(stepsAfterApproval(money().steps, true)).toEqual([
      'You pay the deposit.',
      'Harlow sends you a start date.',
      'You pay 40% at material delivery and 10% at completion.'
    ])
    expect(stepsAfterApproval(money({ termsText: '30% deposit, balance after the walkthrough.' }).steps, true)).toEqual([
      'You pay the deposit.',
      'Harlow sends you a start date.',
      'You pay the balance after the walkthrough.'
    ])
  })

  it('starts with the start date once the deposit is in', () => {
    expect(stepsAfterApproval(money().steps, false)).toEqual([
      'Harlow sends you a start date.',
      'You pay 40% at material delivery and 10% at completion.'
    ])
  })

  it('starts with the start date when no deposit is due', () => {
    for (const termsText of ['No deposit required.', '50% down at rough in, 50% at completion.']) {
      expect(stepsAfterApproval(money({ termsText }).steps, false), termsText).toEqual([
        'Harlow sends you a start date.',
        'You pay as the payment terms say.'
      ])
    }
  })

  it('keeps the company name the open steps use', () => {
    expect(stepsAfterApproval(money({ companyName: 'The Concrete Guys' }).steps, false)[0]).toBe('The Concrete Guys sends you a start date.')
  })
})
