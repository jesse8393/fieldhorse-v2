import { useEffect, useId, useRef } from 'react'
import { Link } from 'react-router-dom'
import type { ReactNode } from 'react'
import { ArrowLeft, Check, Receipt } from 'lucide-react'
import { Button, Chip, EmptyState, IconButton, Row, formatMoney } from '../../components/fh'
import type { ChipTone } from '../../components/fh'
import type { MoneyInvoiceRow } from '../../lib/moneyView.ts'
import { useInfiniteRender } from '../../lib/useInfiniteRender.ts'
import { hapticTap } from '../../lib/haptics.ts'
import type {
  AgingTotals,
  ClientBalanceGroup,
  CollectionPace,
  JobBalanceRow,
  MoneyFilter
} from './types.ts'

// The three lists the old Money screen carried that the four groups leave
// out. Each opens from a quiet link at the bottom of Money as its own page
// (?panel= in the URL, so Back closes it) with a title and a Back button:
//
//   Who owes you   every customer with a balance, and a statement for each
//   All invoices   drafts, invoices due later than a week, paid and void,
//                  with the old Outstanding and All choice; each row opens
//                  the invoice's screen, /invoices/:id (D62)
//   Job balances   contract minus payments per job, with the aging summary
//                  and the month's collection pace; each row opens the
//                  job's money tab

export type MoneyPanel = 'statements' | 'invoices' | 'balances' | 'reconciliation'

export const PANEL_TITLES: Record<MoneyPanel, string> = {
  statements: 'Who owes you',
  invoices: 'All invoices',
  balances: 'Job balances',
  reconciliation: 'Billing reconciliation'
}

export function isMoneyPanel(value: string | null): value is MoneyPanel {
  return value === 'statements' || value === 'invoices' || value === 'balances' || value === 'reconciliation'
}

// The aging buckets and their words. Color never carries it alone.
export const AGING = [
  { id: '0-30', label: 'Up to 30 days', range: 'Reference age', tone: 'neutral' },
  { id: '31-60', label: '31 to 60 days', range: 'Reference age', tone: 'neutral' },
  { id: '60+', label: 'Over 60 days', range: 'Reference age', tone: 'neutral' }
] as const satisfies readonly { id: keyof AgingTotals; label: string; range: string; tone: ChipTone }[]

export function agingLabel(bucket: string): { label: string; tone: ChipTone } {
  const found = AGING.find((b) => b.id === bucket) ?? AGING[0]
  return { label: found.label, tone: found.tone }
}

export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

/* ---------------- Shared pieces ---------------- */

export function PanelShell({ title, onBack, children }: { title: string; onBack: () => void; children: ReactNode }) {
  // A page opened from a link that has just gone: put focus on its heading,
  // the way a route change does, so a screen reader starts at the title.
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => {
    headingRef.current?.focus({ preventScroll: true })
  }, [])
  return (
    <div className="v3-screen fhm">
      <header className="fhm-head fhm-head--panel">
        <IconButton variant="paper" icon={ArrowLeft} size={44} aria-label="Back to Money" onClick={onBack} />
        <h1 className="fhm-title" ref={headingRef} tabIndex={-1}>{title}</h1>
      </header>
      {children}
    </div>
  )
}

const FILTERS: { id: MoneyFilter; label: string }[] = [
  { id: 'outstanding', label: 'Outstanding' },
  { id: 'all', label: 'All' }
]

