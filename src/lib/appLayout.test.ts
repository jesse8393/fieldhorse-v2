import { describe, expect, it } from 'vitest'
import { layoutForPath } from './appLayout.ts'

describe('layoutForPath', () => {
  it.each([
    '/',
    '/activity',
    '/settings',
    '/team',
    '/tasks',
    '/timesheets',
    '/crew',
    '/clients/client-1',
    '/jobs/job-1',
    '/import',
    '/partners',
    '/sub-portal',
    '/subs/vendor-1',
    '/invoices/invoice-1',
    '/inbox',
    '/inbox/conversation-1',
  ])('gives %s the responsive workspace', (pathname) => {
    expect(layoutForPath(pathname)).toBe('responsive')
  })

  it('keeps unknown routes in the compact fallback', () => {
    expect(layoutForPath('/not-a-real-route')).toBe('mobile-frame')
  })
})
