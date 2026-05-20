// src/screens/ContactDetail/sections/ChangeOrdersSection.jsx
//
// Editor for change orders on a job. Sits at the bottom of the Quote
// tab. Each row stamps CO # · title · description · amount · status;
// the contractor can add, edit, approve, void, or delete entries.
//
// Schema: fh_change_orders (migration 019).
//
// Sequence numbering is server-side (BEFORE INSERT trigger picks
// max+1 per contact_id) so multiple concurrent inserts can't collide.
// Approved COs bump the contract total used by the invoice's balance
// summary — the math lives in InvoiceTemplate; this surface only
// captures + manages the data.

import { useState } from 'react'
import { Plus, FileEdit, Check, X, Trash2, FileText } from 'lucide-react'
import { supabase } from '../../../lib/supabase.js'
import { toastSuccess, toastError } from '../../../lib/toast.ts'

function money(n) {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, {
    style: 'currency', currency: 'USD',
    minimumFractionDigits: 0, maximumFractionDigits: 0
  })
}

function shortDate(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

export default function ChangeOrdersSection({ contact, userId, changeOrders = [], onChange }) {
  const isOwner = contact && contact.user_id === userId
  const [editingId, setEditingId] = useState(null)
  const [creating, setCreating] = useState(false)

  if (!isOwner) {
    // Partners can READ approved COs (per migration 019 partner policy),
    // but can't author. Render the read-only list when there are
    // approved entries; render nothing when there's nothing to show.
    const visible = changeOrders.filter((co) => co.status === 'approved')
    if (visible.length === 0) return null
    return (
      <SectionShell>
        <SectionHeader count={visible.length} canAdd={false} onAdd={() => {}} />
        <List
          changeOrders={visible}
          readOnly
        />
      </SectionShell>
    )
  }

  async function handleSave(payload) {
    if (!contact?.id || !userId) return false
    try {
      const row = {
        contact_id: contact.id,
        user_id: userId,
        title: payload.title?.trim() || 'Change order',
        description: payload.description?.trim() || null,
        amount: Number(payload.amount) || 0,
        status: payload.status || 'draft',
        approval_method: payload.approval_method || null,
        approved_by_name: payload.approved_by_name?.trim() || null,
        approved_at: payload.status === 'approved' && !payload.approved_at
          ? new Date().toISOString()
          : (payload.approved_at || null)
      }
      let res
      if (payload.id) {
        res = await supabase
          .from('fh_change_orders')
          .update(row)
          .eq('id', payload.id)
          .select('*')
          .single()
      } else {
        // sequence_number is assigned by the BEFORE INSERT trigger.
        res = await supabase
          .from('fh_change_orders')
          .insert({ ...row, sequence_number: 0 })
          .select('*')
          .single()
      }
      if (res.error) throw res.error
      toastSuccess(payload.id ? 'Change order updated' : 'Change order added', `CO #${res.data?.sequence_number || ''}`.trim())

      // Notification on NEW change orders only — updates / approvals
      // don't ping the bell to avoid noise on every minor edit. The
      // approval-side notification can be wired separately if useful.
      // Best-effort; never blocks the save.
      if (!payload.id && res.data) {
        try {
          const moneyStr = Number(res.data.amount || 0).toLocaleString(undefined, {
            style: 'currency', currency: 'USD',
            minimumFractionDigits: 0, maximumFractionDigits: 0
          })
          const sign = res.data.amount >= 0 ? '+' : '−'
          await supabase.from('fh_notifications').insert({
            user_id: userId,
            kind: 'change_order_added',
            title: `CO #${res.data.sequence_number} added · ${sign}${Math.abs(res.data.amount) > 0 ? moneyStr : '$0'}`,
            body: `${contact?.name || 'Job'} · ${res.data.title || 'Change order'}`,
            link: `/jobs/${contact.id}?tab=quote`
          })
        } catch {}
      }

      onChange?.()
      return true
    } catch (e) {
      toastError("Couldn't save change order", e?.message || 'Try again.')
      return false
    }
  }

  async function handleApprove(co) {
    return handleSave({
      ...co,
      status: 'approved',
      approval_method: co.approval_method || 'verbal',
      approved_at: co.approved_at || new Date().toISOString()
    })
  }

  async function handleVoid(co) {
    if (!window.confirm(`Void CO #${co.sequence_number}? It will stop counting toward the contract total.`)) return
    await handleSave({ ...co, status: 'void' })
  }

  async function handleDelete(co) {
    if (!window.confirm(`Delete CO #${co.sequence_number}? This cannot be undone.`)) return
    try {
      const { error } = await supabase
        .from('fh_change_orders')
        .delete()
        .eq('id', co.id)
      if (error) throw error
      toastSuccess('Change order deleted', '')
      onChange?.()
    } catch (e) {
      toastError("Couldn't delete change order", e?.message || 'Try again.')
    }
  }

  return (
    <SectionShell>
      <SectionHeader
        count={changeOrders.length}
        canAdd={!creating && editingId == null}
        onAdd={() => setCreating(true)}
      />
      {creating && (
        <Editor
          isNew
          initial={{ title: '', description: '', amount: '', status: 'draft' }}
          onSave={async (payload) => { const ok = await handleSave(payload); if (ok) setCreating(false) }}
          onCancel={() => setCreating(false)}
        />
      )}
      <List
        changeOrders={changeOrders}
        editingId={editingId}
        onEdit={(id) => setEditingId(id)}
        onCancelEdit={() => setEditingId(null)}
        onSave={async (payload) => { const ok = await handleSave(payload); if (ok) setEditingId(null) }}
        onApprove={handleApprove}
        onVoid={handleVoid}
        onDelete={handleDelete}
      />
    </SectionShell>
  )
}

/* ─── presentational sub-components ─── */

function SectionShell({ children }) {
  return (
    <div style={{
      background: 'var(--v3-surface)',
      border: '1px solid var(--v3-border)',
      borderRadius: 14,
      overflow: 'hidden'
    }}>
      {children}
    </div>
  )
}

function SectionHeader({ count, canAdd, onAdd }) {
  return (
    <div style={{
      display: 'flex', alignItems: 'center', gap: 8,
      padding: '12px 16px',
      borderBottom: '1px solid var(--v3-border)',
      background: 'var(--v3-surface-2)'
    }}>
      <FileEdit size={14} aria-hidden="true" style={{ color: 'var(--v3-primary-bright)' }} />
      <span style={{
        fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
        letterSpacing: '0.16em', color: 'var(--v3-primary-bright)',
        textTransform: 'uppercase'
      }}>
        Change orders
        {count > 0 && (
          <span style={{ marginLeft: 8, color: 'var(--v3-text-muted)' }}>
            · {count}
          </span>
        )}
      </span>
      {canAdd && (
        <button
          type="button"
          onClick={onAdd}
          style={{
            marginLeft: 'auto',
            display: 'inline-flex', alignItems: 'center', gap: 4,
            padding: '6px 10px',
            borderRadius: 8,
            background: 'transparent',
            border: '1px solid var(--v3-border-strong)',
            color: 'var(--v3-text)',
            fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
            cursor: 'pointer'
          }}
        >
          <Plus size={12} aria-hidden="true" /> Add
        </button>
      )}
    </div>
  )
}

function List({ changeOrders, editingId, readOnly, onEdit, onCancelEdit, onSave, onApprove, onVoid, onDelete }) {
  if (!changeOrders.length) {
    return (
      <div style={{ padding: '24px 16px', textAlign: 'center', color: 'var(--v3-text-muted)', fontSize: 12, fontFamily: 'var(--font-body)' }}>
        <FileText size={18} aria-hidden="true" style={{ opacity: 0.6, marginBottom: 6 }} />
        <div>No change orders on this job yet.</div>
      </div>
    )
  }
  return (
    <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
      {changeOrders.map((co, i) => (
        <li key={co.id} style={{ borderTop: i > 0 ? '1px solid var(--v3-border)' : 'none' }}>
          {editingId === co.id ? (
            <Editor
              initial={co}
              onSave={onSave}
              onCancel={onCancelEdit}
            />
          ) : (
            <Row
              co={co}
              readOnly={readOnly}
              onEdit={() => onEdit?.(co.id)}
              onApprove={() => onApprove?.(co)}
              onVoid={() => onVoid?.(co)}
              onDelete={() => onDelete?.(co)}
            />
          )}
        </li>
      ))}
    </ul>
  )
}

function Row({ co, readOnly, onEdit, onApprove, onVoid, onDelete }) {
  const isApproved = co.status === 'approved'
  const isVoid = co.status === 'void'
  const isDraft = co.status === 'draft'
  const amt = Number(co.amount || 0)
  const isCredit = amt < 0

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '64px 1fr auto', gap: 14, padding: '12px 16px', alignItems: 'flex-start' }}>
      <div style={{
        fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
        letterSpacing: '0.04em', color: 'var(--v3-primary-bright)',
        fontVariantNumeric: 'tabular-nums', paddingTop: 2
      }}>
        CO #{co.sequence_number}
      </div>
      <div style={{ minWidth: 0 }}>
        <div style={{
          fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 600,
          color: isVoid ? 'var(--v3-text-muted)' : 'var(--v3-text)',
          textDecoration: isVoid ? 'line-through' : 'none'
        }}>
          {co.title}
        </div>
        {co.description && (
          <div style={{ marginTop: 3, fontFamily: 'var(--font-body)', fontSize: 11, color: 'var(--v3-text-muted)', whiteSpace: 'pre-wrap' }}>
            {co.description}
          </div>
        )}
        <div style={{ marginTop: 6, display: 'flex', gap: 6, flexWrap: 'wrap' }}>
          {isDraft && <Tag tone="muted">DRAFT</Tag>}
          {isApproved && <Tag tone="green">APPROVED{co.approved_at ? ` · ${shortDate(co.approved_at)}` : ''}</Tag>}
          {isVoid && <Tag tone="muted">VOID</Tag>}
          {co.status === 'sent' && <Tag tone="gold">SENT</Tag>}
          {co.status === 'rejected' && <Tag tone="red">REJECTED</Tag>}
        </div>
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
        <div style={{
          fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
          color: isVoid ? 'var(--v3-text-muted)' : isCredit ? 'var(--v3-success-bright, #4ade80)' : 'var(--v3-text)',
          fontVariantNumeric: 'tabular-nums',
          textDecoration: isVoid ? 'line-through' : 'none',
          whiteSpace: 'nowrap'
        }}>
          {isCredit ? `−${money(Math.abs(amt))}` : `+${money(amt)}`}
        </div>
        {!readOnly && (
          <div style={{ display: 'flex', gap: 4 }}>
            {!isApproved && !isVoid && (
              <IconBtn onClick={onApprove} aria-label="Approve change order" title="Approve">
                <Check size={12} aria-hidden="true" />
              </IconBtn>
            )}
            <IconBtn onClick={onEdit} aria-label="Edit change order" title="Edit">
              <FileEdit size={12} aria-hidden="true" />
            </IconBtn>
            {!isVoid && (
              <IconBtn onClick={onVoid} aria-label="Void change order" title="Void">
                <X size={12} aria-hidden="true" />
              </IconBtn>
            )}
            <IconBtn onClick={onDelete} aria-label="Delete change order" tone="danger" title="Delete">
              <Trash2 size={12} aria-hidden="true" />
            </IconBtn>
          </div>
        )}
      </div>
    </div>
  )
}

