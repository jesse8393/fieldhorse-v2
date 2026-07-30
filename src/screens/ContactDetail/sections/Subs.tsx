import { useEffect, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Plus, Trash2, Wrench } from 'lucide-react'
import { supabase } from '../../../lib/supabase.ts'
import { recalcCost } from '../../../lib/stages.ts'
import { toastError, toastSuccess, toastUndo } from '../../../lib/toast.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import { formatPhone } from '../../../lib/utils.ts'
import ActionSheet, { SheetField as SheetField_, SheetChipRow as SheetChipRow_ } from '../../../components/ActionSheet.tsx'
import { Eyebrow } from '../../../components/v3'
const SheetField = SheetField_ as any
const SheetChipRow = SheetChipRow_ as any

const SUB_STATUSES = [
  { value: 'scheduled', label: 'Scheduled' },
  { value: 'onsite',    label: 'On site' },
  { value: 'complete',  label: 'Complete' },
  { value: 'paid',      label: 'Paid' }
]

const STATUS_COLOR: Record<string, string> = {
  scheduled: 'var(--v3-text-muted)',
  onsite:    'var(--v3-success-bright)',
  complete:  'var(--v3-primary)',
  paid:      'var(--v3-success-bright)'
}

function money(n: any) {
  return Number(n || 0).toLocaleString(undefined, {
    style: 'currency', currency: 'USD', maximumFractionDigits: 0
  })
}

/**
 * Subs section, fh_subs CRUD on the job. Every INSERT and DELETE calls
 * recalcCost(contact.id) so cost + margin stay current everywhere they
 * surface (Home KPIs, Job Detail Health, Jobs grid margin pill).
 *
 * Form lives inside ActionSheet (preserves the staged-step UX from legacy).
 */
