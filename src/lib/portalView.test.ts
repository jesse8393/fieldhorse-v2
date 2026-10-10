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

import { buildPortalView, depositSentence, type PublicDocPayload } from './portalView.ts'

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

  it('has no cover when there are no photos, and the first photo when there are', () => {
    expect(buildPortalView(payload({ photos: [] }), NOW).coverUrl).toBeNull()
    expect(buildPortalView(payload({ photos: undefined }), NOW).coverUrl).toBeNull()
    const v = buildPortalView(payload({ photos: [{ url: 'https://img.example.com/a.jpg' }, { url: 'https://img.example.com/b.jpg' }] }), NOW)
    expect(v.coverUrl).toBe('https://img.example.com/a.jpg')
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
    expect(v.deposit).toEqual({ pct: 50, amount: 9229 })
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
      'You pay the balance after the walkthrough.'
    ])
    const solo = buildPortalView(payload({}, {}, { name: 'Shyld' }), NOW)
    expect(solo.steps[1]).toBe('Shyld sends you a start date.')
  })

  it('writes the deposit sentence with cents', () => {
    expect(depositSentence({ pct: 50, amount: 9229 })).toBe('Pay $9,229.00 now to reserve your start date. The balance is due after the walkthrough.')
    expect(depositSentence({ pct: 50, amount: 0 })).toBe('')
  })

  it('writes no dash of any kind in the strings it generates', () => {
    const v = buildPortalView(
      payload({}, { proposal_status: 'approved', approved_by_name: 'Marco Castellanos', approved_at: '2026-10-09T15:30:00Z' }, { license_number: '123456' }),
      NOW
    )
    const generated = [
      v.headline,
      v.trustLine,
      v.addressLine,
      ...v.steps,
      v.approved?.date,
      depositSentence(v.deposit),
      ...v.included.map((l) => l.title)
    ]
    for (const text of generated) {
      expect(text, String(text)).not.toMatch(DASH)
    }
  })
})
