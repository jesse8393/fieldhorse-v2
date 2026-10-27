import type { InvoicesBundle } from './queries.ts'
import type { JobBalanceRow } from '../screens/money/types.ts'
import { knownInvoices, classifyInvoice } from './moneyView.ts'
import { amountsDueByInvoice, knownContractTotal } from './invoiceSettlement.ts'
import { invoiceReference } from './invoiceReference.ts'

export type ReconciliationRow = { id: string; title: string; detail: string; amount: number; to: string }
export type ReconciliationGroup = { id: string; label: string; explanation: string; rows: ReconciliationRow[]; total: number }
const cents = (value: number) => Math.round(value * 100)

/** Buckets sum the exact rows they open. Contract balances and receivables overlap and are never added together. */
export function buildMoneyReconciliation(bundle: InvoicesBundle, balances: JobBalanceRow[], now: Date): ReconciliationGroup[] {
  const groups: ReconciliationGroup[] = [
    { id: 'receivables', label: 'Issued invoice balance', explanation: 'Issued invoices less allocated payments. Drafts, paid and void invoices excluded. Includes invoices billed directly to customers.', rows: [], total: 0 },
    { id: 'overdue', label: 'Overdue invoice balance', explanation: 'The part of issued invoice balance whose due day has ended. Due today is not overdue.', rows: [], total: 0 },
    { id: 'unbilled', label: 'Contract value not yet issued', explanation: 'Contract plus approved changes less issued or paid invoice face amounts. Drafts remain unissued. This is planned billing, not a collection balance.', rows: [], total: 0 },
    { id: 'drafts', label: 'Draft invoice value', explanation: 'Unsent invoice face amounts, including drafts older than the main invoice list. Review drafts before sending. Drafts may overlap unissued contract value.', rows: [], total: 0 },
    { id: '0-30', label: 'Contract balance: up to 30 days', explanation: 'Remaining contract value by reference age. Oldest open invoice due or issue date, otherwise job creation date. This is not invoice delinquency.', rows: [], total: 0 },
    { id: '31-60', label: 'Contract balance: 31 to 60 days', explanation: 'Remaining contract value using the same reference date as Job balances. This includes work not yet invoiced.', rows: [], total: 0 },
    { id: '60+', label: 'Contract balance: over 60 days', explanation: 'Remaining contract value using the same reference date as Job balances. This includes work not yet invoiced.', rows: [], total: 0 }
  ]
  const byId = new Map(groups.map(g => [g.id, g]))
  const jobs = new Map(bundle.jobs.map(j => [j.id, j]))
  const invoices = knownInvoices(bundle)
  const due = amountsDueByInvoice({ invoices, payments: bundle.payments, contractFor: id => {
    const job = jobs.get(id)
    return job ? knownContractTotal({ amount: job.amount, changeOrders: bundle.changeOrders.filter(c => c.contact_id === id) }) : null
  } })
  for (const invoice of invoices) {
    const full = bundle.invoices.find(i => i.id === invoice.id) ?? bundle.openInvoices?.find(i => i.id === invoice.id)
    const job = invoice.contact_id ? jobs.get(invoice.contact_id) : undefined
    const standing = classifyInvoice(invoice, due.get(invoice.id), now)
    const row: ReconciliationRow = { id: invoice.id, title: job?.name || full?.fh_clients?.name || 'Customer invoice', detail: [invoiceReference(invoice), full?.title || job?.job_title].filter(Boolean).join(' · '), amount: standing.owed, to: `/invoices/${invoice.id}` }
    if (standing.issued && standing.owed > 0) {
      byId.get('receivables')!.rows.push(row)
      if (standing.status === 'overdue') byId.get('overdue')!.rows.push(row)
    }
    if (standing.status === 'draft') byId.get('drafts')!.rows.push({ ...row, amount: Number(invoice.amount) || 0 })
  }
  for (const row of balances) {
    if (!row.isOutstanding) continue
    byId.get(row.bucket)?.rows.push({ id: row.job.id, title: row.job.name || 'Job', detail: row.job.job_title || 'Remaining contract value', amount: row.balance, to: `/jobs/${row.job.id}?tab=financials` })
  }
  for (const job of bundle.jobs) {
    if (job.stage === 'lost') continue
    const contract = knownContractTotal({ amount: job.amount, changeOrders: bundle.changeOrders.filter(c => c.contact_id === job.id) })
    if (contract == null) continue
    const issuedCents = invoices.filter(i => i.contact_id === job.id && !['draft', 'void'].includes(String(i.status))).reduce((sum, i) => sum + cents(Number(i.amount) || 0), 0)
    const unissued = Math.max(0, cents(contract) - issuedCents) / 100
    if (unissued > 0) byId.get('unbilled')!.rows.push({ id: job.id, title: job.name || 'Job', detail: job.job_title || 'Contract value not yet issued', amount: unissued, to: `/jobs/${job.id}?tab=financials` })
  }
  for (const group of groups) group.total = group.rows.reduce((sum, row) => sum + cents(row.amount), 0) / 100
  return groups
}
