import { describe, expect, it, vi } from 'vitest'

// stages.ts builds the Supabase client on import; the view model only
// reads its pure helpers, so a stub client is enough here.
vi.mock('./supabase.ts', () => ({ supabase: {} }))

import { buildJobsList, JOBS_TABS, type JobsGroup, type JobsListInput } from './jobsList.ts'
import type { JobRow } from './queries.ts'

const NOW = new Date(2026, 9, 10, 9, 0, 0)
const DAY = 86400000
const iso = (ms: number) => new Date(ms).toISOString()
function ymd(ms: number) {
  const d = new Date(ms)
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
const now = NOW.getTime()

// The contacts in scripts/qa-mock.mjs, with the same stages, names,
// amounts and dates relative to now.
function row(partial: Partial<JobRow> & { id: string; stage: string }, i: number): JobRow {
  return {
    user_id: 'qa-user-1',
    client_id: 'cl-1',
    name: null,
    phone: '555-0101',
    email: 'x@y.com',
    address: '412 Burkitt Station Rd',
    amount: null,
    job_title: null,
    job_type: null,
    referred_by: null,
    proposal_status: null,
    follow_up_on: null,
    completed_at: null,
    quote_sent_at: null,
    created_at: iso(now - (30 - i) * DAY),
    updated_at: iso(now - i * DAY),
    fh_clients: { name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' },
    ...partial
  }
}

const MOCK: JobRow[] = [
  { id: 'c-lead1', stage: 'lead', name: 'Justin Bryan', job_title: 'Vintage Burkitt Station Drainage', amount: 24400, follow_up_on: ymd(now - 10 * DAY), referred_by: 'Google', job_type: 'Drainage' },
  { id: 'c-lead2', stage: 'lead', name: 'Lily Grace North', job_title: 'Retaining wall + pad', amount: 18750, referred_by: 'Referral', job_type: 'Concrete' },
  { id: 'c-quote', stage: 'quote', name: 'MMC Properties', job_title: 'Parking lot repour', amount: 46200, proposal_status: 'sent', quote_sent_at: iso(now - DAY), follow_up_on: ymd(now + 2 * DAY) },
  { id: 'c-change', stage: 'quote', name: 'Taylor Reed', job_title: 'Kitchen renovation', amount: 18400, proposal_status: 'changes_requested' },
  { id: 'c-job1', stage: 'job', name: 'Plumbing Bellevue', job_title: 'Slab + trench', amount: 33100 },
  { id: 'c-job2', stage: 'invoice', name: 'Harold Wickham', job_title: 'Driveway replacement', amount: 12800 },
  { id: 'c-done', stage: 'closed', name: 'Danielle Ortiz', job_title: 'Patio + walkway', amount: 9600, completed_at: iso(now - 20 * DAY) },
  { id: 'c-lost', stage: 'lost', name: 'Old Mill HOA', job_title: 'Culvert bid', amount: 15000 }
].map((c, i) => row(c, i))

function build(overrides: Partial<JobsListInput> = {}) {
  return buildJobsList({ jobs: MOCK, tab: 'all', showLost: false, showMoney: true, now: NOW, ...overrides })
}

function allRows(groups: JobsGroup[]) {
  return groups.flatMap((g) => g.rows)
}

const DASH = /[-–—]/

describe('JOBS_TABS', () => {
  it('lists All, Leads, Quotes, Jobs and Done, with Lost behind the filter', () => {
    expect(JOBS_TABS.map((t) => t.id)).toEqual(['all', 'leads', 'quotes', 'jobs', 'done'])
    expect(JOBS_TABS.map((t) => t.label)).toEqual(['All', 'Leads', 'Quotes', 'Jobs', 'Done'])
  })
})

describe('buildJobsList', () => {
  it('counts the mock contacts and leaves the lost one out of every count', () => {
    const { counts, groups } = build()
    expect(counts).toEqual({ all: 7, leads: 2, quotes: 2, jobs: 2, done: 1 })
    expect(groups.map((g) => g.id)).toEqual(['jobs', 'quotes', 'leads', 'done'])
    expect(allRows(groups).map((r) => r.title)).not.toContain('Old Mill HOA')

    const withLost = build({ showLost: true })
    expect(withLost.counts).toEqual(counts)
    expect(withLost.groups.map((g) => g.id)).toEqual(['jobs', 'quotes', 'leads', 'done', 'lost'])
    const lost = withLost.groups.find((g) => g.id === 'lost')!
    expect(lost.rows.map((r) => r.title)).toEqual(['Old Mill HOA'])
    expect(lost.rows[0].chip).toEqual({ label: 'Lost', tone: 'neutral' })
  })

  it('puts job and invoice stages in the Jobs group', () => {
    const jobs = build().groups.find((g) => g.id === 'jobs')!
    expect(jobs.rows.map((r) => r.id).sort()).toEqual(['c-job1', 'c-job2'])
    expect(jobs.total).toBe(33100 + 12800)
    expect(jobs.note).toMatch(/^\$45,900\.00 in progress$/)
  })

  it('returns only the Quotes group on the quotes tab', () => {
    const { groups } = build({ tab: 'quotes' })
    expect(groups.map((g) => g.id)).toEqual(['quotes'])
    expect(groups[0].rows.map((r) => r.title).sort()).toEqual(['MMC Properties', 'Taylor Reed'])
    expect(groups[0].note).toBe('$64,600.00 waiting')
  })

  it('hides every amount when the role may not see money', () => {
    const { groups } = build({ showMoney: false, showLost: true })
    expect(groups.length).toBeGreaterThan(0)
    for (const g of groups) {
      expect(g.total).toBeNull()
      expect(g.note).not.toMatch(/\$/)
      for (const r of g.rows) expect(r.money).toBeNull()
    }
    expect(groups.find((g) => g.id === 'quotes')!.note).toBe('2 waiting')
    expect(groups.find((g) => g.id === 'jobs')!.note).toBe('2 in progress')
  })

  it('shows money with cents when the role may see it', () => {
    const row = allRows(build().groups).find((r) => r.id === 'c-job1')!
    expect(row.money).toBe('$33,100.00')
  })

  it('flags a lead whose follow up was 10 days ago', () => {
    const lead = allRows(build({ tab: 'leads' }).groups).find((r) => r.id === 'c-lead1')!
    expect(lead.chip).toEqual({ label: 'Follow up 10 days overdue', tone: 'danger' })
  })

  it('writes the quote sent line and the follow up line', () => {
    const rows = allRows(build().groups)
    expect(rows.find((r) => r.id === 'c-quote')!.next).toBe('Sent yesterday')
    const future = buildJobsList({
      jobs: [row({ id: 'f1', stage: 'lead', name: 'A', follow_up_on: ymd(now + 2 * DAY) }, 0)],
      tab: 'all', showLost: false, showMoney: true, now: NOW
    })
    expect(future.groups[0].rows[0].next).toBe('Follow up Oct 12')
  })

  it('marks a draft quote and a lead under 48 hours old', () => {
    const { groups } = buildJobsList({
      jobs: [
        row({ id: 'd1', stage: 'quote', name: 'Draft quote', proposal_status: 'draft' }, 0),
        row({ id: 'n1', stage: 'lead', name: 'Hollis Tran', referred_by: 'Website', created_at: iso(now - 2 * 3600e3) }, 0)
      ],
      tab: 'all', showLost: false, showMoney: true, now: NOW
    })
    const rows = allRows(groups)
    expect(rows.find((r) => r.id === 'd1')!.chip).toEqual({ label: 'Draft', tone: 'neutral' })
    const lead = rows.find((r) => r.id === 'n1')!
    expect(lead.chip).toEqual({ label: 'New', tone: 'info' })
    expect(lead.next).toBe('Website, 2 hours ago')
    expect(groups.find((g) => g.id === 'leads')!.note).toBe('1 new this week')
  })

  it('marks a job on site today and a job that starts later', () => {
    const today = new Date(2026, 9, 10, 7, 30)
    const monday = new Date(2026, 9, 12, 8, 0)
    const { groups } = buildJobsList({
      jobs: [
        row({ id: 'j1', stage: 'job', name: 'On site' }, 0),
        row({ id: 'j2', stage: 'job', name: 'Starts later' }, 0)
      ],
      visits: [
        { contact_id: 'j1', start_at: today.toISOString() },
        { contact_id: 'j2', start_at: monday.toISOString() }
      ],
      tab: 'jobs', showLost: false, showMoney: true, now: NOW
    })
    const rows = allRows(groups)
    expect(rows.find((r) => r.id === 'j1')!.chip).toEqual({ label: 'On site 7:30 am', tone: 'success' })
    expect(rows.find((r) => r.id === 'j2')!.chip).toEqual({ label: 'Starts Mon', tone: 'info' })
  })

  it('links every row to its own page', () => {
    const rows = allRows(build({ showLost: true }).groups)
    expect(rows.find((r) => r.id === 'c-job1')!.to).toBe('/jobs/c-job1')
    expect(rows.find((r) => r.id === 'c-lead1')!.to).toBe('/leads/c-lead1')
    expect(rows.find((r) => r.id === 'c-quote')!.to).toBe('/quotes/c-quote?tab=quote')
  })

  it('passes a 45 character client name through whole', () => {
    const name = 'Cumberland Valley Stone and Masonry Supply Co'
    expect(name).toHaveLength(45)
    const { groups } = buildJobsList({
      jobs: [row({ id: 'long', stage: 'job', name }, 0)],
      tab: 'all', showLost: false, showMoney: true, now: NOW
    })
    expect(groups[0].rows[0].title).toBe(name)
  })

  it('never writes a dash itself, and leaves typed names alone', () => {
    const typed = [
      row({ id: 't1', stage: 'lead', name: 'Smith-Jones', job_title: 'Slab - trench', follow_up_on: ymd(now - 3 * DAY) }, 0),
      row({ id: 't2', stage: 'lead', name: 'Ana Ruiz', job_title: 'Fence – gate', created_at: iso(now - 3600e3), referred_by: 'Website' }, 0),
      row({ id: 't3', stage: 'quote', name: 'Bo — Lee', job_title: 'Deck', proposal_status: 'viewed', quote_sent_at: iso(now - 4 * DAY) }, 0),
      row({ id: 't4', stage: 'quote', name: 'Cy', job_title: 'Roof', proposal_status: 'draft' }, 0),
      row({ id: 't5', stage: 'job', name: 'Di', job_title: 'Pour', follow_up_on: ymd(now + 9 * DAY) }, 0),
      row({ id: 't6', stage: 'closed', name: 'Ed', job_title: 'Patio', completed_at: iso(now - 3 * DAY) }, 0),
      row({ id: 't7', stage: 'lost', name: 'Fay', job_title: 'Bid' }, 0)
    ]
    const visits = [{ contact_id: 't5', start_at: iso(now + 3 * DAY) }]
    for (const showMoney of [true, false]) {
      for (const tab of JOBS_TABS.map((t) => t.id)) {
        const { groups } = buildJobsList({ jobs: typed, visits, tab, showLost: true, showMoney, now: NOW })
        for (const g of groups) {
          expect(g.title).not.toMatch(DASH)
          expect(g.note).not.toMatch(DASH)
          for (const r of g.rows) {
            if (r.next != null) expect(r.next).not.toMatch(DASH)
            if (r.chip != null) expect(r.chip.label).not.toMatch(DASH)
          }
        }
      }
    }
    const rows = allRows(buildJobsList({ jobs: typed, tab: 'all', showLost: true, showMoney: true, now: NOW }).groups)
    expect(rows.find((r) => r.id === 't1')!.title).toBe('Smith-Jones')
    expect(rows.find((r) => r.id === 't1')!.subline).toBe('Slab - trench')
    expect(rows.find((r) => r.id === 't2')!.subline).toBe('Fence – gate')
    expect(rows.find((r) => r.id === 't3')!.title).toBe('Bo — Lee')
  })

  it('shows the last 30 days of finished work under All and all of it under Done', () => {
    const jobs = [
      row({ id: 'recent', stage: 'closed', name: 'Recent', completed_at: iso(now - 5 * DAY) }, 0),
      row({ id: 'old', stage: 'closed', name: 'Old', completed_at: iso(now - 90 * DAY), updated_at: iso(now - 90 * DAY) }, 0)
    ]
    const all = buildJobsList({ jobs, tab: 'all', showLost: false, showMoney: true, now: NOW })
    const doneAll = all.groups.find((g) => g.id === 'done')!
    expect(doneAll.note).toBe('Last 30 days')
    expect(doneAll.rows.map((r) => r.id)).toEqual(['recent'])
    expect(all.counts.done).toBe(2)

    const done = buildJobsList({ jobs, tab: 'done', showLost: false, showMoney: true, now: NOW })
    expect(done.groups.map((g) => g.id)).toEqual(['done'])
    expect(done.groups[0].rows.map((r) => r.id)).toEqual(['recent', 'old'])
  })

  it('sorts by amount when asked, and only when money is visible', () => {
    const jobs = [
      row({ id: 'small', stage: 'job', name: 'Small', amount: 100 }, 0),
      row({ id: 'big', stage: 'job', name: 'Big', amount: 9000 }, 5)
    ]
    const byAmount = buildJobsList({ jobs, tab: 'jobs', showLost: false, showMoney: true, now: NOW, sort: 'amount' })
    expect(byAmount.groups[0].rows.map((r) => r.id)).toEqual(['big', 'small'])
    const hidden = buildJobsList({ jobs, tab: 'jobs', showLost: false, showMoney: false, now: NOW, sort: 'amount' })
    expect(hidden.groups[0].rows.map((r) => r.id)).toEqual(['small', 'big'])
  })
})
