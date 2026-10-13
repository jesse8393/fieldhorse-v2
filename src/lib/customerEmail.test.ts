import { describe, expect, it } from 'vitest'
import { customerEmail } from './customerEmail.ts'

// Phase 8, Task 15: one rule for where a customer's email comes from,
// shared by Money (the Remind sheet) and the Quote tab: the job's own
// email, then the email of the client the job is linked to.
describe('customerEmail', () => {
  it('reads the job email first, then the linked client, as Money does', () => {
    expect(customerEmail({ email: 'job@site.com', fh_clients: { email: 'client@home.com' } })).toBe('job@site.com')
    expect(customerEmail({ email: null, fh_clients: { email: 'client@home.com' } })).toBe('client@home.com')
    expect(customerEmail({ email: '', fh_clients: { email: ' client@home.com ' } })).toBe('client@home.com')
  })

  it('skips a job email that is only spaces', () => {
    expect(customerEmail({ email: '   ', fh_clients: { email: 'client@home.com' } })).toBe('client@home.com')
  })

  it('is empty when neither has one', () => {
    expect(customerEmail({ email: null, fh_clients: null })).toBe('')
    expect(customerEmail({})).toBe('')
    expect(customerEmail(null)).toBe('')
    expect(customerEmail(undefined)).toBe('')
  })
})
