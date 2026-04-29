import { useCallback, useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Plus, Trash2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
import { toastSuccess, toastError, toastUndo } from '../../../lib/toast.js'
import { hapticTap } from '../../../lib/haptics.js'
import { SkeletonList } from '../../../components/Skeleton.jsx'

/**
 * To-dos section — backed by fh_job_todos. Owns its own fetch (independent of
 * the parent useJobData lifecycle since the per-tab refresh cost is tiny).
 *
 * Schema: { id, user_id, job_id, text, done, completed_at, created_at }
 *
 * Delete uses toastUndo so a stray tap can be reversed within 6s.
 */
export default function TodosSection({ jobId, userId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState('')

  const fetchRows = useCallback(async () => {
    if (!jobId) return
    setLoading(true)
    const { data } = await supabase
      .from('fh_job_todos')
      .select('*')
      .eq('job_id', jobId)
      .order('done', { ascending: true })
      .order('created_at', { ascending: false })
    setRows(data || [])
    setLoading(false)
  }, [jobId])

  useEffect(() => { fetchRows() }, [fetchRows])

  async function add() {
    const txt = draft.trim()
    if (!txt) return
    hapticTap()
    const { error } = await supabase.from('fh_job_todos').insert({
      user_id: userId, job_id: jobId, text: txt
    })
    if (error) {
      toastError("Couldn't add to-do", error.message)
      return
    }
    setDraft('')
    fetchRows()
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
    if (error) {
      toastError("Couldn't update", error.message)
      fetchRows() // rollback to truth
    }
  }

  async function remove(rowId) {
    hapticTap()
    const snapshot = rows.find((r) => r.id === rowId)
    setRows((rs) => rs.filter((r) => r.id !== rowId)) // optimistic
    const { error } = await supabase.from('fh_job_todos').delete().eq('id', rowId)
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

      {/* Add row */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder="Add a task…"
          style={{
            flex: 1, minWidth: 0,
            padding: '11px 14px', borderRadius: 12,
            background: 'var(--v3-surface)', border: '1px solid var(--v3-border)',
            color: 'var(--v3-text)', fontFamily: 'var(--font-body)',
            fontSize: 14, outline: 'none'
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
                <span style={{
                  flexShrink: 0, fontSize: 10,
                  color: 'var(--v3-text-muted)',
                  fontFamily: 'var(--font-body)',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  {new Date(r.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                </span>
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
