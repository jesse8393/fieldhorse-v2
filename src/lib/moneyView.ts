// The Money screen on a phone (spec 9.7, decision D6), as a pure view model.
//
// A vault card with what came in this week, what falls due this week, the
// month so far and the margin; then four groups of rows: Overdue, Due soon,
// Waiting on approval and Paid (the last 10 days). Every number comes from
// what the screen already loads (the invoices bundle and the jobs list).
// What an invoice still asks for comes from the one allocator in
// invoiceSettlement.ts, and the groups and totals read every open invoice,
// not the display list capped at 500 (Phase 8, task 5).
//
// The week starts Sunday at 00:00 local time, as the desktop schedule does.
// Dates that are only a calendar day (paid_on, due_at) are read in local
// time, and a timestamp counts on its local calendar day, so a due date of
// 11 pm on the 7th is never "due on the 8th" for someone in Chicago.
//
// Every line this module writes itself (notes and chip labels) avoids
// dashes of any kind. Names and titles that people typed pass through
// untouched. Money is returned as plain numbers; the screen prints cents.

import type { InvoicesBundle, JobRow } from './queries.ts'
import { invoiceAmountDue } from './invoices.ts'
import { amountsDueByInvoice, isOpenInvoice, knownContractTotal, type DueInvoice } from './invoiceSettlement.ts'
import { avgMargin } from './rollups.ts'
import { parseDateOnly } from './dates.ts'
import { detailRoute } from './stages.ts'

export type MoneyChip = { label: string; tone: 'success' | 'info' | 'danger' | 'neutral' }

export type MoneyRow = {
  id: string
  /** The customer. */
  title: string
  /** The job, then what the invoice is for ("Concrete steps, final"). */
  subline: string
  amount: number
  /** The gray line under the amount: "Due Oct 15", "Sent yesterday". May be empty. */
  note: string
  chip: MoneyChip | null
  /** Where the row goes when it has no invoice to act on. */
  to: string
  /** The fh_invoices row a tap opens (its screen at /invoices/:id); null for quotes and payments. */
  invoiceId: string | null
  /** The invoice's job or client has an email, so a reminder can go out. */
  canRemind: boolean
}

export type MoneyView = {
  collectedThisWeek: number
  dueThisWeek: number
  monthToDate: number
  /** Average margin of won jobs that have a cost, as a percent; null when none do. */
  marginPct: number | null
  overdue: MoneyRow[]
  dueSoon: MoneyRow[]
  waiting: MoneyRow[]
  paid: MoneyRow[]
}

export type MoneyInvoiceStatus = 'draft' | 'sent' | 'overdue' | 'paid' | 'void'

/** One line of the full invoice list, with the status the screen filters on. */
export type MoneyInvoiceRow = MoneyRow & { status: MoneyInvoiceStatus }

type InvoiceJob = InvoicesBundle['jobs'][number]
type Invoice = InvoicesBundle['invoices'][number]
type Payment = InvoicesBundle['payments'][number]
type ChangeOrder = InvoicesBundle['changeOrders'][number]

