// Money on a phone (spec 9.7, decision D6, render glamor/g-money.jpg).
// Below 900 px Invoices.tsx renders this in place of the old cockpit and
// cards: a condensed "Money" title with a Reports link, a vault card with
// what came in this week, then hairline groups on plaster: Overdue (each
// with a mini Remind), Due soon, Waiting on approval and Paid. A tap on an
// invoice row opens its actions in a sheet. There is no gold action here;
// the one brushed gold button is "Send reminder" inside the Remind sheet.
//
// Everything the old phone view offered stays one tap away. The links at
// the bottom open Who owes you (statements), All invoices (drafts, due
// later, paid and void, with the Outstanding and All choice) and Job
// balances (the aging summary and each job's balance). Per job Email,
// Download and Mark paid live on the job's invoice page, /invoices/:id,
// which Job balances links to.
//
// The numbers come from buildMoneyView (lib/moneyView.ts). The handlers
// that send, download, void and record payments are Invoices.tsx's own and
// arrive as props, so the phone and the desktop table share one code path.

import { useMemo } from 'react'
import { Link } from 'react-router-dom'
import { ChevronRight, Receipt } from 'lucide-react'
import { Button, Chip, EmptyState, Row, Skeleton, SkeletonRows, VaultCard, formatMoney } from '../../components/fh'
import Monogram from '../../components/fh/Monogram.tsx'
import { useProfile } from '../../contexts/ProfileContext.tsx'
import { useJobs } from '../../lib/queries.ts'
import { buildInvoiceList, buildMoneyView, type MoneyRow } from '../../lib/moneyView.ts'
import { hapticTap } from '../../lib/haptics.ts'
import {
  BalancesPanel,
  InvoicesPanel,
  PANEL_TITLES,
  PanelShell,
  StatementsPanel
} from './MoneyPanels.tsx'
import { useMoneyPanel } from './useMoneyPanel.ts'
import { useMoneySheets } from './useMoneySheets.tsx'
import type { MoneyScreenProps } from './types.ts'
import './money.css'

export type MoneyPhoneProps = MoneyScreenProps

function countLine(n: number): string {
  return `${n} ${n === 1 ? 'invoice' : 'invoices'}`
}

type GroupProps = {
  id: string
  title: string
  note: string
  rows: MoneyRow[]
  onOpenInvoice: (invoiceId: string) => void
  onRemind?: (row: MoneyRow) => void
}

function Group({ id, title, note, rows, onOpenInvoice, onRemind }: GroupProps) {
  const headingId = `fhm-group-${id}`
  return (
    <section className="fhm-group" aria-labelledby={headingId}>
      <div className="fhm-group__head">
        <h2 className="fhm-group__title" id={headingId}>{title}</h2>
        <p className="fhm-group__note">{note}</p>
      </div>
      <ul className="fhm-rows">
        {rows.map((r) => {
          // A chip when the row has one (days overdue, Paid Sep 30), else
          // the gray line (Due Oct 15, Sent yesterday).
          const end = r.chip
            ? <Chip label={r.chip.label} tone={r.chip.tone} />
            : r.note ? <span className="fhc-row__next">{r.note}</span> : null
          const action = onRemind ? (
            <Button
              variant="secondary"
              size="mini"
              aria-label={`Remind ${r.title}`}
              onClick={() => { hapticTap(); onRemind(r) }}
            >
              Remind
            </Button>
          ) : undefined
          const invoiceId = r.invoiceId
          return invoiceId ? (
            <Row
              key={r.id}
              as="li"
              onClick={() => { hapticTap(); onOpenInvoice(invoiceId) }}
              title={r.title}
              subline={r.subline || undefined}
              money={r.amount}
              next={end}
              action={action}
            />
          ) : (
            <Row
              key={r.id}
              as="li"
              to={r.to}
              title={r.title}
              subline={r.subline || undefined}
              money={r.amount}
              next={end}
            />
          )
        })}
      </ul>
    </section>
  )
}

