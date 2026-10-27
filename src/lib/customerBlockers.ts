import type { InvoicesBundle } from './queries.ts'
import { buildMoneyReconciliation } from './moneyReconciliation.ts'
export type CustomerBlocker = { id: string; label: string; detail: string; to: string }
export function customerBlockers({ clientId, jobs, schedules, billing, now }: { clientId: string; jobs: { id: string; stage?: string | null; job_title?: string | null; name?: string | null }[]; schedules: { id: string; contact_id: string | null; end_at: string | null }[]; billing?: InvoicesBundle | null; now: Date }): CustomerBlocker[] {
  const result: CustomerBlocker[] = []
  const since = now.getTime() - 14 * 86400000
  for (const job of jobs) {
    // Same signal as Today: an active job with a scheduled end in the past fortnight.
    if (job.stage !== 'job') continue
    if (!schedules.some(s => s.contact_id === job.id && s.end_at && new Date(s.end_at).getTime() < now.getTime() && new Date(s.end_at).getTime() >= since)) continue
    result.push({ id: `schedule-${job.id}`, label: 'Schedule needs review', detail: `${job.job_title || job.name || 'Job'} has a visit whose scheduled end passed within the last 14 days. Confirm completion or reschedule.`, to: `/jobs/${job.id}?tab=schedule` })
  }
  if (billing) {
    const ids = new Set(jobs.map(j => j.id))
    const overdue = buildMoneyReconciliation(billing, [], now).find(g => g.id === 'overdue')!
    for (const row of overdue.rows) {
      const invoice = billing.invoices.find(i => i.id === row.id) ?? billing.openInvoices?.find(i => i.id === row.id)
      if (!invoice || !(invoice.client_id === clientId || invoice.contact_id && ids.has(invoice.contact_id))) continue
      result.push({ id: `invoice-${row.id}`, label: 'Overdue invoice', detail: `${row.detail} · ${new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(row.amount)} remaining`, to: row.to })
    }
  }
  return result
}