const DAY_MS = 86400000
const DUE_SOON_DAYS = 7
const PAID_WINDOW_DAYS = 10
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function startOfDay(d: Date): Date {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** Whole calendar days from `from` to `to`, local time, DST safe. */
function dayDiff(from: Date, to: Date): number {
  return Math.round((startOfDay(to).getTime() - startOfDay(from).getTime()) / DAY_MS)
}

function cents(n: number): number {
  return Math.round(n * 100) / 100
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

function shortDate(d: Date, now: Date): string {
  const base = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === now.getFullYear() ? base : `${base}, ${d.getFullYear()}`
}

// The same wording the Jobs list uses: "just now", "3 hours ago",
// "yesterday", "4 days ago", then the date.
function ago(d: Date, now: Date): string {
  const ms = now.getTime() - d.getTime()
  if (ms < 3600000) return 'just now'
  if (ms < DAY_MS) return `${plural(Math.floor(ms / 3600000), 'hour', 'hours')} ago`
  const days = dayDiff(d, now)
  if (days <= 1) return 'yesterday'
  if (days < 7) return `${days} days ago`
  return shortDate(d, now)
}

function parseInstant(value: string | null | undefined): Date | null {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d
}

// "Final balance" reads "final balance" after a comma; a name like "ACME
// retainer" keeps its capitals.
function lowerFirst(text: string): string {
  return /^[A-Z][a-z]/.test(text) ? text[0].toLowerCase() + text.slice(1) : text
}

type Customer = { name?: string | null; email?: string | null } | null | undefined

function customerName(
  job: { name?: string | null; fh_clients?: { name?: string | null } | null } | null | undefined,
  client?: Customer
): string {
  return (job?.name || job?.fh_clients?.name || client?.name || '').trim() || 'Customer'
}

function hasEmail(
  job: { email?: string | null; fh_clients?: { email?: string | null } | null } | null | undefined,
  client?: Customer
): boolean {
  return (job?.email || job?.fh_clients?.email || client?.email || '').trim().length > 0
}

function titleOf(inv: Invoice): string {
  return (inv.title || '').trim() || `Invoice #${inv.sequence_number}`
}

function groupBy<T>(items: T[], key: (item: T) => string | null | undefined): Map<string, T[]> {
  const out = new Map<string, T[]>()
  for (const item of items) {
    const k = key(item)
    if (!k) continue
    const list = out.get(k)
    if (list) list.push(item)
    else out.set(k, [item])
  }
  return out
}

type Context = {
  now: Date
  today: Date
  jobs: Map<string, InvoiceJob>
  /** What each open invoice still owes (allocateInvoiceDue), by invoice id. */
  owed: Map<string, number>
}

/**
 * Every invoice the bundle knows, once each: the display list, every open
 * invoice and the paid and void ones the allocator reads. A bundle built
 * by hand without the uncapped lists falls back to the display list.
 */
export function knownInvoices(bundle: InvoicesBundle): DueInvoice[] {
  const byId = new Map<string, DueInvoice>()
  for (const list of [bundle.invoices, bundle.openInvoices ?? [], bundle.settledInvoices ?? []]) {
    for (const inv of list) if (inv?.id && !byId.has(inv.id)) byId.set(inv.id, inv)
  }
  return [...byId.values()]
}

/** Every open invoice (sent, viewed, overdue), uncapped when the bundle carries the full list. */
function openInvoicesOf(bundle: InvoicesBundle): Invoice[] {
  return bundle.openInvoices ?? bundle.invoices.filter(isOpenInvoice)
}

// The job's contract for the allocator's cap, or null when the job left the
// list or has no recorded amount (and no approved change order): then
// there is nothing to cap at and its bills ask for their face less payments.
function contractOf(job: InvoiceJob | undefined, changeOrders: ChangeOrder[]): number | null {
  return job ? knownContractTotal({ amount: job.amount, changeOrders }) : null
}

function contextFor(bundle: InvoicesBundle, now: Date): Context {
  const jobs = new Map(bundle.jobs.map((j) => [j.id, j]))
  const changeOrdersByJob = groupBy(bundle.changeOrders, (c) => c.contact_id)
  return {
    now,
    today: startOfDay(now),
    jobs,
    // A bill whose job left the list has no known contract, so no cap.
    owed: amountsDueByInvoice({
      invoices: knownInvoices(bundle),
      payments: bundle.payments,
      contractFor: (jobId) => contractOf(jobs.get(jobId), changeOrdersByJob.get(jobId) ?? [])
    })
  }
}

/** When an invoice counts as overdue, how late it is and what it asks for. */
export type InvoiceStanding = {
  status: MoneyInvoiceStatus
  /** Sent, viewed or overdue: a bill the customer has. */
  issued: boolean
  dueDay: Date | null
  /** Calendar days from today to the due day; negative once it has passed. */
  until: number | null
  /** Whole days since the due day ended; 0 until then. */
  daysLate: number
  /** What is still owed on an issued bill, else its own amount. */
  owed: number
}

/**
 * Money's rule for one invoice, which Today reads too, so both screens
 * agree on when a bill is overdue and for how much. An issued bill is
 * overdue once its due day has ended in local time (a bill due today is
 * due, not late), and it asks for `owed`, the allocator's figure from
 * amountsDueByInvoice. A draft, paid or void invoice keeps its own amount.
 */
export function classifyInvoice(
  inv: { status?: string | null; due_at?: string | null; amount?: number | string | null },
  owed: number | null | undefined,
  now: Date
): InvoiceStanding {
  const raw = String(inv.status || 'draft').toLowerCase()
  const issued = isOpenInvoice(inv)
  const due = parseDateOnly(inv.due_at ?? null)
  const dueDay = due ? startOfDay(due) : null
  const until = dueDay ? dayDiff(startOfDay(now), dueDay) : null
  const daysLate = until != null && until < 0 ? -until : 0

  let status: MoneyInvoiceStatus
  if (issued) status = daysLate >= 1 ? 'overdue' : 'sent'
  else if (raw === 'paid' || raw === 'void') status = raw
  else status = 'draft'

  const face = Number(inv.amount) || 0
  return { status, issued, dueDay, until, daysLate, owed: issued ? (owed ?? 0) : face }
}

type Classified = {
  row: MoneyInvoiceRow
  /** What is still owed on it (the allocator's figure), which can be zero. */
  owed: number
  dueDay: Date | null
  /** Calendar days from today to the due day; negative once it has passed. */
  until: number | null
  issued: boolean
}

function classify(inv: Invoice, ctx: Context): Classified {
  const { status, issued, dueDay, until, daysLate: late, owed } = classifyInvoice(inv, ctx.owed.get(inv.id), ctx.now)
  const job = inv.contact_id ? ctx.jobs.get(inv.contact_id) : undefined

  let chip: MoneyChip | null
  let note = ''
  switch (status) {
    case 'overdue':
      chip = { label: `${plural(late, 'day', 'days')} overdue`, tone: 'danger' }
      note = dueDay ? `Due ${shortDate(dueDay, ctx.now)}` : ''
      break
    case 'sent':
      chip = { label: 'Sent', tone: 'neutral' }
      note = dueDay ? (until === 0 ? 'Due today' : `Due ${shortDate(dueDay, ctx.now)}`) : ''
      break
    case 'paid':
      chip = { label: 'Paid', tone: 'success' }
      break
    case 'void':
      chip = { label: 'Void', tone: 'neutral' }
      break
    default:
      chip = { label: 'Draft', tone: 'neutral' }
      note = dueDay ? `Due ${shortDate(dueDay, ctx.now)}` : ''
  }

  // An invoice with no job bills its client directly (D62): the client
  // names the row, and the row goes to the invoice's own screen.
  const client = inv.fh_clients
  const title = titleOf(inv)
  const row: MoneyInvoiceRow = {
    id: inv.id,
    title: customerName(job, client),
    subline: job?.job_title ? `${job.job_title}, ${lowerFirst(title)}` : title,
    amount: owed,
    note,
    chip,
    to: job ? detailRoute(job, { financials: true }) : inv.contact_id ? `/jobs/${inv.contact_id}?tab=financials` : `/invoices/${inv.id}`,
    invoiceId: inv.id,
    canRemind: issued && hasEmail(job, client),
    status
  }
  return { row, owed, dueDay, until, issued }
}

function weekBounds(now: Date): { start: Date; end: Date } {
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
  // Next Sunday 00:00, so "by Saturday 23:59" is everything before it.
  const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7)
  return { start, end }
}

function paymentDay(p: Payment): Date | null {
  const d = parseDateOnly(p.paid_on) ?? parseDateOnly(p.created_at)
  return d ? startOfDay(d) : null
}

function paidRow(p: Payment, day: Date, ctx: Context, invoices: Map<string, Invoice>): MoneyRow {
  const job = p.contact_id ? ctx.jobs.get(p.contact_id) : undefined
  const invoice = p.invoice_id ? invoices.get(p.invoice_id) : undefined
  const kind = (p.kind || '').trim().toLowerCase()
  const what = invoice ? lowerFirst(titleOf(invoice)) : kind && kind !== 'other' ? kind : ''
  const jobTitle = (job?.job_title || '').trim()
  return {
    id: p.id,
    title: customerName(job),
    subline: jobTitle && what ? `${jobTitle}, ${what}` : jobTitle || what,
    amount: Number(p.amount) || 0,
    note: '',
    chip: { label: `Paid ${shortDate(day, ctx.now)}`, tone: 'success' },
    to: job ? detailRoute(job, { financials: true }) : `/jobs/${p.contact_id ?? ''}?tab=financials`,
    invoiceId: null,
    canRemind: false
  }
}

function waitingRows(quotes: JobRow[], now: Date): MoneyRow[] {
  const waiting = quotes
    .filter((q) => {
      const status = String(q.proposal_status || '').toLowerCase()
      return q.stage === 'quote' && (status === 'sent' || status === 'viewed')
    })
    .map((q) => ({ q, sent: parseInstant(q.quote_sent_at) }))
    // Whoever has waited longest first; a quote with no sent date last.
    .sort((a, b) => (a.sent?.getTime() ?? Infinity) - (b.sent?.getTime() ?? Infinity))

  return waiting.map(({ q, sent }) => {
    const viewed = String(q.proposal_status || '').toLowerCase() === 'viewed'
    let note: string
    if (viewed) note = sent ? `Viewed, sent ${ago(sent, now)}` : 'Viewed'
    else note = sent ? `Sent ${ago(sent, now)}` : 'Sent'
    return {
      id: q.id,
      title: customerName(q),
      subline: (q.job_title || '').trim(),
      amount: Number(q.amount) || 0,
      note,
      chip: null,
      to: detailRoute(q),
      invoiceId: null,
      canRemind: false
    }
  })
}

// The margin of won jobs that have a cost. A job with no cost recorded
// would read as 100 percent, so it is left out, and one wild cost cannot
// pull a job below minus 100 percent. The mean itself is avgMargin's.
function marginPct(jobs: InvoiceJob[]): number | null {
  const costed = jobs
    .filter((j) => Number(j.amount) > 0 && Number(j.cost) > 0)
    .map((j) => ({ ...j, cost: Math.min(Number(j.cost), Number(j.amount) * 2) }))
  if (costed.length === 0) return null
  return Math.round(avgMargin(costed) * 1000) / 10
}

export function buildMoneyView(input: { bundle: InvoicesBundle; quotes: JobRow[]; now: Date }): MoneyView {
  const { bundle, quotes, now } = input
  const ctx = contextFor(bundle, now)
  const week = weekBounds(now)
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1)
  const nextMonth = new Date(now.getFullYear(), now.getMonth() + 1, 1)

  let collectedThisWeek = 0
  let monthToDate = 0
  const paidList: { p: Payment; day: Date }[] = []
  for (const p of bundle.payments) {
    const day = paymentDay(p)
    if (!day) continue
    const amount = Number(p.amount) || 0
    if (day >= week.start && day < week.end) collectedThisWeek += amount
    if (day >= monthStart && day < nextMonth) monthToDate += amount
    const age = dayDiff(day, ctx.today)
    if (amount > 0 && age >= 0 && age <= PAID_WINDOW_DAYS) paidList.push({ p, day })
  }
  paidList.sort((a, b) => b.day.getTime() - a.day.getTime() || String(b.p.created_at).localeCompare(String(a.p.created_at)))

  const invoicesById = new Map(bundle.invoices.map((i) => [i.id, i]))

  let dueThisWeek = 0
  const overdue: { row: MoneyRow; dueDay: Date }[] = []
  const dueSoon: { row: MoneyRow; dueDay: Date }[] = []
  // Every open invoice, not the display list capped at 500, so an old
  // unpaid bill still counts.
  for (const inv of openInvoicesOf(bundle)) {
    const c = classify(inv, ctx)
    // Drafts, paid and void invoices never count, and neither does a bill
    // the job has already paid off: nothing is owed on it.
    if (!c.issued || !c.dueDay || c.owed <= 0.005) continue
    if (c.dueDay < week.end) dueThisWeek += c.owed
    if (c.row.status === 'overdue') overdue.push({ row: c.row, dueDay: c.dueDay })
    else if (c.until != null && c.until >= 0 && c.until <= DUE_SOON_DAYS) {
      // Due soon shows the date as its note; "Sent" is the full list's chip.
      dueSoon.push({ row: { ...c.row, chip: null }, dueDay: c.dueDay })
    }
  }
  const byDue = (a: { dueDay: Date }, b: { dueDay: Date }) => a.dueDay.getTime() - b.dueDay.getTime()

  return {
    collectedThisWeek: cents(collectedThisWeek),
    dueThisWeek: cents(dueThisWeek),
    monthToDate: cents(monthToDate),
    marginPct: marginPct(bundle.jobs),
    overdue: overdue.sort(byDue).map((e) => e.row),
    dueSoon: dueSoon.sort(byDue).map((e) => e.row),
    waiting: waitingRows(quotes, now),
    paid: paidList.map(({ p, day }) => paidRow(p, day, ctx, invoicesById))
  }
}

