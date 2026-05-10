// PDF generator — invoices and proposals.
//
// White-label: every customer-facing string, number, logo, color, and
// footer pulls from the contractor's profile (company_name, logo_url,
// brand_accent_hex, license_number, etc.). The PDF must read like the
// contractor's own document. The internal app's name does not appear
// anywhere on the rendered output.

// Named import works in both Vite (browser) and Node ESM. jsPDF's
// CJS module exposes the constructor as a named export; the default-
// export form only resolves through bundler interop. Using the named
// form lets headless QA scripts (scripts/qa-render-proposal.mjs)
// render the same code path the browser uses.
import { jsPDF } from 'jspdf'
import autoTable from 'jspdf-autotable'
import { loadLogoForPdf, loadImageForPdf } from './pdfLogo.js'

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

/**
 * Derive a 2-3 letter document-number prefix from the contractor's
 * company name. "Parker Construction Company" → "PCC". "Acme Roofing"
 * → "AR". Single-word or unparseable → fallback.
 *
 * Skip-words ("the", "of", "and", "&", "a", "an") are ignored so the
 * prefix lands on the actual brand initials.
 */
function deriveCompanyPrefix(companyName, fallback) {
  if (!companyName || !String(companyName).trim()) return fallback
  const skip = new Set(['the', 'of', 'and', '&', 'a', 'an'])
  const initials = String(companyName)
    .trim()
    .split(/\s+/)
    .filter((w) => w && !skip.has(w.toLowerCase()))
    .map((w) => w[0])
    .filter(Boolean)
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 3)
  return initials.length >= 2 ? initials : fallback
}

/**
 * Build a document number "{PREFIX}-{YYMM}-{4CHAR}". Prefix derives from
 * the company name (or a neutral fallback like "INV" / "PROPOSAL" when
 * the name is missing or unparseable). Seed is the source row id so
 * repeat-renders produce stable numbers.
 *
 * NEVER prefixes with the app's name — that's why this function exists.
 */
function documentNumber(prefix, seed) {
  const d = new Date()
  const y = d.getFullYear().toString().slice(-2)
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const tail = seed ? String(seed).slice(-4).toUpperCase() : Math.random().toString(36).slice(2, 6).toUpperCase()
  return `${prefix}-${y}${m}-${tail}`
}

/**
 * Render a header on the current invoice page (4D-2D extended).
 * Logo or wordmark left, doc meta block right, brand-accent gold bar.
 *
 * @param {object} doc
 * @param {object} opts
 * @param {object} opts.company         { name, address, phone, email, website }
 * @param {string} opts.documentType    e.g. 'Invoice'
 * @param {string} opts.documentNumber
 * @param {string} opts.date
 * @param {object} [opts.logo]          { dataUrl, format, width, height } | null
 * @param {[number,number,number]} [opts.brandGold]  RGB tuple, defaults FIELD_GOLD
 * @param {string} [opts.trustLine]     pre-formatted micro-cap trust string
 */
function drawHeader(doc, {
  company,
  documentType,
  documentNumber,
  date,
  logo = null,
  brandGold = FIELD_GOLD,
  trustLine = ''
}) {
  const pageWidth = doc.internal.pageSize.getWidth()

  // Brand-accent bar across the top
  doc.setFillColor(...brandGold)
  doc.rect(0, 0, pageWidth, 4, 'F')

  // Company mark (left) — logo image when available, else wordmark text
  if (logo && logo.dataUrl && logo.width > 0 && logo.height > 0) {
    const maxW = 60
    const maxH = 22
    const aspect = logo.width / logo.height
    let w = maxW
    let h = w / aspect
    if (h > maxH) {
      h = maxH
      w = h * aspect
    }
    try {
      doc.addImage(logo.dataUrl, logo.format || 'PNG', 14, 8, w, h)
    } catch {
      drawInvoiceWordmark(doc, company)
    }
  } else {
    drawInvoiceWordmark(doc, company)
  }

  // Contact lines under the mark
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...INK_MUTED)
  let y = 33
  if (company?.address) { doc.text(company.address, 14, y); y += 4.5 }
  if (company?.phone)   { doc.text(company.phone, 14, y);   y += 4.5 }
  if (company?.email)   { doc.text(company.email, 14, y);   y += 4.5 }
  if (company?.website) { doc.text(company.website, 14, y); y += 4.5 }

  // Optional trust line — license + insured
  if (trustLine) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...INK_MUTED)
    doc.setCharSpace(0.4)
    doc.text(trustLine, 14, y + 0.5)
    doc.setCharSpace(0)
    y += 4.5
  }

  // Doc meta (right) — aligned right
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(10)
  doc.setTextColor(...brandGold)
  doc.text(documentType.toUpperCase(), pageWidth - 14, 20, { align: 'right' })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...ONYX)
  doc.text(`No. ${documentNumber}`, pageWidth - 14, 26, { align: 'right' })
  doc.setTextColor(...INK_MUTED)
  doc.text(date, pageWidth - 14, 30.5, { align: 'right' })

  // Header divider sits below the longest left column. Pin to a stable
  // y so the table below always starts at a predictable position even
  // when the contact block is thin.
  const dividerY = Math.max(46, y + 2)
  doc.setDrawColor(220, 215, 205)
  doc.setLineWidth(0.3)
  doc.line(14, dividerY, pageWidth - 14, dividerY)

  return dividerY + 6  // y cursor after header
}

