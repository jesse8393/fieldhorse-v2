import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'

// The preview pane loads the approval snapshot through Supabase in an
// effect, which never runs in a static render; a stub client is enough.
vi.mock('./supabase.ts', () => ({ supabase: {} }))

import { DocumentPreviewPane } from '../screens/ContactDetail/sections/DocumentPreviewPane.tsx'
import { buildPortalView, depositSentence, type PublicDocPayload } from './portalView.ts'
import { buildQuoteView, quoteCapsule } from './quoteView.ts'
import { moneyCents } from './format.ts'

// The three places that print a quote's money (PHASE8_PLAN.md Task 9,
// decision D31): the Quote tab capsule on a phone, the in app "Preview as"
// drawn in the Fieldhorse theme, and the customer page's view model. Fed
// the same quote, they must print the same total and the same deposit.

const NOW = new Date(2026, 9, 10, 9, 0, 0)

// fh_quote_items rows for a $10,000 quote once the approved change order
// is in: $9,000 of base lines, an optional line and an excluded line.
const ROWS = [
  { id: 'q1', contact_id: 'c-1', section: 'Site', description: 'Excavate and grade', qty: 1, unit: null, rate: 5000, amount: 5000, notes: null, is_optional: false, is_excluded: false, sort_order: 0 },
  { id: 'q2', contact_id: 'c-1', section: 'Concrete', description: 'Slab, broom finish', qty: 1, unit: null, rate: 4000, amount: 4000, notes: null, is_optional: false, is_excluded: false, sort_order: 1 },
  { id: 'q3', contact_id: 'c-1', section: 'Finish', description: 'Stamped border', qty: 1, unit: null, rate: 1500, amount: 1500, notes: null, is_optional: true, is_excluded: false, sort_order: 2 },
  { id: 'q4', contact_id: 'c-1', section: 'Site', description: 'Fence removal', qty: 1, unit: null, rate: 700, amount: 700, notes: null, is_optional: false, is_excluded: true, sort_order: 3 }
]
const CHANGE_ORDERS = [
  { id: 'co1', sequence_number: 1, title: 'Extra footing', amount: 1000, status: 'approved' },
  { id: 'co2', sequence_number: 2, title: 'Pending idea', amount: 900, status: 'sent' }
]
const COMPANY = { name: 'Parker Construction', phone: '615 555 0100', estimate_template: 'fieldhorse', payment_link: '' }

function contactWith(termsText: string, amount = 9000) {
  return {
    id: 'c-1',
    name: 'Marco Castellanos',
    address: '1150 Cherry Blossom Ln, La Vergne',
    job_title: 'Pool deck pour',
    stage: 'quote',
    proposal_status: 'sent',
    amount,
    terms_text: termsText,
    quote_sent_at: '2026-10-02T12:00:00.000Z',
    created_at: '2026-10-01T12:00:00.000Z'
  }
}

function decode(html: string): string {
  return html
    .replace(/<!-- -->/g, '')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
}

// What the Fieldhorse preview prints in its total tray and its steps.
function previewMoney(contact: Record<string, unknown>, rows: typeof ROWS) {
  const html = decode(renderToStaticMarkup(
    <DocumentPreviewPane bare company={COMPANY} contact={contact} items={rows} photos={[]} loading={false} changeOrders={CHANGE_ORDERS} />
  ))
  const amount = /class="fhp-total__amount">([^<]*)</.exec(html)?.[1] ?? null
  const note = /class="fhp-total__note">([^<]*)</.exec(html)?.[1] ?? ''
  const steps = [...(/<ol class="fhp-steps"[^>]*>(.*?)<\/ol>/.exec(html)?.[1] ?? '').matchAll(/<li>(.*?)<\/li>/g)].map((m) => m[1])
  return { amount, note, steps }
}

function portalMoney(contact: Record<string, unknown>, rows: typeof ROWS) {
  const payload: PublicDocPayload = { ok: true, kind: 'proposal', contact, company: COMPANY, items: rows, photos: [], changeOrders: CHANGE_ORDERS }
  return buildPortalView(payload, NOW)
}

function capsuleMoney(contact: ReturnType<typeof contactWith>, rows: typeof ROWS) {
  const view = buildQuoteView(rows, { changeOrders: CHANGE_ORDERS, contactAmount: contact.amount, termsText: contact.terms_text })
  return quoteCapsule(view.money)
}

const CASES: Array<{ terms: string; capsuleNote: string; sentence: string }> = [
  { terms: '', capsuleNote: 'Deposit $5,000.00 at approval', sentence: 'Pay $5,000.00 now to reserve your start date.' },
  { terms: '30% deposit on signing, 70% on completion.', capsuleNote: 'Deposit $3,000.00 at approval', sentence: 'Pay $3,000.00 now to reserve your start date.' },
  { terms: '$2,500 deposit due at signing.', capsuleNote: 'Deposit $2,500.00 at approval', sentence: 'Pay $2,500.00 now to reserve your start date.' },
  { terms: 'No deposit required. Net 30 after completion.', capsuleNote: 'No deposit', sentence: 'No deposit is due. Payment follows the terms below.' },
  { terms: '50% down at rough in, 50% at completion.', capsuleNote: 'Payment follows the terms', sentence: 'Payment follows the terms below.' }
]

describe('the capsule, the preview and the customer page agree', () => {
  for (const { terms, capsuleNote, sentence } of CASES) {
    it(`on a $10,000 quote with terms ${JSON.stringify(terms)}`, () => {
      const contact = contactWith(terms)
      const capsule = capsuleMoney(contact, ROWS)
      const preview = previewMoney(contact, ROWS)
      const portal = portalMoney(contact, ROWS)

      // One total.
      expect(capsule.amount).toBe('$10,000.00')
      expect(preview.amount).toBe('$10,000.00')
      expect(moneyCents(portal.total)).toBe('$10,000.00')

      // One deposit: the capsule's note, and the same sentence and steps on
      // the preview and the customer page.
      expect(capsule.note).toBe(capsuleNote)
      if (portal.deposit.amount > 0) expect(capsule.note).toBe(`Deposit ${moneyCents(portal.deposit.amount)} at approval`)
      expect(depositSentence(portal.deposit)).toBe(sentence)
      expect(preview.note).toBe(sentence)
      expect(preview.steps).toEqual(portal.steps)
    })
  }

  it('falls back to the contract amount the same way in all three when no line has a price', () => {
    const contact = contactWith('30% deposit on signing.', 9000)
    const unpriced = ROWS.map((r) => ({ ...r, amount: 0, rate: 0 }))
    expect(capsuleMoney(contact, unpriced)).toEqual({ amount: '$10,000.00', note: 'Deposit $3,000.00 at approval' })
    expect(previewMoney(contact, unpriced).amount).toBe('$10,000.00')
    expect(previewMoney(contact, unpriced).note).toBe('Pay $3,000.00 now to reserve your start date.')
    expect(portalMoney(contact, unpriced).total).toBe(10000)
  })
})
