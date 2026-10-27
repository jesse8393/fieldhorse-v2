import { supabase } from './supabase.ts'
import { knownContractTotal } from './invoiceSettlement.ts'
import type { InvoiceRow } from './invoices.ts'

/** Fresh billing context before a write. Failed reads never become a zero balance. */
export async function fetchInvoiceReviewContext(jobId: string | null, clientId?: string | null) {
  const invoices: InvoiceRow[] = []
  for (let from = 0; ; from += 500) {
    let query = supabase.from('fh_invoices').select('*').neq('status', 'void')
    query = jobId ? query.eq('contact_id', jobId) : query.eq('client_id', clientId!).is('contact_id', null)
    const result = await query.order('id').range(from, from + 499)
    if (result.error) throw result.error
    invoices.push(...(result.data ?? []) as InvoiceRow[])
    if ((result.data?.length ?? 0) < 500) break
  }
  if (!jobId) return { invoices, contractTotal: null }
  const { data: job, error } = await supabase.from('fh_contacts').select('amount').eq('id', jobId).maybeSingle()
  if (error) throw error
  if (!job) throw new Error('This job is unavailable. Pick a current job before billing.')
  const changes: { amount: number | null; status: string | null }[] = []
  for (let from = 0; ; from += 500) {
    const result = await supabase.from('fh_change_orders').select('amount, status').eq('contact_id', jobId).eq('status', 'approved').order('id').range(from, from + 499)
    if (result.error) throw result.error
    changes.push(...(result.data ?? []))
    if ((result.data?.length ?? 0) < 500) break
  }
  if (job.amount != null && !Number.isFinite(Number(job.amount)) || changes.some(change => !Number.isFinite(Number(change.amount)))) {
    throw new Error('Review invalid contract or approved change amounts before billing.')
  }
  return { invoices, contractTotal: knownContractTotal({ amount: job.amount, changeOrders: changes }) }
}
