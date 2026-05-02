import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Receipt, Plus, Pencil, Trash2, ChevronUp, ChevronDown, Check, X as XIcon } from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
import { toastError, toastSuccess, toastUndo } from '../../../lib/toast.js'
import { hapticTap } from '../../../lib/haptics.js'
import { SkeletonList } from '../../../components/Skeleton.jsx'

/**
 * Quote items section — fh_quote_items CRUD editor.
 *
 * Phase 4A-3: full line-item editor. Operators add, edit, reorder,
 * and delete quote rows. The recalc trigger from migration 011 keeps
 * fh_contacts.amount in sync with the sum of base items
 * (is_optional=false AND is_excluded=false) on every write.
 *
 * Schema: { id, user_id, contact_id, section, description, qty, unit,
 *           rate, amount, notes, is_optional, is_excluded, sort_order,
 *           created_at, updated_at }
 *
 * RLS: owner all (user_id = auth.uid()) + accepted partner all (via
 * fh_job_partners). Phase 2B explicit user_id guards on every read /
 * write are preserved.
 */

const SECTION_SUGGESTIONS = ['Labor', 'Materials', 'Subs', 'Equipment', 'Other']

// Mobile keyboard fix — when an input gains focus, the soft keyboard
// commonly covers the active field on phones. Defer the scroll until
// the keyboard has had a moment to appear, then center the input in
// the visible viewport. No-op on desktop (already-visible inputs ignore
// scrollIntoView). Used on every DraftCard input + textarea.
function scrollIntoCenterOnFocus(e) {
  const el = e.currentTarget
  setTimeout(() => {
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch {}
  }, 250)
}

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2
  })
}

function emptyDraft() {
  return {
    section: '',
    description: '',
    qty: '1',
    unit: '',
    rate: '0',
    amount: '0',
    amountOverridden: false,
    notes: '',
    is_optional: false,
    is_excluded: false
  }
}

function draftFromRow(row) {
  // amountOverridden seeds true on edit so changing qty/rate does not
  // silently overwrite an intentionally-set amount on an existing row.
  // Operators can still edit the amount field directly. Add-mode keeps
  // auto-recompute because new rows have no source-of-truth amount yet.
  return {
    section: row.section || '',
    description: row.description || '',
    qty: row.qty != null ? String(row.qty) : '1',
    unit: row.unit || '',
    rate: row.rate != null ? String(row.rate) : '0',
    amount: row.amount != null ? String(row.amount) : '0',
    amountOverridden: true,
    notes: row.notes || '',
    is_optional: !!row.is_optional,
    is_excluded: !!row.is_excluded
  }
}

// Validate a draft before write. Returns null on success, or an error
// message string. Description requirement is enforced in handlers via
// the disabled state, but mirrored here for defense in depth. Numeric
// fields are guarded against negatives and NaN — HTML `min="0"` is not
// reliably enforced on submit, so we re-check at the JS boundary.
// Credit lines (negative amounts) are deferred to a later phase.
function validateDraft(d) {
  if (!d.description || !d.description.trim()) return 'Description is required'
  const qty = Number(d.qty)
  const rate = Number(d.rate)
  const amount = Number(d.amount)
  if (!Number.isFinite(qty) || qty < 0) return 'Qty must be a number ≥ 0'
  if (!Number.isFinite(rate) || rate < 0) return 'Rate must be a number ≥ 0'
  if (!Number.isFinite(amount) || amount < 0) return 'Amount must be a number ≥ 0'
  return null
}

function normalizeForDB(d) {
  return {
    section: d.section?.trim() || null,
    description: d.description.trim(),
    qty: Number(d.qty),
    unit: d.unit?.trim() || null,
    rate: Number(d.rate),
    amount: Number(d.amount),
    notes: d.notes?.trim() || null,
    is_optional: !!d.is_optional,
    is_excluded: !!d.is_excluded
  }
}

