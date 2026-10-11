import { describe, it, expect, vi } from 'vitest'

// captureIntelligence imports the Claude client, which imports the
// Supabase client and needs browser env at import time. These tests only
// use the pure validation layer, so stub the AI module out.
vi.mock('./anthropic.ts', () => ({
  claudeMessage: vi.fn(),
  extractJson: vi.fn()
}))

import { openCapture, seedJob, withAttachedJob } from './captureAttach.ts'
import { normalizeIntent, type CaptureIntent, type RosterEntry } from './captureIntelligence.ts'

// The sheet's roster holds active work; a lead opened from its own page
// may not be in it (the roster stops at the 100 most recent rows, and
// closed or lost work is never in it).
const roster: RosterEntry[] = [
  { id: 'job-1', name: 'Henderson', job_title: 'Roof replacement', stage: 'job' },
  { id: 'job-2', name: 'Plumbing Bellevue', job_title: 'Slab and trench', stage: 'job' },
  { id: 'quote-1', name: 'MMC Properties', job_title: 'Parking lot repour', stage: 'quote' }
]

const lead: RosterEntry = { id: 'lead-9', name: 'Justin Bryan', job_title: 'Station drainage', stage: 'lead' }

function intent(over: Partial<CaptureIntent> = {}): CaptureIntent {
  return { kind: 'note', summary: 'Save a note', job_id: null, confidence: 0.8, text: 'Pour moved to Friday', ...over }
}

describe('withAttachedJob', () => {
  it('withAttachedJob with a lead not in the roster returns it first, length plus one', () => {
    const out = withAttachedJob(roster, lead)
    expect(out).toHaveLength(roster.length + 1)
    expect(out[0]).toBe(lead)
    expect(out.slice(1)).toEqual(roster)
  })

  it('withAttachedJob with a job already in the roster moves it first without a duplicate', () => {
    const out = withAttachedJob(roster, roster[1])
    expect(out).toHaveLength(roster.length)
    expect(out.map((r) => r.id)).toEqual(['job-2', 'job-1', 'quote-1'])
    expect(out.filter((r) => r.id === 'job-2')).toHaveLength(1)
  })

  it('matches by id, so a fresh copy of a roster row is not added twice', () => {
    const copy = { ...roster[2] }
    const out = withAttachedJob(roster, copy)
    expect(out.map((r) => r.id)).toEqual(['quote-1', 'job-1', 'job-2'])
  })

  it('returns the roster unchanged, as a new array, when nothing is attached', () => {
    const out = withAttachedJob(roster, null)
    expect(out).toEqual(roster)
    expect(out).not.toBe(roster)
  })

  it('normalizeIntent on a model reply naming the attached lead\'s id keeps the id when the roster comes from withAttachedJob', () => {
    const reply = { kind: 'note', summary: 'Note on Bryan drainage', job_id: 'lead-9', confidence: 0.9, text: 'Bring the laser level' }
    // Without the attached lead, the id is outside the roster and dropped.
    expect(normalizeIntent(reply, roster)?.job_id).toBeNull()
    expect(normalizeIntent(reply, withAttachedJob(roster, lead))?.job_id).toBe('lead-9')
  })

  it('still drops an id the model made up', () => {
    const reply = { kind: 'note', summary: 'Note', job_id: 'job-404', confidence: 0.9, text: 'Bring the laser level' }
    expect(normalizeIntent(reply, withAttachedJob(roster, lead))?.job_id).toBeNull()
  })
})

describe('seedJob', () => {
  it('seedJob fills an empty job_id and leaves a model chosen one alone', () => {
    expect(seedJob(intent(), 'lead-9').job_id).toBe('lead-9')
    expect(seedJob(intent({ job_id: 'job-1' }), 'lead-9').job_id).toBe('job-1')
  })

  it('leaves the intent alone when nothing is attached', () => {
    const it0 = intent()
    expect(seedJob(it0, null)).toBe(it0)
  })

  it('never puts a lead capture on a job, since a new lead is not existing work', () => {
    const newLead = intent({ kind: 'lead', name: 'Mike Salas', text: null })
    expect(seedJob(newLead, 'job-1').job_id).toBeNull()
  })

  it('returns a new object and keeps every other field', () => {
    const it0 = intent({ kind: 'payment', amount: 2500, method: 'check', payment_kind: 'deposit', text: null })
    const out = seedJob(it0, 'job-2')
    expect(out).not.toBe(it0)
    expect(out).toEqual({ ...it0, job_id: 'job-2' })
    expect(it0.job_id).toBeNull()
  })
})

describe('openCapture', () => {
  it('dispatches fh:open-capture with the job id', () => {
    // Unit tests run in node; a bare EventTarget stands in for window.
    const target = new EventTarget()
    vi.stubGlobal('window', target)
    const seen: unknown[] = []
    target.addEventListener('fh:open-capture', (e) => seen.push((e as CustomEvent).detail))
    try {
      openCapture({ jobId: 'job-1' })
      openCapture()
    } finally {
      vi.unstubAllGlobals()
    }
    expect(seen).toEqual([{ jobId: 'job-1' }, {}])
  })
})
