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
import { loadLogoForPdf, loadImageForPdf } from './pdfLogo.ts'
import {
  invoiceNumber as docInvoiceNumber,
  proposalNumber as docProposalNumber
} from '../components/documents/numbers.js'
import { mapItemsToScope } from '../components/documents/mapItems.js'
import { DEFAULT_PAYMENT_SCHEDULE } from '../components/documents/PaymentTermsBlock.jsx'

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
 * Generate a branded invoice PDF — v3 letterhead (Phase 4 parity).
 *
 * Mirrors src/components/documents/InvoiceTemplate.jsx section-for-
 * section so the customer sees the same render whether the contractor
 * previewed it on-screen or received it as an email attachment.
 *
 * Layout, top → bottom:
 *   1. Thin brand-accent rule
 *   2. Letterhead row — logo block (left) + company name + tagline
 *      (center) + status pill (right)
 *   3. Title block — INVOICE eyebrow + project title (Times bold)
 *   4. Meta grid — CLIENT / ISSUED / DUE / INVOICE #
 *   5. Bill to + Project snapshot (two-column)
 *   6. Invoice items table (Description / Qty / Rate / Amount)
 *   7. Totals card (right-aligned: subtotal / tax / AMOUNT DUE)
 *   8. Payment history (when payments.length > 0)
 *   9. Balance summary — Contract / Paid / This invoice with the
 *      Balance Remaining hero in brand-accent gold (or "PAID")
 *  10. Payment instructions paragraph
 *  11. Footer — contact line + LIC + INSURED trust line
 *
 * White-label: company.name / company.logo_url / company.brand_accent_hex
 * drive every customer-visible byte. The app's name never appears.
 *
 * @param {object}  opts
 * @param {object}  opts.company        { name, address, phone, email, website,
 *                                          logo_url, brand_accent_hex,
 *                                          license_number, insured_text }
 * @param {object}  opts.contact        { id, name, address, phone, email, job_title }
 * @param {Array}   opts.lineItems      [{ description, qty, rate, amount, unit, notes }]
 * @param {number}  [opts.taxRate]      decimal, e.g. 0.0725
 * @param {string}  [opts.notes]        appended under Payment Instructions
 * @param {string}  [opts.dueDate]      human-formatted; empty → "On receipt"
 * @param {string}  [opts.invoiceId]    seed for the stable doc number
 * @param {Array}   [opts.payments]     [{ amount, method, reference, paid_on, note }]
 * @param {number}  [opts.contractTotal] when omitted: subtotal+tax
 * @param {number}  [opts.previouslyPaid] when omitted: sum(payments)
 * @returns {{ doc: jsPDF, filename: string, number: string }}
 */
// ============================================================
// V4 shared PDF helpers — restrained-editorial layout matching the
// "Estimate #62" reference. Used by BOTH generateInvoice and
// generateQuote so they look like siblings.
//
//   drawDocLogo        — square brand-color block, logo image or monogram
//   drawDocLetterhead  — logo + "{TYPE} #{N}" + Sent on date
//   drawDocParties     — RECIPIENT / SENDER two-column
//   drawDocItemsTable  — dark-bar autoTable with multi-line desc
//   drawDocTotalsBlock — right-aligned subtotal stack + boxed Total
//   drawDocDisclaimer  — bottom fine-print paragraph
// ============================================================

function drawDocLogo(doc, { x, y, size, company, logo, brandRGB }) {
  // Brand-color filled square. Logo image centered when available;
  // monogram fallback in white when not.
  doc.setFillColor(...brandRGB)
  doc.setDrawColor(...brandRGB)
  doc.roundedRect(x, y, size, size, 1.5, 1.5, 'F')

  if (logo && logo.dataUrl && logo.width > 0 && logo.height > 0) {
    const pad = 4
    const maxW = size - pad * 2
    const maxH = size - pad * 2
    const aspect = logo.width / logo.height
    let w = maxW
    let h = w / aspect
    if (h > maxH) { h = maxH; w = h * aspect }
    try {
      doc.addImage(logo.dataUrl, logo.format || 'PNG', x + (size - w) / 2, y + (size - h) / 2, w, h)
      return
    } catch {
      // fall through to monogram
    }
  }
  const initials = (company?.name || 'MC')
    .split(/\s+/).filter(Boolean).map((w) => w[0])
    .join('').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'MC'
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(255, 255, 255)
  doc.text(initials, x + size / 2, y + size / 2 + 3, { align: 'center' })
}

function drawDocLetterhead(doc, opts) {
  const { pageWidth, margin, docType, number, issuedAt, company, logo, brandRGB } = opts
  const logoSize = 26 // mm
  const topY = 18

  // Logo (left)
  drawDocLogo(doc, { x: margin, y: topY, size: logoSize, company, logo, brandRGB })

  // Right column — doc type + number + horizontal rule + "Sent on" + date
  const rightCol = pageWidth - margin
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(20)
  doc.setTextColor(...ONYX)
  doc.text(`${docType.toUpperCase()} #${number}`, rightCol, topY + 6, { align: 'right' })

  // Rule
  doc.setDrawColor(...ONYX)
  doc.setLineWidth(0.4)
  doc.line(margin + logoSize + 12, topY + 9, rightCol, topY + 9)

  // SENT ON
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...ONYX)
  doc.setCharSpace(0.8)
  doc.text('SENT ON:', rightCol, topY + 15, { align: 'right' })
  doc.setCharSpace(0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.text(formatDocDate(issuedAt), rightCol, topY + 21, { align: 'right' })

  return topY + logoSize + 10 // returned cursor Y
}

function drawDocParties(doc, opts) {
  const { pageWidth, margin, y, recipient, company } = opts
  const colW = (pageWidth - margin * 2 - 12) / 2
  const leftX = margin
  const rightX = margin + colW + 12

  // Top hairlines
  doc.setDrawColor(...ONYX)
  doc.setLineWidth(0.4)
  doc.line(leftX, y, leftX + colW, y)
  doc.line(rightX, y, rightX + colW, y)

  // Labels
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...ONYX)
  doc.setCharSpace(0.8)
  doc.text('RECIPIENT:', leftX, y + 6)
  doc.text('SENDER:', rightX, y + 6)
  doc.setCharSpace(0)

  // Names
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.text(recipient?.name || '—', leftX, y + 13)
  doc.text(company?.name || 'My Company', rightX, y + 13)

  // Address lines
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(60, 56, 51)
  let leftY = y + 19
  if (recipient?.address) {
    const lines = doc.splitTextToSize(String(recipient.address), colW)
    doc.text(lines, leftX, leftY)
    leftY += lines.length * 4.5
  }
  if (recipient?.phone || recipient?.email) {
    const sub = [recipient.phone, recipient.email].filter(Boolean).join(' · ')
    const lines = doc.splitTextToSize(sub, colW)
    doc.text(lines, leftX, leftY)
    leftY += lines.length * 4.5
  }

  let rightY = y + 19
  if (company?.address) {
    const lines = doc.splitTextToSize(String(company.address), colW)
    doc.text(lines, rightX, rightY)
    rightY += lines.length * 4.5
  }
  if (company?.phone)   { doc.text(`Phone: ${company.phone}`, rightX, rightY); rightY += 4.5 }
  if (company?.email)   { doc.text(`Email: ${company.email}`, rightX, rightY); rightY += 4.5 }
  if (company?.website) { doc.text(`Website: ${company.website}`, rightX, rightY); rightY += 4.5 }

  return Math.max(leftY, rightY) + 6
}

function drawDocItemsTable(doc, opts) {
  const { startY, rows, brandRGB, margin, pageWidth } = opts
  autoTable(doc, {
    startY,
    head: [['Product/Service', 'Description', 'Qty.', 'Unit Price', 'Total']],
    body: rows.map((r) => {
      const qty = Number(r.qty || 1)
      const rate = Number(r.rate || 0)
      const amount = Number(r.amount != null ? r.amount : qty * rate)
      const desc = r.descriptionLines && r.descriptionLines.length > 0
        ? r.descriptionLines.join('\n')
        : (r.description || '—')
      return [
        r.title || '—',
        desc,
        `${qty}${r.unit ? ` ${r.unit}` : ''}`,
        money(rate),
        money(amount)
      ]
    }),
    theme: 'plain',
    headStyles: {
      fillColor: brandRGB,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: 10,
      cellPadding: { top: 4, right: 5, bottom: 4, left: 5 }
    },
    bodyStyles: {
      fontSize: 10,
      textColor: ONYX,
      cellPadding: { top: 5, right: 5, bottom: 5, left: 5 },
      lineWidth: 0,
      valign: 'top'
    },
    didDrawCell: function (data) {
      if (data.section === 'body') {
        const { doc: d, cell, column } = data
        d.setDrawColor(232, 228, 216)
        d.setLineWidth(0.15)
        d.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height)
        // bold the title column
        if (column.index === 0) {
          // already painted plain — re-paint as bold
        }
      }
    },
    columnStyles: {
      0: { cellWidth: 36, fontStyle: 'bold' },
      1: { cellWidth: 'auto' },
      2: { halign: 'right', cellWidth: 16 },
      3: { halign: 'right', cellWidth: 26 },
      4: { halign: 'right', cellWidth: 26, fontStyle: 'bold' }
    },
    margin: { left: margin, right: margin }
  })
  return doc.lastAutoTable.finalY
}

