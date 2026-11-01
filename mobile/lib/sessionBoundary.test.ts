import { describe, it, expect } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import { createSessionBoundary } from './sessionBoundary'

describe('native account cache isolation', () => {
  it('clears customer data on sign-out and direct account switches', () => {
    const client = new QueryClient()
    const transition = createSessionBoundary(client)
    transition('account-a')
    client.setQueryData(['jobs'], [{ name: 'Account A customer' }])
    transition('account-b')
    expect(client.getQueryData(['jobs'])).toBeUndefined()
    client.setQueryData(['jobs'], [{ name: 'Account B customer' }])
    transition(null, true)
    expect(client.getQueryCache().getAll()).toHaveLength(0)
  })
  it('preserves cached work on a token refresh for the same account', () => {
    const client = new QueryClient()
    const transition = createSessionBoundary(client)
    transition('account-a')
    client.setQueryData(['jobs'], [{ id: 'a' }])
    transition('account-a')
    expect(client.getQueryData(['jobs'])).toEqual([{ id: 'a' }])
  })
  it('cancels old queries so late responses cannot restore the previous book', async () => {
    const client = new QueryClient()
    const transition = createSessionBoundary(client)
    transition('account-a')
    let resolve!: (rows: string[]) => void
    const pending = client.fetchQuery({ queryKey: ['jobs'], queryFn: () => new Promise<string[]>(r => { resolve = r }) }).catch(() => undefined)
    transition('account-b')
    resolve(['private account A job'])
    await pending
    expect(client.getQueryData(['jobs'])).toBeUndefined()
  })
})
