// The three lists the old desktop Money page carried that the four groups
// leave out, as tables on a desktop. They open at ?panel= in the URL
// (decision D16, the same pages the phone has), so Back closes them:
//
//   Who owes you   every customer with a balance, and a statement for each
//   All invoices   drafts, invoices due later than a week, paid and void,
//                  with the Outstanding and All choice
//   Job balances   contract minus payments per job, the aging summary and
//                  the month's collection pace, a filter box, sortable
//                  columns, Log payment and Export CSV

import { useState } from 'react'
import { Link } from 'react-router-dom'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  createColumnHelper
} from '@tanstack/react-table'
import type { SortingState } from '@tanstack/react-table'
import { ArrowDown, ArrowUp, ArrowUpDown, Check, FileDown, Receipt, Search } from 'lucide-react'
import { Button, Chip, EmptyState, formatMoney } from '../../fh'
import type { MoneyInvoiceRow } from '../../../lib/moneyView.ts'
import { buildCsv, downloadCsv } from '../../../lib/csv.ts'
import { useInfiniteRender } from '../../../lib/useInfiniteRender.ts'
import { AGING, FilterControl, agingLabel, plural } from '../../../screens/money/MoneyPanels.tsx'
import type {
  AgingTotals,
  ClientBalanceGroup,
  CollectionPace,
  JobBalanceRow,
  MoneyFilter
} from '../../../screens/money/types.ts'

/* ---------------- Aging summary ---------------- */

/** Outstanding by age: the total, then Current, Late and Overdue, each with its range. */
export function AgingSummary({ totals, pace }: { totals: AgingTotals; pace?: CollectionPace }) {
  return (
    <section className="fhmd-aging" aria-label="Outstanding by age">
      <div className="fhmd-aging__head">
        <p className="fhmd-aging__label">Total outstanding</p>
        <p className="fhmd-aging__total">{formatMoney(totals.total)}</p>
      </div>
      <dl className="fhmd-aging__facts">
        {AGING.map((b) => (
          <div key={b.id} className="fhmd-aging__fact">
            <dt>{b.label}</dt>
            <dd>{formatMoney(totals[b.id])}</dd>
            <dd className="fhmd-aging__range">{b.range}</dd>
          </div>
        ))}
      </dl>
      {pace && pace.monthCollected > 0 && (
        <p className="fhmd-aging__pace">
          {`${formatMoney(pace.monthCollected)} collected this month`}
          {pace.deltaPct !== null && pace.deltaPct !== 0 &&
            `, ${Math.abs(pace.deltaPct)} percent ${pace.deltaPct > 0 ? 'above' : 'below'} your average of the three months before`}
        </p>
      )}
    </section>
  )
}

function AgingChip({ bucket, days }: { bucket: string; days?: number }) {
  const aging = agingLabel(bucket)
  // A bill not yet due has an age of zero or less: just "Current".
  const label = days !== undefined && days > 0 ? `${aging.label}, ${plural(days, 'day', 'days')}` : aging.label
  return <Chip label={label} tone={aging.tone} />
}

/* ---------------- Who owes you ---------------- */

