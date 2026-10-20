// SnowInvoicesBuild, desktop /invoices (spec 9.7, plan task 4.6).
//
// The entry for Money at 900 px and wider. Same numbers and same rows as
// the phone (screens/money/): a vault card with what came in this week,
// then the four groups as tables, Overdue (each with Remind), Due soon,
// Waiting on approval and Paid, with the columns Customer, Job, Amount,
// Status and Action. A click on an invoice row opens the invoice's screen,
// /invoices/:id, where Send, PDF, Collect payment and Void live; Remind
// opens /invoices/:id/remind; a quote or payment row opens its job (D57,
// D62). New invoice opens /invoices/new.
//
// The old desktop page kept its aging summary, the Outstanding and All
// filter, who owes you with statements, per job balances with Log payment,
// sort, filter and Export CSV. They stay: the aging summary sits beside the
// vault card, and the three lists open as pages at ?panel= (decision D16),
// as tables here. There is no gold action on the page.
//
// The numbers come from buildMoneyView (lib/moneyView.ts), read against
// the clock Invoices.tsx passes down (`now`, from useNow), so the week,
// "Due today" and the month label roll over while the page stays open.
// Until the bundle arrives, the vault card, the aging summary, the link
// strip and the groups are all skeletons, and so is a page opened by its
// ?panel= link: no $0.00 stands in for money that has not loaded.

import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Plus, Receipt } from 'lucide-react'
import { ArrowLeft } from 'lucide-react'
import { Button, EmptyState, IconButton, Skeleton, SkeletonRows, VaultCard, formatMoney } from '../fh'
import Monogram from '../fh/Monogram.tsx'
import { useProfile } from '../../contexts/ProfileContext.tsx'
import { useCompanyJobs } from '../../lib/queries.ts'
import { buildInvoiceList, buildMoneyView } from '../../lib/moneyView.ts'
import { PANEL_TITLES, plural } from '../../screens/money/MoneyPanels.tsx'
import { useMoneyPanel } from '../../screens/money/useMoneyPanel.ts'
import type { JobBalanceRow, MoneyScreenProps } from '../../screens/money/types.ts'
import GroupTable from './money/GroupTable.tsx'
import { AgingSummary, BalancesTable, InvoicesTable, StatementsTable } from './money/DeskPanels.tsx'
import '../../screens/money/money.css'
import './money/money-desktop.css'

export type SnowInvoicesBuildProps = MoneyScreenProps & {
  /** Log a payment on a job's balance. */
  onPayRow: (row: JobBalanceRow) => void
}