function drawDocTotalsBlock(doc, opts) {
  const { startY, pageWidth, margin, label, total, rows = [] } = opts
  const rightX = pageWidth - margin
  let cursor = startY + 4

  // Stack of optional sub-rows on the right
  if (rows.length > 0) {
    const labelX = pageWidth - margin - 60
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    for (const r of rows) {
      doc.setTextColor(...INK_MUTED)
      doc.text(r.label, labelX, cursor)
      doc.setTextColor(...(r.muted ? INK_MUTED : ONYX))
      doc.text(r.value, rightX, cursor, { align: 'right' })
      cursor += 6
    }
    cursor += 2
  }

  // Total box
  const boxW = 44
  const boxH = 11
  const boxX = rightX - boxW
  const labelX = boxX - 22

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...ONYX)
  doc.text(label, labelX, cursor + 7, { align: 'right' })

  doc.setDrawColor(...ONYX)
  doc.setLineWidth(0.4)
  doc.rect(boxX, cursor, boxW, boxH, 'S')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...ONYX)
  doc.text(money(total, true), rightX - 4, cursor + 7.5, { align: 'right' })

  return cursor + boxH + 6
}

function drawDocDisclaimer(doc, opts) {
  const { pageWidth, pageHeight, margin, text } = opts
  if (!text) return
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...INK_MUTED)
  const lines = doc.splitTextToSize(text, pageWidth - margin * 2)
  // Anchor near the bottom margin
  doc.text(lines, margin, pageHeight - 14 - (lines.length - 1) * 4)
}

// ============================================================
// Project photos block — embeds tagged section photos into the PDF.
// Pre-fetches each signed URL through loadImageForPdf (same loader as
// the logo), groups by section_tag, and renders a 3-up grid on the
// proposal / 2-up on the invoice. Page-break aware so a long section
// can split across pages without truncating the last row.
// ============================================================
async function drawProjectPhotosBlock(doc, opts) {
  const { photos, margin, pageWidth, pageHeight, startY, brandRGB, compact = false } = opts
  if (!Array.isArray(photos) || photos.length === 0) return startY

  // Pre-load all images in parallel. Drops any failures so a single
  // expired URL doesn't break the block.
  const loaded = await Promise.all(
    photos.map(async (p) => {
      if (!p?.url) return null
      const img = await loadImageForPdf(p.url, { maxDimension: 900 }).catch(() => null)
      if (!img) return null
      return { ...p, img }
    })
  )
  const valid = loaded.filter(Boolean)
  if (valid.length === 0) return startY

  // Group by section_tag — empty tag falls into a single 'Project
  // photos' bucket so untagged uploads still surface.
  const groups = new Map()
  for (const p of valid) {
    const tag = (p.section_tag || '').trim() || 'Project photos'
    if (!groups.has(tag)) groups.set(tag, [])
    groups.get(tag).push(p)
  }

  const cols = compact ? 2 : 3
  const gap = 4
  const innerWidth = pageWidth - margin * 2
  const cellW = (innerWidth - gap * (cols - 1)) / cols
  const cellH = cellW * 0.75 // 4:3 aspect

  let cursor = startY

  // Section header — gold-rule + label, same idiom as the certificate
  if (cursor > pageHeight - 50) { doc.addPage(); cursor = 18 }
  doc.setDrawColor(...brandRGB)
  doc.setLineWidth(0.6)
  doc.line(margin, cursor, margin + 18, cursor)
  cursor += 4
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...ONYX)
  doc.setCharSpace(0.8)
  doc.text('PROJECT PHOTOS', margin, cursor + 2)
  doc.setCharSpace(0)
  cursor += 6

  for (const [tag, arr] of groups.entries()) {
    // Per-section sub-label only when there's more than one group —
    // a single bucket reads cleanly without a noisy header.
    if (groups.size > 1) {
      if (cursor > pageHeight - 30) { doc.addPage(); cursor = 18 }
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(...INK_MUTED)
      doc.setCharSpace(0.6)
      doc.text(String(tag).toUpperCase(), margin, cursor + 3)
      doc.setCharSpace(0)
      cursor += 6
    }

    // Cap to 6 per group to keep the layout from sprawling.
    const display = arr.slice(0, 6)
    for (let i = 0; i < display.length; i += cols) {
      const row = display.slice(i, i + cols)
      // Page-break check — leave room for the image + caption line.
      if (cursor + cellH + 8 > pageHeight - 20) {
        doc.addPage()
        cursor = 18
      }
      row.forEach((p, j) => {
        const x = margin + j * (cellW + gap)
        try {
          doc.addImage(p.img.dataUrl, p.img.format || 'PNG', x, cursor, cellW, cellH)
        } catch {
          // Tainted/bad image — draw a placeholder rect so the layout
          // doesn't collapse around it.
          doc.setFillColor(...RAW_LINEN)
          doc.rect(x, cursor, cellW, cellH, 'F')
        }
        if (p.caption) {
          const cap = doc.splitTextToSize(p.caption, cellW)
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(7)
          doc.setTextColor(...INK_MUTED)
          doc.text(cap.slice(0, 1), x, cursor + cellH + 3)
        }
      })
      cursor += cellH + (display.some((p) => p.caption) ? 6 : 4)
    }
    cursor += 2
  }

  return cursor + 4
}

function formatDocDate(d) {
  if (!d) return ''
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString(undefined, { month: 'long', day: '2-digit', year: 'numeric' })
}

function shortDocNumber(num) {
  if (!num) return ''
  const parts = String(num).split('-')
  return parts[parts.length - 1] || String(num)
}

// money() above uses 2 decimals always; this overload allows compact display.
// Keep the original signature working by adding a `compact` boolean.
function moneyCompact(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 2, maximumFractionDigits: 2
  })
}

// ============================================================
// Document-level disclaimer copy (matches HTML preview footers).
// ============================================================
const INVOICE_DISCLAIMER = 'Pricing covers labor, material, standard equipment, placement, finishing, and cleanup for the scope as billed. Hidden conditions, field changes, or scope deviations may require a separate change order. Past-due balances may accrue at 1.5% per month.'
const PROPOSAL_DISCLAIMER = 'Pricing includes labor, material, standard equipment, placement, finishing, and cleanup for the listed scope only. Pricing is based on visible site conditions at time of estimating. Any hidden conditions, field changes, owner-requested additions, or scope deviations may require additional pricing through written change order approval. Estimate valid for 30 days.'

/**
 * Generate a branded invoice PDF — restrained editorial layout
 * matching the on-screen InvoiceTemplate (DocumentShell + dark-bar
 * items table + boxed AMOUNT DUE + fine-print disclaimer).
 */
