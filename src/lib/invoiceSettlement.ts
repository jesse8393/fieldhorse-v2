// src/lib/invoiceSettlement.ts
//
// Pure money logic that ties a job's payments to its fh_invoices rows.
// No Supabase in here so it unit tests cleanly: stages.ts (logPayment)
// and the money screens pass in rows they already fetched.
//
// All math runs in integer cents so float dust never strands a paid
// flip or mints a one cent invoice.

import { parseDateOnly } from './dates.ts'

export type SettleInvoice = {
  id: string
  amount?: number | string | null
  status?: string | null
  sequence_number?: number | null
  due_at?: string | null
  created_at?: string | null
}

export type SettlePayment = {
  amount?: number | string | null
  invoice_id?: string | null
}

// Statuses that still ask the customer for money: a bill not yet sent
// (draft) or one the customer has (sent, viewed, overdue).
const OPEN_STATUSES = new Set(['draft', 'sent', 'viewed', 'overdue'])

function toCents(n: unknown): number {
  const v = Math.round(Number(n || 0) * 100)
  return Number.isFinite(v) ? v : 0
}

function statusOf(inv: { status?: string | null } | null | undefined): string {
  return String(inv?.status || '').toLowerCase()
}

function dueTime(inv: SettleInvoice): number {
  const d = parseDateOnly(inv.due_at ?? null)
  return d ? d.getTime() : Number.POSITIVE_INFINITY
}

/**
 * The order money settles a job's bills in: by invoice number, then by due
 * date (a bill with no due date waits behind the dated ones), then by when
 * the row was made. logPayment, the job page's Mark paid and the allocator
 * below all settle in this order, so Money, Today and the job page agree
 * on which bill a payment went to. Invoice numbers run in the order the
 * bills were made, which is also why an unsent deposit draft made from the
 * terms comes before the progress draw that was sent after it.
 */
function bySettleOrder(a: SettleInvoice, b: SettleInvoice): number {
  const seq = Number(a.sequence_number || 0) - Number(b.sequence_number || 0)
  if (seq !== 0) return seq
  const at = dueTime(a)
  const bt = dueTime(b)
  if (at !== bt) return at < bt ? -1 : 1
  const created = String(a.created_at || '').localeCompare(String(b.created_at || ''))
  if (created !== 0) return created
  return a.id.localeCompare(b.id)
}

// Live (non void) rows, once each, in settle order.
function liveInSettleOrder<T extends SettleInvoice>(invoices: T[] | null | undefined): T[] {
  const byId = new Map<string, T>()
  for (const inv of invoices || []) {
    if (inv?.id && statusOf(inv) !== 'void' && !byId.has(inv.id)) byId.set(inv.id, inv)
  }
  return [...byId.values()].sort(bySettleOrder)
}

/**
 * Ids of the open invoices (draft, sent, viewed, overdue) that the job's
 * payments now pay in full.
 *
 * A payment linked to an invoice pays that invoice first, and anything
 * it pays beyond the invoice amount joins the unlinked money. Unlinked
 * money (payments logged against the job) then pays open invoices in
 * settle order (bySettleOrder). An invoice only settles from unlinked
 * money when doing so still leaves open bills for everything the
 * customer owes on billed work, so money that already paid an earlier
 * invoice (or covers a row someone marked paid by hand) is never counted
 * twice.
 *
 * contractTotal is the job amount plus approved change orders. Pass null
 * when it is unknown and the check falls back to the invoiced total.
 */
export function invoicesPaidInFull({ invoices, payments, contractTotal = null }: {
  invoices: SettleInvoice[] | null | undefined
  payments: SettlePayment[] | null | undefined
  contractTotal?: number | null
}): string[] {
  const live = liveInSettleOrder(invoices)
  const liveIds = new Set(live.map((inv) => inv.id))

  let paidTotal = 0
  let unlinked = 0
  const linked = new Map<string, number>()
  for (const p of payments || []) {
    const amt = toCents(p?.amount)
    paidTotal += amt
    // A link to a voided or deleted invoice no longer pays anything
    // specific, so that money counts as unlinked.
    const target = p?.invoice_id && liveIds.has(p.invoice_id) ? p.invoice_id : null
    if (target) linked.set(target, (linked.get(target) || 0) + amt)
    else unlinked += amt
  }

  let invoicedTotal = 0
  for (const inv of live) {
    const amt = toCents(inv.amount)
    invoicedTotal += amt
    const over = (linked.get(inv.id) || 0) - Math.max(0, amt)
    if (over > 0) unlinked += over
  }

  const open = live.filter((inv) => OPEN_STATUSES.has(statusOf(inv)) && toCents(inv.amount) > 0)
  const left = new Map(open.map((inv) => [inv.id, Math.max(0, toCents(inv.amount) - (linked.get(inv.id) || 0))]))

  const settled = new Set<string>()
  let openOwed = 0
  for (const inv of open) {
    const rest = left.get(inv.id) || 0
    // Its own linked payments cover it.
    if (rest === 0) settled.add(inv.id)
    else openOwed += rest
  }

  const billed = contractTotal == null
    ? invoicedTotal
    : Math.min(toCents(contractTotal), invoicedTotal)
  const owedOnBills = Math.max(0, billed - paidTotal)
  let pool = unlinked
  for (const inv of open) {
    const rest = left.get(inv.id) || 0
    if (rest === 0) continue
    // Strictly oldest first: once a bill can't be fully paid, the rest of
    // the money is a partial payment on it and later bills wait.
    if (pool < rest || openOwed - rest < owedOnBills) break
    pool -= rest
    openOwed -= rest
    settled.add(inv.id)
  }
  return open.filter((inv) => settled.has(inv.id)).map((inv) => inv.id)
}

