// SnowInvoicesBuild, desktop /invoices in the Build direction.
//
// Drop-in for SnowInvoices at >=900px. Same props, same handlers.
// Aging buckets in the hero, full-width invoices table, right rail
// with collection signals. Onyx surface, gold accents.
//
// The table runs on TanStack Table (headless), click a column head
// to sort, type in the filter box to search client/job, Export CSV
// downloads exactly what's on screen (current filter + sort). The
// visual layer stays the fh-build grid rows; TanStack only owns the
// sorting/filtering state, so the Build aesthetic is untouched.

import { useMemo, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  ArrowUpDown,
  Ban,
  Bell,
  CheckCircle2,
  ChevronRight,
  DollarSign,
  FileDown,
  Receipt,
  Search,
  Send
} from 'lucide-react'
import {
  useReactTable,
  getCoreRowModel,
  getSortedRowModel,
  getFilteredRowModel,
  createColumnHelper,
} from '@tanstack/react-table'
import type { SortingState } from '@tanstack/react-table'
import { money, moneyFull } from '../../lib/format.ts'
import { buildCsv, downloadCsv } from '../../lib/csv.ts'
import MiniMetric from '../MiniMetric.tsx'
import TopbarWeather from './TopbarWeather.tsx'
import { Button } from '../v3'

type Row = {
  job: {
    id: string
    name?: string | null
    job_title?: string | null
    job_type?: string | null
  }
  amount: number
  paid: number
  balance: number
  ageDays: number
}

// Loosely typed totals so we accept whatever shape the parent screen
// computes (currently a Record<string, number> with the buckets below).
type Totals = Record<string, number> & {
  total?: number
  count?: number
  '0-30'?: number
  '31-60'?: number
  '60+'?: number
}

type ClientARGroup = {
  clientId: string
  client: { id: string; name?: string | null; company_name?: string | null }
  jobs: any[]
  total: number
  worst: string
}

type IssuedInvoiceRow = {
  invoice: {
    id: string
    title?: string | null
    sequence_number?: number | null
    amount?: number | null
    status?: string | null
    issued_at?: string | null
    due_at?: string | null
  }
  job: Row['job'] | null
  effStatus: string
}

type Props = {
  rows: Row[]
  filtered: Row[]
  issuedInvoices: IssuedInvoiceRow[]
  totals: Totals
  loading: boolean
  filter: 'outstanding' | 'all'
  setFilter: (f: 'outstanding' | 'all') => void
  sendingId?: string | null
  sentId?: string | null
  clientAR?: ClientARGroup[]
  onOpenJob: (id: string) => void
  onOpenClient?: (id: string) => void
  onStatement?: (g: ClientARGroup) => void
  onPayRow: (row: Row) => void
  onSendInvoice: (row: IssuedInvoiceRow) => void
  onDownloadInvoice: (row: IssuedInvoiceRow) => void
  onPayInvoice: (row: IssuedInvoiceRow) => void
  onVoidInvoice: (row: IssuedInvoiceRow) => void
}

const AR_TONE: Record<string, 'good' | 'warn' | 'bad'> = { '0-30': 'good', '31-60': 'warn', '60+': 'bad' }
const AR_LABEL: Record<string, string> = { '0-30': 'Current', '31-60': 'Late', '60+': 'Overdue' }

function ageBucket(days: number): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (days <= 30) return { label: 'Current',  tone: 'good' }
  if (days <= 60) return { label: 'Late',     tone: 'warn' }
  return { label: 'Overdue', tone: 'bad' }
}

const INVOICE_STATUS: Record<string, { label: string; tone: 'good' | 'warn' | 'bad' | 'neutral' }> = {
  draft: { label: 'Draft', tone: 'neutral' },
  sent: { label: 'Sent', tone: 'warn' },
  overdue: { label: 'Overdue', tone: 'bad' },
  paid: { label: 'Paid', tone: 'good' },
  void: { label: 'Void', tone: 'neutral' }
}

