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

  it('keeps Quote Desk with the same revenue operators as Lead Desk', () => {
    expect(canViewRoute('owner', '/quotes')).toBe(true)
    expect(canViewRoute('admin', '/quotes')).toBe(true)
    expect(canViewRoute('manager', '/quotes')).toBe(true)
    expect(canViewRoute('foreman', '/quotes')).toBe(false)
    expect(canViewRoute('crew', '/quotes')).toBe(false)
  })
})
