// src/lib/pdfLayout.test.ts
//
// Layout regression tests for the customer PDFs (src/lib/pdf.js). They read
// the text jsPDF wrote into each page and check what the customer sees:
// money that stays on one line, signs that survive, long text that flows to
// the next page instead of running into the footer or off the page, and the
// DocuSign anchors on the customer signature line.

import { describe, it, expect, vi } from 'vitest'
import { generateInvoice, generateQuote, generateStatement, ESIGN_SIGN_ANCHOR, ESIGN_DATE_ANCHOR } from './pdf.js'
import { SIGN_ANCHOR, DATE_ANCHOR } from '../../netlify/functions/docusign-send.js'

// Photos load through a browser canvas; hand back a tiny embedded PNG so
// the photo block can be laid out under node.
const PIXEL_PNG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAQAAAADCAIAAAA7ljmRAAAADklEQVR4nGNoQAIMODkAXzYSAY5zHKsAAAAASUVORK5CYII='
vi.mock('./pdfLogo.ts', () => ({
  loadLogoForPdf: async () => null,
  loadImageForPdf: async (url: string) => (url ? { dataUrl: PIXEL_PNG, format: 'PNG', width: 4, height: 3 } : null)
}))

type Run = { page: number; text: string; x: number; y: number }

// Every text run drawn, with its baseline in mm from the top of the page.
function textRuns(doc: any): Run[] {
  const k = doc.internal.scaleFactor
  const pageHeightPt = doc.internal.pageSize.getHeight() * k
  const runs: Run[] = []
  const pages = doc.internal.pages as string[][]
  for (let page = 1; page < pages.length; page++) {
    for (const op of pages[page]) {
      if (typeof op !== 'string' || !op.startsWith('BT')) continue
      const td = /(-?[\d.]+) (-?[\d.]+) Td/.exec(op)
      if (!td) continue
      const leading = Number((/([\d.]+) TL/.exec(op) || [])[1] || 0)
      let y = Number(td[2])
      ;[...op.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)].forEach((m, i) => {
        if (i > 0) y -= leading
        runs.push({ page, text: m[1].replace(/\\([\\()])/g, '$1'), x: Number(td[1]) / k, y: (pageHeightPt - y) / k })
      })
    }
  }
  return runs
}

const squash = (s: string) => s.replace(/\s+/g, ' ').trim()

// On every page the fine print sits alone at the foot: no other text within
// 4mm of the footer's first line, none below it, and none off the page.
function expectFooterClear(doc: any, footerText: string) {
  const footer = squash(footerText)
  const pageHeight = doc.internal.pageSize.getHeight()
  const runs = textRuns(doc)
  const pageCount = doc.internal.getNumberOfPages()
  for (let page = 1; page <= pageCount; page++) {
    const onPage = runs.filter((r) => r.page === page && r.text.trim())
    const footerRuns = onPage.filter((r) => r.y > pageHeight * 0.8 && footer.includes(squash(r.text)))
    expect(footerRuns.length, `page ${page} footer`).toBeGreaterThan(0)
    const footerTop = Math.min(...footerRuns.map((r) => r.y))
    for (const r of onPage) {
      if (footerRuns.includes(r)) continue
      expect(r.y, `page ${page}: "${r.text}" runs into the footer`).toBeLessThan(footerTop - 4)
      expect(r.y, `page ${page}: "${r.text}" is off the page`).toBeGreaterThan(0)
    }
  }
}

function cellLines(table: any, section: 'head' | 'body', col: number) {
  return table[section].map((row: any) => row.cells[col].text as string[])
}

const INVOICE_DISCLAIMER = 'Pricing covers labor, material, standard equipment, placement, finishing, and cleanup for the scope as billed. Hidden conditions, field changes, or scope deviations may require a separate change order. Past due balances may accrue at 1.5% per month.'
const PROPOSAL_DISCLAIMER = 'Pricing includes labor, material, standard equipment, placement, finishing, and cleanup for the listed scope only. Pricing is based on visible site conditions at time of estimating. Any hidden conditions, field changes, requested by owner additions, or scope deviations may require additional pricing through written change order approval. Estimate valid for 30 days.'

const company = {
  name: 'Parker Construction Co.',
  address: '100 Main St, Murfreesboro TN',
  phone: '(615) 555-0100',
  email: 'admin@parkerconstructioncompany.com',
  warranty_default: 'One year workmanship warranty on all installed work.'
}
const contact = {
  id: '6f1c9b1e-0000-4000-8000-000000000001',
  name: 'Justin Bryan',
  address: '615 N Highland Ave, Murfreesboro TN',
  email: 'justin@example.com',
  job_title: 'Upstairs bath remodel'
}
// Fourteen paragraphs of contract terms, each ending in a marker.
const longTerms = Array.from({ length: 14 }, (_, i) =>
  `Clause ${i + 1}. The contractor will perform the work in a workmanlike manner using standard practices. Payment is due within ten days of each draw, and changes require a written change order signed by both parties before work proceeds. END${i + 1}`
).join('\n\n')
const manyItems = Array.from({ length: 14 }, (_, s) => [0, 1, 2].map((i) => ({
  description: `Section ${s} item ${i}, demo, haul, prep and finish work described in moderate detail`,
  section: `Trade ${s}`, qty: 2, unit: 'ea', rate: 187.5, amount: 375
}))).flat()