export default function MoneyPhone({
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
  onRefresh
}: MoneyPhoneProps) {
  const { profile } = useProfile()
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

  if (panel) {
    return (
      <>
        <PanelShell title={PANEL_TITLES[panel]} onBack={closePanel}>
          {panel === 'statements' && <StatementsPanel groups={clientAR} onStatement={onStatement} />}
          {panel === 'invoices' && (
            <InvoicesPanel
              rows={invoiceList}
              filter={filter}
              onFilterChange={onFilterChange}
              onOpenInvoice={openActions}
            />
          )}
          {panel === 'balances' && (
            <BalancesPanel
              rows={jobBalances}
              totals={totals}
              pace={collectionPace}
              filter={filter}
              onFilterChange={onFilterChange}
            />
          )}
        </PanelShell>
        {sheets}
      </>
    )
  }

  const month = new Date().toLocaleDateString('en-US', { month: 'long' })
  const hasDue = view ? view.overdue.length + view.dueSoon.length > 0 : false

  return (
    <div className="v3-screen fhm">
      <header className="fhm-head">
        <h1 className="fhm-title" ref={titleRef} tabIndex={-1}>Money</h1>
        <Button variant="quiet" size="mini" to="/analytics">Reports</Button>
      </header>

      <div className="fhm-vault">
        {waiting || !view ? (
          <Skeleton shape="block" height={212} className="fhm-vault__skel" />
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

      {waiting || !view ? (
        <div className="fhm-state">
          <SkeletonRows rows={5} label="Loading money" />
        </div>
      ) : (
        <>
          {view.overdue.length > 0 && (
            <Group
              id="overdue"
              title="Overdue"
              note={countLine(view.overdue.length)}
              rows={view.overdue}
              onOpenInvoice={openActions}
              onRemind={openRemind}
            />
          )}
          {view.dueSoon.length > 0 && (
            <Group
              id="due-soon"
              title="Due soon"
              note={countLine(view.dueSoon.length)}
              rows={view.dueSoon}
              onOpenInvoice={openActions}
            />
          )}
          {!hasDue && openInvoiceCount === 0 && (
            <div className="fhm-state">
              <EmptyState
                icon={Receipt}
                title="No open invoices"
                action={
                  <Button variant="secondary" size="md" onClick={() => { hapticTap(); openPicker() }}>
                    Create an invoice
                  </Button>
                }
              />
            </div>
          )}
          {!hasDue && openInvoiceCount > 0 && (
            <p className="fhm-quiet">Nothing is due in the next 7 days. The rest are in All invoices below.</p>
          )}
          {view.waiting.length > 0 && (
            <Group
              id="waiting"
              title="Waiting on approval"
              note={formatMoney(view.waiting.reduce((sum, r) => sum + r.amount, 0))}
              rows={view.waiting}
              onOpenInvoice={openActions}
            />
          )}
          {view.paid.length > 0 && (
            <Group id="paid" title="Paid" note="Last 10 days" rows={view.paid} onOpenInvoice={openActions} />
          )}

          <nav className="fhm-more" aria-label="More on money">
            <Link className="fhm-link" to={panelHref('statements')} onClick={() => { hapticTap(); openPanel() }}>
              <span className="fhm-link__label">Statements</span>
              <span className="fhm-link__value">
                {clientAR.length === 0 ? 'Nobody owes you' : `${clientAR.length} ${clientAR.length === 1 ? 'customer owes' : 'customers owe'} you`}
              </span>
              <ChevronRight className="fhm-link__chevron" size={18} aria-hidden="true" />
            </Link>
            <Link className="fhm-link" to={panelHref('invoices')} onClick={() => { hapticTap(); openPanel() }}>
              <span className="fhm-link__label">All invoices</span>
              <span className="fhm-link__value">{openInvoiceCount} open</span>
              <ChevronRight className="fhm-link__chevron" size={18} aria-hidden="true" />
            </Link>
            <Link className="fhm-link" to={panelHref('balances')} onClick={() => { hapticTap(); openPanel() }}>
              <span className="fhm-link__label">Job balances</span>
              <span className="fhm-link__value">{formatMoney(totals.total)}</span>
              <ChevronRight className="fhm-link__chevron" size={18} aria-hidden="true" />
            </Link>
          </nav>
        </>
      )}

      {sheets}
    </div>
  )
}

