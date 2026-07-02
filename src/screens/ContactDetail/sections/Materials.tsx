// Materials section — backed by fh_materials.
//
// Per-job procurement list. Each row carries qty_needed + optional
// ordered/received quantities + an installed_at timestamp. The status
// (needed / ordered / received / installed) is derived from those
// fields so the UI never has to keep an enum in sync with reality.
//
// Two ways to add rows:
//   1. Inline composer  — name + qty + supplier + unit_cost.
//   2. Bulk paste       — one line = one item; lightweight parse
//                         picks up a leading qty if present
//                         ("4 of 2x4 studs" → qty 4, name "2x4 studs").
//   3. Pull from notes  — fh_notes.parsed.materials_needed across
//                         the job is offered as a checkbox list so
//                         the owner can promote AI-extracted items
//                         into real procurement rows without
//                         retyping.

import { useCallback, useEffect, useMemo, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Plus, Trash2, Truck, Check, Sparkles, AlertTriangle, X, ListPlus,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase.ts'
import { toastSuccess, toastError } from '../../../lib/toast.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import { SkeletonList } from '../../../components/Skeleton.tsx'
import { useConfirm } from '../../../components/ConfirmSheet.tsx'

const SkeletonAny = SkeletonList as any

type MaterialRow = {
  id: string
  user_id: string
  contact_id: string
  name: string
  category: string | null
  unit: string | null
  qty_needed: number
  supplier: string | null
  po_number: string | null
  unit_cost: number | null
  ordered_at: string | null
  ordered_qty: number | null
  received_qty: number
  received_at: string | null
  installed_at: string | null
  notes: string | null
  source: any
  created_at: string
}

type Status = 'needed' | 'ordered' | 'received' | 'installed'
function statusOf(r: MaterialRow): Status {
  if (r.installed_at) return 'installed'
  if (r.ordered_at && Number(r.received_qty) >= Number(r.ordered_qty || r.qty_needed)) return 'received'
  if (r.ordered_at) return 'ordered'
  return 'needed'
}
const STATUS_TONE: Record<Status, 'neutral' | 'warn' | 'good' | 'bad'> = {
  needed:    'warn',
  ordered:   'warn',
  received:  'good',
  installed: 'good',
}
const STATUS_LABEL: Record<Status, string> = {
  needed:    'Needed',
  ordered:   'Ordered',
  received:  'Received',
  installed: 'Installed',
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return '—'
  return `$${Math.round(Number(n)).toLocaleString()}`
}

function fmtQty(n: number | null | undefined, unit?: string | null): string {
  if (n == null) return '—'
  const s = Number(n) % 1 === 0 ? String(n) : Number(n).toFixed(2)
  return unit ? `${s} ${unit}` : s
}

// Cheap parse: pulls a leading integer/decimal qty off a line.
//   "4 of 2x4 studs"   → { qty: 4, name: '2x4 studs' }
//   "2x4 stud (4)"     → { qty: 4, name: '2x4 stud' }
//   "Drywall mud"      → { qty: 1, name: 'Drywall mud' }
function parseBulkLine(raw: string): { qty: number; name: string } | null {
  const line = raw.trim()
  if (!line) return null
  let m = line.match(/^([\d.]+)\s*(?:x|of|@)?\s+(.+)$/i)
  if (m) {
    const q = Number(m[1])
    return { qty: Number.isFinite(q) && q > 0 ? q : 1, name: m[2].trim() }
  }
  m = line.match(/^(.+?)\s*\((\d+)\)\s*$/)
  if (m) {
    const q = Number(m[2])
    return { qty: Number.isFinite(q) && q > 0 ? q : 1, name: m[1].trim() }
  }
  return { qty: 1, name: line }
}

export default function MaterialsSection({ jobId, userId }: any) {
  const confirm = useConfirm()
  const [rows, setRows] = useState<MaterialRow[]>([])
  const [loading, setLoading] = useState(true)
  const [bulkOpen, setBulkOpen] = useState(false)
  const [notesPromptOpen, setNotesPromptOpen] = useState(false)
  const [draft, setDraft] = useState({ name: '', qty: '1', unit: 'EA', supplier: '', unit_cost: '' })

  const load = useCallback(async () => {
    if (!jobId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('fh_materials')
      .select('id, user_id, contact_id, name, category, unit, qty_needed, supplier, po_number, unit_cost, ordered_at, ordered_qty, received_qty, received_at, installed_at, notes, source, created_at')
      .eq('contact_id', jobId)
      .order('created_at', { ascending: false })
      .limit(500)
    if (error) {
      toastError("Couldn't load materials", error.message)
      setRows([])
    } else {
      setRows(((data || []) as any[]) as MaterialRow[])
    }
    setLoading(false)
  }, [jobId])

  useEffect(() => { load() }, [load])

  async function addOne() {
    const name = draft.name.trim()
    if (!name) return
    const qty = Number(draft.qty || '1') || 1
    const unit_cost = draft.unit_cost === '' ? null : Number(draft.unit_cost)
    const supplier = draft.supplier.trim() || null
    hapticTap()
    const { error } = await supabase.from('fh_materials').insert({
      user_id: userId,
      contact_id: jobId,
      name,
      qty_needed: qty,
      unit: draft.unit || 'EA',
      supplier,
      unit_cost,
    } as any)
    if (error) { toastError("Couldn't add", error.message); return }
    setDraft({ name: '', qty: '1', unit: 'EA', supplier: '', unit_cost: '' })
    toastSuccess('Added')
    load()
  }

  async function bulkAdd(lines: string[]) {
    const parsed = lines
      .map(parseBulkLine)
      .filter((x): x is { qty: number; name: string } => !!x && x.name.length > 0)
    if (parsed.length === 0) return
    const payload = parsed.map((p) => ({
      user_id: userId,
      contact_id: jobId,
      name: p.name,
      qty_needed: p.qty,
      unit: 'EA',
    }))
    const { error } = await supabase.from('fh_materials').insert(payload as any)
    if (error) { toastError("Couldn't bulk add", error.message); return }
    toastSuccess(`Added ${parsed.length} item${parsed.length === 1 ? '' : 's'}`)
    setBulkOpen(false)
    load()
  }

  async function patch(id: string, p: Partial<MaterialRow>) {
    const before = rows
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, ...(p as any) } : r))
    const { error } = await supabase.from('fh_materials').update(p as any).eq('id', id)
    if (error) { toastError("Couldn't update", error.message); setRows(before) }
  }

  async function markOrdered(id: string) {
    const row = rows.find((r) => r.id === id)
    if (!row) return
    await patch(id, {
      ordered_at: new Date().toISOString(),
      ordered_qty: row.ordered_qty ?? row.qty_needed,
    } as any)
  }

  async function markReceived(id: string) {
    const row = rows.find((r) => r.id === id)
    if (!row) return
    const target = Number(row.ordered_qty ?? row.qty_needed)
    await patch(id, {
      received_qty: target,
      received_at: new Date().toISOString(),
    } as any)
  }

  async function markInstalled(id: string) {
    await patch(id, { installed_at: new Date().toISOString() } as any)
  }

  async function unmarkInstalled(id: string) {
    await patch(id, { installed_at: null } as any)
  }

  async function remove(id: string) {
    if (!(await confirm({ title: 'Delete this material row?', destructive: true }))) return
    hapticTap()
    setRows((rs) => rs.filter((r) => r.id !== id))
    const { error } = await supabase.from('fh_materials').delete().eq('id', id)
    if (error) { toastError("Couldn't delete", error.message); load() }
  }

  // Status counts
  const counts = useMemo(() => {
    const c = { needed: 0, ordered: 0, received: 0, installed: 0, total: rows.length }
    for (const r of rows) c[statusOf(r)]++
    return c
  }, [rows])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '12px 20px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8, flexWrap: 'wrap' }}>
        <span style={{ fontFamily: 'var(--font-body)', fontSize: 10, fontWeight: 700, letterSpacing: '0.16em', textTransform: 'uppercase', color: 'var(--v3-text-muted)' }}>
          Materials
          {counts.total > 0 && (
            <span style={{ marginLeft: 12, color: 'var(--v3-text)' }}>
              {counts.installed}/{counts.total} installed · {counts.needed} to order
            </span>
          )}
        </span>
        <div style={{ display: 'flex', gap: 8 }}>
          <button type="button" onClick={() => setNotesPromptOpen(true)} style={chipBtnGhost}>
            <Sparkles size={11} /> Pull from notes
          </button>
          <button type="button" onClick={() => setBulkOpen(true)} style={chipBtnGhost}>
            <ListPlus size={11} /> Bulk add
          </button>
        </div>
      </div>

      {/* Inline composer — always visible. Press Enter on Name to add. */}
      <div style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(160px, 2fr) 70px 70px minmax(120px, 1fr) 90px auto',
        gap: 8,
        padding: 12,
        borderRadius: 12,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
      }}>
        <input
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          onKeyDown={(e) => { if (e.key === 'Enter') addOne() }}
          placeholder="Material (e.g. 2x4 studs)"
          style={inputStyle}
        />
        <input
          type="number"
          min="0"
          step="1"
          value={draft.qty}
          onChange={(e) => setDraft({ ...draft, qty: e.target.value })}
          placeholder="Qty"
          style={inputStyle}
        />
        <input
          value={draft.unit}
          onChange={(e) => setDraft({ ...draft, unit: e.target.value })}
          placeholder="EA"
          style={inputStyle}
        />
        <input
          value={draft.supplier}
          onChange={(e) => setDraft({ ...draft, supplier: e.target.value })}
          placeholder="Supplier (optional)"
          style={inputStyle}
        />
        <input
          type="number"
          step="0.01"
          min="0"
          value={draft.unit_cost}
          onChange={(e) => setDraft({ ...draft, unit_cost: e.target.value })}
          placeholder="$/unit"
          style={inputStyle}
        />
        <button
          type="button"
          onClick={addOne}
          disabled={!draft.name.trim()}
          style={primaryBtn(!draft.name.trim())}
        >
          <Plus size={12} />
        </button>
      </div>

      {loading ? (
        <SkeletonAny rows={3} card={false} />
      ) : rows.length === 0 ? (
        <div style={{
          padding: '24px 16px', textAlign: 'center', color: 'var(--v3-text-muted)',
          fontFamily: 'var(--font-body)', fontSize: 13,
          border: '1px dashed var(--v3-border)', borderRadius: 12,
        }}>
          <Truck size={18} aria-hidden="true" style={{ display: 'block', margin: '0 auto 8px', color: 'var(--v3-primary)' }} />
          No materials tracked yet. Add line items above, paste a list, or pull from your field reports.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 8 }}>
          <AnimatePresence initial={false}>
            {rows.map((r) => (
              <MaterialCard
                key={r.id}
                row={r}
                onPatch={(p) => patch(r.id, p)}
                onMarkOrdered={() => markOrdered(r.id)}
                onMarkReceived={() => markReceived(r.id)}
                onMarkInstalled={() => markInstalled(r.id)}
                onUnmarkInstalled={() => unmarkInstalled(r.id)}
                onDelete={() => remove(r.id)}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}

      {bulkOpen && (
        <BulkAddDialog onClose={() => setBulkOpen(false)} onAdd={bulkAdd} />
      )}
      {notesPromptOpen && (
        <NotesPullDialog
          jobId={jobId}
          onClose={() => setNotesPromptOpen(false)}
          onAdd={async (items) => {
            const payload = items.map((it) => ({
              user_id: userId,
              contact_id: jobId,
              name: it.name,
              qty_needed: it.qty,
              unit: 'EA',
              source: { from: 'note', note_id: it.note_id },
            }))
            const { error } = await supabase.from('fh_materials').insert(payload as any)
            if (error) toastError("Couldn't add", error.message)
            else { toastSuccess(`Added ${items.length}`); setNotesPromptOpen(false); load() }
          }}
        />
      )}
    </div>
  )
}

