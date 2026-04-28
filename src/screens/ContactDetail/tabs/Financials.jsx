import { useMemo, useState } from 'react'
import { SegmentedTabs } from '../../../components/v3'
import SubsSection from '../sections/Subs.jsx'
import ExpensesSection from '../sections/Expenses.jsx'
import InvoiceSection from '../sections/Invoice.jsx'

/**
 * FINANCIALS tab — sub-tab router for cost + revenue surfaces.
 *
 * Sub-tabs: Subs · Expenses · Invoice
 *
 * Default sub is 'invoice' if there's a balance due (most-actionable signal),
 * otherwise 'subs' (most-frequently-managed).
 */
const SUB_TABS = [
  { id: 'subs',     label: 'Subs' },
  { id: 'expenses', label: 'Expenses' },
  { id: 'invoice',  label: 'Invoice' }
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
  onOpenLogPayment
}) {
  // Default sub = invoice when there's money owed; otherwise subs.
  const defaultSub = balance > 0.5 ? 'invoice' : 'subs'
  const [sub, setSub] = useState(defaultSub)

  const subTabsWithCounts = useMemo(() => SUB_TABS.map((t) => {
    if (t.id === 'subs')     return subs.length     > 0 ? { ...t, count: subs.length }     : t
    if (t.id === 'expenses') return expenses.length > 0 ? { ...t, count: expenses.length } : t
    if (t.id === 'invoice')  return payments.length > 0 ? { ...t, count: payments.length } : t
    return t
  }), [subs, expenses, payments])

  return (
    <div>
      <div style={{ paddingTop: 12 }}>
        <SegmentedTabs
          value={sub}
          onChange={setSub}
          tabs={subTabsWithCounts}
          variant="pill"
          ariaLabel="Financials sub-tabs"
        />
      </div>

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
          />
        )}
      </div>
    </div>
  )
}
