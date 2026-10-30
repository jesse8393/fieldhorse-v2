import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Plus, Trash2, Calendar, UserRound, ArrowUpRight } from 'lucide-react'
import { supabase } from '../../../lib/supabase.ts'
import { toastSuccess, toastError, toastUndo } from '../../../lib/toast.ts'
import { resilientInsert, resilientUpdate } from '../../../lib/outbox.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import { SkeletonList } from '../../../components/Skeleton.tsx'
import { dateInputToTimestamp, timestampToDateInput, dueStatus } from '../../../lib/dueDate.ts'
import { orgMembersList, type OrgMember } from '../../../lib/orgApi.ts'
import { Eyebrow } from '../../../components/v3'

/**
 * Tasks section, backed by fh_job_todos. Owns its own fetch (independent of
 * the parent useJobData lifecycle since the per-tab refresh cost is tiny).
 *
 * Schema: { id, user_id, job_id, text, done, completed_at, created_at, due_at }
 *   due_at (migration 010) is nullable. NextAction sorting + UI are
 *   wired in later phases (2H-3 / 2H-4). For now the column exists,
 *   flows through SELECT *, and is preserved by the snapshot+undo path.
 *
 * Delete uses toastUndo so a stray tap can be reversed within 6s.
 */
export default function TodosSection({ jobId, userId, compact = false, onOpenTasks, onChanged }: { jobId?: string; userId?: string; compact?: boolean; onOpenTasks?: () => void; onChanged?: () => void }) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState(false)
  const headingRef = useRef<HTMLHeadingElement>(null)
  const [draft, setDraft] = useState('')
  // Optional due date for the new todo being composed. year month day or ''.
  // Converted to a local-end-of-day ISO at insert time via dateInputToTimestamp.
  const [dueDraft, setDueDraft] = useState('')
  // Optional assignee for the new todo. '' = unassigned ("anyone on
  // the crew"). Populated from the org members list on first mount;
  // a single-user org-of-one effectively just shows "Me".
  const [assignDraft, setAssignDraft] = useState('')
  const [members, setMembers] = useState<OrgMember[]>([])
  // True while a new task is being inserted. The ref is the actual guard:
  // a second Enter (or Enter then a tap on Add) can fire before React
  // re-renders with the state, and must not insert the task twice.
  const [saving, setSaving] = useState(false)
  const savingRef = useRef(false)

  // Fetch the org member list once for the assignee picker. Best-effort
  //, if the call fails (e.g. org_members endpoint unreachable) the
  // picker stays empty and the section still works for unassigned
  // tasks.
  useEffect(() => {
    let cancelled = false
    orgMembersList()
      .then((res) => { if (!cancelled) setMembers(res.members || []) })
      .catch(() => { /* ignore, picker just stays empty */ })
    return () => { cancelled = true }
  }, [])

  const memberById = (() => {
    const m: Record<string, OrgMember> = {}
    for (const x of members) m[x.user_id] = x
    return m
  })()

  const fetchRows = useCallback(async () => {
    if (!jobId) return
    setLoading(true)
    // Org-scoped RLS (fh_job_todos_own / fh_job_todos_partner) already
    // restricts visibility to teammates and accepted partners, so we
    // can drop the legacy `user_id = me` filter and show every task
    // on the job to every teammate. The user_id column stays as
    // provenance ("created by X").
    const { data, error } = await supabase
      .from('fh_job_todos')
      .select('*')
      .eq('job_id', jobId)
      .order('done', { ascending: true })
      .order('created_at', { ascending: false })
    setLoadError(!!error)
    if (!error) setRows(data || [])
    setLoading(false)
  }, [jobId])

  useEffect(() => { fetchRows() }, [fetchRows])

  async function add() {
    const txt = draft.trim()
    if (!txt || savingRef.current) return
    savingRef.current = true
    setSaving(true)
    hapticTap()
    try {
      const payload: Record<string, any> = { user_id: userId, job_id: jobId, text: txt }
      if (dueDraft) payload.due_at = dateInputToTimestamp(dueDraft)
      if (assignDraft) payload.assigned_to = assignDraft
      const { queued, error } = await resilientInsert('fh_job_todos', payload)
      if (error) {
        toastError("Couldn't add task", error.message)
        return
      }
      if (queued) toastSuccess('Saved offline', 'Will sync when signal returns')
      setDraft('')
      setDueDraft('')
      setAssignDraft('')
      fetchRows()
      onChanged?.()
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  // Teammates edit and remove each other's tasks, so every write below
  // matches by id only and org RLS on fh_job_todos scopes the tenant. A
  // write that matches no row (deleted meanwhile, or access revoked)
  // returns no error, so each asks for the id back and treats an empty
  // result as a failure.

  // Reassign an existing task.
  async function reassign(rowId: any, nextAssignedTo: string | null) {
    setRows((rs) => rs.map((r) => r.id === rowId ? { ...r, assigned_to: nextAssignedTo } : r))
    const { data, error } = await supabase
      .from('fh_job_todos')
      .update({ assigned_to: nextAssignedTo })
      .eq('id', rowId)
      .select('id')
    if (error || !data?.length) {
      toastError("Couldn't reassign", error?.message || 'This task may have been deleted.')
      fetchRows()
    } else onChanged?.()
  }

  // Inline edit: tap a row's due chip → native date picker → onChange
  // fires here. Optimistic update with rollback on Supabase error.
  async function updateDueAt(rowId: any, nextDueAt: any) {
    setRows((rs) => rs.map((r) => r.id === rowId ? { ...r, due_at: nextDueAt } : r))
    const { data, error } = await supabase
      .from('fh_job_todos')
      .update({ due_at: nextDueAt })
      .eq('id', rowId)
      .select('id')
    if (error || !data?.length) {
      toastError("Couldn't update due date", error?.message || 'This task may have been deleted.')
      fetchRows()
    } else onChanged?.()
  }

  async function toggle(row: any) {
    hapticTap()
    if (compact) headingRef.current?.focus({ preventScroll: true })
    const next = !row.done
    // Optimistic
    setRows((rs) => rs.map((r) => r.id === row.id
      ? { ...r, done: next, completed_at: next ? new Date().toISOString() : null }
      : r
    ))
    const { error } = await resilientUpdate(
      'fh_job_todos',
      { id: row.id },
      { done: next, completed_at: next ? new Date().toISOString() : null },
      // The match no longer carries a user_id for the outbox to read the
      // owner from, so tag a queued copy with who made the change.
      { userId }
    )
    if (error) {
      toastError("Couldn't update", error.message)
      fetchRows() // rollback to truth
    } else {
      onChanged?.()
      if (next) toastUndo('Task completed', { description: row.text, onUndo: () => toggle({ ...row, done: true }) })
    }
  }

  async function remove(rowId: any) {
    hapticTap()
    const snapshot = rows.find((r) => r.id === rowId)
    setRows((rs) => rs.filter((r) => r.id !== rowId)) // optimistic
    const { data, error } = await supabase.from('fh_job_todos').delete().eq('id', rowId).select('id')
    if (error || !data?.length) {
      toastError("Couldn't delete", error?.message || 'This task may already be gone.')
      fetchRows()
      return
    }
    onChanged?.()
    toastUndo('Task deleted', {
      description: (snapshot?.text || '').slice(0, 60) || 'Tap Undo to restore',
      onUndo: async () => {
        if (!snapshot) return
        const { error: insErr } = await supabase.from('fh_job_todos').insert(snapshot)
        if (insErr) { toastError("Couldn't undo", insErr.message); return }
        fetchRows()
        onChanged?.()
        toastSuccess('Restored')
      }
    })
  }

  const undoneCount = rows.filter((r) => !r.done).length

  if (compact) {
    const open = rows.filter(row => !row.done).sort((a, b) => {
      const assigned = Number(b.assigned_to === userId) - Number(a.assigned_to === userId)
      const due = (Date.parse(a.due_at) || Infinity) - (Date.parse(b.due_at) || Infinity)
      return assigned || due || 0
    })
    return <section className="fh-work-tasks" aria-labelledby="fh-work-tasks-heading">
      <div className="fh-work-section-head">
        <h2 id="fh-work-tasks-heading" ref={headingRef} tabIndex={-1}>Open tasks {!loading && !loadError && <span>{undoneCount}</span>}</h2>
        <button type="button" className="fh-work-link" onClick={onOpenTasks}><Plus size={16} aria-hidden="true" />Add task</button>
      </div>
      {loading ? <SkeletonList rows={2} card={false} /> : loadError ? <div className="fh-work-empty" role="status">Tasks could not load.<button className="fh-work-link" type="button" onClick={fetchRows}>Try again</button></div> : open.length ? <ul className="fh-work-task-list">
        {open.slice(0, 3).map((row, index) => {
          const due = dueStatus(row.due_at)
          const assigned = row.assigned_to === userId ? 'You' : memberById[row.assigned_to]?.name || (row.assigned_to ? 'Teammate' : 'Unassigned')
          return <li key={row.id} className={index === 0 ? 'fh-work-task is-priority' : 'fh-work-task'}>
            {index === 0 && <p className="fh-work-priority-label">{row.assigned_to === userId ? 'Assigned to you' : 'Next open task'}</p>}
            <button type="button" className="fh-work-check" role="checkbox" aria-checked={false} aria-label={`Complete ${row.text}`} onClick={() => toggle(row)}><span aria-hidden="true" /></button>
            <button type="button" className="fh-work-task-open" onClick={onOpenTasks}><span><strong>{row.text}</strong><small>{assigned}{due ? ` · ${due.label}` : ''}</small></span><ArrowUpRight size={16} aria-hidden="true" /></button>
          </li>
        })}
      </ul> : <p className="fh-work-empty">{rows.length ? 'All current tasks complete.' : 'No tasks added yet.'}</p>}
      {open.length > 3 && <button className="fh-work-link" type="button" onClick={onOpenTasks}>View all {open.length} tasks<ArrowUpRight size={16} aria-hidden="true" /></button>}
    </section>
  }

  return (
    <section className="fh-task-editor" aria-labelledby="fh-task-editor-heading">
      <div className="fh-work-section-head">
        <h2 id="fh-task-editor-heading">Tasks</h2>
        {!loading && !loadError && rows.length > 0 && <span className="fh-task-count">{undoneCount === 0 ? 'All clear' : `${undoneCount} pending`}</span>}
      </div>
      <form className="fh-task-composer" onSubmit={(event) => { event.preventDefault(); void add() }}>
        <label className="fh-task-composer__text">
          <span>Task description</span>
          <input value={draft} onChange={(event) => setDraft(event.target.value)} placeholder="What needs to happen?" />
        </label>
        <div className="fh-task-composer__options">
          <label>
            <span>Due date</span>
            <input type="date" value={dueDraft} onChange={(event) => setDueDraft(event.target.value)} aria-label="Due date (optional)" />
          </label>
          {members.length > 1 && <label>
            <span>Assigned to</span>
            <select value={assignDraft} onChange={(event) => setAssignDraft(event.target.value)} aria-label="Assign to (optional)">
              <option value="">Unassigned</option>
              {members.map(member => <option key={member.user_id} value={member.user_id}>{member.is_self ? `${member.name || 'Me'} (me)` : member.name || member.email || 'Teammate'}</option>)}
            </select>
          </label>}
        </div>
        <button className="fh-task-add" type="submit" disabled={!draft.trim() || saving} aria-label="Add task"><Plus size={16} aria-hidden="true" />{saving ? 'Adding…' : 'Add task'}</button>
      </form>
      {loading && <SkeletonList rows={3} card={false} />}
      {!loading && loadError && <p role="status">Tasks could not load. <button type="button" className="fh-work-link" onClick={fetchRows}>Try again</button></p>}
      {!loading && !loadError && rows.length === 0 && <p className="fh-work-empty">No tasks added yet.</p>}
      {!loading && !loadError && rows.length > 0 && <ul className="fh-task-editor__list">
        <AnimatePresence>
          {rows.map(row => <motion.li key={row.id} className={`fh-task-editor__row${row.done ? ' is-done' : ''}`} layout initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}>
            <button type="button" className="fh-work-check" role="checkbox" aria-checked={!!row.done} aria-label={`${row.done ? 'Reopen' : 'Complete'} ${row.text}`} onClick={() => toggle(row)}><span>{row.done && <Check size={14} aria-hidden="true" />}</span></button>
            <span className="fh-task-editor__text">{row.text}</span>
            <button type="button" className="fh-task-delete" onClick={() => remove(row.id)} aria-label={`Delete task: ${row.text}`}><Trash2 size={16} aria-hidden="true" /></button>
            <div className="fh-task-editor__meta">
              <DueChipButton iso={row.due_at} done={row.done} onChange={(nextIso: any) => updateDueAt(row.id, nextIso)} />
              {members.length > 1 && <AssignChipSelect members={members} value={row.assigned_to || ''} onChange={(next: string) => reassign(row.id, next || null)} selfId={userId} memberById={memberById} />}
            </div>
          </motion.li>)}
        </AnimatePresence>
      </ul>}
    </section>
  )
}

