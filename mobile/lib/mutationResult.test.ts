import { describe, expect, it } from 'vitest'
import { confirmMutation } from './mutationResult'

describe('native mutation acknowledgement', () => {
  it('rejects a successful HTTP response affecting no records', async () => {
    const result = await confirmMutation(Promise.resolve({ data: [], error: null }))
    expect(result.error?.message).toContain('could not be confirmed')
  })
  it('preserves a server rejection', async () => {
    const error = { message: 'Permission revoked' }
    expect((await confirmMutation(Promise.resolve({ data: null, error }))).error).toBe(error)
  })
  it('accepts exactly one returned record', async () => {
    expect((await confirmMutation(Promise.resolve({ data: [{ id: 'saved' }], error: null }))).error).toBeNull()
  })
  it('rejects an incomplete batch acknowledgement', async () => {
    expect((await confirmMutation(Promise.resolve({ data: [{ id: 'one' }], error: null }),3)).error).not.toBeNull()
  })
})
