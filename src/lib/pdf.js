// PDF generator, invoices and proposals.
//
// White-label: every customer facing string, number, logo, color, and
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
import { safePayUrl } from './payLink.ts'
import { installWinAnsiText } from './pdfText.ts'
import {
  invoiceNumber as docInvoiceNumber,
  invoiceNumberFromSequence as docInvoiceNumberFromSequence,
  proposalNumber as docProposalNumber,
  companyPrefix as docCompanyPrefix
} from '../components/documents/numbers.ts'
import { mapItemsToScope } from '../components/documents/mapItems.ts'
import { DOC_COLORS, THEME_PALETTES, hexToRgb } from '../components/documents/tokens.ts'
import { groupPhotosByTag } from '../components/documents/photoGroups.ts'

// Palette colors from tokens.ts, the same values the HTML documents use, so
// the PDF matches the preview the contractor approved.
const FIELD_GOLD = hexToRgb(DOC_COLORS.gold)
const ONYX = hexToRgb(DOC_COLORS.ink)
const RAW_LINEN = hexToRgb(DOC_COLORS.paper)
const INK_MUTED = hexToRgb(DOC_COLORS.inkMuted)
const SIGNAL_GREEN = hexToRgb(DOC_COLORS.signalGreen)

const MM_PER_PT = 25.4 / 72
// Baseline of the first line on a continuation page.
const PAGE_TOP = 18
// Clearance between flowing content and the fine print at the page foot.
const FOOTER_GAP = 5
// Table text size in print points. This is a PDF measurement, separate from
// the app's screen type scale; at 12pt a $2,500.00 amount no longer fit its
// column and wrapped mid number.
const TABLE_FONT_PT = 10

// DocuSign places the customer's Sign Here and Date Signed fields on these
// tokens (netlify/functions/docusign-send.js anchors on the same strings).
// They are drawn in the page color, invisible on screen and on paper but
// present in the text layer DocuSign searches.
export const ESIGN_SIGN_ANCHOR = '\\s1\\'
export const ESIGN_DATE_ANCHOR = '\\d1\\'

// Every generator creates its document here so that all text it measures or
// draws goes through the WinAnsi filter in pdfText.ts.
function createPdfDoc() {
  return installWinAnsiText(new jsPDF({ unit: 'mm', format: 'letter' }))
}

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 2,
    maximumFractionDigits: 2
  })
}

// Fine print repeated at the foot of every page. Measured once per document
// so the footer and the content above it agree on where the footer starts:
// tables, text blocks and photos must stay above `contentBottom`.
function footerLayout(doc, { pageWidth, pageHeight, margin, text, pointSize = 9, bottomOffset = 14 }) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(pointSize)
  const lines = text ? doc.splitTextToSize(text, pageWidth - margin * 2) : []
  const lineHeight = pointSize * doc.getLineHeightFactor() * MM_PER_PT
  const firstBaseline = pageHeight - bottomOffset - Math.max(0, lines.length - 1) * lineHeight
  // Capitals rise about 0.72 of the font size above the baseline.
  const capHeight = pointSize * MM_PER_PT * 0.72
  return { lines, pointSize, x: margin, firstBaseline, contentBottom: firstBaseline - capHeight - FOOTER_GAP }
}

function drawFooterText(doc, footer, color) {
  if (!footer.lines.length) return
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(footer.pointSize)
  doc.setTextColor(...color)
  doc.text(footer.lines, footer.x, footer.firstBaseline)
}

// Starts a new page and returns the y to continue at. `onNewPage` paints a
// themed page background before anything is drawn on the page.
function newPage(doc, onNewPage) {
  doc.addPage()
  if (onNewPage) onNewPage()
  return PAGE_TOP
}

// Draws wrapped lines one at a time, starting a new page whenever the next
// baseline would pass `bottom`. jsPDF draws a string array in one call and
// never paginates it, which cut long payment terms and notes off the page.
// Returns the y below the last line.
function drawFlowingLines(doc, lines, { x, y, lineHeight, bottom, onNewPage }) {
  let cursor = y
  for (const line of lines) {
    if (cursor > bottom) cursor = newPage(doc, onNewPage)
    doc.text(line, x, cursor)
    cursor += lineHeight
  }
  return cursor
}

// Shortens `text` to one line of `width` at the current font, ending in an
// ellipsis when it had to cut. `track` is the charSpace it will be drawn
// with; getTextWidth ignores charSpace, and PDF adds it after every glyph.
function fitOneLine(doc, text, width, track = 0) {
  const measure = (s) => doc.getTextWidth(s) + s.length * track
  let s = String(text || '')
  if (measure(s) <= width) return s
  while (s.length > 1 && measure(`${s}...`) > width) s = s.slice(0, -1)
  return `${s.trimEnd()}...`
}

function itemAmount(it) {
  return Number(it.amount != null ? it.amount : (Number(it.qty || 1) * Number(it.rate || 0)))
}

// One scope line per item. Quantity is shown as a trailing tag only
// when it carries information (qty > 1), so a "1 ls" line reads as
// plain prose while "320 sf" still surfaces. Mirrors the HTML preview's
// scopeLine() so both surfaces render the same text.
function proposalScopeLine(it) {
  const desc = (it.description || '').trim()
  const qty = Number(it.qty || 1)
  const unit = (it.unit || '').trim()
  if (qty > 1) return `${desc} · ${qty}${unit ? ` ${unit}` : ''}`
  return desc
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

  // Names, wrap to the column width so a long recipient/company name
  // doesn't overprint the adjacent column or run off the page.
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(13)
  const recipNameLines = doc.splitTextToSize(String(recipient?.name || ''), colW)
  const compNameLines = doc.splitTextToSize(String(company?.name || 'My Company'), colW)
  doc.text(recipNameLines, leftX, y + 13)
  doc.text(compNameLines, rightX, y + 13)

  // Address lines, start below however many lines the name occupied.
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(60, 56, 51)
  let leftY = y + 19 + (recipNameLines.length - 1) * 5
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

  let rightY = y + 19 + (compNameLines.length - 1) * 5
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

// autoTable margins. The bottom margin stops rows above the page footer;
// without it rows ran to autoTable's 14mm default and printed over the
// fine print on every page break.
function tableMargin({ margin, pageHeight, bottom }) {
  return { left: margin, right: margin, bottom: pageHeight - bottom }
}

// Hairline under each body row, drawn after the cell.
function rowRule(color) {
  return (data) => {
    if (data.section !== 'body') return
    const { doc: d, cell } = data
    d.setDrawColor(...color)
    d.setLineWidth(0.15)
    d.line(cell.x, cell.y + cell.height, cell.x + cell.width, cell.y + cell.height)
  }
}

function drawDocItemsTable(doc, opts) {
  const { startY, rows, brandRGB, margin, pageWidth, pageHeight, bottom, layout = 'detailed' } = opts

  const commonStyles = {
    theme: 'plain',
    headStyles: {
      fillColor: brandRGB,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: TABLE_FONT_PT,
      cellPadding: { top: 4, right: 3, bottom: 4, left: 3 }
    },
    bodyStyles: {
      fontSize: TABLE_FONT_PT,
      textColor: ONYX,
      cellPadding: { top: 5, right: 3, bottom: 5, left: 3 },
      lineWidth: 0,
      valign: 'top'
    },
    didDrawCell: rowRule([232, 228, 216]),
    margin: tableMargin({ margin, pageHeight, bottom })
  }

  // Sectioned: one row per trade, Scope | Description | Amount. Drops
  // the per-line Qty / Unit-Price columns (a section row rolls up to
  // qty 1, so they read as noise) and gives the remaining columns
  // enough width that no header wraps mid-word.
  if (layout === 'sectioned') {
    const innerWidth = pageWidth - margin * 2
    autoTable(doc, {
      startY,
      head: [['Scope of Work', 'Description', 'Amount']],
      body: rows.map((r) => {
        const amount = Number(r.amount != null ? r.amount : Number(r.qty || 1) * Number(r.rate || 0))
        const desc = r.descriptionLines && r.descriptionLines.length > 0
          ? r.descriptionLines.join('\n')
          : (r.description || '')
        return [r.title || '', desc, money(amount)]
      }),
      ...commonStyles,
      columnStyles: {
        0: { cellWidth: innerWidth * 0.30, fontStyle: 'bold' },
        1: { cellWidth: 'auto' },
        2: { halign: 'right', cellWidth: innerWidth * 0.18, fontStyle: 'bold' }
      }
    })
    return doc.lastAutoTable.finalY
  }

  // Money columns are sized for 10pt amounts up to $9,999,999.99 on one
  // line, and every header fits on one line.
  autoTable(doc, {
    startY,
    head: [['Product/Service', 'Description', 'Qty.', 'Unit Price', 'Total']],
    body: rows.map((r) => {
      const qty = Number(r.qty || 1)
      const rate = Number(r.rate || 0)
      const amount = Number(r.amount != null ? r.amount : qty * rate)
      const desc = r.descriptionLines && r.descriptionLines.length > 0
        ? r.descriptionLines.join('\n')
        : (r.description || '')
      return [
        r.title || '',
        desc,
        `${qty}${r.unit ? ` ${r.unit}` : ''}`,
        money(rate),
        money(amount)
      ]
    }),
    ...commonStyles,
    columnStyles: {
      0: { cellWidth: 36, fontStyle: 'bold' },
      1: { cellWidth: 'auto' },
      2: { halign: 'right', cellWidth: 18 },
      3: { halign: 'right', cellWidth: 32 },
      4: { halign: 'right', cellWidth: 32, fontStyle: 'bold' }
    }
  })
  return doc.lastAutoTable.finalY
}

function drawDocTotalsBlock(doc, opts) {
  const { startY, pageWidth, margin, label, total, rows = [], bottom } = opts
  const rightX = pageWidth - margin
  // Keep the block together: below the table it totals, or at the top of
  // the next page when it would reach the page footer.
  const blockH = 4 + (rows.length > 0 ? rows.length * 6 + 2 : 0) + 11
  let cursor = (bottom != null && startY + blockH > bottom) ? newPage(doc) - 4 : startY
  cursor += 4

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

// "How to pay" block, the contractor's bring-your-own pay link +
// instructions, rendered as a soft-tinted panel with a clickable link.
// Returns the new cursor Y. No-op (returns startY) when neither set.
function drawDocPayBlock(doc, opts) {
  const { startY, margin, pageWidth, bottom, brandRGB, company } = opts
  const link = (company?.payment_link || '').trim()
  const instructions = (company?.payment_instructions || '').trim()
  if (!link && !instructions) return startY
  // Allow-list the scheme, never embed a javascript:/data: link in the
  // PDF annotation. Bare host → https://; dangerous scheme → no link.
  const url = safePayUrl(link)

  const innerW = pageWidth - margin * 2
  // Measure: heading + optional link line + wrapped instructions.
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const instrLines = instructions ? doc.splitTextToSize(instructions, innerW - 12) : []
  const bodyH = 7 + (url ? 6 : 0) + instrLines.length * 4.6
  const panelH = bodyH + 8
  let y = startY + 6
  if (y + panelH > bottom) y = newPage(doc)

  // Soft brand-tinted panel
  const [r, g, b] = brandRGB || FIELD_GOLD
  doc.setFillColor(Math.round(r * 0.12 + 255 * 0.88), Math.round(g * 0.12 + 255 * 0.88), Math.round(b * 0.12 + 255 * 0.88))
  doc.setDrawColor(r, g, b)
  doc.setLineWidth(0.3)
  doc.roundedRect(margin, y, innerW, panelH, 2, 2, 'FD')

  let ty = y + 7
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...ONYX)
  doc.setCharSpace(0.6)
  doc.text('HOW TO PAY', margin + 6, ty)
  doc.setCharSpace(0)
  ty += 6

  if (url) {
    const display = url.replace(/^https?:\/\//i, '')
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(r, g, b)
    doc.textWithLink(`Pay online at ${display}`, margin + 6, ty, { url })
    ty += 6
  }
  if (instrLines.length > 0) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(60, 56, 51)
    doc.text(instrLines, margin + 6, ty)
    ty += instrLines.length * 4.6
  }
  return y + panelH
}

// ============================================================
// Project photos block, embeds tagged section photos into the PDF.
// Pre-fetches each signed URL through loadImageForPdf (same loader as
// the logo), groups by section_tag, and renders a 3-up grid on the
// proposal / 2-up on the invoice. Page-break aware so a long section
// can split across pages without truncating the last row.
// ============================================================
async function drawProjectPhotosBlock(doc, opts) {
  const { photos, margin, pageWidth, bottom, startY, brandRGB, compact = false, onNewPage } = opts
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

  // Group by section tag. Untagged photos, and photos whose "tag" is just
  // their caption, share one 'Project photos' bucket.
  const groups = groupPhotosByTag(valid)

  const cols = compact ? 2 : 3
  const gap = 4
  const innerWidth = pageWidth - margin * 2
  const cellW = (innerWidth - gap * (cols - 1)) / cols
  const cellH = cellW * 0.75 // 4:3 aspect
  const captioned = valid.some((p) => p.caption)
  const rowH = cellH + (captioned ? 6 : 4)

  let cursor = startY

  // Section header, gold-rule + label, same idiom as the certificate.
  // Kept on the same page as the first row of photos.
  if (cursor + 10 + (groups.size > 1 ? 6 : 0) + rowH > bottom) cursor = newPage(doc, onNewPage)
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
    // Per-section sub-label only when there's more than one group :
    // a single bucket reads cleanly without a noisy header.
    if (groups.size > 1) {
      if (cursor + 6 + rowH > bottom) cursor = newPage(doc, onNewPage)
      doc.setFont('helvetica', 'bold')
      doc.setFontSize(8)
      doc.setTextColor(...INK_MUTED)
      // One line, cut with an ellipsis: a long tag used to run off the page.
      const label = fitOneLine(doc, String(tag).toUpperCase(), innerWidth, 0.6)
      doc.setCharSpace(0.6)
      doc.text(label, margin, cursor + 3)
      doc.setCharSpace(0)
      cursor += 6
    }

    // Cap to 6 per group to keep the layout from sprawling.
    const display = arr.slice(0, 6)
    for (let i = 0; i < display.length; i += cols) {
      const row = display.slice(i, i + cols)
      // Page-break check, leave room for the image + caption line.
      if (cursor + rowH > bottom) cursor = newPage(doc, onNewPage)
      row.forEach((p, j) => {
        const x = margin + j * (cellW + gap)
        try {
          doc.addImage(p.img.dataUrl, p.img.format || 'PNG', x, cursor, cellW, cellH)
        } catch {
          // Tainted/bad image, draw a placeholder rect so the layout
          // doesn't collapse around it.
          doc.setFillColor(...RAW_LINEN)
          doc.rect(x, cursor, cellW, cellH, 'F')
        }
        if (p.caption) {
          doc.setFont('helvetica', 'normal')
          doc.setFontSize(7)
          doc.setTextColor(...INK_MUTED)
          doc.text(fitOneLine(doc, p.caption, cellW), x, cursor + cellH + 3)
        }
      })
      cursor += rowH
    }
    cursor += 2
  }

  return cursor + 4
}