function drawInvoiceWordmark(doc, company) {
  doc.setTextColor(...ONYX)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(24)
  doc.text((company?.name || 'My Company').toUpperCase(), 14, 22)
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

function drawFooter(doc, tagline = '') {
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
 * Generate a branded invoice PDF (4D-2D).
 *
 * @param {object} opts
 * @param {object} opts.company    { name, address, phone, email, website,
 *                                    logo_url, brand_accent_hex,
 *                                    license_number, insured_text }
 * @param {object} opts.contact    { name, address, phone, email }
 * @param {Array}  opts.lineItems  [{ description, qty, rate, amount }]
 * @param {number} opts.taxRate    decimal, e.g. 0.085
 * @param {string} opts.notes
 * @param {string} opts.dueDate    ISO or human string
 * @param {string} opts.invoiceId  (source id for fingerprinting; auto if omitted)
 * @returns {{ doc: jsPDF, filename: string, number: string }}
 */
export async function generateInvoice({
  company = {},
  contact = {},
  lineItems = [],
  taxRate = 0,
  notes = '',
  dueDate = '',
  invoiceId
} = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  // Derive the doc-number prefix from the contractor's company name.
  // Falls back to a neutral "INV" — never the app's name.
  const number = documentNumber(deriveCompanyPrefix(company?.name, 'INV'), invoiceId)

  // Pre-load the contractor's logo (4D-2B). Cached per session by the
  // helper. Returns null on missing URL / network failure / decode
  // failure / canvas taint — drawHeader falls through to the wordmark.
  const logo = company?.logo_url
    ? await loadLogoForPdf(company.logo_url, { maxDimension: 720 })
    : null

  // Brand accent — falls back to FIELD_GOLD when invalid or too light.
  // Same parser the proposal uses (4D-2C).
  const brandGold = parseBrandAccentRgb(company?.brand_accent_hex) || FIELD_GOLD

  // Trust line — license + insured. Each piece optional; whole line
  // suppressed when both blank.
  const trustParts = [
    company?.license_number ? `License #${String(company.license_number).trim()}` : '',
    company?.insured_text ? String(company.insured_text).trim() : ''
  ].filter(Boolean)
  const trustLine = trustParts.length > 0 ? trustParts.join(' · ').toUpperCase() : ''

  let y = drawHeader(doc, {
    company,
    documentType: 'Invoice',
    documentNumber: number,
    date: today(),
    logo,
    brandGold,
    trustLine
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
      textColor: brandGold,
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
  doc.setDrawColor(...brandGold)
  doc.setLineWidth(0.6)
  doc.line(labelX, afterTable, valueX, afterTable)
  afterTable += 7

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...ONYX)
  doc.text('TOTAL DUE', labelX, afterTable)
  doc.setTextColor(...brandGold)
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

  // Footer — contractor contact line ONLY. The app's name never
  // appears on the customer document.
  const footerLine = [
    company?.name,
    company?.phone,
    company?.email,
    company?.website
  ]
    .map((s) => (s && String(s).trim()) || '')
    .filter(Boolean)
    .join(' · ')
  drawFooter(doc, footerLine || (company?.name || ''))

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
 * Parse `profile.brand_accent_hex` and return an [r, g, b] tuple
 * suitable for jsPDF setFillColor / setDrawColor / setTextColor calls.
 *
 * Returns null when:
 *   - input isn't `#RRGGBB` shape
 *   - relative luminance > 0.6 (too light for chapter rules + 8mm cover
 *     bars drawn on white paper). The doc has many gold-on-white moments
 *     so we apply one threshold across the whole proposal — no split
 *     dark-vs-light surface palette in v1.
 *
 * Caller falls back to FIELD_GOLD on null.
 */
function parseBrandAccentRgb(hex) {
  if (!hex || typeof hex !== 'string') return null
  const m = hex.match(/^#([0-9a-fA-F]{6})$/)
  if (!m) return null
  const r = parseInt(m[1].slice(0, 2), 16)
  const g = parseInt(m[1].slice(2, 4), 16)
  const b = parseInt(m[1].slice(4, 6), 16)
  // WCAG relative luminance.
  const lin = (c) => {
    const s = c / 255
    return s <= 0.03928 ? s / 12.92 : Math.pow((s + 0.055) / 1.055, 2.4)
  }
  const L = 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b)
  if (L > 0.6) return null
  return [r, g, b]
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
 * @param {string} opts.status      proposal_status (accepted; not currently
 *                                  rendered — see opts.approval for the
 *                                  approval-stamped variant)
 * @param {string} opts.quoteId     contact id for number fingerprinting
 * @param {object} [opts.approval]  Phase 4C-3. When present, renders the
 *                                  approved-snapshot variant: a green
 *                                  APPROVED seal on the cover and a
 *                                  certificate block on the final page.
 *                                  Shape: { versionNumber, quoteNumber,
 *                                  method, approvedByName, approvedByEmail,
 *                                  approvalNote, baseTotal, approvedAt }
 * @returns {{ doc: jsPDF, filename: string, number: string }}
 */
export async function generateQuote({
  company = {},
  contact = {},
  items = [],
  scope = '',
  terms = '',
  exclusions = '',
  expiresAt = null,
  status = 'draft', // eslint-disable-line no-unused-vars
  quoteId,
  approval = null,
  photos = []
} = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })

  // Pre-load the contractor's logo + project photos in parallel. All
  // three loaders return null on failure so the page renderers can fall
  // through to graceful placeholders / wordmark — image fetch never
  // blocks PDF generation.
  const [logo, loadedPhotos] = await Promise.all([
    company?.logo_url
      ? loadLogoForPdf(company.logo_url, { maxDimension: 720 })
      : Promise.resolve(null),
    preloadProposalPhotos(photos)
  ])

  const ctx = buildProposalCtx({
    doc, company, contact, items, scope, terms, exclusions, expiresAt,
    quoteId, logo, approval, photos: loadedPhotos
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
/**
 * Preload a list of project photos into jsPDF-ready descriptors. Each
 * input entry can be a string (URL) or an object { url, section_tag,
 * caption }. Returns an array in the same order with { dataUrl, format,
 * width, height, section_tag, caption } | null. Null entries are
 * filtered downstream so a single bad URL never blocks the rest.
 */
async function preloadProposalPhotos(input) {
  if (!Array.isArray(input) || input.length === 0) return []
  const entries = input.map((p) => (typeof p === 'string' ? { url: p } : p)).filter((p) => p && p.url)
  // Cap at 8 photos to keep generated PDF size sane. Cover takes 1, up
  // to 7 scope sections benefit from one each. Excess gets dropped.
  const capped = entries.slice(0, 8)
  const loaded = await Promise.all(
    capped.map((p) => loadImageForPdf(p.url, { maxDimension: 1400 }).then((img) => ({
      img,
      section_tag: p.section_tag || null,
      caption: p.caption || null
    })))
  )
  return loaded
    .filter((entry) => entry.img)
    .map((entry) => ({ ...entry.img, section_tag: entry.section_tag, caption: entry.caption }))
}

function buildProposalCtx({
  doc, company, contact, items, scope, terms, exclusions, expiresAt,
  quoteId, logo, approval, photos = []
}) {
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  // Proposal number prefix derives from the contractor's company name,
  // not the app's name. "Parker Construction Company" → "PCC-2605-XXXX".
  // Neutral fallback "PROPOSAL" when the company name is missing.
  const number = documentNumber(
    deriveCompanyPrefix(company?.name, 'PROPOSAL'),
    quoteId || contact?.id
  )

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

  // Brand accent — use company.brand_accent_hex when valid + readable,
  // otherwise FIELD_GOLD. Single decision applies everywhere gold draws
  // (cover bars, chapter rules, hero label/money, table headers, etc).
  const brandGold = parseBrandAccentRgb(company?.brand_accent_hex) || FIELD_GOLD

  // Trust line for cover bottom band — license + insured. Each piece
  // optional; whole line suppressed when both are blank.
  const trustParts = [
    company?.license_number ? `License #${String(company.license_number).trim()}` : '',
    company?.insured_text ? String(company.insured_text).trim() : ''
  ].filter(Boolean)

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
    warranty: company?.warranty_default && String(company.warranty_default).trim()
      ? String(company.warranty_default).trim()
      : '',
    baseItems,
    optionalItems,
    excludedItems,
    baseTotal,
    optionalTotal,
    companyName: company?.name || 'My Company',
    logo: logo || null,
    brandGold,
    trustLine: trustParts.length > 0 ? trustParts.join(' · ').toUpperCase() : '',
    approval: approval && typeof approval === 'object' ? approval : null,
    photos: Array.isArray(photos) ? photos : [],
    proposalTitle: derivedProposalTitle(contact),
    sectionGroups: groupItemsBySection(baseItems)
  }
}

/**
 * Derive the editorial proposal title. Examples:
 *   contact.name = "Roy Residence"  → "ROY RESIDENCE PROPOSAL"
 *   contact.name = "Heather Neighbor", job_title = "Deck rebuild"
 *                                   → "HEATHER NEIGHBOR PROPOSAL"
 *   contact.name = ""                → "PROJECT PROPOSAL"
 */
function derivedProposalTitle(contact) {
  const name = contact?.name && String(contact.name).trim()
  if (name) return `${name.toUpperCase()} PROPOSAL`
  const job = contact?.job_title && String(contact.job_title).trim()
  if (job) return `${job.toUpperCase()} PROPOSAL`
  return 'PROJECT PROPOSAL'
}

/**
 * Group base items by their section field, preserving insertion order
 * (items already sorted by sort_order then created_at). Items without a
 * section land in a synthesized "Project scope" group at the start.
 *
 * Returns an array of { name, items, total } so the renderer can lay
 * out one scope block per group without re-sorting.
 */
function groupItemsBySection(baseItems) {
  const groups = []
  const byName = new Map()
  for (const it of baseItems) {
    const raw = (it.section || '').trim()
    const name = raw || 'Project scope'
    if (!byName.has(name)) {
      const g = { name, items: [], total: 0 }
      byName.set(name, g)
      groups.push(g)
    }
    const g = byName.get(name)
    g.items.push(it)
    g.total += Number(it.amount || 0)
  }
  return groups
}

function formatLongDate(d) {
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString(undefined, { month: 'long', day: 'numeric', year: 'numeric' })
}

/* ============================================================
   PAGE 1 — COVER (editorial / magazine)

   Layout, top → bottom:
     - cream paper background
     - thin top brand-accent rule
     - issue line (date + number) in small italic Times
     - black header strip with company logo or wordmark
     - hero project image zone (or placeholder)
     - HUGE Times serif title (e.g., "ROY RESIDENCE PROPOSAL")
     - italic Times subtitle (job_title)
     - address row with subtle pin glyph
     - stat row: PREPARED FOR · PROJECT VALUE · VALID THROUGH
     - bottom brand-accent rule + company footer line
   ============================================================ */
function drawCoverPage(doc, ctx) {
  const { pageWidth, pageHeight, margin, companyName, contact, brandGold, logo } = ctx

  // Cream paper background (full bleed)
  drawPaperBackground(doc, ctx)

  // Approval seal (4C-3) — small, restrained, upper-right corner.
  // Only rendered for approved snapshots; absent on draft/sent quotes.
  if (ctx.approval) {
    drawApprovalSeal(doc, ctx)
  }

  // Top brand-accent rule (thin)
  doc.setDrawColor(...brandGold)
  doc.setLineWidth(0.6)
  doc.line(margin, 12, pageWidth - margin, 12)

  // Issue eyebrow — italic Times serif, small caps feel
  doc.setFont('times', 'italic')
  doc.setFontSize(10)
  doc.setTextColor(...INK_MUTED)
  doc.text(`PROPOSAL · NO. ${ctx.number}`, margin, 19)
  doc.text(ctx.longDate.toUpperCase(), pageWidth - margin, 19, { align: 'right' })

  // Black header band with logo or wordmark
  const headerBandTop = 24
  const headerBandHeight = 24
  doc.setFillColor(...ONYX)
  doc.rect(0, headerBandTop, pageWidth, headerBandHeight, 'F')

  if (logo && logo.dataUrl && logo.width > 0 && logo.height > 0) {
    const maxH = 16
    const maxW = 60
    const aspect = logo.width / logo.height
    let h = maxH
    let w = h * aspect
    if (w > maxW) { w = maxW; h = w / aspect }
    const x = (pageWidth - w) / 2
    const yL = headerBandTop + (headerBandHeight - h) / 2
    try {
      doc.addImage(logo.dataUrl, logo.format || 'PNG', x, yL, w, h)
    } catch {
      drawCoverHeaderWordmark(doc, ctx, headerBandTop, headerBandHeight)
    }
  } else {
    drawCoverHeaderWordmark(doc, ctx, headerBandTop, headerBandHeight)
  }

  // Hero project photo zone (or graceful placeholder)
  const heroTop = headerBandTop + headerBandHeight + 4
  const heroHeight = 96
  const heroPhoto = ctx.photos.find((p) => !p.section_tag) || ctx.photos[0] || null
  drawHeroPhotoOrPlaceholder(doc, ctx, heroTop, heroHeight, heroPhoto)

  // HUGE editorial title — Times bold, scaled to fit
  const titleY = heroTop + heroHeight + 18
  doc.setFont('times', 'bold')
  let titleSize = 36
  doc.setFontSize(titleSize)
  while (doc.getTextWidth(ctx.proposalTitle) > pageWidth - margin * 2 && titleSize > 22) {
    titleSize -= 1
    doc.setFontSize(titleSize)
  }
  doc.setTextColor(...ONYX)
  doc.text(ctx.proposalTitle, pageWidth / 2, titleY, { align: 'center' })

  // Italic Times subtitle — job_title
  let subtitleEndY = titleY
  if (contact?.job_title) {
    doc.setFont('times', 'italic')
    doc.setFontSize(15)
    doc.setTextColor(...INK_MUTED)
    const sub = String(contact.job_title)
    doc.text(sub, pageWidth / 2, titleY + 9, { align: 'center' })
    subtitleEndY = titleY + 9
  }

  // Address row — center-aligned, pin dot + address
  if (contact?.address) {
    const addrY = subtitleEndY + 9
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...brandGold)
    doc.setCharSpace(0.5)
    doc.text('•', pageWidth / 2 - doc.getTextWidth(contact.address) / 2 - 4, addrY, { align: 'left' })
    doc.setCharSpace(0)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...ONYX)
    doc.text(String(contact.address), pageWidth / 2, addrY, { align: 'center' })
  }

  // Stat row at the bottom — three columns: PREPARED FOR · PROJECT
  // VALUE · VALID THROUGH. Sits ~50mm above the page bottom so the
  // brand rule + footer have room.
  drawCoverStatRow(doc, ctx, pageHeight - 60)

  // Bottom brand-accent rule + company footer line
  doc.setDrawColor(...brandGold)
  doc.setLineWidth(0.6)
  doc.line(margin, pageHeight - 18, pageWidth - margin, pageHeight - 18)

  const footerLine = [
    companyName,
    company0(ctx, 'phone'),
    company0(ctx, 'email'),
    company0(ctx, 'website')
  ].filter(Boolean).join('  ·  ')
  if (footerLine) {
    doc.setFont('times', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...INK_MUTED)
    doc.text(footerLine, pageWidth / 2, pageHeight - 11, { align: 'center' })
  }

  // Trust line below footer when present (license + insured)
  if (ctx.trustLine) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...INK_MUTED)
    doc.setCharSpace(0.5)
    doc.text(ctx.trustLine, pageWidth / 2, pageHeight - 6, { align: 'center' })
    doc.setCharSpace(0)
  }
}

function drawCoverHeaderWordmark(doc, ctx, bandTop, bandHeight) {
  const { pageWidth, companyName } = ctx
  doc.setFont('times', 'bold')
  doc.setTextColor(...RAW_LINEN)
  let size = 22
  doc.setFontSize(size)
  const text = (companyName || 'My Company').toUpperCase()
  while (doc.getTextWidth(text) > pageWidth - 28 && size > 13) {
    size -= 1
    doc.setFontSize(size)
  }
  doc.text(text, pageWidth / 2, bandTop + bandHeight / 2 + size * 0.18, { align: 'center' })
}

function drawCoverStatRow(doc, ctx, y) {
  const { pageWidth, margin, contact, brandGold, baseTotal, expiresAtLong, expiresAtIsExpired } = ctx
  const colW = (pageWidth - margin * 2) / 3
  const labels = [
    { eyebrow: 'PREPARED FOR', value: contact?.name || 'Valued Client' },
    { eyebrow: 'PROJECT VALUE', value: money(baseTotal), valueColor: ONYX },
    {
      eyebrow: expiresAtIsExpired ? 'EXPIRED' : 'VALID THROUGH',
      value: expiresAtIsExpired ? '—' : (expiresAtLong || 'On request'),
      valueColor: expiresAtIsExpired ? ALERT_RED : ONYX
    }
  ]
  for (let i = 0; i < labels.length; i++) {
    const cx = margin + colW * (i + 0.5)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...INK_MUTED)
    doc.setCharSpace(0.5)
    doc.text(labels[i].eyebrow, cx, y, { align: 'center' })
    doc.setCharSpace(0)
    doc.setFont('times', 'normal')
    doc.setFontSize(13)
    doc.setTextColor(...(labels[i].valueColor || ONYX))
    const wrapped = doc.splitTextToSize(String(labels[i].value), colW - 6).slice(0, 2)
    let yy = y + 7
    for (const line of wrapped) {
      doc.text(line, cx, yy, { align: 'center' })
      yy += 5.5
    }
  }
  // Inner brand-accent rules between columns
  doc.setDrawColor(...brandGold)
  doc.setLineWidth(0.4)
  for (let i = 1; i < 3; i++) {
    const lx = margin + colW * i
    doc.line(lx, y - 2, lx, y + 16)
  }
}

