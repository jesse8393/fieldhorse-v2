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
  'enterprises', 'industries', 'development', 'developments', 'design', 'restaurant', 'hotel',
  'contracting', 'contractor', 'contractors', 'remodeling', 'renovations', 'painting', 'hvac', 'heating',
  'cooling', 'solutions', 'global', 'ventures', 'capital', 'investments', 'ltd', 'llp', 'pllc',
  // A household or a family business: "Johnson Residence", "Lowe Bros".
  'residence', 'household', 'bros', 'brothers',
  // Names joined into a firm: "Smith and Sons", "Hill & Dale".
  'and', '&'
])
// A word of a person's name: a capital and lower case letters in any
// alphabet ("José", "Zoë"), with "McDonald", "O'Neil" and "Jean-Luc" allowed.
const NAME_WORD = /^\p{Lu}\p{Ll}*(?:\p{Lu}\p{Ll}+)?(?:['’-]\p{Lu}?\p{Ll}+)*$/u
// A middle initial or initials: "Q", "Q.", "J.R.".
const INITIALS = /^(?:\p{Lu}|(?:\p{Lu}\.)+)$/u
// The small words inside a family name ("Maria de los Santos", "Jan van der
// Berg", "José Ortega y Gasset"). They never start a name, and they are not
// counted as words of it. As a first word, "Al" or "Van" is a first name.
const PARTICLES = new Set([
  'de', 'del', 'della', 'der', 'den', 'di', 'da', 'das', 'do', 'dos', 'du', 'la', 'le', 'lo', 'los', 'las',
  'van', 'von', 'ter', 'ten', 'bin', 'ibn', 'ben', 'al', 'el', 'y', 'zu'
])
// A family name joined to its particle: "al-Rashid", "el-Amin", "d'Arcy".
const JOINED_PARTICLE = /^(?:al|el|d)['’-]\p{Lu}\p{Ll}+$/u
// "The Roof Doctor", "A Cut Above Lawn": a name that starts with an article
// is a company, and the article is not part of what to call it. "A" and
// "An" count only before two or more words, so "An Nguyen" stays a person.
const LEADING_ARTICLE = /^(?:the\s+|an?\s+(?=\S+\s+\S))/i
// "Castellanos, Marco" or "O'Neil, Jeff A.": the last name, then the given names.
const LAST_FIRST = /^([^,]+),\s*(.+)$/
// "Marco Castellanos Jr." or "Smith, John, Jr.": the suffix says nothing
// about what to call them.
const SUFFIX = /,?\s+(?:jr|sr|ii|iii|iv)\.?$/i
// "Dr. Marco Castellanos", "Mrs. Smith": neither does a title.
const TITLE = /^(?:mr|mrs|ms|mx|miss|dr|prof|rev|fr)\.?\s+/i

function tidyName(name: string | null | undefined): string {
  return String(name ?? '').trim().replace(/\s+/g, ' ')
}

// Typed in capitals, a first word of two letters, of three letters without
// a vowel in the middle, or with no vowel at all reads as an acronym ("JB",
// "IBM", "ACE", "XYZ"). "BOB", "IAN" and "MARCO" read as names. Vowels are
// only known for the Latin alphabet, so other words fall back to length.
function acronymLike(word: string): boolean {
  const letters = word.normalize('NFD').replace(/[^\p{L}]/gu, '').toUpperCase()
  if (letters.length <= 2) return true
  if (!/^[A-Z]+$/.test(letters)) return false
  if (!/[AEIOUY]/.test(letters)) return true
  return letters.length === 3 && !/[AEIOU]/.test(letters[1])
}

// One word of a name saved without its capitals, capitalized as the person
// would write it ("castellanos" or "CASTELLANOS" to "Castellanos", "o'neil"
// to "O'Neil"). A word typed with capitals and lower case letters of its
// own ("DeShawn", "LaToya", "McKenzie") is kept exactly as typed.
function recaseWord(word: string): string {
  if (/\p{Lu}/u.test(word) && /\p{Ll}/u.test(word)) return word
  return word.toLowerCase().replace(/(^|['’-])(\p{L})/gu, (_, before: string, letter: string) => before + letter.toUpperCase())
}

// A name typed without its capitals: in capitals ("MARCO CASTELLANOS"), in
// sentence case as a phone keyboard types it ("Marco castellanos"), or in
// lower case ("marco castellanos"). Read it with each word in all lower
// case or all capitals capitalized (recaseWord), as the person would have
// written it; whether it is a company is decided after, by the same rules
// as any name ("Sunrise roofing" still is one). When the first word's case
// says nothing (all capitals or all lower case), one like an acronym ("IBM
// GLOBAL", "jm eagle") makes it a company's, so null. A single word is left
// alone: "IBM" and "marco" read as companies.
function recase(name: string): string | null {
  if (!name.includes(' ')) return name
  const [first, ...rest] = name.split(' ')
  const inCapitals = /\p{Lu}/u.test(name) && !/\p{Ll}/u.test(name)
  const restLower = rest.every((w) => !/\p{Lu}/u.test(w))
  if (!inCapitals && !restLower) return name
  if (!NAME_WORD.test(first) && acronymLike(first)) return null
  return name.split(' ').map(recaseWord).join(' ')
}

const isParticle = (w: string) => PARTICLES.has(w.toLowerCase())
const isNameWord = (w: string) => NAME_WORD.test(w) && !BUSINESS_WORDS.has(w.toLowerCase())

// A word a person is called by: a name word, not an initial.
function isGivenName(w: string): boolean {
  return isNameWord(w) && !INITIALS.test(w)
}

// The words after a first name, or a family name before a comma: each a
// name word, an initial or a particle.
function restOfName(words: string[]): boolean {
  return words.every((w) => isNameWord(w) || JOINED_PARTICLE.test(w) || INITIALS.test(w) || isParticle(w))
}

// How many words of the name count toward telling a person from a
// company: not the particles, not the initials.
function nameWordCount(words: string[]): number {
  return words.filter((w) => !isParticle(w) && !INITIALS.test(w)).length
}

// A first name has at least two letters; an initial is not one to greet by.
function firstNameOf(word: string): string | null {
  return word.length >= 2 && !INITIALS.test(word) ? word : null
}

// The first name (see personFirstName), and whether reading it took
// recasing a name saved without its capitals (see recase).
function readName(name: string | null | undefined): { first: string | null; recased: boolean } {
  let clean = tidyName(name)
  const titled = TITLE.test(clean)
  clean = clean.replace(TITLE, '')
  const suffixed = SUFFIX.test(clean)
  clean = clean.replace(SUFFIX, '')
  const cased = recase(clean)
  const recased = cased !== null && cased !== clean
  const read = (first: string | null) => ({ first, recased })
  if (!cased || LEADING_ARTICLE.test(cased)) return read(null)
  const lastFirst = LAST_FIRST.exec(cased)
  if (lastFirst) {
    const last = lastFirst[1].trim().split(' ')
    const given = lastFirst[2].trim().split(' ')
    if (!restOfName(last) || nameWordCount(last) === 0 || !isGivenName(given[0])) return read(null)
    if (nameWordCount(last) + nameWordCount(given) > 4) return read(null)
    return read(firstNameOf(given[0]))
  }
  const words = cased.split(' ')
  // A lone word after a title or before a suffix is a last name.
  if (words.length === 1 && (titled || suffixed)) return read(null)
  if (!isGivenName(words[0]) || !restOfName(words.slice(1)) || nameWordCount(words) > 3) return read(null)
  return read(firstNameOf(words[0]))
}

/**
 * The first name when the name reads as a person's ("Marco Castellanos",
 * "Castellanos, Marco", "José García", "MARCO CASTELLANOS", "Marco
 * castellanos", "DeShawn jones", "Marco Castellanos Jr.", "John Q. Public",
 * "Maria de los Santos", "Dr. Marco Castellanos"), and null when it reads
 * as a company ("MMC Properties", "The Roof Doctor", "Acme, Inc", "IBM
 * GLOBAL", "Johnson Residence", "Smith and Sons"), when what is left is a
 * last name ("Mrs. Smith", "Smith, Jr.") or an initial ("J. Smith"), or
 * when it is missing.
 */
export function personFirstName(name: string | null | undefined): string | null {
  return readName(name).first
}

/**
 * What to call the customer in the app ("Preview as", "Optional for", "No
 * email on file for"): the first name of a person, the whole name of a
 * company without its leading article, and "customer" when there is no
 * name or it is too long to fit. A name read as a person's only by
 * recasing it ("Marco castellanos", but also "Elite pools") is a guess,
 * so it is kept whole, as it was saved.
 */
export function previewAsName(clientName: string | null | undefined): string {
  const name = tidyName(clientName)
  if (!name) return 'customer'
  const { first, recased } = readName(name)
  if (first && !recased) return first
  const whole = name.replace(LEADING_ARTICLE, '')
  return whole.length <= 22 ? whole : 'customer'
}

/** "Preview as Taylor", "Preview as MMC Properties" or "Preview as customer". */
export function previewAsLabel(clientName: string | null | undefined): string {
  return `Preview as ${previewAsName(clientName)}`
}