// Parse a value that may be a Date, a full ISO timestamp, or a bare
// date-only "year month day" column. Date-only strings are constructed in
// LOCAL time so the calendar day is preserved, `new Date("2026-06-01")`
// parses as UTC midnight, which is the PREVIOUS day in every US
// timezone (a due/warranty date would print a day early). Mirrors
// src/lib/dates.ts parseDateOnly.
function parseDateLocal(value) {
  if (value == null || value === '') return null
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value
  const s = String(value)
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s)
  if (m) {
    const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))
    return Number.isNaN(d.getTime()) ? null : d
  }
  const d = new Date(s)
  return Number.isNaN(d.getTime()) ? null : d
}

function formatDocDate(d) {
  const dt = parseDateLocal(d)
  if (!dt) return ''
  return dt.toLocaleDateString(undefined, { month: 'long', day: '2-digit', year: 'numeric' })
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
// V5 "premium letterhead" chrome, matches DocumentShell.tsx: a
// company-name letterhead (small logo when present, NO gold monogram
// billboard), small-caps doc type + full number + Issued/Due meta on
// the right, and the brand accent reduced to a thin top keyline. Used
// by all customer facing PDFs (invoice, quote, statement) so they read
// like the on-screen premium documents. No license/insured lines.
// ============================================================
function drawModernLetterhead(doc, {
  pageWidth, margin, docType, number, company, logo, brandRGB,
  metaRows = []
}) {
  const topY = 15
  const rightCol = pageWidth - margin

  // Thin brand keyline across the very top, the one place the accent
  // frames the page.
  doc.setFillColor(...brandRGB)
  doc.rect(0, 0, pageWidth, 1.4, 'F')

  // ── Left: company identity (small logo + name + contact lines) ──
  let nameX = margin
  let logoBottom = topY
  if (logo && logo.dataUrl && logo.width > 0 && logo.height > 0) {
    const maxH = 13
    const maxW = 34
    const aspect = logo.width / logo.height
    let h = maxH
    let w = h * aspect
    if (w > maxW) { w = maxW; h = w / aspect }
    try {
      doc.addImage(logo.dataUrl, logo.format || 'PNG', margin, topY, w, h)
      nameX = margin + w + 5
      logoBottom = topY + h
    } catch { /* fall through, name-only identity */ }
  }

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(15)
  doc.setTextColor(...ONYX)
  doc.text(company?.name || 'Contractor', nameX, topY + 5)
  let ly = topY + 10
  const identityW = rightCol - nameX - 60
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...INK_MUTED)
  if (company?.address) {
    const lines = doc.splitTextToSize(String(company.address), Math.max(60, identityW))
    doc.text(lines, nameX, ly)
    ly += lines.length * 4.2
  }
  const contactLine = [company?.phone, company?.email, company?.website].filter(Boolean).join('  ·  ')
  if (contactLine) {
    const lines = doc.splitTextToSize(contactLine, Math.max(60, identityW))
    doc.text(lines, nameX, ly)
    ly += lines.length * 4.2
  }
  const leftBottom = Math.max(ly, logoBottom + 2)

  // ── Right: doc meta (small-caps type + full number + Issued/Due) ──
  let ry = topY
  const dt = String(docType || '').toUpperCase()
  const track = 1.1
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(11)
  doc.setTextColor(...ONYX)
  doc.setCharSpace(track)
  // jsPDF's align:'right' ignores charSpace, so measure the tracked
  // width and left-anchor to keep the caps from clipping the page edge.
  const trackedW = doc.getTextWidth(dt) + (dt.length - 1) * track
  doc.text(dt, rightCol - trackedW, ry + 4)
  doc.setCharSpace(0)
  ry += 4

  if (number) {
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(58, 56, 51)
    doc.text(String(number), rightCol, ry + 5, { align: 'right' })
    ry += 5
  }

  ry += 3
  for (const r of metaRows) {
    if (!r) continue
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(7.5)
    doc.setTextColor(...INK_MUTED)
    doc.setCharSpace(0.6)
    doc.text(String(r.label || '').toUpperCase(), rightCol - 38, ry + 4, { align: 'right' })
    doc.setCharSpace(0)
    doc.setFont('helvetica', r.strong ? 'bold' : 'normal')
    doc.setFontSize(9.5)
    doc.setTextColor(...(r.strong ? ONYX : [58, 56, 51]))
    doc.text(String(r.value || ''), rightCol, ry + 4, { align: 'right' })
    ry += 6
  }
  const rightBottom = ry

  // Divider under the letterhead
  const cursor = Math.max(leftBottom, rightBottom) + 4
  doc.setDrawColor(213, 207, 190)
  doc.setLineWidth(0.3)
  doc.line(margin, cursor, rightCol, cursor)
  return cursor + 8
}

// Small-caps section label with the ink color, matches the HTML
// documents' SectionLabel. Returns the y just below the label text.
function drawModernSectionLabel(doc, { margin, y, text }) {
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9)
  doc.setTextColor(...ONYX)
  doc.setCharSpace(1)
  doc.text(String(text || '').toUpperCase(), margin, y)
  doc.setCharSpace(0)
  return y + 2
}

// Hero summary band, soft-tinted rounded panel with a big serif figure
// (amount due / total) on the left, secondary lines on the right, and a
// thin collection progress bar. Mirrors the InvoiceTemplate HeroBand.
function drawHeroBand(doc, {
  startY, margin, pageWidth, brandRGB, label,
  amount, isPaid = false, paidLabel = 'Paid in full',
  rightLines = [], paid = 0, contractTotal = 0
}) {
  const innerW = pageWidth - margin * 2
  const x = margin
  const y = startY
  const hasBar = contractTotal > 0
  const boxH = hasBar ? 32 : 26

  doc.setFillColor(251, 248, 241)
  doc.setDrawColor(232, 228, 216)
  doc.setLineWidth(0.3)
  doc.roundedRect(x, y, innerW, boxH, 2, 2, 'FD')

  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...INK_MUTED)
  doc.setCharSpace(0.8)
  doc.text(String(label || '').toUpperCase(), x + 8, y + 8)
  doc.setCharSpace(0)

  doc.setFont('times', 'normal')
  doc.setFontSize(30)
  doc.setTextColor(...(isPaid ? SIGNAL_GREEN : ONYX))
  doc.text(isPaid ? paidLabel : moneyCompact(amount), x + 8, y + 20)

  let rly = y + 8
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9.5)
  doc.setTextColor(...INK_MUTED)
  for (const line of rightLines) {
    if (!line) continue
    doc.text(String(line), x + innerW - 8, rly, { align: 'right' })
    rly += 5
  }

  if (hasBar) {
    const pct = Math.max(0, Math.min(1, paid / contractTotal))
    const barX = x + 8
    const barY = y + boxH - 6
    const barW = innerW - 16
    doc.setFillColor(232, 228, 216)
    doc.roundedRect(barX, barY, barW, 1.8, 0.9, 0.9, 'F')
    if (pct > 0) {
      doc.setFillColor(...(isPaid ? SIGNAL_GREEN : brandRGB))
      doc.roundedRect(barX, barY, Math.max(1, barW * pct), 1.8, 0.9, 0.9, 'F')
    }
  }

  return y + boxH + 8
}

