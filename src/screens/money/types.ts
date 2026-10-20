// The shapes Invoices.tsx hands to the phone Money screen. They are the
// rows that screen already builds (issued invoices with their job, per job
// balances, the by client rollup), so the phone and the desktop table read
// the same numbers.

import type { InvoicesBundle } from '../../lib/queries.ts'

export type MoneyJob = InvoicesBundle['jobs'][number]
export type MoneyInvoice = InvoicesBundle['invoices'][number]
export type MoneyPayment = InvoicesBundle['payments'][number]

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

/**
 * What Invoices.tsx hands the Money screen, on a phone and on a desktop:
 * the loaded bundle and the rows it builds from it, so both layouts share
 * one code path. An invoice's own actions (send, PDF, collect payment,
 * void) live on its screen at /invoices/:id (Phase 9, D57, D62).
 */
export type MoneyScreenProps = {
  bundle: InvoicesBundle | undefined
  /** True until the bundle arrives, including while its query waits for the company to be known. */
  loading: boolean
  /** Job balances, already narrowed by the filter. */
  jobBalances: JobBalanceRow[]
  totals: AgingTotals
  clientAR: ClientBalanceGroup[]
  collectionPace: CollectionPace
  filter: MoneyFilter
  onFilterChange: (next: MoneyFilter) => void
  /** The time, refreshed each minute and when the tab comes back (useNow), so the week, the day and the month roll over. */
  now: Date
  onStatement: (group: ClientBalanceGroup) => void
}
