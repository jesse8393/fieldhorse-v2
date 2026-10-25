// The customer portal (/p/:token) as a pure view model (spec 9.9, decisions
// D7, D12, D13 and D31). PublicDoc.tsx used to hold the response of
// /api/public-link as `any`; PublicDocPayload below names the fields the
// page actually reads, and buildPortalView turns a proposal payload into
// what the Fieldhorse proposal theme draws: who it is from, the headline,
// the quote number and dates, the total and deposit, the included and
// optional lines, the three steps, whether it is already approved, expired
// or closed, whether the job it was approved for is finished, what has
// been paid, and where "Pay deposit" goes.
//
// Money is returned as plain numbers; the screen prints cents. Every
// sentence this module writes itself avoids dashes of any kind. Names,
// titles, addresses and notes that people typed pass through untouched.
//
// What the payload does not carry, and so what this does not claim:
// * The approver's name and date (D12). `approved` holds them only when
//   the payload has `contact.approved_by_name` and `contact.approved_at`
//   (the names change order rows already use), otherwise both are null.
// * A payment schedule. The total, the deposit and the three steps come
//   from lib/quoteMoney.ts, which reads the deposit from the payment terms
//   (D31), so this page, the in app preview and the Quote tab capsule
//   print the same money.
// * A stored quote number. The number is the same one the letter themes
//   and the PDF print (components/documents/numbers.ts), built from the
//   company name, the job id and the issue date, so it is shown only when
//   the payload carries the job id.
// * When the photos were taken. The server sends them oldest first, so the
//   last one is the newest and is the cover; a payload that dates them
//   (`uploaded_at`) is read by date instead.

import { initialsFor } from '../components/fh/Monogram.tsx'
import { proposalNumber } from '../components/documents/numbers.ts'
import { quoteNumber as quoteRecordNumber } from './quotes.ts'
import { parseDateOnly } from './dates.ts'
import { moneyCents } from './format.ts'
import { safePayUrl } from './payLink.ts'
import { companyShortName, lineAmount, quoteMoney, stepsAfterApproval, type QuoteDeposit } from './quoteMoney.ts'
import { personFirstName } from './quoteView.ts'

/* ---- The /api/public-link payload, from the fields PublicDoc reads ---- */

export type PublicDocItem = {
  id?: string
  section?: string | null
  description?: string | null
  qty?: number | null
  unit?: string | null
  rate?: number | null
  amount?: number | null
  is_optional?: boolean | null
  is_excluded?: boolean | null
  sort_order?: number | null
}

export type PublicDocPhoto = {
  url?: string | null
  section_tag?: string | null
  caption?: string | null
  /** Not in the payload today; read when a later server adds it. */
  uploaded_at?: string | null
}

/** A payment the job has recorded (fh_payments, the public columns). */
export type PublicDocPayment = {
  id?: string
  amount?: number | string | null
  /** 'deposit', 'progress', 'final', 'retainage' or 'other'. */
  kind?: string | null
  paid_on?: string | null
}

export type PublicDocChangeOrder = {
  id?: string
  sequence_number?: number | null
  title?: string | null
  description?: string | null
  amount?: number | string | null
  status?: string | null
  approved_at?: string | null
  approved_by_name?: string | null
}

export type PublicDocContact = {
  id?: string
  name?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  job_title?: string | null
  job_type?: string | null
  stage?: string | null
  proposal_status?: string | null
  quote_change_request_note?: string | null
  quote_change_requested_at?: string | null
  quote_sent_at?: string | null
  quote_expires_at?: string | null
  created_at?: string | null
  terms_text?: string | null
  scope_text?: string | null
  exclusions_text?: string | null
  amount?: number | string | null
  /** Not in the payload today (D12). Read when a later server adds them. */
  approved_by_name?: string | null
  approved_at?: string | null
}