// Compact billing-schedule table, one row per draw (number, issued,
// due, amount, Paid/Due). Mirrors InvoiceTemplate's BillingSchedule.
// Void AND draft rows are filtered by the caller (never shown to
// customers). Returns the new cursor Y.
// Short date for table cells ("Sep 30, 2026"), the same format the HTML
// billing schedule uses, so a date fits its column on one line.
function shortDocDate(d) {
  const dt = parseDateLocal(d)
  if (!dt) return ''
  return dt.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

function drawBillingSchedule(doc, { startY, margin, pageHeight, bottom, brandRGB, company, currentId, rows, jobSeed }) {
  let cursor = drawModernSectionLabel(doc, { margin, y: startY, text: 'Billing schedule' })
  cursor += 4
  autoTable(doc, {
    startY: cursor,
    head: [['Invoice', 'Issued', 'Due', 'Amount', 'Status']],
    body: rows.map((inv) => {
      const isPaid = String(inv.status || '').toLowerCase() === 'paid'
      // All draws of one job share the job discriminator (from the
      // contact id) and differ only by sequence, so the numbers read as
      // a consistent series (PCC-4F2A-01/-02/-03), not per-row noise.
      const num = docInvoiceNumberFromSequence(company?.name, inv.sequence_number, jobSeed || inv.contact_id || inv.id)
      const label = inv.title ? `${num} · ${inv.title}` : num
      const marked = currentId != null && inv.id === currentId
      return [
        marked ? `${label}  (this invoice)` : label,
        shortDocDate(inv.issued_at || inv.created_at),
        isPaid ? '' : shortDocDate(inv.due_at),
        money(Number(inv.amount || 0)),
        isPaid ? 'Paid' : 'Due'
      ]
    }),
    theme: 'plain',
    headStyles: {
      fillColor: brandRGB,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: TABLE_FONT_PT,
      cellPadding: { top: 4, right: 3, bottom: 4, left: 3 }
    },
    bodyStyles: {
      fontSize: TABLE_FONT_PT,
      textColor: [40, 38, 35],
      cellPadding: { top: 4, right: 3, bottom: 4, left: 3 }
    },
    didDrawCell: rowRule([232, 228, 216]),
    columnStyles: {
      0: { cellWidth: 'auto', fontStyle: 'bold' },
      1: { cellWidth: 28 },
      2: { cellWidth: 28 },
      3: { halign: 'right', cellWidth: 32, fontStyle: 'bold' },
      4: { halign: 'right', cellWidth: 20 }
    },
    margin: tableMargin({ margin, pageHeight, bottom })
  })
  return doc.lastAutoTable.finalY
}

// Insurance-claim card, 3-col field grid in a brand-bordered soft
// panel. Mirrors InsuranceModeBlock.tsx. Renders only when the payload
// carries at least one field. Returns the new cursor Y.
function drawModernInsurance(doc, { startY, margin, pageWidth, bottom, brandRGB, insurance }) {
  if (!insurance) return startY
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
  if (!fields.length) return startY

  const innerW = pageWidth - margin * 2
  const gridRows = Math.ceil(fields.length / 3)
  const cardH = gridRows * 14 + 12
  let cursor = startY + 8
  if (cursor + cardH + 8 > bottom) cursor = newPage(doc)

  cursor = drawModernSectionLabel(doc, { margin, y: cursor, text: 'Insurance claim' })
  cursor += 6

  const cardY = cursor
  doc.setFillColor(251, 248, 241)
  doc.setDrawColor(...brandRGB)
  doc.setLineWidth(0.4)
  doc.roundedRect(margin, cardY, innerW, cardH, 2, 2, 'FD')

  const colW = innerW / 3
  fields.forEach((f, i) => {
    const col = i % 3
    const row = Math.floor(i / 3)
    const cx = margin + colW * col + 8
    const cy = cardY + 9 + row * 14
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

// Acceptance / approval block for proposals. When the estimate is
// approved AND an approval record is present, renders the recorded
// signature (image or typed name), the approval date, and an
// "approved electronically" note, mirroring ProposalTemplate's
// ApprovalLines. When NOT approved, draws honest BLANK signature lines
// (never pre-fills the customer's name as cursive, that reads as a
// forged signature). Returns the new cursor Y.
function drawModernApproval(doc, {
  startY, margin, pageWidth, bottom, company, contact, approval, status
}) {
  const stamped = String(status || '').toLowerCase() === 'approved'
    && approval
    && (approval.clientSignatureDataUrl || approval.signature || approval.signatureDataUrl ||
        approval.clientName || approval.approvedByName)

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  const copy = `Signing below (or approving through the secure link this estimate was delivered with) authorizes ${company?.name || 'the contractor'} to perform the work described above and forms a binding agreement under the stated terms.`
  const copyLines = doc.splitTextToSize(copy, pageWidth - margin * 2)

  // The label, the copy, both signature cells and the approval note stay
  // together on one page.
  const blockH = 7 + copyLines.length * 4.6 + 12 + 30 + (stamped ? 8 : 0)
  let cursor = startY + 14
  if (cursor + blockH > bottom) cursor = newPage(doc)

  cursor = drawModernSectionLabel(doc, { margin, y: cursor, text: 'Acceptance' })
  cursor += 5

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10)
  doc.setTextColor(58, 56, 51)
  doc.text(copyLines, margin, cursor)
  cursor += copyLines.length * 4.6 + 12

  const colW = (pageWidth - margin * 2 - 16) / 2
  const leftX = margin
  const rightX = margin + colW + 16

  drawSigCell(doc, {
    x: leftX, y: cursor, w: colW, label: 'Customer',
    dataUrl: stamped ? (approval.clientSignatureDataUrl || approval.signature || approval.signatureDataUrl) : null,
    name: stamped ? (approval.clientName || approval.approvedByName || contact?.name) : null,
    date: stamped ? (approval.clientApprovedAt || approval.approvedAt || approval.approved_at) : null,
    esignAnchorColor: [255, 255, 255]
  })
  drawSigCell(doc, {
    x: rightX, y: cursor, w: colW, label: 'Contractor',
    dataUrl: stamped ? approval.contractorSignatureDataUrl : null,
    name: stamped ? company?.name : null,
    date: stamped ? approval.contractorApprovedAt : null
  })
  cursor += 30

  if (stamped) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK_MUTED)
    const note = doc.splitTextToSize('Approved electronically via secure link. Name, date, and network address are recorded with this approval.', pageWidth - margin * 2)
    doc.text(note, margin, cursor)
    cursor += note.length * 3.6
  }
  return cursor
}

// DocuSign anchors for a customer signature line, drawn in the page color:
// Sign Here at the left end of the line, Date Signed toward the right end.
// DocuSign lines a field's bottom edge up with the bottom of its anchor, so
// both fields sit just above the line.
function drawEsignAnchors(doc, { x, lineY, width, color }) {
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(6)
  doc.setTextColor(...color)
  doc.text(ESIGN_SIGN_ANCHOR, x + 1, lineY - 1.5)
  doc.text(ESIGN_DATE_ANCHOR, x + width - 32, lineY - 1.5)
}

function drawSigCell(doc, { x, y, w, label, dataUrl, name, date, esignAnchorColor = null }) {
  if (dataUrl) {
    try {
      doc.addImage(dataUrl, 'PNG', x, y, Math.min(w, 60), 16)
    } catch {
      if (name) {
        doc.setFont('times', 'italic'); doc.setFontSize(18); doc.setTextColor(...ONYX)
        doc.text(String(name), x, y + 14)
      }
    }
  } else if (name) {
    doc.setFont('times', 'italic'); doc.setFontSize(18); doc.setTextColor(...ONYX)
    doc.text(String(name), x, y + 14)
  }
  doc.setDrawColor(...ONYX)
  doc.setLineWidth(0.4)
  doc.line(x, y + 20, x + w, y + 20)
  if (esignAnchorColor) drawEsignAnchors(doc, { x, lineY: y + 20, width: w, color: esignAnchorColor })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(...INK_MUTED)
  doc.setCharSpace(0.6)
  doc.text(String(label || '').toUpperCase(), x, y + 25)
  doc.setCharSpace(0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.text(`Date${date ? `: ${formatDocDate(date)}` : ''}`, x + w, y + 25, { align: 'right' })
}

// ============================================================
// Document-level disclaimer copy (matches HTML preview footers).
// ============================================================
const INVOICE_DISCLAIMER = 'Pricing covers labor, material, standard equipment, placement, finishing, and cleanup for the scope as billed. Hidden conditions, field changes, or scope deviations may require a separate change order. Past due balances may accrue at 1.5% per month.'
const PROPOSAL_DISCLAIMER = 'Pricing includes labor, material, standard equipment, placement, finishing, and cleanup for the listed scope only. Pricing is based on visible site conditions at time of estimating. Any hidden conditions, field changes, requested by owner additions, or scope deviations may require additional pricing through written change order approval. Estimate valid for 30 days.'

/**
 * Generate a branded invoice PDF, restrained editorial layout
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
  dueDateIso = null,
  invoiceId,
  payments = [],
  contractTotal,
  previouslyPaid,
  insurance = null,
  changeOrders = [],
  invoices = [],
  currentInvoice = null,
  photos = []
} = {}) {
  const doc = createPdfDoc()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 16
  const footer = footerLayout(doc, { pageWidth, pageHeight, margin, text: INVOICE_DISCLAIMER })
  const bottom = footer.contentBottom

  // Sequence-aware, company-unique, per-job number so the emailed PDF
  // number matches the web link. Rendered in FULL (not truncated).
  // Seed the number from the CONTACT (job) id, not the invoice id, so
  // the hero number matches the "this invoice" row in the billing
  // schedule and every draw of the job shares one consistent series.
  const number = docInvoiceNumberFromSequence(
    company?.name,
    currentInvoice?.sequence_number,
    contact?.id || invoiceId
  )
  const logo = company?.logo_url
    ? await loadLogoForPdf(company.logo_url, { maxDimension: 720 })
    : null
  const brandRGB = parseBrandAccentRgb(company?.brand_accent_hex) || FIELD_GOLD

  // Real dates. Due prefers the raw ISO / currentInvoice.due_at (parsed
  // as a LOCAL calendar day), then any pre-formatted human string.
  const issuedAt = currentInvoice?.issued_at || new Date()
  const dueRaw = dueDateIso || currentInvoice?.due_at || null
  const dueDisplay = dueRaw ? formatDocDate(dueRaw) : (dueDate || '')

  // 1. Letterhead (premium company-name chrome + Issued/Due meta)
  const metaRows = [{ label: 'Issued', value: formatDocDate(issuedAt) }]
  if (dueDisplay) metaRows.push({ label: 'Due', value: dueDisplay, strong: true })
  let cursor = drawModernLetterhead(doc, {
    pageWidth, margin, docType: 'Invoice', number, company, logo, brandRGB, metaRows
  })

  // Money math up front, the hero and the reconciliation share it.
  const rows = (lineItems && lineItems.length > 0)
    ? lineItems.map((li) => ({
        title: li.description || 'Item',
        descriptionLines: li.notes ? [li.notes] : [],
        qty: li.qty || 1,
        unit: li.unit,
        rate: li.rate,
        amount: li.amount
      }))
    : []
  const subtotal = rows.reduce((s, r) => {
    const q = Number(r.qty || 1)
    const rt = Number(r.rate || 0)
    return s + Number(r.amount != null ? r.amount : q * rt)
  }, 0)
  const tax = subtotal * Number(taxRate || 0)
  const thisInvoice = subtotal + tax

  const approvedCO = (changeOrders || [])
    .filter((co) => co?.status === 'approved')
    .reduce((s, co) => s + Number(co.amount || 0), 0)
  const rawContract = Number(contractTotal != null ? contractTotal : thisInvoice)
  const ct = rawContract + approvedCO
  const pp = previouslyPaid != null
    ? Number(previouslyPaid)
    : (payments || []).reduce((s, p) => s + Number(p.amount || 0), 0)
  const balance = Math.max(0, ct - pp)
  const isPaid = balance < 0.5
  // The hero "Amount due" is THIS invoice's amount (capped at the
  // remaining contract balance), matching the email subject, the
  // line item table, and the public web link. It used to print the
  // whole remaining contract balance, so a $2,500 deposit draw arrived
  // with a PDF banner demanding $10,000 while every other surface said
  // $2,500. Jobs billed without draw rows (no currentInvoice, no line
  // items) still show the full balance, for them the invoice IS the
  // balance. The Contract position section below reconciles either way.
  const drawAmount = currentInvoice != null && currentInvoice.amount != null
    ? Number(currentInvoice.amount)
    : (rows.length > 0 ? thisInvoice : null)
  const amountDue = !isPaid && drawAmount != null ? Math.min(balance, drawAmount) : balance

  // 2. Hero band, Amount due (this invoice)
  const heroRight = []
  if (!isPaid && dueDisplay) heroRight.push(`Due ${dueDisplay}`)
  if (ct > 0) heroRight.push(`${moneyCompact(pp)} of ${moneyCompact(ct)} collected`)
  cursor = drawHeroBand(doc, {
    startY: cursor, margin, pageWidth, brandRGB,
    label: isPaid ? 'Balance' : 'Amount due',
    amount: amountDue, isPaid, rightLines: heroRight,
    paid: pp, contractTotal: ct
  })

  // 3. Parties
  cursor = drawDocParties(doc, {
    pageWidth, margin, y: cursor + 6,
    recipient: contact, company
  })

  // 4. Items, only when the invoice actually carries line items.
  if (rows.length > 0) {
    if (cursor + 30 > bottom) cursor = newPage(doc)
    cursor = drawModernSectionLabel(doc, { margin, y: cursor, text: 'Billed this invoice' })
    cursor = drawDocItemsTable(doc, { startY: cursor + 4, rows, brandRGB, margin, pageWidth, pageHeight, bottom })
    if (taxRate > 0) {
      cursor = drawDocTotalsBlock(doc, {
        startY: cursor, pageWidth, margin, bottom,
        label: 'This invoice', total: thisInvoice,
        rows: [
          { label: 'Subtotal', value: moneyCompact(subtotal) },
          { label: `Tax · ${(taxRate * 100).toFixed(2)}%`, value: moneyCompact(tax) }
        ]
      })
    }
  }

  // 5. Billing schedule, the draw plan with live status. Void AND
  //    draft rows are hidden (drafts are never shown to customers).
  const scheduleRows = (invoices || []).filter(
    (inv) => inv && inv.status !== 'void' && inv.status !== 'draft'
  )
  if (scheduleRows.length > 0) {
    cursor += 8
    // Label, header row and the first draw together.
    if (cursor + 30 > bottom) cursor = newPage(doc)
    cursor = drawBillingSchedule(doc, {
      startY: cursor, margin, pageHeight, bottom, brandRGB, company,
      currentId: currentInvoice?.id || null, rows: scheduleRows,
      jobSeed: contact?.id
    })
  }

  // 6. Balance summary / contract position, the one reconciliation the
  //    customer can check (contract → COs → this invoice → paid → balance).
  if (ct > 0 || pp > 0) {
    // Plain ASCII signs: the standard PDF fonts cannot draw U+2212, and a
    // string holding it printed as junk, losing the sign on credits.
    const balanceRows = []
    balanceRows.push(['Original contract', moneyCompact(rawContract)])
    if (approvedCO !== 0) {
      balanceRows.push(['Approved change orders', `${approvedCO >= 0 ? '+' : '-'}${moneyCompact(Math.abs(approvedCO))}`])
      balanceRows.push(['Contract to date', moneyCompact(ct)])
    }
    balanceRows.push(['This invoice', moneyCompact(thisInvoice)])
    balanceRows.push(['Paid to date', pp > 0 ? `-${moneyCompact(pp)}` : moneyCompact(0)])

    cursor += 10
    // The whole reconciliation stays on one page.
    if (cursor + 14 + balanceRows.length * 6 > bottom) cursor = newPage(doc)
    cursor = drawModernSectionLabel(doc, { margin, y: cursor, text: 'Contract position' })
    doc.setDrawColor(213, 207, 190)
    doc.setLineWidth(0.3)
    doc.line(margin, cursor + 2, pageWidth - margin, cursor + 2)
    cursor += 8

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
    doc.setTextColor(...(balance > 0.5 ? brandRGB : SIGNAL_GREEN))
    doc.text(balance > 0.5 ? moneyCompact(balance) : 'PAID', valueX, cursor, { align: 'right' })
    cursor += 8
  }

  // 7. Insurance claim (roofing / restoration jobs), dead code before.
  cursor = drawModernInsurance(doc, {
    startY: cursor, margin, pageWidth, bottom, brandRGB, insurance
  })

  // 8. Notes / payment instructions, flowing across pages when long.
  if (notes) {
    cursor += 8
    if (cursor + 5 + 4.5 > bottom) cursor = newPage(doc)
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
    cursor = drawFlowingLines(doc, wrapped, { x: margin, y: cursor, lineHeight: 4.5, bottom })
  }

  // 6a. How to pay, the contractor's bring-your-own pay link.
  cursor = drawDocPayBlock(doc, { startY: cursor, margin, pageWidth, bottom, brandRGB, company })

  // 6b. Project photos, quiet 2-up strip, capped at 4. Invoice tone
  // is "here's the work you paid for", not the proposal's sales pitch.
  if (Array.isArray(photos) && photos.length > 0) {
    cursor = await drawProjectPhotosBlock(doc, {
      photos: photos.slice(0, 4),
      margin, pageWidth, bottom, startY: cursor + 8, brandRGB,
      compact: true
    })
  }

  // 7. Disclaimer (every page footer)
  const total_pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= total_pages; p++) {
    doc.setPage(p)
    drawFooterText(doc, footer, INK_MUTED)
  }

  return {
    doc,
    filename: `Invoice_${number}_${(contact?.name || 'client').replace(/\s+/g, '_')}.pdf`,
    number
  }
}

// ============================================================
// CLIENT STATEMENT, one document rolling every open invoice across
// all of a client's properties into a single "here's everything you
// owe me" sheet. Same restrained letterhead system as the invoice.
//
// Args:
//   company  , companyFromProfile() shape (sender branding)
//   client   , { id, name, company_name, address, phone, email }
//   lines    , [{ property, invoiceLabel, dateIso, amount, dueIso }]
//               one row per open invoice, already filtered to owed.
//   statementId, seed for the document number (client id)
// ============================================================
export async function generateStatement({
  company = {},
  client = {},
  lines = [],
  statementId
} = {}) {
  const doc = createPdfDoc()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 16
  const footer = footerLayout(doc, {
    pageWidth, pageHeight, margin,
    text: 'Statement of open invoices across all properties. Please remit the total due or contact us with any questions.'
  })
  const bottom = footer.contentBottom

  const number = docInvoiceNumber(company?.name, statementId || client?.id)
  const logo = company?.logo_url
    ? await loadLogoForPdf(company.logo_url, { maxDimension: 720 })
    : null
  const brandRGB = parseBrandAccentRgb(company?.brand_accent_hex) || FIELD_GOLD

  // 1. Letterhead (premium company-name chrome, full number)
  let cursor = drawModernLetterhead(doc, {
    pageWidth, margin, docType: 'Statement', number, company, logo, brandRGB,
    metaRows: [{ label: 'Issued', value: formatDocDate(new Date()) }]
  })

  // 2. Parties, the client is the recipient. A client's own
  //    company_name (e.g. "MMC Properties") reads as the recipient
  //    name when present, with the person's name as a sub-line.
  const recipientName = client?.company_name || client?.name || 'Client'
  const recipientSub = client?.company_name && client?.name && client.company_name !== client.name
    ? client.name
    : null
  cursor = drawDocParties(doc, {
    pageWidth, margin, y: cursor + 2,
    recipient: {
      name: recipientName,
      address: [recipientSub, client?.address].filter(Boolean).join('\n'),
      phone: client?.phone,
      email: client?.email
    },
    company
  })

  // 3. Per-property balance table, Property | Contract | Paid | Balance.
  const totalDue = lines.reduce((s, l) => s + Number(l.balance || 0), 0)
  autoTable(doc, {
    startY: cursor + 4,
    head: [['Property / Project', 'Contract', 'Paid', 'Balance Due']],
    body: lines.length > 0
      ? lines.map((l) => [
          l.property || '',
          money(Number(l.contract || 0)),
          money(Number(l.paid || 0)),
          money(Number(l.balance || 0))
        ])
      : [['No open balances', '', '', money(0)]],
    theme: 'plain',
    headStyles: {
      fillColor: brandRGB,
      textColor: [255, 255, 255],
      fontStyle: 'bold',
      fontSize: TABLE_FONT_PT,
      cellPadding: { top: 4, right: 3, bottom: 4, left: 3 }
    },
    bodyStyles: {
      fontSize: TABLE_FONT_PT,
      textColor: [40, 38, 35],
      cellPadding: { top: 4, right: 3, bottom: 4, left: 3 }
    },
    didDrawCell: rowRule([232, 228, 216]),
    columnStyles: {
      0: { cellWidth: 'auto', fontStyle: 'bold' },
      1: { halign: 'right', cellWidth: 32 },
      2: { halign: 'right', cellWidth: 32 },
      3: { halign: 'right', cellWidth: 32, fontStyle: 'bold' }
    },
    margin: tableMargin({ margin, pageHeight, bottom })
  })
  cursor = doc.lastAutoTable.finalY

  // 4. Total due block
  cursor = drawDocTotalsBlock(doc, {
    startY: cursor + 2,
    pageWidth, margin, bottom,
    label: 'TOTAL DUE',
    total: totalDue,
    rows: [{ label: `${lines.length} ${lines.length === 1 ? 'property' : 'properties'}`, value: money(totalDue), muted: true }]
  })

  // 4b. How to pay, bring-your-own pay link.
  cursor = drawDocPayBlock(doc, { startY: cursor, margin, pageWidth, bottom, brandRGB, company })

  // 5. Disclaimer footer on every page
  const total_pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= total_pages; p++) {
    doc.setPage(p)
    drawFooterText(doc, footer, INK_MUTED)
  }

  return {
    doc,
    filename: `Statement_${number}_${(recipientName || 'client').replace(/\s+/g, '_')}.pdf`,
    number,
    totalDue
  }
}

/**
 * Parse `profile.brand_accent_hex` and return an [r, g, b] tuple
 * suitable for jsPDF setFillColor / setDrawColor / setTextColor calls.
 *
 * Returns null when:
 *   - input isn't `#RRGGBB` shape
 *   - relative luminance > 0.6 (too light for chapter rules + 8mm cover
 *     bars drawn on white paper). The doc has many gold-on-white moments
 *     so we apply one threshold across the whole proposal, no split
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

// ============================================================
// Themed proposal PDFs, slate / mint / editorial. These mirror the
// HTML themes in src/components/documents/proposalThemes.tsx: a
// distinctive header + line item table + totals per theme, sharing a
// common supporting tail (scope, payment terms, exclusions, photos,
// signatures). Individual line items, not the trade-level rollup.
// ============================================================

// RGB versions of THEME_PALETTES in tokens.ts, the colors the on screen
// themes use, so the emailed or signed PDF matches the preview. Slate fills
// its table header with ink, mint with its accent, editorial has no header
// fill and paints its paper on every page.
function pdfTheme(name, headFillHex) {
  const p = THEME_PALETTES[name]
  return {
    headFill: headFillHex ? hexToRgb(headFillHex) : null,
    headText: hexToRgb(headFillHex ? p.onAccent : p.ink),
    accent: hexToRgb(p.accent),
    onAccent: hexToRgb(p.onAccent),
    ink: hexToRgb(p.ink),
    mid: hexToRgb(p.mid),
    muted: hexToRgb(p.muted),
    rule: hexToRgb(p.rule),
    soft: hexToRgb(p.accentSoft),
    bg: p.paper ? hexToRgb(p.paper) : null
  }
}

const PDF_THEMES = {
  slate: pdfTheme('slate', THEME_PALETTES.slate.ink),
  mint: pdfTheme('mint', THEME_PALETTES.mint.accent),
  editorial: pdfTheme('editorial', null)
}

function fmtShortPdf(d) {
  if (!d) return ''
  const dt = d instanceof Date ? d : new Date(d)
  if (Number.isNaN(dt.getTime())) return ''
  return dt.toLocaleDateString(undefined, { month: '2-digit', day: '2-digit', year: 'numeric' })
}

function drawPlainLogo(doc, { x, y, maxW, maxH, logo, company, align = 'left', monoColor = ONYX }) {
  if (logo && logo.dataUrl && logo.width > 0 && logo.height > 0) {
    const aspect = logo.width / logo.height
    let w = maxW, h = w / aspect
    if (h > maxH) { h = maxH; w = h * aspect }
    const drawX = align === 'right' ? x - w : x
    try { doc.addImage(logo.dataUrl, logo.format || 'PNG', drawX, y, w, h); return h } catch { /* fall through */ }
  }
  const initials = (company?.name || 'MC')
    .split(/\s+/).filter(Boolean).map((w) => w[0]).join('').toUpperCase().replace(/[^A-Z]/g, '').slice(0, 2) || 'MC'
  doc.setFont('helvetica', 'bold'); doc.setFontSize(20); doc.setTextColor(...monoColor)
  doc.text(initials, x, y + 8, { align: align === 'right' ? 'right' : 'left' })
  return 10
}

