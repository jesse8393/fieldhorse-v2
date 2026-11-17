import { beforeEach, describe, expect, it, vi } from 'vitest'

// A recording fake of the one PostgREST chain these writers use:
// from(table).insert(rows).select('id') and from(table).delete().eq().select('id').
type Call = [string, ...unknown[]]
let calls: Call[] = []
let response: { data: unknown; error: unknown } = { data: [], error: null }

function chain(): unknown {
  const proxy: unknown = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
          Promise.resolve(response).then(resolve, reject)
      }
      return (...args: unknown[]) => {
        calls.push([String(prop), ...args])
        return proxy
      }
    }
  })
  return proxy
}

vi.mock('./supabase.ts', () => ({
  supabase: { from: (table: string) => { calls.push(['from', table]); return chain() } }
}))

const { createScheduleEvent, createScheduleEvents, deleteScheduleEvent } = await import('./scheduleWrite.ts')

const input = {
  userId: 'user-1',
  orgId: 'org-1',
  contactId: 'c-job1',
  title: 'Plumbing Bellevue',
  start_at: '2026-10-09T18:00:00.000Z',
  end_at: '2026-10-09T19:00:00.000Z'
}

function inserted(): Record<string, unknown>[] {
  const call = calls.find((c) => c[0] === 'insert')
  expect(call).toBeTruthy()
  return call![1] as Record<string, unknown>[]
}

beforeEach(() => {
  calls = []
  response = { data: [{ id: 'new-1' }], error: null }
})

describe('createScheduleEvent', () => {
  it('writes to fh_schedule with org_id, user_id, contact_id, title, start_at and end_at', async () => {
    const result = await createScheduleEvent(input)
    expect(result).toEqual({ id: 'new-1' })
    expect(calls[0]).toEqual(['from', 'fh_schedule'])
    expect(inserted()).toEqual([{
      org_id: 'org-1',
      user_id: 'user-1',
      contact_id: 'c-job1',
      lead_id: null,
      quote_id: null,
      title: 'Plumbing Bellevue',
      description: null,
      start_at: '2026-10-09T18:00:00.000Z',
      end_at: '2026-10-09T19:00:00.000Z',
      recurring: null
    }])
  })

  it("writes lead_id and the where line for a lead's estimate, and quote_id for a quote's visit", async () => {
    await createScheduleEvent({ ...input, contactId: null, leadId: 'l-lead1', title: 'Estimate', description: ' Jeff Roy, 412 Burkitt Station Rd ' })
    expect(inserted()[0]).toMatchObject({ contact_id: null, lead_id: 'l-lead1', quote_id: null, title: 'Estimate', description: 'Jeff Roy, 412 Burkitt Station Rd' })
    calls = []
    await createScheduleEvent({ ...input, contactId: null, quoteId: 'q-quote', title: 'Walk the site' })
    expect(inserted()[0]).toMatchObject({ contact_id: null, lead_id: null, quote_id: 'q-quote', description: null })
  })

  it('trims the title and writes a null contact_id for an event with no job', async () => {
    await createScheduleEvent({ ...input, title: '  Walkthrough  ', contactId: null })
    expect(inserted()[0]).toMatchObject({ title: 'Walkthrough', contact_id: null })
  })

  it('leaves org_id out when the person has no organization, so the database fills it', async () => {
    await createScheduleEvent({ ...input, orgId: null })
    expect(inserted()[0]).not.toHaveProperty('org_id')
  })

  it('gives safe recovery guidance when the insert fails', async () => {
    response = { data: null, error: { message: 'new row violates row level security' } }
    expect(await createScheduleEvent(input)).toEqual({ error: 'The event could not be saved. Refresh the schedule and try again.' })
  })

  it('returns an error, and writes nothing, when the title is blank', async () => {
    const result = await createScheduleEvent({ ...input, title: '   ' })
    expect(result).toEqual({ error: 'Give the event a title.' })
    expect(calls).toEqual([])
  })

  it('returns an error when the insert answers with no row', async () => {
    response = { data: [], error: null }
    const result = await createScheduleEvent(input)
    expect(result).toEqual({ error: 'The event was not saved. Try again.' })
  })
})

