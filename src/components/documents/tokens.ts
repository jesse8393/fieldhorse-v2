// src/components/documents/tokens.ts
//
// Shared design tokens for FieldHorse document templates (HTML preview
// + jsPDF export). One palette + one type scale that both the in-app
// previews and the exported PDFs read from, so the customer never sees
// a layout mismatch between what the contractor approves on-screen and
// what lands in their inbox.
//
// White-label rule: the gold accent below is the *default* brand
// color. Per-company overrides come through profile.brand_accent_hex
// (validated `#RRGGBB`) and flow into every template via the
// `resolveBrandGold(company)` helper. The default never leaks into a
// customer-facing document when the contractor has set their own.
//
// Design direction: editorial / Linear / Stripe / high-end architect's
// proposal. Black, paper, slate, restrained warm gold. No saturated
// gradients, no badge soup.

export const DOC_COLORS = {
  // Page surface
  paper:        '#FFFFFF',
  paperSoft:    '#FBF8F1',  // light-cream block bg (totals card, terms)

  // Ink
  ink:          '#1A1814',  // body text, headings
  inkMid:       '#3A3833',  // bold values, table cells
  inkMuted:     '#6B6A66',  // labels, secondary lines
  inkFaint:     '#A39F95',  // captions, hairline meta

  // Lines
  rule:         '#E8E4D8',  // hairline dividers
  ruleStrong:   '#D5CFBE',  // section separators

  // Brand
  gold:         '#C8A154',  // default brand accent (overridable per company)
  goldBright:   '#E8B865',
  goldSoft:     '#F4ECD8',  // pill backgrounds

  // States
  alertRed:     '#B33A3A',  // overdue
  signalGreen:  '#48825F',  // paid / approved
  slate:        '#5C6168'   // neutral status pill
}

export const DOC_FONTS: Record<string, string> = {
  display:  "'Bebas Neue', 'Helvetica Neue', sans-serif",
  // Two-family brand: the serif slot maps to the body family so legacy
  // template call sites keep working without shipping a third font.
  serif:    "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  body:     "'DM Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif"
}

type DocTypeScale = {
  size: number | string
  weight: number
  family?: string
  letterSpacing?: string
  textTransform?: string
  lineHeight?: number
  color?: string
}

// Type scale — sizes in px so they map cleanly to HTML preview AND
// jsPDF (which works in pt; convert via 1pt ≈ 1.333px when rendering).
export const DOC_TYPE: Record<string, DocTypeScale> = {
  eyebrow:  { size: 10, weight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', family: 'body' },
  label:    { size: 9,  weight: 700, letterSpacing: '0.14em', textTransform: 'uppercase', family: 'body' },
  stamp:    { size: 11, weight: 600, letterSpacing: '0.04em', family: 'body' },
  body:     { size: 13, weight: 400, family: 'body', lineHeight: 1.5 },
  bodyBold: { size: 13, weight: 600, family: 'body', lineHeight: 1.5 },
  sub:      { size: 11, weight: 400, family: 'body', lineHeight: 1.45, color: 'inkMuted' },
  h3:       { size: 16, weight: 600, letterSpacing: '-0.01em', family: 'body' },
  h2:       { size: 22, weight: 600, letterSpacing: '-0.02em', family: 'serif' },
  h1:       { size: 32, weight: 500, letterSpacing: '-0.025em', family: 'serif' },
  hero:     { size: 44, weight: 500, letterSpacing: '-0.03em', family: 'serif' }
}

export const DOC_SPACE = {
  // Letter paper geometry. Preview renders at this size on desktop;
  // shrinks responsively on mobile while preserving the proportions.
  pageWidthPx:  816,   // 8.5" @ 96dpi
  pageMinHeightPx: 1056, // 11"  @ 96dpi
  marginPx:     56,    // ~0.6" comfortable letter margin
  gutter:       16,    // section internal padding
  blockGap:     28,    // gap between major sections
  cardGap:      14     // gap between cards within a section
}

// jsPDF-friendly mirror of the palette in [r, g, b] tuples + mm margins.
// pdf.js can import this so the export path and the preview share one
// source of truth. Hex → RGB on the few used in PDF code.
export const DOC_PDF = {
  marginMm:   16,
  format:     'letter',
  unit:       'mm',
  rgb: {
    ink:        [26, 24, 20],
    inkMid:     [58, 56, 51],
    inkMuted:   [107, 106, 102],
    inkFaint:   [163, 159, 149],
    rule:       [232, 228, 216],
    ruleStrong: [213, 207, 190],
    gold:       [200, 161, 84],
    goldBright: [232, 184, 101],
    goldSoft:   [244, 236, 216],
    paper:      [255, 255, 255],
    paperSoft:  [251, 248, 241],
    alertRed:   [179, 58, 58],
    signalGreen:[72, 130, 95]
  }
}

/**
 * Resolve the brand accent color for a company. Falls back to the
 * default gold when the value is missing or malformed. Returns a hex
 * string suitable for CSS; pdf.js has its own RGB parser.
 */
export function resolveBrandGold(company: { brand_accent_hex?: string | null } | null | undefined) {
  const raw = (company?.brand_accent_hex || '').trim()
  if (/^#[0-9a-f]{6}$/i.test(raw)) return raw
  return DOC_COLORS.gold
}

/**
 * Resolve the "soft" tint of the brand accent — used for pill
 * backgrounds and totals card surfaces. 16% of the brand color over
 * the cream paper.
 */
export function resolveBrandGoldSoft(company: { brand_accent_hex?: string | null } | null | undefined) {
  return `color-mix(in srgb, ${resolveBrandGold(company)} 16%, ${DOC_COLORS.paperSoft})`
}

/**
 * Inline style helper — converts a key in DOC_TYPE to a React style
 * object. Lets templates write `style={{ ...typeStyle('h2'), color: ... }}`
 * instead of repeating the same six properties every block.
 */
export function typeStyle(scaleKey: string) {
  const t = DOC_TYPE[scaleKey] || DOC_TYPE.body
  return {
    fontFamily: DOC_FONTS[t.family || 'body'],
    fontSize: typeof t.size === 'number' ? `${t.size}px` : t.size,
    fontWeight: t.weight,
    letterSpacing: t.letterSpacing,
    textTransform: t.textTransform,
    lineHeight: t.lineHeight || 1.3
  }
}