function expectAllMarkers(doc: any) {
  const text = textRuns(doc).map((r) => r.text).join(' ')
  for (let i = 1; i <= 14; i++) expect(text, `END${i} missing`).toContain(`END${i}`)
}

describe('money columns', () => {
  it('keeps invoice amounts and headers on one line', async () => {
    const r: any = await generateInvoice({
      company, contact,
      lineItems: [
        { description: 'Cabinet install', qty: 1, rate: 12345.67, amount: 12345.67 },
        { description: 'Countertops', qty: 1250, unit: 'sq ft', rate: 2, amount: 2500 }
      ],
      invoiceId: contact.id, contractTotal: 14845.67, previouslyPaid: 0
    } as any)
    const table = r.doc.lastAutoTable
    for (let col = 0; col < 5; col++) {
      for (const lines of cellLines(table, 'head', col)) expect(lines).toHaveLength(1)
    }
    for (const col of [3, 4]) {
      for (const lines of cellLines(table, 'body', col)) expect(lines).toHaveLength(1)
    }
    expect(cellLines(table, 'body', 4)[0]).toEqual(['$12,345.67'])
  })

  it('keeps billing schedule dates, amounts and status on one line', async () => {
    const r: any = await generateInvoice({
      company, contact,
      lineItems: [{ description: 'Draw 2', qty: 1, rate: 12345.67, amount: 12345.67 }],
      invoiceId: contact.id, contractTotal: 1250000, previouslyPaid: 0,
      invoices: [
        { id: 'a', sequence_number: 1, title: 'Deposit', amount: 2500, status: 'paid', issued_at: '2026-05-30', due_at: '2026-06-15' },
        { id: 'b', sequence_number: 2, amount: 12345.67, status: 'sent', issued_at: '2026-09-30', due_at: '2026-09-30' },
        { id: 'c', sequence_number: 3, amount: 1234567.89, status: 'sent', issued_at: '2026-05-01', due_at: '2026-11-30' }
      ],
      currentInvoice: { id: 'b', sequence_number: 2, amount: 12345.67 }
    } as any)
    const table = r.doc.lastAutoTable
    for (let col = 1; col < 5; col++) {
      for (const lines of cellLines(table, 'head', col)) expect(lines).toHaveLength(1)
      for (const lines of cellLines(table, 'body', col)) expect(lines.length).toBeLessThanOrEqual(1)
    }
  })

  it('keeps statement and themed estimate amounts on one line', async () => {
    const stmt: any = await generateStatement({
      company,
      client: { id: 'c1', name: 'MMC Properties' },
      lines: [{ property: 'Summit Townhomes', contract: 123456.78, paid: 1880, balance: 121576.78 }]
    } as any)
    for (let col = 1; col < 4; col++) {
      for (const lines of [...cellLines(stmt.doc.lastAutoTable, 'head', col), ...cellLines(stmt.doc.lastAutoTable, 'body', col)]) expect(lines).toHaveLength(1)
    }
    const mint: any = await generateQuote({
      company: { ...company, estimate_template: 'mint' }, contact,
      items: [{ description: 'Tile', section: 'Tile', qty: 1, rate: 12345.67, amount: 12345.67 }],
      quoteId: contact.id
    } as any)
    for (let col = 1; col < 4; col++) {
      for (const lines of [...cellLines(mint.doc.lastAutoTable, 'head', col), ...cellLines(mint.doc.lastAutoTable, 'body', col)]) expect(lines).toHaveLength(1)
    }
  })
})

describe('characters the standard fonts cannot draw', () => {
  it('prints credits and payments with a readable minus sign', async () => {
    const r: any = await generateInvoice({
      company: { ...company, payment_link: 'venmo.com/u/parker' },
      contact: { ...contact, name: 'Justin \u{1F44D} Bryan' },
      lineItems: [{ description: 'Deposit → cabinets', notes: '12′ run, ≥ 3 coats', qty: 1, rate: 2500, amount: 2500 }],
      invoiceId: contact.id, contractTotal: 10000, previouslyPaid: 500,
      changeOrders: [{ amount: -300, status: 'approved' }]
    } as any)
    const runs = textRuns(r.doc)
    const text = runs.map((x) => x.text)
    expect(text.some((t) => t.includes('\u0000'))).toBe(false)
    expect(text).toContain('-$500.00')
    expect(text).toContain('-$300.00')
    expect(text).toContain('Pay online at venmo.com/u/parker')
    expect(text.join(' ')).toContain('Deposit -> cabinets')
    expect(text.join(' ')).toContain('12\' run, >= 3 coats')
  })
})

