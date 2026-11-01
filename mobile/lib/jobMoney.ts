type AmountRow = { amount?: number | string | null }
type StatusAmount = AmountRow & { status?: string | null }

const cents = (amount: number | string | null | undefined) => Math.round(Number(amount || 0) * 100)
const sum = (rows: readonly AmountRow[]) => rows.reduce((total, row) => total + cents(row.amount), 0)

export function jobMoney(input: {
  amount?: number | string | null
  payments?: readonly AmountRow[]
  expenses?: readonly AmountRow[]
  changeOrders?: readonly StatusAmount[]
  invoices?: readonly StatusAmount[]
}) {
  const amount = cents(input.amount)
  const paid = sum(input.payments || [])
  const approvedCO = sum((input.changeOrders || []).filter(row => row.status === 'approved'))
  const contractTotal = amount + approvedCO
  return {
    amount: amount / 100,
    approvedCO: approvedCO / 100,
    contractTotal: contractTotal / 100,
    paid: paid / 100,
    balance: Math.max(0, contractTotal - paid) / 100,
    spent: sum(input.expenses || []) / 100,
    invoiced: sum((input.invoices || []).filter(row => row.status !== 'void')) / 100,
  }
}