async function drawThemedProposal(doc, ctx) {
  const {
    template, pageWidth, pageHeight, margin, company, logo, contact,
    number, issuedAt, expiresAt, projectTitle, scope, warranty, paymentTerms,
    exclusions = [], lineItems = [], upgradeItems = [], subtotal, total, photos = []
  } = ctx
  const t = PDF_THEMES[template]
  const innerW = pageWidth - margin * 2
  const footer = footerLayout(doc, { pageWidth, pageHeight, margin, text: PROPOSAL_DISCLAIMER, pointSize: 8, bottomOffset: 12 })
  const bottom = footer.contentBottom

  // Page background (editorial). Idempotent per page so it paints each
  // page exactly once *before* content, calling it again on an
  // already-painted page is a no-op, which keeps autoTable's
  // willDrawPage hook from erasing the header drawn above the table.
  const paintedPages = new Set()
  const paintBg = () => {
    if (!t.bg) return
    const pn = doc.internal.getCurrentPageInfo().pageNumber
    if (paintedPages.has(pn)) return
    paintedPages.add(pn)
    doc.setFillColor(...t.bg); doc.rect(0, 0, pageWidth, pageHeight, 'F')
  }
  paintBg()

  let cursor = 18

  // ---- Header (per theme) ----
  if (template === 'slate') {
    drawPlainLogo(doc, { x: margin, y: cursor, maxW: 60, maxH: 18, logo, company, monoColor: t.ink })
    cursor += 24
    // Gray meta bar, full bleed
    doc.setFillColor(...t.accent)
    doc.rect(0, cursor, pageWidth, 16, 'F')
    const cells = [
      ['ESTIMATE NO.', number],
      ['ISSUE DATE', fmtShortPdf(issuedAt)],
      ['VALID UNTIL', fmtShortPdf(expiresAt)]
    ]
    const cw = innerW / 3
    cells.forEach(([label, val], i) => {
      const cx = margin + cw * i
      doc.setFont('helvetica', 'bold'); doc.setFontSize(7); doc.setTextColor(...t.onAccent); doc.setCharSpace(0.5)
      doc.text(label, cx, cursor + 6); doc.setCharSpace(0)
      doc.setFont('helvetica', 'bold'); doc.setFontSize(11); doc.text(String(val), cx, cursor + 12)
    })
    cursor += 24
    // From / For
    cursor = drawThemedParties(doc, { pageWidth, margin, y: cursor, company, recipient: contact, t, labels: ['FROM', 'FOR'] })
    if (projectTitle) cursor = drawThemedProjectTitle(doc, { margin, y: cursor + 4, title: projectTitle, t })
  } else if (template === 'mint') {
    // Company top-left, logo top-right
    doc.setFont('helvetica', 'bold'); doc.setFontSize(14); doc.setTextColor(...t.ink)
    doc.text(company?.name || 'My Company', margin, cursor + 4)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...t.muted)
    let cy = cursor + 9
    for (const l of themedAddressLines(company)) { const w = doc.splitTextToSize(l, innerW * 0.6); doc.text(w, margin, cy); cy += w.length * 4.2 }
    drawPlainLogo(doc, { x: pageWidth - margin, y: cursor, maxW: 50, maxH: 18, logo, company, align: 'right', monoColor: t.accent })
    cursor = Math.max(cy, cursor + 22)
    // ESTIMATE wordmark, right
    // align:'right' ignores charSpace, so left-anchor at the tracked width
    // to keep the wordmark inside the margin.
    doc.setFont('helvetica', 'bold'); doc.setFontSize(34); doc.setTextColor(...t.accent)
    const wordmarkW = doc.getTextWidth('ESTIMATE') + 'ESTIMATE'.length * 1.5
    doc.setCharSpace(1.5)
    doc.text('ESTIMATE', pageWidth - margin - wordmarkW, cursor + 6); doc.setCharSpace(0)
    cursor += 16
    // To + meta
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...t.accent)
    doc.text('TO', margin, cursor)
    doc.setFont('helvetica', 'normal'); doc.setFontSize(12); doc.setTextColor(...t.ink)
    doc.text(contact?.name || '', margin, cursor + 6)
    doc.setFontSize(9); doc.setTextColor(...t.muted)
    let ty = cursor + 11
    for (const l of themedAddressLines(contact)) { const w = doc.splitTextToSize(l, innerW * 0.5); doc.text(w, margin, ty); ty += w.length * 4.2 }
    const metaR = [['Estimate #', number], ['Estimate date', fmtShortPdf(issuedAt)], ['Valid until', fmtShortPdf(expiresAt)]]
    metaR.forEach(([label, val], i) => {
      const my = cursor + i * 5.5
      doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...t.accent)
      doc.text(label, pageWidth - margin - 38, my, { align: 'right' })
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...t.ink)
      doc.text(String(val), pageWidth - margin, my, { align: 'right' })
    })
    cursor = Math.max(ty, cursor + 18) + 4
    if (projectTitle) cursor = drawThemedProjectTitle(doc, { margin, y: cursor, title: projectTitle, t })
  } else {
    // editorial
    if (projectTitle) {
      doc.setFont('times', 'normal'); doc.setFontSize(16); doc.setTextColor(...t.ink)
      doc.text(projectTitle, margin, cursor + 4); cursor += 8
    }
    doc.setFont('times', 'normal'); doc.setFontSize(40); doc.setTextColor(...t.accent); doc.setCharSpace(1)
    doc.text('ESTIMATE', margin, cursor + 12); doc.setCharSpace(0)
    drawPlainLogo(doc, { x: pageWidth - margin, y: cursor - 4, maxW: 46, maxH: 18, logo, company, align: 'right', monoColor: t.accent })
    cursor += 22
    // Three columns: company / client / meta
    const colW = innerW / 3
    const coLines = [company?.name, ...themedAddressLines(company)].filter(Boolean)
    const clLines = [contact?.name, ...themedAddressLines(contact)].filter(Boolean)
    doc.setFontSize(9)
    let yMax = cursor
    ;[coLines, clLines].forEach((lines, ci) => {
      let yy = cursor
      lines.forEach((l, i) => {
        doc.setFont('helvetica', i === 0 ? 'bold' : 'normal')
        doc.setTextColor(...(i === 0 ? t.ink : t.mid))
        const wrapped = doc.splitTextToSize(String(l), colW - 8)
        doc.text(wrapped, margin + colW * ci, yy); yy += wrapped.length * 4.4
      })
      yMax = Math.max(yMax, yy)
    })
    const meta = [['Date', fmtShortPdf(issuedAt)], ['Estimate #', number], ['Est. Total', moneyCompact(total)]]
    meta.forEach(([label, val], i) => {
      const my = cursor + i * 6
      doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...t.accent)
      doc.text(label, margin + colW * 2, my)
      doc.setTextColor(...t.ink); doc.text(String(val), pageWidth - margin, my, { align: 'right' })
    })
    cursor = Math.max(yMax, cursor + 18) + 6
    // Scope prose up top
    if (scope && scope.trim()) {
      doc.setFont('times', 'normal'); doc.setFontSize(13); doc.setTextColor(...t.accent)
      doc.text('SCOPE OF WORK', margin, cursor); cursor += 6
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...t.mid)
      const sl = doc.splitTextToSize(scope.trim(), innerW)
      cursor = drawFlowingLines(doc, sl, { x: margin, y: cursor, lineHeight: 4.6, bottom, onNewPage: paintBg }) + 4
    }
    // Heading, table header and first row together.
    if (cursor + 30 > bottom) cursor = newPage(doc, paintBg)
    doc.setFont('times', 'normal'); doc.setFontSize(13); doc.setTextColor(...t.accent)
    doc.text('COST BREAKDOWN', margin, cursor); cursor += 3
  }

  // ---- Line items table (individual) ----
  cursor = drawThemedItemsTable(doc, { startY: cursor + 2, items: lineItems, margin, pageWidth, pageHeight, bottom, t, paintBg })

  // ---- Totals ----
  cursor = drawThemedTotals(doc, { startY: cursor + 4, pageWidth, margin, bottom, subtotal, total, t, template, paintBg })

  // ---- Optional upgrades ----
  if (upgradeItems.length > 0) {
    cursor += 6
    if (cursor + 30 > bottom) cursor = newPage(doc, paintBg)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(10); doc.setTextColor(...t.accent); doc.setCharSpace(0.6)
    doc.text('OPTIONAL UPGRADES', margin, cursor); doc.setCharSpace(0); cursor += 3
    cursor = drawThemedItemsTable(doc, { startY: cursor + 2, items: upgradeItems, margin, pageWidth, pageHeight, bottom, t, paintBg })
  }

  // ---- Photos ----
  if (Array.isArray(photos) && photos.length > 0) {
    cursor = await drawProjectPhotosBlock(doc, { photos, margin, pageWidth, bottom, startY: cursor + 6, brandRGB: t.accent, onNewPage: paintBg })
  }

  // ---- Supporting tail (scope for slate/mint, payment terms, warranty, exclusions) ----
  // Each block flows line by line across pages, so long contract terms are
  // never cut off the bottom of the page.
  const tailBlock = (label, body) => {
    if (!body) return
    cursor += 8
    // Keep the label with the first two lines of its text.
    if (cursor + 5 + 4.5 > bottom) cursor = newPage(doc, paintBg)
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...t.accent); doc.setCharSpace(0.8)
    doc.text(String(label).toUpperCase(), margin, cursor); doc.setCharSpace(0); cursor += 5
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...t.mid)
    const lines = doc.splitTextToSize(body, innerW)
    cursor = drawFlowingLines(doc, lines, { x: margin, y: cursor, lineHeight: 4.5, bottom, onNewPage: paintBg })
  }
  if (template !== 'editorial' && scope && scope.trim()) tailBlock('Scope of work', scope.trim())
  tailBlock('Payment terms', paymentTerms)
  if (warranty) tailBlock('Warranty', warranty)
  if (exclusions.length) tailBlock('Exclusions', exclusions.join(' · '))

  // ---- Signatures ----
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10)
  const al = doc.splitTextToSize('By signing below, the customer authorizes the company to perform the work outlined in this estimate and agrees to the terms and conditions contained herein.', innerW)
  cursor += 14
  // The label, the copy and both signature lines stay together.
  if (cursor + 5 + al.length * 4.5 + 16 + 6 > bottom) cursor = newPage(doc, paintBg)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(9); doc.setTextColor(...t.accent); doc.setCharSpace(0.8)
  doc.text('APPROVAL', margin, cursor); doc.setCharSpace(0); cursor += 5
  doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...t.mid)
  doc.text(al, margin, cursor); cursor += al.length * 4.5 + 16
  const colW = (innerW - 16) / 2
  doc.setDrawColor(...t.ink); doc.setLineWidth(0.4)
  doc.line(margin, cursor, margin + colW, cursor)
  doc.line(margin + colW + 16, cursor, pageWidth - margin, cursor)
  drawEsignAnchors(doc, { x: margin, lineY: cursor, width: colW, color: t.bg || [255, 255, 255] })
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...t.muted); doc.setCharSpace(0.6)
  doc.text('CLIENT SIGNATURE', margin, cursor + 5)
  doc.text('CONTRACTOR SIGNATURE', margin + colW + 16, cursor + 5); doc.setCharSpace(0)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9)
  doc.text('Date', margin + colW, cursor + 5, { align: 'right' })
  doc.text('Date', pageWidth - margin, cursor + 5, { align: 'right' })

  // ---- Disclaimer on every page ----
  const pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p)
    drawFooterText(doc, footer, t.muted)
  }
}