export default function SnowInvoicesBuild({
  bundle,
  loading,
  jobBalances,
  totals,
  clientAR,
  collectionPace,
  filter,
  onFilterChange,
  now,
  onStatement,
  onPayRow
}: SnowInvoicesBuildProps) {
  const { profile } = useProfile()
  const navigate = useNavigate()
  const jobsQuery = useCompanyJobs()
  const { panel, titleRef, panelHref, openPanel, closePanel } = useMoneyPanel()

  const waiting = loading || jobsQuery.isLoading
  const view = useMemo(
    () => (bundle ? buildMoneyView({ bundle, quotes: jobsQuery.data ?? [], now }) : null),
    [bundle, jobsQuery.data, now]
  )
  const invoiceList = useMemo(() => (bundle ? buildInvoiceList({ bundle, now }) : []), [bundle, now])
  const openInvoiceCount = useMemo(
    () => invoiceList.filter((r) => r.status === 'draft' || r.status === 'sent' || r.status === 'overdue').length,
    [invoiceList]
  )

  const openInvoice = (invoiceId: string) => navigate(`/invoices/${invoiceId}`)
  const openJob = (to: string) => navigate(to)
  const month = now.toLocaleDateString('en-US', { month: 'long' })
  const hasDue = view ? view.overdue.length + view.dueSoon.length > 0 : false
  const countLine = (n: number) => plural(n, 'invoice', 'invoices')
  // The aging summary and the link strip wait with the rest: nothing on
  // the page reads $0.00 or "0 open" before the money is here.
  const pending = waiting || !view

  if (panel) {
    return (
      <div className="fhmd fh-build-page" data-build-screen="SnowInvoicesBuild">
        <header className="fhmd-toolbar fhmd-toolbar--panel">
          <IconButton variant="paper" icon={ArrowLeft} size={48} shape="square" aria-label="Back to Money" onClick={closePanel} />
          <h1 className="fhmd-title" ref={titleRef} tabIndex={-1}>{PANEL_TITLES[panel]}</h1>
        </header>
        <main className="fhmd-main">
          {loading || !bundle ? (
            // Opened by its URL before the bundle arrived, or before it was
            // even asked for while the company is unknown: no empty table
            // and no $0.00 total stands in for it.
            <div className="fhmd-state">
              <SkeletonRows rows={6} label="Loading money" />
            </div>
          ) : (
            <>
              {panel === 'statements' && <StatementsTable groups={clientAR} onStatement={onStatement} />}
              {panel === 'invoices' && (
                <InvoicesTable rows={invoiceList} filter={filter} onFilterChange={onFilterChange} onOpenInvoice={openInvoice} />
              )}
              {panel === 'balances' && (
                <BalancesTable
                  rows={jobBalances}
                  totals={totals}
                  pace={collectionPace}
                  filter={filter}
                  onFilterChange={onFilterChange}
                  onPayRow={onPayRow}
                  onOpenJob={(id) => navigate(`/jobs/${id}?tab=financials`)}
                />
              )}
            </>
          )}
        </main>
      </div>
    )
  }

  return (
    <div className="fhmd fh-build-page" data-build-screen="SnowInvoicesBuild">
      <header className="fhmd-toolbar">
        <h1 className="fhmd-title" ref={titleRef} tabIndex={-1}>Money</h1>
        <div className="fhmd-toolbar__actions">
          <Button variant="quiet" size="md" to="/analytics">Reports</Button>
          <Button variant="secondary" size="md" icon={Plus} to="/invoices/new">New invoice</Button>
        </div>
      </header>

      <main className="fhmd-main">
        <div className="fhmd-top">
          <div className="fhmd-vault">
            {waiting || !view ? (
              <Skeleton shape="block" height={222} className="fhmd-vault__skel" />
            ) : (
              <VaultCard
                label="Collected this week"
                amount={view.collectedThisWeek}
                facts={[
                  { label: 'Due this week', value: view.dueThisWeek },
                  { label: `${month} so far`, value: view.monthToDate },
                  { label: 'Margin', value: view.marginPct == null ? 'None yet' : `${view.marginPct.toFixed(1)}%` }
                ]}
                corner={<Monogram name={profile?.company_name} logoUrl={profile?.logo_url} size={32} />}
              />
            )}
          </div>
          {pending ? (
            <Skeleton shape="block" height={222} className="fhmd-aging__skel" />
          ) : (
            <AgingSummary totals={totals} />
          )}
        </div>

        {pending ? (
          <div className="fhmd-more" aria-hidden="true">
            {['statements', 'invoices', 'balances'].map((id) => (
              <div key={id} className="fhmd-link fhmd-link--skel">
                <Skeleton width={104} height={14} />
                <Skeleton width={132} height={12} />
              </div>
            ))}
          </div>
        ) : (
          <nav className="fhmd-more" aria-label="More on money">
            <Link className="fhmd-link" to={panelHref('statements')} onClick={openPanel}>
              <span className="fhmd-link__label">Statements</span>
              <span className="fhmd-link__value">
                {clientAR.length === 0 ? 'Nobody owes you' : `${clientAR.length} ${clientAR.length === 1 ? 'customer owes' : 'customers owe'} you`}
              </span>
              <ChevronRight className="fhmd-link__chevron" size={18} aria-hidden="true" />
            </Link>
            <Link className="fhmd-link" to={panelHref('invoices')} onClick={openPanel}>
              <span className="fhmd-link__label">All invoices</span>
              <span className="fhmd-link__value">{openInvoiceCount} open</span>
              <ChevronRight className="fhmd-link__chevron" size={18} aria-hidden="true" />
            </Link>
            <Link className="fhmd-link" to={panelHref('balances')} onClick={openPanel}>
              <span className="fhmd-link__label">Job balances</span>
              <span className="fhmd-link__value">{plural(totals.count ?? 0, 'job', 'jobs')} with a balance</span>
              <ChevronRight className="fhmd-link__chevron" size={18} aria-hidden="true" />
            </Link>
          </nav>
        )}

        {waiting || !view ? (
          <div className="fhmd-state">
            <SkeletonRows rows={5} label="Loading money" />
          </div>
        ) : (
          <>
            {view.overdue.length > 0 && (
              <GroupTable
                id="overdue"
                title="Overdue"
                note={countLine(view.overdue.length)}
                rows={view.overdue}
                onOpenInvoice={openInvoice}
                onOpenJob={openJob}
                remind
              />
            )}
            {view.dueSoon.length > 0 && (
              <GroupTable
                id="due-soon"
                title="Due soon"
                note={countLine(view.dueSoon.length)}
                rows={view.dueSoon}
                onOpenInvoice={openInvoice}
                onOpenJob={openJob}
              />
            )}
            {!hasDue && openInvoiceCount === 0 && (
              <div className="fhmd-state">
                <EmptyState
                  icon={Receipt}
                  title="No open invoices"
                  action={<Button variant="secondary" size="md" to="/invoices/new">Create an invoice</Button>}
                />
              </div>
            )}
            {!hasDue && openInvoiceCount > 0 && (
              <p className="fhmd-quiet">Nothing is due in the next 7 days. The rest are in All invoices above.</p>
            )}
            {view.waiting.length > 0 && (
              <GroupTable
                id="waiting"
                title="Waiting on approval"
                note={formatMoney(view.waiting.reduce((sum, r) => sum + r.amount, 0))}
                rows={view.waiting}
                onOpenInvoice={openInvoice}
                onOpenJob={openJob}
              />
            )}
            {view.paid.length > 0 && (
              <GroupTable
                id="paid"
                title="Paid"
                note="Last 10 days"
                rows={view.paid}
                onOpenInvoice={openInvoice}
                onOpenJob={openJob}
              />
            )}
          </>
        )}
      </main>
    </div>
  )
}