// ─── card ──────────────────────────────────────────────────────────

function MaterialCard({
  row, onPatch, onMarkOrdered, onMarkReceived, onMarkInstalled, onUnmarkInstalled, onDelete,
}: {
  row: MaterialRow
  onPatch: (p: Partial<MaterialRow>) => void
  onMarkOrdered: () => void
  onMarkReceived: () => void
  onMarkInstalled: () => void
  onUnmarkInstalled: () => void
  onDelete: () => void
}) {
  const status = statusOf(row)
  const tone = STATUS_TONE[status]
  const lineCost = (Number(row.unit_cost || 0) * Number(row.qty_needed || 0)) || 0

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 4 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -4 }}
      transition={{ duration: 0.16 }}
      style={{
        display: 'grid',
        gridTemplateColumns: 'minmax(0, 1.6fr) 110px minmax(120px, 1fr) 110px 110px auto',
        gap: 10,
        alignItems: 'center',
        padding: '12px 14px',
        borderRadius: 12,
        background: 'var(--v3-surface)',
        border: '1px solid var(--v3-border)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <strong style={{ fontSize: 14, fontWeight: 700, color: 'var(--v3-text)', display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          {row.name}
        </strong>
        {(row.po_number || row.notes || (row.source && row.source?.from === 'note')) && (
          <span style={{ fontSize: 11, color: 'var(--v3-text-muted)' }}>
            {row.po_number ? `PO ${row.po_number}` : ''}
            {row.source?.from === 'note' && (
              <span style={{ marginLeft: row.po_number ? 8 : 0 }}>
                <Sparkles size={9} style={{ display: 'inline', marginRight: 2, verticalAlign: '-1px' }} />
                from field notes
              </span>
            )}
          </span>
        )}
      </div>

      <div style={{ fontSize: 12, color: 'var(--v3-text)', fontVariantNumeric: 'tabular-nums' }}>
        {fmtQty(row.qty_needed, row.unit)}
      </div>

      <div style={{ fontSize: 12, color: 'var(--v3-text-muted)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
        {row.supplier || '—'}
      </div>

      <div style={{ fontSize: 12, color: 'var(--v3-text-muted)', fontVariantNumeric: 'tabular-nums' }}>
        {row.unit_cost != null ? `${fmtMoney(row.unit_cost)}/u` : '—'}
      </div>

      <div style={{ fontSize: 12, fontVariantNumeric: 'tabular-nums', color: lineCost > 0 ? 'var(--v3-primary)' : 'var(--v3-text-muted)', fontWeight: lineCost > 0 ? 700 : 400 }}>
        {lineCost > 0 ? fmtMoney(lineCost) : '—'}
      </div>

      <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, justifyContent: 'flex-end' }}>
        <span className={`fh-build-dot is-${tone}`}>{STATUS_LABEL[status]}</span>
        {status === 'needed' && (
          <button type="button" onClick={onMarkOrdered} title="Mark ordered" aria-label="Mark ordered" style={iconBtnStyle}>
            <Truck size={13} />
          </button>
        )}
        {status === 'ordered' && (
          <button type="button" onClick={onMarkReceived} title="Mark received" aria-label="Mark received" style={iconBtnStyle}>
            <Check size={13} />
          </button>
        )}
        {status === 'received' && (
          <button type="button" onClick={onMarkInstalled} title="Mark installed" aria-label="Mark installed" style={iconBtnStyle}>
            <Check size={13} />
          </button>
        )}
        {status === 'installed' && (
          <button type="button" onClick={onUnmarkInstalled} title="Un-mark installed" aria-label="Un-mark installed" style={iconBtnStyle}>
            <X size={13} />
          </button>
        )}
        <button type="button" onClick={onDelete} title="Delete" aria-label="Delete" style={iconBtnStyle}>
          <Trash2 size={13} />
        </button>
      </div>
    </motion.li>
  )
}