describe('createScheduleEvents', () => {
  it('persists every selected member and reports a concurrent booking failure', async () => {
    await createScheduleEvents([{ ...input, assignedUserIds: ['alice', 'bob', 'alice'] }])
    expect(inserted()[0]).toMatchObject({ assigned_user_ids: ['alice', 'bob'], assigned_to: 'alice' })
    response = { data: null, error: { code: '23P01', message: 'constraint violation' } }
    expect(await createScheduleEvents([{ ...input, assignedUserIds: ['alice'] }])).toEqual({ error: expect.stringContaining('Refresh availability') })
  })
  it('writes a whole recurring series in one insert, each row carrying the shared series id and org_id', async () => {
    response = { data: [{ id: 'a' }, { id: 'b' }], error: null }
    const result = await createScheduleEvents([
      { ...input, recurring: 'series-1' },
      { ...input, start_at: '2026-10-16T18:00:00.000Z', end_at: '2026-10-16T19:00:00.000Z', recurring: 'series-1' }
    ])
    expect(result).toEqual({ ids: ['a', 'b'] })
    expect(calls.filter((c) => c[0] === 'insert')).toHaveLength(1)
    expect(inserted().map((r) => [r.org_id, r.recurring])).toEqual([['org-1', 'series-1'], ['org-1', 'series-1']])
  })
})

describe('deleteScheduleEvent', () => {
  it('deletes one event by id and reports a failed delete', async () => {
    response = { data: [{ id: 'new-1' }], error: null }
    expect(await deleteScheduleEvent('new-1')).toEqual({ ok: true })
    expect(calls).toContainEqual(['eq', 'id', 'new-1'])

    response = { data: [], error: null }
    expect(await deleteScheduleEvent('new-1')).toEqual({ error: 'The event was not removed. Refresh and try again.' })
  })
})

// DATA-12: a save whose answer is lost used to insert the visits again on
// retry. With the form's own ids the write is an upsert on id.
describe('createScheduleEvents with ids minted by the form', () => {
  it('upserts on id, so a retry after a lost answer writes the same rows', async () => {
    response = { data: [{ id: 'visit-a' }, { id: 'visit-b' }], error: null }
    const result = await createScheduleEvents([{ ...input, id: 'visit-a' }, { ...input, id: 'visit-b' }])
    expect(result).toEqual({ ids: ['visit-a', 'visit-b'] })
    const upsert = calls.find((c) => c[0] === 'upsert')
    expect(upsert).toBeTruthy()
    expect((upsert![1] as Record<string, unknown>[]).map((r) => r.id)).toEqual(['visit-a', 'visit-b'])
    expect(upsert![2]).toMatchObject({ onConflict: 'id' })
    expect(calls.some((c) => c[0] === 'insert')).toBe(false)
  })
})

// DATA-13: after a visit is saved or removed, every read that shows visits
// refreshes: the Schedule, a lead's next estimate visit, the Leads list
// chips and Today.
describe('invalidateVisitReads', () => {
  it('refreshes the schedule, the lead visit reads and Today', async () => {
    const { invalidateVisitReads } = await import('./scheduleWrite.ts')
    const keys: unknown[] = []
    invalidateVisitReads({ invalidateQueries: (filter: { queryKey: unknown }) => { keys.push(filter.queryKey); return Promise.resolve() } } as never)
    for (const key of [['schedule'], ['scheduleUpcoming'], ['scheduleBooked'], ['scheduleJobVisits'], ['leadVisits'], ['leadNextVisit'], ['homeDashboard']]) {
      expect(keys).toContainEqual(key)
    }
  })
})
