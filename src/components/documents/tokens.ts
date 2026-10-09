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
// customer facing document when the contractor has set their own.
//
// Design direction: editorial / Linear / Stripe / high-end architect's
// proposal. Black, paper, slate, restrained warm gold. No saturated
// gradients, no badge soup.

// The six locked palette colors (scripts/audit-design-system.mjs). Every
// document color is one of these or a mix of two of them.
const GOLD = '#C9963A'
const INK = '#141414'
const PAPER = '#F2EDE4'
const MUTED = '#5C5C5C'
const RED = '#C0392B'
const GREEN = '#2D7A4F'

/** '#RRGGBB' to an [r, g, b] tuple for jsPDF. Malformed input gives black. */
export function hexToRgb(hex: string): [number, number, number] {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim())
  if (!m) return [0, 0, 0]
  const n = parseInt(m[1], 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}

/**
 * Mix two '#RRGGBB' colors, `weight` (0 to 1) of `a` over `b`, with the same
 * arithmetic as CSS color-mix(in srgb, a weight%, b). Derived tones are
 * computed here instead of written out as new hex values, so they stay on
 * the palette and the jsPDF export (which cannot read color-mix) can share
 * them with the HTML documents.
 */
export function mixHex(a: string, b: string, weight: number): string {
  const [ar, ag, ab] = hexToRgb(a)
  const [br, bg, bb] = hexToRgb(b)
  const w = Math.max(0, Math.min(1, weight))
  const channel = (x: number, y: number) => Math.round(x * w + y * (1 - w)).toString(16).padStart(2, '0')
  return `#${channel(ar, br)}${channel(ag, bg)}${channel(ab, bb)}`
}

export const DOC_COLORS = {
  // Page surface
  paper:        PAPER,
  paperSoft:    mixHex(INK, PAPER, 0.04),   // soft block bg (totals card, terms), one shade off the page

  // Ink
  ink:          INK,                        // body text, headings
  inkMid:       INK,                        // bold values, table cells
  inkMuted:     MUTED,                      // labels, secondary lines
  inkFaint:     MUTED,                      // captions, meta, fine print. Gold measured 2.3:1 on paper, below WCAG AA.

  // Lines. These must differ from the paper or every divider disappears.
  rule:         mixHex(INK, PAPER, 0.12),   // hairline dividers
  ruleStrong:   mixHex(INK, PAPER, 0.22),   // section separators

  // Brand
  gold:         GOLD,                       // default brand accent (overridable per company)
  goldBright:   GOLD,
  goldSoft:     mixHex(GOLD, PAPER, 0.16),  // pill backgrounds

  // States
  alertRed:     RED,                        // overdue
  signalGreen:  GREEN,                      // paid / approved
  slate:        MUTED                       // neutral status pill
}

export type ThemePalette = {
  accent: string       // header bar, wordmark, labels
  accentSoft: string   // tinted total box
  onAccent: string     // text drawn on an accent fill
  ink: string          // primary text
  mid: string          // body copy in the supporting sections
  muted: string        // secondary text
  rule: string         // row dividers
  paper: string | null // page color; null keeps the default page (cream on screen, white in the PDF)
}

// Colors for the selectable estimate themes (Settings, Estimate template).
// proposalThemes.tsx renders them on screen and pdf.js converts the same
// values to RGB for the PDF, so the emailed or signed PDF matches the
// preview the contractor picked.
export const THEME_PALETTES: Record<'slate' | 'mint' | 'editorial', ThemePalette> = {
  slate: {
    accent: MUTED, accentSoft: mixHex(MUTED, PAPER, 0.12), onAccent: PAPER,
    ink: INK, mid: INK, muted: MUTED, rule: DOC_COLORS.rule, paper: null
  },
  mint: {
    accent: GREEN, accentSoft: mixHex(GREEN, PAPER, 0.12), onAccent: PAPER,
    ink: INK, mid: INK, muted: MUTED, rule: DOC_COLORS.rule, paper: null
  },
  editorial: {
    accent: GOLD, accentSoft: mixHex(GOLD, PAPER, 0.16), onAccent: INK,
    ink: INK, mid: MUTED, muted: MUTED, rule: mixHex(GOLD, PAPER, 0.25), paper: PAPER
  }
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
  letterSpacing?: string | number
  textTransform?: string
  lineHeight?: number
  color?: string
}

// Type scale, sizes in px so they map cleanly to HTML preview AND
// jsPDF (which works in pt; convert via 1pt ≈ 1.333px when rendering).
export const DOC_TYPE: Record<string, DocTypeScale> = {
  eyebrow:  { size: 10, weight: 700, letterSpacing: 0, textTransform: 'uppercase', family: 'body' },
  label:    { size: 9,  weight: 700, letterSpacing: 0, textTransform: 'uppercase', family: 'body' },
  stamp:    { size: 11, weight: 600, letterSpacing: 0, family: 'body' },
  body:     { size: 13, weight: 400, family: 'body', lineHeight: 1.5 },
  bodyBold: { size: 13, weight: 600, family: 'body', lineHeight: 1.5 },
  sub:      { size: 11, weight: 400, family: 'body', lineHeight: 1.45, color: 'inkMuted' },
  h3:       { size: 16, weight: 600, letterSpacing: 0, family: 'body' },
  h2:       { size: 22, weight: 600, letterSpacing: 0, family: 'serif' },
  h1:       { size: 32, weight: 500, letterSpacing: 0, family: 'serif' },
  hero:     { size: 44, weight: 500, letterSpacing: 0, family: 'serif' }
}

export const DOC_SPACE = {
  // Letter paper geometry. Preview renders at this size on desktop;
  // shrinks responsively on mobile while preserving the proportions.
  pageWidthPx:  816,   // 8.5" @ 96dpi
  pageMinHeightPx: 1056, // 11"  @ 96dpi
  marginPx:     56,    // ~0.6" comfortable letter margin
  gutter:       16,    // section internal padding
  blockGap:     24,    // gap between major sections
  cardGap:      12     // gap between cards within a section
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
 * Resolve the "soft" tint of the brand accent, used for pill
 * backgrounds and totals card surfaces. 16% of the brand color over
 * the cream paper.
 */
export function resolveBrandGoldSoft(company: { brand_accent_hex?: string | null } | null | undefined) {
  return `color-mix(in srgb, ${resolveBrandGold(company)} 16%, ${DOC_COLORS.paperSoft})`
}

/**
 * Inline style helper, converts a key in DOC_TYPE to a React style
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
