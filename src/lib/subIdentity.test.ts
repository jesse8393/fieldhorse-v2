import { describe, it, expect } from 'vitest'
import { subIdentityKey, subMatchesKey, normalizePhoneKey, UNTITLED_SUB_KEY } from './subIdentity.ts'

describe('sub identity keying', () => {
  it('unifies formatted and digits-only phone numbers', () => {
    expect(subIdentityKey({ phone: '(615) 555-0101', name: 'Mike Diaz' }))
      .toBe(subIdentityKey({ phone: '6155550101', name: 'M. Diaz' }))
  })

  it('ignores +1 country prefixes', () => {
    expect(normalizePhoneKey('+1 615 555 0101')).toBe('6155550101')
  })

  it('falls back to lowercased name, then the untitled sentinel', () => {
    expect(subIdentityKey({ phone: '', name: '  Mike Diaz ' })).toBe('mike diaz')
    expect(subIdentityKey({ phone: null, name: null })).toBe(UNTITLED_SUB_KEY)
  })

  it('still matches legacy raw-string keys', () => {
    expect(subMatchesKey({ phone: '(615) 555-0101', name: 'Mike' }, '(615) 555-0101')).toBe(true)
    expect(subMatchesKey({ phone: '', name: 'Mike' }, 'mike')).toBe(true)
  })
})
