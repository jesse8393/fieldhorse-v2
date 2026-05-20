// src/components/settings/RateCardEditor.jsx
//
// Per-tenant rate card editor. Lives in the Settings screen. Lists every
// trade from the seed RATE_CARD + every custom row the user has added;
// per row the user can edit unit / low / high and save (or reset back
// to the default). New custom trades go in via the "Add trade" form at
// the bottom and use a free-form key (slugified).
//
// All persistence flows through lib/rateCard.ts so Bid.jsx and any
// future consumer pulls the same merged view via loadUserRateCard().

import { useEffect, useMemo, useState } from 'react'
import { motion } from 'framer-motion'
import { Plus, Save as SaveIcon, RotateCcw, Trash2, Check } from 'lucide-react'
import { useAuth } from '../../contexts/AuthContext.jsx'
import { hapticTap, hapticSuccess, hapticError } from '../../lib/haptics.js'
import { toastSuccess, toastError } from '../../lib/toast.js'
import {
  RATE_CARD, TRADE_LABELS, RATE_UNITS,
  loadUserRateCard, upsertRate, resetRate
} from '../../lib/rateCard.ts'

function slugify(s) {
  return String(s || '')
    .trim()
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .replace(/\s+(.)/g, (_, c) => c.toUpperCase())
    .replace(/^(.)/, (_, c) => c.toLowerCase())
}