function company0(ctx, key) {
  const v = ctx?.company?.[key]
  return v && String(v).trim() ? String(v).trim() : ''
}

/**
 * Cream / off-white editorial paper background. Drawn full-bleed at the
 * very start of each page renderer so subsequent fills/strokes sit on
 * a warm tone rather than stark white.
 */
function drawPaperBackground(doc, ctx) {
  const { pageWidth, pageHeight } = ctx
  doc.setFillColor(...RAW_LINEN)
  doc.rect(0, 0, pageWidth, pageHeight, 'F')
}

/**
 * Hero photo zone — fills a horizontal band at the given y/height with
 * either a project photo or a graceful placeholder. Placeholder is a
 * subtle cross-hatch pattern on a slightly darker cream tile so the
 * cover still reads "magazine layout" even when no photo is uploaded.
 */
function drawHeroPhotoOrPlaceholder(doc, ctx, y, h, photo) {
  const { pageWidth } = ctx
  const x = 0
  const w = pageWidth

  if (photo && photo.dataUrl && photo.width > 0 && photo.height > 0) {
    // Cover-fit: scale to fully cover the band, crop overflow.
    const imgAspect = photo.width / photo.height
    const bandAspect = w / h
    let renderW, renderH, renderX, renderY
    if (imgAspect > bandAspect) {
      renderH = h
      renderW = h * imgAspect
      renderX = x - (renderW - w) / 2
      renderY = y
    } else {
      renderW = w
      renderH = w / imgAspect
      renderX = x
      renderY = y - (renderH - h) / 2
    }
    // Clip rectangle so the image doesn't bleed past the band.
    doc.saveGraphicsState()
    try {
      doc.rect(x, y, w, h)
      doc.clip()
      doc.discardPath()
      try {
        doc.addImage(photo.dataUrl, photo.format || 'PNG', renderX, renderY, renderW, renderH)
      } catch {
        drawPhotoPlaceholder(doc, ctx, x, y, w, h)
      }
    } finally {
      doc.restoreGraphicsState()
    }
  } else {
    drawPhotoPlaceholder(doc, ctx, x, y, w, h)
  }
}