export async function generateInvoice({
  company = {},
  contact = {},
  lineItems = [],
  taxRate = 0,
  notes = '',
  dueDate = '',
  invoiceId,
  payments = [],
  contractTotal,
  previouslyPaid,
  insurance = null,
  changeOrders = [],
  photos = []
} = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 16

  const number = docInvoiceNumber(company?.name, invoiceId || contact?.id)
  const logo = company?.logo_url
    ? await loadLogoForPdf(company.logo_url, { maxDimension: 720 })
    : null
  const brandRGB = parseBrandAccentRgb(company?.brand_accent_hex) || FIELD_GOLD

  // 1. Letterhead
  let cursor = drawDocLetterhead(doc, {
    pageWidth, margin, docType: 'INVOICE',
    number: shortDocNumber(number),
    issuedAt: new Date(),
    company, logo, brandRGB
  })

  // 2. Parties
  cursor = drawDocParties(doc, {
    pageWidth, margin, y: cursor + 6,
    recipient: contact, company
  })

  // 3. Items
  const rows = (lineItems && lineItems.length > 0)
    ? lineItems.map((li) => ({
        title: li.description || 'Item',
        descriptionLines: li.notes ? [li.notes] : [],
        qty: li.qty || 1,
        unit: li.unit,
        rate: li.rate,
        amount: li.amount
      }))
    : [{
        title: contact?.job_title || 'Construction services per agreement',
        descriptionLines: [],
        qty: 1,
        rate: contractTotal || 0,
        amount: contractTotal || 0
      }]
  cursor = drawDocItemsTable(doc, { startY: cursor + 4, rows, brandRGB, margin, pageWidth })

  // 4. Totals + AMOUNT DUE
  const subtotal = rows.reduce((s, r) => {
    const q = Number(r.qty || 1)
    const rt = Number(r.rate || 0)
    return s + Number(r.amount != null ? r.amount : q * rt)
  }, 0)
  const tax = subtotal * Number(taxRate || 0)
  const total = subtotal + tax

  const totalsRows = []
  if (taxRate > 0) {
    totalsRows.push({ label: 'Subtotal', value: moneyCompact(subtotal) })
    totalsRows.push({ label: `Tax · ${(taxRate * 100).toFixed(2)}%`, value: moneyCompact(tax) })
  }
  if (dueDate) totalsRows.push({ label: 'Due', value: dueDate, muted: true })

  cursor = drawDocTotalsBlock(doc, {
    startY: cursor, pageWidth, margin,
    label: 'Amount due', total, rows: totalsRows
  })

  // 5. Balance summary (only when payments matter)
  const approvedCO = (changeOrders || [])
    .filter((co) => co?.status === 'approved')
    .reduce((s, co) => s + Number(co.amount || 0), 0)
  const ct = Number(contractTotal != null ? contractTotal : total) + approvedCO
  const pp = previouslyPaid != null
    ? Number(previouslyPaid)
    : (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0)
  const br = Math.max(0, ct - pp)

  if (pp > 0 || ct !== total) {
    cursor += 8
    if (cursor > pageHeight - 60) { doc.addPage(); cursor = 18 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...ONYX)
    doc.setCharSpace(0.8)
    doc.text('BALANCE SUMMARY', margin, cursor)
    doc.setCharSpace(0)
    doc.setDrawColor(...ONYX)
    doc.setLineWidth(0.3)
    doc.line(margin, cursor + 2, pageWidth - margin, cursor + 2)
    cursor += 8

    const balanceRows = [
      ['Contract total',  moneyCompact(ct)],
      ['Previously paid', pp > 0 ? `-${moneyCompact(pp)}` : moneyCompact(0)],
      ['This invoice',    moneyCompact(total)]
    ]
    const labelX = margin
    const valueX = pageWidth - margin
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    for (const [l, v] of balanceRows) {
      doc.setTextColor(...INK_MUTED)
      doc.text(l, labelX, cursor)
      doc.setTextColor(...ONYX)
      doc.text(v, valueX, cursor, { align: 'right' })
      cursor += 6
    }
    cursor += 4
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...ONYX)
    doc.setCharSpace(0.8)
    doc.text('BALANCE REMAINING', labelX, cursor)
    doc.setCharSpace(0)
    doc.setFontSize(16)
    doc.setTextColor(...(br > 0.5 ? brandRGB : SIGNAL_GREEN))
    doc.text(br > 0.5 ? moneyCompact(br) : 'PAID', valueX, cursor, { align: 'right' })
    cursor += 8
  }

  // 6. Notes / payment instructions
  if (notes) {
    cursor += 8
    if (cursor > pageHeight - 40) { doc.addPage(); cursor = 18 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...ONYX)
    doc.setCharSpace(0.8)
    doc.text('NOTES', margin, cursor)
    doc.setCharSpace(0)
    cursor += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    const wrapped = doc.splitTextToSize(notes, pageWidth - margin * 2)
    doc.text(wrapped, margin, cursor)
    cursor += wrapped.length * 4.5
  }

  // 6b. Project photos — quiet 2-up strip, capped at 4. Invoice tone
  // is "here's the work you paid for", not the proposal's sales pitch.
  if (Array.isArray(photos) && photos.length > 0) {
    cursor = await drawProjectPhotosBlock(doc, {
      photos: photos.slice(0, 4),
      margin, pageWidth, pageHeight, startY: cursor + 8, brandRGB,
      compact: true
    })
  }

  // 7. Disclaimer (every page footer)
  const total_pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= total_pages; p++) {
    doc.setPage(p)
    drawDocDisclaimer(doc, { pageWidth, pageHeight, margin, text: INVOICE_DISCLAIMER })
  }

  return {
    doc,
    filename: `Invoice_${number}_${(contact?.name || 'client').replace(/\s+/g, '_')}.pdf`,
    number
  }
}

// ============================================================
// V3 letterhead PDF helpers — preserved from earlier passes; some
// remain referenced by the proposal generator below until that's
// also rewritten in the same restrained style.
// ============================================================

function shortDate(iso) {
  if (!iso) return ''
  const d = iso instanceof Date ? iso : new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function drawLetterheadLogo(doc, { x, y, size, company, logo, brandGold }) {
  // Bordered cream square. Holds the logo image when available; falls
  // back to a brand-accent monogram of the company initials.
  doc.setFillColor(255, 252, 246)
  doc.setDrawColor(...brandGold)
  doc.setLineWidth(0.4)
  doc.roundedRect(x, y, size, size, 1.5, 1.5, 'FD')

  if (logo && logo.dataUrl && logo.width > 0 && logo.height > 0) {
    const pad = 2
    const maxW = size - pad * 2
    const maxH = size - pad * 2
    const aspect = logo.width / logo.height
    let w = maxW
    let h = w / aspect
    if (h > maxH) { h = maxH; w = h * aspect }
    try {
      doc.addImage(logo.dataUrl, logo.format || 'PNG', x + (size - w) / 2, y + (size - h) / 2, w, h)
      return
    } catch {
      // fall through to monogram
    }
  }

  const initials = (company?.name || 'MC')
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w[0])
    .join('')
    .toUpperCase()
    .replace(/[^A-Z]/g, '')
    .slice(0, 2) || 'MC'
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...brandGold)
  doc.text(initials, x + size / 2, y + size / 2 + 2, { align: 'center' })
}

function buildLetterheadTagline(company) {
  const addr = (company?.address || '').trim()
  if (!addr) return ''
  const parts = addr.split(',').map((s) => s.trim()).filter(Boolean)
  return parts.length >= 2 ? parts.slice(-2).join(', ') : addr
}

function drawStatusPill(doc, { x, y, label, brandGold }) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setCharSpace(0.6)
  const text = label.toUpperCase()
  const textWidth = doc.getTextWidth(text)
  const padX = 5
  const w = textWidth + padX * 2
  const h = 7
  doc.setFillColor(255, 248, 236)
  doc.setDrawColor(...brandGold)
  doc.setLineWidth(0.35)
  doc.roundedRect(x - w, y - h / 2, w, h, 3.2, 3.2, 'FD')
  doc.setTextColor(...brandGold)
  doc.text(text, x - w / 2, y + 0.7, { align: 'center' })
  doc.setCharSpace(0)
}

function drawMetaGrid(doc, { x, y, width, cols }) {
  if (!cols?.length) return
  const colWidth = width / cols.length

  doc.setDrawColor(213, 207, 190)
  doc.setLineWidth(0.2)
  doc.line(x, y - 4, x + width, y - 4)

  cols.forEach((col, i) => {
    const cx = x + colWidth * i
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...INK_MUTED)
    doc.setCharSpace(0.6)
    doc.text(col.label, cx, y)
    doc.setCharSpace(0)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...(col.valueColor || ONYX))
    if (col.stamp) doc.setCharSpace(0.4)
    doc.text(col.value || '—', cx, y + 6)
    if (col.stamp) doc.setCharSpace(0)
  })
}

function drawTwoColumnPanel(doc, { x, y, width, leftLabel, leftLines, rightLabel, rightLines }) {
  const colW = width / 2
  // Left
  drawColumn(doc, { x, y, colW, label: leftLabel, lines: leftLines })
  // Right
  drawColumn(doc, { x: x + colW, y, colW, label: rightLabel, lines: rightLines })
}

function drawColumn(doc, { x, y, colW, label, lines }) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...INK_MUTED)
  doc.setCharSpace(0.6)
  doc.text(label, x, y)
  doc.setCharSpace(0)
  let ly = y + 6
  lines.forEach((line, i) => {
    const isFirst = i === 0
    doc.setFont('helvetica', isFirst ? 'bold' : 'normal')
    doc.setFontSize(isFirst ? 12 : 9.5)
    doc.setTextColor(...(isFirst ? ONYX : INK_MUTED))
    const wrapped = doc.splitTextToSize(line, colW - 8)
    doc.text(wrapped, x, ly)
    ly += wrapped.length * (isFirst ? 5 : 4.5)
  })
}

