import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase.ts'
import { toastSuccess, toastError } from '../../../lib/toast.ts'
import { contractTotals } from '../../../lib/invoices.ts'
import type { Database } from '../../../lib/database.types.ts'

type Contact = Database['public']['Tables']['fh_contacts']['Row']
type ContactUpdate = Database['public']['Tables']['fh_contacts']['Update']

/**
 * Single source of truth for the Job Detail screen's data layer.
 *
 * Migrated to TanStack Query (was useState x11 + useCallback fetchAll +
 * useEffect). The return contract is byte-for-byte the same so the
 * parent shell + every tab keep working unchanged:
 *   - one keyed query (['jobDetail', id]) runs the 11 parallel fetches
 *     + the conditional fh_clients lookup
 *   - fetchAll() now invalidates the query (callers already await it)
 *   - patch() does an optimistic cache write, then the supabase update;
 *     on failure it rolls the changed fields back, toasts, resyncs and
 *     returns { error } so callers can keep their form open
 *   - the realtime subscription invalidates instead of refetching by hand
 *   - any failed read throws, so the screen shows a retryable error
 *     instead of caching "not found" or empty money lists as real data
 *
 * RLS (org members OR accepted partners) is the access layer, no JS
 * user_id filter, so teammates and partner-shared jobs surface.
 */

const EMPTY = {
  contact: null,
  subs: [],
  expenses: [],
  payments: [],
  inspections: [],
  notes: [],
  scheduleItems: [],
  todos: [],
  clientSummary: null,
  insurance: null,
  changeOrders: [],
  stageTransitions: []
}

async function fetchJobDetail(id: string, userId: string | undefined) {
  const results = await Promise.all([
    supabase.from('fh_contacts').select('*').eq('id', id).maybeSingle(),
    supabase.from('fh_subs').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
    supabase.from('fh_expenses').select('*').eq('contact_id', id).order('expense_date', { ascending: false }),
    supabase.from('fh_payments').select('*').eq('contact_id', id).order('paid_on', { ascending: false }),
    supabase.from('fh_inspections').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
    supabase.from('fh_notes').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
    supabase.from('fh_schedule').select('*').eq('contact_id', id).order('start_at', { ascending: true }),
    supabase.from('fh_job_todos').select('*').eq('job_id', id).order('done', { ascending: true }).order('created_at', { ascending: false }),
    supabase.from('fh_insurance_claims').select('*').eq('contact_id', id).maybeSingle(),
    supabase.from('fh_change_orders').select('*').eq('contact_id', id).order('sequence_number', { ascending: true }),
    supabase.from('fh_stage_transitions').select('*').eq('contact_id', id).order('transitioned_at', { ascending: true })
  ])
  const [c, s, e, p, i, n, sch, td, ins, co, st] = results

  // supabase-js resolves network failures, 5xx and policy errors as
  // { data: null, error } instead of throwing. Throw so TanStack treats
  // the fetch as failed: it retries, keeps the last good data on a
  // background refetch, and never caches (or persists) a missing job or
  // empty payments as real. Rows RLS hides are not errors (crew just get
  // empty money lists), and maybeSingle returns null data, not an error,
  // when the job does not exist.
  for (const r of results) {
    if (r.error) throw r.error
  }

  const contactRow = c.data || null

  // Multi-tenant guard preserved: RLS denies partner reads on fh_clients,
  // but the JS guard avoids issuing a guaranteed-empty request.
  let clientSummary = null
  const isOwnerView = contactRow && contactRow.user_id === userId
  if (isOwnerView && contactRow.client_id) {
    const { data: cli } = await supabase
      .from('fh_clients')
      .select('id, name')
      .eq('id', contactRow.client_id)
      .maybeSingle()
    clientSummary = cli || null
  }

  return {
    contact: contactRow,
    subs: s.data || [],
    expenses: e.data || [],
    payments: p.data || [],
    inspections: i.data || [],
    notes: n.data || [],
    scheduleItems: sch.data || [],
    todos: td.data || [],
    clientSummary,
    insurance: ins.data || null,
    changeOrders: co.data || [],
    stageTransitions: st.data || []
  }
}

/**
 * prefetchJobDetail, speed pass: warm the detail cache on hover intent.
 *
 * Called from list rows (desktop rail, lead cards) on mouseenter/focus so
 * by the time the click lands, the 11 parallel fetches are already in
 * flight or done, the detail paints instantly from cache. staleTime
 * keeps repeat hovers within 30s from refiring the whole batch; the
 * detail's own mount query still revalidates in the background per its
 * defaults, so freshness is unchanged.
 */
