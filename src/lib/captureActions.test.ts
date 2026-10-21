import { describe, expect, it, vi } from 'vitest'
import { QueryClient, type QueryKey } from '@tanstack/react-query'

// Each supabase.from call hands back a chain that records its calls and
// resolves to the next queued response, the pattern leads.test.ts uses.
const db = vi.hoisted(() => {
  type Call = [string, ...unknown[]]
  const responses: { data: unknown; error: unknown }[] = []
  const builders: Call[][] = []
  function builder(table: string): unknown {
    const calls: Call[] = [['from', table]]
    builders.push(calls)
    const response = responses.shift() ?? { data: null, error: null }
    const proxy: unknown = new Proxy({}, {
      get(_target, prop) {
        if (prop === 'then') {
          return (resolve: (v: unknown) => unknown, reject: (e: unknown) => unknown) =>
            Promise.resolve(response).then(resolve, reject)
        }
        return (...args: unknown[]) => { calls.push([String(prop), ...args]); return proxy }
      },
    })
    return proxy
  }
  return { responses, builders, builder }
})

vi.mock('./supabase.ts', () => ({ supabase: { from: (table: string) => db.builder(table) } }))
vi.mock('./clients.ts', () => ({ findOrCreateClient: vi.fn(async () => 'client-1') }))
vi.mock('./orgScope.ts', () => ({ lastKnownOrg: () => 'org-1' }))

const { commitCapture, refreshAfterCapture } = await import('./captureActions.ts')
const { findOrCreateClient } = await import('./clients.ts')
const { jobsKey } = await import('./queries.ts')
const { homeDashboardKey } = await import('./homeDashboard.ts')

// Every read a screen might have cached, keyed exactly as the screens key them.
const KEYS: Record<string, QueryKey> = {
  job: ['jobDetail', 'c-job1'],
  otherJob: ['jobDetail', 'c-job2'],
  jobs: jobsKey('user-a'),
  otherUsersJobs: jobsKey('user-b'),
  today: homeDashboardKey('user-a', 'org-1'),
  todayBeforeOrg: homeDashboardKey('user-a', null),
  otherUsersToday: homeDashboardKey('user-b', 'org-1'),
  money: ['invoices', 'user-a', 'org-1'],
}

function cached() {
  const client = new QueryClient()
  for (const key of Object.values(KEYS)) client.setQueryData(key, { rows: [] })
  return client
}

function refreshed(client: QueryClient) {
  return Object.entries(KEYS)
    .filter(([, key]) => client.getQueryState(key)?.isInvalidated)
    .map(([name]) => name)
}

describe('refreshAfterCapture', () => {
  it('refreshes the job it was filed on, the jobs lists and Today', async () => {
    const client = cached()
    await refreshAfterCapture(client, 'user-a', 'c-job1')
    expect(refreshed(client)).toEqual(['job', 'jobs', 'today', 'todayBeforeOrg'])
  })

  it('with no job, refreshes the lists and leaves every job page alone', async () => {
    const client = cached()
    await refreshAfterCapture(client, 'user-a', null)
    expect(refreshed(client)).toEqual(['jobs', 'today', 'todayBeforeOrg'])
  })
})

describe('commitCapture lead', () => {
  it('a captured lead inserts fh_leads', async () => {
    db.responses.length = 0
    db.builders.length = 0
    db.responses.push({ data: { id: 'lead-1', client_id: 'client-1', status: 'open' }, error: null })
    const result = await commitCapture({
      userId: 'user-a',
      contacts: [],
      intent: {
        kind: 'lead', summary: 'New lead from Ana', confidence: 0.9, job_id: null,
        name: 'Ana Ruiz', phone: '615-555-0142', email: 'ana@ruiz.com', address: '12 Oak St',
        title: 'Deck rebuild', amount: 4500, follow_up_on: '2026-10-24',
      } as any,
    })
    // The client comes first, matched or made through the shared helper.
    expect(findOrCreateClient).toHaveBeenCalledWith(
      'user-a',
      { name: 'Ana Ruiz', phone: '615-555-0142', email: 'ana@ruiz.com', address: '12 Oak St' },
      'org-1'
    )
    // The lead lands in fh_leads, never fh_contacts.
    const tables = db.builders.map((calls) => calls[0][1])
    expect(tables).toEqual(['fh_leads'])
    const insert = db.builders[0].find((c) => c[0] === 'insert')?.[1] as Record<string, unknown>
    expect(insert).toMatchObject({
      user_id: 'user-a', org_id: 'org-1', client_id: 'client-1',
      title: 'Deck rebuild', status: 'open', follow_up_on: '2026-10-24', source: 'capture',
    })
    expect(insert.notes).toContain('4,500')
    expect(result.link).toBe('/leads/lead-1')
    expect(result.toast).toBe('Lead created')
  })
})
