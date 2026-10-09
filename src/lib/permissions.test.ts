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

  it('keeps Pipeline with revenue operators', () => {
    expect(canViewRoute('owner', '/pipeline')).toBe(true)
    expect(canViewRoute('admin', '/pipeline')).toBe(true)
    expect(canViewRoute('manager', '/pipeline')).toBe(true)
    expect(canViewRoute('foreman', '/pipeline')).toBe(false)
    expect(canViewRoute('crew', '/pipeline')).toBe(false)
  })

  it('fails closed for a route with no rule', () => {
    expect(canViewRoute('owner', '/some-new-screen')).toBe(true)
    expect(canViewRoute('admin', '/some-new-screen')).toBe(true)
    expect(canViewRoute('crew', '/some-new-screen')).toBe(false)
    expect(canViewRoute('foreman', '/some-new-screen')).toBe(false)
  })

  it('still lets field roles open the job and field screens they need', () => {
    for (const route of ['/', '/crew', '/work', '/jobs', '/notes', '/schedule', '/activity', '/team', '/pour-window']) {
      expect(canViewRoute('crew', route)).toBe(true)
    }
  })
})
