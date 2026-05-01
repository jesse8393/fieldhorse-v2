import { useCallback, useEffect, useMemo, useState } from 'react'
import { Receipt } from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
import { toastError, toastSuccess, toastUndo } from '../../../lib/toast.js'
import { hapticTap } from '../../../lib/haptics.js'
import { SkeletonList } from '../../../components/Skeleton.jsx'

/**
 * Quote items section — fh_quote_items CRUD shell.
 *
 * Phase 4A-2: read-only placeholder + helper functions. The full
 * line-item editor (add row form, edit, delete with toastUndo,
 * reorder, optional/excluded toggles) lands in Phase 4A-3.
 *
 * Schema: { id, user_id, contact_id, section, description, qty, unit,
 *           rate, amount, notes, is_optional, is_excluded, sort_order,
 *           created_at, updated_at }
 *
 * The recalc trigger from migration 011 keeps fh_contacts.amount in
 * sync with the sum of base items (is_optional=false AND
 * is_excluded=false) on every write. App code does not need to
 * compute or write fh_contacts.amount manually.
 */
function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 2
  })
}

export default function QuoteItemsSection({ jobId, userId }) {
  const [rows, setRows] = useState([])
  const [loading, setLoading] = useState(true)

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
  // CRUD helpers — defined for Phase 4A-3 wiring. Not yet exposed
  // in this placeholder UI. Each is user_id-guarded per Phase 2B.
  // ============================================================

  // eslint-disable-next-line no-unused-vars
  async function addItem(input = {}) {
    if (!jobId || !userId) return null
    const qty = Number(input.qty ?? 1)
    const rate = Number(input.rate ?? 0)
    const payload = {
      user_id: userId,
      contact_id: jobId,
      section: input.section ?? null,
      description: (input.description || '').trim(),
      qty,
      unit: input.unit ?? null,
      rate,
      amount: input.amount != null ? Number(input.amount) : qty * rate,
      notes: input.notes ?? null,
      is_optional: !!input.is_optional,
      is_excluded: !!input.is_excluded,
      sort_order: Number.isFinite(input.sort_order) ? input.sort_order : rows.length
    }
    if (!payload.description) {
      toastError("Couldn't add item", 'Description is required')
      return null
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
    return data
  }

  // eslint-disable-next-line no-unused-vars
  async function updateItem(id, patch) {
    if (!id || !userId) return false
    const next = { ...patch }
    // Auto-recompute amount when qty or rate changes and amount wasn't
    // explicitly overridden in the same patch. Caller can pass
    // amount: undefined to skip, or amount: <n> to override.
    if ((next.qty != null || next.rate != null) && next.amount === undefined) {
      const row = rows.find((r) => r.id === id)
      const qty = Number(next.qty ?? row?.qty ?? 1)
      const rate = Number(next.rate ?? row?.rate ?? 0)
      next.amount = qty * rate
    }
    const { error } = await supabase
      .from('fh_quote_items')
      .update(next)
      .eq('id', id)
      .eq('user_id', userId)
    if (error) {
      toastError("Couldn't update item", error.message)
      return false
    }
    await fetchRows()
    return true
  }

  // eslint-disable-next-line no-unused-vars
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
    toastUndo('Line item deleted', {
      description: (snapshot?.description || '').slice(0, 60) || 'Tap Undo to restore',
      onUndo: async () => {
        if (!snapshot) return
        const { error: insErr } = await supabase.from('fh_quote_items').insert(snapshot)
        if (insErr) { toastError("Couldn't undo", insErr.message); return }
        await fetchRows()
        toastSuccess('Restored')
      }
    })
    return true
  }

  // eslint-disable-next-line no-unused-vars
  async function reorderItem(/* id, direction */) {
    // Phase 4A-3: swap sort_order with the adjacent row in the given
    // direction (-1 up / +1 down). Two UPDATEs in sequence with the
    // user_id guard. Stubbed here — wired with the editor UI.
    return false
  }

  // ============================================================
  // Derived totals — pure, no DB call. Powers the placeholder
  // stats row + the future sticky footer in 4A-3.
  // ============================================================
  const totals = useMemo(() => {
    let base = 0
    let optional = 0
    let excluded = 0
    for (const r of rows) {
      const amt = Number(r.amount || 0)
      if (r.is_excluded) {
        excluded += amt
      } else if (r.is_optional) {
        optional += amt
      } else {
        base += amt
      }
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

        {loading ? (
          <div style={{ marginTop: 14 }}>
            <SkeletonList rows={3} card={false} />
          </div>
        ) : rows.length === 0 ? (
          <div style={{
            marginTop: 14,
            padding: '20px 18px',
            borderRadius: 14,
            background: 'var(--v3-surface-2)',
            border: '1px dashed var(--v3-border-strong)',
            color: 'var(--v3-text-muted)',
            fontFamily: 'var(--font-body)',
            fontSize: 13,
            textAlign: 'center',
            lineHeight: 1.5
          }}>
            No quote items yet. The line-item editor ships in the next phase.
          </div>
        ) : (
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
          margin: '14px 0 0',
          fontFamily: 'var(--font-body)',
          fontSize: 12,
          lineHeight: 1.5,
          color: 'var(--v3-text-muted)'
        }}>
          The full line-item editor (add, edit, reorder, optional / excluded toggles) lands in Phase 4A-3.
          Base subtotal is what the recalc trigger writes to <code style={{ fontFamily: 'inherit' }}>fh_contacts.amount</code>.
        </p>
      </section>
    </div>
  )
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
        fontSize: 22,
        lineHeight: 1,
        letterSpacing: '0.02em',
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
