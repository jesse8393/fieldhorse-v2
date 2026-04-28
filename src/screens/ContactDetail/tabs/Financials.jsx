import StubTab from './_StubTab.jsx'

/**
 * FINANCIALS tab — sub-tab router.
 *
 * Sub-sections (to be built in Drop 3.2):
 *   - Subs (fh_subs CRUD + recalcCost)
 *   - Expenses (fh_expenses CRUD + recalcCost)
 *   - Invoice/Payments (fh_payments + balance + PaymentModal trigger)
 */
export default function FinancialsTab(props) {
  return <StubTab name="Financials" upcoming={['Subs', 'Expenses', 'Invoice / Payments']} />
}