describe('page flow', () => {
  it('flows long invoice notes across pages without touching the footer', async () => {
    const r: any = await generateInvoice({
      company, contact,
      lineItems: [{ description: 'Draw', qty: 1, rate: 2500, amount: 2500 }],
      notes: longTerms, invoiceId: contact.id, contractTotal: 2500, previouslyPaid: 0,
      insurance: { claim_number: 'CLM-1', carrier: 'Acme Mutual' }
    } as any)
    expect(r.doc.internal.getNumberOfPages()).toBeGreaterThan(1)
    expectAllMarkers(r.doc)
    expectFooterClear(r.doc, INVOICE_DISCLAIMER)
  })

  for (const template of ['classic', 'slate', 'mint', 'editorial']) {
    it(`keeps long ${template} tables and terms clear of the footer`, async () => {
      const r: any = await generateQuote({
        company: { ...company, estimate_template: template }, contact,
        items: manyItems, scope: 'Remove and replace the upstairs bath. '.repeat(30),
        terms: longTerms, exclusions: 'Permit fees', quoteId: contact.id, status: 'sent'
      } as any)
      expect(r.doc.internal.getNumberOfPages()).toBeGreaterThan(2)
      expectAllMarkers(r.doc)
      expectFooterClear(r.doc, PROPOSAL_DISCLAIMER)
    })
  }

  it('keeps a long statement clear of the footer', async () => {
    const r: any = await generateStatement({
      company, client: { id: 'c1', name: 'MMC Properties' },
      lines: Array.from({ length: 30 }, (_, i) => ({ property: `Unit ${i + 1}, sidewalk repair`, contract: 1000, paid: 0, balance: 1000 }))
    } as any)
    expect(r.doc.internal.getNumberOfPages()).toBeGreaterThan(1)
    expectFooterClear(r.doc, 'Statement of open invoices across all properties. Please remit the total due or contact us with any questions.')
  })
})

describe('DocuSign anchors', () => {
  it('uses the same tokens docusign-send anchors on', () => {
    expect(ESIGN_SIGN_ANCHOR).toBe(SIGN_ANCHOR)
    expect(ESIGN_DATE_ANCHOR).toBe(DATE_ANCHOR)
  })

  for (const [template, label] of [['classic', 'CUSTOMER'], ['slate', 'CLIENT SIGNATURE'], ['mint', 'CLIENT SIGNATURE'], ['editorial', 'CLIENT SIGNATURE']]) {
    it(`draws both anchors once, just above the ${template} customer signature line`, async () => {
      const r: any = await generateQuote({
        company: { ...company, estimate_template: template }, contact,
        items: [{ description: 'Tile', section: 'Tile', qty: 1, rate: 100, amount: 100 }], quoteId: contact.id
      } as any)
      const runs = textRuns(r.doc)
      const sign = runs.filter((x) => x.text === SIGN_ANCHOR)
      const date = runs.filter((x) => x.text === DATE_ANCHOR)
      const customer = runs.find((x) => x.text === label)
      expect(sign).toHaveLength(1)
      expect(date).toHaveLength(1)
      expect(customer).toBeTruthy()
      // The label sits 5mm under the line and the anchors 1.5mm over it.
      expect(customer!.y - sign[0].y).toBeCloseTo(6.5, 1)
      expect(sign[0].page).toBe(customer!.page)
      expect(date[0].x).toBeGreaterThan(sign[0].x)
    })
  }
})

describe('project photo groups', () => {
  it('groups caption only tags together and keeps every label on one line', async () => {
    const sentence = 'Demo of upstairs bath complete; subfloor sound, no rot under tub, new drain line roughed in'
    const longTag = 'A very long real section tag describing the plumbing rough in for the second floor bathroom and laundry'
    const r: any = await generateQuote({
      company, contact,
      items: [{ description: 'Tile', section: 'Tile', qty: 1, rate: 100, amount: 100 }], quoteId: contact.id,
      photos: [
        { url: 'p1', caption: sentence, section_tag: sentence },
        { url: 'p2', caption: 'Tile layout', section_tag: 'Tile layout' },
        { url: 'p3', caption: 'Vanity wall', section_tag: 'Plumbing' },
        { url: 'p4', caption: null, section_tag: longTag }
      ]
    } as any)
    const text = textRuns(r.doc).map((x) => x.text)
    expect(text).not.toContain(sentence.toUpperCase())
    expect(text.filter((t) => t === 'PROJECT PHOTOS').length).toBe(2)   // block header + untagged group
    expect(text).toContain('PLUMBING')
    const cut = text.find((t) => t.startsWith('A VERY LONG REAL SECTION TAG'))
    expect(cut).toBeTruthy()
    expect(cut!.endsWith('...')).toBe(true)
    expect(cut!.length).toBeLessThan(longTag.length)
  })
})
