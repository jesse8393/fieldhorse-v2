// src/lib/invoiceSettlement.ts
//
// Pure money logic that ties a job's payments to its fh_invoices rows.
// No Supabase in here so it unit tests cleanly: stages.ts (logPayment)
// and the money screens pass in rows they already fetched.
//
// All math runs in integer cents so float dust never strands a paid
// flip or mints a one cent invoice.

export type SettleInvoice = {
  id: string
  amount?: number | string | null
  status?: string | null
  sequence_number?: number | null
}

export type SettlePayment = {
  amount?: number | string | null
  invoice_id?: string | null
}

// Statuses that still ask the customer for money.
const OPEN_STATUSES = new Set(['draft', 'sent', 'overdue'])

function toCents(n: unknown): number {
  const v = Math.round(Number(n || 0) * 100)
  return Number.isFinite(v) ? v : 0
}

function statusOf(inv: { status?: string | null } | null | undefined): string {
  return String(inv?.status || '').toLowerCase()
}

// Live (non void) rows, oldest first.
function liveBySequence<T extends SettleInvoice>(invoices: T[] | null | undefined): T[] {
  return (invoices || [])
    .filter((inv) => !!inv?.id && statusOf(inv) !== 'void')
    .sort((a, b) => Number(a.sequence_number || 0) - Number(b.sequence_number || 0))
}

/**
 * Ids of the open invoices (draft, sent, overdue) that the job's
 * payments now pay in full.
 *
 * A payment linked to an invoice pays that invoice first, and anything
 * it pays beyond the invoice amount joins the unlinked money. Unlinked
 * money (payments logged against the job) then pays open invoices
 * oldest first. An invoice only settles from unlinked money when doing
 * so still leaves open bills for everything the customer owes on billed
 * work, so money that already paid an earlier invoice (or covers a row
 * someone marked paid by hand) is never counted twice.
 *
 * contractTotal is the job amount plus approved change orders. Pass null
 * when it is unknown and the check falls back to the invoiced total.
 */
export function invoicesPaidInFull({ invoices, payments, contractTotal = null }: {
  invoices: SettleInvoice[] | null | undefined
  payments: SettlePayment[] | null | undefined
  contractTotal?: number | null
}): string[] {
  const live = liveBySequence(invoices)
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
  const live = liveBySequence(invoices)
  const open = live.filter((inv) => OPEN_STATUSES.has(statusOf(inv)) && toCents(inv.amount) > 0)
  const resend = open.find((inv) => statusOf(inv) !== 'draft') || open[0]
  if (resend) return { invoice: resend }
  const unbilled = toCents(contractTotal) - live.reduce((s, inv) => s + toCents(inv.amount), 0)
  if (unbilled > 50) return { amount: unbilled / 100 }
  const owed = toCents(balance)
  if (owed > 50) return { amount: owed / 100 }
  return null
}
