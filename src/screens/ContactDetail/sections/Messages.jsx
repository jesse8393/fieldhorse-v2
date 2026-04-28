import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, FileText } from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
import { toastError } from '../../../lib/toast.js'
import { hapticTap } from '../../../lib/haptics.js'

/**
 * Messages section — communication log (fh_notes) tied to this job.
 * Inline add row + reverse-chronological list.
 *
 * Notes here have category='note' (matches legacy MessagesTab pattern).
 * Other categories (call/text/email logs) come in via the bottom-sheet
 * Text/Email/Call quick actions on Jobs.jsx — same fh_notes table.
 */
export default function MessagesSection({ contactId, userId, notes = [], fetchAll }) {
  const [draft, setDraft] = useState('')
  const [saving, setSaving] = useState(false)

  async function add() {
    const txt = draft.trim()
    if (!txt || saving) return
    hapticTap()
    setSaving(true)
    const { error } = await supabase.from('fh_notes').insert({
      user_id: userId,
      contact_id: contactId,
      text: txt,
      category: 'note'
    })
    setSaving(false)
    if (error) {
      toastError("Couldn't add note", error.message)
      return
    }
    setDraft('')
    fetchAll?.()
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 20px 24px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--v3-text-muted)'
        }}>
          Messages
        </span>
        {notes.length > 0 && (
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 11,
            color: 'var(--v3-text-muted)',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {notes.length} logged
          </span>
        )}
      </div>

      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder="Log a note, call, touchpoint…"
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
          disabled={!draft.trim() || saving}
          aria-label="Log note"
          style={{
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            padding: '0 16px', borderRadius: 12, border: 'none',
            background: 'var(--v3-primary)', color: 'var(--v3-on-primary)',
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
            letterSpacing: '0.04em',
            cursor: draft.trim() && !saving ? 'pointer' : 'default',
            opacity: draft.trim() && !saving ? 1 : 0.5,
            boxShadow: draft.trim() ? '0 6px 18px rgba(212, 175, 55, 0.28)' : 'none',
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          <Plus size={14} aria-hidden="true" />
          {saving ? 'Logging…' : 'Log'}
        </motion.button>
      </div>

      {notes.length === 0 ? (
        <div style={{
          padding: '32px 20px', borderRadius: 14,
          background: 'var(--v3-surface)', border: '1px dashed var(--v3-border-strong)',
          color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
          fontSize: 13, textAlign: 'center', lineHeight: 1.5,
          display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10
        }}>
          <FileText size={28} aria-hidden="true" color="var(--v3-text-muted)" />
          <div>No communications logged. Every touchpoint — call, text, onsite — captured in order.</div>
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <AnimatePresence>
            {notes.map((n, i) => (
              <motion.li
                key={n.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ delay: Math.min(i * 0.03, 0.2), duration: 0.2, ease: [0.2, 0.8, 0.2, 1] }}
                style={{
                  display: 'flex', flexDirection: 'column', gap: 4,
                  padding: '12px 14px', borderRadius: 12,
                  background: 'var(--v3-surface)', border: '1px solid var(--v3-border)'
                }}
              >
                <div style={{
                  fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
                  color: 'var(--v3-text)', lineHeight: 1.45,
                  overflowWrap: 'anywhere'
                }}>
                  {n.text || n.action || 'Note'}
                </div>
                <div style={{
                  fontFamily: 'var(--font-body)', fontSize: 11,
                  color: 'var(--v3-text-muted)',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  {n.category || 'note'} · {new Date(n.created_at).toLocaleString(undefined, {
                    month: 'short', day: 'numeric',
                    hour: 'numeric', minute: '2-digit'
                  })}
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  )
}
