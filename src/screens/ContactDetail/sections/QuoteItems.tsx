import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Receipt, Plus, Pencil, Trash2, ChevronUp, ChevronDown, Check, X as XIcon } from 'lucide-react'
import { supabase } from '../../../lib/supabase.ts'
import { toastError, toastSuccess, toastUndo } from '../../../lib/toast.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import { canHover } from '../../../lib/hover.ts'
import { SkeletonList } from '../../../components/Skeleton.tsx'
import { loadUserRateCard } from '../../../lib/rateCard.ts'
import { Eyebrow } from '../../../components/v3'

/**
 * Quote items section, fh_quote_items CRUD editor.
 *
 * Phase 4A-3: full line item editor. Operators add, edit, reorder,
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

/* ============================================================
   Line item autocomplete, kills the typing on the highest-
   frequency action in the app. Two sources, merged:
     • history, the operator's own past fh_quote_items, ranked by
       how often a description recurs (most-used first), carrying
       the most recent unit + rate for each
     • rates  , the Settings rate card (defaults + overrides),
       priced at the midpoint of the low/high band
   ============================================================ */
export type ItemSuggestion = {
  description: string
  unit: string | null
  rate: number
  uses: number
  source: 'history' | 'rates'
}

function useItemSuggestions(userId: any): ItemSuggestion[] {
  const [suggestions, setSuggestions] = useState<ItemSuggestion[]>([])
  useEffect(() => {
    let alive = true
    if (!userId) { setSuggestions([]); return }
    ;(async () => {
      const out: ItemSuggestion[] = []
      // History, newest first so the first row seen per description
      // carries the operator's latest pricing.
      const { data } = await supabase
        .from('fh_quote_items')
        .select('description, unit, rate')
        .eq('user_id', userId)
        .order('created_at', { ascending: false })
        .limit(500)
      const byDesc = new Map<string, ItemSuggestion>()
      for (const r of (data || []) as any[]) {
        const desc = (r.description || '').trim()
        if (!desc) continue
        const key = desc.toLowerCase()
        const hit = byDesc.get(key)
        if (hit) hit.uses += 1
        else byDesc.set(key, {
          description: desc,
          unit: r.unit || null,
          rate: Number(r.rate) || 0,
          uses: 1,
          source: 'history'
        })
      }
      out.push(...byDesc.values())
      // Rate card, Settings trades priced at the band midpoint.
      try {
        const { merged } = await loadUserRateCard(userId)
        for (const entry of Object.values(merged)) {
          const low = Number(entry.low) || 0
          const high = Number(entry.high) || low
          const label = (entry as any).label || ''
          if (!label) continue
          if (byDesc.has(label.toLowerCase())) continue
          out.push({
            description: label,
            unit: entry.unit || null,
            rate: +(((low + high) / 2) || 0).toFixed(2),
            uses: 0,
            source: 'rates'
          })
        }
      } catch { /* rate card optional */ }
      if (alive) setSuggestions(out)
    })()
    return () => { alive = false }
  }, [userId])
  return suggestions
}

/** Top matches for the current input. Empty input → most-used history. */
function matchSuggestions(all: ItemSuggestion[], input: string): ItemSuggestion[] {
  const q = (input || '').trim().toLowerCase()
  if (!q) {
    return all.filter((s) => s.source === 'history').sort((a, b) => b.uses - a.uses).slice(0, 6)
  }
  const starts: ItemSuggestion[] = []
  const contains: ItemSuggestion[] = []
  for (const s of all) {
    const d = s.description.toLowerCase()
    if (d === q) continue // already typed exactly, no popup noise
    if (d.startsWith(q)) starts.push(s)
    else if (d.includes(q)) contains.push(s)
  }
  starts.sort((a, b) => b.uses - a.uses)
  contains.sort((a, b) => b.uses - a.uses)
  return [...starts, ...contains].slice(0, 6)
}