// ─── bulk add ──────────────────────────────────────────────────────

function BulkAddDialog({ onClose, onAdd }: { onClose: () => void; onAdd: (lines: string[]) => void }) {
  const [text, setText] = useState('')
  const preview = useMemo(
    () => text.split(/\r?\n/).map(parseBulkLine).filter((x): x is { qty: number; name: string } => !!x && x.name.length > 0),
    [text],
  )
  return (
    <DialogShell title="Bulk add materials" subtitle="One item per line. Leading numbers become qty (e.g. '4 of 2x4 studs')." onClose={onClose}>
      <textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="4 of 2x4 studs&#10;1 box of #10 screws&#10;Drywall mud (3)&#10;Paint — eggshell white"
        rows={8}
        autoFocus
        style={{ ...inputStyle, width: '100%', resize: 'vertical' }}
      />
      <div style={{ fontSize: 11, color: 'var(--v3-text-muted)', marginTop: 6 }}>
        {preview.length} item{preview.length === 1 ? '' : 's'} parsed.
      </div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 10 }}>
        <button type="button" onClick={onClose} style={secondaryBtn}>Cancel</button>
        <button type="button" onClick={() => onAdd(text.split(/\r?\n/))} disabled={preview.length === 0} style={primaryBtn(preview.length === 0)}>
          Add {preview.length}
        </button>
      </div>
    </DialogShell>
  )
}

