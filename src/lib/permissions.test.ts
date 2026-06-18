import { describe, expect, it } from 'vitest'
import { canViewRoute } from './permissions.ts'

describe('canViewRoute', () => {
  it('keeps Lead Desk with revenue operators', () => {
    expect(canViewRoute('owner', '/leads')).toBe(true)
    expect(canViewRoute('admin', '/leads')).toBe(true)
    expect(canViewRoute('manager', '/leads')).toBe(true)
    expect(canViewRoute('foreman', '/leads')).toBe(false)
    expect(canViewRoute('crew', '/leads')).toBe(false)
  })
})
