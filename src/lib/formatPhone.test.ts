// formats-10: one phone formatter for every screen, customer document and
// PDF, with one rule for a leading 1, so the same customer's number reads
// the same everywhere.
import { describe, expect, it, vi } from 'vitest'
import { renderToStaticMarkup } from 'react-dom/server'
import { createElement } from 'react'
import { formatPhone } from './utils.ts'
import { BillToBlock, DocumentShell } from '../components/documents/index'

vi.mock('./pdfLogo.ts', () => ({ loadLogoForPdf: async () => null, loadImageForPdf: async () => null }))

describe('formatPhone', () => {
  it('formats ten digits however they were typed', () => {
    expect(formatPhone('6155550101')).toBe('(615) 555-0101')
    expect(formatPhone('615-555-0101')).toBe('(615) 555-0101')
    expect(formatPhone('615 555 0101')).toBe('(615) 555-0101')
  })

  it('reads a number with the country code the same as one without', () => {
    expect(formatPhone('16155550101')).toBe('(615) 555-0101')
    expect(formatPhone('+1 615 555 0101')).toBe('(615) 555-0101')
  })

  it('leaves anything else as typed', () => {
    expect(formatPhone('555-0101')).toBe('555-0101')
    expect(formatPhone(null)).toBe('')
  })
})

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, '\n').replace(/\n+/g, '\n')

describe('customer documents', () => {
  it('the bill to block prints the customer phone formatted', () => {
    const out = text(renderToStaticMarkup(createElement(BillToBlock as any, { client: { name: 'Harold Wickham', phone: '6155550101', email: 'harold@example.com' } })))
    expect(out).toContain('(615) 555-0101 · harold@example.com')
    expect(out).not.toContain('6155550101')
  })

  it('the document letterhead prints the company and the recipient phones formatted', () => {
    const out = text(renderToStaticMarkup(createElement(DocumentShell as any, {
      company: { name: 'Parker Construction', phone: '6155550100', email: 'office@parker.co' },
      docType: 'Invoice', number: 'PCC-0001-01',
      recipient: { name: 'Harold Wickham', phone: '6155550101', email: 'harold@example.com' }
    })))
    expect(out).toContain('(615) 555-0100')
    expect(out).toContain('(615) 555-0101')
    expect(out).not.toMatch(/615555010[01]/)
  })

  it('the PDF prints the customer and company phones formatted', async () => {
    const { generateInvoice } = await import('./pdf.js')
    const r: any = await generateInvoice({
      company: { name: 'Parker Construction', phone: '6155550100', email: 'office@parker.co' },
      contact: { id: '1c8d2e3f-4051-4b6c-9d7e-8f9a0b1c2d3e', name: 'Harold Wickham', phone: '6155550101', email: 'harold@example.com', job_title: 'Back patio' },
      lineItems: [{ description: 'Final', qty: 1, rate: 4200.75, amount: 4200.75 }],
      invoiceId: '1c8d2e3f-4051-4b6c-9d7e-8f9a0b1c2d3e', contractTotal: 4200.75, previouslyPaid: 0
    } as any)
    const pages = r.doc.internal.pages as string[][]
    const drawn = pages.flat().filter((op) => typeof op === 'string').join('\n').replace(/\\([()])/g, '$1')
    expect(drawn).toContain('(615) 555-0101')
    expect(drawn).toContain('(615) 555-0100')
    expect(drawn).not.toMatch(/615555010[01]/)
  })
})