export type PublicDocCompany = {
  name?: string | null
  address?: string | null
  phone?: string | null
  email?: string | null
  website?: string | null
  logo_url?: string | null
  brand_accent_hex?: string | null
  estimate_template?: string | null
  license_number?: string | null
  insured_text?: string | null
  warranty_default?: string | null
  payment_link?: string | null
  payment_instructions?: string | null
}

export type PublicDocPayload = {
  ok?: boolean
  message?: string
  /** 'proposal', 'invoice', 'change_order' or 'statement'. */
  kind: string
  change_order_id?: string | null
  /** The fh_quotes row a proposal link points at (Task 11); null for a job's proposal. */
  quote_id?: string | null
  /**
   * The quote's own status (fh_quotes.status) when the link points at a
   * quote record. Read before contact.proposal_status (portalStatus).
   */
  status?: string | null
  contact?: PublicDocContact | null
  company?: PublicDocCompany | null
  items?: PublicDocItem[] | null
  photos?: PublicDocPhoto[] | null
  payments?: PublicDocPayment[] | null
  changeOrders?: PublicDocChangeOrder[] | null
  insurance?: Record<string, unknown> | null
  invoices?: Array<Record<string, unknown>> | null
  /** Statement links only. */
  client?: Record<string, unknown> | null
  jobs?: Array<Record<string, unknown>> | null
}

/* ---- The view ---- */

export type PortalLine = { title: string; amount: number }

/** What the job has collected so far, against the deposit the terms name. */
export type PortalPaid = {
  /** Every payment on the job, in dollars. */
  total: number
  /** What is still owed of the deposit; 0 when it is in or there is none. */
  depositRemaining: number
  /** The deposit is in: deposit payments, or all payments, reach it. */
  depositReceived: boolean
}

