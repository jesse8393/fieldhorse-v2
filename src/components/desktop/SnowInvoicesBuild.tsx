// SnowInvoicesBuild, desktop /invoices (spec 9.7, plan task 4.6).
//
// The entry for Money at 900 px and wider. Same numbers and same sheets as
// the phone (screens/money/): a vault card with what came in this week,
// then the four groups as tables, Overdue (each with Remind), Due soon,
// Waiting on approval and Paid, with the columns Customer, Job, Amount,
// Status and Action. A click on a row opens the invoice's actions or the
// job, as on the phone.
//
// The old desktop page kept its aging summary, the Outstanding and All
// filter, who owes you with statements, per job balances with Log payment,
// sort, filter and Export CSV, and a send, PDF, mark paid and void button
// on every invoice. They stay: the aging summary sits beside the vault
// card, and the three lists open as pages at ?panel= (decision D16), as
// tables here. Per invoice Send, PDF, Mark paid and Void are in the invoice
// sheet. There is no gold action on the page; the one brushed gold button
// is "Send reminder" inside the Remind sheet, as on the phone.
//
// The numbers come from buildMoneyView (lib/moneyView.ts). The handlers
// that send, download, void and record payments are Invoices.tsx's own.

import { useMemo } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { ChevronRight, Plus, Receipt } from 'lucide-react'
import { ArrowLeft } from 'lucide-react'
import { Button, EmptyState, IconButton, Skeleton, SkeletonRows, VaultCard, formatMoney } from '../fh'
import Monogram from '../fh/Monogram.tsx'
import { useProfile } from '../../contexts/ProfileContext.tsx'
import { useJobs } from '../../lib/queries.ts'
import { buildInvoiceList, buildMoneyView } from '../../lib/moneyView.ts'
import { PANEL_TITLES, plural } from '../../screens/money/MoneyPanels.tsx'
import { useMoneyPanel } from '../../screens/money/useMoneyPanel.ts'
import { useMoneySheets } from '../../screens/money/useMoneySheets.tsx'
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
  invoiceRows,
  jobBalances,
  totals,
  clientAR,
  collectionPace,
  filter,
  onFilterChange,
  sendingId,
  onSendInvoice,
  onDownloadInvoice,
  onPayInvoice,
  onVoidInvoice,
  onStatement,
  onRefresh,
  onPayRow
}: SnowInvoicesBuildProps) {
  const { profile } = useProfile()
  const navigate = useNavigate()
  const jobsQuery = useJobs()
  const { panel, titleRef, panelHref, openPanel, closePanel } = useMoneyPanel()

  const waiting = loading || jobsQuery.isLoading
  const view = useMemo(
    () => (bundle ? buildMoneyView({ bundle, quotes: jobsQuery.data ?? [], now: new Date() }) : null),
    [bundle, jobsQuery.data]
  )
  const invoiceList = useMemo(() => (bundle ? buildInvoiceList({ bundle, now: new Date() }) : []), [bundle])
  const openInvoiceCount = useMemo(
    () => invoiceList.filter((r) => r.status === 'draft' || r.status === 'sent' || r.status === 'overdue').length,
    [invoiceList]
  )

  const { openActions, openRemind, openPicker, sheets } = useMoneySheets({
    bundle,
    invoiceRows,
    invoiceList,
    sendingId,
    onSendInvoice,
    onDownloadInvoice,
    onPayInvoice,
    onVoidInvoice,
    onRefresh
  })

  const openJob = (to: string) => navigate(to)
  const month = new Date().toLocaleDateString('en-US', { month: 'long' })
  const hasDue = view ? view.overdue.length + view.dueSoon.length > 0 : false
  const countLine = (n: number) => plural(n, 'invoice', 'invoices')

  if (panel) {
    return (
      <div className="fhmd fh-build-page" data-build-screen="SnowInvoicesBuild">
        <header className="fhmd-toolbar fhmd-toolbar--panel">
          <IconButton variant="paper" icon={ArrowLeft} size={48} shape="square" aria-label="Back to Money" onClick={closePanel} />
          <h1 className="fhmd-title" ref={titleRef} tabIndex={-1}>{PANEL_TITLES[panel]}</h1>
        </header>
        <main className="fhmd-main">
          {panel === 'statements' && <StatementsTable groups={clientAR} onStatement={onStatement} />}
          {panel === 'invoices' && (
            <InvoicesTable rows={invoiceList} filter={filter} onFilterChange={onFilterChange} onOpenInvoice={openActions} />
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
        </main>
        {sheets}
      </div>
    )
  }

  return (
    <div className="fhmd fh-build-page" data-build-screen="SnowInvoicesBuild">
      <header className="fhmd-toolbar">
        <h1 className="fhmd-title" ref={titleRef} tabIndex={-1}>Money</h1>
        <div className="fhmd-toolbar__actions">
          <Button variant="quiet" size="md" to="/analytics">Reports</Button>
          <Button variant="secondary" size="md" icon={Plus} onClick={openPicker}>New invoice</Button>
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
          <AgingSummary totals={totals} />
        </div>

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
                onOpenInvoice={openActions}
                onOpenJob={openJob}
                onRemind={openRemind}
              />
            )}
            {view.dueSoon.length > 0 && (
              <GroupTable
                id="due-soon"
                title="Due soon"
                note={countLine(view.dueSoon.length)}
                rows={view.dueSoon}
                onOpenInvoice={openActions}
                onOpenJob={openJob}
              />
            )}
            {!hasDue && openInvoiceCount === 0 && (
              <div className="fhmd-state">
                <EmptyState
                  icon={Receipt}
                  title="No open invoices"
                  action={<Button variant="secondary" size="md" onClick={openPicker}>Create an invoice</Button>}
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
                onOpenInvoice={openActions}
                onOpenJob={openJob}
              />
            )}
            {view.paid.length > 0 && (
              <GroupTable
                id="paid"
                title="Paid"
                note="Last 10 days"
                rows={view.paid}
                onOpenInvoice={openActions}
                onOpenJob={openJob}
              />
            )}
          </>
        )}
      </main>
      {sheets}
    </div>
  )
}