function drawSectionHeading(doc, { x, y, width, eyebrow, title, brandGold }) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...brandGold)
  doc.setCharSpace(0.8)
  doc.text(eyebrow, x, y)
  doc.setCharSpace(0)
  doc.setFont('times', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...ONYX)
  doc.text(title, x, y + 7)
  doc.setDrawColor(232, 228, 216)
  doc.setLineWidth(0.2)
  doc.line(x, y + 10, x + width, y + 10)
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
/**
 * Generate a branded proposal PDF — v3 letterhead (Phase 4b parity).
 *
 * Mirrors src/components/documents/ProposalTemplate.jsx section-for-
 * section so the customer sees the same render whether the contractor
 * previewed it on-screen or received it as an email attachment.
 *
 * Sections (multi-page flowing layout — letterhead repeats per page):
 *   1. Letterhead + title + meta grid (page 1 only)
 *   2. Project overview               (boilerplate copy or override)
 *   3. Scope of work                  (per-trade cards from fh_quote_items)
 *   4. Optional upgrades              (is_optional=true items, with pricing)
 *   5. Pricing summary                (Project Investment hero in serif)
 *   6. Payment terms                  (50/40/10 default, configurable)
 *   7. Warranty                       (company.warranty_default when set)
 *   8. Exclusions                     (is_excluded items + exclusions text)
 *   9. Insurance (optional, hidden when no payload)
 *  10. Approval / signature           (blank by default; stamped when approved)
 *
 * White-label: company.name / logo_url / brand_accent_hex drive every
 * customer-visible byte. The app's name never appears.
 *
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
  status = 'draft',
  quoteId,
  approval = null,
  photos = [],
  insurance = null,
  paymentSchedule = null,
  changeOrders = []
} = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 16

  const logo = company?.logo_url
    ? await loadLogoForPdf(company.logo_url, { maxDimension: 720 })
    : null
  const brandRGB = parseBrandAccentRgb(company?.brand_accent_hex) || FIELD_GOLD
  const number = docProposalNumber(company?.name, quoteId || contact?.id)

  // Group items into rows. Each scope section (e.g. "Concrete add on")
  // becomes ONE row, its items collapse into the description column.
  const mapped = mapItemsToScope(items)
  const baseRows = (mapped.scopeSections || []).map((sec) => ({
    title: sec.title,
    descriptionLines: (sec.items || []).map((it) => {
      const qty = Number(it.qty || 1)
      const unit = it.unit ? ` ${it.unit}` : ''
      return qty !== 1
        ? `${qty}${unit} · ${it.description || '—'}`
        : (it.description || '—')
    }),
    qty: 1,
    rate: (sec.items || []).reduce((s, it) => s + Number(it.amount != null ? it.amount : (Number(it.qty || 1) * Number(it.rate || 0))), 0),
    amount: (sec.items || []).reduce((s, it) => s + Number(it.amount != null ? it.amount : (Number(it.qty || 1) * Number(it.rate || 0))), 0)
  }))

  const upgradeRows = (mapped.upgrades || []).map((sec) => ({
    title: sec.title,
    descriptionLines: (sec.items || []).map((it) => it.description || '—'),
    qty: 1,
    rate: (sec.items || []).reduce((s, it) => s + Number(it.amount != null ? it.amount : (Number(it.qty || 1) * Number(it.rate || 0))), 0),
    amount: (sec.items || []).reduce((s, it) => s + Number(it.amount != null ? it.amount : (Number(it.qty || 1) * Number(it.rate || 0))), 0)
  }))

  const approvedCOAdjustment = (changeOrders || [])
    .filter((co) => co?.status === 'approved')
    .reduce((s, co) => s + Number(co.amount || 0), 0)

  const baseTotal = Number(mapped.baseTotal || 0)
  const upgradeTotal = Number(mapped.upgradeTotal || 0)
  const grandTotal = Math.max(0, baseTotal + approvedCOAdjustment)

  // Letterhead
  let cursor = drawDocLetterhead(doc, {
    pageWidth, margin, docType: 'ESTIMATE',
    number: shortDocNumber(number),
    issuedAt: new Date(),
    company, logo, brandRGB
  })

  // Parties
  cursor = drawDocParties(doc, {
    pageWidth, margin, y: cursor + 6,
    recipient: contact, company
  })

  // Items
  if (baseRows.length > 0) {
    cursor = drawDocItemsTable(doc, { startY: cursor + 4, rows: baseRows, brandRGB, margin, pageWidth })
  }

  // Totals
  const totalsRows = []
  if (approvedCOAdjustment !== 0) {
    totalsRows.push({ label: 'Subtotal', value: moneyCompact(baseTotal) })
    totalsRows.push({ label: 'Approved change orders', value: `${approvedCOAdjustment >= 0 ? '+' : ''}${moneyCompact(approvedCOAdjustment)}` })
  }
  cursor = drawDocTotalsBlock(doc, {
    startY: cursor, pageWidth, margin,
    label: 'Total', total: grandTotal, rows: totalsRows
  })

  // Optional upgrades
  if (upgradeRows.length > 0) {
    cursor += 6
    if (cursor > pageHeight - 80) { doc.addPage(); cursor = 18 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...ONYX)
    doc.setCharSpace(0.6)
    doc.text('OPTIONAL UPGRADES', margin, cursor)
    doc.setCharSpace(0)
    cursor += 4
    cursor = drawDocItemsTable(doc, { startY: cursor, rows: upgradeRows, brandRGB, margin, pageWidth })
  }

  // Project photos — pre-load the signed URLs into base64 PNGs through
  // the same logo loader so the PDF carries embedded imagery. Renders
  // a grouped grid by section_tag below the items + upgrades tables.
  if (Array.isArray(photos) && photos.length > 0) {
    cursor = await drawProjectPhotosBlock(doc, {
      photos, margin, pageWidth, pageHeight, startY: cursor + 6, brandRGB
    })
  }

  // Editorial detail blocks (payment terms, warranty, exclusions)
  const warranty = (company?.warranty_default || '').trim()
  const exclusionsArray = [
    ...(mapped.exclusions || []),
    ...((exclusions || '').split(/\n+/).map((s) => s.trim()).filter(Boolean))
  ]

  function drawDetailBlock(label, body) {
    if (!body) return
    cursor += 8
    if (cursor > pageHeight - 40) { doc.addPage(); cursor = 18 }
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(9)
    doc.setTextColor(...ONYX)
    doc.setCharSpace(0.8)
    doc.text(label.toUpperCase(), margin, cursor)
    doc.setCharSpace(0)
    cursor += 5
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(58, 56, 51)
    const lines = doc.splitTextToSize(body, pageWidth - margin * 2)
    doc.text(lines, margin, cursor)
    cursor += lines.length * 4.5
  }

  drawDetailBlock('Payment terms', '50% deposit due upon approval · 40% due at material delivery or midpoint · 10% due upon substantial completion.')
  if (warranty)                drawDetailBlock('Warranty', warranty)
  if (exclusionsArray.length)  drawDetailBlock('Exclusions', exclusionsArray.join(' · '))

  // Approval signature lines
  cursor += 14
  if (cursor > pageHeight - 60) { doc.addPage(); cursor = 18 }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...ONYX)
  doc.setCharSpace(0.8)
  doc.text('APPROVAL', margin, cursor)
  doc.setCharSpace(0)
  cursor += 4
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(58, 56, 51)
  const approvalLines = doc.splitTextToSize(
    'By signing below, the customer authorizes the company to perform the work outlined in this estimate and agrees to the terms and conditions contained herein.',
    pageWidth - margin * 2
  )
  doc.text(approvalLines, margin, cursor)
  cursor += approvalLines.length * 4.5 + 16

  // Two signature lines
  const colW = (pageWidth - margin * 2 - 16) / 2
  doc.setDrawColor(...ONYX)
  doc.setLineWidth(0.4)
  doc.line(margin, cursor, margin + colW, cursor)
  doc.line(margin + colW + 16, cursor, pageWidth - margin, cursor)
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...INK_MUTED)
  doc.setCharSpace(0.6)
  doc.text('CLIENT SIGNATURE', margin, cursor + 5)
  doc.text('CONTRACTOR SIGNATURE', margin + colW + 16, cursor + 5)
  doc.setCharSpace(0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text('Date', margin + colW, cursor + 5, { align: 'right' })
  doc.text('Date', pageWidth - margin, cursor + 5, { align: 'right' })

  // Disclaimer on every page
  const total_pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= total_pages; p++) {
    doc.setPage(p)
    drawDocDisclaimer(doc, { pageWidth, pageHeight, margin, text: PROPOSAL_DISCLAIMER })
  }

  return {
    doc,
    filename: `Proposal_${number}_${(contact?.name || 'client').replace(/\s+/g, '_')}.pdf`,
    number
  }
}

// ============================================================
// V3 proposal section drawers
// All take `ctx` (the shared render context) and `cursor` (current Y
// position) and return the new cursor Y. Each handles its own page-
// break check via ensureSpace(ctx, neededHeight).
// ============================================================

function drawProposalLetterhead(ctx, { page }) {
  const { doc, pageWidth, margin, brandGold, company, logo, contact, number, issuedAt, expiresAt, status, contentWidth } = ctx

  // Top brand-accent rule
  doc.setFillColor(...brandGold)
  doc.rect(0, 0, pageWidth, 1.6, 'F')

  const letterheadY = 10
  const logoBoxSize = 18

  drawLetterheadLogo(doc, {
    x: margin, y: letterheadY, size: logoBoxSize, company, logo, brandGold
  })

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(16)
  doc.setTextColor(...ONYX)
  doc.setCharSpace(0.6)
  doc.text((company?.name || 'MY COMPANY').toUpperCase(), margin + logoBoxSize + 6, letterheadY + 7.5)
  doc.setCharSpace(0)

  const tagline = buildLetterheadTagline(company)
  if (tagline) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK_MUTED)
    doc.text(tagline, margin + logoBoxSize + 6, letterheadY + 13)
  }

  drawStatusPill(doc, {
    x: pageWidth - margin, y: letterheadY + 6,
    label: proposalStatusLabel(status), brandGold
  })

  // Continuation pages skip the title + meta block (just letterhead +
  // a thin "PROPOSAL · #" eyebrow so the reader knows what they're in).
  if (page > 1) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...INK_MUTED)
    doc.setCharSpace(0.8)
    doc.text(`PROPOSAL · ${number} · CONTINUED`, margin, letterheadY + logoBoxSize + 8)
    doc.setCharSpace(0)
    return letterheadY + logoBoxSize + 16
  }

  // Title block
  const titleY = letterheadY + logoBoxSize + 12
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...brandGold)
  doc.setCharSpace(0.8)
  doc.text('PROPOSAL', margin, titleY)
  doc.setCharSpace(0)

  const titleText = (contact?.job_title || 'Construction services').trim()
  doc.setFont('times', 'bold')
  let titleSize = 22
  doc.setFontSize(titleSize)
  while (doc.getTextWidth(titleText) > contentWidth && titleSize > 14) {
    titleSize -= 1
    doc.setFontSize(titleSize)
  }
  doc.setTextColor(...ONYX)
  doc.text(titleText, margin, titleY + 9)

  if (contact?.address) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...INK_MUTED)
    doc.text(String(contact.address), margin, titleY + 15)
  }

  // Meta grid
  const metaY = titleY + 26
  drawMetaGrid(doc, {
    x: margin, y: metaY, width: contentWidth,
    cols: [
      { label: 'CLIENT',       value: contact?.name || '—' },
      { label: 'ISSUED',       value: today() },
      { label: 'VALID UNTIL',  value: expiresAt ? formatLongDate(new Date(expiresAt)) : 'Open' },
      { label: 'PROPOSAL #',   value: number, stamp: true, valueColor: brandGold }
    ]
  })
  return metaY + 18
}

function proposalStatusLabel(status) {
  switch (String(status || 'draft').toLowerCase()) {
    case 'approved': return 'APPROVED'
    case 'sent':     return 'SENT'
    case 'expired':  return 'EXPIRED'
    case 'rejected': return 'REJECTED'
    default:         return 'PROPOSAL'
  }
}

// Page-break helper. If the requested block height doesn't fit before
// the page bottom (with footer clearance), open a new page, redraw the
// continuation letterhead, and return the fresh cursor Y.
function ensureSpace(ctx, cursor, needed) {
  const { doc, pageHeight } = ctx
  const footerClearance = 16
  if (cursor + needed <= pageHeight - footerClearance) return cursor
  doc.addPage()
  return drawProposalLetterhead(ctx, { page: 2 })
}

function drawProjectOverviewSection(ctx, cursor) {
  const { doc, margin, contentWidth, brandGold, company, contact, scope } = ctx

  cursor += 6
  cursor = ensureSpace(ctx, cursor, 40)

  drawSectionHeading(doc, {
    x: margin, y: cursor, width: contentWidth,
    eyebrow: 'PROJECT OVERVIEW',
    title: "What we'll build",
    brandGold
  })
  cursor += 14

  const body = scope?.trim()
    || buildProposalOverviewCopy(company?.name, contact?.address)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor(...ONYX)
  const wrapped = doc.splitTextToSize(body, contentWidth)
  // Page-break for very long overview
  cursor = drawTextWithPageBreak(ctx, wrapped, cursor, 5)
  return cursor + 6
}

function buildProposalOverviewCopy(companyName, address) {
  const c = (companyName && String(companyName).trim()) || 'Our company'
  const a = (address && String(address).trim()) || 'the project site'
  return `${c} proposes the following scope of work for the improvement and restoration of the property located at ${a}. Our team will provide labor, materials, project coordination, site protection, cleanup, and installation services necessary to complete the project in accordance with manufacturer standards and applicable code requirements.`
}

function drawScopeOfWorkSection(ctx, cursor) {
  const { doc, margin, contentWidth, brandGold, scopeSections } = ctx

  cursor += 6
  cursor = ensureSpace(ctx, cursor, 60)

  drawSectionHeading(doc, {
    x: margin, y: cursor, width: contentWidth,
    eyebrow: `SCOPE OF WORK · ${scopeSections.length} SECTION${scopeSections.length === 1 ? '' : 'S'}`,
    title: 'Trades and materials',
    brandGold
  })
  cursor += 14

  for (const section of scopeSections) {
    const sectionPhotos = ctx.photosBySection?.get?.(section.title) || []
    cursor = drawScopeCard(ctx, cursor, {
      title: section.title,
      items: section.items,
      photos: sectionPhotos,
      showPricing: false
    })
    cursor += 6
  }
  return cursor
}

function drawUpgradesSection(ctx, cursor) {
  const { doc, margin, contentWidth, brandGold, upgrades } = ctx

  cursor += 6
  cursor = ensureSpace(ctx, cursor, 60)

  drawSectionHeading(doc, {
    x: margin, y: cursor, width: contentWidth,
    eyebrow: 'OPTIONAL UPGRADES',
    title: 'Add at any time',
    brandGold
  })
  cursor += 14

  for (const section of upgrades) {
    cursor = drawScopeCard(ctx, cursor, {
      title: section.title,
      items: section.items,
      showPricing: true
    })
    cursor += 6
  }
  return cursor
}

// Per-trade scope card. Mirrors ScopeSectionCard.jsx visually:
//   - title row
//   - line items list (with optional pricing column)
function drawScopeCard(ctx, cursor, { title, items, photos = [], showPricing }) {
  const { doc, margin, contentWidth, brandGold } = ctx

  // Estimate card height: header (10) + per-item (≈ 8) + photo strip
  // when present (≈ 38) + padding (10).
  const photoStripHeight = photos.length > 0 ? 38 : 0
  const estimated = 20 + (items.length * 9) + photoStripHeight
  cursor = ensureSpace(ctx, cursor, estimated)

  const cardX = margin
  const cardY = cursor
  const cardW = contentWidth
  const padding = 6

  // Card title bar
  doc.setFont('times', 'bold')
  doc.setFontSize(13)
  doc.setTextColor(...ONYX)
  doc.text(title || 'Untitled section', cardX + padding, cardY + 8)

  let rowY = cardY + 14
  doc.setDrawColor(...brandGold)
  doc.setLineWidth(0.4)
  doc.line(cardX, rowY, cardX + cardW, rowY)
  rowY += 4

  // Items
  for (const it of items) {
    const qty = Number(it.qty || 1)
    const rate = Number(it.rate || 0)
    const amount = Number(it.amount != null ? it.amount : qty * rate)
    const subline = [
      qty !== 1 ? `${qty}${it.unit ? ` ${it.unit}` : ''} × ${money(rate)}` : '',
      it.notes
    ].filter(Boolean).join(' · ')

    // Title (wrap)
    const titleMax = showPricing ? cardW - padding * 2 - 36 : cardW - padding * 2
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...ONYX)
    const wrapped = doc.splitTextToSize(it.description || '—', titleMax)
    doc.text(wrapped, cardX + padding, rowY + 4)
    let bottom = rowY + 4 + (wrapped.length - 1) * 5

    if (subline) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...INK_MUTED)
      doc.text(subline, cardX + padding, bottom + 4.5)
      bottom += 4.5
    }

    if (showPricing) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(10.5)
      doc.setTextColor(...ONYX)
      doc.text(money(amount), cardX + cardW - padding, rowY + 4, { align: 'right' })
    }

    rowY = bottom + 5
    // Inter-item hairline
    doc.setDrawColor(232, 228, 216)
    doc.setLineWidth(0.15)
    doc.line(cardX + padding, rowY - 2.5, cardX + cardW - padding, rowY - 2.5)
  }

  // Photos — render up to 3 thumbnails along the bottom of the card.
  // Skipped silently if no photos tagged to this section.
  if (photos.length > 0) {
    const slots = Math.min(3, photos.length)
    const slotGap = 4
    const totalGap = slotGap * (slots - 1)
    const slotW = (cardW - padding * 2 - totalGap) / slots
    const slotH = 28
    rowY += 2
    for (let i = 0; i < slots; i++) {
      const p = photos[i]
      const px = cardX + padding + (slotW + slotGap) * i
      const py = rowY
      // Frame (renders even if image fails)
      doc.setDrawColor(232, 228, 216)
      doc.setFillColor(251, 248, 241)
      doc.setLineWidth(0.2)
      doc.roundedRect(px, py, slotW, slotH, 1, 1, 'FD')
      if (p?.dataUrl) {
        try {
          // Center-cover the image inside the slot. jsPDF can't crop,
          // so we letterbox by computing the aspect-fit dimensions and
          // centering. Bad images (decode failures) fall through to the
          // empty cream frame above.
          const aspect = (p.width || 4) / (p.height || 3)
          let drawW = slotW - 2
          let drawH = drawW / aspect
          if (drawH > slotH - 2) {
            drawH = slotH - 2
            drawW = drawH * aspect
          }
          doc.addImage(p.dataUrl, p.format || 'PNG', px + (slotW - drawW) / 2, py + (slotH - drawH) / 2, drawW, drawH)
        } catch {
          // empty frame stays
        }
      }
    }
    rowY += slotH + 4
  }

  // Card border (drawn last so it overlays cleanly)
  const cardH = rowY - cardY + 2
  doc.setDrawColor(232, 228, 216)
  doc.setLineWidth(0.3)
  doc.roundedRect(cardX, cardY, cardW, cardH, 1.5, 1.5, 'S')

  return cardY + cardH + 2
}

function drawPricingSummarySection(ctx, cursor) {
  const { doc, pageWidth, margin, contentWidth, brandGold, pricing, grandTotal } = ctx

  cursor += 6
  cursor = ensureSpace(ctx, cursor, 70)

  drawSectionHeading(doc, {
    x: margin, y: cursor, width: contentWidth,
    eyebrow: 'PRICING SUMMARY',
    title: 'Investment',
    brandGold
  })
  cursor += 14

  // Card
  const cardX = margin
  const cardY = cursor
  const cardW = contentWidth
  // Reserve enough height: subordinate rows + hero
  const rowCount = 1 + (pricing.upgradeTotal > 0 ? 1 : 0) + (pricing.discount > 0 ? 1 : 0) + (pricing.taxRate > 0 ? 1 : 0)
  const cardH = 24 + rowCount * 6 + 24

  doc.setFillColor(251, 248, 241)
  doc.setDrawColor(213, 207, 190)
  doc.setLineWidth(0.3)
  doc.roundedRect(cardX, cardY, cardW, cardH, 1.5, 1.5, 'FD')

  let rowY = cardY + 8
  drawPricingRow(doc, cardX + 10, cardW - 20, rowY, 'Base scope', money(pricing.baseTotal))
  rowY += 6
  if (pricing.upgradeTotal > 0) {
    drawPricingRow(doc, cardX + 10, cardW - 20, rowY, 'Selected upgrades', money(pricing.upgradeTotal))
    rowY += 6
  }
  if (pricing.discount > 0) {
    drawPricingRow(doc, cardX + 10, cardW - 20, rowY, 'Discount', `-${money(pricing.discount)}`, true)
    rowY += 6
  }
  if (pricing.taxRate > 0) {
    drawPricingRow(doc, cardX + 10, cardW - 20, rowY, `Tax · ${(pricing.taxRate * 100).toFixed(2)}%`, money(pricing.baseTotal * pricing.taxRate))
    rowY += 6
  }

  // Hero divider + Project Investment label + amount
  rowY += 4
  doc.setDrawColor(...brandGold)
  doc.setLineWidth(0.4)
  doc.line(cardX + 10, rowY, cardX + cardW - 10, rowY)
  rowY += 8

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...INK_MUTED)
  doc.setCharSpace(0.6)
  doc.text('PROJECT INVESTMENT', cardX + 10, rowY)
  doc.setCharSpace(0)

  doc.setFont('times', 'bold')
  doc.setFontSize(26)
  doc.setTextColor(...brandGold)
  doc.text(money(grandTotal), cardX + cardW - 10, rowY + 3, { align: 'right' })

  return cardY + cardH + 6
}

function drawPricingRow(doc, x, w, y, label, value, muted = false) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...INK_MUTED)
  doc.text(label, x, y)
  doc.setFont('helvetica', 'bold')
  doc.setTextColor(...(muted ? INK_MUTED : ONYX))
  doc.text(value, x + w, y, { align: 'right' })
}

function drawPaymentTermsSection(ctx, cursor) {
  const { doc, margin, contentWidth, brandGold, paymentSchedule, grandTotal } = ctx

  cursor += 6
  cursor = ensureSpace(ctx, cursor, 30 + paymentSchedule.length * 12)

  drawSectionHeading(doc, {
    x: margin, y: cursor, width: contentWidth,
    eyebrow: 'PAYMENT TERMS',
    title: 'Milestone schedule',
    brandGold
  })
  cursor += 14

  for (let i = 0; i < paymentSchedule.length; i++) {
    const row = paymentSchedule[i]
    const pct = Number(row.pct || 0)
    const amt = Math.round(grandTotal * (pct / 100))

    const rowY = cursor + 7

    // Stamped percent
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(13)
    doc.setTextColor(...brandGold)
    doc.text(`${pct}%`, margin, rowY)

    // Label + sub
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...ONYX)
    doc.text(row.label || '—', margin + 22, rowY)
    if (row.sub) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...INK_MUTED)
      doc.text(row.sub, margin + 22, rowY + 5)
    }

    // Amount
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...ONYX)
    doc.text(money(amt), margin + contentWidth, rowY, { align: 'right' })

    cursor += 13
    if (i < paymentSchedule.length - 1) {
      doc.setDrawColor(232, 228, 216)
      doc.setLineWidth(0.15)
      doc.line(margin, cursor - 1, margin + contentWidth, cursor - 1)
    }
  }
  return cursor + 6
}

function drawWarrantySection(ctx, cursor) {
  const { doc, margin, contentWidth, brandGold, warranty } = ctx

  cursor += 6
  cursor = ensureSpace(ctx, cursor, 40)

  drawSectionHeading(doc, {
    x: margin, y: cursor, width: contentWidth,
    eyebrow: 'WARRANTY',
    title: 'What we stand behind',
    brandGold
  })
  cursor += 14

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor(...ONYX)
  const wrapped = doc.splitTextToSize(warranty, contentWidth)
  cursor = drawTextWithPageBreak(ctx, wrapped, cursor, 5)
  return cursor + 6
}

function drawExclusionsSection(ctx, cursor) {
  const { doc, margin, contentWidth, brandGold, exclusionsArray } = ctx

  cursor += 6
  cursor = ensureSpace(ctx, cursor, 30 + exclusionsArray.length * 7)

  drawSectionHeading(doc, {
    x: margin, y: cursor, width: contentWidth,
    eyebrow: 'EXCLUSIONS',
    title: 'Not included in this proposal',
    brandGold
  })
  cursor += 14

  for (const exclusion of exclusionsArray) {
    cursor = ensureSpace(ctx, cursor, 8)
    // Bullet dot
    doc.setFillColor(...INK_MUTED)
    doc.circle(margin + 1.5, cursor + 1, 0.8, 'F')
    // Text (wrap)
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...ONYX)
    const wrapped = doc.splitTextToSize(exclusion, contentWidth - 8)
    doc.text(wrapped, margin + 6, cursor + 2)
    cursor += Math.max(6, wrapped.length * 4.5) + 1
  }
  return cursor + 4
}

function drawInsuranceSection(ctx, cursor) {
  const { doc, margin, contentWidth, brandGold, insurance } = ctx

  const fields = [
    { label: 'Claim number',     value: insurance.claim_number },
    { label: 'Carrier',          value: insurance.carrier },
    { label: 'Adjuster',         value: insurance.adjuster },
    { label: 'Deductible',       value: insurance.deductible != null ? money(insurance.deductible) : '' },
    { label: 'RCV',              value: insurance.rcv != null ? money(insurance.rcv) : '' },
    { label: 'ACV',              value: insurance.acv != null ? money(insurance.acv) : '' },
    { label: 'Depreciation',     value: insurance.depreciation != null ? money(insurance.depreciation) : '' },
    { label: 'Supplement',       value: insurance.supplement_amount != null ? money(insurance.supplement_amount) : '' },
    { label: 'Mortgage company', value: insurance.mortgage_company }
  ].filter((f) => f.value)
  if (!fields.length) return cursor

  cursor += 6
  cursor = ensureSpace(ctx, cursor, 50 + Math.ceil(fields.length / 3) * 14)

  drawSectionHeading(doc, {
    x: margin, y: cursor, width: contentWidth,
    eyebrow: 'INSURANCE CLAIM',
    title: 'Carrier-side details',
    brandGold
  })
  cursor += 14

  // Card backdrop
  const cardY = cursor
  const cardH = Math.ceil(fields.length / 3) * 14 + 6
  doc.setFillColor(251, 248, 241)
  doc.setDrawColor(...brandGold)
  doc.setLineWidth(0.4)
  doc.roundedRect(margin, cardY, contentWidth, cardH, 1.5, 1.5, 'FD')

  // 3-col grid
  const colW = contentWidth / 3
  fields.forEach((f, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const cx = margin + colW * col + 8
    const cy = cardY + 7 + row * 14
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7)
    doc.setTextColor(...INK_MUTED)
    doc.setCharSpace(0.6)
    doc.text(f.label.toUpperCase(), cx, cy)
    doc.setCharSpace(0)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...ONYX)
    doc.text(String(f.value), cx, cy + 5)
  })

  return cardY + cardH + 6
}

function drawApprovalSection(ctx, cursor) {
  const { doc, margin, contentWidth, brandGold, company, contact, approval } = ctx

  cursor += 8
  cursor = ensureSpace(ctx, cursor, 90)

  drawSectionHeading(doc, {
    x: margin, y: cursor, width: contentWidth,
    eyebrow: 'APPROVAL',
    title: 'Authorization to proceed',
    brandGold
  })
  cursor += 14

  // Authorization paragraph
  const copy = 'By signing below, the customer authorizes the company to perform the work outlined in this proposal and agrees to the terms and conditions contained herein.'
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(...ONYX)
  const wrapped = doc.splitTextToSize(copy, contentWidth)
  doc.text(wrapped, margin, cursor)
  cursor += wrapped.length * 4.8 + 8

  // Two signature fields side by side
  const colW = (contentWidth - 12) / 2
  const sigY = cursor + 22
  const labelY = sigY + 4

  // Left — Client
  drawSignatureField(ctx, {
    x: margin, y: cursor, w: colW,
    label: 'Client signature',
    name: approval?.clientName || contact?.name,
    dataUrl: approval?.mode === 'approved' ? approval?.clientSignatureDataUrl : null,
    date: approval?.mode === 'approved' && approval?.clientApprovedAt
      ? formatLongDate(new Date(approval.clientApprovedAt)) : ''
  })

  // Right — Contractor
  drawSignatureField(ctx, {
    x: margin + colW + 12, y: cursor, w: colW,
    label: 'Contractor signature',
    name: company?.name,
    dataUrl: approval?.mode === 'approved' ? approval?.contractorSignatureDataUrl : null,
    date: approval?.mode === 'approved' && approval?.contractorApprovedAt
      ? formatLongDate(new Date(approval.contractorApprovedAt)) : ''
  })

  return cursor + 40
}

function drawSignatureField(ctx, { x, y, w, label, name, dataUrl, date }) {
  const { doc } = ctx

  // Stamped signature image (if approved)
  if (dataUrl) {
    try {
      doc.addImage(dataUrl, 'PNG', x, y, Math.min(w, 60), 18)
    } catch {
      // fall through to typed name
      doc.setFont('times', 'italic')
      doc.setFontSize(18)
      doc.setTextColor(...INK_MUTED)
      doc.text(name || '', x, y + 14)
    }
  } else if (name) {
    // Typed name in italic when present
    doc.setFont('times', 'italic')
    doc.setFontSize(16)
    doc.setTextColor(...INK_MUTED)
    doc.text(name, x, y + 16)
  }

  // Signature line
  doc.setDrawColor(...ONYX)
  doc.setLineWidth(0.4)
  doc.line(x, y + 22, x + w, y + 22)

  // Label + date row
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...INK_MUTED)
  doc.setCharSpace(0.6)
  doc.text(label.toUpperCase(), x, y + 27)
  doc.setCharSpace(0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Date${date ? `: ${date}` : ''}`, x + w, y + 27, { align: 'right' })
}

function drawTextWithPageBreak(ctx, lines, cursor, lineHeight) {
  for (const line of lines) {
    cursor = ensureSpace(ctx, cursor, lineHeight + 1)
    ctx.doc.text(line, ctx.margin, cursor + lineHeight - 1)
    cursor += lineHeight
  }
  return cursor
}

// Drawn last after all sections so we know totalPages.
function drawProposalFooters(ctx) {
  const { doc, pageWidth, pageHeight, company } = ctx

  const trustParts = [
    company?.license_number ? `LIC #${String(company.license_number).trim()}` : '',
    company?.insured_text ? String(company.insured_text).trim() : ''
  ].filter(Boolean)
  const contactParts = [
    company?.name,
    company?.phone,
    company?.email,
    company?.website
  ]
    .map((s) => (s && String(s).trim()) || '')
    .filter(Boolean)
  const trustLine = trustParts.join(' · ').toUpperCase()
  const contactLine = contactParts.join(' · ')

  const total = doc.internal.getNumberOfPages()
  for (let p = 1; p <= total; p++) {
    doc.setPage(p)

    // Hairline
    doc.setDrawColor(220, 215, 205)
    doc.setLineWidth(0.2)
    doc.line(16, pageHeight - 16, pageWidth - 16, pageHeight - 16)

    // Left — contact line
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK_MUTED)
    if (contactLine) doc.text(contactLine, 16, pageHeight - 10)

    // Right — page number + trust (alternate lines)
    doc.text(`Page ${p} of ${total}`, pageWidth - 16, pageHeight - 10, { align: 'right' })
    if (trustLine && p === total) {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.text(trustLine, pageWidth - 16, pageHeight - 6, { align: 'right' })
    }
  }
}

// Renders the Change Orders section on both the invoice + proposal PDFs.
// Mirrors ChangeOrdersBlock.jsx visually: CO # · title · description ·
// amount (positive = additive, negative = credit in signal-green).
function drawChangeOrdersSection(ctx, cursor) {
  const { doc, margin, contentWidth, brandGold, changeOrders } = ctx
  if (!changeOrders?.length) return cursor

  cursor += 6
  cursor = ensureSpace(ctx, cursor, 30 + changeOrders.length * 18)

  drawSectionHeading(doc, {
    x: margin, y: cursor, width: contentWidth,
    eyebrow: `CHANGE ORDERS · ${changeOrders.length} ORDER${changeOrders.length === 1 ? '' : 'S'}`,
    title: 'Contract amendments',
    brandGold
  })
  cursor += 14

  for (let i = 0; i < changeOrders.length; i++) {
    const co = changeOrders[i]
    cursor = ensureSpace(ctx, cursor, 18)
    const amt = Number(co.amount || 0)
    const isCredit = amt < 0

    // CO # stamp
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10)
    doc.setTextColor(...brandGold)
    doc.text(`CO #${co.sequence_number || (i + 1)}`, margin, cursor + 4)

    // Title
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...ONYX)
    const titleX = margin + 22
    const amountX = margin + contentWidth
    const titleMax = amountX - titleX - 26
    const titleLines = doc.splitTextToSize(co.title || 'Change order', titleMax)
    doc.text(titleLines, titleX, cursor + 4)
    let rowBottom = cursor + 4 + (titleLines.length - 1) * 5

    // Status badge (only when not draft — keeps the row tight)
    if (co.status === 'approved') {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(...SIGNAL_GREEN)
      doc.setCharSpace(0.6)
      const stamp = co.approved_at
        ? `APPROVED · ${shortDate(co.approved_at).toUpperCase()}`
        : 'APPROVED'
      doc.text(stamp, titleX, rowBottom + 4)
      doc.setCharSpace(0)
      rowBottom += 4
    } else if (co.status === 'draft') {
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(7)
      doc.setTextColor(...INK_MUTED)
      doc.setCharSpace(0.6)
      doc.text('DRAFT', titleX, rowBottom + 4)
      doc.setCharSpace(0)
      rowBottom += 4
    }

    // Description (truncated)
    if (co.description) {
      doc.setFont('helvetica', 'normal')
      doc.setFontSize(9)
      doc.setTextColor(...INK_MUTED)
      const descLines = doc.splitTextToSize(co.description, titleMax)
      const descShow = descLines.slice(0, 2)
      doc.text(descShow, titleX, rowBottom + 4.5)
      rowBottom += descShow.length * 4
    }

    // Amount (right)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...(isCredit ? SIGNAL_GREEN : ONYX))
    doc.text(
      isCredit ? `-${money(Math.abs(amt))}` : `+${money(amt)}`,
      amountX, cursor + 4, { align: 'right' }
    )

    cursor = rowBottom + 6
    doc.setDrawColor(232, 228, 216)
    doc.setLineWidth(0.15)
    doc.line(margin, cursor - 2, margin + contentWidth, cursor - 2)
  }
  return cursor + 4
}

function groupPhotosBySection(photos = []) {
  const map = new Map()
  for (const p of photos || []) {
    const key = (p.section_tag || 'General').trim() || 'General'
    if (!map.has(key)) map.set(key, [])
    map.get(key).push(p)
  }
  return map
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

/**
 * Utility: save a jsPDF doc from the result of generate* functions.
/**
 * Generate a one-page Certificate of Completion PDF from a saved
 * fh_closeouts row. Same editorial chrome as the invoice/proposal —
 * branded logo letterhead, gold rule, parties block — followed by:
 *
 *   • Project block — name + address + completion date
 *   • Warranty block — start date + duration + computed end date
 *   • Sign-off block — customer name + method + signed-on date
 *   • Closing notes (when present)
 *   • Final figures (contract / paid / balance)
 *   • Two-line signature/date footer the customer can sign on paper
 *
 * Returns { doc, filename } so the existing downloadPdf() helper can
 * trip the browser save. Async because drawDocLogo loads the brand
 * image (via loadLogoForPdf).
 */
