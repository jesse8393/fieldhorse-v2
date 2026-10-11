// The customer portal (/p/:token) as a pure view model (spec 9.9, decisions
// D7, D12 and D13). PublicDoc.tsx used to hold the response of
// /api/public-link as `any`; PublicDocPayload below names the fields the
// page actually reads, and buildPortalView turns a proposal payload into
// what the Fieldhorse proposal theme draws: who it is from, the headline,
// the total and deposit, the included and optional lines, the three steps,
// whether it is already approved, and where "Pay deposit" goes.
//
// Money is returned as plain numbers; the screen prints cents. Every
// sentence this module writes itself avoids dashes of any kind. Names,
// titles, addresses and notes that people typed pass through untouched.
//
// What the payload does not carry, and so what this does not claim:
// * The approver's name and date (D12). `approved` holds them only when
//   the payload has `contact.approved_by_name` and `contact.approved_at`
//   (the names change order rows already use), otherwise both are null.
// * A payment schedule. The deposit is the first step of the default
//   schedule, 50 percent (D8), the same split the draws are generated from.

import { DEFAULT_PAYMENT_SCHEDULE } from '../components/documents/PaymentTermsBlock.tsx'
import { initialsFor } from '../components/fh/Monogram.tsx'
import { moneyCents } from './format.ts'
import { safePayUrl } from './payLink.ts'
import { splitByPercents } from './paymentSchedule.ts'

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
  contact?: PublicDocContact | null
  company?: PublicDocCompany | null
  items?: PublicDocItem[] | null
  photos?: PublicDocPhoto[] | null
  payments?: Array<Record<string, unknown>> | null
  changeOrders?: PublicDocChangeOrder[] | null
  insurance?: Record<string, unknown> | null
  invoices?: Array<Record<string, unknown>> | null
  /** Statement links only. */
  client?: Record<string, unknown> | null
  jobs?: Array<Record<string, unknown>> | null
}

/* ---- The view ---- */

export type PortalLine = { title: string; amount: number }

export type PortalView = {
  firstName: string
  companyName: string
  initials: string
  logoUrl: string | null
  coverUrl: string | null
  trustLine: string | null
  headline: string
  addressLine: string
  total: number
  deposit: { pct: number; amount: number }
  included: PortalLine[]
  optional: PortalLine[]
  steps: string[]
  approved: { name: string | null; date: string | null } | null
  payUrl: string | null
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]

const FALLBACK_COMPANY = 'Your contractor'

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function toCents(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? Math.round(n * 100) : 0
}

function itemAmount(item: PublicDocItem): number {
  const raw = item.amount != null ? Number(item.amount) : Number(item.qty ?? 1) * Number(item.rate ?? 0)
  return Number.isFinite(raw) ? raw : 0
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

/** The first word of a company name: "Parker Construction" gives "Parker". */
export function companyFirstWord(companyName: string): string {
  const first = companyName.trim().split(/\s+/)[0]
  return first || FALLBACK_COMPANY
}

// "October 9" in the current year, "December 30, 2025" in any other.
function approvalDate(iso: unknown, now: Date): string | null {
  const raw = text(iso)
  if (!raw) return null
  const d = new Date(raw)
  if (Number.isNaN(d.getTime())) return null
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`
}

function trustLineFor(company: PublicDocCompany): string | null {
  const insured = text(company.insured_text)
  const license = text(company.license_number)
  if (insured && license) return `${insured}, license ${license}`
  if (insured) return insured
  if (license) return `License ${license}`
  return null
}

/** The sentence under the total: what to pay now and when the rest is due. */
export function depositSentence(deposit: { pct: number; amount: number }): string {
  if (!(deposit.amount > 0)) return ''
  return `Pay ${moneyCents(deposit.amount)} now to reserve your start date. The balance is due after the walkthrough.`
}

export function buildPortalView(payload: PublicDocPayload, now: Date): PortalView {
  const contact = payload.contact || {}
  const company = payload.company || {}
  const companyName = text(company.name) || FALLBACK_COMPANY
  const firstName = text(contact.name).split(/\s+/)[0] || ''

  // Priced lines in the order the quote editor shows them. Optional items
  // are read only and stay out of the total; excluded items are the
  // "not included" list, not a price.
  const items = (payload.items || [])
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const sa = a.item.sort_order, sb = b.item.sort_order
      if (sa != null && sb != null && sa !== sb) return sa - sb
      return a.index - b.index
    })
    .map((entry) => entry.item)

  const included: PortalLine[] = []
  const optional: PortalLine[] = []
  for (const item of items) {
    if (item.is_excluded) continue
    const line = { title: itemTitle(item), amount: itemAmount(item) }
    if (item.is_optional) optional.push(line)
    else included.push(line)
  }

  // Approved change orders are part of the contract total, so they show as
  // lines too and the rows always add up to the total.
  for (const co of payload.changeOrders || []) {
    if (String(co?.status || '').toLowerCase() !== 'approved') continue
    const label = co.sequence_number != null ? `Change order ${co.sequence_number}` : 'Change order'
    const title = text(co.title)
    included.push({ title: title ? `${label}, ${title}` : label, amount: Number(co.amount) || 0 })
  }

  const totalCents = included.length > 0
    ? included.reduce((sum, line) => sum + toCents(line.amount), 0)
    : toCents(contact.amount)
  const total = totalCents / 100

  const schedule = DEFAULT_PAYMENT_SCHEDULE
  const deposit = {
    pct: Number(schedule[0]?.pct || 0),
    amount: splitByPercents(total, schedule.map((row) => row.pct))[0] || 0
  }

  const firstWord = companyFirstWord(text(company.name))
  const steps = [
    'You approve and pay the deposit.',
    `${firstWord} sends you a start date.`,
    'You pay the balance after the walkthrough.'
  ]

  const jobTitle = text(contact.job_title)
  const address = text(contact.address)
  const addressLine = endSentence(
    jobTitle && address ? `${jobTitle} at ${address}` : jobTitle || address
  )

  const isApproved = text(contact.proposal_status).toLowerCase() === 'approved'
  const approved = isApproved
    ? { name: text(contact.approved_by_name) || null, date: approvalDate(contact.approved_at, now) }
    : null

  const cover = (payload.photos || []).find((p) => text(p?.url))

  return {
    firstName,
    companyName,
    initials: initialsFor(companyName),
    logoUrl: text(company.logo_url) || null,
    coverUrl: cover ? text(cover.url) : null,
    trustLine: trustLineFor(company),
    headline: `Hi ${firstName || 'there'}, your quote is ready.`,
    addressLine,
    total,
    deposit,
    included,
    optional,
    steps,
    approved,
    payUrl: safePayUrl(company.payment_link) || null
  }
}