export type PortalView = {
  /** The customer's first name, or '' for a company or no name. */
  firstName: string
  companyName: string
  initials: string
  logoUrl: string | null
  coverUrl: string | null
  trustLine: string | null
  /**
   * "Hi Marco, your quote is ready." while it can be approved, "your quote
   * is approved." once it is, and "here is your quote." while it waits on
   * a revised proposal, after it expired and once it closed.
   */
  headline: string
  addressLine: string
  /** "HC-2026-RTAL", the number the letter themes and the PDF print; null without a quote or job id. */
  quoteNumber: string | null
  /** "October 2", or with the year when it is not this year; null when the payload has no date. */
  issuedOn: string | null
  /** The quote's valid until date, written the same way; null when none is set. */
  validUntil: string | null
  /**
   * The valid until date has passed, or the server marked the quote
   * expired, while the quote still awaited a decision. An approved quote
   * stays approved past its date, and one with changes requested is
   * waiting on the contractor, so neither is ever expired here.
   */
  expired: boolean
  /**
   * The contractor marked the quote lost, or closed the job, before the
   * customer approved it. The approve endpoint refuses it (409), and the
   * request changes endpoint too (410).
   */
  closed: boolean
  /**
   * The customer approved and the job is done: closeout moved its stage to
   * closed and left the quote approved. The page then promises no start
   * date and lists no next steps. An approved quote whose job was marked
   * lost is not finished; it reads as any approved quote does.
   */
  jobFinished: boolean
  /** Approval is still possible: not approved, not changes requested, not expired, not closed. */
  open: boolean
  /** The customer asked for changes and the quote waits on a revised proposal. */
  changesRequested: boolean
  /**
   * A question can still be sent: the quote is open, not declined, and its
   * job has not started. Mirrors public-link-request-changes, which answers
   * 410 otherwise, so "Ask about this" is never a dead button.
   */
  canAsk: boolean
  total: number
  deposit: QuoteDeposit
  paid: PortalPaid
  included: PortalLine[]
  optional: PortalLine[]
  /**
   * What happens next; none once the quote has expired or closed, since
   * approving is not a step, and none once the job is finished. While it
   * waits on a revised proposal, that proposal comes first and the open
   * quote's steps follow it. Once approved, the approve step goes, and a
   * deposit still owed comes first.
   */
  steps: string[]
  approved: { name: string | null; date: string | null } | null
  payUrl: string | null
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const FALLBACK_COMPANY = 'Your contractor'

// Job stages the approve endpoint refuses (public-link-approve.js,
// CLOSED_STAGES), and the ones where the request changes endpoint refuses
// a question as well (public-link-request-changes.js).
const CLOSED_STAGES = new Set(['lost', 'closed'])
const NO_QUESTION_STAGES = new Set(['job', 'invoice', 'closed', 'lost'])

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Where the quote stands, lower case: the payload's own status when the
 * link points at a quote record, else the contact block's proposal_status,
 * else ''. Every read of the status on the customer page goes through here.
 */
export function portalStatus(payload: Pick<PublicDocPayload, 'status' | 'contact'>): string {
  return (text(payload.status) || text(payload.contact?.proposal_status)).toLowerCase()
}

// A line's words: the description without the "OPTION:" prefix the quote
// editor used to type, else the section it sits in.
function itemTitle(item: PublicDocItem): string {
  const description = text(item.description).replace(/^OPTION\s*[:–-]\s*/i, '').trim()
  return description || text(item.section) || 'Item'
}

function endSentence(s: string): string {
  const t = s.trim()
  if (!t) return ''
  return /[.!?]$/.test(t) ? t : `${t}.`
}

// "October 9" in the current year, "December 30, 2025" in any other. A
// bare date is read as that calendar day, not as midnight UTC.
function pageDate(iso: unknown, now: Date): string | null {
  const d = parseDateOnly(text(iso) || null)
  if (!d) return null
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`
}

// When a quote stops being approvable: the end of the day the page says it
// is valid until, in the viewer's time. The app stores quote_expires_at as
// the end of the chosen day in the contractor's zone; a viewer elsewhere
// reads that instant as a date (pageDate), and the quote is good through
// the whole of that date, so "Valid until" and the moment it flips never
// disagree. A bare date is good through that day too. This is never later
// than the server allows, which is a full day past the stored instant.
function expiryInstant(iso: unknown): number | null {
  const d = parseDateOnly(text(iso) || null)
  if (!d) return null
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), 23, 59, 59, 999).getTime()
}

function cents(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

// What the job has collected, against the deposit. Deposit payments, or
// all payments together, reaching the deposit amount mean it is in.
function paidFor(payments: PublicDocPayment[] | null | undefined, deposit: QuoteDeposit): PortalPaid {
  let allCents = 0
  let depositCents = 0
  for (const p of payments || []) {
    const c = cents(p?.amount)
    allCents += c
    if (String(p?.kind || '').toLowerCase() === 'deposit') depositCents += c
  }
  const dueCents = (deposit.kind === 'percent' || deposit.kind === 'amount') ? cents(deposit.amount) : 0
  const received = dueCents > 0 && (depositCents >= dueCents || allCents >= dueCents)
  return {
    total: allCents / 100,
    depositRemaining: received ? 0 : Math.max(0, dueCents - allCents) / 100,
    depositReceived: received
  }
}

// The newest photo with a url: by uploaded_at when the payload dates the
// photos, else the last one, since the server sends them oldest first.
function coverPhoto(photos: PublicDocPhoto[] | null | undefined): PublicDocPhoto | null {
  const withUrl = (photos || []).filter((p) => text(p?.url))
  if (withUrl.length === 0) return null
  const dated = withUrl.filter((p) => Number.isFinite(Date.parse(text(p.uploaded_at))))
  if (dated.length === withUrl.length) {
    return dated.reduce((best, p) => Date.parse(text(p.uploaded_at)) > Date.parse(text(best.uploaded_at)) ? p : best)
  }
  return withUrl[withUrl.length - 1]
}

function trustLineFor(company: PublicDocCompany): string | null {
  const insured = text(company.insured_text)
  const license = text(company.license_number)
  if (insured && license) return `${insured}, license ${license}`
  if (insured) return insured
  if (license) return `License ${license}`
  return null
}

/**
 * The sentence under the total: the deposit to pay now, a plain "no
 * deposit", or that payment follows the terms when they name no deposit.
 * When and how the rest is paid is in the steps and the terms, never a
 * fixed line here.
 */
export function depositSentence(deposit: QuoteDeposit): string {
  if (deposit.kind === 'none') return 'No deposit is due. Payment follows the terms below.'
  if (deposit.kind === 'per_terms') return 'Payment follows the terms below.'
  if (!(deposit.amount > 0)) return ''
  return `Pay ${moneyCents(deposit.amount)} now to reserve your start date.`
}

/**
 * The sentence under the total once payments and the expiry are known:
 * nothing on an expired or closed quote or once the job is finished, that
 * nothing is due while the customer waits on a revised proposal, the
 * deposit received, what is still owed of it after a partial payment, else
 * the plain deposit sentence.
 */
export function depositNote(pv: PortalView): string {
  if (pv.expired || pv.closed || pv.jobFinished) return ''
  if (pv.changesRequested) return 'Nothing is due while you wait for a revised proposal.'
  const due = (pv.deposit.kind === 'percent' || pv.deposit.kind === 'amount') && pv.deposit.amount > 0
  if (due && pv.paid.depositReceived) return `Deposit of ${moneyCents(pv.deposit.amount)} received.`
  if (due && pv.paid.total > 0 && pv.paid.depositRemaining > 0) {
    return `${moneyCents(pv.paid.total)} paid so far. Pay the remaining ${moneyCents(pv.paid.depositRemaining)} to reserve your start date.`
  }
  return depositSentence(pv.deposit)
}

/** What the Approved capsule says and offers. */
export type ApprovalNote = {
  /** Who approved and when, as far as the payload says (D12), else "Thank you." */
  title: string
  /** The sentence under it. */
  text: string
  /** The deposit is in, so a Deposit received chip sits beside Approved. */
  depositReceived: boolean
  /** What the company payment link reads, or null when no button shows. */
  payLabel: string | null
}

/**
 * The Approved capsule, or null before approval. The payment link reads
 * "Pay deposit $X" while the deposit the terms name is due, "Pay remaining
 * deposit $X" after a partial payment, and "Make a payment" when the terms
 * name none (D31); once the deposit is received no button shows (D44).
 * Once the job is finished nothing is promised: the sentence is the
 * approval alone, and while the deposit is not in, the payment link reads
 * "Make a payment" with no amount where it asked for the deposit or what
 * is left of it. Once the deposit is received there is no button, as D44
 * has it, so closing out a paid job never starts asking for money; and on
 * terms that name no deposit, none once the payments reach the total,
 * since paying in full is what closes such a job (logPayment, stages.ts).
 */
export function approvalNote(pv: PortalView): ApprovalNote | null {
  if (!pv.approved) return null
  const { name, date } = pv.approved
  const due = (pv.deposit.kind === 'percent' || pv.deposit.kind === 'amount') && pv.deposit.amount > 0
  const received = due && pv.paid.depositReceived
  const partial = due && !received && pv.paid.total > 0 && pv.paid.depositRemaining > 0
  const title = name && date ? `Approved by ${name} on ${date}.`
    : name ? `Approved by ${name}.`
    : date ? `Approved on ${date}.`
    : 'Thank you.'
  if (pv.jobFinished) {
    const paidInFull = pv.total > 0 && cents(pv.paid.total) >= cents(pv.total)
    return {
      title,
      text: `${pv.companyName} has your approval.`,
      depositReceived: received,
      payLabel: pv.payUrl && !received && !paidInFull ? 'Make a payment' : null
    }
  }
  const text = received
    ? `${pv.companyName} has your approval and your ${moneyCents(pv.deposit.amount)} deposit, and will be in touch with your start date.`
    : partial
      ? `${pv.companyName} has your approval and ${moneyCents(pv.paid.total)} toward the deposit, and will be in touch with next steps.`
      : `${pv.companyName} has your approval and will be in touch with next steps.`
  const payLabel = !pv.payUrl || received ? null
    : !due ? 'Make a payment'
    : partial ? `Pay remaining deposit ${moneyCents(pv.paid.depositRemaining)}`
    : `Pay deposit ${moneyCents(pv.deposit.amount)}`
  return { title, text, depositReceived: received, payLabel }
}

// The lines in the order the quote editor shows them.
function orderedItems(items: PublicDocItem[] | null | undefined): PublicDocItem[] {
  return (items || [])
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const sa = a.item.sort_order, sb = b.item.sort_order
      if (sa != null && sb != null && sa !== sb) return sa - sb
      return a.index - b.index
    })
    .map((entry) => entry.item)
}

/**
 * What the customer reads and agrees to, as one string: the lines in the
 * order the page shows them (wording, quantity, price, optional or
 * excluded), the scope, the payment terms (and so the deposit), the
 * exclusions, the contract amount, what and where the work is, who it is
 * for (the name the authority line approves for), and the company's name,
 * warranty, license and insured line. The page shows each of these and
 * the approve endpoint records each in its snapshot. Left out: photos
 * (signed again on every read), payments and the status, which the
 * approval does not record; the valid until date, since whether the quote
 * is still open is checked on its own; and the company's address, phone,
 * email, website, logo and accent, which say who the contractor is, not
 * what is agreed. PublicDoc compares it just before an approval posts, so
 * a quote edited while the customer read it is shown again instead of
 * approved unseen.
 */
export function quoteFingerprint(payload: PublicDocPayload): string {
  const contact = payload.contact || {}
  const company = payload.company || {}
  const lines = orderedItems(payload.items).map((item) => [
    text(item.section),
    text(item.description),
    Number(item.qty) || 0,
    text(item.unit),
    cents(item.rate),
    cents(lineAmount(item)),
    Boolean(item.is_optional),
    Boolean(item.is_excluded)
  ])
  return JSON.stringify({
    lines,
    scope: text(contact.scope_text),
    terms: text(contact.terms_text),
    exclusions: text(contact.exclusions_text),
    amount: cents(contact.amount),
    job: text(contact.job_title),
    address: text(contact.address),
    customer: text(contact.name),
    company: text(company.name),
    warranty: text(company.warranty_default),
    license: text(company.license_number),
    insured: text(company.insured_text)
  })
}

export function buildPortalView(payload: PublicDocPayload, now: Date): PortalView {
  const contact = payload.contact || {}
  const company = payload.company || {}
  const companyName = text(company.name) || FALLBACK_COMPANY
  // A person is greeted by first name; a company gets "Hi there".
  const firstName = personFirstName(contact.name) || ''

  // Priced lines in the order the quote editor shows them. Optional items
  // are read only and stay out of the total; excluded items are the
  // "not included" list, not a price.
  const items = orderedItems(payload.items)

  const included: PortalLine[] = []
  const optional: PortalLine[] = []
  for (const item of items) {
    if (item.is_excluded) continue
    const line = { title: itemTitle(item), amount: lineAmount(item) }
    if (item.is_optional) optional.push(line)
    else included.push(line)
  }

  // Approved change orders are part of the contract total, so they show as
  // lines too and the rows add up to the total whenever a line is priced.
  for (const co of payload.changeOrders || []) {
    if (String(co?.status || '').toLowerCase() !== 'approved') continue
    const label = co.sequence_number != null ? `Change order ${co.sequence_number}` : 'Change order'
    const title = text(co.title)
    included.push({ title: title ? `${label}, ${title}` : label, amount: Number(co.amount) || 0 })
  }

  const { total, deposit, steps } = quoteMoney({
    items: payload.items,
    changeOrders: payload.changeOrders,
    contactAmount: contact.amount,
    termsText: contact.terms_text,
    companyName: company.name
  })

  const jobTitle = text(contact.job_title)
  const address = text(contact.address)
  const addressLine = endSentence(
    jobTitle && address ? `${jobTitle} at ${address}` : jobTitle || address
  )

  const status = portalStatus(payload)
  const isApproved = status === 'approved'
  const approved = isApproved
    ? { name: text(contact.approved_by_name) || null, date: pageDate(contact.approved_at, now) }
    : null

  // The same issue date and number the letter themes print (ProposalTemplate).
  // A quote record's number is seeded by the quote id (lib/quotes.ts); a
  // job's proposal keeps the job id as its seed.
  const issuedIso = text(contact.quote_sent_at) || text(contact.created_at) || null
  const quoteId = text(payload.quote_id)
  const contactId = text(contact.id)
  const quoteNumber = quoteId ? quoteRecordNumber(company.name, quoteId, issuedIso)
    : contactId ? proposalNumber(company.name, contactId, issuedIso)
    : null
  // Expiry applies only while the quote awaits the customer's decision: an
  // approved quote whose date passes is still approved (the customer has
  // committed), and one with changes requested is waiting on the
  // contractor. The Quote tab reads it the same way (quoteStatus.ts).
  const changesRequested = status === 'changes_requested'
  const decided = isApproved || changesRequested
  const expiresAt = expiryInstant(contact.quote_expires_at)
  const expired = !decided && (status === 'expired' || (expiresAt != null && expiresAt < now.getTime()))
  // What the endpoints still accept (see CLOSED_STAGES above): a lost or
  // closed job takes no approval, and a declined quote or a started job
  // takes no question, though the approve endpoint still accepts those.
  const stage = text(contact.stage).toLowerCase()
  const closed = !isApproved && CLOSED_STAGES.has(stage)
  // Closeout moves an approved job to closed and leaves the quote approved.
  // An approved quote whose job was marked lost is not a finished job; what
  // it should say is the owner's call, so it reads as any approved quote does.
  const jobFinished = isApproved && stage === 'closed'
  const open = !decided && !expired && !closed
  const canAsk = open && status !== 'rejected' && !NO_QUESTION_STAGES.has(stage)

  const paid = paidFor(payload.payments, deposit)
  const depositOwed = (deposit.kind === 'percent' || deposit.kind === 'amount') && deposit.amount > 0 && !paid.depositReceived
  const greeting = `Hi ${firstName || 'there'}`
  const headline = isApproved ? `${greeting}, your quote is approved.`
    : open ? `${greeting}, your quote is ready.`
    : `${greeting}, here is your quote.`

  const cover = coverPhoto(payload.photos)

  return {
    firstName,
    companyName,
    initials: initialsFor(companyName),
    logoUrl: text(company.logo_url) || null,
    coverUrl: cover ? text(cover.url) : null,
    trustLine: trustLineFor(company),
    headline,
    addressLine,
    quoteNumber,
    issuedOn: pageDate(issuedIso, now),
    validUntil: pageDate(contact.quote_expires_at, now),
    expired,
    closed,
    jobFinished,
    open,
    changesRequested,
    canAsk,
    total,
    deposit,
    paid,
    included,
    optional,
    // Approving is not a next step once the quote has expired or closed,
    // and nothing is next once the job is finished. A request waits on a
    // revised proposal first; after it come the open quote's own steps, so
    // the deposit and the balance stay named. Once approved, approving is
    // done, and a deposit still owed comes first.
    steps: expired || closed || jobFinished ? []
      : changesRequested ? [`${companyShortName(company.name)} sends you a revised proposal.`, ...steps]
      : isApproved ? stepsAfterApproval(steps, depositOwed)
      : steps,
    approved,
    payUrl: safePayUrl(company.payment_link) || null
  }
}
