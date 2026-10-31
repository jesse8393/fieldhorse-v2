import { beforeEach, expect, it, vi } from 'vitest'

const replies: { data: any; error: any }[] = []
const calls: [string, unknown[]][] = []
vi.mock('./supabase.ts', () => ({ supabase: { from: () => {
  const reply = replies.shift()
  const builder: any = new Proxy({}, {
    get: (_target, key) => key === 'then'
      ? (resolve: (value: unknown) => void) => Promise.resolve(reply).then(resolve)
      : (...args: unknown[]) => { calls.push([String(key), args]); return builder },
  })
  return builder
} } }))

const { createJob } = await import('./createJob.ts')
const row = { id: 'stable-job-id', user_id: 'owner-a', org_id: 'org-a', name: 'Customer', stage: 'job' }
beforeEach(() => { replies.length = 0; calls.length = 0 })

it('returns a confirmed new job', async () => {
  replies.push({ data: { id: row.id }, error: null })
  expect(await createJob(row)).toEqual({ id: row.id })
})

it('recovers the same committed job after a lost insert response', async () => {
  replies.push({ data: null, error: { message: 'Failed to fetch' } })
  await expect(createJob(row)).rejects.toThrow('Failed to fetch')
  replies.push({ data: null, error: { code: '23505', message: 'duplicate key' } }, { data: { id: row.id }, error: null })
  expect(await createJob(row)).toEqual({ id: row.id })
  expect(calls.filter(([name]) => name === 'insert').map(([, args]) => args[0])).toEqual([row, row])
  expect(calls).toContainEqual(['eq', ['user_id', row.user_id]])
  expect(calls).toContainEqual(['eq', ['org_id', row.org_id]])
  expect(calls.some(([name]) => name === 'update' || name === 'upsert')).toBe(false)
})

it('does not mistake an inaccessible or unrelated duplicate for a saved job', async () => {
  replies.push({ data: null, error: { code: '23505', message: 'duplicate key' } }, { data: null, error: null })
  await expect(createJob(row)).rejects.toThrow('duplicate key')
})

it('never reports success without a returned identity', async () => {
  replies.push({ data: null, error: null })
  await expect(createJob(row)).rejects.toThrow(/confirm/)
})
