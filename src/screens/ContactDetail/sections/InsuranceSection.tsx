// src/screens/ContactDetail/sections/InsuranceSection.tsx
//
// Insurance-restoration claim form. Sits inside the Details tab as a
// dedicated sub-tab so the 9 carrier-side fields don't pollute the
// scope-of-work surfaces for cash jobs.
//
// Schema: fh_insurance_claims (migration 018). One row per contact;
// the unique constraint on contact_id makes save = upsert.
//
// When populated, the payload flows automatically into:
//   - ProposalTemplate / generateQuote  → InsuranceModeBlock section
//   - InvoiceTemplate / generateInvoice → InsuranceModeBlock section
// via the existing `insurance` prop already supported by both
// templates (Phase 1 wired the block; this section feeds it).
//
// Partner view: rendered read-only (RLS denies writes anyway). Cash
// jobs (no claim on file): renders a single CTA card to enable.

import { useEffect, useState } from 'react'
import { Shield, Save as SaveIcon, X, Trash2 } from 'lucide-react'
import { supabase } from '../../../lib/supabase.ts'
import { toastSuccess, toastError } from '../../../lib/toast.ts'
import { useConfirm } from '../../../components/ConfirmSheet.tsx'

const FIELDS = [
  { key: 'claim_number',     label: 'Claim number',     type: 'text',  placeholder: 'CL-2026-04812' },
  { key: 'carrier',          label: 'Carrier',          type: 'text',  placeholder: 'State Farm' },
  { key: 'adjuster',         label: 'Adjuster',         type: 'text',  placeholder: 'Karen Whitfield · (615) 555-0184' },
  { key: 'deductible',       label: 'Deductible',       type: 'money', placeholder: '1000' },
  { key: 'rcv',              label: 'RCV',              type: 'money', placeholder: '24800' },
  { key: 'acv',              label: 'ACV',              type: 'money', placeholder: '18200' },
  { key: 'depreciation',     label: 'Depreciation',     type: 'money', placeholder: '6600' },
  { key: 'supplement_amount',label: 'Supplement',       type: 'money', placeholder: '0' },
  { key: 'mortgage_company', label: 'Mortgage company', type: 'text',  placeholder: 'Wells Fargo (when applicable)' }
]

function emptyForm(): Record<string, any> {
  return FIELDS.reduce((acc: Record<string, any>, f: any) => { acc[f.key] = ''; return acc }, {} as Record<string, any>)
}

function hydrate(insurance: any) {
  const out = emptyForm()
  if (!insurance) return out
  for (const f of FIELDS) {
    const v = insurance[f.key]
    out[f.key] = v == null ? '' : String(v)
  }
  return out
}

