import { useMemo, useState } from 'react'
import { SegmentedTabs } from '../../../components/v3'
import SubsSection from '../sections/Subs.tsx'
import ExpensesSection from '../sections/Expenses.tsx'
import InvoiceSection from '../sections/Invoice.tsx'
import InvoiceDrawsSection from '../sections/InvoiceDrawsSection.tsx'

/**
 * FINANCIALS tab, sub-tab router for cost + revenue surfaces.
 *
 * Sub-tabs: Subs · Expenses · Invoice
 *
 * Default sub is 'invoice' if there's a balance due (most-actionable signal),
 * otherwise 'subs' (most-frequently-managed).
 *
 * Field roles (canSeeMoney false) get Expenses only: they log receipts
 * from the field, while subs (vendor costs), invoices, payments and draws
 * belong to the money roles and the database hides most of them anyway.
 */
const SUB_TABS = [
  { id: 'subs',     label: 'Subs' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'invoice',  label: 'Invoice' },
  { id: 'draws',    label: 'Draws' }
]

export default function FinancialsTab({
  contact,
  subs,
  expenses,
  payments,
  paid,
  balance,
  userId,
  fetchAll,
  onOpenLogPayment,
  insurance,
  changeOrders,
  canSeeMoney = false
}: any) {
  // Default sub = invoice when there's money owed; otherwise subs.
  const defaultSub = !canSeeMoney ? 'expenses' : balance > 0.5 ? 'invoice' : 'subs'
  const [chosenSub, setSub] = useState(defaultSub)
  // A role change while mounted (membership resolving) falls back to
  // Expenses rather than rendering a money sub tab.
  const sub = canSeeMoney ? chosenSub : 'expenses'

  // No count badge on the Invoice tab, it used to show payments.length,
  // so four recorded payments rendered "Invoice · 4" implying four
  // invoices existed.
  const subTabsWithCounts = useMemo(() => SUB_TABS
    .filter((t) => canSeeMoney || t.id === 'expenses')
    .map((t) => {
      if (t.id === 'subs')     return subs.length     > 0 ? { ...t, count: subs.length }     : t
      if (t.id === 'expenses') return expenses.length > 0 ? { ...t, count: expenses.length } : t
      return t
    }), [subs, expenses, canSeeMoney])

  return (
    <div>
      {subTabsWithCounts.length > 1 && (
        <div style={{ paddingTop: 12 }}>
          <SegmentedTabs
            value={sub}
            onChange={setSub}
            tabs={subTabsWithCounts}
            variant="pill"
            ariaLabel="Financials sub-tabs"
          />
        </div>
      )}

      <div className="v3-section" style={{ margin: '12px var(--v3-gutter) 24px' }}>
        {sub === 'subs' && (
          <SubsSection contact={contact} subs={subs} userId={userId} fetchAll={fetchAll} />
        )}
        {sub === 'expenses' && (
          <ExpensesSection contact={contact} expenses={expenses} userId={userId} fetchAll={fetchAll} />
        )}
        {sub === 'invoice' && (
          <InvoiceSection
            contact={contact}
            payments={payments}
            paid={paid}
            balance={balance}
            onOpenLogPayment={onOpenLogPayment}
            userId={userId}
            fetchAll={fetchAll}
          />
        )}
        {sub === 'draws' && (
          <InvoiceDrawsSection
            contact={contact}
            payments={payments}
            changeOrders={changeOrders}
            insurance={insurance}
            userId={userId}
          />
        )}
      </div>
    </div>
  )
}
