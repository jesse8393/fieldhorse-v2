import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Plus, Trash2, Calendar } from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
import { toastSuccess, toastError, toastUndo } from '../../../lib/toast.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import { SkeletonList } from '../../../components/Skeleton.jsx'
import { dateInputToTimestamp, timestampToDateInput, dueStatus } from '../../../lib/dueDate.ts'

/**
 * To-dos section — backed by fh_job_todos. Owns its own fetch (independent of
 * the parent useJobData lifecycle since the per-tab refresh cost is tiny).
 *
 * Schema: { id, user_id, job_id, text, done, completed_at, created_at, due_at }
 *   due_at (migration 010) is nullable. NextAction sorting + UI are
 *   wired in later phases (2H-3 / 2H-4). For now the column exists,
 *   flows through SELECT *, and is preserved by the snapshot+undo path.
 *
 * Delete uses toastUndo so a stray tap can be reversed within 6s.
 */
export default function TodosSection({ jobId, userId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')
  // Optional due date for the new todo being composed. YYYY-MM-DD or ''.
  // Converted to a local-end-of-day ISO at insert time via dateInputToTimestamp.
  const [dueDraft, setDueDraft] = useState('')

  const fetchRows = useCallback(async () => {
    if (!jobId || !userId) return
    setLoading(true)
    const { data } = await supabase
      .from('fh_job_todos')
      .select('*')
      .eq('job_id', jobId)
      .eq('user_id', userId)
      .order('done', { ascending: true })
      .order('created_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }, [jobId, userId])

  useEffect(() => { fetchRows() }, [fetchRows])

  async function add() {
    const txt = draft.trim()
    if (!txt) return
    hapticTap()
    const payload = { user_id: userId, job_id: jobId, text: txt }
    if (dueDraft) payload.due_at = dateInputToTimestamp(dueDraft)
    const { error } = await supabase.from('fh_job_todos').insert(payload)
    if (error) {
      toastError("Couldn't add to-do", error.message)
      return
    }
    setDraft('')
    setDueDraft('')
    fetchRows()
  }

  // Inline edit: tap a row's due chip → native date picker → onChange
  // fires here. Optimistic update with rollback on Supabase error.
  async function updateDueAt(rowId, nextDueAt) {
    setRows((rs) => rs.map((r) => r.id === rowId ? { ...r, due_at: nextDueAt } : r))
    const { error } = await supabase
      .from('fh_job_todos')
      .update({ due_at: nextDueAt })
      .eq('id', rowId)
      .eq('user_id', userId)
    if (error) {
      toastError("Couldn't update due date", error.message)
      fetchRows()
    }
  }

  async function toggle(row) {
    hapticTap()
    const next = !row.done
    // Optimistic
    setRows((rs) => rs.map((r) => r.id === row.id
      ? { ...r, done: next, completed_at: next ? new Date().toISOString() : null }
      : r
    ))
    const { error } = await supabase
      .from('fh_job_todos')
      .update({ done: next, completed_at: next ? new Date().toISOString() : null })
      .eq('id', row.id)
      .eq('user_id', userId)
    if (error) {
      toastError("Couldn't update", error.message)
      fetchRows() // rollback to truth
    }
  }

  async function remove(rowId) {
    hapticTap()
    const snapshot = rows.find((r) => r.id === rowId)
    setRows((rs) => rs.filter((r) => r.id !== rowId)) // optimistic
    const { error } = await supabase.from('fh_job_todos').delete().eq('id', rowId).eq('user_id', userId)
    if (error) { toastError("Couldn't delete", error.message); fetchRows(); return }
    toastUndo('Task deleted', {
      description: (snapshot?.text || '').slice(0, 60) || 'Tap Undo to restore',
      onUndo: async () => {
        if (!snapshot) return
        const { error: insErr } = await supabase.from('fh_job_todos').insert(snapshot)
        if (insErr) { toastError("Couldn't undo", insErr.message); return }
        fetchRows()
        toastSuccess('Restored')
      }
    })
  }

  const undoneCount = rows.filter((r) => !r.done).length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 20px 24px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 10,
          fontWeight: 700,
          letterSpacing: '0.16em',
          textTransform: 'uppercase',
          color: 'var(--v3-text-muted)'
        }}>
          To-dos
        </span>
        {rows.length > 0 && (
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 11,
            fontWeight: 700,
            color: undoneCount === 0 ? 'var(--v3-success-bright)' : 'var(--v3-primary)',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {undoneCount === 0 ? 'All clear' : `${undoneCount} pending`}
          </span>
        )}
      </div>

      {/* Add row — text + optional due date + Add. Wraps to two rows on
          narrow viewports so the text input keeps its full width. */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder="Add a task…"
          style={{
            flex: '1 1 200px', minWidth: 0,
            padding: '11px 14px', borderRadius: 12,
            background: 'var(--v3-surface)', border: '1px solid var(--v3-border)',
            color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
            fontSize: 14, outline: 'none'
          }}
        />
        <input
          type="date"
          value={dueDraft}
          onChange={(e) => setDueDraft(e.target.value)}
          aria-label="Due date (optional)"
          style={{
            flex: '0 0 auto',
            padding: '11px 12px', borderRadius: 12,
            background: 'var(--v3-surface)', border: '1px solid var(--v3-border)',
            color: dueDraft ? 'var(--v3-text)' : 'var(--v3-text-muted)',
            fontFamily: 'var(--font-body)',
            fontSize: 13, outline: 'none',
            WebkitTapHighlightColor: 'transparent'
          }}
        />
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={add}
          disabled={!draft.trim()}
          aria-label="Add task"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '0 16px', borderRadius: 12, border: 'none',
            background: 'var(--v3-primary)', color: 'var(--v3-on-primary)',
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
            letterSpacing: '0.04em',
            cursor: draft.trim() ? 'pointer' : 'default',
            opacity: draft.trim() ? 1 : 0.5,
            boxShadow: draft.trim() ? '0 6px 18px rgba(212, 175, 55, 0.28)' : 'none',
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          <Plus size={14} aria-hidden="true" />
          Add
        </motion.button>
      </div>

      {loading && <SkeletonList rows={3} card={false} />}
      {!loading && rows.length === 0 && (
        <div style={{
          padding: '20px 18px', borderRadius: 14,
          background: 'var(--v3-surface)', border: '1px dashed var(--v3-border-strong)',
          color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
          fontSize: 13, textAlign: 'center'
        }}>
          No tasks yet. Field crew gets shorter days when this list is full.
        </div>
      )}

      {!loading && rows.length > 0 && (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <AnimatePresence>
            {rows.map((r) => (
              <motion.li
                key={r.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 14px', borderRadius: 12,
                  background: 'var(--v3-surface)', border: '1px solid var(--v3-border)'
                }}
              >
                <button
                  type="button"
                  onClick={() => toggle(r)}
                  aria-label={r.done ? 'Mark not done' : 'Mark done'}
                  style={{
                    flexShrink: 0, width: 22, height: 22, borderRadius: 7,
                    border: r.done
                      ? '1px solid color-mix(in srgb, var(--v3-success-bright) 60%, transparent)'
                      : '1px solid var(--v3-border-strong)',
                    background: r.done ? 'rgba(46, 204, 113, 0.18)' : 'transparent',
                    color: 'var(--v3-success-bright)',
                    cursor: 'pointer',
                    display: 'grid', placeItems: 'center',
                    transition: 'background 160ms ease, border-color 160ms ease'
                  }}
                >
                  {r.done && <Check size={13} aria-hidden="true" />}
                </button>
                <span style={{
                  flex: 1, minWidth: 0,
                  fontFamily: 'var(--font-body)', fontSize: 14,
                  color: r.done ? 'var(--v3-text-muted)' : 'var(--v3-text)',
                  textDecoration: r.done ? 'line-through' : 'none',
                  overflowWrap: 'anywhere'
                }}>
                  {r.text}
                </span>
                <DueChipButton
                  iso={r.due_at}
                  done={r.done}
                  onChange={(nextIso) => updateDueAt(r.id, nextIso)}
                />
                <button
                  type="button"
                  onClick={() => remove(r.id)}
                  aria-label="Delete task"
                  style={{
                    flexShrink: 0, width: 28, height: 28, borderRadius: 8,
                    border: 'none', background: 'transparent',
                    color: 'var(--v3-text-muted)', cursor: 'pointer',
                    display: 'grid', placeItems: 'center'
                  }}
                >
                  <Trash2 size={13} aria-hidden="true" />
                </button>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  )
}

/**
 * DueChipButton — wraps a hidden <input type="date"> in a <label> so
 * tapping the chip opens the native date picker. When iso is set:
 * status chip (Overdue red / Today gold / muted future date). When
 * iso is null: a quiet calendar icon serves as the "set due date"
 * affordance — no labeled chip is shown, but the tap target stays.
 */
function DueChipButton({ iso, done, onChange }) {
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
        color: 'var(--v3-danger-bright)'
      }
    }
    if (status.tone === 'warn') {
      return {
        bg: 'var(--v3-primary-soft)',
        border: 'color-mix(in srgb, var(--v3-primary) 35%, transparent)',
        color: 'var(--v3-primary)'
      }
    }
    return { bg: 'var(--v3-surface-2)', border: 'var(--v3-border)', color: 'var(--v3-text-muted)' }
  })()

  return (
    <label
      style={{
        position: 'relative',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        gap: 4,
        flexShrink: 0,
        minWidth: 40, minHeight: 28,
        padding: status ? '0 9px' : 0,
        borderRadius: 999,
        background: palette.bg,
        border: status ? `1px solid ${palette.border}` : `1px solid transparent`,
        color: palette.color,
        fontFamily: 'var(--font-body)',
        fontSize: 10, fontWeight: 700,
        letterSpacing: '0.06em',
        textTransform: 'uppercase',
        whiteSpace: 'nowrap',
        opacity: done ? 0.5 : 1,
        cursor: 'pointer',
        WebkitTapHighlightColor: 'transparent'
      }}
      aria-label={status ? `Due ${status.label}` : 'Set due date'}
    >
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
    </label>
  )
}