export default function InsuranceSection({ contact, userId, insurance, onChange }: any) {
  const confirm = useConfirm()
  const isOwner = contact && contact.user_id === userId
  const [editing, setEditing] = useState(!insurance)
  const [form, setForm] = useState(() => hydrate(insurance))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)

  useEffect(() => {
    setForm(hydrate(insurance))
    setEditing(!insurance && isOwner)
  }, [insurance, isOwner])

  function setField(k: any, v: any) {
    setForm((prev) => ({ ...prev, [k]: v }))
  }

  // Partner view — read-only summary. Insurance details RLS prevents
  // partners reading the row at all, so this branch is defensive: it
  // shows a generic "private to contractor" notice.
  if (!isOwner) {
    return (
      <div style={panelStyle()}>
        <div style={panelHeaderStyle()}>
          <Shield size={14} aria-hidden="true" />
          Insurance claim
        </div>
        <div style={{ padding: 16, color: 'var(--v3-text-muted)', fontSize: 13, fontFamily: 'var(--font-body)' }}>
          Insurance details are private to the contractor on file.
        </div>
      </div>
    )
  }

  // Empty state — no claim on file
  if (!insurance && !editing) {
    return (
      <div style={panelStyle()}>
        <div style={panelHeaderStyle()}>
          <Shield size={14} aria-hidden="true" />
          Insurance claim
        </div>
        <div style={{ padding: '20px 16px', display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 10 }}>
          <div style={{ fontSize: 13, color: 'var(--v3-text-secondary)', fontFamily: 'var(--font-body)', lineHeight: 1.5, maxWidth: 480 }}>
            Tracking a carrier? Add the claim payload so it surfaces on every proposal + invoice for this job.
          </div>
          <button type="button" onClick={() => setEditing(true)} style={primaryBtnStyle()}>
            Add insurance details
          </button>
        </div>
      </div>
    )
  }

  async function handleSave() {
    if (!contact?.id || !userId) return
    setSaving(true)
    try {
      const payload: Record<string, any> = { contact_id: contact.id, user_id: userId }
      for (const f of FIELDS) {
        const raw = String(form[f.key] || '').trim()
        if (!raw) {
          payload[f.key] = null
          continue
        }
        payload[f.key] = f.type === 'money' ? Number(raw.replace(/[^0-9.-]/g, '')) || null : raw
      }
      const { data, error } = await supabase
        .from('fh_insurance_claims')
        .upsert(payload as any, { onConflict: 'contact_id' })
        .select('*')
        .single()
      if (error) throw error
      toastSuccess('Insurance saved', `Claim ${data?.claim_number || ''}`.trim())
      onChange?.(data)
      setEditing(false)
    } catch (e: any) {
      toastError("Couldn't save insurance", e?.message || 'Try again.')
    } finally {
      setSaving(false)
    }
  }

  async function handleDelete() {
    if (!insurance?.id) return
    if (!(await confirm({ title: 'Remove insurance claim from this job?', body: 'This cannot be undone.', destructive: true, confirmLabel: 'Remove' }))) return
    setDeleting(true)
    try {
      const { error } = await supabase
        .from('fh_insurance_claims')
        .delete()
        .eq('id', insurance.id)
      if (error) throw error
      toastSuccess('Insurance removed', '')
      onChange?.(null)
    } catch (e: any) {
      toastError("Couldn't remove insurance", e?.message || 'Try again.')
    } finally {
      setDeleting(false)
    }
  }

  // Read-only view (saved + not editing)
  if (insurance && !editing) {
    const hasAny = FIELDS.some((f) => insurance[f.key] != null && insurance[f.key] !== '')
    return (
      <div style={panelStyle()}>
        <div style={panelHeaderStyle()}>
          <Shield size={14} aria-hidden="true" />
          Insurance claim
          <div style={{ marginLeft: 'auto', display: 'flex', gap: 8 }}>
            <button type="button" onClick={() => setEditing(true)} style={ghostBtnStyle()}>
              Edit
            </button>
            <button type="button" onClick={handleDelete} disabled={deleting} style={dangerGhostBtnStyle()} aria-label="Remove insurance claim">
              <Trash2 size={13} aria-hidden="true" />
            </button>
          </div>
        </div>
        <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))', gap: 14 }}>
          {hasAny ? FIELDS.map((f) => {
            const v = insurance[f.key]
            if (v == null || v === '') return null
            return (
              <div key={f.key}>
                <div style={labelStyle()}>{f.label}</div>
                <div style={valueStyle()}>
                  {f.type === 'money' ? formatMoney(v) : String(v)}
                </div>
              </div>
            )
          }) : (
            <div style={{ color: 'var(--v3-text-muted)', fontSize: 12 }}>No claim details on file yet.</div>
          )}
        </div>
      </div>
    )
  }

  // Edit form
  return (
    <div style={panelStyle()}>
      <div style={panelHeaderStyle()}>
        <Shield size={14} aria-hidden="true" />
        {insurance ? 'Edit insurance claim' : 'Add insurance claim'}
      </div>
      <div style={{ padding: 16, display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: 12 }}>
        {FIELDS.map((f) => (
          <label key={f.key} style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <span style={labelStyle()}>{f.label}</span>
            {f.type === 'money' ? (
              <div style={{ position: 'relative', display: 'flex', alignItems: 'center' }}>
                <span style={{
                  position: 'absolute', left: 12,
                  color: 'var(--v3-text-muted)', fontFamily: 'var(--font-body)', fontSize: 13,
                  pointerEvents: 'none'
                }}>$</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={form[f.key]}
                  onChange={(e) => setField(f.key, e.target.value)}
                  placeholder={f.placeholder}
                  style={{ ...inputStyle(), paddingLeft: 22 }}
                />
              </div>
            ) : (
              <input
                type="text"
                value={form[f.key]}
                onChange={(e) => setField(f.key, e.target.value)}
                placeholder={f.placeholder}
                style={inputStyle()}
              />
            )}
          </label>
        ))}
      </div>
      <div style={{ padding: '0 16px 16px', display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
        {insurance && (
          <button type="button" onClick={() => { setForm(hydrate(insurance)); setEditing(false) }} disabled={saving} style={ghostBtnStyle()}>
            <X size={13} aria-hidden="true" /> Cancel
          </button>
        )}
        <button type="button" onClick={handleSave} disabled={saving} style={primaryBtnStyle()}>
          <SaveIcon size={13} aria-hidden="true" />
          {saving ? 'Saving…' : insurance ? 'Save changes' : 'Save insurance'}
        </button>
      </div>
    </div>
  )
}

/* ----- inline style helpers (no new CSS file) ----- */
function panelStyle() {
  return {
    background: 'var(--v3-surface)',
    border: '1px solid var(--v3-border)',
    borderRadius: 14,
    overflow: 'hidden'
  }
}
function panelHeaderStyle() {
  return {
    display: 'flex',
    alignItems: 'center',
    gap: 8,
    padding: '12px 16px',
    borderBottom: '1px solid var(--v3-border)',
    background: 'var(--v3-surface-2)',
    fontFamily: 'var(--font-body)',
    fontSize: 11,
    fontWeight: 700,
    letterSpacing: '0.16em',
    color: 'var(--v3-primary-bright)',
    textTransform: 'uppercase'
  }
}
function labelStyle(): import('react').CSSProperties {
  return {
    fontFamily: 'var(--font-body)',
    fontSize: 9,
    fontWeight: 700,
    letterSpacing: '0.14em',
    color: 'var(--v3-text-muted)',
    textTransform: 'uppercase'
  }
}
function valueStyle(): import('react').CSSProperties {
  return {
    marginTop: 4,
    fontFamily: 'var(--font-body)',
    fontSize: 14,
    fontWeight: 600,
    color: 'var(--v3-text)',
    wordBreak: 'break-word'
  }
}
function inputStyle(): import('react').CSSProperties {
  return {
    width: '100%',
    boxSizing: 'border-box',
    padding: '10px 12px',
    borderRadius: 8,
    background: 'var(--v3-surface-2)',
    border: '1px solid var(--v3-border-strong)',
    color: 'var(--v3-text)',
    fontFamily: 'var(--font-body)',
    fontSize: 13,
    outline: 'none'
  }
}
function primaryBtnStyle() {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '9px 14px',
    borderRadius: 8,
    border: '1px solid color-mix(in srgb, var(--v3-primary) 55%, transparent)',
    background: 'linear-gradient(180deg, var(--v3-primary-bright) 0%, var(--v3-primary) 100%)',
    color: '#1a1208',
    fontFamily: 'var(--font-body)',
    fontSize: 12,
    fontWeight: 700,
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    cursor: 'pointer'
  }
}
function ghostBtnStyle() {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
    padding: '7px 12px',
    borderRadius: 8,
    background: 'transparent',
    border: '1px solid var(--v3-border-strong)',
    color: 'var(--v3-text)',
    fontFamily: 'var(--font-body)',
    fontSize: 12,
    fontWeight: 600,
    cursor: 'pointer'
  }
}
function dangerGhostBtnStyle() {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 4,
    padding: '7px 10px',
    borderRadius: 8,
    background: 'transparent',
    border: '1px solid color-mix(in srgb, var(--v3-danger, #B33A3A) 40%, transparent)',
    color: 'var(--v3-danger-bright, #f5a294)',
    cursor: 'pointer'
  }
}

function formatMoney(n: any) {
  const v = Number(n || 0)
  return v.toLocaleString(undefined, {
    style: 'currency',
    currency: 'USD',
    minimumFractionDigits: 0,
    maximumFractionDigits: 0
  })
}