function themedAddressLines(party) {
  if (!party) return []
  const out = []
  if (party.address) out.push(String(party.address))
  const c = [party.phone, party.email].filter(Boolean).join(' · ')
  if (c) out.push(c)
  if (party.website) out.push(String(party.website))
  return out
}

function drawThemedParties(doc, { pageWidth, margin, y, company, recipient, t, labels }) {
  const colW = (pageWidth - margin * 2 - 12) / 2
  const leftX = margin, rightX = margin + colW + 12
  doc.setDrawColor(...t.muted); doc.setLineWidth(0.3)
  doc.line(leftX, y, leftX + colW, y); doc.line(rightX, y, rightX + colW, y)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(8); doc.setTextColor(...t.ink); doc.setCharSpace(0.8)
  doc.text(labels[0], leftX, y + 6); doc.text(labels[1], rightX, y + 6); doc.setCharSpace(0)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
  doc.text(company?.name || 'My Company', leftX, y + 12); doc.text(recipient?.name || '', rightX, y + 12)
  doc.setFont('helvetica', 'normal'); doc.setFontSize(9); doc.setTextColor(...t.mid)
  let ly = y + 17.5, ry = y + 17.5
  for (const l of themedAddressLines(company)) { doc.text(doc.splitTextToSize(l, colW), leftX, ly); ly += 4.4 }
  for (const l of themedAddressLines(recipient)) { doc.text(doc.splitTextToSize(l, colW), rightX, ry); ry += 4.4 }
  return Math.max(ly, ry) + 4
}

