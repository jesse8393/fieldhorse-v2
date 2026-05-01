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
 * Generate a sendable quote / proposal PDF from fh_quote_items + the
 * customer-facing prose blocks on fh_contacts (Phase 4B-1 columns:
 * scope_text / terms_text / exclusions_text / quote_expires_at).
 *
 * Single-price model — one rate per line, totals come straight from
 * the live items. is_optional rows render in their own table tagged
 * "not included in base total"; is_excluded rows render in the
 * Exclusions section as a structured tail under any prose.
 *
 * @param {object} opts
 * @param {object} opts.company     { name, address, phone, email }
 * @param {object} opts.contact     { id, name, address, phone, email, job_title }
 * @param {Array}  opts.items       fh_quote_items rows
 *                                  [{ section, description, qty, unit, rate,
 *                                     amount, notes, is_optional, is_excluded,
 *                                     sort_order }]
 * @param {string} opts.scope       scope_text (prose)
 * @param {string} opts.terms       terms_text (payment terms prose)
 * @param {string} opts.exclusions  exclusions_text (out-of-scope prose)
 * @param {string} opts.expiresAt   quote_expires_at ISO timestamp (or null)
 * @param {string} opts.status      proposal_status (display only — number /
 *                                  filename do not change with status)
 * @param {string} opts.quoteId     contact id for number fingerprinting
 * @returns {{ doc: jsPDF, filename: string, number: string }}
 */
