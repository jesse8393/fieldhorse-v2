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

/* ============================================================
   PROPOSAL PDF — Phase 4D-1 redesign (premium 4-page proposal).

   Pages:
     1. Cover                — number + date eyebrow, company wordmark,
                               PREPARED FOR / PROJECT hero, tinted band
                               with valid-through line.
     2. Project + Scope      — PREPARED FOR / PREPARED BY two-column,
                               THE WORK section, scope_text body.
     3. Investment           — THE INVESTMENT title, 40mm ONYX hero
                               band with 40pt FIELD_GOLD money, base
                               line items table (Item / Qty / Amount —
                               Rate dropped from customer view), optional
                               add-ons table when present.
     4. Terms · Acceptance   — INCLUDED / EXCLUDED two-column (no red,
                               gold/muted only), PAYMENT TERMS body,
                               READY TO START? + acceptance paragraph,
                               two large signature blocks.

   Reuses the existing brand tokens. Helvetica only — custom font
   embedding, logo image, project photos, and the approval stamp are
   intentionally deferred to 4D-2/3/4 and resumed-4C-3.

   downloadPdf() and generateInvoice() are untouched.
============================================================ */

const PROPOSAL_BRAND = {
  marginX: 18,
  pageTopBody: 30,
  pageBottomGuard: 22,
  bandTopGold: 8,
  bandBottomGold: 8,
  // Pages 2+ header strip
  headerStripGold: 1.2,
  headerStripBaseline: 18,
  // Body line-height multiplier for prose at 11pt
  proseLineHeight: 5.5,
  // Hero price band
  heroBandHeight: 40,
  heroMoneySize: 40,
  // Section title sizes
  sectionH2: 18,
  sectionH3: 16,
  // Body sizes
  bodySize: 11,
  acceptSize: 12,
  tableBodySize: 10,
  // Eyebrow
  eyebrowSize: 8.5,
  // Footer
  footerSize: 8,
  // Signature underline
  sigUnderlineWeight: 0.6,
  sigUnderlineWidth: 60,
  sigUnderlineGap: 18,
  // Chapter rule
  chapterRuleWeight: 0.4
}

/**
 * Generate a premium proposal PDF from fh_quote_items + the customer-
 * facing prose blocks on fh_contacts.
 *
 * Single-price line items. is_optional rows render in their own table
 * on page 3 tagged "not included in the quoted price." is_excluded
 * rows render as a bullet list in the EXCLUDED column on page 4.
 *
 * @param {object} opts
 * @param {object} opts.company     { name, address, phone, email }
 * @param {object} opts.contact     { id, name, address, phone, email, job_title }
 * @param {Array}  opts.items       fh_quote_items rows
 * @param {string} opts.scope       scope_text (prose)
 * @param {string} opts.terms       terms_text (payment terms prose)
 * @param {string} opts.exclusions  exclusions_text (out-of-scope prose)
 * @param {string} opts.expiresAt   quote_expires_at ISO timestamp (or null)
 * @param {string} opts.status      proposal_status (accepted; not yet
 *                                  rendered — reserved for 4C-3 stamp)
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
  const ctx = buildProposalCtx({
    doc, company, contact, items, scope, terms, exclusions, expiresAt, quoteId
  })

  // === PAGE 1 — COVER (no header strip, no footer band) ===
  drawCoverPage(doc, ctx)

  // === PAGE 2 — PROJECT + SCOPE ===
  doc.addPage()
  drawPageHeaderStrip(doc, ctx)
  drawProjectAndScopePage(doc, ctx)

  // === PAGE 3 — INVESTMENT ===
  doc.addPage()
  drawPageHeaderStrip(doc, ctx)
  drawInvestmentPage(doc, ctx)

  // === PAGE 4 — TERMS · ACCEPTANCE ===
  doc.addPage()
  drawPageHeaderStrip(doc, ctx)
  drawTermsAndAcceptancePage(doc, ctx)

  // Final pass — total page count + footer on every page except the cover.
  const total = doc.internal.getNumberOfPages()
  for (let p = 2; p <= total; p++) {
    doc.setPage(p)
    drawProposalPageFooter(doc, ctx, p, total)
  }

  return {
    doc,
    filename: `Quote_${ctx.number}_${(contact?.name || 'client').replace(/\s+/g, '_')}.pdf`,
    number: ctx.number
  }
}

/* ============================================================
   buildProposalCtx — computes the immutable render context once.
   Carries pageWidth/Height, brand spacing, derived items / totals,
   resolved fallback strings, and the formatted number/date.
   ============================================================ */
