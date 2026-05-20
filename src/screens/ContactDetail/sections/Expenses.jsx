import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Receipt } from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
import { recalcCost } from '../../../lib/stages.ts'
import { toastError, toastSuccess, toastUndo } from '../../../lib/toast.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import ActionSheet, { SheetField, SheetChipRow, SheetMoneyField } from '../../../components/ActionSheet.jsx'

const EXPENSE_CATEGORIES = [
  { value: 'Materials', label: 'Materials' },
  { value: 'Fuel',      label: 'Fuel' },
  { value: 'Permits',   label: 'Permits' },
  { value: 'Equipment', label: 'Equipment' },
  { value: 'Other',     label: 'Other' }
]

function money(n) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

/**
 * Expenses section — fh_expenses CRUD. Every mutation calls recalcCost so
 * the job's cost number stays accurate across the app.
 */
export default function ExpensesSection({ contact, expenses = [], userId, fetchAll }) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({
    description: '',
    amount: '',
    category: 'Materials',
    expense_date: new Date().toISOString().slice(0, 10)
  })
  const [saving, setSaving] = useState(false)
  const total = expenses.reduce((s, e) => s + Number(e.amount || 0), 0)

  useEffect(() => {
    if (!open) setForm({
      description: '',
      amount: '',
      category: 'Materials',
      expense_date: new Date().toISOString().slice(0, 10)
    })
  }, [open])

  const step = form.description ? (form.amount ? 3 : 2) : 1

  async function save() {
    if (!form.description.trim() || saving) return
    setSaving(true)
    const { error } = await supabase.from('fh_expenses').insert({
      user_id: userId,
      contact_id: contact.id,
      description: form.description,
      amount: Number(form.amount) || 0,
      category: form.category,
      expense_date: form.expense_date
    })
    if (error) {
      toastError("Couldn't add expense", error.message)
      setSaving(false)
      return
    }
    await recalcCost(contact.id, userId)
    setSaving(false)
    setOpen(false)
    fetchAll?.()
  }

  async function remove(id) {
    hapticTap()
    const snapshot = expenses.find((e) => e.id === id)
    const { error } = await supabase.from('fh_expenses').delete().eq('id', id).eq('user_id', userId)
    if (error) { toastError("Couldn't delete", error.message); return }
    await recalcCost(contact.id, userId)
    fetchAll?.()
    toastUndo('Expense removed', {
      description: snapshot
        ? `${snapshot.description || 'Expense'} · ${money(snapshot.amount)}`
        : 'Tap Undo to restore',
      onUndo: async () => {
        if (!snapshot) return
        const { error: insErr } = await supabase.from('fh_expenses').insert(snapshot)
        if (insErr) { toastError("Couldn't undo", insErr.message); return }
        await recalcCost(contact.id, userId)
        fetchAll?.()
        toastSuccess('Restored', snapshot.description || '')
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 20px 24px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <span style={{
          fontFamily: 'var(--font-body)',
          fontSize: 10, fontWeight: 700, letterSpacing: '0.16em',
          textTransform: 'uppercase', color: 'var(--v3-text-muted)'
        }}>
          Expenses
        </span>
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 11,
          color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums'
        }}>
          Total{' '}
          <strong style={{ color: 'var(--v3-primary)', fontWeight: 700 }}>
            {money(total)}
          </strong>
        </span>
      </div>

      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={() => { hapticTap(); setOpen(true) }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 6,
          padding: '11px 16px', borderRadius: 12,
          background: 'var(--v3-surface-2)',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
          color: 'var(--v3-primary)',
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
          letterSpacing: '0.04em', cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent'
        }}
      >
        <Plus size={14} aria-hidden="true" />
        Add expense
      </motion.button>

      {expenses.length === 0 ? (
        <div style={{
          padding: '20px 18px', borderRadius: 14,
          background: 'var(--v3-surface)', border: '1px dashed var(--v3-border-strong)',
          color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
          fontSize: 13, textAlign: 'center', lineHeight: 1.5
        }}>
          No expenses yet. Materials, fuel, permits — log as you go so margin stays real.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
          <AnimatePresence>
            {expenses.map((e) => (
              <motion.li
                key={e.id}
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
                <span aria-hidden="true" style={{
                  flexShrink: 0, width: 32, height: 32, borderRadius: 9,
                  background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)',
                  color: 'var(--v3-primary)',
                  display: 'grid', placeItems: 'center'
                }}>
                  <Receipt size={14} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    color: 'var(--v3-text)'
                  }}>
                    {e.description}
                  </div>
                  <div style={{
                    marginTop: 2,
                    fontFamily: 'var(--font-body)', fontSize: 11,
                    color: 'var(--v3-text-muted)',
                    fontVariantNumeric: 'tabular-nums',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                  }}>
                    {e.category} · {e.expense_date}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <span style={{
                    fontFamily: 'var(--font-display)', fontSize: 14,
                    color: 'var(--v3-text)',
                    fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'right'
                  }}>
                    {money(e.amount)}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(e.id)}
                    aria-label="Delete expense"
                    style={{
                      width: 28, height: 28, borderRadius: 8,
                      border: 'none', background: 'transparent',
                      color: 'var(--v3-text-muted)', cursor: 'pointer',
                      display: 'grid', placeItems: 'center'
                    }}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                  </button>
                </div>
              </motion.li>
            ))}
          </AnimatePresence>
        </ul>
      )}

      <ActionSheet
        open={open}
        title="New expense on the job."
        accentWord="expense"
        sectionLabel="New expense"
        stepCount={3}
        currentStep={step}
        commitLabel={saving ? 'Committing…' : 'Commit expense'}
        commitBusy={saving}
        commitDisabled={!form.description.trim()}
        onClose={() => setOpen(false)}
        onCommit={save}
      >
        <SheetField label="Description">
          <input
            autoFocus
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
            placeholder="What was purchased?"
          />
        </SheetField>
        <SheetMoneyField
          label="Amount"
          value={form.amount}
          onChange={(v) => setForm({ ...form, amount: v })}
        />
        <SheetChipRow
          label="Category"
          value={form.category}
          options={EXPENSE_CATEGORIES}
          onChange={(v) => setForm({ ...form, category: v })}
        />
        <SheetField label="Date">
          <input
            type="date"
            value={form.expense_date}
            onChange={(e) => setForm({ ...form, expense_date: e.target.value })}
          />
        </SheetField>
      </ActionSheet>
    </div>
  )
}
