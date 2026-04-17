// PDF generator — invoices and proposals.
// Uses jsPDF + jspdf-autotable. Styled with Fieldhorse brand tokens baked in
// so the output reads like a premium contractor doc, not a generic template.

import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const FIELD_GOLD = [200, 161, 84]      // #C8A154
const ONYX = [18, 18, 18]              // #121212
const RAW_LINEN = [244, 240, 232]      // #F4F0E8
const INK_MUTED = [106, 102, 94]       // #6A665E
const ALERT_RED = [179, 58, 58]        // #B33A3A
const SIGNAL_GREEN = [72, 130, 95]     // #48825F

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

function today() {
  return new Date().toLocaleDateString(undefined, {
    month: 'long',
    day: 'numeric',
    year: 'numeric'
  })
}

function invoiceNumber(seed) {
  const d = new Date()
  const y = d.getFullYear().toString().slice(-2)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const tail = seed ? String(seed).slice(-4).toUpperCase() : Math.random().toString(36).slice(2, 6).toUpperCase()
  return `FH-${y}${m}-${tail}`
}

/**
 * Render a Fieldhorse-branded header on the current page.
 * Wordmark left, meta block right.
 */
function drawHeader(doc, { company, logoUrl, documentType, documentNumber, date }) {
  const pageWidth = doc.internal.pageSize.getWidth()

  // Gold bar across the top
  doc.setFillColor(...FIELD_GOLD)
  doc.rect(0, 0, pageWidth, 4, 'F')

  // Company block (left)
  doc.setTextColor(...ONYX)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(24)
  doc.text((company?.name || 'Fieldhorse').toUpperCase(), 14, 20)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...INK_MUTED)
  let y = 27
  if (company?.address) { doc.text(company.address, 14, y); y += 4.5 }
  if (company?.phone)   { doc.text(company.phone, 14, y);   y += 4.5 }
  if (company?.email)   { doc.text(company.email, 14, y);   y += 4.5 }

  // Doc meta (right) — aligned right
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...FIELD_GOLD)
  doc.text(documentType.toUpperCase(), pageWidth - 14, 20, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...ONYX)
  doc.text(`No. ${documentNumber}`, pageWidth - 14, 26, { align: 'right' })
  doc.setTextColor(...INK_MUTED)
  doc.text(date, pageWidth - 14, 30.5, { align: 'right' })

  // Thin divider
  doc.setDrawColor(220, 215, 205)
  doc.setLineWidth(0.3)
  doc.line(14, 46, pageWidth - 14, 46)

  return 52  // y cursor after header
}

function drawBillTo(doc, y, contact) {
  doc.setTextColor(...INK_MUTED)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.text('BILL TO', 14, y)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...ONYX)
  doc.text(contact?.name || '—', 14, y + 5)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...INK_MUTED)
  let yy = y + 10
  if (contact?.address) { doc.text(contact.address, 14, yy); yy += 4.5 }
  if (contact?.phone)   { doc.text(contact.phone, 14, yy);   yy += 4.5 }
  if (contact?.email)   { doc.text(contact.email, 14, yy);   yy += 4.5 }

  return yy + 4
}

function drawFooter(doc, tagline = 'Built for the jobsite.') {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()

  doc.setDrawColor(220, 215, 205)
  doc.setLineWidth(0.2)
  doc.line(14, pageHeight - 16, pageWidth - 14, pageHeight - 16)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...INK_MUTED)
  doc.text(tagline, 14, pageHeight - 10)

  const pageCount = doc.internal.getNumberOfPages()
  const current = doc.internal.getCurrentPageInfo().pageNumber
  doc.text(`Page ${current} of ${pageCount}`, pageWidth - 14, pageHeight - 10, { align: 'right' })
}