export async function generateCertificate({
  company = {},
  contact = {},
  closeout = {},
  options = {}
} = {}) {
  const doc = new jsPDF({ unit: 'mm', format: 'letter' })
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 18

  const brandRGB = parseBrandRGB(company.brand_accent_hex) || FIELD_GOLD
  const logo = company.logo_url ? await loadLogoForPdf(company.logo_url) : null

  // Cream paper backdrop
  doc.setFillColor(...RAW_LINEN)
  doc.rect(0, 0, pageWidth, pageHeight, 'F')

  // Letterhead — logo on left, COMPLETION CERTIFICATE on right
  const closedAt = closeout.closed_at || closeout.signoff_at || new Date().toISOString()
  let cursor = drawDocLetterhead(doc, {
    pageWidth, margin,
    docType: 'COMPLETION CERTIFICATE',
    number: shortDocNumber(closeout.id || contact.id) || '—',
    issuedAt: closedAt,
    company, logo, brandRGB
  })

  // Recipient + sender
  cursor = drawDocParties(doc, {
    pageWidth, margin,
    y: cursor + 4,
    recipient: contact,
    company
  })

  cursor += 8

  // Headline — large serif-ish (jsPDF doesn't ship a serif by default,
  // helvetica bold reads as the closest premium analog at this size).
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(24)
  doc.setTextColor(...ONYX)
  doc.text('Certificate of Completion', margin, cursor)
  cursor += 8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(11)
  doc.setTextColor(...INK_MUTED)
  const subline = `${company.name || 'Contractor'} certifies that the work described below was completed for ${contact.name || 'the customer'} on ${formatDocDate(closedAt)}.`
  const sublines = doc.splitTextToSize(subline, pageWidth - margin * 2)
  doc.text(sublines, margin, cursor)
  cursor += sublines.length * 5 + 4

  // Section: Project
  cursor = drawCertSection(doc, {
    margin, pageWidth, y: cursor, brandRGB,
    label: 'Project',
    rows: [
      { k: 'Job', v: contact.job_title || contact.name || '—' },
      { k: 'Address', v: contact.address || '—' },
      { k: 'Completed on', v: formatDocDate(closedAt) }
    ]
  })

  // Section: Warranty
  const months = Number(closeout.warranty_months) || 0
  const warrantyStart = closeout.warranty_start_date || null
  const warrantyEnd = warrantyStart && months > 0 ? addMonthsIso(warrantyStart, months) : null
  cursor = drawCertSection(doc, {
    margin, pageWidth, y: cursor, brandRGB,
    label: 'Warranty',
    rows: months > 0
      ? [
          { k: 'Coverage', v: months === 12 ? '1 year' : months === 24 ? '2 years' : `${months} months` },
          { k: 'Starts', v: warrantyStart ? formatDocDate(warrantyStart) : '—' },
          { k: 'Through', v: warrantyEnd ? formatDocDate(warrantyEnd) : '—' }
        ]
      : [
          { k: 'Coverage', v: 'No express warranty included.' }
        ]
  })

  // Section: Sign-off
  const methodLabel = ({
    verbal: 'Verbal confirmation',
    text: 'Text confirmation',
    email: 'Email confirmation',
    in_person: 'In-person walkthrough',
    signature_typed: 'Typed signature'
  })[closeout.signoff_method] || 'Verbal confirmation'
  cursor = drawCertSection(doc, {
    margin, pageWidth, y: cursor, brandRGB,
    label: 'Customer sign-off',
    rows: [
      { k: 'Signed by', v: closeout.signoff_name || contact.name || '—' },
      { k: 'Method', v: methodLabel },
      { k: 'Signed on', v: closeout.signoff_at ? formatDocDate(closeout.signoff_at) : formatDocDate(closedAt) }
    ]
  })

  // Closing notes
  if (closeout.notes && String(closeout.notes).trim()) {
    cursor = drawCertSection(doc, {
      margin, pageWidth, y: cursor, brandRGB,
      label: 'Closing notes',
      bodyText: String(closeout.notes).trim()
    })
  }

  // Final figures
  const contract = Number(closeout.final_amount || contact.amount || 0)
  const paid = Number(closeout.paid_at_close || 0)
  const balance = Math.max(0, contract - paid)
  cursor = drawCertSection(doc, {
    margin, pageWidth, y: cursor, brandRGB,
    label: 'Final figures',
    rows: [
      { k: 'Contract', v: moneyCompact(contract) },
      { k: 'Paid to date', v: moneyCompact(paid) },
      { k: balance > 0 ? 'Outstanding' : 'Status', v: balance > 0 ? moneyCompact(balance) : 'Paid in full' }
    ]
  })

  // Physical signature footer — two underlines for customer + contractor.
  // Positioned a fixed distance above the page bottom so re-flow doesn't
  // shove it off-page when notes/sections grow.
  const sigY = Math.max(cursor + 14, pageHeight - 50)
  drawCertSignatureLines(doc, { y: sigY, margin, pageWidth })

  // Disclaimer
  drawDocDisclaimer(doc, {
    pageWidth, pageHeight, margin,
    text: 'Issuance of this certificate confirms that work was completed in accordance with the contracted scope. Warranty terms above govern the express coverage period; latent defects outside the scope are excluded. Past-due balances may accrue at 1.5% per month.'
  })

  const safeName = (contact.name || 'completion').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40)
  const stamp = new Date(closedAt).toISOString().slice(0, 10)
  const filename = options.filename || `Certificate-${safeName}-${stamp}.pdf`
  return { doc, filename }
}

