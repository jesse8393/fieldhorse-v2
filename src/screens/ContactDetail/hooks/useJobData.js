import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../../../lib/supabase.js'
import { toastSuccess } from '../../../lib/toast.js'

/**
 * Single source of truth for the Job Detail screen's data layer.
 *
 * Owns:
 *   - The 7 parallel fetches (fh_contacts + fh_subs + fh_expenses + fh_payments
 *     + fh_inspections + fh_notes + fh_schedule) — preserved verbatim from the
 *     pre-v3 ContactDetail.jsx fetchAll, with one upgrade: schedule is now
 *     queried for full rows (not head-only count) so NextAction can resolve
 *     the next upcoming entry.
 *   - The conditional fh_clients lookup (multi-tenant guard preserved: only
 *     issued when contactRow.user_id === userId).
 *   - The optimistic patch handler — same shape as the original.
 *   - A NEW Supabase Realtime subscription on fh_contacts where id=:id, so
 *     partner edits propagate instantly to the owner's view (Q8 decision).
 *
 * Returns a single object the parent shell spreads into tab props. No
 * context — caller threads what each tab needs as explicit props.
 */
export function useJobData(id, userId) {
  const [contact, setContact] = useState(null)
  const [loading, setLoading] = useState(true)
  const [subs, setSubs] = useState([])
  const [expenses, setExpenses] = useState([])
  const [payments, setPayments] = useState([])
  const [inspections, setInspections] = useState([])
  const [notes, setNotes] = useState([])
  // Full schedule rows so NextAction priority chain can read start_at + title.
  // The legacy fetchAll only pulled a head-only count for the delete sheet's
  // "X schedule items" cascade display — we keep that count derived below.
  const [scheduleItems, setScheduleItems] = useState([])
  // Todos at the parent level so the NextAction priority chain can resolve
  // step 3 (open todo). TodosSection still owns its own fetch for live CRUD;
  // this parent fetch is a snapshot used only by NextAction.
  const [todos, setTodos] = useState([])
  const [clientSummary, setClientSummary] = useState(null)

  const fetchAll = useCallback(async () => {
    if (!userId || !id) return
    const [c, s, e, p, i, n, sch, td] = await Promise.all([
      supabase.from('fh_contacts').select('*').eq('id', id).maybeSingle(),
      supabase.from('fh_subs').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('fh_expenses').select('*').eq('contact_id', id).order('expense_date', { ascending: false }),
      supabase.from('fh_payments').select('*').eq('contact_id', id).order('paid_on', { ascending: false }),
      supabase.from('fh_inspections').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('fh_notes').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
      supabase.from('fh_schedule').select('*').eq('contact_id', id).order('start_at', { ascending: true }),
      supabase.from('fh_job_todos').select('*').eq('job_id', id).order('done', { ascending: true }).order('created_at', { ascending: false })
    ])

    const contactRow = c.data || null
    setContact(contactRow)
    setSubs(s.data || [])
    setExpenses(e.data || [])
    setPayments(p.data || [])
    setInspections(i.data || [])
    setNotes(n.data || [])
    setScheduleItems(sch.data || [])
    setTodos(td.data || [])

    // Multi-tenant guard preserved: migration 007 RLS denies partner reads on
    // fh_clients, but the JS guard avoids issuing a guaranteed-empty request.
    const isOwnerView = contactRow && contactRow.user_id === userId
    if (isOwnerView && contactRow.client_id) {
      const { data: cli } = await supabase
        .from('fh_clients')
        .select('id, name')
        .eq('id', contactRow.client_id)
        .maybeSingle()
      setClientSummary(cli || null)
    } else {
      setClientSummary(null)
    }
    setLoading(false)
  }, [userId, id])

  useEffect(() => { fetchAll() }, [fetchAll])

  // Realtime — partner edits to this exact contact row push the new state in.
  // One channel per detail view; cleanup on unmount. Filter is server-side via
  // postgres_changes config so we only get rows for this :id.
  useEffect(() => {
    if (!id) return
    const channel = supabase
      .channel(`fh_contacts:detail:${id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fh_contacts', filter: `id=eq.${id}` },
        () => fetchAll()
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [id, fetchAll])

  // Optimistic patch — flip locally, sync, toast on success. Failure leaves
  // optimistic state in place silently (matches legacy behavior; we can add
  // rollback here in a follow-up without touching callers).
  //
  // Defense-in-depth: filter on user_id alongside id. Supabase RLS already
  // enforces the same constraint, but a JS-layer guard prevents accidental
  // writes if RLS ever has a gap (service-role bypass during tests, migration
  // ordering bug, etc.). Project memory documents a $160K pipeline leak from
  // a multi-tenant gap — this guard is the cheap belt-and-suspenders.
  const patch = useCallback(async (update) => {
    setContact((c) => ({ ...c, ...update }))
    const { error } = await supabase.from('fh_contacts')
      .update(update)
      .eq('id', id)
      .eq('user_id', userId)
    if (!error) toastSuccess('Saved', 'Changes synced')
  }, [id, userId])

  // Derived — payments aggregate + balance + legacy scheduleCount kept as a
  // memoized read so nothing in the delete-cascade UI breaks.
  const paid = useMemo(
    () => payments.reduce((s, p) => s + Number(p.amount || 0), 0),
    [payments]
  )
  const balance = useMemo(
    () => Math.max(0, Number(contact?.amount || 0) - paid),
    [contact?.amount, paid]
  )
  const scheduleCount = scheduleItems.length

  return {
    // data
    contact,
    subs,
    expenses,
    payments,
    inspections,
    notes,
    scheduleItems,
    scheduleCount,
    todos,
    clientSummary,
    // derived
    paid,
    balance,
    // status
    loading,
    // actions
    fetchAll,
    patch
  }
}
