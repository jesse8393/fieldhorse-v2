// The shapes Invoices.tsx hands to the phone Money screen. They are the
// rows that screen already builds (issued invoices with their job, per job
// balances, the by client rollup), so the phone and the desktop table read
// the same numbers.

import type { InvoicesBundle } from '../../lib/queries.ts'

export type MoneyJob = InvoicesBundle['jobs'][number]
export type MoneyInvoice = InvoicesBundle['invoices'][number]
export type MoneyPayment = InvoicesBundle['payments'][number]

/** An fh_invoices row with its job. The status and amount shown come from moneyView. */
export type IssuedInvoiceRow = {
  invoice: MoneyInvoice
  job: MoneyJob | null
}

/** One job's contract, what has been paid, what is left and how old the bill is. */
export type JobBalanceRow = {
  job: MoneyJob
  amount: number
  paid: number
  balance: number
  ageDays: number
  bucket: string
  isOutstanding: boolean
}

/** Outstanding money by age under '0-30', '31-60' and '60+', plus `total` and `count` (how many jobs). */
export type AgingTotals = Record<string, number>

/** Everything one customer owes across their jobs, worst aged first. */
export type ClientBalanceGroup = {
  clientId: string
  client: {
    id: string
    name: string
    company_name: string | null
    email: string
    address: string
  }
  jobs: MoneyJob[]
  total: number
  worst: string
}

export type CollectionPace = {
  monthCollected: number
  /** Percent against the average of the three months before, or null with no history. */
  deltaPct: number | null
}

export type MoneyFilter = 'outstanding' | 'all'

export type SendInvoiceOptions = { reminder?: boolean }

/**
 * What Invoices.tsx hands the Money screen, on a phone and on a desktop:
 * the loaded bundle, the rows it builds from it and the handlers that
 * send, download, void and record payments, so both layouts share one
 * code path.
 */
export type MoneyScreenProps = {
  bundle: InvoicesBundle | undefined
  /** True until the bundle arrives, including while its query waits for the company to be known. */
  loading: boolean
  /** Issued invoices with their job (every one, unfiltered). */
  invoiceRows: IssuedInvoiceRow[]
  /** Job balances, already narrowed by the filter. */
  jobBalances: JobBalanceRow[]
  totals: AgingTotals
  clientAR: ClientBalanceGroup[]
  collectionPace: CollectionPace
  filter: MoneyFilter
  onFilterChange: (next: MoneyFilter) => void
  /** The time, refreshed each minute and when the tab comes back (useNow), so the week, the day and the month roll over. */
  now: Date
  /** The invoice ids whose email is mid send, one entry each, so one finishing never frees another's button. */
  sendingIds: ReadonlySet<string>
  /** Sends the invoice email. Resolves true once it has gone out. */
  onSendInvoice: (row: IssuedInvoiceRow, options?: SendInvoiceOptions) => Promise<boolean>
  onDownloadInvoice: (row: IssuedInvoiceRow) => void
  onPayInvoice: (row: IssuedInvoiceRow) => void
  onVoidInvoice: (row: IssuedInvoiceRow) => void
  onStatement: (group: ClientBalanceGroup) => void
  /** Reload the invoices after a new one is saved. */
  onRefresh: () => void
}