export function FilterControl({ value, onChange, label }: { value: MoneyFilter; onChange: (next: MoneyFilter) => void; label: string }) {
  const name = useId()
  return (
    <fieldset className="fhm-filter">
      <legend className="fhm-vh">{label}</legend>
      <div className="fhm-seg">
        {FILTERS.map((f) => (
          <label key={f.id} className="fhm-seg__option">
            <input
              type="radio"
              name={name}
              value={f.id}
              checked={value === f.id}
              onChange={() => { hapticTap(); onChange(f.id) }}
            />
            <span className="fhm-seg__face">{f.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  )
}

/* ---------------- Who owes you ---------------- */

export function StatementsPanel({
  groups,
  onStatement
}: {
  groups: ClientBalanceGroup[]
  onStatement: (group: ClientBalanceGroup) => void
}) {
  return (
    <div className="fhm-panel">
      <p className="fhm-panel__intro">
        Customers with remaining contract value, oldest reference dates first. Statements include job balances and payments, including work not yet invoiced.
      </p>
      {groups.length === 0 ? (
        <EmptyState icon={Check} title="Nobody owes you right now." />
      ) : (
        <ul className="fhm-rows">
          {groups.map((g) => {
            const name = g.client.company_name || g.client.name || 'Customer'
            const aging = agingLabel(g.worst)
            return (
              <Row
                key={g.clientId}
                as="li"
                to={`/clients/${g.clientId}`}
                title={name}
                subline={plural(g.jobs.length, 'property', 'properties')}
                money={g.total}
                next={<Chip label={aging.label} tone={aging.tone} />}
                action={
                  <Button
                    variant="secondary"
                    size="mini"
                    aria-label={`Statement for ${name}`}
                    onClick={() => { hapticTap(); onStatement(g) }}
                  >
                    Statement
                  </Button>
                }
              />
            )
          })}
        </ul>
      )}
    </div>
  )
}

/* ---------------- All invoices ---------------- */

function invoiceRowEnd(row: MoneyInvoiceRow): ReactNode {
  return (
    <>
      {row.chip && <Chip label={row.chip.label} tone={row.chip.tone} />}
      {row.note && <span className="fhc-row__next">{row.note}</span>}
    </>
  )
}

export function InvoicesPanel({
  rows,
  filter,
  onFilterChange
}: {
  rows: MoneyInvoiceRow[]
  filter: MoneyFilter
  onFilterChange: (next: MoneyFilter) => void
}) {
  const shown = filter === 'outstanding'
    ? rows.filter((r) => r.status === 'draft' || r.status === 'sent' || r.status === 'overdue')
    : rows
  // The list can hold years of invoices; mount a window and grow it on scroll.
  const { visible, sentinelRef, hasMore } = useInfiniteRender(shown, filter)

  return (
    <div className="fhm-panel">
      <FilterControl value={filter} onChange={onFilterChange} label="Show invoices" />
      {shown.length === 0 ? (
        <EmptyState
          icon={Receipt}
          title={filter === 'outstanding' ? 'No open invoices.' : 'No invoices yet.'}
        />
      ) : (
        <>
          <p className="fhm-panel__count">{plural(shown.length, 'invoice', 'invoices')}</p>
          <ul className="fhm-rows">
            {visible.map((r) => (
              <Row
                key={r.id}
                as="li"
                to={`/invoices/${r.id}`}
                onClick={() => hapticTap()}
                title={r.title}
                subline={r.subline || undefined}
                money={r.amount}
                next={invoiceRowEnd(r)}
              />
            ))}
            {hasMore && <li ref={sentinelRef as never} aria-hidden="true" style={{ height: 1 }} />}
          </ul>
        </>
      )}
    </div>
  )
}

/* ---------------- Job balances ---------------- */

export function BalancesPanel({
  rows,
  totals,
  pace,
  filter,
  onFilterChange
}: {
  /** Already narrowed by the filter. */
  rows: JobBalanceRow[]
  totals: AgingTotals
  pace: CollectionPace
  filter: MoneyFilter
  onFilterChange: (next: MoneyFilter) => void
}) {
  const { visible, sentinelRef, hasMore } = useInfiniteRender(rows, filter)

  return (
    <div className="fhm-panel">
      <section className="fhm-aging" aria-label="Contract balances by reference age">
        <p className="fhm-aging__label">Remaining contract value</p>
        <p className="fhm-aging__total">{formatMoney(totals.total)}</p>
        <p className="fhm-panel__intro">Contract value less payments, including unbilled work. Reference age uses the oldest open invoice date, otherwise the job creation date. Overdue invoices appear separately on Money.</p>
        <dl className="fhm-aging__facts">
          {AGING.map((b) => (
            <div key={b.id} className="fhm-aging__fact">
              <dt>{b.label}</dt>
              <dd><Link to={`/invoices?panel=reconciliation&bucket=${encodeURIComponent(b.id)}`}>{formatMoney(totals[b.id])}</Link></dd>
              <dd className="fhm-aging__range">{b.range}</dd>
            </div>
          ))}
        </dl>
        {pace.monthCollected > 0 && (
          <p className="fhm-aging__pace">
            {`${formatMoney(pace.monthCollected)} collected this month`}
            {pace.deltaPct !== null && pace.deltaPct !== 0 &&
              `, ${Math.abs(pace.deltaPct)} percent ${pace.deltaPct > 0 ? 'above' : 'below'} your average of the three months before`}
          </p>
        )}
      </section>

      <FilterControl value={filter} onChange={onFilterChange} label="Show jobs" />

      {rows.length === 0 ? (
        <EmptyState
          icon={Check}
          title={filter === 'outstanding' ? 'Nothing outstanding. Every active job is paid in full.' : 'No money jobs yet.'}
        />
      ) : (
        <>
          <p className="fhm-panel__count">{plural(rows.length, 'job', 'jobs')}</p>
          <ul className="fhm-rows">
            {visible.map((r) => {
              const aging = agingLabel(r.bucket)
              return (
                <Row
                  key={r.job.id}
                  as="li"
                  to={`/jobs/${r.job.id}?tab=financials`}
                  title={r.job.name || 'Unnamed job'}
                  subline={r.job.job_title || undefined}
                  money={r.balance > 0 ? r.balance : 'Paid'}
                  // A bill not yet due has an age of zero or less: just "Current".
                  next={r.isOutstanding
                    ? <Chip label={r.ageDays > 0 ? `${aging.label}, ${plural(r.ageDays, 'day', 'days')}` : aging.label} tone={aging.tone} />
                    : null}
                />
              )
            })}
            {hasMore && <li ref={sentinelRef as never} aria-hidden="true" style={{ height: 1 }} />}
          </ul>
        </>
      )}
    </div>
  )
}