export default function QuoteItemsSection({ jobId, userId, onContactRefresh }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

  const [draft, setDraft] = useState(emptyDraft)
  const [adding, setAdding] = useState(false)

  const [editingId, setEditingId] = useState(null)
  const [editDraft, setEditDraft] = useState(emptyDraft)
  const [editing, setEditing] = useState(false)

  const fetchRows = useCallback(async () => {
    if (!jobId || !userId) return
    setLoading(true)
    const { data } = await supabase
      .from('fh_quote_items')
      .select('*')
      .eq('contact_id', jobId)
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    setRows(data || [])
    setLoading(false)
  }, [jobId, userId])

  useEffect(() => { fetchRows() }, [fetchRows])

  // ============================================================
  // CRUD — all writes user_id-guarded. The migration-011 recalc
  // trigger fires on each write and keeps fh_contacts.amount synced.
  // ============================================================

  async function addItem(input) {
    if (!jobId || !userId) return null
    if (!input.description) {
      toastError("Couldn't add item", 'Description is required')
      return null
    }
    const payload = {
      user_id: userId,
      contact_id: jobId,
      ...input,
      sort_order: Number.isFinite(input.sort_order) ? input.sort_order : rows.length
    }
    const { data, error } = await supabase
      .from('fh_quote_items')
      .insert(payload)
      .select()
      .single()
    if (error) {
      toastError("Couldn't add item", error.message)
      return null
    }
    await fetchRows()
    onContactRefresh?.()
    return data
  }

  async function updateItem(id, patch) {
    if (!id || !userId) return false
    const { error } = await supabase
      .from('fh_quote_items')
      .update(patch)
      .eq('id', id)
      .eq('user_id', userId)
    if (error) {
      toastError("Couldn't update item", error.message)
      return false
    }
    await fetchRows()
    onContactRefresh?.()
    return true
  }

  async function removeItem(id) {
    if (!id || !userId) return false
    hapticTap()
    const snapshot = rows.find((r) => r.id === id)
    setRows((rs) => rs.filter((r) => r.id !== id))
    const { error } = await supabase
      .from('fh_quote_items')
      .delete()
      .eq('id', id)
      .eq('user_id', userId)
    if (error) {
      toastError("Couldn't delete item", error.message)
      fetchRows()
      return false
    }
    onContactRefresh?.()
    toastUndo('Line item deleted', {
      description: (snapshot?.description || '').slice(0, 60) || 'Tap Undo to restore',
      onUndo: async () => {
        if (!snapshot) return
        const { error: insErr } = await supabase.from('fh_quote_items').insert(snapshot)
        if (insErr) { toastError("Couldn't undo", insErr.message); return }
        await fetchRows()
        onContactRefresh?.()
        toastSuccess('Restored')
      }
    })
    return true
  }

  async function reorderItem(id, direction) {
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return false
    const targetIdx = idx + direction
    if (targetIdx < 0 || targetIdx >= rows.length) return false
    hapticTap()
    const a = rows[idx]
    const b = rows[targetIdx]
    const aOrder = a.sort_order
    const bOrder = b.sort_order
    setRows((rs) => {
      const next = rs.slice()
      next[idx] = { ...a, sort_order: bOrder }
      next[targetIdx] = { ...b, sort_order: aOrder }
      return next.sort((x, y) => x.sort_order - y.sort_order)
    })
    const [r1, r2] = await Promise.all([
      supabase.from('fh_quote_items').update({ sort_order: bOrder }).eq('id', a.id).eq('user_id', userId),
      supabase.from('fh_quote_items').update({ sort_order: aOrder }).eq('id', b.id).eq('user_id', userId)
    ])
    if (r1.error || r2.error) {
      toastError("Couldn't reorder", (r1.error || r2.error).message)
      fetchRows()
      return false
    }
    return true
  }

  // ============================================================
  // Form handlers — add + edit share the same draft shape.
  // Auto-recompute amount when qty or rate change unless the
  // operator has explicitly overridden the amount field.
  // is_optional and is_excluded are mutually exclusive.
  // ============================================================

  function patchDraft(setter, key, value) {
    setter((d) => {
      const next = { ...d, [key]: value }
      if (key === 'qty' || key === 'rate') {
        if (!d.amountOverridden) {
          const qty = Number(key === 'qty' ? value : d.qty)
          const rate = Number(key === 'rate' ? value : d.rate)
          if (Number.isFinite(qty) && Number.isFinite(rate)) {
            next.amount = String(+(qty * rate).toFixed(2))
          }
        }
      }
      if (key === 'amount') {
        next.amountOverridden = true
      }
      if (key === 'is_optional' && value) {
        next.is_excluded = false
      }
      if (key === 'is_excluded' && value) {
        next.is_optional = false
      }
      return next
    })
  }

  async function handleAdd() {
    if (adding) return
    const err = validateDraft(draft)
    if (err) { toastError("Couldn't add item", err); return }
    setAdding(true)
    const inserted = await addItem({
      ...normalizeForDB(draft),
      sort_order: rows.length
    })
    setAdding(false)
    if (inserted) setDraft(emptyDraft())
  }

  function beginEdit(row) {
    setEditingId(row.id)
    setEditDraft(draftFromRow(row))
  }

  function cancelEdit() {
    setEditingId(null)
    setEditDraft(emptyDraft())
  }

  async function saveEdit() {
    if (!editingId || editing) return
    const err = validateDraft(editDraft)
    if (err) { toastError("Couldn't save changes", err); return }
    setEditing(true)
    const ok = await updateItem(editingId, normalizeForDB(editDraft))
    setEditing(false)
    if (ok) {
      setEditingId(null)
      setEditDraft(emptyDraft())
    }
  }

  // ============================================================
  // Derived totals — pure, no DB call.
  // ============================================================
  const totals = useMemo(() => {
    let base = 0
    let optional = 0
    let excluded = 0
    for (const r of rows) {
      const amt = Number(r.amount || 0)
      if (r.is_excluded) excluded += amt
      else if (r.is_optional) optional += amt
      else base += amt
    }
    return { count: rows.length, base, optional, excluded }
  }, [rows])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 20px 32px' }}>
      <section
        className="v3-section v3-section--primary-quiet"
        style={{ margin: 0, padding: '16px 18px' }}
      >
        <span className="v3-eyebrow" style={{ color: 'var(--v3-primary)' }}>
          <Receipt size={11} aria-hidden="true" style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Quote
        </span>
        <h2 style={{
          margin: '6px 0 0',
          fontSize: 'clamp(20px, 5vw, 26px)',
          lineHeight: 1.1,
          letterSpacing: '-0.015em',
          fontWeight: 600,
          color: 'var(--v3-text)'
        }}>
          Line items
        </h2>

        {/* Totals row — appears once items exist. Base = what fh_contacts.amount
            becomes via the recalc trigger. Optional/Excluded shown only when > 0. */}
        {!loading && rows.length > 0 && (
          <div style={{
            marginTop: 14,
            display: 'flex',
            alignItems: 'baseline',
            gap: 18,
            flexWrap: 'wrap'
          }}>
            <Stat label="Items" value={String(totals.count)} />
            <Divider />
            <Stat label="Base" value={money(totals.base)} tone="gold" />
            {totals.optional > 0 && (
              <>
                <Divider />
                <Stat label="Optional" value={money(totals.optional)} />
              </>
            )}
            {totals.excluded > 0 && (
              <>
                <Divider />
                <Stat label="Excluded" value={money(totals.excluded)} tone="muted" />
              </>
            )}
          </div>
        )}

        <p style={{
          margin: '12px 0 0',
          fontFamily: 'var(--font-body)',
          fontSize: 11,
          lineHeight: 1.5,
          color: 'var(--v3-text-muted)'
        }}>
          Base subtotal is what syncs to <code style={{ fontFamily: 'inherit' }}>fh_contacts.amount</code> through the DB trigger. Optional and excluded rows are listed for the customer but never roll up.
        </p>
      </section>

      {/* Add line item */}
      <DraftCard
        eyebrow="Add line item"
        draft={draft}
        onChange={(k, v) => patchDraft(setDraft, k, v)}
        primaryLabel={adding ? 'Adding…' : 'Add line item'}
        onPrimary={handleAdd}
        primaryDisabled={!draft.description.trim() || adding}
        showCancel={false}
      />

      {/* Items list */}
      {loading ? (
        <SkeletonList rows={3} card={false} />
      ) : rows.length === 0 ? (
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
          No line items yet. Build your quote by adding the first one above.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AnimatePresence>
            {rows.map((r, i) => editingId === r.id ? (
              <motion.li
                key={r.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
              >
                <DraftCard
                  eyebrow="Edit line item"
                  draft={editDraft}
                  onChange={(k, v) => patchDraft(setEditDraft, k, v)}
                  primaryLabel={editing ? 'Saving…' : 'Save changes'}
                  onPrimary={saveEdit}
                  primaryDisabled={!editDraft.description.trim() || editing}
                  showCancel
                  onCancel={cancelEdit}
                />
              </motion.li>
            ) : (
              <ItemRow
                key={r.id}
                row={r}
                isFirst={i === 0}
                isLast={i === rows.length - 1}
                onEdit={() => beginEdit(r)}
                onDelete={() => removeItem(r.id)}
                onMoveUp={() => reorderItem(r.id, -1)}
                onMoveDown={() => reorderItem(r.id, 1)}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}
    </div>
  )
}

/* ============================================================
   ItemRow — collapsed view of a single quote item.
   ============================================================ */
function ItemRow({ row, isFirst, isLast, onEdit, onDelete, onMoveUp, onMoveDown }) {
  const isOptional = !!row.is_optional && !row.is_excluded
  const isExcluded = !!row.is_excluded
  const dim = isExcluded ? 0.55 : isOptional ? 0.85 : 1

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      style={{
        padding: '12px 14px',
        borderRadius: 12,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        opacity: dim
      }}
    >
      {/* Top row — section eyebrow + amount */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          {row.section && (
            <span style={{
              display: 'inline-flex', alignItems: 'center',
              padding: '2px 8px', borderRadius: 999,
              background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)',
              color: 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
              letterSpacing: '0.10em', textTransform: 'uppercase'
            }}>
              {row.section}
            </span>
          )}
          {isOptional && <StatusChip label="Optional" tone="gold" />}
          {isExcluded && <StatusChip label="Excluded" tone="muted" />}
        </div>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 18, lineHeight: 1, letterSpacing: '0.02em',
          color: isExcluded ? 'var(--v3-text-muted)' : 'var(--v3-text)',
          fontVariantNumeric: 'tabular-nums',
          textDecoration: isExcluded ? 'line-through' : 'none'
        }}>
          {money(row.amount)}
        </span>
      </div>

      {/* Description */}
      <div style={{
        fontFamily: 'var(--font-body)',
        fontSize: 14, fontWeight: 600,
        color: 'var(--v3-text)',
        lineHeight: 1.35,
        overflowWrap: 'anywhere'
      }}>
        {row.description}
      </div>

      {/* qty × rate sub-line */}
      {(Number(row.qty) > 0 || Number(row.rate) > 0) && (
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 12,
          color: 'var(--v3-text-muted)',
          fontVariantNumeric: 'tabular-nums'
        }}>
          {Number(row.qty).toLocaleString()} {row.unit || 'unit'}{Number(row.qty) === 1 ? '' : 's'} × {money(row.rate)}
        </div>
      )}

      {/* Notes */}
      {row.notes && (
        <div style={{
          fontFamily: 'var(--font-body)',
          fontSize: 12,
          color: 'var(--v3-text-muted)',
          fontStyle: 'italic',
          lineHeight: 1.4,
          overflowWrap: 'anywhere'
        }}>
          {row.notes}
        </div>
      )}

      {/* Actions — ↑ ↓ edit delete. Each ≥40px tap target. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginTop: 2, flexWrap: 'wrap' }}>
        <RowActionButton ariaLabel="Move up" onClick={onMoveUp} disabled={isFirst}>
          <ChevronUp size={16} />
        </RowActionButton>
        <RowActionButton ariaLabel="Move down" onClick={onMoveDown} disabled={isLast}>
          <ChevronDown size={16} />
        </RowActionButton>
        <RowActionButton ariaLabel="Edit line item" onClick={onEdit}>
          <Pencil size={14} />
        </RowActionButton>
        <RowActionButton ariaLabel="Delete line item" onClick={onDelete} tone="danger">
          <Trash2 size={14} />
        </RowActionButton>
      </div>
    </motion.li>
  )
}

function RowActionButton({ children, ariaLabel, onClick, disabled, tone }) {
  const color = disabled
    ? 'var(--v3-text-faint)'
    : tone === 'danger'
      ? 'var(--v3-text-muted)'
      : 'var(--v3-text-muted)'
  return (
    <button
      type="button"
      aria-label={ariaLabel}
      onClick={onClick}
      disabled={disabled}
      onMouseEnter={(e) => {
        if (disabled) return
        e.currentTarget.style.color = tone === 'danger'
          ? 'var(--v3-danger-bright)'
          : 'var(--v3-text)'
      }}
      onMouseLeave={(e) => {
        if (disabled) return
        e.currentTarget.style.color = 'var(--v3-text-muted)'
      }}
      style={{
        width: 40, height: 40, borderRadius: 10,
        border: 'none', background: 'transparent',
        color,
        cursor: disabled ? 'default' : 'pointer',
        display: 'grid', placeItems: 'center',
        opacity: disabled ? 0.4 : 1,
        WebkitTapHighlightColor: 'transparent'
      }}
    >
      {children}
    </button>
  )
}

function StatusChip({ label, tone }) {
  const palette = tone === 'gold'
    ? {
        bg: 'var(--v3-primary-soft)',
        border: 'color-mix(in srgb, var(--v3-primary) 35%, transparent)',
        color: 'var(--v3-primary)'
      }
    : {
        bg: 'var(--v3-surface-2)',
        border: 'var(--v3-border)',
        color: 'var(--v3-text-muted)'
      }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '2px 8px', borderRadius: 999,
      background: palette.bg, border: `1px solid ${palette.border}`,
      color: palette.color,
      fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
      letterSpacing: '0.10em', textTransform: 'uppercase',
      fontStyle: tone === 'muted' ? 'italic' : 'normal'
    }}>
      {label}
    </span>
  )
}

/* ============================================================
   DraftCard — shared form layout for both Add and Edit.
   ============================================================ */
function DraftCard({ eyebrow, draft, onChange, primaryLabel, onPrimary, primaryDisabled, showCancel, onCancel }) {
  return (
    <div style={{
      padding: '14px 16px',
      borderRadius: 14,
      background: 'var(--v3-surface)',
      border: '1px solid var(--v3-border)',
      display: 'flex',
      flexDirection: 'column',
      gap: 10
    }}>
      <span className="v3-eyebrow" style={{ color: 'var(--v3-text-muted)' }}>
        {eyebrow}
      </span>

      {/* Description (full width) */}
      <FormField label="Description" required>
        <input
          type="text"
          value={draft.description}
          onChange={(e) => onChange('description', e.target.value)}
          onFocus={scrollIntoCenterOnFocus}
          placeholder="What's this line for?"
          style={inputStyle}
        />
      </FormField>

      {/* Numeric row — section / qty / unit / rate / amount. Wraps on narrow viewports. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 10
      }}>
        <FormField label="Section">
          <input
            type="text"
            value={draft.section}
            onChange={(e) => onChange('section', e.target.value)}
            onFocus={scrollIntoCenterOnFocus}
            list="quote-section-suggestions"
            placeholder="Materials, Labor…"
            style={inputStyle}
          />
          <datalist id="quote-section-suggestions">
            {SECTION_SUGGESTIONS.map((s) => <option key={s} value={s} />)}
          </datalist>
        </FormField>
        <FormField label="Qty">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={draft.qty}
            onChange={(e) => onChange('qty', e.target.value)}
            onFocus={scrollIntoCenterOnFocus}
            style={inputStyle}
          />
        </FormField>
        <FormField label="Unit">
          <input
            type="text"
            value={draft.unit}
            onChange={(e) => onChange('unit', e.target.value)}
            onFocus={scrollIntoCenterOnFocus}
            placeholder="ea, hr, sf…"
            style={inputStyle}
          />
        </FormField>
        <FormField label="Rate">
          <input
            type="number"
            inputMode="decimal"
            min="0"
            step="any"
            value={draft.rate}
            onChange={(e) => onChange('rate', e.target.value)}
            onFocus={scrollIntoCenterOnFocus}
            style={inputStyle}
          />
        </FormField>
        <FormField label="Amount">
          <input
            type="number"
            inputMode="decimal"
            step="any"
            value={draft.amount}
            onChange={(e) => onChange('amount', e.target.value)}
            onFocus={scrollIntoCenterOnFocus}
            style={inputStyle}
          />
        </FormField>
      </div>

      {/* Notes */}
      <FormField label="Notes">
        <input
          type="text"
          value={draft.notes}
          onChange={(e) => onChange('notes', e.target.value)}
          onFocus={scrollIntoCenterOnFocus}
          placeholder="Optional"
          style={inputStyle}
        />
      </FormField>

      {/* Toggles */}
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        <ToggleField
          label="Optional add-on"
          checked={draft.is_optional}
          onChange={(v) => onChange('is_optional', v)}
        />
        <ToggleField
          label="Excluded (out of scope)"
          checked={draft.is_excluded}
          onChange={(v) => onChange('is_excluded', v)}
        />
      </div>

      {/* Action row */}
      <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
        {showCancel && (
          <motion.button
            type="button"
            whileTap={{ scale: 0.98 }}
            onClick={onCancel}
            style={{
              flex: '1 1 auto',
              minHeight: 44,
              padding: '12px 14px',
              borderRadius: 12,
              background: 'var(--v3-surface-2)',
              border: '1px solid var(--v3-border)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)',
              fontSize: 13, fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
              WebkitTapHighlightColor: 'transparent'
            }}
          >
            <XIcon size={14} aria-hidden="true" />
            Cancel
          </motion.button>
        )}
        <motion.button
          type="button"
          whileTap={{ scale: primaryDisabled ? 1 : 0.98 }}
          onClick={onPrimary}
          disabled={primaryDisabled}
          style={{
            flex: showCancel ? '2 1 auto' : '1 1 auto',
            minHeight: 44,
            padding: '12px 14px',
            borderRadius: 12,
            border: 'none',
            background: primaryDisabled
              ? 'var(--v3-surface-2)'
              : 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
            color: primaryDisabled ? 'var(--v3-text-muted)' : 'var(--v3-on-primary)',
            fontFamily: 'var(--font-body)',
            fontSize: 13, fontWeight: 700, letterSpacing: '0.04em',
            cursor: primaryDisabled ? 'default' : 'pointer',
            opacity: primaryDisabled ? 0.6 : 1,
            boxShadow: primaryDisabled ? 'none' : '0 0 0 2px rgba(228, 190, 111, 0.10), 0 4px 12px rgba(229, 193, 88, 0.18)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
            WebkitTapHighlightColor: 'transparent'
          }}
        >
          {showCancel ? <Check size={14} aria-hidden="true" /> : <Plus size={14} aria-hidden="true" />}
          {primaryLabel}
        </motion.button>
      </div>
    </div>
  )
}

function FormField({ label, required, children }) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 10, fontWeight: 700, letterSpacing: '0.10em',
        textTransform: 'uppercase', color: 'var(--v3-text-muted)'
      }}>
        {label}{required ? ' *' : ''}
      </span>
      {children}
    </label>
  )
}