function buildProposalCtx({
  doc, company, contact, items, scope, terms, exclusions, expiresAt, quoteId
}) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const number = invoiceNumber(quoteId || contact?.id).replace('FH-', 'FH-Q')

  const sorted = [...(items || [])].sort((a, b) => {
    const ao = Number(a?.sort_order ?? 0)
    const bo = Number(b?.sort_order ?? 0)
    if (ao !== bo) return ao - bo
    const ac = a?.created_at ? new Date(a.created_at).getTime() : 0
    const bc = b?.created_at ? new Date(b.created_at).getTime() : 0
    return ac - bc
  })
  const baseItems = sorted.filter((i) => !i.is_excluded && !i.is_optional)
  const optionalItems = sorted.filter((i) => !i.is_excluded && i.is_optional)
  const excludedItems = sorted.filter((i) => i.is_excluded)
  const baseTotal = baseItems.reduce((s, i) => s + Number(i.amount || 0), 0)
  const optionalTotal = optionalItems.reduce((s, i) => s + Number(i.amount || 0), 0)

  return {
    company,
    contact,
    pageWidth,
    pageHeight,
    margin: PROPOSAL_BRAND.marginX,
    contentWidth: pageWidth - PROPOSAL_BRAND.marginX * 2,
    number,
    date: today(),
    longDate: formatLongDate(new Date()),
    expiresAt,
    expiresAtLong: expiresAt ? formatLongDate(new Date(expiresAt)) : '',
    expiresAtIsExpired: expiresAt ? new Date(expiresAt).getTime() < Date.now() : false,
    scope: scope && scope.trim() ? scope.trim() : '',
    terms: terms && terms.trim() ? terms.trim() : '',
    exclusions: exclusions && exclusions.trim() ? exclusions.trim() : '',
    baseItems,
    optionalItems,
    excludedItems,
    baseTotal,
    optionalTotal,
    companyName: company?.name || 'My Company'
  }
}