// ─── pull-from-notes ───────────────────────────────────────────────

function NotesPullDialog({ jobId, onClose, onAdd }: {
  jobId: string
  onClose: () => void
  onAdd: (items: { name: string; qty: number; note_id: string }[]) => Promise<void>
}) {
  const [loading, setLoading] = useState(true)
  const [items, setItems] = useState<{ name: string; qty: number; note_id: string; checked: boolean }[]>([])

  useEffect(() => {
    let cancelled = false
    async function load() {
      const { data } = await supabase
        .from('fh_notes')
        .select('id, parsed')
        .eq('contact_id', jobId)
      if (cancelled) return
      const out: { name: string; qty: number; note_id: string; checked: boolean }[] = []
      for (const n of (data || []) as any[]) {
        const mats = Array.isArray(n?.parsed?.materials_needed) ? n.parsed.materials_needed : []
        for (const raw of mats) {
          const p = parseBulkLine(String(raw || ''))
          if (p && p.name) out.push({ name: p.name, qty: p.qty, note_id: n.id, checked: true })
        }
      }
      // Dedupe by lowercased name.
      const seen = new Set<string>()
      const deduped = out.filter((it) => {
        const k = it.name.toLowerCase()
        if (seen.has(k)) return false
        seen.add(k)
        return true
      })
      setItems(deduped)
      setLoading(false)
    }
    load()
    return () => { cancelled = true }
  }, [jobId])

  const toggle = (i: number) => setItems((cur) => cur.map((it, idx) => idx === i ? { ...it, checked: !it.checked } : it))
  const selectAll = () => setItems((cur) => cur.map((it) => ({ ...it, checked: true })))
  const selectNone = () => setItems((cur) => cur.map((it) => ({ ...it, checked: false })))
  const chosen = items.filter((it) => it.checked)

  return (
    <DialogShell title="Pull from field notes" subtitle="AI-extracted materials from your notes on this job. Pick which ones to add as procurement rows." onClose={onClose}>
      {loading ? (
        <div style={{ padding: 18, textAlign: 'center', color: 'var(--v3-text-muted)' }}>Loading…</div>
      ) : items.length === 0 ? (
        <div style={{ padding: 18, textAlign: 'center', color: 'var(--v3-text-muted)' }}>
          No materials in this job's field notes yet. Capture a few field reports first.
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
            <span style={{ fontSize: 11, color: 'var(--v3-text-muted)' }}>{chosen.length} selected</span>
            <div style={{ display: 'flex', gap: 6 }}>
              <button type="button" onClick={selectAll} style={chipBtnGhost}>All</button>
              <button type="button" onClick={selectNone} style={chipBtnGhost}>None</button>
            </div>
          </div>
          <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 320, overflowY: 'auto' }}>
            {items.map((it, idx) => (
              <li key={it.note_id + idx} style={{
                display: 'flex', alignItems: 'center', gap: 10,
                padding: '8px 10px', borderRadius: 8,
                background: 'rgba(255,255,255,.025)', border: '1px solid var(--v3-border)',
              }}>
                <input
                  type="checkbox"
                  checked={it.checked}
                  onChange={() => toggle(idx)}
                  style={{ accentColor: 'var(--v3-primary)' }}
                />
                <span style={{ flex: 1, fontSize: 13, color: 'var(--v3-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {it.name}
                </span>
                <span style={{ fontSize: 11, color: 'var(--v3-text-muted)' }}>×{it.qty}</span>
              </li>
            ))}
          </ul>
        </>
      )}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 12 }}>
        <button type="button" onClick={onClose} style={secondaryBtn}>Cancel</button>
        <button type="button" onClick={() => onAdd(chosen.map((c) => ({ name: c.name, qty: c.qty, note_id: c.note_id })))} disabled={chosen.length === 0} style={primaryBtn(chosen.length === 0)}>
          Add {chosen.length}
        </button>
      </div>
    </DialogShell>
  )
}