export function generateQuote({
  company = {},
  contact = {},
  items = [],
  scope = '',
  terms = '',
  exclusions = '',
  expiresAt = null,
  status = 'draft', // eslint-disable-line no-unused-vars
  quoteId
} = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const number = invoiceNumber(quoteId || contact?.id).replace('FH-', 'FH-Q')

  // Bucket items once. is_excluded wins over is_optional if both flags
  // are accidentally set (defense-in-depth — UI mutual-exclusion already
  // prevents this in QuoteItems.jsx).
  const sortedItems = [...items].sort((a, b) => {
    const ao = Number(a?.sort_order ?? 0)
    const bo = Number(b?.sort_order ?? 0)
    return ao - bo
  })
  const baseItems = sortedItems.filter((i) => !i.is_excluded && !i.is_optional)
  const optionalItems = sortedItems.filter((i) => !i.is_excluded && i.is_optional)
  const excludedItems = sortedItems.filter((i) => i.is_excluded)

  const baseTotal = baseItems.reduce((s, i) => s + Number(i.amount || 0), 0)
  const optionalTotal = optionalItems.reduce((s, i) => s + Number(i.amount || 0), 0)

  // Page-break helper — checks remaining vertical room and starts a
  // new page if not enough. Returns the next y to use.
  function ensureRoom(y, needed) {
    if (y + needed > pageHeight - 22) {
      doc.addPage()
      return 20
    }
    return y
  }

  let y = drawHeader(doc, {
    company,
    documentType: 'Quote',
    documentNumber: number,
    date: today()
  })

  y = drawBillTo(doc, y, contact)

  // Project + expiration line
  if (contact?.job_title || expiresAt) {
    if (contact?.job_title) {
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
      y += jobWrapped.length * 6 + 2
    }
    if (expiresAt) {
      const expDate = new Date(expiresAt)
      const expValid = !Number.isNaN(expDate.getTime())
      if (expValid) {
        const isExpired = expDate.getTime() < Date.now()
        doc.setFont('helvetica', 'bold')
        doc.setFontSize(8)
        doc.setTextColor(...(isExpired ? ALERT_RED : INK_MUTED))
        doc.text(isExpired ? 'EXPIRED' : 'VALID THROUGH', 14, y + 2)
        doc.setFont('helvetica', 'normal')
        doc.setFontSize(10)
        doc.setTextColor(...(isExpired ? ALERT_RED : ONYX))
        doc.text(
          expDate.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' }),
          50,
          y + 2
        )
        y += 8
      }
    }
    y += 4
  }

  // Scope of work
  if (scope) {
    y = ensureRoom(y, 24)
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

  // Base line items table — Section / Description / Qty / Rate / Amount.
  // autoTable handles row-level pagination automatically.
  if (baseItems.length > 0) {
    const rows = baseItems.map((i) => [
      i.section || '',
      [i.description || '', i.notes ? `(${i.notes})` : ''].filter(Boolean).join('\n'),
      `${formatQty(i.qty)}${i.unit ? ' ' + i.unit : ''}`,
      money(i.rate),
      money(i.amount)
    ])

    autoTable(doc, {
      startY: y,
      head: [['Section', 'Description', 'Qty', 'Rate', 'Amount']],
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
        0: { cellWidth: 26, fontStyle: 'bold', textColor: INK_MUTED },
        1: { cellWidth: 'auto' },
        2: { halign: 'right', cellWidth: 22 },
        3: { halign: 'right', cellWidth: 26 },
        4: { halign: 'right', cellWidth: 28, fontStyle: 'bold' }
      },
      margin: { left: 14, right: 14 }
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // Total band — gold number on ONYX.
  y = ensureRoom(y, 32)
  doc.setFillColor(...ONYX)
  doc.rect(14, y, pageWidth - 28, 28, 'F')
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...FIELD_GOLD)
  doc.text('QUOTED PRICE', 20, y + 8)

  doc.setFontSize(26)
  doc.text(money(baseTotal), 20, y + 22)

  if (optionalTotal > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...RAW_LINEN)
    doc.text(
      `Optional add-ons available: ${money(optionalTotal)}`,
      pageWidth - 20,
      y + 22,
      { align: 'right' }
    )
  }
  y += 36

  // Optional add-ons table.
  if (optionalItems.length > 0) {
    y = ensureRoom(y, 28)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...FIELD_GOLD)
    doc.text('OPTIONAL ADD-ONS', 14, y)
    y += 5
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8)
    doc.setTextColor(...INK_MUTED)
    doc.text('Listed for reference. Not included in the quoted price above.', 14, y)
    y += 4

    const rows = optionalItems.map((i) => [
      i.section || '',
      [i.description || '', i.notes ? `(${i.notes})` : ''].filter(Boolean).join('\n'),
      `${formatQty(i.qty)}${i.unit ? ' ' + i.unit : ''}`,
      money(i.rate),
      money(i.amount)
    ])

    autoTable(doc, {
      startY: y,
      head: [['Section', 'Add-on', 'Qty', 'Rate', 'Amount']],
      body: rows,
      theme: 'plain',
      headStyles: {
        fillColor: [60, 60, 60],
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
        0: { cellWidth: 26, fontStyle: 'bold', textColor: INK_MUTED },
        1: { cellWidth: 'auto' },
        2: { halign: 'right', cellWidth: 22 },
        3: { halign: 'right', cellWidth: 26 },
        4: { halign: 'right', cellWidth: 28, fontStyle: 'bold' }
      },
      margin: { left: 14, right: 14 }
    })
    y = doc.lastAutoTable.finalY + 8
  }

  // Exclusions — prose first, structured excluded items as a tail.
  if (exclusions || excludedItems.length > 0) {
    y = ensureRoom(y, 24)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...ALERT_RED)
    doc.text('EXCLUSIONS', 14, y)
    y += 5

    if (exclusions) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9.5)
      doc.setTextColor(...ONYX)
      const wrapped = doc.splitTextToSize(exclusions, pageWidth - 28)
      doc.text(wrapped, 14, y)
      y += wrapped.length * 4.8 + 4
    }

    if (excludedItems.length > 0) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(8.5)
      doc.setTextColor(...INK_MUTED)
      doc.text('Specifically excluded:', 14, y)
      y += 4
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...ONYX)
      excludedItems.forEach((i) => {
        const line = `• ${i.description || '—'}`
        const wrapped = doc.splitTextToSize(line, pageWidth - 28)
        y = ensureRoom(y, wrapped.length * 4.4 + 2)
        doc.text(wrapped, 14, y)
        y += wrapped.length * 4.4 + 1
      })
    }
    y += 6
  }

  // Payment terms.
  if (terms) {
    y = ensureRoom(y, 24)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...INK_MUTED)
    doc.text('PAYMENT TERMS', 14, y)
    y += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...ONYX)
    const wrapped = doc.splitTextToSize(terms, pageWidth - 28)
    doc.text(wrapped, 14, y)
    y += wrapped.length * 4.8 + 8
  }

  // Acceptance + signature lines — keep the block together on one page.
  y = ensureRoom(y, 50)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...INK_MUTED)
  doc.text('ACCEPTANCE', 14, y)
  y += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...ONYX)
  const acceptText = `Signed acceptance of this quote authorizes ${company?.name || 'the contractor'} to begin work under the scope and terms above. Change orders will be priced and signed before any out-of-scope work proceeds.`
  const acceptWrapped = doc.splitTextToSize(acceptText, pageWidth - 28)
  doc.text(acceptWrapped, 14, y)
  y += acceptWrapped.length * 4.4 + 14

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

  drawFooter(doc, `${company?.name || 'Fieldhorse'} · Quote ${number}`)

  return {
    doc,
    filename: `Quote_${number}_${(contact?.name || 'client').replace(/\s+/g, '_')}.pdf`,
    number
  }
}

// Quantities render as integers when whole, two decimals otherwise.
// Operators carry mixed units (1 lot, 480 sf, 12.5 hr) and trailing
// .00 on whole counts looks cluttered.
function formatQty(n) {
  const num = Number(n || 0)
  if (!Number.isFinite(num)) return '—'
  return Number.isInteger(num) ? String(num) : num.toFixed(2)
}

/**
 * Utility: save a jsPDF doc from the result of generate* functions.
 * Triggers the browser download.
 */
export function downloadPdf(result) {
  if (!result?.doc) return
  result.doc.save(result.filename)
}
