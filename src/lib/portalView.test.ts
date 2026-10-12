import { describe, expect, it, beforeAll, afterAll } from 'vitest'

// The approval date is read in local time. Pin Central time, where Jesse
// works, so the result is the same on every machine and in CI (UTC). Set it
// as the file loads too, because the fixtures below build dates before any
// hook runs.
const originalTz = process.env.TZ
process.env.TZ = 'America/Chicago'
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

import { buildPortalView, depositNote, depositSentence, quoteFingerprint, type PublicDocPayload } from './portalView.ts'

const NOW = new Date(2026, 9, 10, 9, 0, 0)

// A proposal payload shaped like what /api/public-link returns for a
// proposal link (netlify/functions/public-link.js).
function payload(partial: Partial<PublicDocPayload> = {}, contact: Record<string, unknown> = {}, company: Record<string, unknown> = {}): PublicDocPayload {
  return {
    ok: true,
    kind: 'proposal',
    contact: {
      id: 'c-1',
      name: 'Marco Castellanos',
      address: '1150 Cherry Blossom Ln, La Vergne',
      phone: '615 555 0101',
      email: 'marco@example.com',
      job_title: 'Pool deck pour',
      stage: 'quote',
      proposal_status: 'sent',
      amount: 18458,
      ...contact
    },
    company: {
      name: 'Parker Construction',
      phone: '615 555 0100',
      logo_url: null,
      insured_text: 'Licensed and insured',
      license_number: '',
      payment_link: '',
      ...company
    },
    items: [
      { id: 'i1', section: 'Site', description: 'Excavate and grade, 1,100 sq ft', qty: 1, rate: 2200, amount: 2200, is_optional: false, is_excluded: false, sort_order: 1 },
      { id: 'i2', section: 'Steel', description: 'Rebar, #4 at 18 in on center', qty: 1, rate: 2860, amount: 2860, is_optional: false, is_excluded: false, sort_order: 2 },
      { id: 'i3', section: 'Concrete', description: '4 in slab, 4,000 psi fiber mix, broom finish', qty: 1, rate: 9350, amount: 9350, is_optional: false, is_excluded: false, sort_order: 3 },
      { id: 'i4', section: 'Finish', description: 'Joints, pump truck and haul off', qty: 1, rate: 4048, amount: 4048, is_optional: false, is_excluded: false, sort_order: 4 },
      { id: 'i5', section: 'Finish', description: 'Stamped ashlar pattern', qty: 1, rate: 4950, amount: 4950, is_optional: true, is_excluded: false, sort_order: 5 },
      { id: 'i6', section: 'Site', description: 'Fence removal', qty: 1, rate: 700, amount: 700, is_optional: false, is_excluded: true, sort_order: 6 }
    ],
    photos: [],
    changeOrders: [],
    ...partial
  }
}

const DASH = /[-‐-―−]/