function Editor({ initial, isNew, onSave, onCancel }) {
  const [form, setForm] = useState({
    id: initial.id || null,
    title: initial.title || '',
    description: initial.description || '',
    amount: initial.amount != null ? String(initial.amount) : '',
    status: initial.status || 'draft',
    approval_method: initial.approval_method || '',
    approved_by_name: initial.approved_by_name || '',
    approved_at: initial.approved_at || null
  })
  const [saving, setSaving] = useState(false)

  function set(k, v) { setForm((prev) => ({ ...prev, [k]: v })) }

  async function submit() {
    if (!form.title.trim()) {
      toastError('Title required', 'Enter a short label for the change order.')
      return
    }
    setSaving(true)
    await onSave?.(form)
    setSaving(false)
  }

  return (
    <div style={{ padding: 16, background: 'var(--v3-surface-2)', borderTop: isNew ? 'none' : '1px solid var(--v3-border)' }}>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 140px', gap: 10 }}>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>Title</span>
          <input
            type="text"
            value={form.title}
            onChange={(e) => set('title', e.target.value)}
            placeholder="Rot at SW corner — replace ~8' bottom plate"
            style={inputStyle}
          />
        </label>
        <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          <span style={labelStyle}>Amount</span>
          <div style={{ position: 'relative' }}>
            <span style={{ position: 'absolute', left: 10, top: 9, color: 'var(--v3-text-muted)', fontSize: 13 }}>$</span>
            <input
              type="text"
              inputMode="decimal"
              value={form.amount}
              onChange={(e) => set('amount', e.target.value)}
              placeholder="0"
              style={{ ...inputStyle, paddingLeft: 20 }}
            />
          </div>
        </label>
      </div>
      <label style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 10 }}>
        <span style={labelStyle}>Description (optional)</span>
        <textarea
          rows={2}
          value={form.description}
          onChange={(e) => set('description', e.target.value)}
          placeholder="Brief scope + reason"
          style={{ ...inputStyle, resize: 'vertical' }}
        />
      </label>
      <div style={{ display: 'flex', gap: 6, marginTop: 10, flexWrap: 'wrap' }}>
        {['draft', 'sent', 'approved', 'rejected'].map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => set('status', s)}
            style={{
              ...chipStyle,
              ...(form.status === s ? chipActiveStyle : null)
            }}
          >
            {s.charAt(0).toUpperCase() + s.slice(1)}
          </button>
        ))}
      </div>
      {form.status === 'approved' && (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginTop: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle}>Approved by</span>
            <input
              type="text"
              value={form.approved_by_name}
              onChange={(e) => set('approved_by_name', e.target.value)}
              placeholder="Client name"
              style={inputStyle}
            />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={labelStyle}>Method</span>
            <select
              value={form.approval_method || ''}
              onChange={(e) => set('approval_method', e.target.value || null)}
              style={inputStyle}
            >
              <option value="">—</option>
              <option value="verbal">Verbal</option>
              <option value="text">Text</option>
              <option value="email">Email</option>
              <option value="in_person">In person</option>
              <option value="signature_typed">Typed signature</option>
              <option value="signature_drawn">Drawn signature</option>
            </select>
          </label>
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', marginTop: 14 }}>
        <button type="button" onClick={onCancel} disabled={saving} style={ghostBtnStyle}>
          Cancel
        </button>
        <button type="button" onClick={submit} disabled={saving} style={primaryBtnStyle}>
          {saving ? 'Saving…' : isNew ? 'Add change order' : 'Save changes'}
        </button>
      </div>
    </div>
  )
}