// ─── dialog shell + styles ─────────────────────────────────────────

function DialogShell({ title, subtitle, onClose, children }: { title: string; subtitle?: string; onClose: () => void; children: any }) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label={title}
      style={{
        position: 'fixed', inset: 0, zIndex: 90,
        background: 'rgba(0,0,0,.55)',
        display: 'grid', placeItems: 'center',
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 520,
          maxHeight: 'calc(100vh - 32px)',
          overflowY: 'auto',
          padding: 22,
          borderRadius: 12,
          background: 'linear-gradient(180deg, rgba(19,22,27,.95), rgba(9,11,14,.98))',
          border: '1px solid rgba(255,255,255,.10)',
          boxShadow: '0 22px 60px rgba(0,0,0,.50)',
        }}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start' }}>
          <div>
            <div className="fh-build-eyebrow" style={{ color: 'var(--v3-primary)' }}>{title}</div>
            {subtitle && (
              <p style={{ margin: '6px 0 12px', fontSize: 12, color: 'rgba(245,242,234,.62)' }}>{subtitle}</p>
            )}
          </div>
          <button type="button" onClick={onClose} aria-label="Close" style={{ background: 'transparent', border: 'none', color: 'rgba(245,242,234,.55)', cursor: 'pointer' }}>
            <X size={18} />
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}

