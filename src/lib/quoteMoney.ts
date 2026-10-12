// One quote total and one deposit for every place that prints them
// (decision D31): the Quote tab capsule on a phone (lib/quoteView.ts), the
// proposal render and its in app "Preview as" (ProposalTemplate.tsx and
// the Fieldhorse theme), and the customer page (lib/portalView.ts). Before
// this, each place had its own rule, so one quote could show three
// different deposits.
//
// Total: the base lines (not optional, not excluded) plus approved change
// orders. When no line has a price, the job's own contact.amount stands
// in for the lines; that is the amount a quote typed before line items
// existed carries, and the database keeps it equal to the base lines once
// a quote has any line (migration 011), so an optional only quote is $0.00.
//
// Deposit: read from the quote's payment terms, the only place a quote
// says how it is paid.
// * Empty terms: the first step of the default schedule (50 percent).
// * "No deposit" or "0%": none.
// * "$2,500 deposit" or "deposit of $2,500": that amount, never more than
//   the total.
// * "30% deposit", "deposit of 30%" or a "down payment" written the same
//   ways: that percent of the total.
// * Terms that name no deposit ("50% down at rough in" is a progress
//   payment, not a deposit): per_terms, and the page says payment follows
//   the terms.
//
// Every sentence this module writes avoids dashes of any kind.

import { DEFAULT_PAYMENT_SCHEDULE } from '../components/documents/PaymentTermsBlock.tsx'
import { splitByPercents } from './paymentSchedule.ts'

/** The fields of a quote line this reads (fh_quote_items, or a payload item). */
export type MoneyItem = {
  amount?: number | string | null
  qty?: number | string | null
  rate?: number | string | null
  is_optional?: boolean | null
  is_excluded?: boolean | null
}

export type MoneyChangeOrder = {
  amount?: number | string | null
  status?: string | null
}

export type DepositKind = 'percent' | 'amount' | 'none' | 'per_terms'

/**
 * percent: `pct` of the total. amount: a fixed sum the terms name (`pct`
 * is null). none: the terms say there is no deposit (`pct` is 0).
 * per_terms: the terms name no deposit (`pct` is null). `amount` is what
 * is due at approval, in dollars, and is 0 for none and per_terms.
 */
export type QuoteDeposit = { kind: DepositKind; pct: number | null; amount: number }

export type QuoteMoney = {
  total: number
  deposit: QuoteDeposit
  /** "What happens next", three short sentences for the customer. */
  steps: string[]
}

