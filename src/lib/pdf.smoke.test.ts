// src/lib/pdf.smoke.test.ts
//
// PDF engine smoke tests — written as the safety net for the
// jspdf 2.x → 4.x upgrade, kept as a permanent regression guard.
// Each generator must produce a real multi-byte PDF (%PDF header)
// without throwing. These don't assert layout; they assert the
// engine + autoTable still cooperate after dependency bumps.

import { describe, it, expect } from 'vitest'
// pdf.js is a large untyped legacy module — array params infer as
// never[], so fixture payloads go through `as any` at the call sites.
import { generateInvoice, generateQuote, generateCertificate, generateStatement } from './pdf.js'

const company = {
  name: 'Parker Construction Co.',
  address: '100 Main St, Murfreesboro TN',
  phone: '(615) 555-0100',
  email: 'admin@parkerconstructioncompany.com',
  license_number: 'TN-123456',
  warranty_default: 'One-year workmanship warranty on all installed work.'
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
      lineItems: [{ description: 'Final balance — Handrail painting', qty: 1, rate: 1380, amount: 1380 }],
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
        { property: 'Summit Townhomes — sidewalk repair', contract: 1880, paid: 500, balance: 1380 },
        { property: '12 Oak St — driveway', contract: 2500, paid: 0, balance: 2500 },
        { property: 'Maple Court — curb', contract: 1400, paid: 500, balance: 900 }
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

  it('survives empty inputs (defensive defaults)', async () => {
    const result = await generateInvoice({})
    expectRealPdf(result)
  })
})
