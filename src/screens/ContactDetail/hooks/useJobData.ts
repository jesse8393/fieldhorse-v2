import { useCallback, useEffect, useMemo } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../../../lib/supabase.ts'
import { toastSuccess } from '../../../lib/toast.ts'
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
 *   - patch() does an optimistic cache write, then the supabase update,
 *     then invalidates on failure
 *   - the realtime subscription invalidates instead of refetching by hand
 *
 * RLS (owner OR accepted-partner) is the access layer — no JS user_id
 * filter, matching the prior behavior so partner-shared jobs surface.
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
  const [c, s, e, p, i, n, sch, td, ins, co, st] = await Promise.all([
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
 * prefetchJobDetail — speed pass: warm the detail cache on hover intent.
 *
 * Called from list rows (desktop rail, lead cards) on mouseenter/focus so
 * by the time the click lands, the 11 parallel fetches are already in
 * flight or done — the detail paints instantly from cache. staleTime
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

  const { data, isPending } = useQuery({
    queryKey: ['jobDetail', id],
    queryFn: () => fetchJobDetail(id as string, userId),
    enabled: !!id && !!userId
  })

  const d = data || EMPTY

  // Realtime — partner edits to this exact contact row invalidate the
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

  // Optimistic patch — flip the cached contact locally, sync, toast on
  // success; invalidate to resync on failure.
  const patch = useCallback(async (update: ContactUpdate) => {
    queryClient.setQueryData(['jobDetail', id], (prev: any) =>
      prev ? { ...prev, contact: { ...prev.contact, ...update } } : prev
    )
    const { error } = await supabase.from('fh_contacts').update(update).eq('id', id as string)
    if (!error) toastSuccess('Saved', 'Changes synced')
    else queryClient.invalidateQueries({ queryKey: ['jobDetail', id] })
  }, [id, queryClient])

  const paid = useMemo(
    () => d.payments.reduce((s, p) => s + Number(p.amount || 0), 0),
    [d.payments]
  )
  const balance = useMemo(
    () => Math.max(0, Number(d.contact?.amount || 0) - paid),
    [d.contact?.amount, paid]
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
    balance,
    // status — isPending (not isLoading) so the skeleton shows until the
    // first fetch resolves, including the brief window while auth (userId)
    // is still resolving and the query is disabled. Matches the prior
    // "loading starts true" semantics.
    loading: isPending,
    // actions
    fetchAll,
    patch
  }
}
