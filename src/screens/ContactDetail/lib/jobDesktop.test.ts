import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { assignedCrewIds, documentRows, railNotes, shortDate } from './jobDesktop.ts'

// These checks read the local day. Pin Central time, where Jesse works, so
// the result is the same on every machine and in CI (UTC). Set it as the
// file loads too, because the fixtures below build local dates before any
// hook runs.
const originalTz = process.env.TZ
process.env.TZ = 'America/Chicago'
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

// Saturday, October 10, 2026 at 7:40 in the local timezone.
const NOW = new Date(2026, 9, 10, 7, 40)
const at = (month: number, day: number, hour = 9, minute = 0) => new Date(2026, month, day, hour, minute).toISOString()

const DASHES = /[-–—]/

const job = {
  stage: 'job',
  created_at: at(8, 23, 10),
  source: 'website',
  completed_at: null,
  proposal_status: 'approved'
}
const approvedOnSep28 = [{ from_stage: 'quote', to_stage: 'job', transitioned_at: at(8, 28, 10) }]

describe('shortDate', () => {
  it('writes the month and day, adding the year only when it is not this year', () => {
    expect(shortDate(at(8, 23), NOW)).toBe('Sep 23')
    expect(shortDate(new Date(2025, 11, 31, 9).toISOString(), NOW)).toBe('Dec 31, 2025')
  })

  it('reads a calendar date as that day, not as a UTC midnight', () => {
    expect(shortDate('2026-09-28', NOW)).toBe('Sep 28')
  })

  it('has nothing to say for a missing or broken date', () => {
    expect(shortDate(null, NOW)).toBeNull()
    expect(shortDate('', NOW)).toBeNull()
    expect(shortDate('not a date', NOW)).toBeNull()
  })
})

describe('railNotes', () => {
  it('notes the lead date and source, the approval date, the next events and the balance', () => {
    const notes = railNotes({
      contact: job,
      stageTransitions: approvedOnSep28,
      scheduleItems: [
        { title: 'Inspection', start_at: at(9, 16, 9), end_at: at(9, 16, 10) },
        { title: 'Pour slab', start_at: at(9, 10, 7, 30), end_at: at(9, 10, 11, 30) },
        { title: 'Old visit', start_at: at(9, 2, 9), end_at: at(9, 2, 10) }
      ],
      contractTotal: 12375,
      paid: 6187.5,
      balance: 6187.5,
      canSeeMoney: true,
      now: NOW
    })
    expect(notes.lead).toBe('Sep 23, website')
    expect(notes.quote).toBe('Approved Sep 28')
    expect(notes.job).toBe('Pour slab today, Inspection Fri')
    expect(notes.invoice).toBe('$6,187.50 balance')
    expect(notes.closed).toBeUndefined()
  })

  it('never notes money for field roles', () => {
    const notes = railNotes({
      contact: job,
      stageTransitions: approvedOnSep28,
      contractTotal: 12375,
      paid: 6187.5,
      balance: 6187.5,
      canSeeMoney: false,
      now: NOW
    })
    expect(notes.invoice).toBeUndefined()
    expect(JSON.stringify(notes)).not.toMatch(/\$/)
  })

  it('says nothing is scheduled when a running job has no event ahead', () => {
    const notes = railNotes({
      contact: job,
      scheduleItems: [{ title: 'Old visit', start_at: at(9, 2, 9), end_at: at(9, 2, 10) }],
      canSeeMoney: true,
      now: NOW
    })
    expect(notes.job).toBe('Nothing scheduled')
  })

  it('keeps an event that started this morning and is still running', () => {
    const notes = railNotes({
      contact: job,
      scheduleItems: [{ title: 'Pour slab', start_at: at(9, 10, 6, 30), end_at: at(9, 10, 11, 30) }],
      canSeeMoney: true,
      now: NOW
    })
    expect(notes.job).toBe('Pour slab today')
  })

  it('shows the finish date and a paid in full invoice for a finished job', () => {
    const notes = railNotes({
      contact: { ...job, completed_at: at(9, 3, 15) },
      contractTotal: 9600,
      paid: 9600,
      balance: 0,
      canSeeMoney: true,
      now: NOW
    })
    expect(notes.job).toBe('Done Oct 3')
    expect(notes.invoice).toBe('Paid in full')
  })

  it('notes a credit instead of a negative balance', () => {
    const notes = railNotes({ contact: job, contractTotal: 1000, paid: 1200, balance: -200, canSeeMoney: true, now: NOW })
    expect(notes.invoice).toBe('$200.00 credit')
  })

  it('notes the quote status while the deal is still a quote', () => {
    const quote = { stage: 'quote', created_at: at(9, 1), source: null, referred_by: 'DeShawn Everly' }
    expect(railNotes({ contact: { ...quote, proposal_status: 'sent', quote_sent_at: at(9, 9, 14) }, canSeeMoney: true, now: NOW }).quote).toBe('Sent Oct 9')
    expect(railNotes({ contact: { ...quote, proposal_status: 'changes_requested' }, canSeeMoney: true, now: NOW }).quote).toBe('Changes requested')
    expect(railNotes({ contact: quote, canSeeMoney: true, now: NOW }).quote).toBe('Draft')
    expect(railNotes({ contact: quote, canSeeMoney: true, now: NOW }).lead).toBe('Oct 1, DeShawn Everly')
  })

  it('has no note for a lead beyond where it came from, and none at all for no record', () => {
    const notes = railNotes({ contact: { stage: 'lead', created_at: at(9, 8) }, canSeeMoney: true, now: NOW })
    expect(notes).toEqual({ lead: 'Oct 8' })
    expect(railNotes({ contact: null, canSeeMoney: true, now: NOW })).toEqual({})
  })

  it('notes when a closed job closed', () => {
    const notes = railNotes({
      contact: { ...job, stage: 'closed', completed_at: at(9, 3, 15) },
      stageTransitions: [...approvedOnSep28, { from_stage: 'job', to_stage: 'closed', transitioned_at: at(9, 4, 9) }],
      contractTotal: 9600,
      paid: 9600,
      balance: 0,
      canSeeMoney: true,
      now: NOW
    })
    expect(notes.closed).toBe('Closed Oct 4')
  })

  it('writes no dashes of its own', () => {
    const notes = railNotes({
      contact: { ...job, referred_by: 'Referral' },
      stageTransitions: approvedOnSep28,
      scheduleItems: [{ title: 'Pour slab', start_at: at(9, 11, 7), end_at: at(9, 11, 11) }],
      contractTotal: 12375,
      paid: 6187.5,
      balance: 6187.5,
      canSeeMoney: true,
      now: NOW
    })
    for (const value of Object.values(notes)) expect(value).not.toMatch(DASHES)
  })
})

