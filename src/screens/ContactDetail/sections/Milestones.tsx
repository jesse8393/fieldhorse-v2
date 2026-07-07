import { useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Plus, Trash2 } from 'lucide-react'
import { hapticTap } from '../../../lib/haptics.ts'
import { Eyebrow } from '../../../components/v3'

/**
 * Milestones section — operator-defined checklist persisted as JSONB on
 * fh_contacts.milestones. Each item: { label, done, created_at }.
 *
 * Mutations go through `patch({ milestones: next })` (optimistic update +
 * sync via the parent's useJobData hook). Order is operator-meaningful;
 * we never sort.
 */
export default function MilestonesSection({ contact, patch }: any) {
  const list = useMemo(
    () => Array.isArray(contact?.milestones) ? contact.milestones : [],
    [contact?.milestones]
  )
  const [draft, setDraft] = useState('')
  const doneCount = list.filter((m: any) => m.done).length

  async function add() {
    const txt = draft.trim()
    if (!txt) return
    hapticTap()
    const next = [...list, { label: txt, done: false, created_at: new Date().toISOString() }]
    setDraft('')
    await patch({ milestones: next })
  }

  async function toggle(i: any) {
    hapticTap()
    const next = list.map((m: any, idx: any) => idx === i ? { ...m, done: !m.done } : m)
    await patch({ milestones: next })
  }

  async function remove(i: any) {
    hapticTap()
    const next = list.filter((_: any, idx: any) => idx !== i)
    await patch({ milestones: next })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 20px 24px' }}>

      {/* Progress eyebrow */}
      <div style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8
      }}>
        <Eyebrow>
          Milestones
        </Eyebrow>
        {list.length > 0 && (
          <span style={{
            fontFamily: 'var(--font-body)',
            fontSize: 11,
            fontWeight: 700,
            color: doneCount === list.length ? 'var(--v3-success-bright)' : 'var(--v3-primary)',
            fontVariantNumeric: 'tabular-nums'
          }}>
            {doneCount} / {list.length}
          </span>
        )}
      </div>

      {/* Inline add row */}
      <div style={{ display: 'flex', gap: 8 }}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          placeholder="Add milestone…"
          style={{
            flex: 1,
            minWidth: 0,
            padding: '11px 14px',
            borderRadius: 12,
            background: 'var(--v3-surface)',
            border: '1px solid var(--v3-border)',
            color: 'var(--v3-text)',
            fontFamily: 'var(--font-body)',
            fontSize: 14,
            outline: 'none'
          }}
        />
        <motion.button
          type="button"
          whileTap={{ scale: 0.96 }}
          onClick={add}
          disabled={!draft.trim()}
          aria-label="Add milestone"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 6,
            padding: '0 16px',
            borderRadius: 12,
            border: 'none',
            background: 'var(--v3-primary)',
            color: 'var(--v3-on-primary)',
            fontFamily: 'var(--font-body)',
            fontSize: 12,
            fontWeight: 700,
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

      {/* List */}
      {list.length === 0 ? (
        <EmptyMini label="No milestones yet. Drop in the first checkpoint above." />
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <AnimatePresence>
            {list.map((m: any, i: any) => (
              <motion.li
                key={`${m.created_at || ''}-${i}-${m.label}`}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 12,
                  padding: '12px 14px',
                  borderRadius: 12,
                  background: 'var(--v3-surface)',
                  border: '1px solid var(--v3-border)'
                }}
              >
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  aria-label={m.done ? 'Uncheck milestone' : 'Check milestone'}
                  style={{
                    flexShrink: 0,
                    width: 22,
                    height: 22,
                    borderRadius: 7,
                    border: m.done
                      ? '1px solid color-mix(in srgb, var(--v3-success-bright) 60%, transparent)'
                      : '1px solid var(--v3-border-strong)',
                    background: m.done ? 'rgba(46, 204, 113, 0.18)' : 'transparent',
                    color: 'var(--v3-success-bright)',
                    cursor: 'pointer',
                    display: 'grid',
                    placeItems: 'center',
                    transition: 'background 160ms ease, border-color 160ms ease'
                  }}
                >
                  {m.done && <Check size={13} aria-hidden="true" />}
                </button>
                <span style={{
                  flex: 1,
                  minWidth: 0,
                  fontFamily: 'var(--font-body)',
                  fontSize: 14,
                  color: m.done ? 'var(--v3-text-muted)' : 'var(--v3-text)',
                  textDecoration: m.done ? 'line-through' : 'none',
                  overflowWrap: 'anywhere'
                }}>
                  {m.label}
                </span>
                <button
                  type="button"
                  onClick={() => remove(i)}
                  aria-label="Delete milestone"
                  style={{
                    flexShrink: 0,
                    width: 28,
                    height: 28,
                    borderRadius: 8,
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--v3-text-muted)',
                    cursor: 'pointer',
                    display: 'grid',
                    placeItems: 'center'
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

function EmptyMini({ label }: any) {
  return (
    <div style={{
      padding: '20px 18px',
      borderRadius: 14,
      background: 'var(--v3-surface)',
      border: '1px dashed var(--v3-border-strong)',
      color: 'var(--v3-text-muted)',
      fontFamily: 'var(--font-body)',
      fontSize: 13,
      textAlign: 'center',
      lineHeight: 1.5
    }}>
      {label}
    </div>
  )
}