export default function RateCardEditor() {
  const { user } = useAuth()
  const [merged, setMerged] = useState({})
  const [overrides, setOverrides] = useState({})
  const [loading, setLoading] = useState(true)
  const [draft, setDraft] = useState({}) // tradeKey -> { unit, rate_low, rate_high, dirty, saving }
  const [adding, setAdding] = useState(false)
  const [newLabel, setNewLabel] = useState('')

  async function reload() {
    if (!user?.id) return
    setLoading(true)
    const { merged, overrides } = await loadUserRateCard(user.id)
    setMerged(merged)
    setOverrides(overrides)
    setLoading(false)
  }

  useEffect(() => { reload() }, [user?.id])

  const rows = useMemo(() => {
    const seedKeys = Object.keys(RATE_CARD)
    const customKeys = Object.keys(merged).filter((k) => !seedKeys.includes(k))
    return [
      ...seedKeys.map((k) => ({ key: k, custom: false, current: merged[k] || RATE_CARD[k] })),
      ...customKeys.map((k) => ({ key: k, custom: true, current: merged[k] }))
    ]
  }, [merged])

  function getDraft(row) {
    return draft[row.key] || {
      unit: row.current?.unit || 'lump',
      rate_low: String(row.current?.low ?? 0),
      rate_high: String(row.current?.high ?? 0),
      dirty: false
    }
  }

  function setField(key, field, value) {
    setDraft((d) => ({
      ...d,
      [key]: {
        ...getDraft({ key, current: merged[key] || RATE_CARD[key] }),
        [field]: value,
        dirty: true
      }
    }))
  }

  async function save(row) {
    const d = getDraft(row)
    const low = Number(d.rate_low) || 0
    const high = Number(d.rate_high) || 0
    if (high < low) {
      hapticError()
      toastError('High must be ≥ low', `${row.current?.label || row.key} rate range is invalid.`)
      return
    }
    setDraft((dd) => ({ ...dd, [row.key]: { ...d, saving: true } }))
    try {
      await upsertRate({
        userId: user.id,
        tradeKey: row.key,
        patch: {
          label: row.current?.label || TRADE_LABELS[row.key] || row.key,
          unit: d.unit,
          rate_low: low,
          rate_high: high
        }
      })
      hapticSuccess()
      toastSuccess('Rate saved', `${row.current?.label || row.key}: $${low}–$${high}/${d.unit}`)
      await reload()
      setDraft((dd) => {
        const next = { ...dd }
        delete next[row.key]
        return next
      })
    } catch (err) {
      hapticError()
      toastError("Couldn't save rate", err?.message || 'Unknown error')
      setDraft((dd) => ({ ...dd, [row.key]: { ...d, saving: false } }))
    }
  }

  async function revert(row) {
    if (!overrides[row.key]) {
      // No override to delete — just clear local draft.
      setDraft((dd) => {
        const next = { ...dd }
        delete next[row.key]
        return next
      })
      return
    }
    try {
      await resetRate({ userId: user.id, tradeKey: row.key })
      hapticSuccess()
      toastSuccess('Reset to default', row.current?.label || row.key)
      await reload()
      setDraft((dd) => {
        const next = { ...dd }
        delete next[row.key]
        return next
      })
    } catch (err) {
      hapticError()
      toastError("Couldn't reset", err?.message || 'Unknown error')
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
        userId: user.id,
        tradeKey: key,
        patch: { label, unit: 'lump', rate_low: 0, rate_high: 0 }
      })
      hapticSuccess()
      toastSuccess('Trade added', label)
      setNewLabel('')
      setAdding(false)
      await reload()
    } catch (err) {
      hapticError()
      toastError("Couldn't add trade", err?.message || 'Unknown error')
    }
  }

  if (loading) {
    return (
      <div style={{
        padding: 14, borderRadius: 12,
        background: 'var(--surface-2)', border: '1px solid var(--rule)',
        color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', fontSize: 12
      }}>
        Loading rate card…
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <p style={{
        margin: '-2px 0 6px',
        fontFamily: 'var(--font-body)', fontSize: 12,
        color: 'var(--ink-faint, var(--ink-muted))',
        lineHeight: 1.45
      }}>
        These rates feed the AI bid engine and the manual fallback when AI is offline. Edit any row to override the default; reset returns it to the shipping value.
      </p>

      <div style={{
        borderRadius: 14,
        background: 'var(--surface-1, var(--surface-2))',
        border: '1px solid var(--rule)',
        overflow: 'hidden'
      }}>
        {rows.map((row, i) => {
          const d = getDraft(row)
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
            <div
              key={row.key}
              style={{
                padding: '12px 14px',
                borderTop: i === 0 ? 'none' : '1px solid var(--rule)',
                display: 'grid',
                gridTemplateColumns: '1fr',
                gap: 8
              }}
            >
              {/* Row 1 — label + badges */}
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{
                  flex: 1, minWidth: 0,
                  fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: 700,
                  color: 'var(--ink-strong)',
                  whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis'
                }}>
                  {row.current?.label || TRADE_LABELS[row.key] || row.key}
                </span>
                {isCustom && (
                  <span style={{
                    padding: '1px 7px', borderRadius: 999,
                    background: 'var(--surface-2)', border: '1px solid var(--rule)',
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
                    color: 'var(--ink-muted)'
                  }}>
                    Custom
                  </span>
                )}
                {isOverride && !isCustom && (
                  <span style={{
                    padding: '1px 7px', borderRadius: 999,
                    background: 'rgba(201,150,58,0.14)',
                    border: '1px solid rgba(201,150,58,0.35)',
                    fontSize: 9, fontWeight: 700, letterSpacing: '0.12em', textTransform: 'uppercase',
                    color: 'var(--field-gold-bright, var(--field-gold, #d4af37))'
                  }}>
                    Customized
                  </span>
                )}
              </div>

              {/* Row 2 — unit / low / high inputs */}
              <div style={{
                display: 'grid',
                gridTemplateColumns: '90px 1fr 1fr auto',
                gap: 6,
                alignItems: 'center'
              }}>
                <select
                  value={d.unit}
                  onChange={(e) => setField(row.key, 'unit', e.target.value)}
                  disabled={d.saving}
                  style={cellSelect}
                >
                  {RATE_UNITS.includes(d.unit) ? null : <option value={d.unit}>{d.unit}</option>}
                  {RATE_UNITS.map((u) => <option key={u} value={u}>{u}</option>)}
                </select>
                <input
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
                <input
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
                <div style={{ display: 'flex', gap: 4 }}>
                  {d.dirty && (
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.95 }}
                      onClick={() => { hapticTap(); save(row) }}
                      disabled={d.saving}
                      aria-label="Save rate"
                      style={iconBtn('primary', d.saving)}
                    >
                      {d.saving ? <Check size={14} /> : <SaveIcon size={14} />}
                    </motion.button>
                  )}
                  {(isOverride || isCustom) && (
                    <motion.button
                      type="button"
                      whileTap={{ scale: 0.95 }}
                      onClick={() => { hapticTap(); revert(row) }}
                      disabled={d.saving}
                      aria-label={isCustom ? 'Delete trade' : 'Reset to default'}
                      style={iconBtn('muted', d.saving)}
                    >
                      {isCustom ? <Trash2 size={14} /> : <RotateCcw size={14} />}
                    </motion.button>
                  )}
                </div>
              </div>

              {/* Seed hint when overridden */}
              {showSeed && (
                <div style={{
                  fontFamily: 'var(--font-body)', fontSize: 10,
                  color: 'var(--ink-faint, var(--ink-muted))',
                  fontVariantNumeric: 'tabular-nums'
                }}>
                  Default · {seedUnit} · ${seedLow}–${seedHigh}
                </div>
              )}
            </div>
          )
        })}
      </div>

      {/* Add custom trade */}
      {adding ? (
        <div style={{
          padding: '10px 12px',
          borderRadius: 12,
          background: 'var(--surface-2)',
          border: '1px solid var(--rule)',
          display: 'grid',
          gridTemplateColumns: '1fr auto auto',
          gap: 6,
          alignItems: 'center'
        }}>
          <input
            type="text"
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="e.g. Cabinet install"
            autoFocus
            style={cellInput}
          />
          <button
            type="button"
            onClick={() => { hapticTap(); addCustom() }}
            disabled={!newLabel.trim()}
            style={{
              padding: '8px 12px', borderRadius: 10, border: 'none',
              background: 'var(--field-gold, #c9963a)',
              color: 'var(--on-gold, #1a1004)',
              fontFamily: 'var(--font-body)', fontSize: 11, fontWeight: 700,
              letterSpacing: '0.08em', textTransform: 'uppercase',
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
            aria-label="Cancel"
          >
            ✕
          </button>
        </div>
      ) : (
        <button
          type="button"
          onClick={() => { hapticTap(); setAdding(true) }}
          style={{
            padding: '10px 12px',
            borderRadius: 12,
            border: '1px dashed var(--rule)',
            background: 'transparent',
            color: 'var(--ink-muted)',
            fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 600,
            cursor: 'pointer',
            display: 'inline-flex', alignItems: 'center', gap: 6,
            alignSelf: 'flex-start'
          }}
        >
          <Plus size={13} /> Add trade
        </button>
      )}
    </div>
  )
}

const cellInput = {
  padding: '8px 10px',
  borderRadius: 10,
  background: 'var(--surface-2)',
  border: '1px solid var(--rule)',
  color: 'var(--ink-strong)',
  fontFamily: 'var(--font-body)',
  fontSize: 13,
  outline: 'none',
  width: '100%',
  boxSizing: 'border-box',
  fontVariantNumeric: 'tabular-nums'
}

const cellSelect = {
  ...cellInput,
  padding: '7px 8px',
  cursor: 'pointer'
}

function iconBtn(tone, busy) {
  const palette = tone === 'primary'
    ? { bg: 'var(--field-gold, #c9963a)', fg: 'var(--on-gold, #1a1004)', border: 'rgba(201,150,58,0.4)' }
    : { bg: 'var(--surface-2)', fg: 'var(--ink-muted)', border: 'var(--rule)' }
  return {
    width: 32, height: 32, borderRadius: 10,
    background: palette.bg,
    border: `1px solid ${palette.border}`,
    color: palette.fg,
    display: 'grid', placeItems: 'center',
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.6 : 1
  }
}
