// src/components/settings/RateCardEditor.tsx
//
// Per-tenant rate card editor. Lives in the Settings screen. Lists every
// trade from the seed RATE_CARD + every custom row the user has added;
// per row the user can edit unit / low / high and save (or reset back
// to the default). New custom trades go in via the "Add trade" form at
// the bottom and use a free-form key (slugified).
//
// All persistence flows through lib/rateCard.ts so Bid.jsx and any
// future consumer pulls the same merged view via loadUserRateCard().

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Save as SaveIcon, RotateCcw, Trash2, Check } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.tsx'
import { hapticTap, hapticSuccess, hapticError } from '../../lib/haptics.ts'
import { toastSuccess, toastError } from '../../lib/toast.ts'
import { useArmedId } from '../../lib/secondTap.ts'
import { clearDraft, readDraftEntry, sameDraft, writeDraft } from '../../lib/drafts.ts'
import DraftRestored from '../DraftRestored.tsx'
import {
  RATE_CARD, TRADE_LABELS, RATE_UNITS,
  loadUserRateCard, upsertRate, resetRate
} from '../../lib/rateCard.ts'
import { Eyebrow } from '../v3'
import '../../styles/settings.css'
import { plainError } from '../../lib/serviceErrors.ts'

function slugify(s: any) {
  return String(s || '')
    .trim()
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toLowerCase())
}

// Rates typed and not saved yet stay on the device (D23), each with the
// saved rate it started from, so a reload keeps them ready to save. One
// whose trade was saved differently since is dropped.
const RATE_DRAFT = 'edit:rate-card'
function savedRate(current: any) {
  return { unit: current?.unit || 'lump', rate_low: String(current?.low ?? 0), rate_high: String(current?.high ?? 0) }
}