function shortDate(value?: string | null) {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

const columnHelper = createColumnHelper<Row>()

// Column defs are pure config, header labels + accessor + sort rules.
// Rendering stays hand-rolled in the grid rows below.
const COLUMNS = [
  columnHelper.accessor((r) => r.job.name || 'Untitled', { id: 'name', header: 'Client / Job' }),
  columnHelper.accessor((r) => r.ageDays, { id: 'status', header: 'Status' }),
  columnHelper.accessor((r) => r.ageDays, { id: 'age', header: 'Age' }),
  columnHelper.accessor((r) => r.amount, { id: 'amount', header: 'Contract' }),
  columnHelper.accessor((r) => r.paid, { id: 'paid', header: 'Paid' }),
  columnHelper.accessor((r) => r.balance, { id: 'balance', header: 'Balance' }),
]

// Search matches client name, job title, and job type.
function rowMatches(row: { original: Row }, _columnId: string, needle: string) {
  const j = row.original.job
  const hay = `${j.name || ''} ${j.job_title || ''} ${j.job_type || ''}`.toLowerCase()
  return hay.includes(needle.toLowerCase())
}

function toCsv(rows: Row[]): string {
  return buildCsv(
    ['Client', 'Job', 'Status', 'Age (days)', 'Contract', 'Paid', 'Balance'],
    rows.map((r) => [
      r.job.name || 'Untitled',
      r.job.job_title || r.job.job_type || '',
      ageBucket(r.ageDays).label,
      r.ageDays,
      r.amount.toFixed(2),
      r.paid.toFixed(2),
      r.balance.toFixed(2),
    ])
  )
}

export default function SnowInvoicesBuild({
  rows, filtered, issuedInvoices, totals, loading, filter, setFilter,
  sendingId, sentId, clientAR = [], onOpenJob, onOpenClient, onStatement, onPayRow,
  onSendInvoice, onDownloadInvoice, onPayInvoice, onVoidInvoice,
}: Props) {
  const collectableThisWeek = filtered.filter((r) => r.balance > 0 && r.ageDays <= 14).length
  const overdueCount = filtered.filter((r) => r.ageDays > 60 && r.balance > 0).length

  // Default sort: biggest balance first, the money you'd chase first.
  const [sorting, setSorting] = useState<SortingState>([{ id: 'balance', desc: true }])
  const [search, setSearch] = useState('')
  const searchRef = useRef<HTMLInputElement>(null)

  const table = useReactTable({
    data: filtered,
    columns: COLUMNS,
    state: { sorting, globalFilter: search },
    onSortingChange: setSorting,
    onGlobalFilterChange: setSearch,
    globalFilterFn: rowMatches,
    getCoreRowModel: getCoreRowModel(),
    getSortedRowModel: getSortedRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
  })

  const viewRows = table.getRowModel().rows
  const visibleRows = useMemo(() => viewRows.slice(0, 80), [viewRows])

  function exportCsv() {
    downloadCsv(`fieldhorse-invoices-${filter}.csv`, toCsv(viewRows.map((r) => r.original)))
  }

  return (
    <div className="fh-build-page" data-build-screen="SnowInvoicesBuild">
      <header className="fh-build-topbar">
        <button
          type="button"
          className="fh-build-search"
          onClick={() => window.dispatchEvent(new CustomEvent('fh:open-palette'))}
          aria-label="Open command palette"
        >
          <Search size={14} />
          <span>Search jobs, clients, invoices, notes...</span>
          <kbd>⌘K</kbd>
        </button>
        <div className="fh-build-topbar__meta">
          <span>
            {issuedInvoices.length.toLocaleString()} issued {issuedInvoices.length === 1 ? 'invoice' : 'invoices'}
            {' · '}
            {totals.count ?? 0} open {totals.count === 1 ? 'balance' : 'balances'}
          </span>
          <span className="fh-build-vline" />
          <TopbarWeather />
        </div>
        <button className="fh-build-icon-btn" type="button" onClick={() => window.dispatchEvent(new CustomEvent('fh:navigate', { detail: { to: '/activity' } }))} aria-label="Open activity" title="Activity"><Bell size={16} /></button>
      </header>

      <main className="fh-build-main">
        <section className="fh-build-hero-row fh-build-hero-row--page">
          <div>
            <div className="fh-build-good">Accounts Receivable</div>
            <h1 className="fh-build-title">COLLECT.</h1>
          </div>

          <div className="fh-build-focus">
            <div className="fh-build-eyebrow">View</div>
            <div className="fh-build-view-toggle fh-build-view-toggle--inline">
              <button
                type="button"
                className={filter === 'outstanding' ? 'is-active' : ''}
                onClick={() => setFilter('outstanding')}
              >
                <Receipt size={13} /> Outstanding
              </button>
              <button
                type="button"
                className={filter === 'all' ? 'is-active' : ''}
                onClick={() => setFilter('all')}
              >
                All
              </button>
            </div>
            <p>
              {filtered.length.toLocaleString()} {filter === 'outstanding' ? 'outstanding' : 'total'} ·
              {' '}{collectableThisWeek} collectable this week
            </p>
          </div>

          <div className="fh-build-mini-grid">
            <MiniMetric label="Outstanding"    value={money(totals.total ?? 0)} accent />
            <MiniMetric label="Current 0-30 d" value={money(totals['0-30'] ?? 0)} />
            <MiniMetric label="Late 31 to 60 d" value={money(totals['31-60'] ?? 0)} tone={(totals['31-60'] ?? 0) > 0 ? 'warn' : undefined} />
            <MiniMetric label="Overdue 60+ d"  value={money(totals['60+'] ?? 0)}  tone={(totals['60+'] ?? 0) > 0 ? 'bad' : undefined} />
          </div>
        </section>

        <section className="fh-build-card fh-build-table fh-build-issued-table">
          <header className="fh-build-card-head">
            <div className="fh-build-eyebrow">
              {filter === 'outstanding' ? 'Open invoices' : 'All issued invoices'}
              {' · '}
              {issuedInvoices.length.toLocaleString()}
            </div>
          </header>

          <div className="fh-build-table__head is-issued-invoices">
            <span>Invoice</span>
            <span>Client / Job</span>
            <span>Status</span>
            <span className="fh-build-num">Amount</span>
            <span className="fh-build-num">Actions</span>
          </div>

          {loading && <div className="fh-build-table__empty">Loading issued invoices...</div>}
          {!loading && issuedInvoices.length === 0 && (
            <div className="fh-build-table__empty">
              {filter === 'outstanding' ? 'No open invoices.' : 'No issued invoices yet.'}
            </div>
          )}
          {!loading && issuedInvoices.map((row) => {
            const { invoice, job, effStatus } = row
            const status = INVOICE_STATUS[effStatus] || INVOICE_STATUS.draft
            const settled = effStatus === 'paid' || effStatus === 'void'
            const isSending = sendingId === invoice.id
            const isSent = sentId === invoice.id
            const title = invoice.title || `Invoice #${invoice.sequence_number || ''}`

            return (
              <div className="fh-build-table__row is-issued-invoices" key={invoice.id}>
                <div className="fh-build-inv-name">
                  <strong className="fh-build-truncate" title={title}>{title}</strong>
                  <span className="fh-build-rel">
                    {invoice.due_at
                      ? `Due ${shortDate(invoice.due_at)}`
                      : invoice.issued_at
                        ? `Sent ${shortDate(invoice.issued_at)}`
                        : 'No due date'}
                  </span>
                </div>
                <button
                  type="button"
                  className="fh-build-issued-job"
                  disabled={!job}
                  onClick={() => job && onOpenJob(job.id)}
                >
                  <strong className="fh-build-truncate">{job?.name || 'Job removed'}</strong>
                  <span className="fh-build-truncate fh-build-rel">
                    {job?.job_title || job?.job_type || ' '}
                  </span>
                </button>
                <span className={`fh-build-dot is-${status.tone}`}>{status.label}</span>
                <span className="fh-build-num">{moneyFull(Number(invoice.amount || 0))}</span>
                <span className="fh-build-issued-actions">
                  {!settled && (
                    <>
                      <Button
                        size="sm"
                        variant={isSent ? 'success' : 'secondary'}
                        iconOnly
                        disabled={isSending || !job}
                        onClick={() => onSendInvoice(row)}
                        aria-label={isSent ? 'Invoice sent' : 'Send invoice'}
                        title={isSent ? 'Invoice sent' : 'Send invoice'}
                      >
                        {isSent ? <CheckCircle2 size={14} /> : <Send size={14} />}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        iconOnly
                        disabled={!job}
                        onClick={() => onDownloadInvoice(row)}
                        aria-label="Download invoice PDF"
                        title="Download invoice PDF"
                      >
                        <FileDown size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        iconOnly
                        disabled={!job}
                        onClick={() => onPayInvoice(row)}
                        aria-label="Mark invoice paid"
                        title="Mark invoice paid"
                      >
                        <DollarSign size={14} />
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost"
                        iconOnly
                        onClick={() => onVoidInvoice(row)}
                        aria-label="Void invoice"
                        title="Void invoice"
                      >
                        <Ban size={14} />
                      </Button>
                    </>
                  )}
                </span>
              </div>
            )
          })}
        </section>

        <section className="fh-build-content-grid fh-build-content-grid--invoices">
          <section className="fh-build-card fh-build-table fh-build-invoices-table">
            <header className="fh-build-card-head">
              <div className="fh-build-eyebrow">
                {filter === 'outstanding' ? 'Outstanding invoices' : 'All invoices'} · {viewRows.length.toLocaleString()}
                {search && ` of ${filtered.length.toLocaleString()}`}
              </div>
              <div className="fh-build-table-tools">
                <label className="fh-build-table-filter">
                  <Search size={12} aria-hidden="true" />
                  <input
                    ref={searchRef}
                    type="search"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Filter client or job…"
                    aria-label="Filter invoices"
                  />
                </label>
                <button type="button" onClick={exportCsv} disabled={loading || viewRows.length === 0}>
                  <FileDown size={12} aria-hidden="true" /> Export CSV
                </button>
              </div>
            </header>

            <div className="fh-build-table__head is-invoices">
              {table.getFlatHeaders().map((header) => {
                const dir = header.column.getIsSorted()
                return (
                  <button
                    key={header.id}
                    type="button"
                    className={`fh-build-sort${dir ? ' is-sorted' : ''}`}
                    onClick={header.column.getToggleSortingHandler()}
                    aria-label={`Sort by ${String(header.column.columnDef.header)}`}
                    aria-sort={dir === 'asc' ? 'ascending' : dir === 'desc' ? 'descending' : undefined}
                  >
                    {String(header.column.columnDef.header)}
                    {dir === 'asc' ? <ArrowUp size={10} /> : dir === 'desc' ? <ArrowDown size={10} /> : <ArrowUpDown size={10} className="fh-build-sort__hint" />}
                  </button>
                )
              })}
              <span />
            </div>

            {loading && (
              <div className="fh-build-table__empty">Loading invoices…</div>
            )}
            {!loading && viewRows.length === 0 && (
              <div className="fh-build-table__empty">
                {search
                  ? `Nothing matches “${search}”.`
                  : filter === 'outstanding'
                    ? 'Nothing outstanding. You’re paid up.'
                    : 'No invoices yet.'}
              </div>
            )}
            {!loading && visibleRows.map((tr) => {
              const r = tr.original
              const bucket = ageBucket(r.ageDays)
              return (
                <div
                  key={r.job.id}
                  className="fh-build-table__row is-invoices is-clickable"
                  role="button"
                  tabIndex={0}
                  onClick={() => onOpenJob(r.job.id)}
                  onKeyDown={(e) => { if (e.key === 'Enter') onOpenJob(r.job.id) }}
                >
                  <div className="fh-build-inv-name">
                    <strong className="fh-build-truncate" title={r.job.name || 'Untitled'}>
                      {r.job.name || 'Untitled'}
                    </strong>
                    {(r.job.job_title || r.job.job_type) && (
                      <span className="fh-build-truncate fh-build-rel">
                        {r.job.job_title || r.job.job_type}
                      </span>
                    )}
                  </div>
                  <span className={`fh-build-dot is-${bucket.tone}`}>{bucket.label}</span>
                  <span className="fh-build-num fh-build-rel">{r.ageDays}d</span>
                  <span className="fh-build-num">{moneyFull(r.amount)}</span>
                  <span className="fh-build-num fh-build-rel">{r.paid > 0 ? moneyFull(r.paid) : '\u2003'}</span>
                  <span
                    className="fh-build-num"
                    style={{ color: r.balance > 0 ? 'var(--v3-primary, #c9963a)' : 'var(--v3-success-bright)', fontWeight: 700 }}
                  >
                    {r.balance > 0 ? moneyFull(r.balance) : 'Paid'}
                  </span>
                  <span className="fh-build-inv-actions">
                    {r.balance > 0.5 && (
                      <button
                        type="button"
                        className="fh-build-row-btn"
                        onClick={(e) => { e.stopPropagation(); onPayRow(r) }}
                      >
                        Log payment
                      </button>
                    )}
                    <ChevronRight size={13} />
                  </span>
                </div>
              )
            })}

            {!loading && viewRows.length > 80 && (
              <div className="fh-build-table__more">
                Showing first 80 of {viewRows.length.toLocaleString()}. Use the filter to narrow, or Export CSV for the full set.
              </div>
            )}
          </section>

          <aside className="fh-build-rail fh-build-rail--page">
            {filter === 'outstanding' && clientAR.length > 0 && (
              <section className="fh-build-rail-card">
                <div className="fh-build-eyebrow">Who owes you</div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginTop: 8 }}>
                  {clientAR.slice(0, 6).map((g) => {
                    const tone = AR_TONE[g.worst] || 'good'
                    return (
                      <div key={g.clientId} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <button
                          type="button"
                          onClick={() => onOpenClient?.(g.clientId)}
                          title={g.client.company_name || g.client.name || 'Client'}
                          style={{ flex: 1, minWidth: 0, textAlign: 'left', background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'inherit' }}
                        >
                          <div className="fh-build-truncate" style={{ fontWeight: 700, fontSize: 14 }}>
                            {g.client.company_name || g.client.name || 'Client'}
                          </div>
                          <div style={{ fontSize: 12, opacity: 0.7, display: 'flex', gap: 8, alignItems: 'center' }}>
                            <span className={`fh-build-dot is-${tone}`} style={{ padding: '0 8px', fontSize: 12 }}>{AR_LABEL[g.worst]}</span>
                            <span>{g.jobs.length} {g.jobs.length === 1 ? 'property' : 'properties'}</span>
                          </div>
                        </button>
                        <span style={{ fontWeight: 800, fontSize: 14, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{money(g.total)}</span>
                        {onStatement && (
                          <button
                            type="button"
                            onClick={() => onStatement(g)}
                            aria-label="Statement"
                            title="Account statement"
                            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '4px 8px', borderRadius: 10, background: 'var(--v3-glass-tint-2)', border: '1px solid var(--v3-border-mid)', color: 'inherit', cursor: 'pointer', fontSize: 12, fontWeight: 700 }}
                          >
                            <Receipt size={12} />
                          </button>
                        )}
                      </div>
                    )
                  })}
                </div>
              </section>
            )}

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Outstanding total</div>
              <strong>{moneyFull(totals.total)}</strong>
              <span>{totals.count} open balances</span>
              <div className="fh-build-spark is-gold" />
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Overdue 60+ d</div>
              <strong style={{ color: overdueCount > 0 ? 'var(--v3-danger-bright)' : undefined }}>
                {moneyFull(totals['60+'])}
              </strong>
              <span>{overdueCount} {overdueCount === 1 ? 'invoice' : 'invoices'}</span>
              {overdueCount > 0 && <div className="fh-build-spark is-red" />}
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Collectable this week</div>
              <strong>{collectableThisWeek}</strong>
              <span>≤ 14 days aged</span>
            </section>

            <section className="fh-build-rail-card">
              <div className="fh-build-eyebrow">Late 31 to 60 d</div>
              <strong>{moneyFull(totals['31-60'] ?? 0)}</strong>
              <span>{(totals['31-60'] ?? 0) > 0 ? 'Send reminder' : 'Clear'}</span>
            </section>
          </aside>
        </section>
      </main>
    </div>
  )
}
