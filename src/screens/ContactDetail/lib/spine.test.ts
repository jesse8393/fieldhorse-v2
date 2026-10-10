import { describe, it, expect } from 'vitest'
import { buildSpine, jobMoney } from './spine.ts'
import { composeActivityEvents } from '../sections/composeActivityEvents.ts'
import type { ActivityEvent } from '../sections/composeActivityEvents.ts'

// Saturday, October 10, 2026 at 9:30 in the local timezone.
const NOW = new Date(2026, 9, 10, 9, 30)
const at = (month: number, day: number, hour: number, minute: number) =>
  new Date(2026, month, day, hour, minute)

const DASHES = /[-–—]/

function note(id: string, when: Date, text: string): ActivityEvent {
  return { id: `note:${id}`, when, kind: 'note', title: 'Note added', sub: text, tone: 'neutral' }
}

function photo(id: string, when: Date, url: string | null = `https://img.test/${id}.jpg`, caption: string | null = null) {
  return { id, uploaded_at: when.toISOString(), caption, url }
}

describe('buildSpine', () => {
  it('interleaves events and photos newest first', () => {
    const items = buildSpine({
      events: [
        note('n1', at(9, 10, 6, 40), 'Truck confirmed for 7:10.'),
        note('n2', at(9, 8, 16, 5), 'Slab prep looks good.')
      ],
      photos: [photo('p1', at(9, 10, 7, 12)), photo('p2', at(9, 9, 12, 0))],
      inspections: [],
      now: NOW
    })
    expect(items.map((i) => i.at.getTime())).toEqual([
      at(9, 10, 7, 12).getTime(),
      at(9, 10, 6, 40).getTime(),
      at(9, 9, 12, 0).getTime(),
      at(9, 8, 16, 5).getTime()
    ])
    expect(items[0].title).toBe('1 photo')
    expect(items[1].title).toBe('Truck confirmed for 7:10.')
  })

  it('merges photos taken within 15 minutes into one item with up to 3 thumbnails', () => {
    const items = buildSpine({
      events: [],
      photos: [
        photo('a', at(9, 10, 7, 12)),
        photo('b', at(9, 10, 7, 8)),
        photo('c', at(9, 10, 7, 4)),
        photo('d', at(9, 10, 6, 4))
      ],
      inspections: [],
      now: NOW
    })
    expect(items).toHaveLength(2)
    expect(items[0].title).toBe('3 photos')
    expect(items[0].photos).toHaveLength(3)
    expect(items[0].at.getTime()).toBe(at(9, 10, 7, 12).getTime())
    expect(items[1].title).toBe('1 photo')
    expect(items[1].photos).toHaveLength(1)
  })

  it('never shows more than 3 thumbnails, even for a bigger batch', () => {
    const items = buildSpine({
      events: [],
      photos: [0, 2, 4, 6, 8].map((m) => photo(`p${m}`, at(9, 10, 7, m))),
      inspections: [],
      now: NOW
    })
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('5 photos')
    expect(items[0].photos).toHaveLength(3)
  })

  it('drops photos without a url from the thumbnails so no broken image renders', () => {
    const items = buildSpine({
      events: [],
      photos: [
        photo('a', at(9, 10, 7, 12), null),
        photo('b', at(9, 10, 7, 8)),
        photo('c', at(9, 10, 7, 4), null)
      ],
      inspections: [],
      now: NOW
    })
    expect(items).toHaveLength(1)
    expect(items[0].title).toBe('3 photos')
    expect(items[0].photos).toEqual([{ src: 'https://img.test/b.jpg', alt: 'Job photo' }])
    for (const p of items[0].photos) expect(p.src).toBeTruthy()

    const allFailed = buildSpine({ events: [], photos: [photo('x', at(9, 10, 7, 0), null)], inspections: [], now: NOW })
    expect(allFailed[0].photos).toEqual([])
  })

  it('uses the caption as the thumbnail alt text and the subline', () => {
    const items = buildSpine({
      events: [],
      photos: [photo('a', at(9, 10, 7, 12), 'https://img.test/a.jpg', 'Forms and rebar in')],
      inspections: [],
      now: NOW
    })
    expect(items[0].subline).toBe('Forms and rebar in')
    expect(items[0].photos[0].alt).toBe('Forms and rebar in')
  })

  it('gives a payment tone success and a note tone neutral', () => {
    const events = composeActivityEvents({
      payments: [{ id: 'p1', amount: 6187.5, method: 'card', kind: 'deposit', paid_on: '2026-09-30', created_at: at(8, 30, 15, 0).toISOString() }],
      notes: [{ id: 'n1', text: 'Inspector confirmed Friday.', created_at: at(9, 8, 10, 0).toISOString() }]
    })
    const items = buildSpine({ events, photos: [], inspections: [], now: NOW })
    const payment = items.find((i) => i.id === 'payment:p1')
    const noteItem = items.find((i) => i.id === 'note:n1')
    expect(payment?.tone).toBe('success')
    expect(payment?.title).toBe('Payment received')
    expect(payment?.subline).toContain('$6,187.50')
    expect(noteItem?.tone).toBe('neutral')
    expect(noteItem?.title).toBe('Inspector confirmed Friday.')
  })

  it('marks a passed inspection success and a failed one neutral, each with its word', () => {
    const items = buildSpine({
      events: [],
      photos: [],
      inspections: [
        { id: 'i1', result: 'pass', inspected_at: at(9, 7, 16, 5).toISOString(), type: 'Concrete' },
        { id: 'i2', result: 'fail', inspected_at: at(9, 6, 9, 0).toISOString(), type: 'Plumbing' }
      ],
      now: NOW
    })
    expect(items[0]).toMatchObject({ title: 'Inspection passed', subline: 'Concrete', tone: 'success' })
    expect(items[1]).toMatchObject({ title: 'Inspection failed', subline: 'Plumbing', tone: 'neutral' })
  })

  it('writes the time as 7:12 and the day as today, a weekday inside a week, or the date beyond', () => {
    const items = buildSpine({
      events: [
        note('a', at(9, 10, 7, 12), 'This morning'),
        note('b', at(9, 7, 16, 5), 'Wednesday'),
        note('c', at(9, 9, 12, 0), 'Yesterday'),
        note('d', at(8, 30, 15, 0), 'Beyond a week')
      ],
      photos: [],
      inspections: [],
      now: NOW
    })
    const byTitle = Object.fromEntries(items.map((i) => [i.title, i]))
    expect(byTitle['This morning']).toMatchObject({ time: '7:12', day: 'today' })
    expect(byTitle['Wednesday']).toMatchObject({ time: '4:05', day: 'Wed' })
    expect(byTitle['Yesterday']).toMatchObject({ time: '12:00', day: 'Fri' })
    expect(byTitle['Beyond a week'].day).toBe('Sep 30')
  })

  it('never writes a dash in titles it makes itself, and leaves typed note text untouched', () => {
    const events = composeActivityEvents({
      contact: { id: 'c1', created_at: at(8, 1, 9, 0).toISOString(), stage: 'job', quote_sent_at: at(8, 10, 9, 0).toISOString(), quote_expires_at: at(9, 10, 9, 0).toISOString() },
      payments: [{ id: 'p1', amount: 1500, method: 'check', reference: '1042', kind: 'deposit', paid_on: '2026-10-01', created_at: at(9, 1, 9, 0).toISOString() }],
      changeOrders: [{ id: 'co1', sequence_number: 2, title: 'Extra footing', amount: -250, status: 'approved', created_at: at(9, 2, 9, 0).toISOString(), approved_at: at(9, 3, 9, 0).toISOString() }],
      stageTransitions: [{ id: 't1', from_stage: 'quote', to_stage: 'job', transitioned_at: at(8, 20, 9, 0).toISOString() }],
      notes: [{ id: 'n1', text: 'Pour 7-8am — call ahead', created_at: at(9, 9, 9, 0).toISOString() }]
    })
    const items = buildSpine({
      events,
      photos: [photo('a', at(9, 10, 7, 0)), photo('b', at(9, 10, 7, 5)), photo('c', at(9, 10, 7, 9))],
      inspections: [{ id: 'i1', result: 'pass', inspected_at: at(9, 8, 9, 0).toISOString(), type: 'Concrete' }],
      now: NOW
    })
    const titles = items.map((i) => i.title)
    expect(titles).toContain('3 photos')
    expect(titles).toContain('Payment received')
    expect(titles).toContain('Inspection passed')
    expect(titles).toContain('Pour 7-8am — call ahead')
    for (const item of items) {
      if (item.id === 'note:n1') continue
      expect(item.title, item.title).not.toMatch(DASHES)
      if (item.subline) expect(item.subline, item.subline).not.toMatch(DASHES)
    }
  })

  it('drops items with an unreadable date', () => {
    const items = buildSpine({
      events: [],
      photos: [{ id: 'bad', uploaded_at: 'not a date', caption: null, url: 'https://img.test/bad.jpg' }],
      inspections: [{ id: 'i1', result: 'pass', inspected_at: null, type: 'Concrete' }],
      now: NOW
    })
    expect(items).toEqual([])
  })
})