describe('documentRows', () => {
  const quoted = { stage: 'job', amount: 12375, proposal_status: 'approved' }

  it('lists the quote, invoices and files for money roles', () => {
    const rows = documentRows({
      contact: quoted,
      invoices: [
        { id: 'i2', sequence_number: 2, title: 'Final draw', status: 'sent', due_at: '2026-10-20' },
        { id: 'i1', sequence_number: 1, title: 'Deposit', status: 'paid', due_at: '2026-09-30' }
      ],
      files: [
        { id: 'f1', filename: 'Permit RC 26 0931.pdf', uploaded_at: at(9, 9) },
        { id: 'f2', filename: 'Site plan.pdf', uploaded_at: at(8, 20) }
      ],
      canSeeMoney: true,
      now: NOW
    })
    expect(rows.map((r) => [r.label, r.detail, r.tab])).toEqual([
      ['Quote', 'Approved', 'quote'],
      ['Invoice 1, Deposit', 'Paid', 'financials'],
      ['Invoice 2, Final draw', 'Sent, due Oct 20', 'financials'],
      ['Permit RC 26 0931.pdf', 'Oct 9', 'files'],
      ['Site plan.pdf', 'Sep 20', 'files']
    ])
  })

  it('leaves the quote and invoices to money roles', () => {
    const rows = documentRows({
      contact: quoted,
      invoices: [{ id: 'i1', sequence_number: 1, status: 'sent' }],
      files: [{ id: 'f1', filename: 'Permit.pdf', uploaded_at: at(9, 9) }],
      canSeeMoney: false,
      now: NOW
    })
    expect(rows.map((r) => r.tab)).toEqual(['files'])
  })

  it('shows the three newest files only, and skips voided invoices', () => {
    const files = Array.from({ length: 5 }, (_, i) => ({ id: `f${i}`, filename: `File ${i}.pdf`, uploaded_at: at(9, i + 1) }))
    const rows = documentRows({
      contact: { stage: 'job' },
      invoices: [{ id: 'v', sequence_number: 1, status: 'void' }],
      files,
      canSeeMoney: true,
      now: NOW
    })
    expect(rows.map((r) => r.label)).toEqual(['File 4.pdf', 'File 3.pdf', 'File 2.pdf'])
  })

  it('has no rows for a job with nothing attached', () => {
    expect(documentRows({ contact: { stage: 'lead' }, canSeeMoney: true, now: NOW })).toEqual([])
  })

  it('writes no dashes of its own', () => {
    const rows = documentRows({
      contact: { ...quoted, quote_sent_at: at(9, 1) },
      invoices: [{ id: 'i1', sequence_number: 1, status: 'sent', due_at: '2026-10-20' }],
      canSeeMoney: true,
      now: NOW
    })
    for (const row of rows) {
      expect(row.label).not.toMatch(DASHES)
      expect(row.detail ?? '').not.toMatch(DASHES)
    }
  })
})

describe('assignedCrewIds', () => {
  it('names each teammate once, from open tasks and visits still ahead', () => {
    const ids = assignedCrewIds({
      scheduleItems: [
        { assigned_to: 'u1', start_at: at(9, 10, 9), end_at: at(9, 10, 11) },
        { assigned_to: 'u2', start_at: at(9, 2, 9), end_at: at(9, 2, 11) },
        { assigned_to: null, start_at: at(9, 11, 9), end_at: at(9, 11, 11) }
      ],
      todos: [
        { assigned_to: 'u1', done: false },
        { assigned_to: 'u3', done: false },
        { assigned_to: 'u4', done: true },
        { assigned_to: null, done: false }
      ],
      now: NOW
    })
    expect(ids).toEqual(['u1', 'u3'])
  })

  it('is empty when no one is assigned', () => {
    expect(assignedCrewIds({ scheduleItems: [], todos: [], now: NOW })).toEqual([])
    expect(assignedCrewIds({ now: NOW })).toEqual([])
  })
})
