import { describe, expect, it, vi } from 'vitest'
vi.mock('./supabase.ts', () => ({ supabase: {} }))
import { buildWorkList, searchWorkJobs } from './workList.ts'
import type { JobRow, LeadRow, QuoteRow } from './queries.ts'

const now = new Date('2026-10-27T15:00:00Z')
const job = (id: string, stage = 'job') => ({ id, stage, name: `Job ${id}`, amount: 100, created_at: now.toISOString(), updated_at: now.toISOString() } as JobRow)
const lead = (id: string) => ({ id, status: 'open', title: `Lead ${id}`, created_at: now.toISOString(), updated_at: now.toISOString(), fh_clients: { name: 'Customer', phone: '5551234' } } as LeadRow)
const quote = (id: string) => ({ id, status: 'draft', title: `Quote ${id}`, amount: 200, created_at: now.toISOString(), updated_at: now.toISOString(), fh_clients: { name: 'Customer' } } as QuoteRow)
const input = { jobs: [job('same'), job('legacy-lead', 'lead'), job('legacy-quote', 'quote'), job('done', 'closed')], leads: [lead('same')], quotes: [quote('same')], tab: 'all' as const, showLost: false, showMoney: true, fieldView: false, now }

describe('shared work inventory', () => {
  it('All exposes every counted record from the correct entity table', () => {
    const view = buildWorkList(input)
    const routes = view.groups.flatMap((group) => group.rows.map((row) => row.to))
    expect(view.counts).toEqual({ all: 4, leads: 1, quotes: 1, jobs: 1, done: 1 })
    expect(routes).toEqual(['/jobs/same', '/quotes/same', '/leads/same', '/jobs/done'])
    expect(new Set(routes).size).toBe(4)
    expect(routes.length).toBe(view.counts.all)
  })
  it('uses the same sales source for All and each stage filter', () => {
    const all = buildWorkList(input)
    for (const tab of ['leads', 'quotes'] as const) {
      const view = buildWorkList({ ...input, tab })
      expect(view.groups).toEqual(all.groups.filter((group) => group.id === tab))
      expect(view.groups.flatMap((group) => group.rows).length).toBe(view.counts[tab])
    }
  })
  it('never exposes cached sales rows or money to a field role', () => {
    const view = buildWorkList({ ...input, fieldView: true, showMoney: false, tab: 'quotes' })
    expect(view.counts).toEqual({ all: 2, leads: 0, quotes: 0, jobs: 1, done: 1 })
    expect(view.groups.flatMap((group) => group.rows).every((row) => row.money === null)).toBe(true)
    expect(view.groups.some((group) => group.id === 'leads' || group.id === 'quotes')).toBe(false)
  })
  it('keeps server normalized phone matches without duplicate records', () => {
    const match = { ...job('phone'), phone: '(555) 123-4567' }
    expect(searchWorkJobs([match, job('other')], [match, match], '5551234567')).toEqual([match])
    expect(searchWorkJobs([job('old', 'lead')], [job('old', 'quote')], 'old')).toEqual([])
  })
  it('counts searched sales records and excludes lost sales', () => {
    const view = buildWorkList({ ...input, jobs: [], leads: [lead('matching'), { ...lead('hidden'), status: 'lost' }], quotes: [], search: 'matching' })
    expect(view.counts.all).toBe(1)
    expect(view.groups[0].rows[0].to).toBe('/leads/matching')
  })
})