function formatLongDate(d) {
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

/* ============================================================
   PAGE 1 — COVER
   ============================================================ */
function drawCoverPage(doc, ctx) {
  const { pageWidth, pageHeight, margin, companyName, contact } = ctx

  // Top + bottom full-bleed gold bars
  doc.setFillColor(...FIELD_GOLD)
  doc.rect(0, 0, pageWidth, PROPOSAL_BRAND.bandTopGold, 'F')
  doc.rect(0, pageHeight - PROPOSAL_BRAND.bandBottomGold, pageWidth, PROPOSAL_BRAND.bandBottomGold, 'F')

  // Eyebrow line — number + date in micro-caps, centered
  const eyebrow = `PROPOSAL · NO. ${ctx.number} · ${ctx.longDate.toUpperCase()}`
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(PROPOSAL_BRAND.eyebrowSize)
  doc.setTextColor(...INK_MUTED)
  doc.setCharSpace(0.5)
  doc.text(eyebrow, pageWidth / 2, 24, { align: 'center' })
  doc.setCharSpace(0)

  // Company wordmark — fit-to-width cascade so long company names
  // don't overflow the page edge. 28pt single line is the default;
  // falls back to 22pt single, then 22pt wrapped to 2 lines max.
  // Block midpoint stays anchored near y=70 so the contact line and
  // the customer hero below never need to budge in tandem.
  const wmText = (companyName || 'My Company').toUpperCase()
  const wmAvail = pageWidth - margin * 2
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...ONYX)

  doc.setFontSize(28)
  let wmFontSize = 28
  let wmLines = [wmText]
  if (doc.getTextWidth(wmText) > wmAvail) {
    doc.setFontSize(22)
    wmFontSize = 22
    if (doc.getTextWidth(wmText) > wmAvail) {
      // Wrap at 22pt; cap at 2 lines so the cover never grows tall
      wmLines = doc.splitTextToSize(wmText, wmAvail).slice(0, 2)
    }
  }
  doc.setFontSize(wmFontSize)

  // Line height ≈ 0.36× point size in mm. 1-line block: baseline at
  // y=70. 2-line block: baselines spaced lineGap apart, midpoint at 70.
  const wmLineGap = wmFontSize * 0.36
  const wmStartY = 70 - ((wmLines.length - 1) * wmLineGap) / 2
  for (let i = 0; i < wmLines.length; i++) {
    doc.text(wmLines[i], pageWidth / 2, wmStartY + i * wmLineGap, { align: 'center' })
  }
  const wmEndY = wmStartY + (wmLines.length - 1) * wmLineGap

  // Company contact line under the wordmark — sits 10mm below the
  // last wordmark baseline regardless of how many lines rendered.
  const contactLine = [company0(ctx, 'phone'), company0(ctx, 'email')].filter(Boolean).join(' · ')
  if (contactLine) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK_MUTED)
    doc.text(contactLine, pageWidth / 2, wmEndY + 10, { align: 'center' })
  }

  // Vertical-center hero — PREPARED FOR + customer + PROJECT + title
  let y = 130
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(PROPOSAL_BRAND.eyebrowSize)
  doc.setTextColor(...INK_MUTED)
  doc.setCharSpace(0.5)
  doc.text('PREPARED FOR', pageWidth / 2, y, { align: 'center' })
  doc.setCharSpace(0)
  y += 7
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...ONYX)
  doc.text(contact?.name || 'Valued Client', pageWidth / 2, y, { align: 'center' })

  if (contact?.job_title) {
    y += 14
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(PROPOSAL_BRAND.eyebrowSize)
    doc.setTextColor(...INK_MUTED)
    doc.setCharSpace(0.5)
    doc.text('PROJECT', pageWidth / 2, y, { align: 'center' })
    doc.setCharSpace(0)
    y += 10
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(32)
    doc.setTextColor(...ONYX)
    const titleWrapped = doc.splitTextToSize(contact.job_title, pageWidth - margin * 2 - 10)
    const titleLines = titleWrapped.slice(0, 2)
    doc.text(titleLines, pageWidth / 2, y, { align: 'center' })
  }

  // Bottom band — RAW_LINEN tint with valid-through + address
  const bandTop = pageHeight - PROPOSAL_BRAND.bandBottomGold - 60
  doc.setFillColor(...RAW_LINEN)
  doc.rect(0, bandTop, pageWidth, 60, 'F')
  // Inner gold rule at top of band
  doc.setDrawColor(...FIELD_GOLD)
  doc.setLineWidth(PROPOSAL_BRAND.chapterRuleWeight)
  doc.line(margin + 12, bandTop + 12, pageWidth - margin - 12, bandTop + 12)

  // Valid-through line
  if (ctx.expiresAtLong) {
    if (ctx.expiresAtIsExpired) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(PROPOSAL_BRAND.eyebrowSize)
      doc.setTextColor(...ALERT_RED)
      doc.setCharSpace(0.5)
      doc.text('EXPIRED', pageWidth / 2, bandTop + 24, { align: 'center' })
      doc.setCharSpace(0)
    } else {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(PROPOSAL_BRAND.eyebrowSize)
      doc.setTextColor(...INK_MUTED)
      doc.setCharSpace(0.5)
      doc.text('VALID THROUGH', pageWidth / 2, bandTop + 22, { align: 'center' })
      doc.setCharSpace(0)
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(11)
      doc.setTextColor(...ONYX)
      doc.text(ctx.expiresAtLong, pageWidth / 2, bandTop + 30, { align: 'center' })
    }
  }

  // Company address line
  if (ctx.company?.address) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK_MUTED)
    doc.text(ctx.company.address, pageWidth / 2, bandTop + 44, { align: 'center' })
  }
}

function company0(ctx, key) {
  const v = ctx?.company?.[key]
  return v && String(v).trim() ? String(v).trim() : ''
}

/* ============================================================
   Pages 2+ — header strip
   ============================================================ */