export type QuoteMoneyInput = {
  items?: MoneyItem[] | null
  changeOrders?: MoneyChangeOrder[] | null
  contactAmount?: number | string | null
  termsText?: string | null
  /** The company name, for the second step ("Parker sends you a start date."). */
  companyName?: string | null
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

function toCents(value: unknown): number {
  return Math.round(num(value) * 100)
}

/** A line's price: its amount, else quantity times rate. */
export function lineAmount(item: MoneyItem): number {
  const raw = item.amount != null && item.amount !== ''
    ? num(item.amount)
    : num(item.qty ?? 1) * num(item.rate ?? 0)
  return Number.isFinite(raw) ? raw : 0
}

/** "Parker Construction" gives "Parker"; no name gives "Your contractor". */
export function companyFirstWord(companyName: string | null | undefined): string {
  return String(companyName ?? '').trim().split(/\s+/)[0] || 'Your contractor'
}

/* ---- Reading the deposit from the payment terms ---- */

type DepositTerm =
  | { kind: 'default' }
  | { kind: 'percent'; pct: number }
  | { kind: 'amount'; cents: number }
  | { kind: 'none' }
  | { kind: 'per_terms' }

const WORD = String.raw`(?:deposit|down\s*payment)`
const PCT = String.raw`(?<![\d.,])(\d{1,3}(?:\.\d+)?)\s*(?:%|percent\b)`
const DOLLARS = String.raw`\$\s*(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d{1,2}))?`
const LINK = String.raw`\s*(?:of|is|:|=)?\s*`

// "30% deposit", "deposit of 30%", "$2,500 deposit", "deposit of $2,500".
// A bare "down" ("50% down at rough in") is a progress payment, not a
// deposit, so it is not read as one.
const PCT_BEFORE = new RegExp(`${PCT}\\s*${WORD}`, 'i')
const PCT_AFTER = new RegExp(`\\b${WORD}${LINK}${PCT}`, 'i')
const AMT_BEFORE = new RegExp(`${DOLLARS}\\s*${WORD}`, 'i')
const AMT_AFTER = new RegExp(`\\b${WORD}${LINK}${DOLLARS}`, 'i')
const NO_DEPOSIT = /\bno\s+deposit\b|\bdeposit\s*(?:is\s*|:\s*)?(?:none|waived|not\s+required)\b|\bwithout\s+(?:a\s+)?deposit\b/i

function readDeposit(termsText: string | null | undefined): DepositTerm {
  const text = String(termsText ?? '').trim()
  if (!text) return { kind: 'default' }

  // The first deposit the terms name wins.
  const hits: Array<{ index: number; term: DepositTerm | null }> = []
  for (const re of [PCT_BEFORE, PCT_AFTER]) {
    const m = re.exec(text)
    if (!m) continue
    const pct = Number(m[1])
    const term: DepositTerm | null = pct === 0 ? { kind: 'none' }
      : Number.isFinite(pct) && pct > 0 && pct <= 100 ? { kind: 'percent', pct }
      : null
    hits.push({ index: m.index, term })
  }
  for (const re of [AMT_BEFORE, AMT_AFTER]) {
    const m = re.exec(text)
    if (!m) continue
    const cents = Number(m[1].replace(/,/g, '')) * 100 + Number((m[2] || '').padEnd(2, '0') || 0)
    hits.push({ index: m.index, term: cents === 0 ? { kind: 'none' } : { kind: 'amount', cents } })
  }
  const first = hits.filter((h) => h.term).sort((a, b) => a.index - b.index)[0]
  if (first?.term) return first.term

  if (NO_DEPOSIT.test(text)) return { kind: 'none' }
  return { kind: 'per_terms' }
}

/* ---- The money ---- */

const WALKTHROUGH = /\bwalk[\s-]*through\b/i

function stepsFor(deposit: QuoteDeposit, term: DepositTerm, termsText: string, companyName: string | null | undefined): string[] {
  const start = `${companyFirstWord(companyName)} sends you a start date.`
  const due = (deposit.kind === 'percent' || deposit.kind === 'amount') && deposit.amount > 0
  if (!due) return ['You approve the quote.', start, 'You pay as the payment terms say.']

  let rest = 'You pay the balance as the payment terms say.'
  if (WALKTHROUGH.test(termsText)) rest = 'You pay the balance after the walkthrough.'
  else if (term.kind === 'default') {
    // The default schedule after its deposit: 40% at material delivery or
    // midpoint, 10% at substantial completion (PaymentTermsBlock.tsx).
    const [, second, third] = DEFAULT_PAYMENT_SCHEDULE
    rest = `You pay ${second.pct}% at material delivery and ${third.pct}% at completion.`
  }
  return ['You approve and pay the deposit.', start, rest]
}

export function quoteMoney({ items, changeOrders, contactAmount, termsText, companyName }: QuoteMoneyInput): QuoteMoney {
  let baseCents = 0
  let priced = false
  for (const item of items || []) {
    if (!item || item.is_excluded) continue
    const cents = toCents(lineAmount(item))
    if (cents !== 0) priced = true
    if (!item.is_optional) baseCents += cents
  }
  const changeCents = (changeOrders || [])
    .filter((co) => String(co?.status || '').toLowerCase() === 'approved')
    .reduce((sum, co) => sum + toCents(co.amount), 0)
  const totalCents = Math.max(0, (priced ? baseCents : toCents(contactAmount)) + changeCents)
  const total = totalCents / 100

  const term = readDeposit(termsText)
  let deposit: QuoteDeposit
  if (term.kind === 'default' || term.kind === 'percent') {
    const pct = term.kind === 'percent' ? term.pct : Number(DEFAULT_PAYMENT_SCHEDULE[0].pct)
    // The same cents split the payment terms and the generated draws use.
    deposit = { kind: 'percent', pct, amount: splitByPercents(total, [pct, 100 - pct])[0] ?? 0 }
  } else if (term.kind === 'amount') {
    deposit = { kind: 'amount', pct: null, amount: Math.min(term.cents, totalCents) / 100 }
  } else if (term.kind === 'none') {
    deposit = { kind: 'none', pct: 0, amount: 0 }
  } else {
    deposit = { kind: 'per_terms', pct: null, amount: 0 }
  }

  return { total, deposit, steps: stepsFor(deposit, term, String(termsText ?? ''), companyName) }
}