const inputStyle: React.CSSProperties = {
  flex: '1 1 auto', minWidth: 0,
  padding: '10px 12px', borderRadius: 8,
  background: 'var(--v3-surface-2, rgba(0,0,0,.20))',
  border: '1px solid var(--v3-border)',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none',
}

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: 4,
  padding: '9px 14px', borderRadius: 8, border: 'none',
  background: 'var(--v3-primary)', color: 'var(--v3-on-primary, #141414)',
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700, letterSpacing: '0.04em',
  opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
})

const secondaryBtn: React.CSSProperties = {
  padding: '9px 14px', borderRadius: 8,
  border: '1px solid var(--v3-border)',
  background: 'transparent', color: 'var(--v3-text-muted)',
  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600, cursor: 'pointer',
}

const iconBtnStyle: React.CSSProperties = {
  width: 28, height: 28, borderRadius: 8,
  border: 'none', background: 'transparent',
  color: 'var(--v3-text-muted)', cursor: 'pointer',
  display: 'grid', placeItems: 'center',
}

const chipBtnGhost: React.CSSProperties = {
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '5px 10px', borderRadius: 999,
  background: 'transparent',
  border: '1px solid var(--v3-border)',
  color: 'var(--v3-text-muted)',
  fontSize: 11, fontWeight: 700, letterSpacing: '.04em', cursor: 'pointer',
}

// quiet unused-import lint
void AlertTriangle