function drawCertSection(doc, opts) {
  const { margin, pageWidth, y, brandRGB, label, rows, bodyText } = opts
  let cursor = y

  // Brand-color eyebrow rule
  doc.setDrawColor(...brandRGB)
  doc.setLineWidth(0.6)
  doc.line(margin, cursor, margin + 18, cursor)
  cursor += 4

  // Label
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...brandRGB)
  doc.setCharSpace(0.8)
  doc.text(String(label || '').toUpperCase(), margin, cursor + 2)
  doc.setCharSpace(0)
  cursor += 6

  if (bodyText) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(11)
    doc.setTextColor(...ONYX)
    const lines = doc.splitTextToSize(bodyText, pageWidth - margin * 2)
    doc.text(lines, margin, cursor + 4)
    cursor += lines.length * 5 + 6
    return cursor + 2
  }

  for (const row of rows || []) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(9)
    doc.setTextColor(...INK_MUTED)
    doc.text(String(row.k || '').toUpperCase(), margin, cursor + 4)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...ONYX)
    doc.text(String(row.v || '—'), pageWidth - margin, cursor + 4, { align: 'right' })
    cursor += 7
  }
  return cursor + 4
}

function drawCertSignatureLines(doc, { y, margin, pageWidth }) {
  const colW = (pageWidth - margin * 2 - 12) / 2
  const leftX = margin
  const rightX = margin + colW + 12

  doc.setDrawColor(...ONYX)
  doc.setLineWidth(0.3)
  doc.line(leftX, y, leftX + colW, y)
  doc.line(rightX, y, rightX + colW, y)

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...INK_MUTED)
  doc.setCharSpace(0.6)
  doc.text('CUSTOMER SIGNATURE', leftX, y + 4)
  doc.text('CONTRACTOR SIGNATURE', rightX, y + 4)

  // Date stubs
  const dateY = y + 14
  doc.setLineWidth(0.3)
  doc.line(leftX, dateY, leftX + 50, dateY)
  doc.line(rightX, dateY, rightX + 50, dateY)
  doc.text('DATE', leftX, dateY + 4)
  doc.text('DATE', rightX, dateY + 4)
  doc.setCharSpace(0)
}

function addMonthsIso(isoDate, months) {
  const d = new Date(isoDate)
  if (Number.isNaN(d.getTime())) return null
  d.setMonth(d.getMonth() + months)
  return d.toISOString().slice(0, 10)
}

function parseBrandRGB(hex) {
  if (!hex) return null
  const clean = String(hex).replace('#', '').trim()
  if (!/^[0-9a-fA-F]{6}$/.test(clean)) return null
  return [
    parseInt(clean.slice(0, 2), 16),
    parseInt(clean.slice(2, 4), 16),
    parseInt(clean.slice(4, 6), 16)
  ]
}

/**
 * Triggers the browser download.
 */
export function downloadPdf(result) {
  if (!result?.doc) return
  result.doc.save(result.filename)
}