export type BalanceInvoicePlan<T> =
  | { invoice: T; amount?: undefined }
  | { invoice?: undefined; amount: number }

/**
 * What a "send the balance" action should bill for a job. Resends the
 * oldest open invoice (issued ones before drafts) when one exists.
 * Otherwise it mints a new invoice for the part of the contract nobody
 * has billed yet or, when everything is billed but money is still owed,
 * for that balance. Minting the whole balance next to open bills used
 * to double the job's invoiced total. Null when nothing is owed.
 */
export function pickBalanceInvoice<T extends SettleInvoice>({ invoices, contractTotal, balance }: {
  invoices: T[] | null | undefined
  contractTotal: number | string | null | undefined
  balance: number | string | null | undefined
}): BalanceInvoicePlan<T> | null {
  const live = liveInSettleOrder(invoices)
  const open = live.filter((inv) => OPEN_STATUSES.has(statusOf(inv)) && toCents(inv.amount) > 0)
  const resend = open.find((inv) => statusOf(inv) !== 'draft') || open[0]
  if (resend) return { invoice: resend }
  const unbilled = toCents(contractTotal) - live.reduce((s, inv) => s + toCents(inv.amount), 0)
  if (unbilled > 50) return { amount: unbilled / 100 }
  const owed = toCents(balance)
  if (owed > 50) return { amount: owed / 100 }
  return null
}

// ---- What each open invoice still owes ----

/**
 * Statuses of an issued bill that still asks the customer for money. The
 * table allows draft, sent, paid, overdue and void; viewed is listed too,
 * so a bill ever marked viewed keeps counting as open.
 */
export const OPEN_INVOICE_STATUSES = ['sent', 'viewed', 'overdue'] as const

export function isOpenInvoice(inv: { status?: string | null } | null | undefined): boolean {
  return (OPEN_INVOICE_STATUSES as readonly string[]).includes(statusOf(inv))
}

/**
 * The job's contract for the allocator's cap, in dollars: the job amount
 * plus approved change orders, or null when it is unknown. A job billed
 * without a recorded amount (and no approved change order) has nothing to
 * cap at, so its invoices ask for their face less payments instead of
 * nothing. Money, Today and the reminder email all read this.
 */
export function knownContractTotal({ amount, changeOrders }: {
  amount: number | string | null | undefined
  changeOrders?: readonly { amount?: number | string | null; status?: string | null }[] | null
}): number | null {
  const approved = (changeOrders || []).filter((co) => co?.status === 'approved')
  const base = Number(amount || 0)
  if (!base && approved.length === 0) return null
  return base + approved.reduce((sum, co) => sum + Number(co.amount || 0), 0)
}

export type DueInvoice = SettleInvoice & {
  contact_id?: string | null
}

export type DuePayment = SettlePayment & {
  contact_id?: string | null
}

/**
 * What the customer still owes on each issued invoice (sent, viewed,
 * overdue) of ONE job, in dollars, keyed by invoice id. Money's rows, its
 * totals, the Remind sheet, the reminder email and the PDF it attaches,
 * the Mark paid prefill and Today's overdue rows all read this, so they
 * ask for one figure.
 *
 * 1. A payment linked to an invoice pays that invoice; whatever it pays
 *    beyond the invoice joins the job's unlinked money. Money linked to a
 *    void invoice is unlinked. Money linked to an invoice this list does
 *    not carry (a row that was not loaded) paid that one, so it pays
 *    nothing here.
 * 2. Unlinked money (logged against the job) pays the open bills in settle
 *    order (bySettleOrder: invoice number, then due date). Unsent drafts
 *    take part: a deposit logged before the draws were made covers the
 *    deposit draft, so the progress draw still asks for all of its amount,
 *    which is what invoicesPaidInFull tells the job page. The money never
 *    goes below what the customer still owes on billed work (every live
 *    invoice, capped at the contract, less every payment), so money that
 *    already paid a bill marked paid is not counted again. An issued
 *    invoice owes nothing here exactly when invoicesPaidInFull settles it.
 * 3. The running total of the issued amounts, in settle order, never goes
 *    above the job balance (the contract less every payment).
 *
 * contractTotal is the job amount plus approved change orders; null when
 * it is unknown (see knownContractTotal), which skips the cap. Pass
 * applyUnlinked false when the list is not every invoice on the job:
 * unlinked money may then belong to a bill that is missing, so only step 1
 * and the cap apply.
 */