describe('jobMoney', () => {
  const base = { contractTotal: 12375, paid: 6187.5, balance: 6187.5 }

  it('formats contract, paid and balance with cents', () => {
    const m = jobMoney({ ...base, marginPct: 31.2 })
    expect(m.contract).toBe('$12,375.00')
    expect(m.paid).toBe('$6,187.50')
    expect(m.balance).toBe('$6,187.50')
  })

  it('gives a success chip for a good margin', () => {
    expect(jobMoney({ ...base, marginPct: 31.2 }).marginChip).toEqual({ label: '31.2% margin', tone: 'success' })
  })

  it('gives a neutral chip between 15 and 30 percent', () => {
    expect(jobMoney({ ...base, marginPct: 22 }).marginChip).toEqual({ label: '22.0% margin', tone: 'neutral' })
  })

  it('gives a danger chip for a thin margin', () => {
    expect(jobMoney({ ...base, marginPct: 12 }).marginChip).toEqual({ label: '12.0% margin', tone: 'danger' })
  })

  it('gives no chip without a margin', () => {
    expect(jobMoney({ ...base, marginPct: null }).marginChip).toBeNull()
  })

  it('says loss instead of writing a minus sign', () => {
    const chip = jobMoney({ ...base, marginPct: -4.25 }).marginChip
    expect(chip).toEqual({ label: '4.3% loss', tone: 'danger' })
    expect(chip?.label).not.toMatch(DASHES)
  })
})