function drawPageHeaderStrip(doc, ctx) {
  const { pageWidth, margin } = ctx
  // Thin gold rule across the top
  doc.setDrawColor(...FIELD_GOLD)
  doc.setLineWidth(PROPOSAL_BRAND.headerStripGold)
  doc.line(0, 6, pageWidth, 6)

  // Left meta — proposal number
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(PROPOSAL_BRAND.eyebrowSize)
  doc.setTextColor(...INK_MUTED)
  doc.setCharSpace(0.5)
  doc.text(`PROPOSAL · NO. ${ctx.number}`, margin, PROPOSAL_BRAND.headerStripBaseline)
  // Right meta — company name (filled in real footer; here keep silent so
  // page-of-N count lands at the bottom only)
  doc.text((ctx.companyName || '').toUpperCase(), pageWidth - margin, PROPOSAL_BRAND.headerStripBaseline, { align: 'right' })
  doc.setCharSpace(0)
}

function drawProposalPageFooter(doc, ctx, pageNumber, totalPages) {
  const { pageWidth, pageHeight, margin } = ctx
  doc.setDrawColor(220, 215, 205)
  doc.setLineWidth(0.2)
  doc.line(margin, pageHeight - 14, pageWidth - margin, pageHeight - 14)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(PROPOSAL_BRAND.footerSize)
  doc.setTextColor(...INK_MUTED)
  const left = [ctx.companyName, company0(ctx, 'phone'), company0(ctx, 'email')]
    .filter(Boolean)
    .join(' · ')
  if (left) doc.text(left, margin, pageHeight - 8)
  doc.text(`Page ${pageNumber - 1} of ${totalPages - 1}`, pageWidth - margin, pageHeight - 8, { align: 'right' })
}

function drawSectionTitle(doc, x, y, label, size = PROPOSAL_BRAND.sectionH2) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(size)
  doc.setTextColor(...ONYX)
  doc.text(label, x, y)
  return y + size * 0.45 + 8
}

function drawEyebrow(doc, x, y, label, color = INK_MUTED, opts = {}) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(PROPOSAL_BRAND.eyebrowSize)
  doc.setTextColor(...color)
  doc.setCharSpace(0.5)
  doc.text(label, x, y, opts)
  doc.setCharSpace(0)
  return y + 5
}

function drawChapterRule(doc, ctx, y) {
  doc.setDrawColor(...FIELD_GOLD)
  doc.setLineWidth(PROPOSAL_BRAND.chapterRuleWeight)
  doc.line(ctx.margin, y, ctx.pageWidth - ctx.margin, y)
  return y + 8
}

/* ============================================================
   PAGE 2 — Project + Scope
   ============================================================ */
function drawProjectAndScopePage(doc, ctx) {
  const { contact, company, margin, contentWidth } = ctx
  let y = PROPOSAL_BRAND.pageTopBody

  // PREPARED FOR / PREPARED BY two-column block
  const colWidth = (contentWidth - 12) / 2
  const leftX = margin
  const rightX = margin + colWidth + 12
  const dividerX = margin + colWidth + 6

  drawEyebrow(doc, leftX, y, 'PREPARED FOR')
  drawEyebrow(doc, rightX, y, 'PREPARED BY')

  let yL = y + 7
  let yR = y + 7

  // Left column
  yL = drawPartyBlock(doc, leftX, yL, {
    name: contact?.name || 'Valued Client',
    address: contact?.address,
    phone: contact?.phone,
    email: contact?.email
  }, colWidth)

  // Right column
  yR = drawPartyBlock(doc, rightX, yR, {
    name: company?.name || 'My Company',
    address: company?.address,
    phone: company?.phone,
    email: company?.email
  }, colWidth)

  const blockBottom = Math.max(yL, yR)

  // Vertical gold divider between cols (drawn from top of names down to
  // the longer column's bottom)
  doc.setDrawColor(...FIELD_GOLD)
  doc.setLineWidth(PROPOSAL_BRAND.chapterRuleWeight)
  doc.line(dividerX, y + 7, dividerX, blockBottom - 4)

  y = blockBottom + 6
  y = drawChapterRule(doc, ctx, y)

  // THE WORK
  y = drawSectionTitle(doc, margin, y + 6, 'THE WORK')

  // Scope body (or fallback)
  const scopeBody = ctx.scope ||
    "We'll cover the full scope of this project as described in the line items on the next page."
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(PROPOSAL_BRAND.bodySize)
  doc.setTextColor(...ONYX)
  const wrapped = doc.splitTextToSize(scopeBody, contentWidth)
  // Page-aware multi-line (auto-flow if scope is huge)
  for (const line of wrapped) {
    if (y > ctx.pageHeight - PROPOSAL_BRAND.pageBottomGuard) {
      doc.addPage()
      drawPageHeaderStrip(doc, ctx)
      y = PROPOSAL_BRAND.pageTopBody
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(PROPOSAL_BRAND.bodySize)
      doc.setTextColor(...ONYX)
    }
    doc.text(line, margin, y)
    y += PROPOSAL_BRAND.proseLineHeight
  }
}