// Mobile keyboard fix, when an input gains focus, the soft keyboard
// commonly covers the active field on phones. Defer the scroll until
// the keyboard has had a moment to appear, then center the input in
// the visible viewport. No-op on desktop (already-visible inputs ignore
// scrollIntoView). Used on every DraftCard input + textarea.
function scrollIntoCenterOnFocus(e: any) {
  const el = e.currentTarget
  setTimeout(() => {
    try { el.scrollIntoView({ block: 'center', behavior: 'smooth' }) } catch {}
  }, 250)
}

function money(n: any) {
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

function draftFromRow(row: any) {
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
// fields are guarded against negatives and NaN, HTML `min="0"` is not
// reliably enforced on submit, so we re-check at the JS boundary.
// Credit lines (negative amounts) are deferred to a later phase.
function validateDraft(d: any) {
  if (!d.description || !d.description.trim()) return 'Description is required'
  const qty = Number(d.qty)
  const rate = Number(d.rate)
  const amount = Number(d.amount)
  if (!Number.isFinite(qty) || qty < 0) return 'Qty must be a number ≥ 0'
  if (!Number.isFinite(rate) || rate < 0) return 'Rate must be a number ≥ 0'
  if (!Number.isFinite(amount) || amount < 0) return 'Amount must be a number ≥ 0'
  return null
}

function normalizeForDB(d: any) {
  // Derive flags from a single canonical kind so an inconsistent draft
  // (e.g. both flags somehow true) can never reach the DB. Mutually
  // exclusive by construction.
  const kind = d?.is_excluded
    ? 'excluded'
    : d?.is_optional
      ? 'optional'
      : 'base'
  return {
    section: d.section?.trim() || null,
    description: d.description.trim(),
    qty: Number(d.qty),
    unit: d.unit?.trim() || null,
    rate: Number(d.rate),
    amount: Number(d.amount),
    notes: d.notes?.trim() || null,
    is_optional: kind === 'optional',
    is_excluded: kind === 'excluded'
  }
}

export default function QuoteItemsSection({ jobId, userId, onContactRefresh }: any) {
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(true)

  const [draft, setDraft] = useState(emptyDraft)
  const suggestions = useItemSuggestions(userId)

  // Monotonic next sort_order, seeded from loaded rows and bumped per add.
  // Keeps rapid optimistic adds in entry order without reading (possibly
  // stale) rows state between back-to-back adds.
  const sortRef = useRef(0)

  const [editingId, setEditingId] = useState<any>(null)
  const [editDraft, setEditDraft] = useState(emptyDraft)
  const [editing, setEditing] = useState(false)

  // `silent` refetches without flashing the whole list to a skeleton :
  // used after every add/edit/delete so rapid multi-item entry stays
  // smooth instead of blinking on each write (the "glitchy" complaint).
  // Only the initial load shows the skeleton.
  const fetchRows = useCallback(async (opts?: { silent?: boolean }) => {
    if (!jobId || !userId) return
    if (!opts?.silent) setLoading(true)
    const { data } = await supabase
      .from('fh_quote_items')
      .select('*')
      .eq('contact_id', jobId)
      .eq('user_id', userId)
      .order('sort_order', { ascending: true })
      .order('created_at', { ascending: true })
    const list = data || []
    setRows(list)
    // Seed the next sort_order above the current max so optimistic adds
    // always append in order.
    sortRef.current = list.length
      ? Math.max(...list.map((r: any) => Number(r.sort_order) || 0)) + 1
      : 0
    setLoading(false)
  }, [jobId, userId])

  useEffect(() => { fetchRows() }, [fetchRows])

  // Bumped after each successful add so the Add card re-focuses its
  // description input, you can fire off line items back-to-back without
  // reaching for the field again.
  const [addFocusSignal, setAddFocusSignal] = useState(0)

  // ============================================================
  // CRUD, all writes user_id-guarded. The migration-011 recalc
  // trigger fires on each write and keeps fh_contacts.amount synced.
  // ============================================================

  async function addItem(input: any) {
    if (!jobId || !userId) return null
    if (!input.description) {
      toastError("Couldn't add item", 'Description is required')
      return null
    }
    const sortOrder = Number.isFinite(input.sort_order) ? input.sort_order : sortRef.current++
    const tempId = `temp-${(typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : `${rows.length}-${sortOrder}`}`
    const optimisticRow = { id: tempId, user_id: userId, contact_id: jobId, ...input, sort_order: sortOrder, _pending: true }
    // Show the line immediately, no network wait between entries. This is
    // what makes rapid multi-item entry feel instant instead of glitchy.
    setRows((rs) => [...rs, optimisticRow])
    const payload = { user_id: userId, contact_id: jobId, ...input, sort_order: sortOrder }
    const { data, error } = await supabase
      .from('fh_quote_items')
      .insert(payload)
      .select()
      .single()
    if (error) {
      // Roll the optimistic row back out and tell the operator.
      setRows((rs) => rs.filter((r) => r.id !== tempId))
      toastError("Couldn't add item", error.message)
      return null
    }
    // Swap the temp row for the persisted one (real id + server defaults).
    setRows((rs) => rs.map((r) => (r.id === tempId ? data : r)))
    onContactRefresh?.()
    return data
  }

  async function updateItem(id: any, patch: any) {
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
    await fetchRows({ silent: true })
    onContactRefresh?.()
    return true
  }

  async function removeItem(id: any) {
    if (!id || !userId) return false
    // A still-saving optimistic row has no real id yet, ignore until it
    // reconciles (its actions are disabled in the UI too).
    if (String(id).startsWith('temp-')) return false
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
      fetchRows({ silent: true })
      return false
    }
    onContactRefresh?.()
    toastUndo('Line item deleted', {
      description: (snapshot?.description || '').slice(0, 60) || 'Tap Undo to restore',
      onUndo: async () => {
        if (!snapshot) return
        const { error: insErr } = await supabase.from('fh_quote_items').insert(snapshot)
        if (insErr) { toastError("Couldn't undo", insErr.message); return }
        await fetchRows({ silent: true })
        onContactRefresh?.()
        toastSuccess('Restored')
      }
    })
    return true
  }

  async function reorderItem(id: any, direction: any) {
    const idx = rows.findIndex((r) => r.id === id)
    if (idx === -1) return false
    const targetIdx = idx + direction
    if (targetIdx < 0 || targetIdx >= rows.length) return false
    // Don't reorder across a row that's still saving (no real id yet).
    if (rows[idx]?._pending || rows[targetIdx]?._pending) return false
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
      toastError("Couldn't reorder", (r1.error || r2.error)?.message)
      fetchRows({ silent: true })
      return false
    }
    return true
  }

  // ============================================================
  // Form handlers, add + edit share the same draft shape.
  // Auto-recompute amount when qty or rate change unless the
  // operator has explicitly overridden the amount field.
  // is_optional and is_excluded are mutually exclusive.
  // ============================================================

  function patchDraft(setter: any, key: any, value: any) {
    setter((d: any) => {
      // Synthetic 'kind' key, drives the 3-way mode picker and writes
      // both is_optional + is_excluded atomically. Mutually exclusive
      // by design; eliminates the ambiguity of two parallel checkboxes.
      if (key === 'kind') {
        return {
          ...d,
          is_optional: value === 'optional',
          is_excluded: value === 'excluded'
        }
      }
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

  // Derive the 3-way mode label from the current flags. Used by the
  // segment control to show the active selection.
  function kindFromDraft(d: any) {
    if (d?.is_excluded) return 'excluded'
    if (d?.is_optional) return 'optional'
    return 'base'
  }

  // Apply a picked suggestion: description + unit + rate land together,
  // amount recomputes from the current qty, and amountOverridden resets
  // so subsequent qty tweaks keep auto-calculating.
  function applySuggestion(setter: any, s: ItemSuggestion) {
    hapticTap()
    setter((d: any) => {
      const qty = Number(d.qty)
      const amount = Number.isFinite(qty) ? +(qty * s.rate).toFixed(2) : s.rate
      return {
        ...d,
        description: s.description,
        unit: s.unit || d.unit,
        rate: String(s.rate),
        amount: String(amount),
        amountOverridden: false
      }
    })
  }

  function handleAdd() {
    const err = validateDraft(draft)
    if (err) { toastError("Couldn't add item", err); return }
    hapticTap()
    // Fire the optimistic add (it reconciles in the background) and reset
    // the form NOW so the next line can be typed with zero latency. Carry
    // the section forward, quotes are usually entered a section at a time.
    const carrySection = draft.section
    void addItem({ ...normalizeForDB(draft) })
    setDraft({ ...emptyDraft(), section: carrySection })
    // Refocus the description so line items can be fired back-to-back.
    setAddFocusSignal((n) => n + 1)
  }

  function beginEdit(row: any) {
    if (row?._pending) return
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
  // Derived totals, pure, no DB call.
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
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 24px 32px' }}>
      <section
        className="v3-section v3-section--primary-quiet"
        style={{ margin: 0, padding: '16px 16px' }}
      >
        <span className="v3-eyebrow" style={{ color: 'var(--v3-primary)' }}>
          <Receipt size={11} aria-hidden="true" style={{ marginRight: 4, verticalAlign: 'middle' }} />
          Quote
        </span>
        <h2 style={{
          margin: '6px 0 0',
          fontSize: 24,
          lineHeight: 1.1,
          letterSpacing: 0,
          fontWeight: 600,
          color: 'var(--v3-text)'
        }}>
          Line items
        </h2>

        {/* Totals row, appears once items exist. Base = what fh_contacts.amount
            becomes via the recalc trigger. Optional/Excluded shown only when > 0. */}
        {!loading && rows.length > 0 && (
          <div style={{
            marginTop: 14,
            display: 'flex',
            alignItems: 'baseline',
            gap: 16,
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
          fontSize: 12,
          lineHeight: 1.5,
          color: 'var(--v3-text-muted)'
        }}>
          Base items make up the quoted price. Optional additions and exclusions can be shown on the proposal without changing the approved total.
        </p>
      </section>

      {/* Add line item */}
      <DraftCard
        eyebrow="Add line item"
        draft={draft}
        onChange={(k: any, v: any) => patchDraft(setDraft, k, v)}
        primaryLabel="Add line item"
        onPrimary={handleAdd}
        primaryDisabled={!draft.description.trim()}
        showCancel={false}
        suggestions={suggestions}
        onPickSuggestion={(s: ItemSuggestion) => applySuggestion(setDraft, s)}
        autoFocusSignal={addFocusSignal}
      />

      {/* Items list */}
      {loading ? (
        <SkeletonList rows={3} card={false} />
      ) : rows.length === 0 ? (
        <div style={{
          padding: '24px 16px',
          borderRadius: 10,
          background: 'var(--v3-surface)',
          border: '1px dashed var(--v3-border-strong)',
          color: 'var(--v3-text-muted)',
          fontFamily: 'var(--font-body)',
          fontSize: 14,
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
                  onChange={(k: any, v: any) => patchDraft(setEditDraft, k, v)}
                  primaryLabel={editing ? 'Saving…' : 'Save changes'}
                  onPrimary={saveEdit}
                  primaryDisabled={!editDraft.description.trim() || editing}
                  showCancel
                  onCancel={cancelEdit}
                  suggestions={suggestions}
                  onPickSuggestion={(s: ItemSuggestion) => applySuggestion(setEditDraft, s)}
                />
              </motion.li>
            ) : (
              <ItemRow
                key={r.id}
                row={r}
                pending={!!r._pending}
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
   ItemRow, collapsed view of a single quote item.
   ============================================================ */
function ItemRow({ row, pending, isFirst, isLast, onEdit, onDelete, onMoveUp, onMoveDown }: any) {
  const isOptional = !!row.is_optional && !row.is_excluded
  const isExcluded = !!row.is_excluded
  const dim = (isExcluded ? 0.55 : isOptional ? 0.85 : 1) * (pending ? 0.6 : 1)

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      style={{
        padding: '12px 12px',
        borderRadius: 10,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
        opacity: dim
      }}
    >
      {/* Top row, section eyebrow + amount */}
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
        <div style={{ display: 'inline-flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', minWidth: 0 }}>
          {row.section && (
            <Eyebrow style={{ padding: '4px 8px', borderRadius: 10, background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)' }}>
              {row.section}
            </Eyebrow>
          )}
          {isOptional && <StatusChip label="Optional" tone="gold" />}
          {isExcluded && <StatusChip label="Excluded" tone="muted" />}
        </div>
        <span style={{
          fontFamily: 'var(--font-display)',
          fontSize: 20, lineHeight: 1, letterSpacing: 0,
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
          lineHeight: 1.4,
          overflowWrap: 'anywhere'
        }}>
          {row.notes}
        </div>
      )}

      {/* Actions, ↑ ↓ edit delete. Each ≥40px tap target. Disabled while
          the row is still saving (optimistic add not yet reconciled). */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginTop: 2, flexWrap: 'wrap' }}>
        <RowActionButton ariaLabel="Move up" onClick={onMoveUp} disabled={isFirst || pending}>
          <ChevronUp size={16} />
        </RowActionButton>
        <RowActionButton ariaLabel="Move down" onClick={onMoveDown} disabled={isLast || pending}>
          <ChevronDown size={16} />
        </RowActionButton>
        <RowActionButton ariaLabel="Edit line item" onClick={onEdit} disabled={pending}>
          <Pencil size={14} />
        </RowActionButton>
        <RowActionButton ariaLabel="Delete line item" onClick={onDelete} tone="danger" disabled={pending}>
          <Trash2 size={14} />
        </RowActionButton>
        {pending && (
          <span style={{
            fontFamily: 'var(--font-body)', fontSize: 12,
            color: 'var(--v3-text-muted)', marginLeft: 2
          }}>
            Saving…
          </span>
        )}
      </div>
    </motion.li>
  )
}

function RowActionButton({ children, ariaLabel, onClick, disabled, tone }: any) {
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
        if (disabled || !canHover) return
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

function StatusChip({ label, tone }: any) {
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
    <Eyebrow style={{ padding: '4px 8px', borderRadius: 10, background: palette.bg, border: `1px solid ${palette.border}`, color: palette.color }}>
      {label}
    </Eyebrow>
  )
}

/* ============================================================
   DraftCard, shared form layout for both Add and Edit.
   ============================================================ */
function DraftCard({ eyebrow, draft, onChange, primaryLabel, onPrimary, primaryDisabled, showCancel, onCancel, suggestions = [], onPickSuggestion, autoFocusSignal }: any) {
  // Suggestion popup state. Closes on blur (after a beat so a tap on a
  // row lands first) and on pick.
  const [descFocused, setDescFocused] = useState(false)
  const descRef = useRef<HTMLInputElement>(null)
  const matches = descFocused && onPickSuggestion
    ? matchSuggestions(suggestions, draft.description)
    : []

  // Re-focus the description after each successful add so line items can
  // be entered back-to-back (the Add card stays put; only the signal
  // changes). Guarded to the Add card via the presence of the signal.
  useEffect(() => {
    if (autoFocusSignal == null || autoFocusSignal === 0) return
    descRef.current?.focus()
  }, [autoFocusSignal])

  // Enter anywhere in the card submits the line (unless the primary is
  // disabled or the suggestion popup is open, where Enter picks nothing
  // and would be surprising). Keeps hands on the keyboard for fast entry.
  function onCardKeyDown(e: any) {
    if (e.key !== 'Enter') return
    if (e.target?.tagName === 'TEXTAREA') return
    if (matches.length > 0) return
    if (primaryDisabled) return
    e.preventDefault()
    onPrimary?.()
  }
  return (
    <div
      onKeyDown={onCardKeyDown}
      style={{
        padding: '12px 16px',
        borderRadius: 10,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
        display: 'flex',
        flexDirection: 'column',
        gap: 12
      }}>
      <span className="v3-eyebrow" style={{ color: 'var(--v3-text-muted)' }}>
        {eyebrow}
      </span>

      {/* Description (full width), with rate-card / history autocomplete */}
      <FormField label="Description" required>
        <div style={{ position: 'relative' }}>
          <input
            ref={descRef}
            type="text"
            value={draft.description}
            onChange={(e) => onChange('description', e.target.value)}
            onFocus={(e) => { setDescFocused(true); scrollIntoCenterOnFocus(e) }}
            onBlur={() => setTimeout(() => setDescFocused(false), 180)}
            placeholder="What's this line for?"
            style={{ ...inputStyle, width: '100%', boxSizing: 'border-box' }}
          />
          {matches.length > 0 && (
            <div style={{
              position: 'absolute', left: 0, right: 0, top: 'calc(100% + 4px)',
              zIndex: 30,
              borderRadius: 10,
              background: 'var(--v3-surface-3)',
              border: '1px solid var(--v3-border-strong)',
              boxShadow: '0 12px 28px rgba(20, 20, 20,0.45)',
              overflow: 'hidden'
            }}>
              {matches.map((s: ItemSuggestion) => (
                <button
                  key={`${s.source}-${s.description}`}
                  type="button"
                  // mousedown beats the input's blur, so the pick lands
                  // before the popup unmounts.
                  onMouseDown={(ev) => { ev.preventDefault(); onPickSuggestion(s); setDescFocused(false) }}
                  style={{
                    display: 'flex', alignItems: 'center', gap: 8,
                    width: '100%', padding: '12px 12px',
                    background: 'transparent', border: 'none',
                    borderBottom: '1px solid var(--v3-border)',
                    color: 'var(--v3-text)', textAlign: 'left',
                    fontFamily: 'var(--font-body)', fontSize: 14,
                    cursor: 'pointer', WebkitTapHighlightColor: 'transparent'
                  }}
                >
                  <span style={{ flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {s.description}
                  </span>
                  <span style={{ flexShrink: 0, fontSize: 12, color: 'var(--v3-text-muted)' }}>
                    {money(s.rate)}{s.unit ? `/${s.unit}` : ''}
                  </span>
                  <span style={{
                    flexShrink: 0, fontSize: 12, letterSpacing: 0,
                    padding: '4px 8px', borderRadius: 10,
                    fontFamily: 'var(--font-display)',
                    background: s.source === 'rates' ? 'var(--v3-primary-soft)' : 'var(--v3-surface-2)',
                    border: '1px solid var(--v3-border)',
                    color: s.source === 'rates' ? 'var(--v3-primary)' : 'var(--v3-text-muted)'
                  }}>
                    {s.source === 'rates' ? 'RATE CARD' : `×${s.uses}`}
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>
      </FormField>

      {/* Numeric row, section / qty / unit / rate / amount. Wraps on narrow viewports. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(120px, 1fr))',
        gap: 12
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

      {/* Mode, mutually exclusive 3-way segment. NOT wrapped in
          FormField (a <label>) because <label> forwards clicks to the
          first form-control descendant, the Base button, which
          silently reset every non-Base selection back to Base on the
          Add form. Inline div avoids the label-forward path entirely. */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
        <Eyebrow>
          Mode
        </Eyebrow>
        <KindPicker
          value={draft.is_excluded ? 'excluded' : draft.is_optional ? 'optional' : 'base'}
          onChange={(kind: any) => onChange('kind', kind)}
        />
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 12, lineHeight: 1.4,
          color: 'var(--v3-text-muted)'
        }}>
          Base items count toward the quoted price. Optional additions and exclusions appear on the proposal but never roll up.
        </span>
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
              padding: '12px 12px',
              borderRadius: 10,
              background: 'var(--v3-surface-2)',
              border: '1px solid var(--v3-border)',
              color: 'var(--v3-text)',
              fontFamily: 'var(--font-body)',
              fontSize: 14, fontWeight: 600,
              cursor: 'pointer',
              display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
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
            padding: '12px 12px',
            borderRadius: 10,
            border: 'none',
            background: primaryDisabled
              ? 'var(--v3-surface-2)'
              : 'linear-gradient(180deg, var(--v3-primary-hot) 0%, var(--v3-primary) 100%)',
            color: primaryDisabled ? 'var(--v3-text-muted)' : 'var(--v3-on-primary)',
            fontFamily: 'var(--font-body)',
            fontSize: 14, fontWeight: 700, letterSpacing: 0,
            cursor: primaryDisabled ? 'default' : 'pointer',
            opacity: primaryDisabled ? 0.6 : 1,
            boxShadow: primaryDisabled ? 'none' : '0 0 0 2px rgba(201, 150, 58, 0.10), 0 4px 12px rgba(201, 150, 58, 0.18)',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
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

function FormField({ label, required, hint, children }: any) {
  return (
    <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
      <Eyebrow>
        {label}{required ? ' *' : ''}
      </Eyebrow>
      {children}
      {hint && (
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 12, lineHeight: 1.4,
          color: 'var(--v3-text-muted)'
        }}>
          {hint}
        </span>
      )}
    </label>
  )
}

/**
 * KindPicker, 3-way segment control for quote item classification.
 * Mutually exclusive by design: every row is exactly Base, Optional,
 * or Excluded. Replaces the prior parallel checkboxes that allowed
 * an ambiguous "neither flag set" state to slip through silently.
 */
function KindPicker({ value, onChange }: any) {
  const options = [
    { value: 'base',     label: 'Base',     hint: 'Counts toward quoted price' },
    { value: 'optional', label: 'Optional', hint: 'Addition, shown for reference' },
    { value: 'excluded', label: 'Excluded', hint: 'Out of scope, not included' }
  ]
  return (
    <div
      role="radiogroup"
      aria-label="Item mode"
      style={{
        display: 'grid',
        gridTemplateColumns: 'repeat(3, 1fr)',
        gap: 8,
        background: 'var(--v3-surface-2)',
        border: '1px solid var(--v3-border)',
        borderRadius: 10,
        padding: 4
      }}
    >
      {options.map((opt) => {
        const on = value === opt.value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(opt.value)}
            title={opt.hint}
            style={{
              minHeight: 40,
              padding: '8px 8px',
              borderRadius: 10,
              border: 'none',
              background: on
                ? 'color-mix(in srgb, var(--v3-primary) 18%, transparent)'
                : 'transparent',
              color: on ? 'var(--v3-primary)' : 'var(--v3-text-muted)',
              fontFamily: 'var(--font-body)',
              fontSize: 12,
              fontWeight: 700,
              letterSpacing: 0,
              textTransform: 'uppercase',
              cursor: 'pointer',
              WebkitTapHighlightColor: 'transparent',
              transition: 'background 160ms ease, color 160ms ease'
            }}
          >
            {opt.label}
          </button>
        )
      })}
    </div>
  )
}

const inputStyle: import('react').CSSProperties = {
  width: '100%', boxSizing: 'border-box',
  padding: '12px 12px',
  borderRadius: 10,
  background: 'var(--v3-surface-2)',
  border: '1px solid var(--v3-border)',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  outline: 'none',
  fontVariantNumeric: 'tabular-nums',
  // Mobile keyboard defense, when the browser auto-scroll-into-view
  // fires on focus, scroll-margin tells it to leave keyboard room
  // below the field. Companion to scrollIntoCenterOnFocus().
  scrollMarginBottom: 320
}

function Stat({ label, value, tone = 'default' }: any) {
  const valueColor = tone === 'gold'
    ? 'var(--v3-primary)'
    : tone === 'muted'
      ? 'var(--v3-text-muted)'
      : 'var(--v3-text)'
  return (
    <span style={{ display: 'inline-flex', alignItems: 'baseline', gap: 8 }}>
      <span style={{
        fontFamily: 'var(--font-display)',
        fontSize: 20, lineHeight: 1, letterSpacing: 0,
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