/**
 * DueChipButton, wraps a hidden <input type="date"> in a <label> so
 * tapping the chip opens the native date picker. When iso is set:
 * status chip (Overdue red / Today gold / muted future date). When
 * iso is null: a quiet calendar icon serves as the "set due date"
 * affordance, no labeled chip is shown, but the tap target stays.
 */
function DueChipButton({ iso, done, onChange }: any) {
  const status = dueStatus(iso)
  const dateStr = timestampToDateInput(iso)

  // Tone → palette. surface-2 / muted by default; danger-soft for
  // overdue; primary-soft for today. All use existing v3 tokens.
  const palette = (() => {
    if (!status) {
      return { bg: 'transparent', border: 'var(--v3-border)', color: 'var(--v3-text-muted)' }
    }
    if (status.tone === 'danger') {
      return {
        bg: 'var(--v3-danger-soft)',
        border: 'color-mix(in srgb, var(--v3-danger) 40%, transparent)',
        color: 'var(--v3-danger-text)'
      }
    }
    if (status.tone === 'warn') {
      return {
        bg: 'var(--v3-primary-soft)',
        border: 'color-mix(in srgb, var(--v3-primary) 35%, transparent)',
        color: 'var(--v3-primary-text)'
      }
    }
    return { bg: 'var(--v3-surface-2)', border: 'var(--v3-border)', color: 'var(--v3-text-muted)' }
  })()

  return (
    <Eyebrow as="label" style={{ position: 'relative', justifyContent: 'center', gap: 4, flexShrink: 0, minWidth: 44, minHeight: 44, padding: status ? '0 8px' : 0, borderRadius: 10, background: palette.bg, border: status ? `1px solid ${palette.border}` : `1px solid transparent`, color: palette.color, whiteSpace: 'nowrap', opacity: done ? 0.5 : 1, cursor: 'pointer', WebkitTapHighlightColor: 'transparent' }} aria-label={status ? `Due ${status.label}` : 'Set due date'}>
      <input
        type="date"
        value={dateStr}
        onChange={(e) => onChange(dateInputToTimestamp(e.target.value))}
        style={{
          position: 'absolute', inset: 0,
          opacity: 0, cursor: 'pointer',
          width: '100%', height: '100%',
          padding: 0, margin: 0, border: 'none', background: 'transparent'
        }}
      />
      {status ? <span>{status.label}</span> : <Calendar size={12} aria-hidden="true" />}
    </Eyebrow>
  )
}