function drawPartyBlock(doc, x, y, party, width) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...ONYX)
  const nameLines = doc.splitTextToSize(party.name || '—', width - 4)
  doc.text(nameLines, x, y)
  y += nameLines.length * 5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK_MUTED)
  for (const line of [party.address, party.phone, party.email].filter(Boolean)) {
    const wrapped = doc.splitTextToSize(line, width - 4)
    doc.text(wrapped, x, y)
    y += wrapped.length * 4.6
  }
  return y
}

/* ============================================================
   PAGE 3 — Investment
   ============================================================ */
function drawInvestmentPage(doc, ctx) {
  const { margin, pageWidth, contentWidth } = ctx
  let y = PROPOSAL_BRAND.pageTopBody

  y = drawSectionTitle(doc, margin, y, 'THE INVESTMENT')
  y += 4

  // Hero price band
  drawHeroPriceBand(doc, y, ctx)
  y += PROPOSAL_BRAND.heroBandHeight + 8

  // Base line items table
  if (ctx.baseItems.length > 0) {
    drawProposalItemsTable(doc, y, ctx, ctx.baseItems, { isOptional: false })
    y = doc.lastAutoTable.finalY + 10
  }

  // Optional add-ons
  if (ctx.optionalItems.length > 0) {
    // Chapter break
    if (y + 60 > ctx.pageHeight - PROPOSAL_BRAND.pageBottomGuard) {
      doc.addPage()
      drawPageHeaderStrip(doc, ctx)
      y = PROPOSAL_BRAND.pageTopBody
    } else {
      y = drawChapterRule(doc, ctx, y)
    }
    drawEyebrow(doc, margin, y, 'OPTIONAL ADD-ONS', FIELD_GOLD)
    y += 6
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...INK_MUTED)
    doc.text('Listed for reference. Not included in the quoted price.', margin, y)
    y += 5
    drawProposalItemsTable(doc, y, ctx, ctx.optionalItems, { isOptional: true })
    y = doc.lastAutoTable.finalY + 8
  }
}

