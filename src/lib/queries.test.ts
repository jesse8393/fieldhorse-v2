import { describe, expect, it } from 'vitest'
import { subDetailKey, subsKey } from './queries.ts'

describe('query keys', () => {
  it('scopes sub directory data by user and organization', () => {
    expect(subsKey('user-1', 'org-1')).toEqual(['subs', 'user-1', 'org-1'])
    expect(subsKey('user-1', 'org-2')).toEqual(['subs', 'user-1', 'org-2'])
    expect(subsKey('user-2', 'org-1')).toEqual(['subs', 'user-2', 'org-1'])
  })

  it('scopes sub detail data by vendor key, user, and organization', () => {
    expect(subDetailKey('6155550100', 'user-1', 'org-1')).toEqual([
      'subDetail',
      '6155550100',
      'user-1',
      'org-1',
    ])
  })
})