/**
 * Scope-photo zone — smaller, used inside scope blocks on Page 2+.
 * Same cover-fit + clip behavior as the hero, just at a different size.
 */
function drawScopePhoto(doc, ctx, x, y, w, h, photo) {
  if (photo && photo.dataUrl && photo.width > 0 && photo.height > 0) {
    const imgAspect = photo.width / photo.height
    const bandAspect = w / h
    let renderW, renderH, renderX, renderY
    if (imgAspect > bandAspect) {
      renderH = h
      renderW = h * imgAspect
      renderX = x - (renderW - w) / 2
      renderY = y
    } else {
      renderW = w
      renderH = w / imgAspect
      renderX = x
      renderY = y - (renderH - h) / 2
    }
    doc.saveGraphicsState()
    try {
      doc.rect(x, y, w, h)
      doc.clip()
      doc.discardPath()
      try {
        doc.addImage(photo.dataUrl, photo.format || 'PNG', renderX, renderY, renderW, renderH)
      } catch {
        drawPhotoPlaceholder(doc, ctx, x, y, w, h)
      }
    } finally {
      doc.restoreGraphicsState()
    }
  } else {
    drawPhotoPlaceholder(doc, ctx, x, y, w, h)
  }
}

/**
 * Photo placeholder — slightly darker cream rectangle with a thin gold
 * inner rule and a small "PHOTO" eyebrow. Reads as an intentional
 * design element rather than a missing-asset error.
 */
function drawPhotoPlaceholder(doc, ctx, x, y, w, h) {
  doc.setFillColor(232, 226, 214)
  doc.rect(x, y, w, h, 'F')
  // Inner thin gold frame, inset by 4mm
  doc.setDrawColor(...ctx.brandGold)
  doc.setLineWidth(0.3)
  doc.rect(x + 4, y + 4, w - 8, h - 8, 'S')
  // Tiny "PHOTO" eyebrow centered
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...INK_MUTED)
  doc.setCharSpace(0.6)
  doc.text('PROJECT PHOTO', x + w / 2, y + h / 2 + 1, { align: 'center' })
  doc.setCharSpace(0)
}

/* ============================================================
   Approval seal (Phase 4C-3) — drawn on the cover when ctx.approval
   is present. Restrained: thin SIGNAL_GREEN border + "APPROVED"
   wordmark + "v{n} · {date}" sub-line. Axis-aligned, no kitsch.
   ============================================================ */
function drawApprovalSeal(doc, ctx) {
  const { pageWidth, approval } = ctx
  const w = 56
  const h = 18
  const x = pageWidth - 18 - w
  const y = 36

  doc.setDrawColor(...SIGNAL_GREEN)
  doc.setLineWidth(0.5)
  doc.rect(x, y, w, h, 'D')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...SIGNAL_GREEN)
  doc.setCharSpace(0.8)
  doc.text('APPROVED', x + w / 2, y + 7.8, { align: 'center' })
  doc.setCharSpace(0)

  const sub = `v${approval.versionNumber || 1} · ${formatLongDate(approval.approvedAt) || ''}`
    .toUpperCase()
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(7.5)
  doc.setTextColor(...SIGNAL_GREEN)
  doc.setCharSpace(0.4)
  doc.text(sub, x + w / 2, y + 13.5, { align: 'center' })
  doc.setCharSpace(0)
}

/* ============================================================
   Approval certificate (Phase 4C-3) — replaces the READY TO START?
   acceptance/signature block on Page 4 when ctx.approval is set.
   The signatures already did their job; the doc now records what
   was agreed to and how the agreement was captured.
   ============================================================ */
function drawApprovalCertificate(doc, ctx, y) {
  const { margin, contentWidth, approval } = ctx

  y = drawSectionTitle(doc, margin, y, 'APPROVED QUOTE RECORD', PROPOSAL_BRAND.sectionH3)
  y += 2

  const rows = [
    ['Version',       `v${approval.versionNumber || 1}`],
    ['Quote number',  approval.quoteNumber || ctx.number],
    ['Approved on',   approval.approvedAt ? formatLongDate(approval.approvedAt) : ''],
    ['Approved by',   approval.approvedByName +
                       (approval.approvedByEmail ? `  ·  ${approval.approvedByEmail}` : '')],
    ['Method',        formatApprovalMethod(approval.method)],
    ['Quoted price',  money(approval.baseTotal != null ? approval.baseTotal : ctx.baseTotal)]
  ].filter(([, val]) => val && String(val).trim().length > 0)

  const labelX = margin
  const valueX = margin + 50
  const rowGap = 8

  for (const [label, val] of rows) {
    drawEyebrow(doc, labelX, y + 0.5, label.toUpperCase())
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(PROPOSAL_BRAND.bodySize)
    doc.setTextColor(...ONYX)
    const wrapped = doc.splitTextToSize(String(val), contentWidth - 50)
    doc.text(wrapped, valueX, y + 0.5)
    y += rowGap + (wrapped.length - 1) * 5
  }

  if (approval.approvalNote && String(approval.approvalNote).trim()) {
    y += 4
    drawEyebrow(doc, labelX, y + 0.5, 'NOTE')
    y += 5.5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(PROPOSAL_BRAND.bodySize)
    doc.setTextColor(...ONYX)
    const wrapped = doc.splitTextToSize(String(approval.approvalNote).trim(), contentWidth)
    doc.text(wrapped, labelX, y)
    y += wrapped.length * PROPOSAL_BRAND.proseLineHeight
  }

  // Signature block (Phase 4C-4c) — drawn or typed. Page-break-protected
  // so the signature + audit footnote stay together. Rendered only when
  // signatureKind + signatureData were captured at approval time.
  const hasSig = approval.signatureKind && approval.signatureData &&
    String(approval.signatureData).trim().length > 0
  if (hasSig) {
    if (y + 54 > ctx.pageHeight - PROPOSAL_BRAND.pageBottomGuard) {
      doc.addPage()
      drawPageHeaderStrip(doc, ctx)
      y = PROPOSAL_BRAND.pageTopBody
    }
    y = drawSignatureOnCertificate(doc, ctx, y, approval)
  }

  // Audit footer note — small, muted, sits below the certificate so the
  // contractor's branding stays the dominant moment of the page.
  y += 8
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(8.5)
  doc.setTextColor(...INK_MUTED)
  const auditFootnote =
    'This page certifies the record above as the approved quote. Future changes to items, scope, or terms do not alter this approval record.'
  const auditWrapped = doc.splitTextToSize(auditFootnote, contentWidth)
  doc.text(auditWrapped, margin, y)
  return y + auditWrapped.length * 4
}

