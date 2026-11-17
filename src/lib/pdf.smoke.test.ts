// src/lib/pdf.smoke.test.ts
//
// PDF engine smoke tests, written as the safety net for the
// jspdf 2.x → 4.x upgrade, kept as a permanent regression guard.
// Each generator must produce a real multi-byte PDF (%PDF header)
// without throwing. These don't assert layout; they assert the
// engine + autoTable still cooperate after dependency bumps.

import { describe, it, expect } from 'vitest'
// pdf.js is a large untyped legacy module, array params infer as
// never[], so fixture payloads go through `as any` at the call sites.
import { generateInvoice, generateQuote, generateCertificate, generateStatement } from './pdf.js'
import { invoicePdfInput } from './invoices.ts'

// Every string the PDF draws, in drawing order.
function pdfText(result: any): string[] {
  return [...String(result.doc.output()).matchAll(/\(((?:\\.|[^\\()])*)\)\s*Tj/g)].map((m: any) => m[1])
}

const company = {
  name: 'Parker Construction Co.',
  address: '100 Main St, Murfreesboro TN',
  phone: '(615) 555-0100',
  email: 'admin@parkerconstructioncompany.com',
  license_number: 'TN-123456',
  warranty_default: 'One year workmanship warranty on all installed work.'
}

const contact = {
  id: '6f1c9b1e-0000-4000-8000-000000000001',
  name: 'Justin Bryan',
  address: '615 N Highland Ave, Murfreesboro TN',
  phone: '(615) 555-0188',
  email: 'justin@example.com',
  job_title: 'Handrail painting'
}

function pdfBytes(result: any): Uint8Array {
  const out = result.doc.output('arraybuffer')
  return new Uint8Array(out)
}

function expectRealPdf(result: any) {
  expect(result?.doc).toBeTruthy()
  expect(typeof result.filename).toBe('string')
  const bytes = pdfBytes(result)
  // %PDF- magic + a sane minimum size for a one-page letter doc.
  expect(String.fromCharCode(...bytes.slice(0, 5))).toBe('%PDF-')
  expect(bytes.length).toBeGreaterThan(5_000)
}