/**
 * Generate an invoice PDF.
 *
 * @param {object} opts
 * @param {object} opts.company    { name, address, phone, email }
 * @param {object} opts.contact    { name, address, phone, email }
 * @param {Array}  opts.lineItems  [{ description, qty, rate, amount }]
 * @param {number} opts.taxRate    decimal, e.g. 0.085
 * @param {string} opts.notes
 * @param {string} opts.dueDate    ISO or human string
 * @param {string} opts.invoiceId  (source id for fingerprinting; auto if omitted)
 * @returns {{ doc: jsPDF, filename: string, number: string }}
 */
export function generateInvoice({
  company = {},
  contact = {},
  lineItems = [],
  taxRate = 0,
  notes = '',
  dueDate = '',
  invoiceId
} = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const number = invoiceNumber(invoiceId)

  let y = drawHeader(doc, {
    company,
    documentType: 'Invoice',
    documentNumber: number,
    date: today()
  })

  y = drawBillTo(doc, y, contact)

  // Due date badge
  if (dueDate) {
    const pageWidth = doc.internal.pageSize.getWidth()
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...INK_MUTED)
    doc.text('DUE', pageWidth - 14, y - 20, { align: 'right' })
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(12)
    doc.setTextColor(...ALERT_RED)
    doc.text(dueDate, pageWidth - 14, y - 14, { align: 'right' })
    doc.setTextColor(...ONYX)
  }

  // Line items table
  const rows = lineItems.map((li) => {
    const qty = Number(li.qty || 1)
    const rate = Number(li.rate || 0)
    const amount = Number(li.amount != null ? li.amount : qty * rate)
    return [
      li.description || '',
      qty.toString(),
      money(rate),
      money(amount)
    ]
  })

  autoTable(doc, {
    startY: y,
    head: [['Description', 'Qty', 'Rate', 'Amount']],
    body: rows,
    theme: 'plain',
    headStyles: {
      fillColor: ONYX,
      textColor: FIELD_GOLD,
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: { top: 3, right: 4, bottom: 3, left: 4 }
    },
    bodyStyles: {
      fontSize: 9,
      textColor: ONYX,
      cellPadding: { top: 3, right: 4, bottom: 3, left: 4 }
    },
    alternateRowStyles: { fillColor: RAW_LINEN },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 20 },
      2: { halign: 'right', cellWidth: 30 },
      3: { halign: 'right', cellWidth: 32, fontStyle: 'bold' }
    },
    margin: { left: 14, right: 14 }
  })

  // Totals
  const subtotal = rows.reduce((s, r) => s + Number(r[3].replace(/[^0-9.-]/g, '')), 0)
  const tax = subtotal * Number(taxRate || 0)
  const total = subtotal + tax

  let afterTable = doc.lastAutoTable.finalY + 8
  const pageWidth = doc.internal.pageSize.getWidth()
  const labelX = pageWidth - 70
  const valueX = pageWidth - 14

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK_MUTED)
  doc.text('Subtotal', labelX, afterTable, { align: 'left' })
  doc.setTextColor(...ONYX)
  doc.text(money(subtotal), valueX, afterTable, { align: 'right' })

  if (taxRate > 0) {
    afterTable += 6
    doc.setTextColor(...INK_MUTED)
    doc.text(`Tax (${(taxRate * 100).toFixed(2)}%)`, labelX, afterTable)
    doc.setTextColor(...ONYX)
    doc.text(money(tax), valueX, afterTable, { align: 'right' })
  }

  afterTable += 4
  doc.setDrawColor(...FIELD_GOLD)
  doc.setLineWidth(0.6)
  doc.line(labelX, afterTable, valueX, afterTable)
  afterTable += 7

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...ONYX)
  doc.text('TOTAL DUE', labelX, afterTable)
  doc.setTextColor(...FIELD_GOLD)
  doc.text(money(total), valueX, afterTable, { align: 'right' })

  // Notes
  if (notes) {
    afterTable += 14
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...INK_MUTED)
    doc.text('NOTES', 14, afterTable)
    afterTable += 4
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...ONYX)
    const wrapped = doc.splitTextToSize(notes, pageWidth - 28)
    doc.text(wrapped, 14, afterTable)
  }

  drawFooter(doc, `${company?.name || 'Fieldhorse'} · Thanks for the work.`)

  return {
    doc,
    filename: `Invoice_${number}_${(contact?.name || 'client').replace(/\s+/g, '_')}.pdf`,
    number
  }
}

