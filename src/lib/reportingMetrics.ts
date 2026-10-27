import { parseDateOnly } from './dates.ts'

type Invoice = { status?: string | null; amount?: number | string | null; issued_at?: string | null; created_at?: string | null }
type Payment = { amount?: number | string | null; paid_on?: string | null; created_at?: string | null }
const ISSUED = new Set(['sent', 'viewed', 'overdue', 'paid'])

/** A reporting period can end in the future; receipts stop at today's end. */
export function paymentsReceivedInPeriod(payments: Payment[], start: Date, end: Date, now = new Date()) {
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const cutoff = end < tomorrow ? end : tomorrow
  return payments.reduce((sum, payment) => {
    const when = parseDateOnly(payment.paid_on || payment.created_at)
    const amount = Number(payment.amount)
    return when && when >= start && when < cutoff && Number.isFinite(amount) ? sum + amount : sum
  }, 0)
}

/** Invoice face amounts and received payments have independent date bases. */
export function financialYearSummary(invoices: Invoice[], payments: Payment[], now = new Date()) {
  const start = new Date(now.getFullYear(), 0, 1)
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1)
  const inYear = (raw: string | null | undefined) => {
    const date = parseDateOnly(raw)
    return date != null && date >= start && date < tomorrow
  }
  const amount = (value: unknown) => Number.isFinite(Number(value)) ? Number(value) : 0
  const issued = invoices.reduce((sum, invoice) => {
    if (!ISSUED.has(String(invoice.status).toLowerCase()) || !inYear(invoice.issued_at || invoice.created_at)) return sum
    return sum + amount(invoice.amount)
  }, 0)
  const received = paymentsReceivedInPeriod(payments, start, tomorrow, now)
  return { issued, received }
}

export type RevenueMonth = { label?: string; month?: string; period?: string; partial?: boolean; value?: number; amount?: number; total?: number }
export const revenueMonthValue = (row: RevenueMonth) => Number(row.value ?? row.amount ?? row.total ?? 0)

export function completedMonthComparison(months: RevenueMonth[]) {
  const complete = months.filter((m) => !m.partial)
  const latest = complete.at(-1)
  const previous = complete.at(-2)
  if (!latest || !previous) return { amount: null, label: 'Not enough complete months' }
  return {
    amount: revenueMonthValue(latest) - revenueMonthValue(previous),
    label: `${latest.period || latest.label || latest.month} versus ${previous.period || previous.label || previous.month}`
  }
}