function drawThemedProjectTitle(doc, { margin, y, title, t }) {
  doc.setFont('helvetica', 'bold'); doc.setFontSize(7.5); doc.setTextColor(...t.muted); doc.setCharSpace(0.8)
  doc.text('PROJECT', margin, y); doc.setCharSpace(0)
  doc.setFont('helvetica', 'bold'); doc.setFontSize(15); doc.setTextColor(...t.accent)
  doc.text(title, margin, y + 7)
  return y + 12
}

function drawThemedItemsTable(doc, { startY, items, margin, pageHeight, bottom, t, paintBg }) {
  autoTable(doc, {
    startY,
    head: [['Description', 'Qty', 'Unit Price', 'Amount']],
    body: items.map((it) => [
      it.description || '',
      it.qty ? `${it.qty}${it.unit ? ` ${it.unit}` : ''}` : '',
      money(it.rate),
      money(it.amount)
    ]),
    theme: 'plain',
    headStyles: {
      fillColor: t.headFill || false,
      textColor: t.headText,
      fontStyle: 'bold',
      fontSize: TABLE_FONT_PT,
      cellPadding: { top: 4, right: 3, bottom: 4, left: 3 },
      lineWidth: t.headFill ? 0 : { bottom: 0.5 },
      lineColor: t.accent
    },
    bodyStyles: {
      fontSize: TABLE_FONT_PT, textColor: t.ink, valign: 'top',
      cellPadding: { top: 4.5, right: 3, bottom: 4.5, left: 3 }, lineWidth: 0
    },
    columnStyles: {
      0: { cellWidth: 'auto' },
      1: { halign: 'right', cellWidth: 20 },
      2: { halign: 'right', cellWidth: 32 },
      3: { halign: 'right', cellWidth: 32, fontStyle: 'bold' }
    },
    didDrawCell: rowRule(t.rule),
    willDrawPage: () => { if (paintBg) paintBg() },
    margin: tableMargin({ margin, pageHeight, bottom })
  })
  return doc.lastAutoTable.finalY
}

function drawThemedTotals(doc, { startY, pageWidth, margin, bottom, subtotal, total, t, template, paintBg }) {
  const rightX = pageWidth - margin
  const labelX = rightX - 40
  const showSubtotal = Math.abs(subtotal - total) > 0.005
  // Keep the totals together, below the table or at the top of the next page.
  const blockH = 6 + (showSubtotal ? 6 : 0) + 11
  let cursor = (startY + blockH > bottom ? newPage(doc, paintBg) - 6 : startY) + 6
  // Subtotal (only meaningful if it differs from total)
  if (showSubtotal) {
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(...t.muted)
    doc.text('Subtotal', labelX, cursor, { align: 'right' })
    doc.setTextColor(...t.ink); doc.text(money(subtotal), rightX, cursor, { align: 'right' })
    cursor += 6
  }
  if (template === 'editorial') {
    doc.setFont('times', 'normal'); doc.setFontSize(15); doc.setTextColor(...t.accent)
    doc.text('TOTAL', labelX, cursor + 4, { align: 'right' })
    doc.setTextColor(...t.ink); doc.text(money(total), rightX, cursor + 4, { align: 'right' })
    return cursor + 10
  }
  // Boxed/soft total for slate + mint
  const boxW = 48, boxH = 11, boxX = rightX - boxW
  if (template === 'mint' && t.soft) { doc.setFillColor(...t.soft); doc.rect(boxX, cursor, boxW, boxH, 'F') }
  else { doc.setDrawColor(...t.ink); doc.setLineWidth(0.4); doc.rect(boxX, cursor, boxW, boxH, 'S') }
  doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...(template === 'mint' ? t.accent : t.ink))
  doc.text('Total', boxX - 4, cursor + 7.5, { align: 'right' })
  doc.setFontSize(12); doc.text(money(total), rightX - 4, cursor + 7.5, { align: 'right' })
  return cursor + boxH + 6
}

