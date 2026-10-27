import SubsSection from '../sections/Subs.tsx'
import ExpensesSection from '../sections/Expenses.tsx'
import JobMoney from '../../jobs/JobMoney.tsx'
import InvoiceDrawsSection from '../sections/InvoiceDrawsSection.tsx'

export default function FinancialsTab({
  section = 'financials',
  contact,
  subs,
  expenses,
  payments,
  userId,
  fetchAll,
  onOpenLogPayment,
  insurance,
  changeOrders,
  canSeeMoney = false
}: any) {
  const sub = !canSeeMoney ? 'expenses' : section === 'financials' ? 'invoice' : section
  return (
    <div>
      <div className="v3-section" style={{ margin: '12px var(--v3-gutter) 24px' }}>
        {sub === 'subs' && (
          <SubsSection contact={contact} subs={subs} userId={userId} fetchAll={fetchAll} />
        )}
        {sub === 'expenses' && (
          <ExpensesSection contact={contact} expenses={expenses} userId={userId} fetchAll={fetchAll} />
        )}
        {sub === 'invoice' && (
          <JobMoney id={contact.id} onOpenLogPayment={onOpenLogPayment} onChanged={fetchAll} />
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
