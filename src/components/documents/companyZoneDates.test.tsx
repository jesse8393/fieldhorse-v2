// formats-2: a customer reading the invoice link in another time zone sees
// the dates the company set, the ones the PDF and the app print: a due
// date stored at the end of Nov 24 in Central time reads Nov 24 on a phone
// in Eastern time too, not Nov 25.
import { afterAll, describe, expect, it } from 'vitest'

const originalTz = process.env.TZ
process.env.TZ = 'America/New_York'
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

const { renderToStaticMarkup } = await import('react-dom/server')
const { createElement } = await import('react')
const { InvoiceTemplate, ProposalTemplate, ApprovalBlock } = await import('./index')
const { longDate, shortDate } = await import('./format.ts')
const { buildPortalView } = await import('../../lib/portalView.ts')

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n')

// Sent Mon Nov 9 at 11:30 pm Central; due Tue Nov 24, stored the way the
// job's Invoices tab stores it, at the end of that day in Central time.
const ISSUED = '2026-11-10T05:30:00Z'
const DUE = '2026-11-25T05:59:59.999Z'

describe('document dates in the company time zone', () => {
  it('formats a timestamp in the company zone when one is given', () => {
    expect(longDate(DUE, 'America/Chicago')).toBe('November 24, 2026')
    expect(longDate(ISSUED, 'America/Chicago')).toBe('November 9, 2026')
    expect(shortDate(DUE, 'America/Chicago')).toBe('Nov 24, 2026')
  })

  it('keeps a date only value on its calendar day in any zone', () => {
    expect(longDate('2026-11-20', 'America/Chicago')).toBe('November 20, 2026')
    expect(shortDate('2026-11-20', 'Pacific/Honolulu')).toBe('Nov 20, 2026')
  })

  it('falls back to the viewer zone with no company zone or a bad one', () => {
    expect(longDate(DUE)).toBe('November 25, 2026')
    expect(longDate(DUE, 'Not/AZone')).toBe('November 25, 2026')
  })

  it('the invoice prints the issue and due dates the company set', () => {
    const inv = { id: 'inv', contact_id: 'job', title: 'Final', amount: 4200.75, status: 'sent', sequence_number: 1, issued_at: ISSUED, due_at: DUE }
    const out = text(renderToStaticMarkup(createElement(InvoiceTemplate as any, {
      company: { name: 'Parker Construction Company', timezone: 'America/Chicago' },
      contact: { id: 'job', name: 'Harold Wickham', job_title: 'Back patio', amount: 4200.75 },
      lineItems: [{ description: 'Final', qty: 1, rate: 4200.75, amount: 4200.75 }],
      contractTotal: 4200.75, invoices: [inv], currentInvoice: inv,
      meta: { issuedAt: ISSUED, dueDate: DUE }
    })))
    expect(out).toContain('November 24, 2026')
    expect(out).toContain('November 9, 2026')
    expect(out).toContain('Nov 24, 2026')
    expect(out).not.toContain('November 25, 2026')
    expect(out).not.toContain('November 10, 2026')
  })

  // The quote link carries the company zone as well: a quote created at
  // 11:30 pm Central reads the day it was made, and so do its expiry, its
  // approved change order and its approval.
  const proposal = (template: string) => text(renderToStaticMarkup(createElement(ProposalTemplate as any, {
    company: { name: 'Parker Construction Company', timezone: 'America/Chicago', estimate_template: template },
    contact: { id: 'job', name: 'Harold Wickham', job_title: 'Back patio', amount: 4200.75 },
    scopeSections: [{ title: 'Patio', items: [{ description: 'Pour', qty: 1, rate: 4200.75 }] }],
    changeOrders: [{ id: 'co1', sequence_number: 1, title: 'Extra rebar', amount: 1235.5, status: 'approved', approved_at: '2026-11-12T05:30:00Z' }],
    approval: { mode: 'approved', clientName: 'Harold Wickham', clientApprovedAt: '2026-11-12T05:30:00Z' },
    status: 'approved',
    meta: { issuedAt: ISSUED, expiresAt: '2026-12-10T05:30:00Z' }
  })))

  it('the quote prints its issued, expiry, change order and approval dates in the company zone', () => {
    const out = proposal('classic')
    expect(out).toContain('November 9, 2026')
    expect(out).toContain('December 9, 2026')
    expect(out).toContain('Nov 11, 2026')
    expect(out).not.toContain('November 10, 2026')
    expect(out).not.toContain('December 10, 2026')
    expect(out).not.toContain('Nov 12, 2026')
  })

  it.each(['slate', 'mint', 'editorial'])('the %s quote prints its dates in the company zone', (template) => {
    const out = proposal(template)
    expect(out).toContain('11/09/2026')
    expect(out).not.toContain('11/10/2026')
  })

  it('the approval block prints the approval dates in the company zone', () => {
    const out = text(renderToStaticMarkup(createElement(ApprovalBlock as any, {
      company: { name: 'Parker Construction Company', timezone: 'America/Chicago' },
      mode: 'approved', clientName: 'Harold Wickham', clientApprovedAt: '2026-11-12T05:30:00Z', contractorApprovedAt: '2026-11-12T05:30:00Z'
    })))
    expect(out).toContain('November 11, 2026')
    expect(out).not.toContain('November 12, 2026')
  })

  // The customer page view under the estimate (the fieldhorse theme) reads
  // the same days: issued Nov 9 and valid until Dec 9, stored at the end of
  // that day in Central time, and the quote stays open through Dec 9.
  it('the quote page view reads the issue and expiry days in the company zone', () => {
    const payload: any = {
      ok: true, kind: 'proposal',
      company: { name: 'Parker Construction Company', timezone: 'America/Chicago' },
      contact: { id: 'job', name: 'Harold Wickham', proposal_status: 'sent', stage: 'quote', created_at: ISSUED, quote_expires_at: '2026-12-10T05:59:59.999Z' },
      items: [], payments: [], changeOrders: [], invoices: [], photos: []
    }
    const pv = buildPortalView(payload, new Date('2026-11-17T16:00:00Z'))
    expect(pv.issuedOn).toBe('November 9')
    expect(pv.validUntil).toBe('December 9')
    expect(buildPortalView(payload, new Date('2026-12-10T03:00:00Z')).expired).toBe(false)
    expect(buildPortalView(payload, new Date('2026-12-10T06:00:00Z')).expired).toBe(true)
  })
})