function formatApprovalMethod(method) {
  if (!method) return ''
  switch (String(method).toLowerCase()) {
    case 'verbal':            return 'Verbal'
    case 'text':              return 'Text message'
    case 'email':             return 'Email'
    case 'in_person':         return 'In person'
    case 'signature_typed':   return 'Typed signature'
    case 'signature_drawn':   return 'Drawn signature'
    case 'esign_link':        return 'Customer e-signature link'
    default:                  return String(method)
  }
}

/* ============================================================
   Signature block on the approved certificate (Phase 4C-4c).
   Renders the captured customer signature — drawn PNG or typed
   italic text — above a baseline rule, with a small label below.
   Falls back to the printed name when the data URL can't be
   embedded; never throws so PDF generation always completes.
   ============================================================ */
function drawSignatureOnCertificate(doc, ctx, y, approval) {
  const { margin } = ctx
  const baselineWidth = 80

  drawEyebrow(doc, margin, y + 0.5, 'CUSTOMER SIGNATURE')
  y += 8

  // Render the signature mark. blockBottom is the y-coordinate just
  // below the rendered ink — used to position the baseline rule.
  let blockBottom

  const isDrawn =
    approval.signatureKind === 'drawn' &&
    typeof approval.signatureData === 'string' &&
    approval.signatureData.startsWith('data:image/')

  if (isDrawn) {
    // Default to a signature-line aspect (~3.3:1) — matches the
    // SignaturePad's typical canvas dims (280×~85 px). Two separate
    // try/catches: getImageProperties is the flaky one (jsPDF can
    // throw on certain data URLs); addImage almost always succeeds
    // once we have a sane box. Keeps the signature visible even when
    // image-property introspection fails.
    let w = baselineWidth
    let h = 24
    try {
      const props = doc.getImageProperties(approval.signatureData)
      if (props?.width && props?.height) {
        const aspect = props.width / props.height
        w = baselineWidth
        h = w / aspect
        if (h > 28) { h = 28; w = h * aspect }
      }
    } catch (e) {
      console.warn('[pdf] getImageProperties failed; using default sig aspect', e)
    }
    try {
      doc.addImage(approval.signatureData, 'PNG', margin, y, w, h)
      blockBottom = y + h
    } catch (e) {
      console.warn('[pdf] drawn signature embed failed, falling back to typed:', e)
      blockBottom = drawTypedSignatureLine(doc, margin, y, approval.approvedByName || '')
    }
  } else if (approval.signatureKind === 'typed' && approval.signatureData) {
    blockBottom = drawTypedSignatureLine(doc, margin, y, String(approval.signatureData))
  } else {
    // Unknown shape (shouldn't happen given the hasSig gate at the
    // caller). Defensive: print the approved-by name in italic.
    blockBottom = drawTypedSignatureLine(doc, margin, y, approval.approvedByName || '')
  }

  // Baseline rule under the signature.
  doc.setDrawColor(...ONYX)
  doc.setLineWidth(0.6)
  doc.line(margin, blockBottom + 1, margin + baselineWidth, blockBottom + 1)

  // Label below baseline — name, signed date, method.
  const labelY = blockBottom + 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...INK_MUTED)
  const labelParts = [
    approval.approvedByName || '',
    approval.approvedAt ? `Signed ${formatLongDate(approval.approvedAt)}` : '',
    formatApprovalMethod(approval.method)
  ].filter((s) => s && String(s).trim().length > 0)
  if (labelParts.length > 0) {
    doc.text(labelParts.join('  ·  '), margin, labelY)
  }

  return labelY + 4
}

function drawTypedSignatureLine(doc, x, yTop, text) {
  // Italic 22pt — visual signature feel without a custom script font.
  // yTop is the top of the cell; baseline lands ~8mm below for 22pt.
  doc.setFont('helvetica', 'italic')
  doc.setFontSize(22)
  doc.setTextColor(...ONYX)
  const baseline = yTop + 8
  doc.text(String(text || ''), x, baseline)
  return baseline + 2
}

/* ============================================================
   Pages 2+ — header strip
   ============================================================ */
function drawPageHeaderStrip(doc, ctx) {
  const { pageWidth, margin, brandGold } = ctx
  // Cream paper background — applied first so the strip + body sit on
  // warm tone rather than stark white.
  drawPaperBackground(doc, ctx)

  // Thin brand-accent rule across the top
  doc.setDrawColor(...brandGold)
  doc.setLineWidth(PROPOSAL_BRAND.headerStripGold)
  doc.line(0, 6, pageWidth, 6)

  // Left meta — proposal number, italic Times for editorial feel
  doc.setFont('times', 'italic')
  doc.setFontSize(9)
  doc.setTextColor(...INK_MUTED)
  doc.text(`Proposal · No. ${ctx.number}`, margin, PROPOSAL_BRAND.headerStripBaseline)
  // Right meta — company name in Times small caps
  doc.setFont('times', 'italic')
  doc.text(String(ctx.companyName || ''), pageWidth - margin, PROPOSAL_BRAND.headerStripBaseline, { align: 'right' })
}

function drawProposalPageFooter(doc, ctx, pageNumber, totalPages) {
  const { pageWidth, pageHeight, margin } = ctx
  doc.setDrawColor(220, 215, 205)
  doc.setLineWidth(0.2)
  doc.line(margin, pageHeight - 14, pageWidth - margin, pageHeight - 14)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(PROPOSAL_BRAND.footerSize)
  doc.setTextColor(...INK_MUTED)
  const left = [
    ctx.companyName,
    company0(ctx, 'phone'),
    company0(ctx, 'email'),
    company0(ctx, 'website')
  ].filter(Boolean).join(' · ')
  if (left) doc.text(left, margin, pageHeight - 8)
  // Include cover in the count — body pages read "Page 2 of 4" through
  // "Page 4 of 4" on a 4-page proposal. Cover has no footer of its own
  // so the customer never sees "Page 1 of 4"; sequence still reads
  // correctly because each body page knows where it sits in the doc.
  doc.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - margin, pageHeight - 8, { align: 'right' })
}

function drawSectionTitle(doc, x, y, label, size = PROPOSAL_BRAND.sectionH2) {
  // Times serif for the editorial / magazine feel.
  doc.setFont('times', 'bold')
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
  doc.setDrawColor(...ctx.brandGold)
  doc.setLineWidth(PROPOSAL_BRAND.chapterRuleWeight)
  doc.line(ctx.margin, y, ctx.pageWidth - ctx.margin, y)
  return y + 8
}

/* ============================================================
   PAGE 2 — The Work (magazine / scope blocks)

   Each base-item section becomes its own scope block:
     - trade/category eyebrow
     - big Times serif scope title (= section name)
     - short paragraph (scope_text or first item description blurb)
     - photo zone (photo tagged for this section, or placeholder)
     - included items bullet list
     - scope total

   Auto-flows across pages. The first scope block sits under a
   "THE WORK" headline and a "{N} Scopes. One Project." subhead.
   ============================================================ */
