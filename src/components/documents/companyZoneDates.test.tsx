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
const { InvoiceTemplate } = await import('./index')
const { longDate, shortDate } = await import('./format.ts')

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
})
