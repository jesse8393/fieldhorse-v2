// Money on a phone (spec 9.7, decision D6, render glamor/g-money.jpg).
// Below 900 px Invoices.tsx renders this in place of the old cockpit and
// cards: a condensed "Money" title with a Reports link, a vault card with
// what came in this week, then hairline groups on plaster: Overdue (each
// with a mini Remind), Due soon, Waiting on approval and Paid. A tap on an
// invoice row opens the invoice's own screen, /invoices/:id, where Send,
// PDF, Collect payment and Void live; Remind opens /invoices/:id/remind
// (Phase 9, decisions D57 and D62). There is no gold action here and no
// sheet: every action is a screen.
//
// Everything the old phone view offered stays one tap away. The links at
// the bottom open Who owes you (statements), All invoices (drafts, due
// later, paid and void, with the Outstanding and All choice) and Job
// balances (the aging summary and each job's balance, each opening the
// job's money tab). A new invoice starts at /invoices/new.
//
// The numbers come from buildMoneyView (lib/moneyView.ts), read against
// the clock Invoices.tsx passes down (`now`, from useNow), so the week,
// "Due today" and the month label roll over while the screen stays open.

import { useMemo } from 'react'
import { buildMoneyReconciliation } from '../../lib/moneyReconciliation.ts'
import { ReconciliationLinks, ReconciliationPanel } from './Reconciliation.tsx'
import { Link } from 'react-router-dom'
import { ChevronRight, Receipt } from 'lucide-react'
import { Button, Chip, EmptyState, Row, Skeleton, SkeletonRows, VaultCard, formatMoney } from '../../components/fh'
import Monogram from '../../components/fh/Monogram.tsx'
import { useProfile } from '../../contexts/ProfileContext.tsx'
import { useAuth } from '../../contexts/AuthContext.tsx'
import DataErrorState from '../../components/DataErrorState.tsx'
import { useActiveCompany, useQuotes } from '../../lib/queries.ts'
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
  /** The Overdue group: each row carries Remind, which opens the remind screen. */
  remind?: boolean
}

function Group({ id, title, note, rows, remind = false }: GroupProps) {
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
          const invoiceId = r.invoiceId
          const action = remind && invoiceId ? (
            <Button
              variant="secondary"
              size="mini"
              aria-label={`Remind ${r.title}`}
              to={`/invoices/${invoiceId}/remind`}
              onClick={() => hapticTap()}
            >
              Remind
            </Button>
          ) : undefined
          return invoiceId ? (
            <Row
              key={r.id}
              as="li"
              to={`/invoices/${invoiceId}`}
              onClick={() => hapticTap()}
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
  jobBalances,
  totals,
  clientAR,
  collectionPace,
  filter,
  onFilterChange,
  now,
  onStatement
}: MoneyPhoneProps) {
  const { profile } = useProfile()
  const { user } = useAuth()
  const company = useActiveCompany()
  const quotesQuery = useQuotes(user?.id)
  const { panel, titleRef, panelHref, openPanel, closePanel } = useMoneyPanel()

  const waiting = loading || quotesQuery.isPending || !company
  const view = useMemo(
    () => (bundle ? buildMoneyView({ bundle, quotes: quotesQuery.data ?? [], company, now }) : null),
    [bundle, quotesQuery.data, company, now]
  )
  const invoiceList = useMemo(() => (bundle ? buildInvoiceList({ bundle, now }) : []), [bundle, now])
  const reconciliation = useMemo(() => bundle ? buildMoneyReconciliation(bundle, jobBalances, now) : [], [bundle, jobBalances, now])
  const openInvoiceCount = useMemo(
    () => invoiceList.filter((r) => r.status === 'draft' || r.status === 'sent' || r.status === 'overdue').length,
    [invoiceList]
  )

  if (panel) {
    return (
      <>
        <PanelShell title={PANEL_TITLES[panel]} onBack={closePanel}>
          {loading || !bundle ? (
            // Opened by its URL before the bundle arrived, or before it was
            // even asked for while the company is unknown: no empty list
            // and no $0.00 total stands in for it.
            <div className="fhm-state">
              <SkeletonRows rows={6} label="Loading money" />
            </div>
          ) : (
            <>
              {panel === 'reconciliation' && <ReconciliationPanel groups={reconciliation} />}
              {panel === 'statements' && <StatementsPanel groups={clientAR} onStatement={onStatement} />}
              {panel === 'invoices' && (
                <InvoicesPanel
                  rows={invoiceList}
                  filter={filter}
                  onFilterChange={onFilterChange}
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
            </>
          )}
        </PanelShell>
      </>
    )
  }

  const month = now.toLocaleDateString('en-US', { month: 'long' })
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
            tone="paper"
            label="Collected this week"
            amount={view.collectedThisWeek}
            facts={[
              { label: 'Due this week', value: view.dueThisWeek },
              { label: `${month} so far`, value: view.monthToDate },
              { label: 'Tracked margin', value: view.marginPct == null ? 'None yet' : `${view.marginPct.toFixed(1)}%` }
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
          <p className="fhm-quiet">{view.marginNote}. Untracked costs excluded.</p>
          <ReconciliationLinks groups={reconciliation} />
          {view.overdue.length > 0 && (
            <Group
              id="overdue"
              title="Overdue"
              note={countLine(view.overdue.length)}
              rows={view.overdue}
              remind
            />
          )}
          {view.dueSoon.length > 0 && (
            <Group
              id="due-soon"
              title="Due soon"
              note={countLine(view.dueSoon.length)}
              rows={view.dueSoon}
            />
          )}
          {!hasDue && openInvoiceCount === 0 && (
            <div className="fhm-state">
              <EmptyState
                icon={Receipt}
                title="No open invoices"
                action={
                  <Button variant="secondary" size="md" to="/invoices/new" onClick={() => hapticTap()}>
                    Create an invoice
                  </Button>
                }
              />
            </div>
          )}
          {!hasDue && openInvoiceCount > 0 && (
            <p className="fhm-quiet">Nothing is due in the next 7 days. The rest are in All invoices below.</p>
          )}
          {quotesQuery.isError && <DataErrorState title="Could not load quotes waiting on approval" actionLabel="Try again" onRetry={() => { void quotesQuery.refetch() }} />}
          {view.waiting.length > 0 && (
            <Group
              id="waiting"
              title="Waiting on approval"
              note={formatMoney(view.waiting.reduce((sum, r) => sum + r.amount, 0))}
              rows={view.waiting}
            />
          )}
          {view.paid.length > 0 && (
            <Group id="paid" title="Paid" note="Last 10 days" rows={view.paid} />
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
    </div>
  )
}