/**
 * Every invoice as a row, in the order the bundle holds them (newest
 * first), with its status as a word and its due date. This is the full
 * list behind the Money screen's "All invoices": drafts, invoices due
 * later than a week out, and settled ones, which the four groups leave out.
 */
export function buildInvoiceList(input: { bundle: InvoicesBundle; now: Date }): MoneyInvoiceRow[] {
  const ctx = contextFor(input.bundle, input.now)
  return input.bundle.invoices.map((inv) => classify(inv, ctx).row)
}

/**
 * What the customer owes on one invoice right now: the Mark paid prefill.
 * The same allocation as the rows, with the job's invoices, payments and
 * approved change orders; a draft counts as if it were sent.
 */
export function invoiceDueNow(bundle: InvoicesBundle, invoiceId: string): number {
  const invoices = knownInvoices(bundle)
  const invoice = invoices.find((inv) => inv.id === invoiceId)
  if (!invoice) return 0
  const jobId = invoice.contact_id ?? null
  const job = jobId ? bundle.jobs.find((j) => j.id === jobId) : undefined
  // No job at all: the invoice settles against its own payments (D62).
  if (!jobId) {
    return invoiceAmountDue({ invoice, contact: null, payments: bundle.payments.filter((p) => p.invoice_id === invoice.id) })
  }
  if (!job) return Math.max(0, Number(invoice.amount) || 0)
  return invoiceAmountDue({
    invoice,
    contact: job,
    payments: bundle.payments.filter((p) => p.contact_id === job.id),
    changeOrders: bundle.changeOrders.filter((c) => c.contact_id === job.id),
    invoices: invoices.filter((inv) => inv.contact_id === job.id)
  })
}
