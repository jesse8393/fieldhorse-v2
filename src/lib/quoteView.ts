// The quote editor on a phone (spec 9.6, decision D8), as a pure view model.
//
// Lines come from the job's fh_quote_items rows. Base lines make up the
// quoted price, optional lines are shown beside it and never counted,
// excluded lines are out of scope and never counted either. There is no
// overhead line (the app has no overhead concept): the deposit is the
// first step of the payment schedule, 50 percent by default
// (DEFAULT_PAYMENT_SCHEDULE), split the same way the proposal's payment
// terms and the generated draws split it.
//
// Every line this module writes itself avoids dashes of any kind. Titles
// and notes that people typed pass through untouched. Money prints cents.

import { DEFAULT_PAYMENT_SCHEDULE } from '../components/documents/PaymentTermsBlock.tsx'
import { splitByPercents } from './paymentSchedule.ts'
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

/** One step of a payment schedule; only the percent matters here. */
export type ScheduleStep = { pct: number | string | null | undefined }

export type QuoteView = {
  lines: QuoteLineView[]
  optional: QuoteLineView[]
  excluded: QuoteLineView[]
  baseTotal: number
  deposit: { pct: number; amount: number }
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
    amount: cents(row.amount) / 100
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
 * Lines, optional and excluded lists, the base total and the deposit.
 * `schedule` defaults to the standard payment schedule; pass the quote's
 * own steps (see depositScheduleFromTerms) to follow what it says.
 */
export function buildQuoteView(
  items: QuoteItemRow[],
  schedule: ScheduleStep[] = DEFAULT_PAYMENT_SCHEDULE
): QuoteView {
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
      baseCents += cents(row.amount)
    }
  }

  const baseTotal = baseCents / 100
  const steps = schedule.length > 0 ? schedule : DEFAULT_PAYMENT_SCHEDULE
  const pct = num(steps[0]?.pct)
  const amount = splitByPercents(baseTotal, steps.map((s) => s.pct))[0] ?? 0

  return { lines, optional, excluded, baseTotal, deposit: { pct, amount }, canSend: lines.length > 0 }
}

const DEPOSIT_BEFORE = /(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)\s*(?:deposit|down\s*payment|down\b)/i
const DEPOSIT_AFTER = /\b(?:deposit|down\s*payment)\s*(?:of|is|:)?\s*(\d{1,3}(?:\.\d+)?)\s*(?:%|percent)/i

/**
 * The deposit step the contractor wrote into the quote's payment terms
 * ("30% deposit on signing"), or null when the terms name none. A quote
 * stores no structured schedule, only this text, so this is how the
 * screen respects what the quote already says.
 */
export function depositScheduleFromTerms(terms: string | null | undefined): ScheduleStep[] | null {
  const text = String(terms ?? '')
  const hit = DEPOSIT_BEFORE.exec(text) ?? DEPOSIT_AFTER.exec(text)
  if (!hit) return null
  const pct = Number(hit[1])
  if (!Number.isFinite(pct) || pct <= 0 || pct > 100) return null
  return [{ pct }]
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