/**
 * Generate a branded proposal PDF. company.estimate_template picks the
 * design: 'slate', 'mint' and 'editorial' render drawThemedProposal (the
 * proposalThemes.tsx designs); 'classic' and anything else render the
 * letterhead layout below, mirroring ProposalTemplate.tsx:
 *   letterhead, parties, project title, items grouped by trade, totals,
 *   optional upgrades, photos, payment terms, warranty, exclusions,
 *   insurance, acceptance (blank lines, or the recorded approval).
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
  changeOrders = []
} = {}) {
  const doc = createPdfDoc()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 16

  const logo = company?.logo_url
    ? await loadLogoForPdf(company.logo_url, { maxDimension: 720 })
    : null
  const brandRGB = parseBrandAccentRgb(company?.brand_accent_hex) || FIELD_GOLD
  const number = docProposalNumber(company?.name, quoteId || contact?.id)

  // Group items into rows. Each scope section (e.g. "Concrete add on")
  // becomes ONE row, its items list as scope lines in the description
  // column, and the row carries a single lump-sum amount.
  const mapped = mapItemsToScope(items)
  const baseRows = (mapped.scopeSections || []).map((sec) => ({
    title: sec.title,
    descriptionLines: (sec.items || []).map(proposalScopeLine),
    amount: (sec.items || []).reduce((s, it) => s + itemAmount(it), 0)
  }))

  const upgradeRows = (mapped.upgrades || []).map((sec) => ({
    title: sec.title,
    descriptionLines: (sec.items || []).map(proposalScopeLine),
    amount: (sec.items || []).reduce((s, it) => s + itemAmount(it), 0)
  }))

  const approvedCOAdjustment = (changeOrders || [])
    .filter((co) => co?.status === 'approved')
    .reduce((s, co) => s + Number(co.amount || 0), 0)

  const baseTotal = Number(mapped.baseTotal || 0)
  const grandTotal = Math.max(0, baseTotal + approvedCOAdjustment)

  // Themed templates (slate / mint / editorial), distinct designs with
  // individual line items. 'classic' (and any unknown value) falls
  // through to the editorial dark accent layout below, unchanged.
  const template = String(company?.estimate_template || 'classic').toLowerCase()
  if (template === 'slate' || template === 'mint' || template === 'editorial') {
    const lineItems = (mapped.scopeSections || []).flatMap((sec) =>
      (sec.items || []).map((it) => ({
        description: (it.description || '').trim(),
        qty: Number(it.qty || 1),
        unit: (it.unit || '').trim(),
        rate: Number(it.rate || 0),
        amount: itemAmount(it)
      }))
    )
    const upgradeItems = (mapped.upgrades || []).flatMap((sec) =>
      (sec.items || []).map((it) => ({
        description: (it.description || '').trim(),
        qty: Number(it.qty || 1),
        unit: (it.unit || '').trim(),
        rate: Number(it.rate || 0),
        amount: itemAmount(it)
      }))
    )
    const exclusionsArray = [
      ...(mapped.exclusions || []),
      ...((exclusions || '').split(/\n+/).map((s) => s.trim()).filter(Boolean))
    ]
    await drawThemedProposal(doc, {
      template, pageWidth, pageHeight, margin, company, logo,
      contact, number,
      issuedAt: new Date(), expiresAt,
      projectTitle: String(contact?.job_title || '').trim(),
      scope: scope || '',
      warranty: (company?.warranty_default || '').trim(),
      paymentTerms: (terms && terms.trim())
        ? terms.trim()
        : '50% deposit due upon approval · 40% due at material delivery or midpoint · 10% due upon substantial completion.',
      exclusions: exclusionsArray,
      lineItems, upgradeItems,
      subtotal: baseTotal, total: grandTotal,
      photos
    })
    return {
      doc,
      filename: `Proposal_${number}_${(contact?.name || 'client').replace(/\s+/g, '_')}.pdf`,
      number
    }
  }

  const footer = footerLayout(doc, { pageWidth, pageHeight, margin, text: PROPOSAL_DISCLAIMER })
  const bottom = footer.contentBottom

  // Letterhead (premium company-name chrome + Issued / Valid until meta)
  const estMetaRows = [{ label: 'Issued', value: formatDocDate(new Date()) }]
  if (expiresAt) estMetaRows.push({ label: 'Valid until', value: formatDocDate(expiresAt), strong: true })
  let cursor = drawModernLetterhead(doc, {
    pageWidth, margin, docType: 'Estimate', number, company, logo, brandRGB,
    metaRows: estMetaRows
  })

  // Parties
  cursor = drawDocParties(doc, {
    pageWidth, margin, y: cursor + 6,
    recipient: contact, company
  })

  // Project title, what the estimate is for
  const projectTitle = String(contact?.job_title || '').trim()
  if (projectTitle) {
    cursor += 6
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(8)
    doc.setTextColor(...INK_MUTED)
    doc.setCharSpace(0.8)
    doc.text('PROJECT', margin, cursor)
    doc.setCharSpace(0)
    cursor += 6
    doc.setFont('times', 'normal')
    doc.setFontSize(18)
    doc.setTextColor(...ONYX)
    const titleLines = doc.splitTextToSize(projectTitle, pageWidth - margin * 2)
    doc.text(titleLines, margin, cursor)
    cursor += titleLines.length * 7
  }

  // Items
  if (baseRows.length > 0) {
    cursor = drawDocItemsTable(doc, { startY: cursor + 4, rows: baseRows, brandRGB, margin, pageWidth, pageHeight, bottom, layout: 'sectioned' })
  }

  // Totals
  const totalsRows = []
  if (approvedCOAdjustment !== 0) {
    totalsRows.push({ label: 'Subtotal', value: moneyCompact(baseTotal) })
    totalsRows.push({ label: 'Approved change orders', value: `${approvedCOAdjustment >= 0 ? '+' : ''}${moneyCompact(approvedCOAdjustment)}` })
  }
  cursor = drawDocTotalsBlock(doc, {
    startY: cursor, pageWidth, margin, bottom,
    label: 'Total', total: grandTotal, rows: totalsRows
  })

  // Optional upgrades
  if (upgradeRows.length > 0) {
    cursor += 6
    // Label, table header and the first upgrade together.
    if (cursor + 30 > bottom) cursor = newPage(doc)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(11)
    doc.setTextColor(...ONYX)
    doc.setCharSpace(0.6)
    doc.text('OPTIONAL UPGRADES', margin, cursor)
    doc.setCharSpace(0)
    cursor += 4
    cursor = drawDocItemsTable(doc, { startY: cursor, rows: upgradeRows, brandRGB, margin, pageWidth, pageHeight, bottom, layout: 'sectioned' })
  }

  // Project photos, loaded through loadImageForPdf so the PDF carries
  // embedded imagery. Renders a grouped grid by section_tag below the
  // items + upgrades tables.
  if (Array.isArray(photos) && photos.length > 0) {
    cursor = await drawProjectPhotosBlock(doc, {
      photos, margin, pageWidth, bottom, startY: cursor + 6, brandRGB
    })
  }

  // Editorial detail blocks (payment terms, warranty, exclusions)
  const warranty = (company?.warranty_default || '').trim()
  const exclusionsArray = [
    ...(mapped.exclusions || []),
    ...((exclusions || '').split(/\n+/).map((s) => s.trim()).filter(Boolean))
  ]

  // Each block flows line by line across pages, so long contract terms
  // are never cut off the bottom of the page.
  function drawDetailBlock(label, body) {
    if (!body) return
    cursor += 8
    // Keep the label with the first two lines of its text.
    if (cursor + 5 + 4.5 > bottom) cursor = newPage(doc)
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
    cursor = drawFlowingLines(doc, lines, { x: margin, y: cursor, lineHeight: 4.5, bottom })
  }

  // Payment terms, the contractor's own terms_text when provided,
  // otherwise the 50/40/10 default. (Ignoring terms_text and always
  // hardcoding the default was the bug.)
  drawDetailBlock(
    'Payment terms',
    (terms && terms.trim())
      ? terms.trim()
      : '50% deposit due upon approval · 40% due at material delivery or midpoint · 10% due upon substantial completion.'
  )
  if (warranty)                drawDetailBlock('Warranty', warranty)
  if (exclusionsArray.length)  drawDetailBlock('Exclusions', exclusionsArray.join(' · '))

  // Insurance claim card (restoration jobs), hidden for cash jobs.
  cursor = drawModernInsurance(doc, {
    startY: cursor, margin, pageWidth, bottom, brandRGB, insurance
  })

  // Acceptance, honest signatures: the recorded approval when the
  // estimate is approved, blank lines otherwise (never a filled
  // cursive name, which reads as a forged signature).
  cursor = drawModernApproval(doc, {
    startY: cursor, margin, pageWidth, bottom,
    company, contact, approval, status
  })

  // Disclaimer on every page
  const total_pages = doc.internal.getNumberOfPages()
  for (let p = 1; p <= total_pages; p++) {
    doc.setPage(p)
    drawFooterText(doc, footer, INK_MUTED)
  }

  return {
    doc,
    filename: `Proposal_${number}_${(contact?.name || 'client').replace(/\s+/g, '_')}.pdf`,
    number
  }
}

/**
 * Generate a one-page Certificate of Completion PDF from a saved
 * fh_closeouts row, in the same design language as the redesigned
 * estimate/invoice documents: company-name letterhead (no logo
 * billboard), small-caps doc type with a real number, serif headline,
 * neutral hairline sections, and a flow-safe footer.
 *
 *   • Project block, name + address + completion date
 *   • Warranty block, start date + duration + computed end date
 *   • Approval block, customer name + method + signed-on date
 *   • Closing notes (when present)
 *   • Final figures (contract / paid / status)
 *   • Two-line signature/date footer the customer can sign on paper
 *
 * Layout safety: the signature block + disclaimer reserve their space
 * up front, if the flowing content would collide (long notes), the
 * footer moves to a fresh page instead of overprinting (the old
 * fixed-position footer drew straight over the Final figures rows).
 *
 * Returns { doc, filename } so the existing downloadPdf() helper can
 * trip the browser save. Async because the brand image loads first.
 */