function drawHeroPriceBand(doc, y, ctx) {
  const { margin, contentWidth, pageWidth } = ctx
  doc.setFillColor(...ONYX)
  doc.rect(margin, y, contentWidth, PROPOSAL_BRAND.heroBandHeight, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(PROPOSAL_BRAND.eyebrowSize)
  doc.setTextColor(...FIELD_GOLD)
  doc.setCharSpace(0.5)
  doc.text('QUOTED PRICE', margin + 8, y + 11)
  doc.setCharSpace(0)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(PROPOSAL_BRAND.heroMoneySize)
  doc.setTextColor(...FIELD_GOLD)
  doc.text(money(ctx.baseTotal), margin + 8, y + 30)

  if (ctx.optionalTotal > 0) {
    doc.setFont('helvetica', 'italic')
    doc.setFontSize(8.5)
    doc.setTextColor(...RAW_LINEN)
    doc.text(
      `Optional add-ons available · ${money(ctx.optionalTotal)}`,
      pageWidth - margin - 8,
      y + PROPOSAL_BRAND.heroBandHeight - 6,
      { align: 'right' }
    )
  }
}

function drawProposalItemsTable(doc, startY, ctx, items, { isOptional }) {
  // Build the body rows. When the section name changes between rows,
  // emit a section divider row before the item row. Description and
  // notes are stacked inside the Item cell using \n-separated lines.
  const body = []
  let lastSection = null
  for (const i of items) {
    const sec = (i.section || '').trim()
    if (sec && sec.toUpperCase() !== (lastSection || '').toUpperCase()) {
      body.push([{
        content: sec.toUpperCase(),
        colSpan: 3,
        styles: {
          fillColor: ONYX,
          textColor: FIELD_GOLD,
          fontStyle: 'bold',
          fontSize: 8.5,
          halign: 'left',
          cellPadding: { top: 2.5, right: 6, bottom: 2.5, left: 6 }
        }
      }])
      lastSection = sec
    } else if (!sec && lastSection !== null) {
      // Item without a section after a sectioned run — stop printing
      // section context (next section'd item will re-emit a divider).
      lastSection = null
    }

    const desc = (i.description || '').trim()
    const noteLine = i.notes && String(i.notes).trim() ? `(${String(i.notes).trim()})` : ''
    const itemCell = [desc, noteLine].filter(Boolean).join('\n')
    const qtyCell = `${formatProposalQty(i.qty)}${i.unit ? ' ' + i.unit : ''}`.trim()
    body.push([itemCell, qtyCell, money(i.amount)])
  }

  autoTable(doc, {
    startY,
    head: [['Item', 'Qty', 'Amount']],
    body,
    theme: 'plain',
    styles: {
      fontSize: PROPOSAL_BRAND.tableBodySize,
      cellPadding: { top: 4, right: 6, bottom: 4, left: 6 }
    },
    headStyles: {
      fillColor: ONYX,
      textColor: FIELD_GOLD,
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: { top: 3.5, right: 6, bottom: 3.5, left: 6 }
    },
    bodyStyles: {
      textColor: ONYX,
      lineWidth: 0
    },
    alternateRowStyles: {
      fillColor: RAW_LINEN
    },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 26 },
      2: { halign: 'right', cellWidth: 32, fontStyle: 'bold' }
    },
    margin: { left: ctx.margin, right: ctx.margin },
    didDrawPage: () => {
      // autoTable redraws head on each new page; ensure the page header
      // strip lands on every spilled page too.
      const pageNumber = doc.internal.getCurrentPageInfo().pageNumber
      if (pageNumber !== 1) drawPageHeaderStrip(doc, ctx)
    }
  })
}

function formatProposalQty(n) {
  const num = Number(n || 0)
  if (!Number.isFinite(num)) return '—'
  return Number.isInteger(num) ? String(num) : num.toFixed(2)
}

/* ============================================================
   PAGE 4 — Terms · Exclusions · Acceptance
   ============================================================ */
