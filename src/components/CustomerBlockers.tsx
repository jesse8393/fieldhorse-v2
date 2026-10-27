import { useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useMembership } from '../contexts/MembershipContext.tsx'
import { useInvoicesBundle } from '../lib/queries.ts'
import { useOrgScope } from '../lib/orgScope.ts'
import { useNow } from '../lib/useNow.ts'
import { supabase } from '../lib/supabase.ts'
import { customerBlockers } from '../lib/customerBlockers.ts'
import DataErrorState from './DataErrorState.tsx'

export default function CustomerBlockers({ clientId, jobs }: { clientId: string; jobs: { id: string; stage?: string | null; job_title?: string | null; name?: string | null }[] }) {
  const { user } = useAuth()
  const { canSeeFinancials } = useMembership()
  const orgId = useOrgScope(user?.id)
  const billing = useInvoicesBundle(canSeeFinancials ? user?.id : undefined)
  const now = useNow()
  const jobIds = jobs.map(j => j.id).sort()
  const schedule = useQuery({
    queryKey: ['customerBlockers', clientId, user?.id, orgId, jobIds],
    enabled: !!user && orgId !== undefined,
    queryFn: async () => {
      if (!jobIds.length) return []
      const rows: { id: string; contact_id: string | null; end_at: string | null }[] = []
      for (let batch = 0; batch < jobIds.length; batch += 100) {
        for (let offset = 0; ; offset += 500) {
          let q = supabase.from('fh_schedule').select('id, contact_id, end_at').in('contact_id', jobIds.slice(batch, batch + 100))
          q = orgId ? q.eq('org_id', orgId) : q.eq('user_id', user!.id)
          const { data, error } = await q.order('id').range(offset, offset + 499)
          if (error) throw error
          rows.push(...(data ?? []))
          if ((data?.length ?? 0) < 500) break
        }
      }
      return rows
    }
  })
  const loading = schedule.isPending || canSeeFinancials && billing.isPending
  const failed = schedule.isError || canSeeFinancials && billing.isError
  const blockers = customerBlockers({ clientId, jobs, schedules: schedule.data ?? [], billing: canSeeFinancials ? billing.data : null, now })
  return <section aria-label="Delivery and billing review" style={{ padding: 16, border: '1px solid var(--v3-border)', borderRadius: 10, background: 'var(--v3-surface)' }}>
    <h2 style={{ margin: '0 0 8px', fontSize: 18 }}>Delivery and billing review</h2>
    {loading ? <p role="status">Checking linked records…</p> : failed ? <DataErrorState title="Review unavailable" message="Could not check every linked schedule and invoice. No clear status inferred." onRetry={() => { void schedule.refetch(); if (canSeeFinancials) void billing.refetch() }} /> : <>
      <p style={{ margin: '0 0 12px', fontSize: 14, color: 'var(--v3-text-secondary)', lineHeight: 1.5 }}>{blockers.length ? `${blockers.length} ${blockers.length === 1 ? 'item needs' : 'items need'} review.` : (canSeeFinancials ? 'No overdue invoices or recent schedule overruns found.' : 'No recent schedule overruns found.')} Relationship activity does not measure delivery health.</p>
      {blockers.length > 0 && <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>{blockers.map(b => <li key={b.id} style={{ borderTop: '1px solid var(--v3-border)' }}><Link to={b.to} style={{ display: 'block', padding: 'var(--space-4) 0', minHeight: 44, color: 'var(--v3-text)' }}><strong>{b.label}</strong><span style={{ display: 'block', marginTop: 4, fontSize: 14, lineHeight: 1.5 }}>{b.detail}</span></Link></li>)}</ul>}
      <p style={{ margin: '12px 0 0', fontSize: 14, color: 'var(--v3-text-secondary)' }}>Scope: active jobs with visits ending in the past 14 days{canSeeFinancials ? ', and all issued invoices with unpaid balances past their due day.' : '. Invoice balances are restricted by your role.'} Unreported site issues require separate review.</p>
    </>}
  </section>
}
