import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QueryClient } from '@tanstack/react-query'

const updates: { values: unknown; id: string }[] = []
let failNext: { message: string } | null = null
const toasts: string[] = []

vi.mock('./supabase.ts', () => ({
  supabase: {
    from: () => ({
      update: (values: unknown) => ({
        eq: (_col: string, id: string) => ({
          select: async () => {
            updates.push({ values, id })
            if (failNext) {
              const error = failNext
              failNext = null
              return { data: null, error }
            }
            return { data: [{ id }], error: null }
          }
        })
      })
    })
  }
}))
vi.mock('./toast.ts', () => ({
  toastSuccess: (title: string) => { toasts.push(title) },
  toastError: (title: string) => { toasts.push(title) }
}))

const { followUpOnFor, followUpMeta, saveFollowUp, FOLLOW_UP_PRESETS } = await import('./followUp.ts')
const { jobsKey } = await import('./queries.ts')

// Saturday, October 10, 2026, late evening local time.
const TODAY = new Date(2026, 9, 10, 22, 30)

describe('followUpOnFor', () => {
  it('counts presets in local calendar days from today', () => {
    expect(followUpOnFor(1, TODAY)).toBe('2026-10-11')
    expect(followUpOnFor(3, TODAY)).toBe('2026-10-13')
    expect(followUpOnFor(7, TODAY)).toBe('2026-10-17')
  })

  it('takes a picked date as that local day, and null clears', () => {
    expect(followUpOnFor(new Date(2026, 10, 2, 23, 59), TODAY)).toBe('2026-11-02')
    expect(followUpOnFor(null, TODAY)).toBeNull()
  })

  it('offers tomorrow, in 3 days and next week', () => {
    expect(FOLLOW_UP_PRESETS.map((p) => p.label)).toEqual(['Tomorrow', 'In 3 days', 'Next week'])
  })
})

describe('followUpMeta', () => {
  it('labels the date without dashes', () => {
    expect(followUpMeta('2026-10-10', TODAY)).toEqual({ label: 'Follow up today', tone: 'warn' })
    expect(followUpMeta('2026-10-11', TODAY)).toEqual({ label: 'Follow up tomorrow', tone: 'muted' })
    expect(followUpMeta('2026-10-07', TODAY)).toEqual({ label: 'Follow up 3d overdue', tone: 'danger' })
    expect(followUpMeta('2026-10-20', TODAY)?.label).toMatch(/^Follow up Oct 20$/)
    expect(followUpMeta(null, TODAY)).toBeNull()
    expect(followUpMeta('not a date', TODAY)).toBeNull()
    for (const day of ['2026-10-07', '2026-10-10', '2026-10-11', '2026-10-20']) {
      expect(followUpMeta(day, TODAY)?.label).not.toMatch(/[-–—]/)
    }
  })
})

describe('saveFollowUp', () => {
  let queryClient: QueryClient
  const job = { id: 'c1', name: 'Plumbing Bellevue', follow_up_on: '2026-10-01' }

  beforeEach(() => {
    updates.length = 0
    toasts.length = 0
    failNext = null
    queryClient = new QueryClient()
    queryClient.setQueryData(['jobDetail', 'c1'], { contact: { ...job } })
    queryClient.setQueryData(jobsKey('u1'), [{ ...job }, { id: 'c2', follow_up_on: null }])
  })

  it('writes the date, updates both caches and says so', async () => {
    const res = await saveFollowUp(queryClient, job, 'u1', null)
    expect(res.error).toBeNull()
    expect(updates).toEqual([{ values: { follow_up_on: null }, id: 'c1' }])
    expect((queryClient.getQueryData(['jobDetail', 'c1']) as any).contact.follow_up_on).toBeNull()
    expect((queryClient.getQueryData(jobsKey('u1')) as any[])[0].follow_up_on).toBeNull()
    expect(toasts).toEqual(['Follow up cleared'])
  })

  it('puts the old date back when the write fails', async () => {
    failNext = { message: 'offline' }
    const res = await saveFollowUp(queryClient, job, 'u1', 3)
    expect(res.error).toEqual({ message: 'offline' })
    expect((queryClient.getQueryData(['jobDetail', 'c1']) as any).contact.follow_up_on).toBe('2026-10-01')
    expect((queryClient.getQueryData(jobsKey('u1')) as any[])[0].follow_up_on).toBe('2026-10-01')
    expect(toasts).toEqual(['Follow up set', "Couldn't set follow up"])
  })
})