export function StatementsTable({
  groups,
  onStatement
}: {
  groups: ClientBalanceGroup[]
  onStatement: (group: ClientBalanceGroup) => void
}) {
  if (groups.length === 0) {
    return <EmptyState icon={Check} title="Nobody owes you right now." />
  }
  return (
    <>
      <p className="fhmd-intro">
        Customers with a balance, the most overdue first. A statement rolls every open invoice into one document.
      </p>
      <table className="fhmd-table fhmd-table--panel" aria-label="Who owes you">
        <colgroup>
          <col className="fhmd-col--customer" />
          <col className="fhmd-col--job" />
          <col className="fhmd-col--status" />
          <col className="fhmd-col--amount" />
          <col className="fhmd-col--action" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Customer</th>
            <th scope="col">Properties</th>
            <th scope="col">Status</th>
            <th scope="col" className="fhmd-num">Balance</th>
            <th scope="col" className="fhmd-end">Action</th>
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const name = g.client.company_name || g.client.name || 'Customer'
            return (
              <tr key={g.clientId} className="fhmd-row">
                <td className="fhmd-cell--customer">
                  <Link className="fhmd-name fhmd-name--link" to={`/clients/${g.clientId}`}>{name}</Link>
                </td>
                <td className="fhmd-cell--job">{plural(g.jobs.length, 'property', 'properties')}</td>
                <td><div className="fhmd-status"><AgingChip bucket={g.worst} /></div></td>
                <td className="fhmd-num fhmd-cell--amount">{formatMoney(g.total)}</td>
                <td className="fhmd-end">
                  <Button
                    variant="secondary"
                    size="mini"
                    aria-label={`Statement for ${name}`}
                    onClick={() => onStatement(g)}
                  >
                    Statement
                  </Button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </>
  )
}

/* ---------------- All invoices ---------------- */

export function InvoicesTable({
  rows,
  filter,
  onFilterChange,
  onOpenInvoice
}: {
  rows: MoneyInvoiceRow[]
  filter: MoneyFilter
  onFilterChange: (next: MoneyFilter) => void
  onOpenInvoice: (invoiceId: string) => void
}) {
  const shown = filter === 'outstanding'
    ? rows.filter((r) => r.status === 'draft' || r.status === 'sent' || r.status === 'overdue')
    : rows
  // The list can hold years of invoices; mount a window and grow it on scroll.
  const { visible, sentinelRef, hasMore } = useInfiniteRender(shown, filter)

  return (
    <>
      <div className="fhmd-tools">
        <div className="fhmd-tools__filter">
          <FilterControl value={filter} onChange={onFilterChange} label="Show invoices" />
        </div>
        <p className="fhmd-tools__count">{plural(shown.length, 'invoice', 'invoices')}</p>
      </div>
      {shown.length === 0 ? (
        <EmptyState icon={Receipt} title={filter === 'outstanding' ? 'No open invoices.' : 'No invoices yet.'} />
      ) : (
        <table className="fhmd-table fhmd-table--panel" aria-label="All invoices">
          <colgroup>
            <col className="fhmd-col--customer" />
            <col className="fhmd-col--job" />
            <col className="fhmd-col--amount" />
            <col className="fhmd-col--status" />
            <col className="fhmd-col--action" />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Customer</th>
              <th scope="col">Job</th>
              <th scope="col" className="fhmd-num">Amount</th>
              <th scope="col">Status</th>
              <th scope="col" className="fhmd-end">Action</th>
            </tr>
          </thead>
          <tbody>
            {visible.map((r) => (
              <tr
                key={r.id}
                className="fhmd-row is-click"
                onClick={(e) => { if (!(e.target as HTMLElement).closest('button, a')) onOpenInvoice(r.id) }}
              >
                <td className="fhmd-cell--customer"><span className="fhmd-name">{r.title}</span></td>
                <td className="fhmd-cell--job">{r.subline}</td>
                <td className="fhmd-num fhmd-cell--amount">{formatMoney(r.amount)}</td>
                <td>
                  <div className="fhmd-status">
                    {r.chip && <Chip label={r.chip.label} tone={r.chip.tone} />}
                    {r.note && <span className={r.chip ? 'fhmd-status__sub' : 'fhmd-status__main'}>{r.note}</span>}
                  </div>
                </td>
                <td className="fhmd-end">
                  <Button
                    variant="quiet"
                    size="mini"
                    aria-label={`Open ${r.title}, ${r.subline}`}
                    onClick={() => onOpenInvoice(r.id)}
                  >
                    Open
                  </Button>
                </td>
              </tr>
            ))}
            {hasMore && (
              <tr aria-hidden="true">
                <td colSpan={5} style={{ height: 1, padding: 0, border: 0 }}>
                  <div ref={sentinelRef} style={{ height: 1 }} />
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </>
  )
}

/* ---------------- Job balances ---------------- */

const columnHelper = createColumnHelper<JobBalanceRow>()

// Column defs are pure config: header, accessor and sort rule. The
// rendering below is hand written.
const COLUMNS = [
  columnHelper.accessor((r) => r.job.name || 'Unnamed job', { id: 'name', header: 'Customer' }),
  columnHelper.accessor((r) => r.ageDays, { id: 'status', header: 'Status' }),
  columnHelper.accessor((r) => r.amount, { id: 'amount', header: 'Contract' }),
  columnHelper.accessor((r) => r.paid, { id: 'paid', header: 'Paid' }),
  columnHelper.accessor((r) => r.balance, { id: 'balance', header: 'Balance' })
]

// The filter box matches the customer, the job title and the job type.
function rowMatches(row: { original: JobBalanceRow }, _columnId: string, needle: string) {
  const j = row.original.job
  const hay = `${j.name || ''} ${j.job_title || ''} ${j.job_type || ''}`.toLowerCase()
  return hay.includes(String(needle).toLowerCase())
}

function toCsv(rows: JobBalanceRow[]): string {
  return buildCsv(
    ['Client', 'Job', 'Status', 'Age (days)', 'Contract', 'Paid', 'Balance'],
    rows.map((r) => [
      r.job.name || 'Untitled',
      r.job.job_title || r.job.job_type || '',
      agingLabel(r.bucket).label,
      r.ageDays,
      r.amount.toFixed(2),
      r.paid.toFixed(2),
      r.balance.toFixed(2)
    ])
  )
}

const NUMERIC = new Set(['amount', 'paid', 'balance'])

export function BalancesTable({
  rows,
  totals,
  pace,
  filter,
  onFilterChange,
  onPayRow,
  onOpenJob
}: {
  /** Already narrowed by the filter. */
  rows: JobBalanceRow[]
  totals: AgingTotals
  pace: CollectionPace
  filter: MoneyFilter
  onFilterChange: (next: MoneyFilter) => void
  /** Log payment on a job. */
  onPayRow: (row: JobBalanceRow) => void
  onOpenJob: (jobId: string) => void
}) {
  // Biggest balance first: the money you would chase first.
  const [sorting, setSorting] = useState<SortingState>([{ id: 'balance', desc: true }])
  const [search, setSearch] = useState('')

  const table = useReactTable({
    data: rows,
    columns: COLUMNS,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    globalFilterFn: rowMatches,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel()
  })

  const viewRows = table.getRowModel().rows
  const { visible, sentinelRef, hasMore } = useInfiniteRender(viewRows, `${filter}|${search}|${JSON.stringify(sorting)}`)
  const resultCount = viewRows.length

  const exportCsv = () => downloadCsv(`fieldhorse-invoices-${filter}.csv`, toCsv(viewRows.map((r) => r.original)))

  return (
    <>
      <AgingSummary totals={totals} pace={pace} />

      <div className="fhmd-tools">
        <div className="fhmd-tools__filter">
          <FilterControl value={filter} onChange={onFilterChange} label="Show jobs" />
        </div>
        <label className="fhmd-search">
          <Search size={18} aria-hidden="true" />
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Filter customer or job"
            aria-label="Filter jobs"
          />
        </label>
        <Button variant="secondary" size="md" icon={FileDown} disabled={resultCount === 0} onClick={exportCsv}>
          Export CSV
        </Button>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={Check}
          title={filter === 'outstanding' ? 'Nothing outstanding. Every active job is paid in full.' : 'No money jobs yet.'}
        />
      ) : (
        <>
          <p className="fhmd-count">
            {plural(resultCount, 'job', 'jobs')}
            {search && ` of ${rows.length.toLocaleString()}`}
          </p>
          <table className="fhmd-table fhmd-table--panel fhmd-table--balances" aria-label="Job balances">
            <colgroup>
              <col className="fhmd-col--customer" />
              <col className="fhmd-col--status" />
              <col className="fhmd-col--amount" />
              <col className="fhmd-col--amount" />
              <col className="fhmd-col--amount" />
              <col className="fhmd-col--wide-action" />
            </colgroup>
            <thead>
              <tr>
                {table.getFlatHeaders().map((header) => {
                  const dir = header.column.getIsSorted()
                  const text = String(header.column.columnDef.header)
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      className={NUMERIC.has(header.id) ? 'fhmd-num' : undefined}
                      aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                    >
                      <button
                        type="button"
                        className={`fhmd-sort${dir ? ' is-sorted' : ''}`}
                        aria-label={`Sort by ${text}`}
                        onClick={header.column.getToggleSortingHandler()}
                      >
                        {text}
                        {dir === 'asc' ? <ArrowUp size={14} aria-hidden="true" /> : dir === 'desc' ? <ArrowDown size={14} aria-hidden="true" /> : <ArrowUpDown size={14} aria-hidden="true" className="fhmd-sort__hint" />}
                      </button>
                    </th>
                  )
                })}
                <th scope="col" className="fhmd-end">Action</th>
              </tr>
            </thead>
            <tbody>
              {visible.length === 0 && (
                <tr><td colSpan={6} className="fhmd-none">{`Nothing matches "${search}".`}</td></tr>
              )}
              {visible.map((tr) => {
                const r = tr.original
                const name = r.job.name || 'Unnamed job'
                return (
                  <tr key={r.job.id} className="fhmd-row">
                    <td className="fhmd-cell--customer">
                      <Link className="fhmd-name fhmd-name--link" to={`/invoices/${r.job.id}`}>{name}</Link>
                      {r.job.job_title && <span className="fhmd-sub">{r.job.job_title}</span>}
                    </td>
                    <td>
                      <div className="fhmd-status">
                        {r.isOutstanding
                          ? <AgingChip bucket={r.bucket} days={r.ageDays} />
                          : <Chip label="Paid" tone="success" />}
                      </div>
                    </td>
                    <td className="fhmd-num">{formatMoney(r.amount)}</td>
                    <td className="fhmd-num">{r.paid > 0 ? formatMoney(r.paid) : ''}</td>
                    <td className="fhmd-num fhmd-cell--amount">{r.balance > 0 ? formatMoney(r.balance) : 'Paid'}</td>
                    <td className="fhmd-end">
                      <div className="fhmd-actions">
                        {r.balance > 0.5 && (
                          <Button
                            variant="secondary"
                            size="mini"
                            aria-label={`Log payment for ${name}`}
                            onClick={() => onPayRow(r)}
                          >
                            Log payment
                          </Button>
                        )}
                        <Button
                          variant="quiet"
                          size="mini"
                          aria-label={`Open job for ${name}`}
                          onClick={() => onOpenJob(r.job.id)}
                        >
                          Open job
                        </Button>
                      </div>
                    </td>
                  </tr>
                )
              })}
              {hasMore && (
                <tr aria-hidden="true">
                  <td colSpan={6} style={{ height: 1, padding: 0, border: 0 }}>
                    <div ref={sentinelRef} style={{ height: 1 }} />
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </>
      )}
    </>
  )
}