function Tag({ tone, children }) {
  const palette = {
    muted: { bg: 'rgba(255,255,255,0.04)', fg: 'var(--v3-text-muted)', br: 'rgba(255,255,255,0.10)' },
    green: { bg: 'rgba(74, 222, 128, 0.12)', fg: 'var(--v3-success-bright, #4ade80)', br: 'rgba(74, 222, 128, 0.30)' },
    gold:  { bg: 'rgba(228, 190, 111, 0.12)', fg: 'var(--v3-primary-bright)', br: 'rgba(228, 190, 111, 0.30)' },
    red:   { bg: 'rgba(232, 90, 87, 0.10)', fg: 'var(--v3-danger-bright, #f5a294)', br: 'rgba(232, 90, 87, 0.30)' }
  }[tone] || { bg: 'rgba(255,255,255,0.04)', fg: 'var(--v3-text-muted)', br: 'rgba(255,255,255,0.10)' }
  return (
    <span style={{
      display: 'inline-flex', alignItems: 'center',
      padding: '3px 7px', borderRadius: 999,
      background: palette.bg, border: `1px solid ${palette.br}`, color: palette.fg,
      fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
      letterSpacing: '0.16em', textTransform: 'uppercase'
    }}>
      {children}
    </span>
  )
}

function IconBtn({ children, onClick, tone, title, ...rest }) {
  const danger = tone === 'danger'
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      {...rest}
      style={{
        width: 26, height: 26, borderRadius: 6,
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        background: 'transparent',
        border: `1px solid ${danger ? 'rgba(232, 90, 87, 0.35)' : 'var(--v3-border-strong)'}`,
        color: danger ? 'var(--v3-danger-bright, #f5a294)' : 'var(--v3-text)',
        cursor: 'pointer'
      }}
    >
      {children}
    </button>
  )
}