export function prefetchJobDetail(queryClient: QueryClient, id: string | undefined, userId: string | undefined) {
  if (!id || !userId) return
  queryClient.prefetchQuery({
    queryKey: ['jobDetail', id],
    queryFn: () => fetchJobDetail(id, userId),
    staleTime: 30_000
  })
}

export function useJobData(id: string | undefined, userId: string | undefined) {
  const queryClient = useQueryClient()

  const { data, isPending, isError } = useQuery({
    queryKey: ['jobDetail', id],
    queryFn: () => fetchJobDetail(id as string, userId),
    enabled: !!id && !!userId
  })

  const d = data || EMPTY

  // Realtime, partner edits to this exact contact row invalidate the
  // query so the new state pulls in. One channel per detail view.
  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`fh_contacts:detail:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fh_contacts', filter: `id=eq.${id}` },
        () => queryClient.invalidateQueries({ queryKey: ['jobDetail', id] })
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id, queryClient])

  const fetchAll = useCallback(
    () => queryClient.invalidateQueries({ queryKey: ['jobDetail', id] }),
    [queryClient, id]
  )

  // Optimistic patch, flip the cached contact locally, sync, toast on
  // success. On failure roll the changed fields back, say so, resync,
  // and return the error so a form can stay open with the typed values.
  const patch = useCallback(async (update: ContactUpdate): Promise<{ error: { message: string } | null }> => {
    const key = ['jobDetail', id]
    const before = (queryClient.getQueryData(key) as any)?.contact
    queryClient.setQueryData(key, (prev: any) =>
      prev ? { ...prev, contact: { ...prev.contact, ...update } } : prev
    )
    // .select() so an update RLS filters out (zero rows, no error) is
    // reported as a failure instead of "Saved".
    const { data: rows, error } = await supabase
      .from('fh_contacts')
      .update(update)
      .eq('id', id as string)
      .select('id')
    const failure = error
      || (!rows || rows.length === 0
        ? { message: 'This job may have been removed, or you no longer have access to edit it.' }
        : null)
    if (!failure) {
      toastSuccess('Saved', 'Changes synced')
      return { error: null }
    }
    // Restore only the fields this patch touched, other optimistic edits
    // made since stay put until the resync lands.
    if (before) {
      const revert: Record<string, unknown> = {}
      for (const k of Object.keys(update)) revert[k] = before[k]
      queryClient.setQueryData(key, (prev: any) =>
        prev ? { ...prev, contact: { ...prev.contact, ...revert } } : prev
      )
    }
    queryClient.invalidateQueries({ queryKey: key })
    toastError("Couldn't save", failure.message || 'Try again')
    return { error: failure }
  }, [id, queryClient])

  const paid = useMemo(
    () => d.payments.reduce((s, p) => s + Number(p.amount || 0), 0),
    [d.payments]
  )
  // Balance must fold in approved change orders, otherwise the money
  // stat and the stage CTA ("Send invoice" vs "Mark complete") read the
  // job as fully collected while CO money is still owed.
  const moneyTotals = useMemo(
    () => contractTotals({ contact: d.contact, payments: d.payments, changeOrders: d.changeOrders }),
    [d.contact, d.payments, d.changeOrders]
  )

  return {
    // data
    contact: d.contact,
    subs: d.subs,
    expenses: d.expenses,
    payments: d.payments,
    inspections: d.inspections,
    notes: d.notes,
    scheduleItems: d.scheduleItems,
    scheduleCount: d.scheduleItems.length,
    todos: d.todos,
    clientSummary: d.clientSummary,
    insurance: d.insurance,
    changeOrders: d.changeOrders,
    stageTransitions: d.stageTransitions,
    // derived
    paid,
    // Base amount plus approved change orders, the figure balance is
    // measured against, so Value, Paid and Balance add up.
    contractTotal: moneyTotals.contractTotal,
    balance: moneyTotals.balance,
    credit: moneyTotals.credit,
    // status, isPending (not isLoading) so the skeleton shows until the
    // first fetch resolves, including the brief window while auth (userId)
    // is still resolving and the query is disabled. Matches the prior
    // "loading starts true" semantics.
    loading: isPending,
    // True when the last fetch failed. With no cached job this means the
    // screen could not load it, which is different from "not found".
    isError,
    // actions
    fetchAll,
    patch
  }
}