export function allocateInvoiceDue({ invoices, payments, contractTotal = null, applyUnlinked = true }: {
  invoices: DueInvoice[] | null | undefined
  payments: SettlePayment[] | null | undefined
  contractTotal?: number | null
  applyUnlinked?: boolean
}): Map<string, number> {
  const voidIds = new Set((invoices || []).filter((inv) => inv?.id && statusOf(inv) === 'void').map((inv) => inv.id))
  const live = liveInSettleOrder(invoices)
  const liveIds = new Set(live.map((inv) => inv.id))
  // The bills money can go to, unsent drafts included, and the issued ones
  // this answers for.
  const open = live.filter((inv) => OPEN_STATUSES.has(statusOf(inv)) && toCents(inv.amount) > 0)
  const issued = open.filter(isOpenInvoice)

  let paidTotal = 0
  let unlinked = 0
  const linked = new Map<string, number>()
  for (const p of payments || []) {
    const amt = toCents(p?.amount)
    paidTotal += amt
    const target = p?.invoice_id || null
    if (!target || voidIds.has(target)) unlinked += amt
    else if (liveIds.has(target)) linked.set(target, (linked.get(target) || 0) + amt)
  }

  let invoicedTotal = 0
  for (const inv of live) {
    const amt = Math.max(0, toCents(inv.amount))
    invoicedTotal += amt
    const over = (linked.get(inv.id) || 0) - amt
    if (over > 0) unlinked += over
  }

  const rest = new Map(open.map((inv) => [inv.id, Math.max(0, toCents(inv.amount) - (linked.get(inv.id) || 0))]))

  if (applyUnlinked) {
    const openOwed = open.reduce((sum, inv) => sum + (rest.get(inv.id) || 0), 0)
    const billedCap = contractTotal == null ? invoicedTotal : Math.min(toCents(contractTotal), invoicedTotal)
    const owedOnBills = Math.max(0, billedCap - paidTotal)
    let pool = Math.min(unlinked, Math.max(0, openOwed - owedOnBills))
    for (const inv of open) {
      if (pool <= 0) break
      const take = Math.min(pool, rest.get(inv.id) || 0)
      rest.set(inv.id, (rest.get(inv.id) || 0) - take)
      pool -= take
    }
  }

  if (contractTotal != null) {
    let room = Math.max(0, toCents(contractTotal) - paidTotal)
    for (const inv of issued) {
      const owed = Math.min(rest.get(inv.id) || 0, room)
      rest.set(inv.id, owed)
      room -= owed
    }
  }

  return new Map(issued.map((inv) => [inv.id, (rest.get(inv.id) || 0) / 100]))
}

/**
 * allocateInvoiceDue for many jobs at once: the invoices and payments are
 * grouped by contact_id and each job is allocated on its own.
 * contractFor gives a job's contract, or null when it is unknown.
 *
 * An invoice with no job (D62) is a contract of its own amount: it is
 * allocated alone, with the payments linked to it.
 */
export function amountsDueByInvoice({ invoices, payments, contractFor }: {
  invoices: DueInvoice[] | null | undefined
  payments: DuePayment[] | null | undefined
  contractFor: (jobId: string) => number | null
}): Map<string, number> {
  const invoicesByJob = new Map<string, DueInvoice[]>()
  const alone: DueInvoice[] = []
  for (const inv of invoices || []) {
    if (!inv?.contact_id) {
      if (inv?.id) alone.push(inv)
      continue
    }
    const list = invoicesByJob.get(inv.contact_id)
    if (list) list.push(inv)
    else invoicesByJob.set(inv.contact_id, [inv])
  }
  const paymentsByJob = new Map<string, DuePayment[]>()
  const paymentsByInvoice = new Map<string, DuePayment[]>()
  for (const p of payments || []) {
    if (!p?.contact_id) {
      if (p?.invoice_id) {
        const list = paymentsByInvoice.get(p.invoice_id)
        if (list) list.push(p)
        else paymentsByInvoice.set(p.invoice_id, [p])
      }
      continue
    }
    if (!invoicesByJob.has(p.contact_id)) continue
    const list = paymentsByJob.get(p.contact_id)
    if (list) list.push(p)
    else paymentsByJob.set(p.contact_id, [p])
  }
  const out = new Map<string, number>()
  for (const [jobId, list] of invoicesByJob) {
    const due = allocateInvoiceDue({ invoices: list, payments: paymentsByJob.get(jobId) ?? [], contractTotal: contractFor(jobId) })
    for (const [id, owed] of due) out.set(id, owed)
  }
  for (const inv of alone) {
    const due = allocateInvoiceDue({ invoices: [inv], payments: paymentsByInvoice.get(inv.id) ?? [], contractTotal: toCents(inv.amount) / 100 })
    for (const [id, owed] of due) out.set(id, owed)
  }
  return out
}