export default function SubsSection({ contact, subs = [], userId, fetchAll }: any) {
  const [open, setOpen] = useState(false)
  const [form, setForm] = useState({ name: '', trade: '', phone: '', rate: '', status: 'scheduled' })
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (!open) setForm({ name: '', trade: '', phone: '', rate: '', status: 'scheduled' })
  }, [open])

  const totalRate = subs.reduce((s: any, x: any) => s + Number(x.rate || 0), 0)
  const step = form.name ? (form.trade || form.rate ? 3 : 2) : 1

  async function save() {
    if (!form.name.trim() || saving) return
    setSaving(true)
    const { error } = await supabase.from('fh_subs').insert({
      user_id: userId,
      org_id: contact.org_id ?? null,
      contact_id: contact.id,
      name: form.name,
      trade: form.trade || null,
      phone: form.phone || null,
      rate: Number(form.rate) || 0,
      status: form.status
    })
    if (error) {
      toastError("Couldn't add sub", error.message)
      setSaving(false)
      return
    }
    await recalcCost(contact.id, userId)
    setSaving(false)
    setOpen(false)
    fetchAll?.()
  }

  async function remove(id: any) {
    hapticTap()
    const snapshot = subs.find((s: any) => s.id === id)
    const { error } = await supabase.from('fh_subs').delete().eq('id', id).eq('user_id', userId)
    if (error) { toastError("Couldn't delete", error.message); return }
    await recalcCost(contact.id, userId)
    fetchAll?.()
    toastUndo('Sub removed', {
      description: snapshot?.name || 'Tap Undo to restore',
      onUndo: async () => {
        if (!snapshot) return
        const { error: insErr } = await supabase.from('fh_subs').insert(snapshot)
        if (insErr) { toastError("Couldn't undo", insErr.message); return }
        await recalcCost(contact.id, userId)
        fetchAll?.()
        toastSuccess('Restored', snapshot.name || '')
      }
    })
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 24px 24px' }}>

      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Eyebrow>
          Subs
        </Eyebrow>
        <span style={{
          fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
          color: 'var(--v3-primary)', fontVariantNumeric: 'tabular-nums'
        }}>
          {subs.length} {subs.length === 1 ? 'sub' : 'subs'}
          {totalRate > 0 ? ` · ${money(totalRate)}` : ''}
        </span>
      </div>

      <motion.button
        type="button"
        whileTap={{ scale: 0.98 }}
        onClick={() => { hapticTap(); setOpen(true) }}
        style={{
          display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          padding: '12px 16px', borderRadius: 10,
          background: 'var(--v3-surface-2)',
          border: '1px solid color-mix(in srgb, var(--v3-primary) 30%, transparent)',
          color: 'var(--v3-primary)',
          fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
          letterSpacing: 0, cursor: 'pointer',
          WebkitTapHighlightColor: 'transparent'
        }}
      >
        <Plus size={14} aria-hidden="true" />
        Add sub
      </motion.button>

      {subs.length === 0 ? (
        <div style={{
          padding: '24px 16px', borderRadius: 10,
          background: 'var(--v3-surface)', border: '1px dashed var(--v3-border-strong)',
          color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)',
          fontSize: 14, textAlign: 'center', lineHeight: 1.5
        }}>
          No subs on this job. Add who's running each trade, rates roll into cost + margin live.
        </div>
      ) : (
        <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AnimatePresence>
            {subs.map((s: any) => (
              <motion.li
                key={s.id}
                layout
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -6 }}
                transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
                style={{
                  display: 'flex', alignItems: 'center', gap: 12,
                  padding: '12px 12px', borderRadius: 10,
                  background: 'var(--v3-surface)', border: '1px solid var(--v3-border)'
                }}
              >
                <span aria-hidden="true" style={{
                  flexShrink: 0, width: 32, height: 32, borderRadius: 10,
                  background: 'var(--v3-surface-2)', border: '1px solid var(--v3-border)',
                  color: 'var(--v3-primary)',
                  display: 'grid', placeItems: 'center'
                }}>
                  <Wrench size={14} />
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{
                    fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis',
                    color: 'var(--v3-text)'
                  }}>
                    {s.name}
                  </div>
                  <div style={{
                    marginTop: 2,
                    fontFamily: 'var(--font-body)', fontSize: 12,
                    color: 'var(--v3-text-muted)',
                    whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                  }}>
                    {s.trade || '\u2003'}{s.phone ? ` · ${formatPhone(s.phone)}` : ''}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexShrink: 0 }}>
                  <Eyebrow style={{ color: STATUS_COLOR[s.status] || 'var(--v3-text-muted)' }}>
                    {s.status}
                  </Eyebrow>
                  <span style={{
                    fontFamily: 'var(--font-display)', fontSize: 14,
                    color: 'var(--v3-primary)',
                    fontVariantNumeric: 'tabular-nums', minWidth: 60, textAlign: 'right'
                  }}>
                    {money(s.rate)}
                  </span>
                  <button
                    type="button"
                    onClick={() => remove(s.id)}
                    aria-label="Delete sub"
                    style={{
                      width: 28, height: 28, borderRadius: 10,
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
        title="New sub on the crew."
        accentWord="sub"
        sectionLabel="New sub"
        stepCount={3}
        currentStep={step}
        commitLabel={saving ? 'Committing…' : 'Commit sub'}
        commitBusy={saving}
        commitDisabled={!form.name.trim()}
        onClose={() => setOpen(false)}
        onCommit={save}
      >
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4, 16px)' }}>
          <SheetField label="Name">
            <input autoFocus value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="Crew lead name" />
          </SheetField>
          <SheetField label="Trade">
            <input value={form.trade} onChange={(e) => setForm({ ...form, trade: e.target.value })} placeholder="Framer, roofer…" />
          </SheetField>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 'var(--space-4, 16px)' }}>
          <SheetField label="Phone">
            <input type="tel" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </SheetField>
          <SheetField label="Rate">
            <input type="number" inputMode="decimal" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} placeholder="0" />
          </SheetField>
        </div>
        <SheetChipRow
          label="Status"
          value={form.status}
          options={SUB_STATUSES}
          onChange={(v: any) => setForm({ ...form, status: v })}
        />
      </ActionSheet>
    </div>
  )
}
