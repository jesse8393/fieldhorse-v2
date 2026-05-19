// src/lib/rateCard.js
//
// Default seed rate card for the AI Bid engine + tenant overrides loader.
// The constants below are the shipping defaults. Per-tenant edits live in
// public.fh_rate_cards (migration 026), keyed by user_id + trade_key, and
// override the seed values when present.
//
// Consumers should call loadUserRateCard(userId) to get the merged map.
// Falling back to RATE_CARD as a constant is fine for unauthenticated
// or pre-load surfaces, but anything customer-facing should use the
// merged version so the contractor's edits actually flow through.

import { supabase } from './supabase.js'

export const RATE_CARD = {
  concrete:      { unit: 'sqft', low: 8,    high: 12 },
  framing:       { unit: 'lf',   low: 4,    high: 7 },
  drywall:       { unit: 'sqft', low: 2.5,  high: 4 },
  demo:          { unit: 'sqft', low: 3,    high: 6 },
  roofing:       { unit: 'sqft', low: 5,    high: 9 },
  electrical:    { unit: 'point',low: 150,  high: 250 },
  plumbingRough: { unit: 'lump', low: 800,  high: 1500 },
  insulation:    { unit: 'sqft', low: 1.5,  high: 3 },
  lvpFlooring:   { unit: 'sqft', low: 4,    high: 7 },
  paint:         { unit: 'sqft', low: 1.5,  high: 3 },
  permits:       { unit: 'lump', low: 200,  high: 800 },
  outdoorLiving: { unit: 'sqft', low: 25,   high: 65 }
}

export const TRADE_LABELS = {
  concrete:      'Concrete',
  framing:       'Framing',
  drywall:       'Drywall',
  demo:          'Demo',
  roofing:       'Roofing',
  electrical:    'Electrical',
  plumbingRough: 'Plumbing rough',
  insulation:    'Insulation',
  lvpFlooring:   'LVP flooring',
  paint:         'Paint',
  permits:       'Permits',
  outdoorLiving: 'Outdoor living'
}

export const TAGLINE = 'Built for the jobsite.'

// Allowed units for the editor's unit picker. Trade-agnostic so the
// contractor can use whichever unit makes sense for their work.
export const RATE_UNITS = ['sqft', 'lf', 'point', 'lump', 'hr', 'cy', 'ea', 'day']

// Fetch the user's saved overrides + any custom trades. Returns
// { merged, overrides } where merged is the same shape as RATE_CARD
// (defaults + overrides + custom keys) and overrides is the raw row
// list keyed by trade_key (so the editor can show "you customized
// this" badges).
export async function loadUserRateCard(userId) {
  if (!userId) return { merged: { ...RATE_CARD }, overrides: {} }

  const { data, error } = await supabase
    .from('fh_rate_cards')
    .select('id, trade_key, label, unit, rate_low, rate_high, notes, updated_at')
    .eq('user_id', userId)

  if (error) {
    console.error('[rateCard] load failed:', error)
    return { merged: { ...RATE_CARD }, overrides: {} }
  }

  const overrides = {}
  for (const row of data || []) overrides[row.trade_key] = row

  const merged = {}
  for (const [key, seed] of Object.entries(RATE_CARD)) {
    const ov = overrides[key]
    merged[key] = ov
      ? { unit: ov.unit || seed.unit, low: Number(ov.rate_low), high: Number(ov.rate_high), label: ov.label || TRADE_LABELS[key] || key }
      : { ...seed, label: TRADE_LABELS[key] || key }
  }
  for (const [key, ov] of Object.entries(overrides)) {
    if (merged[key]) continue
    merged[key] = { unit: ov.unit || 'lump', low: Number(ov.rate_low), high: Number(ov.rate_high), label: ov.label || key, custom: true }
  }
  return { merged, overrides }
}

// Insert or update a single trade's rate. Pass userId + trade_key + a
// patch of any subset of (label, unit, rate_low, rate_high, notes).
export async function upsertRate({ userId, tradeKey, patch }) {
  if (!userId || !tradeKey) throw new Error('upsertRate: userId + tradeKey required')
  const row = {
    user_id: userId,
    trade_key: tradeKey,
    label: patch.label ?? null,
    unit: patch.unit || 'lump',
    rate_low: Number(patch.rate_low ?? 0),
    rate_high: Number(patch.rate_high ?? 0),
    notes: patch.notes ?? null
  }
  const { error } = await supabase
    .from('fh_rate_cards')
    .upsert(row, { onConflict: 'user_id,trade_key' })
  if (error) throw error
}

// Delete a tenant override — the trade reverts to the seed default.
// For custom (non-seed) trades, deleting removes them from the editor
// entirely.
export async function resetRate({ userId, tradeKey }) {
  if (!userId || !tradeKey) throw new Error('resetRate: userId + tradeKey required')
  const { error } = await supabase
    .from('fh_rate_cards')
    .delete()
    .eq('user_id', userId)
    .eq('trade_key', tradeKey)
  if (error) throw error
}
