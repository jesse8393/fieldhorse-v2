import { describe, expect, it } from 'vitest'
import {
  activityKey,
  analyticsKey,
  clientDetailKey,
  clientsKey,
  invoicesKey,
  noteContactsKey,
  notesKey,
  scheduleKey,
  scoped,
  subDetailKey,
  subsKey,
  upcomingKey,
} from './queries.ts'

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

  it('puts the org scope in every tenant bundle key', () => {
    expect(clientsKey('user-1', 'org-1')).toEqual(['clients', 'user-1', 'org-1'])
    expect(invoicesKey('user-1', 'org-1')).toEqual(['invoices', 'user-1', 'org-1'])
    expect(analyticsKey('user-1', 'org-1')).toEqual(['analytics', 'user-1', 'org-1'])
    expect(upcomingKey('user-1', 'org-1')).toEqual(['scheduleUpcoming', 'user-1', 'org-1'])
    expect(scheduleKey('user-1', 'org-1', 'a', 'b')).toEqual(['schedule', 'user-1', 'org-1', 'a', 'b'])
    expect(activityKey('user-1', 'org-1', 60)).toEqual(['activity', 'user-1', 'org-1', 60])
    expect(clientDetailKey('client-1', 'user-1', 'org-1')).toEqual(['clientDetail', 'client-1', 'user-1', 'org-1'])
    expect(noteContactsKey('user-1', 'org-1')).toEqual(['noteContacts', 'user-1', 'org-1'])
  })

  it('keeps the notes cache at the per user key Notes.tsx patches', () => {
    expect(notesKey('user-1')).toEqual(['notes', 'user-1'])
  })

  it('separates org scoped and user scoped caches', () => {
    expect(invoicesKey('user-1', 'org-1')).not.toEqual(invoicesKey('user-1', null))
    // undefined (scope not known yet) and null (no org) share a key,
    // matching how TanStack hashes them; the query stays disabled while
    // the scope is undefined.
    expect(invoicesKey('user-1', undefined)).toEqual(invoicesKey('user-1', null))
  })

  it('keeps the prefixes the invalidators match on', () => {
    expect(clientDetailKey('client-1', 'user-1', 'org-1').slice(0, 2)).toEqual(['clientDetail', 'client-1'])
    expect(clientsKey('user-1', 'org-1')[0]).toBe('clients')
    expect(invoicesKey('user-1', 'org-1')[0]).toBe('invoices')
    expect(analyticsKey('user-1', 'org-1')[0]).toBe('analytics')
    expect(scheduleKey('user-1', 'org-1', 'a', 'b')[0]).toBe('schedule')
    expect(upcomingKey('user-1', 'org-1')[0]).toBe('scheduleUpcoming')
  })
})

describe('scoped', () => {
  function recordingQuery() {
    const calls: [string, string][] = []
    const query = {
      eq(column: string, value: string) {
        calls.push([column, value])
        return query
      },
    }
    return { query, calls }
  }

  it('reads the whole org book when the viewer has an org', () => {
    const { query, calls } = recordingQuery()
    expect(scoped(query, 'user-1', 'org-1')).toBe(query)
    expect(calls).toEqual([['org_id', 'org-1']])
  })

  it('keeps the per user filter when there is no org', () => {
    for (const orgId of [null, undefined]) {
      const { query, calls } = recordingQuery()
      scoped(query, 'user-1', orgId)
      expect(calls).toEqual([['user_id', 'user-1']])
    }
  })
})
