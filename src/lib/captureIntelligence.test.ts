import { describe, it, expect, vi } from 'vitest'

// captureIntelligence imports the Claude client (which imports the
// Supabase client, which needs browser env at import time). Tests only
// exercise the pure validation layer, so stub the AI module out.
vi.mock('./anthropic.ts', () => ({
  claudeMessage: vi.fn(),
  extractJson: vi.fn()
}))

import { normalizeIntent, type RosterEntry } from './captureIntelligence.ts'

const roster: RosterEntry[] = [
  { id: 'job-1', name: 'Henderson', job_title: 'Roof replacement', stage: 'job' },
  { id: 'lead-1', name: 'Salas', job_title: 'Deck rebuild', stage: 'lead' }
]

describe('normalizeIntent', () => {
  it('rejects garbage', () => {
    expect(normalizeIntent(null, roster)).toBeNull()
    expect(normalizeIntent('hi', roster)).toBeNull()
    expect(normalizeIntent({ kind: 'reboot_server' }, roster)).toBeNull()
  })

  it('passes a clean payment through and validates job_id against the roster', () => {
    const out = normalizeIntent({
      kind: 'payment', summary: 'Log $2,500 deposit on Henderson roof',
      job_id: 'job-1', confidence: 0.95,
      amount: 2500, method: 'check', payment_kind: 'deposit'
    }, roster)
    expect(out).toMatchObject({
      kind: 'payment', job_id: 'job-1', amount: 2500,
      method: 'check', payment_kind: 'deposit'
    })
  })

  it('drops a hallucinated job_id', () => {
    const out = normalizeIntent({ kind: 'note', text: 'order shingles', job_id: 'not-a-real-id' }, roster)
    expect(out?.job_id).toBeNull()
  })

  it('clamps enum fields to the DB whitelists', () => {
    const out = normalizeIntent({
      kind: 'payment', amount: 100, method: 'venmo??', payment_kind: 'tip'
    }, roster)
    expect(out?.method).toBe('check')
    expect(out?.payment_kind).toBe('other')

    const exp = normalizeIntent({
      kind: 'expense', amount: 80, description: 'permit', category: 'permits'
    }, roster)
    // case-insensitive match onto the Capitalized DB value
    expect(exp?.category).toBe('Permits')
  })

  it('coerces formatted money strings and rejects nonsense amounts', () => {
    expect(normalizeIntent({ kind: 'expense', amount: '$1,250.50', description: 'lumber' }, roster)?.amount).toBe(1250.5)
    expect(normalizeIntent({ kind: 'payment', amount: -50 }, roster)?.amount).toBeNull()
    expect(normalizeIntent({ kind: 'payment', amount: 'a lot' }, roster)?.amount).toBeNull()
  })

  it('requires text for notes/todos and a start time for schedule', () => {
    expect(normalizeIntent({ kind: 'note' }, roster)).toBeNull()
    expect(normalizeIntent({ kind: 'schedule', title: 'Inspection' }, roster)).toBeNull()
  })

  it('defaults schedule events to one hour and refuses backwards ranges', () => {
    const out = normalizeIntent({
      kind: 'schedule', title: 'Walkthrough',
      start_at: '2026-06-15T09:00', end_at: '2026-06-15T08:00'
    }, roster)
    expect(out?.start_at).toBeTruthy()
    expect(Date.parse(out!.end_at!) - Date.parse(out!.start_at!)).toBe(60 * 60 * 1000)
  })

  it('validates dates and silently drops malformed ones', () => {
    const out = normalizeIntent({ kind: 'todo', text: 'call inspector', due_at: 'next friday' }, roster)
    expect(out?.due_at).toBeNull()
    const ok = normalizeIntent({ kind: 'todo', text: 'call inspector', due_at: '2026-06-19' }, roster)
    expect(ok?.due_at).toBe('2026-06-19')
  })

  it('requires some identity for a lead and never attaches it to an existing job', () => {
    expect(normalizeIntent({ kind: 'lead' }, roster)).toBeNull()
    const out = normalizeIntent({
      kind: 'lead', name: 'Mike Salas', phone: '615-555-0114',
      title: 'Deck rebuild', job_id: 'job-1'
    }, roster)
    expect(out?.kind).toBe('lead')
    expect(out?.job_id).toBeNull()
  })
})