function drawProjectAndScopePage(doc, ctx) {
  const { margin, contentWidth, sectionGroups } = ctx
  let y = PROPOSAL_BRAND.pageTopBody

  // Editorial title block
  drawEyebrow(doc, margin, y, 'THE WORK')
  y += 7
  doc.setFont('times', 'bold')
  doc.setFontSize(28)
  doc.setTextColor(...ONYX)
  const headline = sectionGroups.length > 0
    ? `${spelledOut(sectionGroups.length)} ${sectionGroups.length === 1 ? 'Scope' : 'Scopes'}. One Project.`
    : 'One Project.'
  doc.text(headline, margin, y + 6)
  y += 18

  // Optional intro paragraph — uses scope_text if set, else default.
  const introBody = ctx.scope ||
    "Below is each part of the work, the included line items, and what each scope covers. Anything outside this list is captured under What's Excluded on the final page."
  doc.setFont('times', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(...ONYX)
  const introWrapped = doc.splitTextToSize(introBody, contentWidth)
  for (const line of introWrapped) {
    doc.text(line, margin, y)
    y += 5.6
  }
  y += 4
  y = drawChapterRule(doc, ctx, y)
  y += 6

  // No items → render a graceful single-block placeholder so the page
  // doesn't read as empty. Common for early drafts.
  if (sectionGroups.length === 0) {
    drawScopeBlock(doc, ctx, y, {
      name: 'Project Scope',
      items: [],
      total: 0
    }, /* photo */ null)
    return
  }

  // Render each scope block. Each block reserves ~110-130mm vertical
  // depending on item count + photo. Auto-page-break when needed.
  for (let i = 0; i < sectionGroups.length; i++) {
    const group = sectionGroups[i]
    const photo = pickSectionPhoto(ctx, group.name)
    const blockHeight = estimateScopeBlockHeight(doc, ctx, group)

    if (y + blockHeight > ctx.pageHeight - PROPOSAL_BRAND.pageBottomGuard) {
      doc.addPage()
      drawPageHeaderStrip(doc, ctx)
      y = PROPOSAL_BRAND.pageTopBody
    }

    y = drawScopeBlock(doc, ctx, y, group, photo)

    if (i < sectionGroups.length - 1) {
      y += 4
      y = drawChapterRule(doc, ctx, y)
      y += 6
    }
  }
}

function spelledOut(n) {
  const small = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten']
  return small[n] || String(n)
}

function pickSectionPhoto(ctx, sectionName) {
  if (!Array.isArray(ctx.photos) || ctx.photos.length === 0) return null
  const tag = String(sectionName || '').trim().toLowerCase()
  const tagged = ctx.photos.find((p) => p.section_tag && String(p.section_tag).trim().toLowerCase() === tag)
  if (tagged) return tagged
  // Fall back to any untagged photo not already used as the cover hero.
  // Since the cover used photos[0] (or first untagged), pull from index 1+.
  return ctx.photos.find((p, idx) => idx > 0 && !p.section_tag) || null
}

function estimateScopeBlockHeight(doc, ctx, group) {
  // Eyebrow (5) + title (12) + paragraph (3 lines of 5.6 = 17) + photo (60)
  // + items header (8) + items (rows * 6) + total (10) + padding (8)
  const itemRows = group.items.length || 1
  return 5 + 12 + 17 + 60 + 8 + itemRows * 6 + 10 + 8
}

/**
 * Render a single scope block: eyebrow, large Times title, paragraph,
 * photo zone (left half), included items list (right half), scope
 * total at the bottom-right.
 */
function drawScopeBlock(doc, ctx, y, group, photo) {
  const { margin, contentWidth } = ctx

  // Eyebrow
  drawEyebrow(doc, margin, y, 'SCOPE', ctx.brandGold)
  y += 6

  // Big Times serif scope title
  doc.setFont('times', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...ONYX)
  const titleLines = doc.splitTextToSize(group.name, contentWidth).slice(0, 2)
  for (const line of titleLines) {
    doc.text(line, margin, y + 4)
    y += 7.5
  }
  y += 2

  // Short paragraph — derived from first item description as a
  // human-readable summary of what's in this scope.
  const summarySource = group.items.length > 0
    ? group.items.slice(0, 3).map((it) => (it.description || '').trim()).filter(Boolean).join('. ')
    : ''
  const paragraphBody = summarySource
    ? `${summarySource.replace(/\.$/, '')}. Full breakdown below.`
    : 'Full scope breakdown below.'
  doc.setFont('times', 'italic')
  doc.setFontSize(11)
  doc.setTextColor(...INK_MUTED)
  const paraWrapped = doc.splitTextToSize(paragraphBody, contentWidth).slice(0, 3)
  for (const line of paraWrapped) {
    doc.text(line, margin, y)
    y += 5.4
  }
  y += 3

  // Two-column: photo left, items list right
  const colGap = 8
  const leftW = (contentWidth - colGap) * 0.45
  const rightW = (contentWidth - colGap) * 0.55
  const leftX = margin
  const rightX = margin + leftW + colGap
  const photoH = 56

  drawScopePhoto(doc, ctx, leftX, y, leftW, photoH, photo)

  // Right column — included items list
  let yR = y
  drawEyebrow(doc, rightX, yR, 'INCLUDED')
  yR += 6
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...ONYX)
  if (group.items.length === 0) {
    doc.setFont('helvetica', 'italic')
    doc.text('Items being finalized.', rightX, yR)
    yR += 5
  } else {
    const maxRows = 8
    const rows = group.items.slice(0, maxRows)
    for (const it of rows) {
      const desc = (it.description || '').trim() || '—'
      const wrapped = doc.splitTextToSize(`• ${desc}`, rightW)
      const display = wrapped.slice(0, 2)
      for (const line of display) {
        doc.text(line, rightX, yR)
        yR += 5
      }
    }
    if (group.items.length > maxRows) {
      doc.setFont('helvetica', 'italic')
      doc.setFontSize(9)
      doc.setTextColor(...INK_MUTED)
      doc.text(`+ ${group.items.length - maxRows} more`, rightX, yR + 1)
      yR += 5
    }
  }

  // Scope total — anchored to the bottom of the photo zone height for
  // a clean visual baseline regardless of items list length.
  const baseline = y + photoH + 6
  doc.setDrawColor(...ctx.brandGold)
  doc.setLineWidth(0.4)
  doc.line(rightX, baseline - 4, rightX + rightW, baseline - 4)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...INK_MUTED)
  doc.setCharSpace(0.5)
  doc.text('SCOPE TOTAL', rightX, baseline)
  doc.setCharSpace(0)
  doc.setFont('times', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...ONYX)
  doc.text(money(group.total), rightX + rightW, baseline, { align: 'right' })

  return Math.max(yR, baseline) + 4
}

/* ============================================================
   PAGE 3 — Investment Summary

   Layout, top → bottom:
     - "INVESTMENT SUMMARY" Times serif headline
     - section/scope summary table (one row per scope group, total)
     - large black total-investment box (brand-accent total)
     - payment schedule card (default 3-stage when no real data)
     - tax / material / payment notes pulled from terms_text if any
   ============================================================ */