function ToggleField({ label, checked, onChange }) {
  return (
    <label style={{
      display: 'inline-flex', alignItems: 'center', gap: 8,
      padding: '8px 12px', borderRadius: 12,
      background: checked ? 'var(--v3-surface-2)' : 'transparent',
      border: `1px solid ${checked ? 'color-mix(in srgb, var(--v3-primary) 35%, transparent)' : 'var(--v3-border)'}`,
      cursor: 'pointer',
      flex: '0 1 auto',
      WebkitTapHighlightColor: 'transparent',
      transition: 'background 160ms ease, border-color 160ms ease'
    }}>
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        style={{ width: 16, height: 16, accentColor: 'var(--v3-primary)', margin: 0, cursor: 'pointer' }}
      />
      <span style={{
        fontFamily: 'var(--font-body)',
        fontSize: 12, fontWeight: 600,
        color: checked ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
        whiteSpace: 'nowrap'
      }}>
        {label}
      </span>
    </label>
  )
}

const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '11px 13px',
  borderRadius: 10,
  background: 'var(--v3-surface-2)',
  border: '1px solid var(--v3-border)',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  outline: 'none',
  fontVariantNumeric: 'tabular-nums',
  // Mobile keyboard defense — when the browser auto-scroll-into-view
  // fires on focus, scroll-margin tells it to leave keyboard room
  // below the field. Companion to scrollIntoCenterOnFocus().
  scrollMarginBottom: 320
}

function Stat({ label, value, tone = 'default' }) {
  const valueColor = tone === 'gold'
    ? 'var(--v3-primary)'
    : tone === 'muted'
      ? 'var(--v3-text-muted)'
      : 'var(--v3-text)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 6 }}>
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: 22, lineHeight: 1, letterSpacing: '0.02em',
        color: valueColor,
        fontVariantNumeric: 'tabular-nums'
      }}>
        {value}
      </span>
      <span className="v3-eyebrow">{label}</span>
    </span>
  )
}

function Divider() {
  return <span aria-hidden="true" style={{ width: 1, height: 18, background: 'var(--v3-border)' }} />
}