// AssignChipSelect, wraps an invisible <select> in a styled chip so
// every row's assignee can be re-picked with one tap. The chip text
// shows the current assignee (or "Unassigned"); the native select
// surface drives the choice. Only renders when the org has more than
// one member.
function AssignChipSelect({ members, value, onChange, selfId, memberById }: any) {
  const current = value ? memberById[value] : null
  const label = !value
    ? 'Unassigned'
    : value === selfId
      ? 'Me'
      : (current?.name || current?.email || 'Teammate')
  return (
    <label
      style={{
        flexShrink: 0,
        minHeight: 44,
        position: 'relative',
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        padding: '4px 8px',
        borderRadius: 10,
        background: value ? 'color-mix(in srgb, var(--v3-primary) 12%, transparent)' : 'transparent',
        border: value ? '1px solid color-mix(in srgb, var(--v3-primary) 28%, transparent)' : '1px solid var(--v3-border)',
        color: value ? 'var(--v3-primary-text)' : 'var(--v3-text-muted)',
        fontFamily: 'var(--font-body)',
        fontSize: 12,
        fontWeight: 700,
        letterSpacing: 0,
        cursor: 'pointer',
      }}
    >
      <UserRound size={11} aria-hidden="true" />
      <span style={{ maxWidth: 100, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {label}
      </span>
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Assignee"
        style={{
          position: 'absolute', inset: 0, opacity: 0, cursor: 'pointer',
          appearance: 'none', WebkitAppearance: 'none', MozAppearance: 'none',
          background: 'transparent', border: 'none', color: 'transparent',
        }}
      >
        <option value="">Unassigned</option>
        {members.map((m: any) => (
          <option key={m.user_id} value={m.user_id}>
            {m.is_self ? `${m.name || 'Me'} (me)` : (m.name || m.email || 'Teammate')}
          </option>
        ))}
      </select>
    </label>
  )
}
