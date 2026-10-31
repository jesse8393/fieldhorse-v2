import { afterEach, describe, expect, it, vi } from 'vitest'
import { createUuid } from './uuid.ts'

afterEach(() => vi.unstubAllGlobals())
describe('createUuid', () => {
  it('uses native UUIDs with the crypto receiver intact', () => {
    const api = { randomUUID() { expect(this).toBe(api); return 'native-uuid' } }
    vi.stubGlobal('crypto', api)
    expect(createUuid()).toBe('native-uuid')
  })
  it('uses secure random bytes and sets v4 version and variant bits without randomUUID', () => {
    const getRandomValues = vi.fn((bytes: Uint8Array) => bytes.fill(255))
    vi.stubGlobal('crypto', { getRandomValues })
    expect(createUuid()).toBe('ffffffff-ffff-4fff-bfff-ffffffffffff')
    expect(getRandomValues).toHaveBeenCalledOnce()
  })
  it('preserves leading zeroes and consumes fresh bytes for each intent', () => {
    let value = 0
    vi.stubGlobal('crypto', { getRandomValues: (bytes: Uint8Array) => bytes.fill(value++) })
    expect(createUuid()).toBe('00000000-0000-4000-8000-000000000000')
    expect(createUuid()).toBe('01010101-0101-4101-8101-010101010101')
  })
})