/**
 * Generate a proposal / estimate PDF.
 *
 * @param {object} opts
 * @param {object} opts.company    { name, address, phone, email }
 * @param {object} opts.contact    { name, address, phone, email, job_title }
 * @param {string} opts.scope      high-level scope paragraph
 * @param {Array}  opts.lineItems  [{ name, qty, unit, rate_low, rate_high, notes }]
 * @param {number} opts.marginPct  e.g. 25 (for margin-adjusted total)
 * @param {number} opts.totalLow
 * @param {number} opts.totalHigh
 * @param {Array}  opts.assumptions
 * @param {Array}  opts.risks
 * @param {Array}  opts.timeline   [{ phase, duration }]
 * @returns {{ doc: jsPDF, filename: string, number: string }}
 */
export function generateProposal({
  company = {},
  contact = {},
  scope = '',
  lineItems = [],
  marginPct = 0,
  totalLow = 0,
  totalHigh = 0,
  assumptions = [],
  risks = [],
  timeline = []
} = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const number = invoiceNumber(contact?.id).replace('FH-', 'FH-P')

  let y = drawHeader(doc, {
    company,
    documentType: 'Proposal',
    documentNumber: number,
    date: today()
  })

  y = drawBillTo(doc, y, contact)

  // Job title
  if (contact?.job_title) {
    const pageWidth = doc.internal.pageSize.getWidth()
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...INK_MUTED)
    doc.text('PROJECT', 14, y)
    y += 5
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(16)
    doc.setTextColor(...ONYX)
    const jobWrapped = doc.splitTextToSize(contact.job_title, pageWidth - 28)
    doc.text(jobWrapped, 14, y)
    y += jobWrapped.length * 6 + 4
  }

  const pageWidth = doc.internal.pageSize.getWidth()

  // Scope block
  if (scope) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...INK_MUTED)
    doc.text('SCOPE OF WORK', 14, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...ONYX)
    const scopeWrapped = doc.splitTextToSize(scope, pageWidth - 28)
    doc.text(scopeWrapped, 14, y)
    y += scopeWrapped.length * 4.8 + 8
  }

  // Line items
  if (lineItems.length > 0) {
    const rows = lineItems.map((li) => [
      li.name || '',
      `${li.qty || 1} ${li.unit || ''}`,
      `${money(li.rate_low || 0)}–${money(li.rate_high || 0)}`,
      `${money((li.rate_low || 0) * (li.qty || 1))}–${money((li.rate_high || 0) * (li.qty || 1))}`
    ])

    autoTable(doc, {
      startY: y,
      head: [['Line item', 'Quantity', 'Unit rate', 'Subtotal']],
      body: rows,
      theme: 'plain',
      headStyles: {
        fillColor: ONYX,
        textColor: FIELD_GOLD,
        fontStyle: 'bold',
        fontSize: 9,
        cellPadding: { top: 3, right: 4, bottom: 3, left: 4 }
      },
      bodyStyles: {
        fontSize: 9,
        textColor: ONYX,
        cellPadding: { top: 3, right: 4, bottom: 3, left: 4 }
      },
      alternateRowStyles: { fillColor: RAW_LINEN },
      columnStyles: {
        0: { cellWidth: 'auto' },
        1: { halign: 'right', cellWidth: 25 },
        2: { halign: 'right', cellWidth: 38 },
        3: { halign: 'right', cellWidth: 42, fontStyle: 'bold' }
      },
      margin: { left: 14, right: 14 }
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // Total band — HUGE Field Gold number
  const mid = (Number(totalLow) + Number(totalHigh)) / 2
  const withMargin = marginPct > 0 ? mid / (1 - marginPct / 100) : mid

  doc.setFillColor(...ONYX)
  doc.rect(14, y, pageWidth - 28, 28, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...FIELD_GOLD)
  doc.text(`PROPOSED PRICE (${marginPct}% MARGIN)`, 20, y + 8)

  doc.setFontSize(26)
  doc.text(money(withMargin), 20, y + 22)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...RAW_LINEN)
  doc.text(
    `Range: ${money(totalLow)} – ${money(totalHigh)}`,
    pageWidth - 20,
    y + 22,
    { align: 'right' }
  )
  y += 36

  // Side-by-side assumptions + risks
  const colWidth = (pageWidth - 28 - 8) / 2
  const startY = y

  if (assumptions.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...SIGNAL_GREEN)
    doc.text('ASSUMPTIONS', 14, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...ONYX)
    assumptions.forEach((a) => {
      const wrapped = doc.splitTextToSize(`• ${a}`, colWidth)
      doc.text(wrapped, 14, y)
      y += wrapped.length * 4.4 + 1
    })
  }

  let ry = startY
  if (risks.length > 0) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...ALERT_RED)
    doc.text('RISKS & UNKNOWNS', 14 + colWidth + 8, ry)
    ry += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...ONYX)
    risks.forEach((r) => {
      const wrapped = doc.splitTextToSize(`• ${r}`, colWidth)
      doc.text(wrapped, 14 + colWidth + 8, ry)
      ry += wrapped.length * 4.4 + 1
    })
  }

  y = Math.max(y, ry) + 8

  // Timeline
  if (timeline.length > 0) {
    if (y > doc.internal.pageSize.getHeight() - 60) {
      doc.addPage()
      y = 20
    }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...INK_MUTED)
    doc.text('TIMELINE', 14, y)
    y += 5
    autoTable(doc, {
      startY: y,
      head: [['Phase', 'Duration']],
      body: timeline.map((t) => [t.phase, t.duration]),
      theme: 'plain',
      headStyles: { fillColor: ONYX, textColor: FIELD_GOLD, fontSize: 9 },
      bodyStyles: { fontSize: 9, textColor: ONYX },
      alternateRowStyles: { fillColor: RAW_LINEN },
      margin: { left: 14, right: 14 }
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // Acceptance block
  if (y > doc.internal.pageSize.getHeight() - 50) {
    doc.addPage()
    y = 20
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...INK_MUTED)
  doc.text('ACCEPTANCE', 14, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...ONYX)
  const acceptText = `Signed acceptance of this proposal authorizes ${company?.name || 'the contractor'} to begin work under the terms outlined above. Payment schedule and change-order policy attached or per verbal agreement.`
  const acceptWrapped = doc.splitTextToSize(acceptText, pageWidth - 28)
  doc.text(acceptWrapped, 14, y)
  y += acceptWrapped.length * 4.4 + 12

  // Signature lines
  const sigWidth = (pageWidth - 28 - 20) / 2
  doc.setDrawColor(...ONYX)
  doc.setLineWidth(0.4)
  doc.line(14, y, 14 + sigWidth, y)
  doc.line(14 + sigWidth + 20, y, pageWidth - 14, y)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...INK_MUTED)
  doc.text('Client signature / date', 14, y + 4)
  doc.text(`${company?.name || 'Contractor'} signature / date`, 14 + sigWidth + 20, y + 4)

  drawFooter(doc, `${company?.name || 'Fieldhorse'} · Proposal ${number}`)

  return {
    doc,
    filename: `Proposal_${number}_${(contact?.name || 'client').replace(/\s+/g, '_')}.pdf`,
    number
  }
}

/**
 * Utility: save a jsPDF doc from the result of generate* functions.
 * Triggers the browser download.
 */
export function downloadPdf(result) {
  if (!result?.doc) return
  result.doc.save(result.filename)
}