const labelStyle = {
  fontFamily: 'var(--font-body)', fontSize: 9, fontWeight: 700,
  letterSpacing: '0.14em', color: 'var(--v3-text-muted)', textTransform: 'uppercase'
}
const inputStyle = {
  width: '100%', boxSizing: 'border-box',
  padding: '9px 12px', borderRadius: 8,
  background: 'var(--v3-surface)', border: '1px solid var(--v3-border-strong)',
  color: 'var(--v3-text)', fontFamily: 'var(--font-body)', fontSize: 13, outline: 'none'
}
const chipStyle = {
  padding: '6px 12px', borderRadius: 999,
  background: 'transparent', border: '1px solid var(--v3-border-strong)',
  color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 600,
  cursor: 'pointer'
}
const chipActiveStyle = {
  background: 'rgba(228, 190, 111, 0.15)',
  borderColor: 'var(--v3-primary)',
  color: 'var(--v3-primary-bright)'
}
const primaryBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 14px', borderRadius: 8,
  border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
  background: 'linear-gradient(180deg, var(--v3-primary-bright) 0%, var(--v3-primary) 100%)',
  color: '#1a1208',
  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700,
  letterSpacing: '0.06em', textTransform: 'uppercase', cursor: 'pointer'
}
const ghostBtnStyle = {
  display: 'inline-flex', alignItems: 'center', gap: 6,
  padding: '8px 12px', borderRadius: 8,
  background: 'transparent', border: '1px solid var(--v3-border-strong)',
  color: 'var(--v3-text)',
  fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600, cursor: 'pointer'
}