export default function RateCardEditor() {
  const { user } = useAuth()
  const userId = user?.id
  const [merged, setMerged] = useState<any>({})
  const [overrides, setOverrides] = useState<any>({})
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState<any>({}) // tradeKey -> { unit, rate_low, rate_high, dirty, saving }
  // Deleting a custom trade asks with a second tap on the same button (D57).
  const deleteTap = useArmedId()
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')

  const [restored, setRestored] = useState(false)
  const draftReady = useRef(false)
  useEffect(() => {
    if (loading || draftReady.current) return
    draftReady.current = true
    const entry = readDraftEntry<Record<string, any>>(RATE_DRAFT)
    if (!entry) return
    const from = (entry.base || {}) as Record<string, any>
    const back: Record<string, any> = {}
    for (const [key, typed] of Object.entries(entry.form)) {
      if (sameDraft(from[key], savedRate(merged[key] || RATE_CARD[key]))) back[key] = { ...typed, dirty: true }
    }
    if (Object.keys(back).length === 0) return
    setDraft((d: any) => ({ ...back, ...d }))
    setRestored(true)
  }, [loading, merged])
  useEffect(() => {
    if (!draftReady.current) return
    const form: Record<string, any> = {}
    const from: Record<string, any> = {}
    for (const [key, d] of Object.entries(draft) as [string, any][]) {
      if (!d?.dirty) continue
      form[key] = { unit: d.unit, rate_low: d.rate_low, rate_high: d.rate_high }
      from[key] = savedRate(merged[key] || RATE_CARD[key])
    }
    if (Object.keys(form).length) writeDraft(RATE_DRAFT, form, from)
    else clearDraft(RATE_DRAFT)
  }, [draft, merged])
  const unsaved = Object.values(draft).some((d: any) => d?.dirty)

  const reload = useCallback(async () => {
    if (!userId) return
    setLoading(true)
    const { merged, overrides } = await loadUserRateCard(userId)
    setMerged(merged)
    setOverrides(overrides)
    setLoading(false)
  }, [userId])

  useEffect(() => { reload() }, [reload])

  const rows = useMemo(() => {
    const seedKeys = Object.keys(RATE_CARD)
    const customKeys = Object.keys(merged).filter((k) => !seedKeys.includes(k))
    return [
      ...seedKeys.map((k) => ({ key: k, custom: false, current: merged[k] || RATE_CARD[k] })),
      ...customKeys.map((k) => ({ key: k, custom: true, current: merged[k] }))
    ]
  }, [merged])

  function getDraft(row: any) {
    return draft[row.key] || {
      unit: row.current?.unit || 'lump',
      rate_low: String(row.current?.low ?? 0),
      rate_high: String(row.current?.high ?? 0),
      dirty: false
    }
  }

  function setField(key: any, field: any, value: any) {
    setDraft((d: any) => ({
      ...d,
      [key]: {
        ...(d[key] || {
          unit: (merged[key] || RATE_CARD[key])?.unit || 'lump',
          rate_low: String((merged[key] || RATE_CARD[key])?.low ?? 0),
          rate_high: String((merged[key] || RATE_CARD[key])?.high ?? 0),
        }),
        [field]: value,
        dirty: true
      }
    }))
  }

  async function save(row: any) {
    const d = getDraft(row)
    const low = Number(d.rate_low) || 0
    const high = Number(d.rate_high) || 0
    if (high < low) {
      hapticError()
      toastError('High must be ≥ low', `${row.current?.label || row.key} rate range is invalid.`)
      return
    }
    setDraft((dd: any) => ({ ...dd, [row.key]: { ...d, saving: true } }))
    try {
      await upsertRate({
        userId: user!.id,
        tradeKey: row.key,
        patch: {
          label: row.current?.label || TRADE_LABELS[row.key] || row.key,
          unit: d.unit,
          rate_low: low,
          rate_high: high
        }
      })
      hapticSuccess()
      toastSuccess('Rate saved', `${row.current?.label || row.key}: $${low} to $${high}/${d.unit}`)
      await reload()
      setDraft((dd: any) => {
        const next = { ...dd }
        delete next[row.key]
        return next
      })
    } catch (err: any) {
      hapticError()
      toastError("Couldn't save rate", plainError(err, 'Try again.'))
      setDraft((dd: any) => ({ ...dd, [row.key]: { ...d, saving: false } }))
    }
  }

  async function revert(row: any) {
    if (!overrides[row.key]) {
      // No override to delete, just clear local draft.
      setDraft((dd: any) => {
        const next = { ...dd }
        delete next[row.key]
        return next
      })
      return
    }
    try {
      await resetRate({ userId: user!.id, tradeKey: row.key })
      hapticSuccess()
      toastSuccess(row.custom ? 'Trade deleted' : 'Reset to default', row.current?.label || row.key)
      await reload()
      setDraft((dd: any) => {
        const next = { ...dd }
        delete next[row.key]
        return next
      })
    } catch (err: any) {
      hapticError()
      toastError("Couldn't reset", plainError(err, 'Try again.'))
    }
  }

  async function addCustom() {
    const label = newLabel.trim()
    if (!label) return
    const key = slugify(label) || `custom${Date.now().toString(36)}`
    if (merged[key]) {
      hapticError()
      toastError('Trade already exists', `"${label}" maps to an existing trade.`)
      return
    }
    try {
      await upsertRate({
        userId: user!.id,
        tradeKey: key,
        patch: { label, unit: 'lump', rate_low: 0, rate_high: 0 }
      })
      hapticSuccess()
      toastSuccess('Trade added', label)
      setNewLabel('')
      setAdding(false)
      await reload()
    } catch (err: any) {
      hapticError()
      toastError("Couldn't add trade", plainError(err, 'Try again.'))
    }
  }

  if (loading) {
    return (
      <div style={{
        padding: 12, borderRadius: 10,
        background: 'var(--surface-2)', border: '1px solid var(--rule)',
        color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 14
      }}>
        Loading rate card…
      </div>
    )
  }

  return (
    <div className="fh-rate-editor" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{
        margin: '-2px 0 6px',
        fontFamily: 'var(--font-body)', fontSize: 14,
        color: 'var(--fh-ink-2)',
        lineHeight: 1.45
      }}>
        These rates are used for bid estimates. Each trade saves separately. Change a rate, then use its save button. Reset restores the default.
      </p>
      {restored && unsaved && <DraftRestored onDiscard={() => { setDraft({}); setRestored(false) }} />}

      <div style={{
        borderRadius: 10,
        background: 'var(--surface-1, var(--surface-2))',
        border: '1px solid var(--rule)',
        overflow: 'hidden'
      }}>
        {rows.map((row, i) => {
          const d = getDraft(row)
          const tradeLabel = row.current?.label || TRADE_LABELS[row.key] || row.key
          const fieldId = `rate-${row.key}`
          const isCustom = row.custom
          const isOverride = !!overrides[row.key]
          const seedLow = RATE_CARD[row.key]?.low
          const seedHigh = RATE_CARD[row.key]?.high
          const seedUnit = RATE_CARD[row.key]?.unit
          const showSeed = !isCustom && (
            Number(d.rate_low) !== seedLow ||
            Number(d.rate_high) !== seedHigh ||
            d.unit !== seedUnit
          )
          return (
            <fieldset
              key={row.key}
              className="fh-rate-editor__trade"
              style={{ borderTop: i === 0 ? 'none' : '1px solid var(--rule)' }}
            >
              <legend>{tradeLabel} rates</legend>
              <div className="fh-rate-editor__badges">
                {isCustom && (
                  <Eyebrow style={{ padding: '4px 8px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-muted)' }}>
                    Custom
                  </Eyebrow>
                )}
                {isOverride && !isCustom && (
                  <Eyebrow style={{ padding: '4px 8px', borderRadius: 10, background: 'rgba(201,150,58,0.14)', border: '1px solid rgba(201,150,58,0.35)', color: 'var(--fh-gold-ink)' }}>
                    Customized
                  </Eyebrow>
                )}
              </div>

              {/* Row 2, unit / low / high inputs */}
              <div className="fh-rate-editor__fields">
                <label htmlFor={`${fieldId}-unit`}>
                  <span>Unit</span>
                <select
                  id={`${fieldId}-unit`}
                  aria-label={`${tradeLabel} unit`}
                  value={d.unit}
                  onChange={(e) => setField(row.key, 'unit', e.target.value)}
                  disabled={d.saving}
                  style={cellSelect}
                >
                  {RATE_UNITS.includes(d.unit) ? null : <option value={d.unit}>{d.unit}</option>}
                  {RATE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                </label>
                <label htmlFor={`${fieldId}-low`}>
                  <span>Low price ($)</span>
                <input
                  id={`${fieldId}-low`}
                  aria-label={`${tradeLabel} low price ($)`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.5"
                  value={d.rate_low}
                  onChange={(e) => setField(row.key, 'rate_low', e.target.value)}
                  disabled={d.saving}
                  placeholder="Low"
                  style={cellInput}
                />
                </label>
                <label htmlFor={`${fieldId}-high`}>
                  <span>High price ($)</span>
                <input
                  id={`${fieldId}-high`}
                  aria-label={`${tradeLabel} high price ($)`}
                  type="number"
                  inputMode="decimal"
                  min={0}
                  step="0.5"
                  value={d.rate_high}
                  onChange={(e) => setField(row.key, 'rate_high', e.target.value)}
                  disabled={d.saving}
                  placeholder="High"
                  style={cellInput}
                />
                </label>
                <div className="fh-rate-editor__actions">
                  {d.dirty && (
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.95 }}
                      onClick={() => { hapticTap(); save(row) }}
                      disabled={d.saving}
                      aria-label={`Save ${tradeLabel} rate`}
                      title={`Save ${tradeLabel} rate`}
                      style={iconBtn('primary', d.saving)}
                    >
                      {d.saving ? <Check size={14} /> : <SaveIcon size={14} />}
                    </motion.button>
                  )}
                  {(isOverride || isCustom) && (
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.95 }}
                      onClick={() => {
                        hapticTap()
                        if (isCustom) deleteTap.tap(row.key, () => { void revert(row) })
                        else void revert(row)
                      }}
                      disabled={d.saving}
                      aria-label={isCustom
                        ? deleteTap.armedId === row.key ? `Tap again to delete ${tradeLabel}` : `Delete ${tradeLabel} trade`
                        : `Reset ${tradeLabel} to default`}
                      title={isCustom ? `Delete ${tradeLabel} trade` : `Reset ${tradeLabel} to default`}
                      style={isCustom && deleteTap.armedId === row.key
                        ? { ...iconBtn('muted', d.saving), width: 'auto', padding: '0 12px', display: 'inline-flex', alignItems: 'center', gap: 8, color: 'var(--v3-danger-text)' }
                        : iconBtn('muted', d.saving)}
                    >
                      {isCustom ? <Trash2 size={14} /> : <RotateCcw size={14} />}
                      {isCustom && deleteTap.armedId === row.key && <span style={{ fontSize: 12, fontWeight: 700 }}>Tap again to delete</span>}
                    </motion.button>
                  )}
                </div>
              </div>

              {/* Seed hint when overridden */}
              {showSeed && (
                <div style={{
                  fontFamily: 'var(--font-body)', fontSize: 14,
                  color: 'var(--fh-ink-2)',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  Default · {seedUnit} · ${seedLow} to ${seedHigh}
                </div>
              )}
            </fieldset>
          )
        })}
      </div>

      {/* Add custom trade */}
      {adding ? (
        <div style={{
          padding: '12px 12px',
          borderRadius: 10,
          background: 'var(--surface-2)',
          border: '1px solid var(--rule)',
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          gap: 8,
          alignItems: 'center'
        }}>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            aria-label="New trade name"
            placeholder="e.g. Cabinet install"
            autoFocus
            style={cellInput}
          />
          <button
            type="button"
            onClick={() => { hapticTap(); addCustom() }}
            disabled={!newLabel.trim()}
            style={{
              minHeight: 44, padding: '8px 12px', borderRadius: 10, border: 'none',
              background: 'var(--field-gold, #C9963A)',
              color: 'var(--on-gold, #141414)',
              fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 700,
              letterSpacing: 0,
              cursor: newLabel.trim() ? 'pointer' : 'wait',
              opacity: newLabel.trim() ? 1 : 0.5
            }}
          >
            Add
          </button>
          <button
            type="button"
            onClick={() => { setAdding(false); setNewLabel('') }}
            style={iconBtn('muted', false)}
            aria-label="Cancel adding trade"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { hapticTap(); setAdding(true) }}
          style={{
            padding: '12px 12px',
            borderRadius: 10,
            border: '1px dashed var(--rule)',
            background: 'transparent',
            color: 'var(--ink-muted)',
            fontFamily: 'var(--font-body)', fontSize: 14, fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 8,
            alignSelf: 'flex-start'
          }}
        >
          <Plus size={13} /> Add trade
        </button>
      )}
    </div>
  )
}

const cellInput: import('react').CSSProperties = {
  padding: '8px 12px',
  borderRadius: 10,
  background: 'var(--surface-2)',
  border: '1px solid var(--rule)',
  color: 'var(--ink-strong)',
  fontFamily: 'var(--font-body)',
  fontSize: 14,
  outline: 'none',
  width: '100%',
  minWidth: 0,
  minHeight: 44,
  boxSizing: 'border-box',
  fontVariantNumeric: 'tabular-nums'
}

const cellSelect: import('react').CSSProperties = {
  ...cellInput,
  padding: '8px 8px',
  cursor: 'pointer'
}

function iconBtn(tone: any, busy: any) {
  const palette = tone === 'primary'
    ? { bg: 'var(--field-gold, #C9963A)', fg: 'var(--on-gold, #141414)', border: 'rgba(201,150,58,0.4)' }
    : { bg: 'var(--surface-2)', fg: 'var(--ink-muted)', border: 'var(--rule)' }
  return {
    width: 44, height: 44, borderRadius: 10,
    background: palette.bg,
    border: `1px solid ${palette.border}`,
    color: palette.fg,
    display: 'grid', placeItems: 'center',
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.6 : 1
  }
}