describe('buildPortalView', () => {
  it('takes the first name from the contact and writes the headline with it', () => {
    const v = buildPortalView(payload(), NOW)
    expect(v.firstName).toBe('Marco')
    expect(v.headline).toBe('Hi Marco, your quote is ready.')
  })

  it('still writes a friendly headline when the contact has no name', () => {
    const v = buildPortalView(payload({}, { name: '  ' }), NOW)
    expect(v.firstName).toBe('')
    expect(v.headline).toBe('Hi there, your quote is ready.')
  })

  it('makes the initials PC from Parker Construction and keeps the company name', () => {
    const v = buildPortalView(payload(), NOW)
    expect(v.companyName).toBe('Parker Construction')
    expect(v.initials).toBe('PC')
    expect(v.logoUrl).toBeNull()
  })

  it('passes the logo through when the company has one', () => {
    const v = buildPortalView(payload({}, {}, { logo_url: 'https://cdn.example.com/parker.png' }), NOW)
    expect(v.logoUrl).toBe('https://cdn.example.com/parker.png')
  })

  it('has no cover when there are no photos, and the newest photo when there are', () => {
    expect(buildPortalView(payload({ photos: [] }), NOW).coverUrl).toBeNull()
    expect(buildPortalView(payload({ photos: undefined }), NOW).coverUrl).toBeNull()
    // The server sends photos oldest first, so the last one is the newest.
    const v = buildPortalView(payload({ photos: [{ url: 'https://img.example.com/a.jpg' }, { url: 'https://img.example.com/b.jpg' }] }), NOW)
    expect(v.coverUrl).toBe('https://img.example.com/b.jpg')
    // A server that dates the photos: the newest date wins over the order.
    const dated = buildPortalView(payload({ photos: [
      { url: 'https://img.example.com/new.jpg', uploaded_at: '2026-10-09T10:00:00Z' },
      { url: 'https://img.example.com/old.jpg', uploaded_at: '2026-10-01T10:00:00Z' }
    ] }), NOW)
    expect(dated.coverUrl).toBe('https://img.example.com/new.jpg')
    // A photo without a url is never the cover.
    const blank = buildPortalView(payload({ photos: [{ url: 'https://img.example.com/a.jpg' }, { url: '' }] }), NOW)
    expect(blank.coverUrl).toBe('https://img.example.com/a.jpg')
  })

  it('fills approved when the quote is approved, with no name or date unless the payload has them', () => {
    expect(buildPortalView(payload(), NOW).approved).toBeNull()
    const approved = buildPortalView(payload({}, { proposal_status: 'approved' }), NOW)
    expect(approved.approved).toEqual({ name: null, date: null })
    const named = buildPortalView(
      payload({}, { proposal_status: 'Approved', approved_by_name: 'Marco Castellanos', approved_at: '2026-10-09T15:30:00Z' }),
      NOW
    )
    expect(named.approved).toEqual({ name: 'Marco Castellanos', date: 'October 9' })
  })

  it('writes the year on an approval date from another year', () => {
    const v = buildPortalView(payload({}, { proposal_status: 'approved', approved_at: '2025-12-30T18:00:00Z' }), NOW)
    expect(v.approved?.date).toBe('December 30, 2025')
  })

  it('gives no pay link without a payment link, and a safe one with one', () => {
    expect(buildPortalView(payload(), NOW).payUrl).toBeNull()
    expect(buildPortalView(payload({}, {}, { payment_link: '   ' }), NOW).payUrl).toBeNull()
    expect(buildPortalView(payload({}, {}, { payment_link: 'venmo.com/u/parker' }), NOW).payUrl).toBe('https://venmo.com/u/parker')
    expect(buildPortalView(payload({}, {}, { payment_link: 'javascript:alert(1)' }), NOW).payUrl).toBeNull()
  })

  it('joins the insured line and the license number into the trust line', () => {
    expect(buildPortalView(payload(), NOW).trustLine).toBe('Licensed and insured')
    expect(buildPortalView(payload({}, {}, { license_number: '123456' }), NOW).trustLine).toBe('Licensed and insured, license 123456')
    expect(buildPortalView(payload({}, {}, { insured_text: '', license_number: '123456' }), NOW).trustLine).toBe('License 123456')
    expect(buildPortalView(payload({}, {}, { insured_text: null, license_number: null }), NOW).trustLine).toBeNull()
  })

  it('sums the included items for the total and leaves optional and excluded items out', () => {
    const v = buildPortalView(payload(), NOW)
    expect(v.included.map((l) => l.title)).toEqual([
      'Excavate and grade, 1,100 sq ft',
      'Rebar, #4 at 18 in on center',
      '4 in slab, 4,000 psi fiber mix, broom finish',
      'Joints, pump truck and haul off'
    ])
    expect(v.total).toBe(18458)
    expect(v.optional).toEqual([{ title: 'Stamped ashlar pattern', amount: 4950 }])
  })

  it('takes the deposit as the first step of the payment schedule, to the cent', () => {
    const v = buildPortalView(payload(), NOW)
    expect(v.deposit).toEqual({ kind: 'percent', pct: 50, amount: 9229 })
    const odd = buildPortalView(payload({
      items: [{ id: 'a', description: 'Slab', qty: 1, rate: 3000.5, amount: 3000.5 }]
    }), NOW)
    expect(odd.total).toBe(3000.5)
    expect(odd.deposit.amount).toBe(1500.25)
  })

  it('adds approved change orders to the total as their own lines', () => {
    const v = buildPortalView(payload({
      changeOrders: [
        { id: 'co1', sequence_number: 1, title: 'Extra footing', amount: 500, status: 'approved' },
        { id: 'co2', sequence_number: 2, title: 'Pending idea', amount: 900, status: 'sent' }
      ]
    }), NOW)
    expect(v.total).toBe(18958)
    expect(v.included[v.included.length - 1]).toEqual({ title: 'Change order 1, Extra footing', amount: 500 })
    expect(v.included.reduce((s, l) => s + l.amount, 0)).toBe(v.total)
  })

  it('falls back to the contract amount when the quote has no priced lines', () => {
    const v = buildPortalView(payload({ items: [] }, { amount: 5000 }), NOW)
    expect(v.total).toBe(5000)
    expect(v.included).toEqual([])
  })

  it('orders lines by sort order and tidies the OPTION prefix on optional lines', () => {
    const v = buildPortalView(payload({
      items: [
        { id: 'b', description: 'Second', qty: 1, rate: 20, amount: 20, sort_order: 2 },
        { id: 'a', description: 'First', qty: 1, rate: 10, amount: 10, sort_order: 1 },
        { id: 'o', description: 'OPTION: Sealer', qty: 1, rate: 60, amount: 60, is_optional: true, sort_order: 3 }
      ]
    }), NOW)
    expect(v.included.map((l) => l.title)).toEqual(['First', 'Second'])
    expect(v.optional[0].title).toBe('Sealer')
  })

  it('writes the address line from the job title and address', () => {
    expect(buildPortalView(payload(), NOW).addressLine).toBe('Pool deck pour at 1150 Cherry Blossom Ln, La Vergne.')
    expect(buildPortalView(payload({}, { job_title: '' }), NOW).addressLine).toBe('1150 Cherry Blossom Ln, La Vergne.')
    expect(buildPortalView(payload({}, { address: '' }), NOW).addressLine).toBe('Pool deck pour.')
    expect(buildPortalView(payload({}, { job_title: '', address: '' }), NOW).addressLine).toBe('')
  })

  it('writes the three steps with the first word of the company name', () => {
    const v = buildPortalView(payload(), NOW)
    expect(v.steps).toEqual([
      'You approve and pay the deposit.',
      'Parker sends you a start date.',
      'You pay 40% at material delivery and 10% at completion.'
    ])
    const solo = buildPortalView(payload({}, {}, { name: 'Shyld' }), NOW)
    expect(solo.steps[1]).toBe('Shyld sends you a start date.')
  })

  it('writes the deposit sentence with cents', () => {
    expect(depositSentence({ kind: 'percent', pct: 50, amount: 9229 })).toBe('Pay $9,229.00 now to reserve your start date.')
    expect(depositSentence({ kind: 'amount', pct: null, amount: 2500 })).toBe('Pay $2,500.00 now to reserve your start date.')
    expect(depositSentence({ kind: 'percent', pct: 50, amount: 0 })).toBe('')
  })

  it('says plainly when there is no deposit, and that payment follows the terms when they name none', () => {
    expect(depositSentence({ kind: 'none', pct: 0, amount: 0 })).toBe('No deposit is due. Payment follows the terms below.')
    expect(depositSentence({ kind: 'per_terms', pct: null, amount: 0 })).toBe('Payment follows the terms below.')
  })

  it('reads the deposit from the payment terms (decision D31)', () => {
    const tenK = { items: [{ id: 'a', description: 'Slab', qty: 1, rate: 10000, amount: 10000 }] }
    const at = (terms_text: string) => buildPortalView(payload(tenK, { terms_text }), NOW)
    expect(at('30% deposit on signing.').deposit).toEqual({ kind: 'percent', pct: 30, amount: 3000 })
    expect(at('$2,500 deposit on signing.').deposit).toEqual({ kind: 'amount', pct: null, amount: 2500 })
    expect(at('No deposit required.').deposit).toEqual({ kind: 'none', pct: 0, amount: 0 })
    expect(at('50% down at rough in, 50% at completion.').deposit).toEqual({ kind: 'per_terms', pct: null, amount: 0 })
    expect(at('').deposit).toEqual({ kind: 'percent', pct: 50, amount: 5000 })
  })

  it('says the balance is due after the walkthrough only when the terms say it', () => {
    const v = buildPortalView(payload({}, { terms_text: '30% deposit, balance after the walkthrough.' }), NOW)
    expect(v.steps[2]).toBe('You pay the balance after the walkthrough.')
    const plain = buildPortalView(payload({}, { terms_text: 'Net 30 after completion.' }), NOW)
    expect(plain.steps).toEqual(['You approve the quote.', 'Parker sends you a start date.', 'You pay as the payment terms say.'])
    expect(depositSentence(plain.deposit)).not.toMatch(/walkthrough/)
  })

  // Task 10: the quote number, the dates, the expiry, the payments and the
  // first name rules the customer page shows after approval and on bad data.
  it('reads the quote number, the issue date and the valid until date from the payload', () => {
    const v = buildPortalView(payload({}, { id: 'c-portal', quote_sent_at: '2026-10-02T12:00:00Z', quote_expires_at: '2026-11-02T04:59:59.999Z' }), NOW)
    expect(v.quoteNumber).toBe('PC-2026-RTAL')
    expect(v.issuedOn).toBe('October 2')
    expect(v.validUntil).toBe('November 1')
    expect(v.expired).toBe(false)
    // The issue date falls back to the day the job was made, with its year.
    const created = buildPortalView(payload({}, { quote_sent_at: null, created_at: '2025-12-30T18:00:00Z' }), NOW)
    expect(created.issuedOn).toBe('December 30, 2025')
  })

  it('leaves out the quote number, the issue date and valid until when the payload lacks them', () => {
    const v = buildPortalView(payload({}, { id: undefined, quote_sent_at: null, created_at: null, quote_expires_at: null }), NOW)
    expect(v.quoteNumber).toBeNull()
    expect(v.issuedOn).toBeNull()
    expect(v.validUntil).toBeNull()
    expect(v.expired).toBe(false)
  })

  it('is expired once the valid until date has passed, and then closed to approval', () => {
    const live = buildPortalView(payload({}, { quote_expires_at: '2026-11-02T04:59:59.999Z' }), NOW)
    expect(live.expired).toBe(false)
    expect(live.open).toBe(true)
    const past = buildPortalView(payload({}, { quote_expires_at: '2026-10-06T04:59:59.999Z' }), NOW)
    expect(past.expired).toBe(true)
    expect(past.open).toBe(false)
    expect(past.validUntil).toBe('October 5')
    // A date alone is good through the whole of that day.
    expect(buildPortalView(payload({}, { quote_expires_at: '2026-10-10' }), NOW).expired).toBe(false)
    expect(buildPortalView(payload({}, { quote_expires_at: '2026-10-09' }), NOW).expired).toBe(true)
    // A status the server already set.
    expect(buildPortalView(payload({}, { proposal_status: 'expired' }), NOW).expired).toBe(true)
  })

  it('an approved quote past its valid until date is not expired and keeps its deposit note', () => {
    // Approved October 1, valid until October 5, reopened October 10.
    const approved = { proposal_status: 'approved', quote_expires_at: '2026-10-06T04:59:59.999Z' }
    const unpaid = buildPortalView(payload({}, approved), NOW)
    expect(unpaid.expired).toBe(false)
    expect(unpaid.open).toBe(false)
    expect(unpaid.validUntil).toBe('October 5')
    expect(depositNote(unpaid)).toBe('Pay $9,229.00 now to reserve your start date.')
    const paid = buildPortalView(payload({ payments: [{ id: 'p1', amount: 9229, kind: 'deposit' }] }, approved), NOW)
    expect(paid.expired).toBe(false)
    expect(depositNote(paid)).toBe('Deposit of $9,229.00 received.')
    // Changes requested past the date is still waiting on the contractor, not expired.
    const asked = buildPortalView(payload({}, { proposal_status: 'changes_requested', quote_expires_at: '2026-10-06T04:59:59.999Z' }), NOW)
    expect(asked.expired).toBe(false)
    expect(asked.open).toBe(false)
  })

  it('an expired quote has no next steps, since approving is not one', () => {
    expect(buildPortalView(payload(), NOW).steps).toHaveLength(3)
    expect(buildPortalView(payload({}, { quote_expires_at: '2026-10-06T04:59:59.999Z' }), NOW).steps).toEqual([])
    expect(buildPortalView(payload({}, { proposal_status: 'expired' }), NOW).steps).toEqual([])
  })

  it('expires at the end of the day it says it is valid until, in the viewer\'s time', () => {
    // Stored as 10 pm on October 9 in Chicago (a contractor two hours
    // east): the page says valid until October 9 and is good through it.
    const stored = { quote_expires_at: '2026-10-10T03:00:00.000Z' }
    const evening = buildPortalView(payload({}, stored), new Date(2026, 9, 9, 22, 30, 0))
    expect(evening.validUntil).toBe('October 9')
    expect(evening.expired).toBe(false)
    expect(evening.open).toBe(true)
    const midnight = buildPortalView(payload({}, stored), new Date(2026, 9, 10, 0, 0, 0))
    expect(midnight.expired).toBe(true)
    // The end of the stated day itself flips at midnight too.
    const endOfDay = { quote_expires_at: '2026-10-10T04:59:59.999Z' }
    expect(buildPortalView(payload({}, endOfDay), new Date(2026, 9, 9, 23, 59, 59)).expired).toBe(false)
    expect(buildPortalView(payload({}, endOfDay), new Date(2026, 9, 10, 0, 0, 0)).expired).toBe(true)
  })

  it('is closed to approval once approved or once changes are requested', () => {
    expect(buildPortalView(payload(), NOW).open).toBe(true)
    expect(buildPortalView(payload({}, { proposal_status: 'approved' }), NOW).open).toBe(false)
    expect(buildPortalView(payload({}, { proposal_status: 'changes_requested' }), NOW).open).toBe(false)
  })

  // Review round 2: the page offers only what the server accepts. The
  // approve endpoint refuses a quote whose job is lost or closed (409); the
  // request changes endpoint also refuses a declined quote and one whose
  // job has started (410).
  it('is closed once the contractor marks the quote lost or closes the job', () => {
    // Marked lost after it was sent: the stage moves, the status stays sent.
    const lost = buildPortalView(payload({}, { stage: 'lost' }), NOW)
    expect(lost.closed).toBe(true)
    expect(lost.open).toBe(false)
    expect(lost.expired).toBe(false)
    expect(lost.canAsk).toBe(false)
    // Approving is not a next step, and there is no deposit to pay now.
    expect(lost.steps).toEqual([])
    expect(depositNote(lost)).toBe('')
    const closedJob = buildPortalView(payload({}, { stage: 'Closed' }), NOW)
    expect(closedJob.closed).toBe(true)
    expect(closedJob.open).toBe(false)
    // An approval on record stays approved whatever the stage says.
    const approved = buildPortalView(payload({}, { stage: 'closed', proposal_status: 'approved' }), NOW)
    expect(approved.closed).toBe(false)
    expect(approved.approved).not.toBeNull()
    // A quote still in play is not closed.
    expect(buildPortalView(payload(), NOW).closed).toBe(false)
  })

  it('takes a question only where the request changes endpoint does', () => {
    expect(buildPortalView(payload(), NOW).canAsk).toBe(true)
    // Declined: an approval still reaches the server, a question does not.
    const declined = buildPortalView(payload({}, { proposal_status: 'rejected' }), NOW)
    expect(declined.open).toBe(true)
    expect(declined.canAsk).toBe(false)
    // Moved to a job without a recorded approval: the same.
    for (const stage of ['job', 'invoice']) {
      const job = buildPortalView(payload({}, { stage }), NOW)
      expect(job.open, stage).toBe(true)
      expect(job.canAsk, stage).toBe(false)
    }
    // Closed to approving means closed to asking.
    expect(buildPortalView(payload({}, { proposal_status: 'approved' }), NOW).canAsk).toBe(false)
    expect(buildPortalView(payload({}, { proposal_status: 'changes_requested' }), NOW).canAsk).toBe(false)
    expect(buildPortalView(payload({}, { proposal_status: 'expired' }), NOW).canAsk).toBe(false)
    expect(buildPortalView(payload({}, { quote_expires_at: '2026-10-06T04:59:59.999Z' }), NOW).canAsk).toBe(false)
    expect(buildPortalView(payload({}, { stage: 'lost' }), NOW).canAsk).toBe(false)
  })

  it('notices a change to anything an approval records, even when the total stays the same', () => {
    const same = quoteFingerprint(payload())
    expect(quoteFingerprint(payload())).toBe(same)
    // Photos are signed again on every read, and payments, views and the
    // status are not what the customer agrees to.
    expect(quoteFingerprint(payload({
      photos: [{ url: 'https://img.example.com/a.jpg?token=2' }],
      payments: [{ id: 'p1', amount: 100, kind: 'deposit' }]
    }, { proposal_status: 'viewed' }))).toBe(same)
    // The terms (and so the deposit), the scope and the exclusions.
    expect(quoteFingerprint(payload({}, { terms_text: '30% deposit on signing.' }))).not.toBe(same)
    expect(quoteFingerprint(payload({}, { scope_text: 'Pour the deck.' }))).not.toBe(same)
    expect(quoteFingerprint(payload({}, { exclusions_text: 'Permits' }))).not.toBe(same)
    // Two lines trading prices keep the total and change the quote.
    const swapped = payload().items!.map((it) => it.id === 'i1' ? { ...it, rate: 2860, amount: 2860 }
      : it.id === 'i2' ? { ...it, rate: 2200, amount: 2200 } : it)
    expect(buildPortalView(payload({ items: swapped }), NOW).total).toBe(18458)
    expect(quoteFingerprint(payload({ items: swapped }))).not.toBe(same)
    // A reworded line, an optional line's price, and the place of the work.
    const reworded = payload().items!.map((it) => it.id === 'i3' ? { ...it, description: '5 in slab' } : it)
    expect(quoteFingerprint(payload({ items: reworded }))).not.toBe(same)
    const option = payload().items!.map((it) => it.id === 'i5' ? { ...it, rate: 5950, amount: 5950 } : it)
    expect(quoteFingerprint(payload({ items: option }))).not.toBe(same)
    expect(quoteFingerprint(payload({}, { address: '1152 Cherry Blossom Ln, La Vergne' }))).not.toBe(same)
  })

  // Review round 3: the page shows these and the approval records them.
  it('notices a change to the warranty, the license, the insured line, the company name or the customer name', () => {
    const base = payload({}, {}, { warranty_default: 'Two year workmanship warranty.', license_number: 'TN 1234' })
    const same = quoteFingerprint(base)
    expect(quoteFingerprint(payload({}, {}, { warranty_default: 'Two year workmanship warranty.', license_number: 'TN 1234' }))).toBe(same)
    expect(quoteFingerprint(payload({}, {}, { warranty_default: '90 day workmanship warranty.', license_number: 'TN 1234' }))).not.toBe(same)
    expect(quoteFingerprint(payload({}, {}, { warranty_default: 'Two year workmanship warranty.', license_number: 'TN 9999' }))).not.toBe(same)
    expect(quoteFingerprint(payload({}, {}, { warranty_default: 'Two year workmanship warranty.', license_number: 'TN 1234', insured_text: 'Insured' }))).not.toBe(same)
    expect(quoteFingerprint(payload({}, {}, { warranty_default: 'Two year workmanship warranty.', license_number: 'TN 1234', name: 'Parker Concrete' }))).not.toBe(same)
    // The authority line names who the customer approves for.
    expect(quoteFingerprint(payload({}, { name: 'Ana Castellanos' }, { warranty_default: 'Two year workmanship warranty.', license_number: 'TN 1234' }))).not.toBe(same)
    // How to reach the company says who it is, not what is agreed.
    expect(quoteFingerprint(payload({}, {}, { warranty_default: 'Two year workmanship warranty.', license_number: 'TN 1234', phone: '615 555 0199', logo_url: 'https://img.example.com/logo.png' }))).toBe(same)
  })

  it('counts the deposit as received from deposit payments or from the sum of payments', () => {
    const approved = { proposal_status: 'approved' }
    const none = buildPortalView(payload({ payments: [] }, approved), NOW)
    expect(none.paid).toEqual({ total: 0, depositRemaining: 9229, depositReceived: false })
    const deposit = buildPortalView(payload({ payments: [{ id: 'p1', amount: 9229, kind: 'deposit', paid_on: '2026-10-09' }] }, approved), NOW)
    expect(deposit.paid).toEqual({ total: 9229, depositRemaining: 0, depositReceived: true })
    const summed = buildPortalView(payload({ payments: [
      { id: 'p1', amount: 5000, kind: 'progress' },
      { id: 'p2', amount: '4229', kind: null }
    ] }, approved), NOW)
    expect(summed.paid).toEqual({ total: 9229, depositRemaining: 0, depositReceived: true })
    const short = buildPortalView(payload({ payments: [{ id: 'p1', amount: 5000, kind: 'deposit' }] }, approved), NOW)
    expect(short.paid).toEqual({ total: 5000, depositRemaining: 4229, depositReceived: false })
    // Nothing to receive when the terms name no deposit.
    const noDeposit = buildPortalView(payload({ payments: [{ id: 'p1', amount: 100 }] }, { ...approved, terms_text: 'No deposit required.' }), NOW)
    expect(noDeposit.paid).toEqual({ total: 100, depositRemaining: 0, depositReceived: false })
  })

  it('writes the note under the total from the payments and the expiry', () => {
    expect(depositNote(buildPortalView(payload(), NOW))).toBe('Pay $9,229.00 now to reserve your start date.')
    const paid = buildPortalView(payload({ payments: [{ id: 'p1', amount: 9229, kind: 'deposit' }] }, { proposal_status: 'approved' }), NOW)
    expect(depositNote(paid)).toBe('Deposit of $9,229.00 received.')
    const part = buildPortalView(payload({ payments: [{ id: 'p1', amount: 5000, kind: 'deposit' }] }, { proposal_status: 'approved' }), NOW)
    expect(depositNote(part)).toBe('$5,000.00 paid so far. Pay the remaining $4,229.00 to reserve your start date.')
    const expired = buildPortalView(payload({}, { quote_expires_at: '2026-10-06T04:59:59.999Z' }), NOW)
    expect(depositNote(expired)).toBe('')
  })

  // Review round 4: a quote waiting on a revised proposal cannot be paid for
  // yet, so neither the note under the total nor the first step asks.
  it('asks for no payment while the quote waits on a revised proposal', () => {
    const waiting = buildPortalView(payload({}, { proposal_status: 'changes_requested' }), NOW)
    expect(depositNote(waiting)).toBe('Nothing is due while you wait for a revised proposal.')
    // The revised proposal comes first, then every step of an open quote,
    // so the deposit and the balance are still named and the payments
    // listed add up to the whole price.
    expect(waiting.steps).toEqual([
      'Parker sends you a revised proposal.',
      'You approve and pay the deposit.',
      'Parker sends you a start date.',
      'You pay 40% at material delivery and 10% at completion.'
    ])
    // Whatever the terms say about a deposit.
    for (const terms of ['30% deposit on signing.', '$2,500 deposit on signing.', 'No deposit required.', '50% down at rough in, 50% at completion.']) {
      const v = buildPortalView(payload({}, { proposal_status: 'changes_requested', terms_text: terms }), NOW)
      const open = buildPortalView(payload({}, { proposal_status: 'sent', terms_text: terms }), NOW)
      expect(depositNote(v), terms).toBe('Nothing is due while you wait for a revised proposal.')
      expect(v.steps[0], terms).toBe('Parker sends you a revised proposal.')
      expect(v.steps.slice(1), terms).toEqual(open.steps)
      for (const text of [depositNote(v), ...v.steps]) expect(text, text).not.toMatch(DASH)
    }
    // A closed job still wins: no revised proposal is coming.
    const closed = buildPortalView(payload({}, { proposal_status: 'changes_requested', stage: 'lost' }), NOW)
    expect(depositNote(closed)).toBe('')
    expect(closed.steps).toEqual([])
  })

  it('greets a person by first name, also written last name first, and a company with Hi there', () => {
    expect(buildPortalView(payload({}, { name: 'Castellanos, Marco' }), NOW).headline).toBe('Hi Marco, your quote is ready.')
    expect(buildPortalView(payload({}, { name: 'MMC Properties' }), NOW).headline).toBe('Hi there, your quote is ready.')
    expect(buildPortalView(payload({}, { name: 'MMC Properties' }), NOW).firstName).toBe('')
    expect(buildPortalView(payload({}, { name: 'The Roof Doctor' }), NOW).headline).toBe('Hi there, your quote is ready.')
  })

  it('writes no dash of any kind in the strings it generates', () => {
    const v = buildPortalView(
      payload(
        { payments: [{ id: 'p1', amount: 5000, kind: 'deposit' }] },
        { proposal_status: 'approved', approved_by_name: 'Marco Castellanos', approved_at: '2026-10-09T15:30:00Z', quote_sent_at: '2025-12-30T18:00:00Z', quote_expires_at: '2026-11-02T04:59:59.999Z' },
        { license_number: '123456' }
      ),
      NOW
    )
    const generated = [
      v.headline,
      v.trustLine,
      v.addressLine,
      ...v.steps,
      v.approved?.date,
      v.issuedOn,
      v.validUntil,
      depositSentence(v.deposit),
      depositNote(v),
      ...v.included.map((l) => l.title)
    ]
    for (const text of generated) {
      expect(text, String(text)).not.toMatch(DASH)
    }
  })
})