describe('pdf engine smoke', () => {
  it('generateInvoice produces a valid PDF', async () => {
    const result = await generateInvoice({
      company,
      contact,
      lineItems: [{ description: 'Final balance, Handrail painting', qty: 1, rate: 1380, amount: 1380 }],
      notes: 'Check or ACH accepted.',
      dueDate: 'Jun 26',
      invoiceId: contact.id,
      payments: [{ amount: 500, paid_on: '2026-06-01', method: 'check' }],
      contractTotal: 1880,
      previouslyPaid: 500,
      changeOrders: [{ sequence_number: 1, title: 'Extra coat', amount: 200, status: 'approved' }]
    } as any)
    expectRealPdf(result)
  })

  it('generateQuote produces a valid PDF', async () => {
    const result = await generateQuote({
      company,
      contact,
      items: [
        { description: 'Surface prep', section: 'Labor', qty: 8, unit: 'hr', rate: 65, amount: 520 },
        { description: 'Paint + primer', section: 'Materials', qty: 1, unit: 'lump', rate: 300, amount: 300 },
        { description: 'Premium finish', qty: 1, rate: 250, amount: 250, is_optional: true }
      ],
      scope: 'Prep, prime, and paint all exterior handrails.',
      terms: '50% deposit, balance on completion.',
      exclusions: 'Structural repairs',
      quoteId: contact.id,
      status: 'sent'
    } as any)
    expectRealPdf(result)
  })

  it('generateCertificate produces a valid PDF', async () => {
    const result = await generateCertificate({
      company,
      contact,
      closeout: {
        id: contact.id,
        closed_at: '2026-06-10T12:00:00Z',
        signoff_name: 'Justin Bryan'
      }
    } as any)
    expectRealPdf(result)
  })

  it('generateStatement produces a valid PDF', async () => {
    const result = await generateStatement({
      company,
      client: {
        id: '6f1c9b1e-0000-4000-8000-000000000099',
        name: 'Jordan Pell',
        company_name: 'MMC Properties',
        address: '200 Commerce Dr, Murfreesboro TN',
        email: 'ap@mmcproperties.com'
      },
      lines: [
        { property: 'Summit Townhomes, sidewalk repair', contract: 1880, paid: 500, balance: 1380 },
        { property: '12 Oak St, driveway', contract: 2500, paid: 0, balance: 2500 },
        { property: 'Maple Court, curb', contract: 1400, paid: 500, balance: 900 }
      ],
      statementId: '6f1c9b1e-0000-4000-8000-000000000099'
    } as any)
    expectRealPdf(result)
    expect(result.totalDue).toBe(4780)
  })

  it('generateStatement survives an empty client', async () => {
    const result = await generateStatement({ company, client: {}, lines: [] } as any)
    expectRealPdf(result)
  })

  it('renders the pay block when a payment link is set (invoice + statement)', async () => {
    const payCompany = { ...company, payment_link: 'venmo.com/u/parker', payment_instructions: 'Checks payable to Parker Construction Co.' }
    const inv = await generateInvoice({
      company: payCompany, contact,
      lineItems: [{ description: 'Final balance', qty: 1, rate: 1380, amount: 1380 }],
      invoiceId: contact.id, contractTotal: 1380, previouslyPaid: 0
    } as any)
    expectRealPdf(inv)
    const stmt = await generateStatement({
      company: payCompany,
      client: { id: 'x', name: 'MMC', email: 'a@b.com' },
      lines: [{ property: 'Lot 1', contract: 1000, paid: 0, balance: 1000 }]
    } as any)
    expectRealPdf(stmt)
  })

  it('survives empty inputs (defensive defaults)', async () => {
    const result = await generateInvoice({})
    expectRealPdf(result)
  })

  // M-06: a job saved with no price has no contract to reconcile against.
  describe('an invoice on a job with no price', () => {
    const job = { id: 'job-1', name: 'Marco Castellanos', email: 'marco@example.com', phone: null, address: null, job_title: 'Weekly service', amount: 0 }

    it('second invoice: prints what it owes and never PAID or a collected line', async () => {
      const invA = { id: 'inv-a', contact_id: 'job-1', sequence_number: 1, title: 'Week 1', amount: 500, status: 'paid', issued_at: '2026-11-02T15:00:00Z', due_at: null, description: null, notes: null }
      const invB = { id: 'inv-b', contact_id: 'job-1', sequence_number: 2, title: 'Week 2', amount: 500, status: 'sent', issued_at: '2026-11-09T15:00:00Z', due_at: '2026-11-24T05:59:59.999Z', description: null, notes: null }
      const payments = [{ id: 'p1', contact_id: 'job-1', invoice_id: 'inv-a', amount: 500, paid_on: '2026-11-05' }]
      const input = invoicePdfInput({ invoice: invB as any, contact: job, company, payments, changeOrders: [], invoices: [invA, invB] as any })
      expect(input.amountDue).toBe(500)
      const text = pdfText(await generateInvoice(input as any))
      expect(text[text.indexOf('AMOUNT DUE') + 1]).toBe('$500.00')
      expect(text.filter((t) => / collected$/.test(t) || t === 'PAID' || t === 'BALANCE REMAINING' || t === 'CONTRACT POSITION')).toEqual([])
    })

    it('a draw printed from the job page with part of it paid is not PAID', async () => {
      const draw = { id: 'inv-1', contact_id: 'job-1', sequence_number: 1, title: 'Deposit', amount: 500, status: 'sent', issued_at: '2026-11-09T15:00:00Z', due_at: null }
      const text = pdfText(await generateInvoice({
        company,
        contact: { id: 'job-1', name: 'Marco Castellanos', job_title: 'Deposit, Service call' },
        lineItems: [{ description: 'Deposit', notes: 'Service call', qty: 1, rate: 500, amount: 500 }],
        invoiceId: 'inv-1', currentInvoice: draw, invoices: [draw],
        payments: [{ id: 'p1', contact_id: 'job-1', invoice_id: 'inv-1', amount: 200, paid_on: '2026-11-12' }],
        contractTotal: 0, previouslyPaid: 200, amountDue: 300, changeOrders: []
      } as any))
      expect(text[text.indexOf('AMOUNT DUE') + 1]).toBe('$300.00')
      expect(text.filter((t) => / collected$/.test(t) || t === 'PAID' || t === 'BALANCE REMAINING')).toEqual([])
    })

    it('with no figure handed in, the draw owes its amount less its own payments', async () => {
      const draw = { id: 'inv-1', contact_id: 'job-1', sequence_number: 2, title: 'Week 2', amount: 500, status: 'sent', issued_at: '2026-11-09T15:00:00Z', due_at: null }
      const text = pdfText(await generateInvoice({
        company, contact: { id: 'job-1', name: 'Marco Castellanos' },
        lineItems: [{ description: 'Week 2', qty: 1, rate: 500, amount: 500 }],
        invoiceId: 'inv-1', currentInvoice: draw,
        payments: [{ invoice_id: 'inv-0', amount: 500 }, { invoice_id: 'inv-1', amount: 200.25 }],
        contractTotal: null, previouslyPaid: 700.25, changeOrders: []
      } as any))
      expect(text[text.indexOf('AMOUNT DUE') + 1]).toBe('$299.75')
    })

    it('a job with a price still prints its contract position, and 49 cents owed is not PAID', async () => {
      const text = pdfText(await generateInvoice({
        company, contact,
        lineItems: [{ description: 'Final balance', qty: 1, rate: 1380, amount: 1380 }],
        invoiceId: contact.id, contractTotal: 1380, previouslyPaid: 1379.51, amountDue: 0.49
      } as any))
      expect(text[text.indexOf('AMOUNT DUE') + 1]).toBe('$0.49')
      expect(text[text.indexOf('BALANCE REMAINING') + 1]).toBe('$0.49')
      expect(text.some((t) => / collected$/.test(t))).toBe(true)
    })
  })

  // M-11: paid_at_close was saved as the float sum 1000.0699999999999.
  it('the certificate of a job paid to the cent reads Paid in full', async () => {
    const closeout = { final_amount: 1000.07, paid_at_close: 500.04 + 400.03 + 100, closed_at: '2026-11-16T18:00:00Z', signoff_at: '2026-11-16T18:00:00Z', signoff_method: 'verbal', signoff_name: 'Marco Castellanos', warranty_months: 12, warranty_start_date: '2026-11-16' }
    const text = pdfText(await generateCertificate({ company, contact: { id: 'job-1', name: 'Marco Castellanos', job_title: 'Slab', amount: 1000.07 }, closeout } as any))
    const figures = text.slice(text.indexOf('FINAL FIGURES'))
    expect(figures.filter((t) => /paid in full|outstanding|^\$/i.test(t))).toEqual(['$1,000.07', '$1,000.07', 'Paid in full'])
  })

  it('the certificate still shows one cent outstanding', async () => {
    const closeout = { final_amount: 1000.07, paid_at_close: 1000.06, closed_at: '2026-11-16T18:00:00Z', signoff_method: 'verbal' }
    const text = pdfText(await generateCertificate({ company, contact: { id: 'job-1', name: 'Marco Castellanos', amount: 1000.07 }, closeout } as any))
    const figures = text.slice(text.indexOf('FINAL FIGURES'))
    expect(figures.filter((t) => /paid in full|outstanding|^\$/i.test(t))).toEqual(['$1,000.07', '$1,000.06', 'OUTSTANDING', '$0.01'])
  })
})
