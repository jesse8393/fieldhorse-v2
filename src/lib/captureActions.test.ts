import { describe, expect, it, vi } from 'vitest'
import { QueryClient, type QueryKey } from '@tanstack/react-query'

vi.mock('./supabase.ts', () => ({ supabase: {} }))

const { refreshAfterCapture } = await import('./captureActions.ts')
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
