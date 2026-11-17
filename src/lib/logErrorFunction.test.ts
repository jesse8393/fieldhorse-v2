import { afterEach, describe, expect, it, vi } from 'vitest'
import { logError } from '../../netlify/functions/lib/logError.js'

// Function logs used to print raw Supabase error objects. A unique
// violation's details read Key (email)=(...), so a customer's email or
// phone ended up in the Netlify log. logError keeps the code, a cleaned
// message and the company, and drops details, hints and row values.

afterEach(() => vi.restoreAllMocks())

function logged(spy: { mock: { calls: unknown[][] } }) {
  expect(spy.mock.calls).toHaveLength(1)
  expect(spy.mock.calls[0]).toHaveLength(1)
  return JSON.parse(spy.mock.calls[0][0] as string)
}

describe('logError', () => {
  it('logs one structured line with scope, what failed, code, message and company', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('webhook-lead', 'insert failed', {
      code: '23505',
      message: 'duplicate key value violates unique constraint "fh_clients_email_key"',
      details: 'Key (email)=(ana@ruiz.com) already exists.',
      hint: null,
      row: { name: 'Ana Ruiz', phone: '615-555-0142' }
    }, { org_id: 'org-1', request_id: 'req-7' })
    expect(logged(spy)).toEqual({
      scope: 'webhook-lead', what: 'insert failed', code: '23505',
      message: 'duplicate key value violates unique constraint "fh_clients_email_key"',
      org_id: 'org-1', request_id: 'req-7'
    })
  })

  it('takes record values out of the message too', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('x', 'failed', { message: 'Key (email)=(ana@ruiz.com) phone 615-555-0142\nsecond line' })
    const line = logged(spy)
    expect(line.message).not.toMatch(/ana@ruiz|615|second line/)
    expect(line).toEqual({ scope: 'x', what: 'failed', code: null, message: expect.any(String) })
  })

  it('reads a thrown Error or a plain string', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    logError('x', 'threw', new Error('socket hang up'))
    logError('x', 'threw', 'timeout')
    expect(spy.mock.calls.map((c) => JSON.parse(c[0] as string).message)).toEqual(['socket hang up', 'timeout'])
  })
})
