import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { composeClientTimeline } from './clientTimeline.ts'

// paid_on is date only; the day shift only shows west of UTC, so pin a
// US timezone for the whole file.
const originalTz = process.env.TZ
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => { process.env.TZ = originalTz })

const jobs = [
  { id: 'a', job_title: 'Sidewalk', stage: 'job', created_at: '2026-06-01T08:00:00Z' },
  { id: 'b', name: 'Driveway', stage: 'closed', created_at: '2026-05-01T08:00:00Z' }
]
const payments = [
  { contact_id: 'a', amount: 500, paid_on: '2026-06-10', method: 'check' },
  { contact_id: 'b', amount: 1000, created_at: '2026-05-20T12:00:00Z' } // paid_on null → created_at
]
const notes = [
  { id: 'n1', contact_id: 'a', text: 'Customer wants extra coat', category: 'note', created_at: '2026-06-05T09:00:00Z', fh_contacts: { name: 'Sidewalk' } },
  { id: 'n2', contact_id: 'a', text: 'Invoice sent', category: 'activity', created_at: '2026-06-06T09:00:00Z' } // dropped
]
const files = [
  { id: 'f1', job_id: 'a', filename: 'before.jpg', kind: 'photo', uploaded_at: '2026-06-02T10:00:00Z', fh_contacts: { name: 'Sidewalk' } }
]

describe('composeClientTimeline', () => {
  it('merges payments, jobs, notes, files into one feed, newest first', () => {
    const feed = composeClientTimeline(jobs, payments, notes, files)
    // Sorted desc by time. Newest is the 2026-06-10 payment, at local
    // midnight of that day.
    expect(feed[0].kind).toBe('payment')
    expect(feed[0].at).toBe(new Date(2026, 5, 10).getTime())
    // Monotonic non-increasing timestamps.
    for (let i = 1; i < feed.length; i++) {
      expect(feed[i - 1].at).toBeGreaterThanOrEqual(feed[i].at)
    }
  })

  it('drops activity-log notes but keeps real notes', () => {
    const kinds = composeClientTimeline(jobs, [], notes, [])
    expect(kinds.find((e) => e.detail === 'Customer wants extra coat')).toBeTruthy()
    expect(kinds.find((e) => e.detail === 'Invoice sent')).toBeFalsy()
  })

  it('falls back paid_on → created_at for payment timing', () => {
    const feed = composeClientTimeline([], payments, [], [])
    const bPay = feed.find((e) => e.contactId === 'b')!
    expect(bPay.at).toBe(new Date('2026-05-20T12:00:00Z').getTime())
  })

  it('labels each event with its property and carries the contact id', () => {
    const feed = composeClientTimeline(jobs, payments, notes, files)
    const jobEvent = feed.find((e) => e.kind === 'job' && e.contactId === 'a')!
    expect(jobEvent.property).toBe('Sidewalk')
    const photo = feed.find((e) => e.kind === 'file')!
    expect(photo.title).toBe('Photo added')
    expect(photo.contactId).toBe('a')
  })

  it('keeps a date only paid_on on its own local calendar day', () => {
    const [pay] = composeClientTimeline([], [{ contact_id: 'a', amount: 500, paid_on: '2026-06-10' }], [], [])
    const shown = new Date(pay.atIso)
    // A UTC parse put this at 7 PM on June 9 in Chicago.
    expect([shown.getFullYear(), shown.getMonth(), shown.getDate()]).toEqual([2026, 5, 10])
  })

  it('uses the logged time when the payment was recorded that same day', () => {
    // 3:20 PM Chicago on Oct 9, logged the day it was paid.
    const [pay] = composeClientTimeline([], [{ contact_id: 'a', amount: 500, paid_on: '2026-10-09', created_at: '2026-10-09T20:20:00Z' }], [], [])
    expect(pay.atIso).toBe('2026-10-09T20:20:00.000Z')
  })

  it('respects the limit and handles empties', () => {
    expect(composeClientTimeline([], [], [], [])).toEqual([])
    expect(composeClientTimeline(jobs, payments, notes, files, 2).length).toBe(2)
  })
})
