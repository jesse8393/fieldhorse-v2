import { describe, expect, it } from 'vitest'
import { pageTitle, screenName } from './pageTitle.ts'

describe('page titles', () => {
  it('names each screen, then the app', () => {
    expect(pageTitle('/')).toBe('Today · Fieldhorse')
    expect(pageTitle('/quotes')).toBe('Quotes · Fieldhorse')
    expect(pageTitle('/quotes/q-1')).toBe('Quote · Fieldhorse')
    expect(pageTitle('/quotes/q-1/terms')).toBe('Scope and terms · Fieldhorse')
    expect(pageTitle('/jobs/new')).toBe('New job · Fieldhorse')
    expect(pageTitle('/invoices/i-1/payment')).toBe('Collect payment · Fieldhorse')
    expect(pageTitle('/clients/cl-1/statement')).toBe('Customer statement · Fieldhorse')
  })

  it('keeps list and record screens apart', () => {
    const names = ['/jobs', '/jobs/c-1', '/leads', '/leads/l-1', '/quotes', '/quotes/q-1', '/invoices', '/invoices/i-1', '/clients', '/clients/cl-1'].map(screenName)
    expect(new Set(names).size).toBe(names.length)
  })

  it('ignores a trailing slash and falls back to the app name', () => {
    expect(screenName('/schedule/')).toBe('Schedule')
    expect(pageTitle('/no-such-screen')).toBe('Fieldhorse')
  })
})