function drawTermsAndAcceptancePage(doc, ctx) {
  const { margin, pageWidth, contentWidth } = ctx
  let y = PROPOSAL_BRAND.pageTopBody

  // Dual-column INCLUDED · EXCLUDED
  const hasExcluded = ctx.exclusions || ctx.excludedItems.length > 0

  y = drawSectionTitle(doc, margin, y, hasExcluded ? "WHAT'S INCLUDED · WHAT'S EXCLUDED" : "WHAT'S INCLUDED", PROPOSAL_BRAND.sectionH3)
  y += 4

  if (hasExcluded) {
    // 60/40 split
    const leftWidth = (contentWidth - 12) * 0.6
    const rightWidth = (contentWidth - 12) * 0.4
    const leftX = margin
    const rightX = margin + leftWidth + 12
    const dividerX = margin + leftWidth + 6

    drawEyebrow(doc, leftX, y, 'INCLUDED')
    drawEyebrow(doc, rightX, y, 'EXCLUDED')
    let yL = y + 7
    let yR = y + 7

    // Left — short summary of what's included
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(PROPOSAL_BRAND.bodySize)
    doc.setTextColor(...ONYX)
    const includedText = "All work and materials described in The Work on Page 2 and itemized in the line items on Page 3."
    const incWrapped = doc.splitTextToSize(includedText, leftWidth - 4)
    doc.text(incWrapped, leftX, yL)
    yL += incWrapped.length * PROPOSAL_BRAND.proseLineHeight

    // Right — exclusions prose + structured items
    if (ctx.exclusions) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(...ONYX)
      const exWrapped = doc.splitTextToSize(ctx.exclusions, rightWidth - 4)
      doc.text(exWrapped, rightX, yR)
      yR += exWrapped.length * 4.8 + 4
    }
    if (ctx.excludedItems.length > 0) {
      if (ctx.exclusions) {
        // Small visual gap between prose and bullet list
        yR += 1
      }
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      doc.setTextColor(...ONYX)
      for (const i of ctx.excludedItems) {
        const line = `• ${i.description || '—'}`
        const wrapped = doc.splitTextToSize(line, rightWidth - 4)
        doc.text(wrapped, rightX, yR)
        yR += wrapped.length * 4.6
      }
    }

    const blockBottom = Math.max(yL, yR)

    // Vertical gold divider
    doc.setDrawColor(...FIELD_GOLD)
    doc.setLineWidth(PROPOSAL_BRAND.chapterRuleWeight)
    doc.line(dividerX, y + 7, dividerX, blockBottom - 2)

    y = blockBottom + 6
  } else {
    // Single column — INCLUDED only
    drawEyebrow(doc, margin, y, 'INCLUDED')
    let yC = y + 7
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(PROPOSAL_BRAND.bodySize)
    doc.setTextColor(...ONYX)
    const includedText = "All work and materials described in The Work on Page 2 and itemized in the line items on Page 3."
    const incWrapped = doc.splitTextToSize(includedText, contentWidth)
    doc.text(incWrapped, margin, yC)
    yC += incWrapped.length * PROPOSAL_BRAND.proseLineHeight
    y = yC + 6
  }

  y = drawChapterRule(doc, ctx, y)

  // PAYMENT TERMS
  y = drawSectionTitle(doc, margin, y + 4, 'PAYMENT TERMS', PROPOSAL_BRAND.sectionH3)
  const termsBody = ctx.terms ||
    "Standard payment terms apply. Deposit due on signing, balance on completion. Workmanship warranty per local code. Change orders priced and signed before any out-of-scope work proceeds."
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(PROPOSAL_BRAND.bodySize)
  doc.setTextColor(...ONYX)
  const termsWrapped = doc.splitTextToSize(termsBody, contentWidth)
  doc.text(termsWrapped, margin, y)
  y += termsWrapped.length * PROPOSAL_BRAND.proseLineHeight + 10

  // READY TO START? + acceptance + signatures — keep block together
  const acceptanceBlockHeight = 60
  if (y + acceptanceBlockHeight > ctx.pageHeight - PROPOSAL_BRAND.pageBottomGuard) {
    doc.addPage()
    drawPageHeaderStrip(doc, ctx)
    y = PROPOSAL_BRAND.pageTopBody
  }

  y = drawSectionTitle(doc, margin, y, 'READY TO START?', PROPOSAL_BRAND.sectionH3)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(PROPOSAL_BRAND.acceptSize)
  doc.setTextColor(...ONYX)
  const acceptText = `Sign below to authorize ${ctx.companyName} to begin work under the scope and terms above. Change orders priced and signed before any out-of-scope work proceeds.`
  const acceptWrapped = doc.splitTextToSize(acceptText, contentWidth)
  doc.text(acceptWrapped, margin, y)
  y += acceptWrapped.length * 5.6 + 16

  drawSignatureBlock(doc, ctx, y)
}

function drawSignatureBlock(doc, ctx, y) {
  const { margin, pageWidth } = ctx
  const each = PROPOSAL_BRAND.sigUnderlineWidth
  const gap = PROPOSAL_BRAND.sigUnderlineGap
  const totalWidth = each * 2 + gap
  const startX = margin + (ctx.contentWidth - totalWidth) / 2

  doc.setDrawColor(...ONYX)
  doc.setLineWidth(PROPOSAL_BRAND.sigUnderlineWeight)
  doc.line(startX, y, startX + each, y)
  doc.line(startX + each + gap, y, startX + each * 2 + gap, y)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...INK_MUTED)
  doc.text('Customer signature & date', startX, y + 5)
  doc.text(
    `${ctx.companyName} signature & date`,
    startX + each + gap,
    y + 5
  )
}

/**
 * Utility: save a jsPDF doc from the result of generate* functions.
 * Triggers the browser download.
 */
export function downloadPdf(result) {
  if (!result?.doc) return
  result.doc.save(result.filename)
}