export async function generateCertificate({
  company = {},
  contact = {},
  closeout = {},
  options = {}
} = {}) {
  const doc = createPdfDoc()
  const pageWidth = doc.internal.pageSize.getWidth()
  const pageHeight = doc.internal.pageSize.getHeight()
  const margin = 18

  const brandRGB = parseBrandRGB(company.brand_accent_hex) || FIELD_GOLD
  const logo = company.logo_url ? await loadLogoForPdf(company.logo_url) : null

  const paintPage = () => {
    doc.setFillColor(...RAW_LINEN)
    doc.rect(0, 0, pageWidth, pageHeight, 'F')
    doc.setFillColor(...brandRGB)
    doc.rect(0, 0, pageWidth, 1.4, 'F')
  }
  paintPage()

  const closedAt = closeout.closed_at || closeout.signoff_at || new Date().toISOString()
  const rightCol = pageWidth - margin

  // ── Letterhead, company identity left, doc meta right ──
  let cursor = 16
  let leftY = cursor
  if (logo && logo.dataUrl && logo.width > 0 && logo.height > 0) {
    const maxH = 12
    const aspect = logo.width / logo.height
    let h = maxH
    let w = h * aspect
    if (w > 42) { w = 42; h = w / aspect }
    try {
      doc.addImage(logo.dataUrl, logo.format || 'PNG', margin, leftY, w, h)
      leftY += h + 4
    } catch { /* logo optional */ }
  }
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(14)
  doc.setTextColor(...ONYX)
  doc.text(company.name || 'Contractor', margin, leftY + 4)
  leftY += 9
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8.5)
  doc.setTextColor(...INK_MUTED)
  if (company.address) { doc.text(String(company.address), margin, leftY); leftY += 4 }
  const contactLine = [company.phone, company.email, company.website].filter(Boolean).join('  ·  ')
  if (contactLine) { doc.text(contactLine, margin, leftY); leftY += 4 }

  // Right-aligned tracked caps: jsPDF's align:'right' ignores
  // charSpace, so measure the tracked width and left-anchor instead :
  // otherwise the title clips off the page edge.
  const docTypeText = 'COMPLETION CERTIFICATE'
  const track = 0.8
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(9.5)
  doc.setTextColor(...ONYX)
  doc.setCharSpace(track)
  const trackedW = doc.getTextWidth(docTypeText) + (docTypeText.length - 1) * track
  doc.text(docTypeText, rightCol - trackedW, cursor + 4)
  doc.setCharSpace(0)
  doc.setFontSize(10)
  doc.setTextColor(60, 56, 51)
  doc.text(certificateNumber(company.name, closeout.id || contact.id), rightCol, cursor + 10, { align: 'right' })
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7)
  doc.setTextColor(...INK_MUTED)
  doc.setCharSpace(0.7)
  doc.text('ISSUED', rightCol - 26, cursor + 16, { align: 'right' })
  doc.setCharSpace(0)
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(...ONYX)
  doc.text(formatDocDate(closedAt), rightCol, cursor + 16, { align: 'right' })

  cursor = Math.max(leftY, cursor + 20) + 4
  doc.setDrawColor(213, 207, 190)
  doc.setLineWidth(0.3)
  doc.line(margin, cursor, rightCol, cursor)
  cursor += 10

  // ── Headline, real serif via the built-in Times face ──
  doc.setFont('times', 'normal')
  doc.setFontSize(26)
  doc.setTextColor(...ONYX)
  doc.text('Certificate of Completion', margin, cursor)
  cursor += 8

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(10.5)
  doc.setTextColor(...INK_MUTED)
  const subline = `${company.name || 'Contractor'} certifies that the work described below was completed for ${contact.name || 'the customer'} on ${formatDocDate(closedAt)}.`
  const sublines = doc.splitTextToSize(subline, pageWidth - margin * 2)
  doc.text(sublines, margin, cursor)
  cursor += sublines.length * 4.8 + 6

  // ── Parties, prepared for / project site ──
  const colW = (pageWidth - margin * 2 - 12) / 2
  const rightX = margin + colW + 12
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(7.5)
  doc.setTextColor(163, 159, 149)
  doc.setCharSpace(0.8)
  doc.text('PREPARED FOR', margin, cursor)
  doc.text('PROJECT', rightX, cursor)
  doc.setCharSpace(0)
  cursor += 5.5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(12)
  doc.setTextColor(...ONYX)
  doc.text(contact.name || '', margin, cursor)
  const jobLines = doc.splitTextToSize(contact.job_title || contact.name || '', colW)
  doc.text(jobLines, rightX, cursor)
  let pLeft = cursor + 5
  let pRight = cursor + jobLines.length * 5
  doc.setFont('helvetica', 'normal')
  doc.setFontSize(9)
  doc.setTextColor(60, 56, 51)
  if (contact.address) {
    const addr = doc.splitTextToSize(String(contact.address), colW)
    doc.text(addr, margin, pLeft)
    pLeft += addr.length * 4.2
    doc.text(addr, rightX, pRight)
    pRight += addr.length * 4.2
  }
  doc.setTextColor(...INK_MUTED)
  doc.text(`Completed ${formatDocDate(closedAt)}`, rightX, pRight)
  pRight += 4.2
  cursor = Math.max(pLeft, pRight) + 7

  // ── Sections ──
  const months = Number(closeout.warranty_months) || 0
  const warrantyStart = closeout.warranty_start_date || null
  const warrantyEnd = warrantyStart && months > 0 ? addMonthsIso(warrantyStart, months) : null
  cursor = drawCertSection(doc, {
    margin, pageWidth, pageHeight, paintPage, y: cursor,
    label: 'Warranty',
    rows: months > 0
      ? [
          { k: 'Coverage', v: months === 12 ? '1 year' : months === 24 ? '2 years' : `${months} months` },
          { k: 'Starts', v: warrantyStart ? formatDocDate(warrantyStart) : '' },
          { k: 'Through', v: warrantyEnd ? formatDocDate(warrantyEnd) : '' }
        ]
      : [
          { k: 'Coverage', v: 'No express warranty included.' }
        ]
  })

  const methodLabel = ({
    verbal: 'Verbal confirmation',
    text: 'Text confirmation',
    email: 'Email confirmation',
    in_person: 'In person walkthrough',
    signature_typed: 'Typed signature'
  })[closeout.signoff_method] || 'Verbal confirmation'
  cursor = drawCertSection(doc, {
    margin, pageWidth, pageHeight, paintPage, y: cursor,
    label: 'Customer approval',
    rows: [
      { k: 'Signed by', v: closeout.signoff_name || contact.name || '' },
      { k: 'Method', v: methodLabel },
      { k: 'Signed on', v: closeout.signoff_at ? formatDocDate(closeout.signoff_at) : formatDocDate(closedAt) }
    ]
  })

  if (closeout.notes && String(closeout.notes).trim()) {
    cursor = drawCertSection(doc, {
      margin, pageWidth, pageHeight, paintPage, y: cursor,
      label: 'Closing notes',
      bodyText: String(closeout.notes).trim()
    })
  }

  const contract = Number(closeout.final_amount || contact.amount || 0)
  const paid = Number(closeout.paid_at_close || 0)
  const balance = Math.max(0, contract - paid)
  cursor = drawCertSection(doc, {
    margin, pageWidth, pageHeight, paintPage, y: cursor,
    label: 'Final figures',
    rows: [
      { k: 'Contract', v: moneyCompact(contract) },
      { k: 'Paid to date', v: moneyCompact(paid) },
      balance > 0
        ? { k: 'Outstanding', v: moneyCompact(balance) }
        : { k: 'Status', v: 'Paid in full', green: true }
    ]
  })

  // ── Flow-safe footer: signatures + disclaimer ──
  // Reserve the exact space both need; a long notes section pushes the
  // footer to a fresh page instead of overprinting the figures (the
  // old fixed-anchor draw caused exactly that collision).
  const disclaimerText = 'Issuance of this certificate confirms that work was completed in accordance with the contracted scope. Warranty terms above govern the express coverage period; latent defects outside the scope are excluded.'
  doc.setFontSize(8)
  const discLines = doc.splitTextToSize(disclaimerText, pageWidth - margin * 2)
  const discH = discLines.length * 3.6
  // Signature block bottoms out 6mm above the disclaimer, which is
  // anchored at the bottom margin. 17mm = sig lines + date stubs.
  const sigY = pageHeight - 12 - discH - 6 - 17
  if (cursor > sigY - 8) {
    doc.addPage()
    paintPage()
  }
  drawCertSignatureLines(doc, { y: sigY, margin, pageWidth })

  doc.setFont('helvetica', 'normal')
  doc.setFontSize(8)
  doc.setTextColor(...INK_MUTED)
  doc.text(discLines, margin, pageHeight - 12 - (discLines.length - 1) * 3.6)

  const safeName = (contact.name || 'completion').replace(/[^A-Za-z0-9_-]+/g, '-').slice(0, 40)
  const stamp = new Date(closedAt).toISOString().slice(0, 10)
  const filename = options.filename || `Certificate-${safeName}-${stamp}.pdf`
  return { doc, filename }
}

// Certificate number, company prefix + short stable tail, matching
// the estimate/invoice numbering family (never a raw 12-char id chunk).
function certificateNumber(companyName, seed) {
  const pfx = docCompanyPrefix(companyName)
  const tail = String(seed || '').replace(/[^a-zA-Z0-9]/g, '').slice(-4).toUpperCase() || '0001'
  return pfx ? `${pfx}-CERT-${tail}` : `CERT-${tail}`
}

function drawCertSection(doc, opts) {
  const { margin, pageWidth, pageHeight, y, label, rows, bodyText, paintPage } = opts
  let cursor = y

  // Page-break guard, a long closing-notes section used to push the
  // Final figures + signature footer off the bottom of the page. If we
  // start within ~40mm of the page bottom, open a fresh page and
  // repaint the cream background before drawing the section.
  if (pageHeight && cursor > pageHeight - 40) {
    doc.addPage()
    if (paintPage) paintPage()
    cursor = 18
  }

  // Full-width hairline + ink small-caps label, same idiom as the
  // HTML documents' section headers.
  doc.setDrawColor(213, 207, 190)
  doc.setLineWidth(0.3)
  doc.line(margin, cursor, pageWidth - margin, cursor)
  cursor += 5
  doc.setFont('helvetica', 'bold')
  doc.setFontSize(8)
  doc.setTextColor(...ONYX)
  doc.setCharSpace(0.9)
  doc.text(String(label || '').toUpperCase(), margin, cursor)
  doc.setCharSpace(0)
  cursor += 3

  if (bodyText) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(10)
    doc.setTextColor(...ONYX)
    const lines = doc.splitTextToSize(bodyText, pageWidth - margin * 2)
    cursor += 4
    // Flow long notes across pages instead of overprinting the footer.
    for (const line of lines) {
      if (pageHeight && cursor > pageHeight - 24) {
        doc.addPage()
        if (paintPage) paintPage()
        cursor = 18
      }
      doc.text(line, margin, cursor)
      cursor += 4.6
    }
    return cursor + 6
  }

  for (const row of rows || []) {
    doc.setFont('helvetica', 'normal')
    doc.setFontSize(8)
    doc.setTextColor(...INK_MUTED)
    doc.setCharSpace(0.5)
    doc.text(String(row.k || '').toUpperCase(), margin, cursor + 4)
    doc.setCharSpace(0)
    doc.setFont('helvetica', 'bold')
    doc.setFontSize(10.5)
    doc.setTextColor(...(row.green ? SIGNAL_GREEN : ONYX))
    doc.text(String(row.v || ''), pageWidth - margin, cursor + 4, { align: 'right' })
    cursor += 6.5
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
  doc.setFontSize(7.5)
  doc.setTextColor(...INK_MUTED)
  doc.setCharSpace(0.6)
  doc.text('CUSTOMER SIGNATURE', leftX, y + 4)
  doc.text('CONTRACTOR SIGNATURE', rightX, y + 4)

  // Date stubs
  const dateY = y + 13
  doc.setLineWidth(0.3)
  doc.line(leftX, dateY, leftX + 50, dateY)
  doc.line(rightX, dateY, rightX + 50, dateY)
  doc.text('DATE', leftX, dateY + 4)
  doc.text('DATE', rightX, dateY + 4)
  doc.setCharSpace(0)
}

function addMonthsIso(isoDate, months) {
  // Parse date-only values as LOCAL calendar days (not UTC) so the
  // warranty-end date doesn't drift a day, then return a local
  // "year month day" (never toISOString, which re-introduces the UTC shift).
  const d = parseDateLocal(isoDate)
  if (!d) return null
  d.setMonth(d.getMonth() + months)
  const y = d.getFullYear()
  const m = String(d.getMonth() + 1).padStart(2, '0')
  const day = String(d.getDate()).padStart(2, '0')
  return `${y}-${m}-${day}`
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