function drawInvestmentPage(doc, ctx) {
  const { margin, contentWidth } = ctx
  let y = PROPOSAL_BRAND.pageTopBody

  drawEyebrow(doc, margin, y, 'INVESTMENT')
  y += 7
  y = drawSectionTitle(doc, margin, y, 'Investment Summary')
  y += 2

  // Section/scope summary table
  drawScopeSummaryTable(doc, ctx, y)
  y = doc.lastAutoTable.finalY + 10

  // Optional add-ons (compact — listed for reference, not totaled).
  if (ctx.optionalItems.length > 0) {
    if (y + 50 > ctx.pageHeight - PROPOSAL_BRAND.pageBottomGuard) {
      doc.addPage()
      drawPageHeaderStrip(doc, ctx)
      y = PROPOSAL_BRAND.pageTopBody
    }
    drawEyebrow(doc, margin, y, 'OPTIONAL ADD-ONS', ctx.brandGold)
    y += 6
    doc.setFont('times', 'italic')
    doc.setFontSize(10)
    doc.setTextColor(...INK_MUTED)
    doc.text('Listed for reference. Not included in the quoted total.', margin, y)
    y += 6
    drawProposalItemsTable(doc, y, ctx, ctx.optionalItems, { isOptional: true })
    y = doc.lastAutoTable.finalY + 8
  }

  // Total investment box — large, black, brand-accent total
  if (y + 50 > ctx.pageHeight - PROPOSAL_BRAND.pageBottomGuard) {
    doc.addPage()
    drawPageHeaderStrip(doc, ctx)
    y = PROPOSAL_BRAND.pageTopBody
  }
  drawTotalInvestmentBox(doc, ctx, y)
  y += 46

  // Payment schedule card
  if (y + 70 > ctx.pageHeight - PROPOSAL_BRAND.pageBottomGuard) {
    doc.addPage()
    drawPageHeaderStrip(doc, ctx)
    y = PROPOSAL_BRAND.pageTopBody
  }
  y = drawPaymentScheduleCard(doc, ctx, y)
}

/**
 * Section summary table — one row per scope group, with the scope
 * total. Reads as a quick "what each part costs" overview before the
 * big total box. When there are no sections, falls back to a single
 * "Project total" row so the layout still has structure.
 */
function drawScopeSummaryTable(doc, ctx, startY) {
  const { sectionGroups, baseTotal } = ctx
  const rows = sectionGroups.length > 0
    ? sectionGroups.map((g) => [g.name, money(g.total)])
    : [['Project total', money(baseTotal)]]

  autoTable(doc, {
    startY,
    head: [['Scope', 'Investment']],
    body: rows,
    theme: 'plain',
    styles: {
      font: 'times',
      fontSize: 11,
      cellPadding: { top: 4, right: 6, bottom: 4, left: 6 },
      textColor: ONYX
    },
    headStyles: {
      fillColor: ONYX,
      textColor: ctx.brandGold,
      font: 'helvetica',
      fontStyle: 'bold',
      fontSize: 9,
      cellPadding: { top: 4, right: 6, bottom: 4, left: 6 }
    },
    alternateRowStyles: { fillColor: [232, 226, 214] },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 40, font: 'times', fontStyle: 'bold' }
    },
    margin: { left: ctx.margin, right: ctx.margin },
    didDrawPage: () => {
      const pageNumber = doc.internal.getCurrentPageInfo().pageNumber
      if (pageNumber !== 1) drawPageHeaderStrip(doc, ctx)
    }
  })
}

/**
 * Total investment box — full-width black panel with a brand-accent
 * eyebrow + the total in large gold-on-black Times. The visual anchor
 * of the investment page.
 */
function drawTotalInvestmentBox(doc, ctx, y) {
  const { margin, contentWidth, brandGold } = ctx
  const h = 40
  doc.setFillColor(...ONYX)
  doc.rect(margin, y, contentWidth, h, 'F')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8.5)
  doc.setTextColor(...brandGold)
  doc.setCharSpace(0.6)
  doc.text('TOTAL INVESTMENT', margin + 10, y + 12)
  doc.setCharSpace(0)

  doc.setFont('times', 'bold')
  doc.setFontSize(36)
  doc.setTextColor(...brandGold)
  doc.text(money(ctx.baseTotal), margin + 10, y + 30)

  if (ctx.optionalTotal > 0) {
    doc.setFont('times', 'italic')
    doc.setFontSize(9)
    doc.setTextColor(...RAW_LINEN)
    doc.text(
      `Optional add-ons available  ·  ${money(ctx.optionalTotal)}`,
      margin + contentWidth - 10,
      y + h - 6,
      { align: 'right' }
    )
  }
}

/**
 * Payment schedule card — three-stage default (50% / 25% / 25%) drawn
 * from the base total. Honest about being a default schedule via the
 * "Standard schedule" caption; the contractor can spell out a custom
 * schedule in the terms_text prose, which renders below the card.
 *
 * Returns the y-cursor after the card.
 */
function drawPaymentScheduleCard(doc, ctx, y) {
  const { margin, contentWidth, brandGold, baseTotal } = ctx

  drawEyebrow(doc, margin, y, 'PAYMENT SCHEDULE')
  y += 7

  doc.setFont('times', 'italic')
  doc.setFontSize(10)
  doc.setTextColor(...INK_MUTED)
  doc.text('Standard schedule. A custom schedule may be agreed in writing.', margin, y)
  y += 8

  const stages = [
    { label: 'Deposit',         pct: 0.50, when: 'On signing' },
    { label: 'Mid-project',     pct: 0.25, when: 'At rough-in / mid-completion' },
    { label: 'Final payment',   pct: 0.25, when: 'Upon completion + walkthrough' }
  ]

  // Draw three equal cards across the row
  const gap = 8
  const cardW = (contentWidth - gap * 2) / 3
  const cardH = 38
  for (let i = 0; i < stages.length; i++) {
    const s = stages[i]
    const cx = margin + (cardW + gap) * i
    // Card background — slightly darker cream
    doc.setFillColor(244, 240, 232)
    doc.rect(cx, y, cardW, cardH, 'F')
    // Top brand-accent rule
    doc.setDrawColor(...brandGold)
    doc.setLineWidth(0.6)
    doc.line(cx, y, cx + cardW, y)
    // Stage eyebrow
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...INK_MUTED)
    doc.setCharSpace(0.5)
    doc.text(s.label.toUpperCase(), cx + 6, y + 7)
    doc.setCharSpace(0)
    // Pct + dollars
    doc.setFont('times', 'bold')
    doc.setFontSize(20)
    doc.setTextColor(...ONYX)
    doc.text(`${Math.round(s.pct * 100)}%`, cx + 6, y + 19)
    doc.setFont('times', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...ONYX)
    doc.text(money(baseTotal * s.pct), cx + 6, y + 26)
    // When
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK_MUTED)
    const wrapped = doc.splitTextToSize(s.when, cardW - 10)
    doc.text(wrapped, cx + 6, y + 32)
  }
  y += cardH + 8
  return y
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
          textColor: ctx.brandGold,
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
      textColor: ctx.brandGold,
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
   PAGE 4 — Terms and Conditions · Acceptance

   Layout, top → bottom:
     - "TERMS" eyebrow + Times "Terms and Conditions" headline
     - numbered terms grid — 2-column, 1..N items (parsed from
       terms_text or rendered from a default operator-friendly set)
     - WARRANTY (only when company.warranty_default is set)
     - Exclusions block (when ctx.exclusions or ctx.excludedItems)
     - Acceptance block + signature lines
       OR Approval certificate (when ctx.approval is set)
   ============================================================ */
