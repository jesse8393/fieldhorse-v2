import { describe, it, expect, vi, beforeEach } from 'vitest'

const mock = vi.hoisted(() => ({ results: new Map<string, unknown>(), options: null as any, invalidate: vi.fn(), calls: [] as any[], storageResult: null as any }))
vi.mock('@tanstack/react-query', () => ({
  useQuery: (options: any) => { mock.options = options; return options },
  useQueryClient: () => ({ invalidateQueries: mock.invalidate })
}))
vi.mock('./supabase', () => ({ supabase: {
  from: (table: string) => {
    const chain: any = new Proxy({}, { get: (_target, key) => key === 'then'
      ? (resolve: any) => Promise.resolve(mock.results.get(table) ?? { data: [], error: null }).then(resolve)
      : (...args: any[]) => { mock.calls.push([table, String(key), ...args]); return chain } })
    return chain
  },
  storage: { from: () => ({ createSignedUrls: () => Promise.resolve(mock.storageResult ?? { data: null, error: new Error('Storage unavailable') }), remove: () => Promise.resolve(mock.storageResult ?? { data: null, error: new Error('Storage unavailable') }) }) }
} }))

import { useIntegrations, useDisconnectIntegration } from './integrations'
import { useClientsBundle, useClientDetail, useJobDetail, useInvoiceDetail, useInvoicesOverview, useProfile, useJobPhotos, useJobFiles, useAgenda, useNotesScreen, useActivityFeed, useSubsRoster, useToggleTodo, useDeleteTodo, useUpdateJob, useUpdateProfile, useDeletePhoto, useDeleteFile, useGenerateDraws } from './queries'

beforeEach(() => { mock.results.clear(); mock.options = null; mock.invalidate.mockClear(); mock.calls = []; mock.storageResult = null })
const failure = new Error('Synthetic read failure')
describe('native failed reads', () => {
  for (const [name, hook, table] of [
    ['integration status', () => useIntegrations('user'), 'fh_integrations'],
    ['customer job summary', () => useClientsBundle('user'), 'fh_contacts'],
    ['customer payment summary', () => useClientsBundle('user'), 'fh_payments'],
    ['customer detail', () => useClientDetail('client'), 'fh_clients'],
    ['job payments', () => useJobDetail('job'), 'fh_payments'],
    ['invoice detail payments', () => useInvoiceDetail('job'), 'fh_payments'],
    ['invoice overview', () => useInvoicesOverview('user'), 'fh_invoices'],
    ['invoice overview payments', () => useInvoicesOverview('user'), 'fh_payments'],
    ['profile/onboarding', () => useProfile('user'), 'profiles'],
    ['photo index', () => useJobPhotos('job'), 'fh_job_files'],
    ['file index', () => useJobFiles('job'), 'fh_job_files'],
    ['agenda', () => useAgenda('user'), 'fh_schedule'],
    ['notes', () => useNotesScreen('user'), 'fh_notes'],
    ['activity', () => useActivityFeed('user'), 'fh_payments'],
    ['subcontractor roster', () => useSubsRoster('user'), 'fh_subs'],
  ] as const) {
    it(`${name} rejects instead of returning missing records or zero money`, async () => {
      mock.results.set(table, { data: null, error: failure })
      hook()
      await expect(mock.options.queryFn()).rejects.toThrow('Synthetic read failure')
    })
  }
  it('storage signing failure is reported instead of hiding all job photos', async () => {
    mock.results.set('fh_job_files', { data: [{ id: 'photo', storage_path: 'owner/job/photo.jpg' }], error: null })
    useJobPhotos('job')
    await expect(mock.options.queryFn()).rejects.toThrow('Storage unavailable')
  })
  it('a successful empty customer book remains a valid empty result', async () => {
    useClientsBundle('user')
    await expect(mock.options.queryFn()).resolves.toEqual({ clients: [], jobs: [], payments: [] })
  })
})

describe('native confirmed mutations', () => {
  for (const [name, hook, input, table] of [
    ['integration disconnect', useDisconnectIntegration, { userId: 'user', provider: 'jobber' }, 'fh_integrations'],
    ['task completion', useToggleTodo, { id: 'task', contactId: 'job', done: true }, 'fh_job_todos'],
    ['task deletion', useDeleteTodo, { id: 'task', contactId: 'job' }, 'fh_job_todos'],
    ['job edit', useUpdateJob, { contactId: 'job', name: 'Updated' }, 'fh_contacts'],
    ['profile edit', useUpdateProfile, { userId: 'user', companyName: 'Updated' }, 'profiles'],
  ] as const) {
    it(`${name} refuses zero affected records and retains existing cache`, async () => {
      mock.results.set(table, { data: [], error: null })
      const action = hook() as (input: any) => Promise<any>
      const result = await action(input)
      expect(result.error?.message).toContain('could not be confirmed')
      expect(mock.invalidate).not.toHaveBeenCalled()
      expect(mock.calls.some(c => c[0] === table && c[1] === 'select')).toBe(true)
    })
  }
  it('profile saves request an existing profile key', async () => {
    mock.results.set('profiles', { data: [{ user_id: 'user' }], error: null })
    const result = await useUpdateProfile()({ userId: 'user', companyName: 'Updated' })
    expect(result.error).toBeNull()
    expect(mock.calls).toContainEqual(['profiles', 'select', 'user_id'])
  })
  for (const hook of [useDeletePhoto, useDeleteFile]) {
    it('storage failure preserves its file index for retry', async () => {
      const result = await hook()({ id: 'file', path: 'owner/job/file', jobId: 'job' })
      expect(result.error?.message).toBe('Storage unavailable')
      expect(mock.calls.some(c => c[1] === 'delete')).toBe(false)
      expect(mock.invalidate).not.toHaveBeenCalled()
    })
  }
  it('a partial signed URL response remains an error, not an empty gallery', async () => {
    mock.results.set('fh_job_files', { data: [{ id: 'file', storage_path: 'owner/job/file' }], error: null })
    mock.storageResult = { data: [{ path: 'owner/job/file', error: 'Object missing' }], error: null }
    useJobPhotos('job')
    await expect(mock.options.queryFn()).rejects.toThrow('Some photos could not load')
  })
  it('draw generation submits all three rows atomically and preserves cents', async () => {
    mock.results.set('fh_invoices', { data: [{ id: 'a' },{ id: 'b' },{ id: 'c' }], error: null })
    expect((await useGenerateDraws()({ userId: 'user', contactId: 'job', contractTotal: 100.03 })).error).toBeNull()
    const inserts = mock.calls.filter(c => c[0] === 'fh_invoices' && c[1] === 'insert')
    expect(inserts).toHaveLength(1)
    expect(inserts[0][2].map((r: any) => Math.round(r.amount * 100))).toEqual([5002,4001,1000])
  })
})
