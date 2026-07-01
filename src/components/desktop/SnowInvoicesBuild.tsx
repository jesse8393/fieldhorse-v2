// SnowInvoicesBuild — desktop /invoices in the Build direction.
//
// Drop-in for SnowInvoices at >=900px. Same props, same handlers.
// Aging buckets in the hero, full-width invoices table, right rail
// with collection signals. Onyx surface, gold accents.

import { Bell, ChevronRight, Receipt, Search } from 'lucide-react'
import { money, moneyFull } from '../../lib/format.ts'
import MiniMetric from '../MiniMetric.tsx'

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

type Props = {
  rows: Row[]
  filtered: Row[]
  totals: Totals
  loading: boolean
  filter: 'outstanding' | 'all'
  setFilter: (f: 'outstanding' | 'all') => void
  clientAR?: ClientARGroup[]
  onOpenJob: (id: string) => void
  onOpenClient?: (id: string) => void
  onStatement?: (g: ClientARGroup) => void
  onPayRow: (row: Row) => void
}

const AR_TONE: Record<string, 'good' | 'warn' | 'bad'> = { '0-30': 'good', '31-60': 'warn', '60+': 'bad' }
const AR_LABEL: Record<string, string> = { '0-30': 'Current', '31-60': 'Late', '60+': 'Overdue' }

function ageBucket(days: number): { label: string; tone: 'good' | 'warn' | 'bad' } {
  if (days <= 30) return { label: 'Current',  tone: 'good' }
  if (days <= 60) return { label: 'Late',     tone: 'warn' }
  return { label: 'Overdue', tone: 'bad' }
}

export default function SnowInvoicesBuild({
  rows, filtered, totals, loading, filter, setFilter,
  clientAR = [], onOpenJob, onOpenClient, onStatement, onPayRow,
}: Props) {
  const collectableThisWeek = filtered.filter((r) => r.balance > 0 && r.ageDays <= 14).length
  const overdueCount = filtered.filter((r) => r.ageDays > 60 && r.balance > 0).length

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
          <span>{rows.length.toLocaleString()} invoices on the books</span>
          <span className="fh-build-vline" />
          <span style={{ opacity: 0.6 }}>Weather not set</span>
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
            <MiniMetric label="Late 31-60 d"   value={money(totals['31-60'] ?? 0)} tone={(totals['31-60'] ?? 0) > 0 ? 'warn' : undefined} />
            <MiniMetric label="Overdue 60+ d"  value={money(totals['60+'] ?? 0)}  tone={(totals['60+'] ?? 0) > 0 ? 'bad' : undefined} />
          </div>
        </section>

        <section className="fh-build-content-grid fh-build-content-grid--invoices">
          <section className="fh-build-card fh-build-table fh-build-invoices-table">
            <header className="fh-build-card-head">
              <div className="fh-build-eyebrow">
                {filter === 'outstanding' ? 'Outstanding invoices' : 'All invoices'} · {filtered.length.toLocaleString()}
              </div>
              <button type="button">Export CSV</button>
            </header>

            <div className="fh-build-table__head is-invoices">
              <span>Client / Job</span>
              <span>Status</span>
              <span>Age</span>
              <span>Contract</span>
              <span>Paid</span>
              <span>Balance</span>
              <span />
            </div>

            {loading && (
              <div className="fh-build-table__empty">Loading invoices…</div>
            )}
            {!loading && filtered.length === 0 && (
              <div className="fh-build-table__empty">
                {filter === 'outstanding'
                  ? 'Nothing outstanding. You’re paid up.'
                  : 'No invoices yet.'}
              </div>
            )}
            {!loading && filtered.slice(0, 80).map((r) => {
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
                  <span className="fh-build-num fh-build-rel">{r.paid > 0 ? moneyFull(r.paid) : '—'}</span>
                  <span
                    className="fh-build-num"
                    style={{ color: r.balance > 0 ? 'var(--v3-primary, #c9963a)' : '#73c982', fontWeight: 700 }}
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

            {!loading && filtered.length > 80 && (
              <div className="fh-build-table__more">
                Showing first 80 of {filtered.length.toLocaleString()}.
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
                          <div className="fh-build-truncate" style={{ fontWeight: 700, fontSize: 13 }}>
                            {g.client.company_name || g.client.name || 'Client'}
                          </div>
                          <div style={{ fontSize: 11, opacity: 0.7, display: 'flex', gap: 6, alignItems: 'center' }}>
                            <span className={`fh-build-dot is-${tone}`} style={{ padding: '0 6px', fontSize: 9 }}>{AR_LABEL[g.worst]}</span>
                            <span>{g.jobs.length} {g.jobs.length === 1 ? 'property' : 'properties'}</span>
                          </div>
                        </button>
                        <span style={{ fontWeight: 800, fontSize: 13, fontVariantNumeric: 'tabular-nums', whiteSpace: 'nowrap' }}>{money(g.total)}</span>
                        {onStatement && (
                          <button
                            type="button"
                            onClick={() => onStatement(g)}
                            aria-label="Statement"
                            title="Account statement"
                            style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 4, padding: '5px 9px', borderRadius: 8, background: 'rgba(255,255,255,0.05)', border: '1px solid rgba(255,255,255,0.12)', color: 'inherit', cursor: 'pointer', fontSize: 11, fontWeight: 700 }}
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
              <strong style={{ color: overdueCount > 0 ? '#ee4942' : undefined }}>
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
              <div className="fh-build-eyebrow">Late 31-60 d</div>
              <strong>{moneyFull(totals['31-60'] ?? 0)}</strong>
              <span>{(totals['31-60'] ?? 0) > 0 ? 'Send reminder' : 'Clear'}</span>
            </section>
          </aside>
        </section>
      </main>
    </div>
  )
}