function drawTermsAndAcceptancePage(doc, ctx) {
  const { margin, contentWidth } = ctx
  let y = PROPOSAL_BRAND.pageTopBody

  // Title block
  drawEyebrow(doc, margin, y, 'TERMS')
  y += 7
  y = drawSectionTitle(doc, margin, y, 'Terms and Conditions')
  y += 2

  // Numbered terms grid
  const terms = parseTermsItems(ctx.terms)
  y = drawNumberedTermsGrid(doc, ctx, y, terms)
  y += 4

  // WARRANTY — only when company.warranty_default is set.
  if (ctx.warranty) {
    if (y + 30 > ctx.pageHeight - PROPOSAL_BRAND.pageBottomGuard) {
      doc.addPage()
      drawPageHeaderStrip(doc, ctx)
      y = PROPOSAL_BRAND.pageTopBody
    }
    drawEyebrow(doc, margin, y, 'WARRANTY')
    y += 7
    doc.setFont('times', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...ONYX)
    const ww = doc.splitTextToSize(ctx.warranty, contentWidth)
    for (const line of ww) {
      doc.text(line, margin, y)
      y += 5.6
    }
    y += 6
  }

  // Exclusions — when present, single-column block of bullets + prose
  if (ctx.exclusions || ctx.excludedItems.length > 0) {
    if (y + 26 > ctx.pageHeight - PROPOSAL_BRAND.pageBottomGuard) {
      doc.addPage()
      drawPageHeaderStrip(doc, ctx)
      y = PROPOSAL_BRAND.pageTopBody
    }
    drawEyebrow(doc, margin, y, "WHAT'S NOT INCLUDED")
    y += 7
    doc.setFont('times', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...ONYX)
    if (ctx.exclusions) {
      const exWrapped = doc.splitTextToSize(ctx.exclusions, contentWidth)
      for (const line of exWrapped) {
        doc.text(line, margin, y)
        y += 5.4
      }
      y += 2
    }
    if (ctx.excludedItems.length > 0) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(10)
      for (const item of ctx.excludedItems) {
        const line = `• ${item.description || '—'}`
        const wrapped = doc.splitTextToSize(line, contentWidth)
        for (const w of wrapped) {
          doc.text(w, margin, y)
          y += 4.8
        }
      }
    }
    y += 6
  }

  // Closing block — approval certificate OR acceptance + signatures.
  if (ctx.approval) {
    const certBlockHeight = 110
    if (y + certBlockHeight > ctx.pageHeight - PROPOSAL_BRAND.pageBottomGuard) {
      doc.addPage()
      drawPageHeaderStrip(doc, ctx)
      y = PROPOSAL_BRAND.pageTopBody
    }
    drawApprovalCertificate(doc, ctx, y)
  } else {
    const acceptanceBlockHeight = 70
    if (y + acceptanceBlockHeight > ctx.pageHeight - PROPOSAL_BRAND.pageBottomGuard) {
      doc.addPage()
      drawPageHeaderStrip(doc, ctx)
      y = PROPOSAL_BRAND.pageTopBody
    }
    y = drawChapterRule(doc, ctx, y)
    y += 4
    drawEyebrow(doc, margin, y, 'ACCEPTANCE')
    y += 7
    y = drawSectionTitle(doc, margin, y, 'Ready to Begin?', PROPOSAL_BRAND.sectionH3)
    doc.setFont('times', 'normal')
    doc.setFontSize(12)
    doc.setTextColor(...ONYX)
    const acceptText = `Sign below to authorize ${ctx.companyName} to begin work under the scope and terms above. Change orders priced and signed before any out-of-scope work proceeds.`
    const acceptWrapped = doc.splitTextToSize(acceptText, contentWidth)
    for (const line of acceptWrapped) {
      doc.text(line, margin, y)
      y += 5.6
    }
    y += 12
    drawSignatureBlock(doc, ctx, y)
  }
}

/**
 * Split terms_text prose into numbered items. The contractor's
 * terms_text may already be a numbered list, a single paragraph, or
 * blank; we handle all three. Falls back to a curated default 8-item
 * set when blank — operator-friendly and white-label.
 *
 * Returns an array of strings (one per term).
 */
function parseTermsItems(termsText) {
  const DEFAULT_TERMS = [
    'Deposit due on signing. Balance per the payment schedule on the previous page.',
    'Permits and inspection fees, where required, are billed at cost unless quoted as a line item.',
    'Material substitutions of equal or greater quality may be made when manufacturer or trade availability requires it.',
    'Change orders priced and signed before any out-of-scope work proceeds.',
    'Hidden conditions discovered during the work (rot, code violations, prior unpermitted work) will be presented to the client with a written change order before being addressed.',
    'Workmanship warranty per local code and trade standard. Manufacturer warranties pass through to the client.',
    'Cleanup is included. Daily reasonable cleanup; final cleanup at completion.',
    'Final payment due within 7 days of completion and walkthrough.'
  ]
  if (!termsText || !String(termsText).trim()) return DEFAULT_TERMS
  const trimmed = String(termsText).trim()
  // Try to detect explicit numbered/bulleted lines in the prose.
  const lines = trimmed
    .split(/\n+/)
    .map((l) => l.trim().replace(/^([0-9]+[.)\]]|[-•*])\s*/, ''))
    .filter(Boolean)
  if (lines.length >= 2) return lines
  // Single paragraph — split on sentence boundaries, group conservatively.
  const sentences = trimmed
    .split(/(?<=[.!?])\s+(?=[A-Z])/)
    .map((s) => s.trim())
    .filter(Boolean)
  if (sentences.length >= 2) return sentences
  // Single sentence — return it as one item, plus the defaults below it.
  return [trimmed, ...DEFAULT_TERMS.slice(0, 4)]
}

/**
 * Numbered terms grid — 2-column layout. Each item rendered with a
 * Times serif numeral followed by the term text. Auto-flows across
 * pages when item count is large.
 */
function drawNumberedTermsGrid(doc, ctx, y, terms) {
  const { margin, contentWidth } = ctx
  const colGap = 12
  const colWidth = (contentWidth - colGap) / 2
  const numberWidth = 8
  const textWidth = colWidth - numberWidth
  const rowGap = 6

  let yL = y
  let yR = y
  let leftItems = []
  let rightItems = []
  // Distribute items: alternating L/R to balance heights.
  for (let i = 0; i < terms.length; i++) {
    if (i % 2 === 0) leftItems.push({ idx: i + 1, text: terms[i] })
    else rightItems.push({ idx: i + 1, text: terms[i] })
  }

  function drawColumn(items, x, startY) {
    let yy = startY
    for (const it of items) {
      const wrapped = doc.splitTextToSize(it.text, textWidth)
      const blockH = wrapped.length * 5.2
      if (yy + blockH > ctx.pageHeight - PROPOSAL_BRAND.pageBottomGuard) {
        // Spill to next page; redraw header strip and reset cursor.
        doc.addPage()
        drawPageHeaderStrip(doc, ctx)
        yy = PROPOSAL_BRAND.pageTopBody
      }
      // Numeral
      doc.setFont('times', 'bold')
      doc.setFontSize(13)
      doc.setTextColor(...ctx.brandGold)
      doc.text(String(it.idx).padStart(2, '0'), x, yy + 2)
      // Body
      doc.setFont('times', 'normal')
      doc.setFontSize(10.5)
      doc.setTextColor(...ONYX)
      for (let i = 0; i < wrapped.length; i++) {
        doc.text(wrapped[i], x + numberWidth, yy + i * 5.2)
      }
      yy += blockH + rowGap
    }
    return yy
  }

  yL = drawColumn(leftItems, margin, yL)
  yR = drawColumn(rightItems, margin + colWidth + colGap, yR)
  return Math.max(yL, yR)
}

function drawSignatureBlock(doc, ctx, y) {
  const { margin, contentWidth } = ctx
  const colGap = 16
  const colW = (contentWidth - colGap) / 2

  // Each side: a baseline rule + two label rows (signature, printed
  // name, date).
  const labels = [
    { x: margin, eyebrow: 'CLIENT SIGNATURE', who: 'Signature & date' },
    {
      x: margin + colW + colGap,
      eyebrow: 'CONTRACTOR SIGNATURE',
      who: `${ctx.companyName} · Signature & date`
    }
  ]

  for (const lab of labels) {
    drawEyebrow(doc, lab.x, y, lab.eyebrow)
    doc.setDrawColor(...ONYX)
    doc.setLineWidth(PROPOSAL_BRAND.sigUnderlineWeight)
    doc.line(lab.x, y + 18, lab.x + colW, y + 18)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK_MUTED)
    doc.text(lab.who, lab.x, y + 23)
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
