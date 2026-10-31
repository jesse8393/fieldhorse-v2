// Selections section, backed by fh_selections.
//
// Per-job list of client-facing finish picks (tile, paint, fixtures).
// Each row carries an options jsonb array; the owner authors the
// candidates, the client picks one (today: owner records the pick
// on behalf of the client; future: client portal does it).
//
// Statuses (DB CHECK constraint):
//   draft / sent / reviewed / approved / changed / installed
//
// Lives inside the Job Detail tab strip alongside the new
// 'selections' tab id from stageWorkspace.

import { useCallback, useEffect, useRef, useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import {
  Check, Plus, Trash2, Send, Edit2, X, AlertTriangle, Palette,
  ChevronRight, ImageIcon,
} from 'lucide-react'
import { supabase } from '../../../lib/supabase.ts'
import { toastSuccess, toastError } from '../../../lib/toast.ts'
import { hapticTap } from '../../../lib/haptics.ts'
import { SkeletonList } from '../../../components/Skeleton.tsx'
import { useArmedId } from '../../../lib/secondTap.ts'
import { Eyebrow } from '../../../components/v3'
import Field from '../../../components/fh/Field.tsx'
import { moneyExact } from '../../../lib/format.ts'

const SkeletonAny = SkeletonList as any

type Option = {
  id: string
  label: string
  brand?: string | null
  sku?: string | null
  price?: number | null
  image_url?: string | null
  notes?: string | null
}

type SelectionRow = {
  id: string
  user_id: string
  contact_id: string
  title: string
  description: string | null
  room: string | null
  category: string | null
  status: 'draft' | 'sent' | 'reviewed' | 'approved' | 'changed' | 'installed'
  options: Option[] | null
  selected_option_id: string | null
  decision_at: string | null
  decision_by: string | null
  due_at: string | null
  notes: string | null
  created_at: string
}

const STATUS_TONE: Record<SelectionRow['status'], 'neutral' | 'warn' | 'good' | 'bad'> = {
  draft:     'neutral',
  sent:      'warn',
  reviewed:  'warn',
  approved:  'good',
  changed:   'warn',
  installed: 'good',
}
const STATUS_LABEL: Record<SelectionRow['status'], string> = {
  draft:     'Draft',
  sent:      'Sent',
  reviewed:  'Reviewed',
  approved:  'Approved',
  changed:   'Changed',
  installed: 'Installed',
}

function fmtDate(iso: string | null): string {
  if (!iso) return ''
  try {
    return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
  } catch { return '' }
}

function fmtMoney(n: number | null | undefined): string {
  if (n == null) return ''
  return moneyExact(n)
}

function rid(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID().slice(0, 12)
  return Math.random().toString(36).slice(2, 14)
}

export default function SelectionsSection({ jobId, userId, clientId }: any) {
  // Delete takes a second tap on the same selection's button (D57).
  const deleteTap = useArmedId()
  const [rows, setRows] = useState<SelectionRow[]>([])
  const [loading, setLoading] = useState(true)
  const [composing, setComposing] = useState(false)
  const addButtonRef = useRef<HTMLButtonElement>(null)
  const wasComposing = useRef(false)
  const [editingId, setEditingId] = useState<string | null>(null)

  useEffect(() => {
    if (!composing && wasComposing.current) addButtonRef.current?.focus()
    wasComposing.current = composing
  }, [composing])

  const load = useCallback(async () => {
    if (!jobId) return
    setLoading(true)
    const { data, error } = await supabase
      .from('fh_selections')
      .select('id, user_id, contact_id, title, description, room, category, status, options, selected_option_id, decision_at, decision_by, due_at, notes, created_at')
      .eq('contact_id', jobId)
      .order('created_at', { ascending: false })
      .limit(100)
    if (error) {
      toastError("Couldn't load selections", error.message)
      setRows([])
    } else {
      setRows(((data || []) as any[]).map((r) => ({
        ...r,
        options: Array.isArray(r.options) ? r.options : [],
      })) as SelectionRow[])
    }
    setLoading(false)
  }, [jobId])

  useEffect(() => { load() }, [load])

  async function createSelection(values: SelectionDraft) {
    const payload: any = {
      user_id: userId,
      contact_id: jobId,
      title: values.title.trim(),
      room: values.room.trim() || null,
      category: values.category.trim() || null,
      description: values.description.trim() || null,
      due_at: values.due_at || null,
      options: values.options.map((o) => ({ ...o, id: o.id || rid() })),
      status: 'draft',
    }
    if (clientId) payload.client_id = clientId
    const { error } = await supabase.from('fh_selections').insert(payload)
    if (error) { toastError("Couldn't create selection", error.message); return }
    toastSuccess('Selection created')
    setComposing(false)
    load()
  }

  async function updateRow(id: string, patch: Partial<SelectionRow>) {
    const before = rows
    setRows((rs) => rs.map((r) => r.id === id ? { ...r, ...(patch as any) } : r))
    const { data, error } = await supabase.from('fh_selections').update(patch as any).eq('id', id).select('id').single()
    if (error || !data) {
      toastError("Couldn't update", error?.message || 'No selection was updated. Try again.')
      setRows(before)
      return false
    }
    return true
  }

  async function setStatus(id: string, next: SelectionRow['status']) {
    hapticTap()
    await updateRow(id, { status: next })
  }

  async function pickOption(id: string, optionId: string, by?: string | null) {
    hapticTap()
    await updateRow(id, {
      selected_option_id: optionId,
      decision_at: new Date().toISOString(),
      decision_by: by ?? null,
      status: 'approved',
    } as any)
  }

  async function remove(id: string) {
    hapticTap()
    setRows((rs) => rs.filter((r) => r.id !== id))
    const { error } = await supabase.from('fh_selections').delete().eq('id', id)
    if (error) { toastError("Couldn't delete", error.message); load() }
  }

  // Status counts for the small summary chip.
  const pendingCount = rows.filter((r) =>
    r.status === 'draft' || r.status === 'sent' || r.status === 'reviewed' || r.status === 'changed'
  ).length
  const approvedCount = rows.filter((r) => r.status === 'approved' || r.status === 'installed').length

  return (
    <div className="fh-job-selections" style={{ display: 'flex', flexDirection: 'column', gap: 12, padding: '12px 24px 24px' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
        <Eyebrow>
          Selections
          {rows.length > 0 && (
            <span style={{ marginLeft: 10, color: 'var(--v3-text)' }}>
              {approvedCount}/{rows.length} approved
            </span>
          )}
        </Eyebrow>
        {!composing && (
          <button
            ref={addButtonRef}
            type="button"
            onClick={() => setComposing(true)}
            style={{
              minHeight: 44,
              padding: '8px 12px', borderRadius: 10, border: 'none',
              background: 'var(--v3-primary)', color: 'var(--v3-on-primary, #141414)',
              fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
              letterSpacing: 0, cursor: 'pointer',
            }}
          >
            + New selection
          </button>
        )}
      </div>

      {composing && (
        <SelectionComposer
          onCancel={() => setComposing(false)}
          onCreate={createSelection}
        />
      )}

      {loading ? (
        <SkeletonAny rows={2} card={false} />
      ) : rows.length === 0 ? (
        <div style={{
          padding: '24px 16px', textAlign: 'center', color: 'var(--v3-text-muted)',
          fontFamily: 'var(--font-body)', fontSize: 14,
          border: '1px dashed var(--v3-border)', borderRadius: 10,
        }}>
          <Palette size={18} aria-hidden="true" style={{ display: 'block', margin: '0 auto 8px', color: 'var(--v3-primary-text)' }} />
          No selections yet. Add one for every finish the client needs to pick, tile, paint, fixtures, hardware.
        </div>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: 'none', display: 'flex', flexDirection: 'column', gap: 12 }}>
          <AnimatePresence initial={false}>
            {rows.map((r) => (
              <SelectionCard
                key={r.id}
                row={r}
                editing={editingId === r.id}
                onEditToggle={() => setEditingId(editingId === r.id ? null : r.id)}
                onSetStatus={(s) => setStatus(r.id, s)}
                onPick={(optId, by) => pickOption(r.id, optId, by)}
                onPatch={(patch) => updateRow(r.id, patch)}
                onDelete={() => deleteTap.tap(r.id, () => { void remove(r.id) })}
                deleteArmed={deleteTap.armedId === r.id}
              />
            ))}
          </AnimatePresence>
        </ul>
      )}

      {!loading && rows.length > 0 && pendingCount > 0 && (
        <div style={{ fontSize: 12, color: 'var(--v3-text-muted)', textAlign: 'center', marginTop: 4 }}>
          {pendingCount} waiting on the client. Tap a selection to mark it sent or record their pick.
        </div>
      )}
    </div>
  )
}

// ─── card ──────────────────────────────────────────────────────────

function SelectionCard({
  row, editing, onEditToggle, onSetStatus, onPick, onPatch, onDelete, deleteArmed = false,
}: {
  row: SelectionRow
  editing: boolean
  onEditToggle: () => void
  onSetStatus: (s: SelectionRow['status']) => void
  onPick: (optId: string, by?: string | null) => void
  onPatch: (patch: Partial<SelectionRow>) => Promise<boolean>
  onDelete: () => void
  /** Delete was tapped once; the next tap deletes (D57). */
  deleteArmed?: boolean
}) {
  const editButtonRef = useRef<HTMLButtonElement>(null)
  function closeEditor() { onEditToggle(); editButtonRef.current?.focus() }
  const opts = row.options || []
  const picked = opts.find((o) => o.id === row.selected_option_id) || null
  const tone = STATUS_TONE[row.status]
  const overdue = row.due_at && new Date(row.due_at).getTime() < Date.now() && row.status !== 'approved' && row.status !== 'installed'

  return (
    <motion.li
      layout
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -6 }}
      transition={{ duration: 0.18, ease: [0.2, 0.8, 0.2, 1] }}
      style={{
        display: 'flex', flexDirection: 'column', gap: 12,
        padding: '12px 16px', borderRadius: 10,
        background: 'var(--v3-surface)', border: '1px solid var(--v3-border)',
      }}
    >
      {/* Head, title + meta + status + actions */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, flexWrap: 'wrap' }}>
            <strong style={{ fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, color: 'var(--v3-text)' }}>
              {row.title}
            </strong>
            {row.room && (
              <span style={{ fontSize: 12, color: 'var(--v3-text-muted)' }}>· {row.room}</span>
            )}
            {row.category && (
              <Eyebrow>
                · {row.category}
              </Eyebrow>
            )}
          </div>
          {row.description && (
            <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--v3-text-muted)', lineHeight: 1.5 }}>
              {row.description}
            </p>
          )}
          {(row.due_at || overdue) && (
            <div style={{ marginTop: 6, fontSize: 12, color: overdue ? 'var(--v3-danger-text)' : 'var(--v3-text-muted)', display: 'inline-flex', alignItems: 'center', gap: 4 }}>
              {overdue && <AlertTriangle size={11} />}
              Due {fmtDate(row.due_at)} {overdue ? ': overdue' : ''}
            </div>
          )}
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span className={`fh-build-dot is-${tone}`}>{STATUS_LABEL[row.status]}</span>
          <button ref={editButtonRef} type="button" onClick={onEditToggle} aria-label="Edit selection" style={iconBtnStyle}>
            {editing ? <X size={13} /> : <Edit2 size={13} />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            aria-label={deleteArmed ? 'Tap again to delete' : 'Delete selection'}
            style={deleteArmed ? { ...iconBtnStyle, width: 'auto', padding: '0 8px', fontSize: 12, fontWeight: 700, color: 'var(--v3-danger-text)' } : iconBtnStyle}
          >
            {deleteArmed ? 'Tap again to delete' : <Trash2 size={13} />}
          </button>
        </div>
      </div>

      {/* Options grid */}
      {opts.length > 0 && (
        <div style={{
          display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(min(100%, 180px), 1fr))', gap: 8,
        }}>
          {opts.map((o) => {
            const isPicked = o.id === row.selected_option_id
            return (
              <div
                key={o.id}
                style={{
                  position: 'relative',
                  padding: 12,
                  borderRadius: 10,
                  border: isPicked
                    ? '1px solid color-mix(in srgb, var(--v3-success-bright, #2D7A4F) 60%, transparent)'
                    : '1px solid var(--v3-border)',
                  background: isPicked
                    ? 'color-mix(in srgb, var(--v3-success-bright, #2D7A4F) 10%, transparent)'
                    : 'var(--v3-glass-tint)',
                  display: 'flex', flexDirection: 'column', gap: 8,
                }}
              >
                {/* Thumbnail */}
                <div style={{
                  aspectRatio: '4 / 3', borderRadius: 10, overflow: 'hidden',
                  background: 'rgba(20, 20, 20,.30)', display: 'grid', placeItems: 'center',
                }}>
                  {o.image_url ? (
                    <img loading="lazy"src={o.image_url} alt={o.label} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                  ) : (
                    <ImageIcon size={20} aria-hidden="true" color="var(--v3-text-faint)" />
                  )}
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: 8 }}>
                  <strong style={{ minWidth: 0, fontSize: 14, fontWeight: 700, color: 'var(--v3-text)', overflowWrap: 'anywhere' }}>
                    {o.label}
                  </strong>
                  {o.price != null && (
                    <span style={{ flexShrink: 0, fontSize: 14, color: 'var(--v3-primary-text)', fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
                      {fmtMoney(o.price)}
                    </span>
                  )}
                </div>
                {(o.brand || o.sku) && (
                  <div style={{ fontSize: 12, color: 'var(--v3-text-muted)', overflowWrap: 'anywhere' }}>
                    {[o.brand, o.sku].filter(Boolean).join(' · ')}
                  </div>
                )}
                {!isPicked ? (
                  <button
                    type="button"
                    onClick={() => onPick(o.id)}
                    style={{
                      marginTop: 2,
                      minHeight: 44,
                      padding: '8px 12px', borderRadius: 10, border: 'none',
                      background: 'var(--v3-primary)', color: 'var(--v3-on-primary, #141414)',
                      fontSize: 12, fontWeight: 700, letterSpacing: 0,
                      cursor: 'pointer',
                    }}
                  >
                    Pick this
                  </button>
                ) : (
                  <div style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--v3-success-text)', fontWeight: 700 }}>
                    <Check size={12} aria-hidden="true" />
                    Picked
                    {row.decision_by && (
                      <span style={{ color: 'var(--v3-text-muted)', fontWeight: 400 }}>by {row.decision_by}</span>
                    )}
                    {row.decision_at && (
                      <span style={{ color: 'var(--v3-text-muted)', fontWeight: 400 }}>
                        · {fmtDate(row.decision_at)}
                      </span>
                    )}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Status actions */}
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
        {row.status === 'draft' && (
          <button type="button" onClick={() => onSetStatus('sent')} style={chipBtn}><Send size={11} /> Mark sent</button>
        )}
        {(row.status === 'sent' || row.status === 'reviewed') && (
          <button type="button" onClick={() => onSetStatus('draft')} style={chipBtnGhost}>Back to draft</button>
        )}
        {row.status === 'approved' && (
          <button type="button" onClick={() => onSetStatus('installed')} style={chipBtn}><Check size={11} /> Mark installed</button>
        )}
        {row.status === 'approved' && (
          <button type="button" onClick={() => onSetStatus('changed')} style={chipBtnGhost}>Scope changed</button>
        )}
      </div>

      {/* Edit mode, options editor */}
      {editing && (
        <OptionsEditor
          row={row}
          onSave={onPatch}
          onCancel={closeEditor}
        />
      )}
    </motion.li>
  )
}

// ─── composer ──────────────────────────────────────────────────────

type SelectionDraft = {
  title: string
  room: string
  category: string
  description: string
  due_at: string
  options: Option[]
}

function SelectionComposer({
  onCancel, onCreate,
}: {
  onCancel: () => void
  onCreate: (d: SelectionDraft) => Promise<void>
}) {
  const [title, setTitle] = useState('')
  const [room, setRoom] = useState('')
  const [category, setCategory] = useState('')
  const [description, setDescription] = useState('')
  const [due_at, setDueAt] = useState('')
  const [options, setOptions] = useState<Option[]>([{ id: rid(), label: '', price: null, brand: '', sku: '', image_url: '', notes: '' }])
  const [saving, setSaving] = useState(false)

  function setOpt(idx: number, patch: Partial<Option>) {
    setOptions((cur) => cur.map((o, i) => i === idx ? { ...o, ...patch } : o))
  }
  function addOpt() { setOptions((cur) => [...cur, { id: rid(), label: '', price: null, brand: '', sku: '', image_url: '', notes: '' }]) }
  function removeOpt(idx: number) { setOptions((cur) => cur.filter((_, i) => i !== idx)) }

  async function submit() {
    if (saving) return
    if (!title.trim()) { toastError('Title required'); return }
    const cleaned = options
      .map((o) => ({ ...o, label: o.label.trim() }))
      .filter((o) => o.label.length > 0)
    if (cleaned.length === 0) { toastError('Add at least one option'); return }
    setSaving(true)
    try { await onCreate({ title, room, category, description, due_at, options: cleaned }) }
    finally { setSaving(false) }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      padding: 12, borderRadius: 10,
      background: 'var(--v3-surface)', border: '1px solid var(--v3-border)',
    }}>
      <Field
        label="Selection title"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Selection title (e.g. Master Bath Floor Tile)"
        autoFocus
      />
      <div className="fh-selection-fields">
        <Field label="Room (optional)" value={room} onChange={(e) => setRoom(e.target.value)} placeholder="Master bath" />
        <Field label="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} placeholder="Tile, paint, fixture…" />
        <Field label="Decision deadline (optional)" type="date" value={due_at} onChange={(e) => setDueAt(e.target.value)} />
      </div>
      <Field
        label="Notes for client (optional)"
        multiline
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        placeholder="Notes for the client (optional)"
        rows={2}
      />

      <div style={{ borderTop: '1px solid var(--v3-glass-tint-2)', paddingTop: 12, marginTop: 4 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
          <span className="fh-build-eyebrow" style={{ color: 'var(--v3-primary-text)' }}>Options</span>
          <button type="button" onClick={addOpt} style={chipBtnGhost}><Plus size={11} /> Add option</button>
        </div>
        {options.map((o, idx) => (
          <SelectionOptionFields key={o.id} option={o} index={idx} onChange={(patch) => setOpt(idx, patch)} onRemove={() => removeOpt(idx)} canRemove={options.length > 1} />
        ))}
      </div>

      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={onCancel} disabled={saving} style={secondaryBtn}>Cancel</button>
        <button type="button" onClick={submit} disabled={saving || !title.trim()} style={primaryBtn(saving || !title.trim())}>{saving ? 'Creating…' : 'Create selection'}</button>
      </div>
    </div>
  )
}

// ─── inline options editor (edit mode) ─────────────────────────────

function OptionsEditor({
  row, onSave, onCancel,
}: {
  row: SelectionRow
  onSave: (patch: Partial<SelectionRow>) => Promise<boolean>
  onCancel: () => void
}) {
  const [opts, setOpts] = useState<Option[]>(row.options || [])
  const [title, setTitle] = useState(row.title)
  const [room, setRoom] = useState(row.room || '')
  const [category, setCategory] = useState(row.category || '')
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState(false)
  const errorRef = useRef<HTMLParagraphElement>(null)
  useEffect(() => {
    if (!saving && saveError) errorRef.current?.focus()
  }, [saving, saveError])

  function setOpt(idx: number, patch: Partial<Option>) {
    setOpts((cur) => cur.map((o, i) => i === idx ? { ...o, ...patch } : o))
  }
  function addOpt() { setOpts((cur) => [...cur, { id: rid(), label: '', price: null }]) }
  function removeOpt(idx: number) { setOpts((cur) => cur.filter((_, i) => i !== idx)) }

  async function save() {
    if (saving) return
    const cleaned = opts
      .map((o) => ({ ...o, label: o.label.trim() }))
      .filter((o) => o.label.length > 0)
    if (cleaned.length === 0) { toastError('Need at least one option'); return }
    setSaving(true)
    setSaveError(false)
    try {
      const saved = await onSave({ title: title.trim() || row.title, room: room.trim() || null, category: category.trim() || null, options: cleaned })
      if (saved) {
        toastSuccess('Selection updated')
        onCancel()
      } else setSaveError(true)
    } finally { setSaving(false) }
  }

  return (
    <div style={{
      display: 'flex', flexDirection: 'column', gap: 12,
      marginTop: 4, padding: 12, borderRadius: 10,
      background: 'rgba(20, 20, 20,.20)', border: '1px solid var(--v3-border)',
    }}>
      <Field label="Selection title" autoFocus value={title} onChange={(e) => setTitle(e.target.value)} />
      <div className="fh-selection-fields">
        <Field label="Room (optional)" value={room} onChange={(e) => setRoom(e.target.value)} />
        <Field label="Category (optional)" value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>
      <div className="fh-build-eyebrow" style={{ color: 'var(--v3-primary-text)' }}>Options</div>
      {opts.map((o, idx) => (
        <SelectionOptionFields key={o.id} option={o} index={idx} onChange={(patch) => setOpt(idx, patch)} onRemove={() => removeOpt(idx)} canRemove={opts.length > 1} />
      ))}
      <button type="button" onClick={addOpt} style={chipBtnGhost}><Plus size={11} /> Add option</button>
      {saveError && <p ref={errorRef} role="alert" tabIndex={-1} style={{ margin: 0, color: 'var(--v3-danger-text)', scrollMarginBlock: '100px' }}>Changes could not be saved. Your edits remain here. Try again.</p>}
      <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" onClick={onCancel} disabled={saving} style={secondaryBtn}>Cancel</button>
        <button type="button" onClick={save} disabled={saving} style={primaryBtn(saving)}>{saving ? 'Saving…' : 'Save'}</button>
      </div>
    </div>
  )
}

function SelectionOptionFields({ option, index, onChange, onRemove, canRemove }: {
  option: Option
  index: number
  onChange: (patch: Partial<Option>) => void
  onRemove: () => void
  canRemove: boolean
}) {
  return (
    <fieldset className="fh-selection-option">
      <legend>Option {index + 1}</legend>
      <div className="fh-selection-fields">
        <Field label="Option label" value={option.label} onChange={(e) => onChange({ label: e.target.value })} placeholder="Porcelain tile" />
        <Field label="Brand" value={option.brand || ''} onChange={(e) => onChange({ brand: e.target.value })} />
        <Field label="SKU / model" value={option.sku || ''} onChange={(e) => onChange({ sku: e.target.value })} />
        <Field label="Price ($)" type="number" inputMode="decimal" step="0.01" value={option.price ?? ''} onChange={(e) => onChange({ price: e.target.value === '' ? null : Number(e.target.value) })} />
      </div>
      <button type="button" onClick={onRemove} disabled={!canRemove} aria-label={`Remove option ${index + 1}`} style={{ ...chipBtnGhost, color: canRemove ? 'var(--v3-danger-text)' : 'var(--v3-text-muted)' }}><X size={16} aria-hidden="true" />Remove option</button>
    </fieldset>
  )
}

// ─── styles ────────────────────────────────────────────────────────

const primaryBtn = (disabled: boolean): React.CSSProperties => ({
  minHeight: 44,
  padding: '8px 16px', borderRadius: 10, border: 'none',
  background: 'var(--v3-primary)', color: 'var(--v3-on-primary, #141414)',
  fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700, letterSpacing: 0,
  opacity: disabled ? 0.5 : 1, cursor: disabled ? 'not-allowed' : 'pointer',
})

const secondaryBtn: React.CSSProperties = {
  minHeight: 44,
  padding: '8px 12px', borderRadius: 10,
  border: '1px solid var(--v3-border)',
  background: 'transparent', color: 'var(--v3-text-muted)',
  fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600, cursor: 'pointer',
}

const iconBtnStyle: React.CSSProperties = {
  width: 44, height: 44, borderRadius: 10,
  border: 'none', background: 'transparent',
  color: 'var(--v3-text-muted)', cursor: 'pointer',
  display: 'grid', placeItems: 'center',
}

const chipBtn: React.CSSProperties = {
  minHeight: 44,
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 12px', borderRadius: 10,
  background: 'color-mix(in srgb, var(--v3-primary) 12%, transparent)',
  border: '1px solid color-mix(in srgb, var(--v3-primary) 28%, transparent)',
  color: 'var(--v3-primary-text)',
  fontSize: 12, fontWeight: 700, letterSpacing: 0, cursor: 'pointer',
}

const chipBtnGhost: React.CSSProperties = {
  minHeight: 44,
  display: 'inline-flex', alignItems: 'center', gap: 4,
  padding: '4px 12px', borderRadius: 10,
  background: 'transparent',
  border: '1px solid var(--v3-border)',
  color: 'var(--v3-text-muted)',
  fontSize: 12, fontWeight: 700, letterSpacing: 0, cursor: 'pointer',
}

// quiet unused-import lints
void ChevronRight
