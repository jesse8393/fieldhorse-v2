// The quote editor on a phone (spec 9.6, decisions D8 and D31), as a pure
// view model.
//
// Lines come from the job's fh_quote_items rows. Base lines make up the
// quoted price, optional lines are shown beside it and never counted,
// excluded lines are out of scope and never counted either. There is no
// overhead line (the app has no overhead concept). The total and the
// deposit the capsule prints come from lib/quoteMoney.ts, the same rule
// the proposal preview and the customer page use (D31).
//
// Every line this module writes itself avoids dashes of any kind. Titles
// and notes that people typed pass through untouched. Money prints cents.

import { lineAmount, quoteMoney, type QuoteMoney, type QuoteMoneyInput } from './quoteMoney.ts'
import { moneyCents } from './format.ts'

/** The fields of an fh_quote_items row this view reads. */
export type QuoteItemRow = {
  id: string
  section?: string | null
  description: string | null
  qty: number | string | null
  unit?: string | null
  rate: number | string | null
  amount: number | string | null
  notes?: string | null
  is_optional?: boolean | null
  is_excluded?: boolean | null
  sort_order?: number | string | null
  created_at?: string | null
}

export type QuoteLineView = {
  id: string
  title: string
  /** "1,100 sq ft at $2.00", with the note after a comma when there is one. */
  detail: string
  amount: number
}

/** What the quote's money reads besides its lines (see quoteMoney). */
export type QuoteTerms = Omit<QuoteMoneyInput, 'items'>

export type QuoteView = {
  lines: QuoteLineView[]
  optional: QuoteLineView[]
  excluded: QuoteLineView[]
  /** The base lines alone, without change orders or the contact amount. */
  baseTotal: number
  /** The quote's total, deposit and steps, as every other place prints them. */
  money: QuoteMoney
  canSend: boolean
}

function num(value: unknown): number {
  const n = Number(value ?? 0)
  return Number.isFinite(n) ? n : 0
}

function cents(value: unknown): number {
  return Math.round(num(value) * 100)
}

function quantity(value: number): string {
  return value.toLocaleString(undefined, { maximumFractionDigits: 2 })
}

function detailFor(row: QuoteItemRow): string {
  const qty = num(row.qty)
  const unit = String(row.unit ?? '').trim()
  const rate = num(row.rate)
  const note = String(row.notes ?? '').trim()

  const amountPart = qty === 1 && !unit ? '' : `${quantity(qty)}${unit ? ` ${unit}` : ''}`
  const ratePart = rate > 0 ? moneyCents(rate) : ''
  let main = ''
  if (amountPart && ratePart) main = `${amountPart} at ${ratePart}`
  else main = amountPart || ratePart
  // A zero quantity says nothing useful; the rate alone does.
  if (qty <= 0) main = ratePart

  return [main, note].filter(Boolean).join(', ')
}

function lineView(row: QuoteItemRow): QuoteLineView {
  return {
    id: row.id,
    title: String(row.description ?? '').trim() || 'Line item',
    detail: detailFor(row),
    amount: cents(lineAmount(row)) / 100
  }
}

function byOrder(a: { row: QuoteItemRow; i: number }, b: { row: QuoteItemRow; i: number }) {
  const so = num(a.row.sort_order) - num(b.row.sort_order)
  if (so !== 0) return so
  const ta = a.row.created_at ? Date.parse(a.row.created_at) : NaN
  const tb = b.row.created_at ? Date.parse(b.row.created_at) : NaN
  if (Number.isFinite(ta) && Number.isFinite(tb) && ta !== tb) return ta - tb
  return a.i - b.i
}

/**
 * Lines, optional and excluded lists, the base total and the quote's
 * money. Pass the quote's change orders, contact amount and payment terms
 * so the total and the deposit match the preview and the customer page.
 */
export function buildQuoteView(items: QuoteItemRow[], terms: QuoteTerms = {}): QuoteView {
  const ordered = items.map((row, i) => ({ row, i })).sort(byOrder).map((x) => x.row)

  const lines: QuoteLineView[] = []
  const optional: QuoteLineView[] = []
  const excluded: QuoteLineView[] = []
  let baseCents = 0
  for (const row of ordered) {
    if (row.is_excluded) excluded.push(lineView(row))
    else if (row.is_optional) optional.push(lineView(row))
    else {
      lines.push(lineView(row))
      baseCents += cents(lineAmount(row))
    }
  }

  return {
    lines,
    optional,
    excluded,
    baseTotal: baseCents / 100,
    money: quoteMoney({ ...terms, items }),
    canSend: lines.length > 0
  }
}

/**
 * What the Quote tab capsule prints: the total, and under it the deposit
 * due at approval, "No deposit", or "Payment follows the terms" when the
 * terms name no deposit.
 */
export function quoteCapsule(money: QuoteMoney): { amount: string; note: string } {
  const amount = moneyCents(money.total)
  if (money.deposit.kind === 'none') return { amount, note: 'No deposit' }
  if (money.deposit.kind === 'per_terms') return { amount, note: 'Payment follows the terms' }
  return { amount, note: `Deposit ${moneyCents(money.deposit.amount)} at approval` }
}

// Words that mark a company, so "Plumbing Bellevue" or "MMC Properties"
// is never cut down to its first word.
const BUSINESS_WORDS = new Set([
  'properties', 'property', 'construction', 'company', 'co', 'llc', 'inc', 'corp', 'group', 'homes',
  'home', 'builders', 'building', 'plumbing', 'electric', 'electrical', 'roofing', 'concrete', 'paving',
  'landscaping', 'hoa', 'church', 'school', 'trust', 'family', 'partners', 'holdings', 'realty',
  'management', 'services', 'supply', 'hardware', 'bank', 'county', 'city', 'association', 'associates',
  'enterprises', 'industries', 'development', 'developments', 'design', 'restaurant', 'hotel'
])
const NAME_WORD = /^[A-Z][a-z]*(?:[A-Z][a-z]+)?(?:['’-][A-Z]?[a-z]+)*$/

/**
 * What to call the customer: the first name of a person, the whole name of
 * a company, and "customer" when there is no name or it is too long to fit.
 */
export function previewAsName(clientName: string | null | undefined): string {
  const name = String(clientName ?? '').trim().replace(/\s+/g, ' ')
  if (!name) return 'customer'
  const words = name.split(' ')
  const personLike = words.length <= 3
    && words.every((w) => NAME_WORD.test(w) && !BUSINESS_WORDS.has(w.toLowerCase()))
  if (personLike) return words[0]
  return name.length <= 22 ? name : 'customer'
}

/** "Preview as Taylor", "Preview as MMC Properties" or "Preview as customer". */
export function previewAsLabel(clientName: string | null | undefined): string {
  return `Preview as ${previewAsName(clientName)}`
}
