import { describe, expect, it } from 'vitest'
import { QueryClient } from '@tanstack/react-query'
import {
  activityKey,
  addBookedJob,
  analyticsKey,
  bookedKey,
  clientDetailKey,
  clientsKey,
  dropScheduleEvent,
  ensureBookedJob,
  invoicesKey,
  noteContactsKey,
  notesKey,
  removeBookedJob,
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
    expect(bookedKey('user-1', 'org-1', 'a')).toEqual(['scheduleBooked', 'user-1', 'org-1', 'a'])
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
    // The booked list holds job ids, not visits, so it lives beside the
    // visit caches, never under their prefix, where a patch by visit id
    // would reach it.
    expect(bookedKey('user-1', 'org-1', 'a')[0]).toBe('scheduleBooked')
  })
})

describe('dropScheduleEvent', () => {
  const range = scheduleKey('user-1', 'org-1', 'a', 'b')
  const upcoming = upcomingKey('user-1', 'org-1')
  const booked = bookedKey('user-1', 'org-1', 'a')

  it('drops the visit by id from the range and upcoming caches, and sends the booked list back to the server', () => {
    const client = new QueryClient()
    client.setQueryData(range, [{ id: 'e1' }, { id: 'e2' }])
    client.setQueryData(upcoming, [{ id: 'e1' }])
    client.setQueryData(booked, [{ contact_id: 'c-1' }])
    dropScheduleEvent(client, 'e1')
    expect(client.getQueryData(range)).toEqual([{ id: 'e2' }])
    expect(client.getQueryData(upcoming)).toEqual([])
    expect(client.getQueryState(range)?.isInvalidated).toBe(false)
    // A booked row carries no visit id, so the list cannot be patched: it
    // is kept as is and marked for a refetch, so the job of a visit that
    // was its only one from today on comes back to the tray.
    expect(client.getQueryData(booked)).toEqual([{ contact_id: 'c-1' }])
    expect(client.getQueryState(booked)?.isInvalidated).toBe(true)
  })

  it('leaves a schedule query that has not loaded yet alone, never marking it loaded with no visits', () => {
    const client = new QueryClient()
    client.getQueryCache().build(client, { queryKey: range })
    client.getQueryCache().build(client, { queryKey: booked })
    dropScheduleEvent(client, 'e1')
    expect(client.getQueryData(range)).toBeUndefined()
    expect(client.getQueryState(range)?.status).toBe('pending')
    expect(client.getQueryData(booked)).toBeUndefined()
    expect(client.getQueryState(booked)?.status).toBe('pending')
  })
})

describe('the booked list while a drop saves', () => {
  const booked = bookedKey('user-1', 'org-1', 'a')

  it('rolls a failed drop back by value, so one rollback never strands another drop\'s row', () => {
    // TanStack rebuilds equal rows on every write (structural sharing), so
    // a row kept by identity is lost the moment a row ahead of it goes.
    const client = new QueryClient()
    client.setQueryData(booked, [{ contact_id: 'server-1' }])
    client.setQueryData(booked, addBookedJob('a'))
    client.setQueryData(booked, addBookedJob('b'))
    expect(client.getQueryData(booked)).toEqual([{ contact_id: 'server-1' }, { contact_id: 'a' }, { contact_id: 'b' }])
    client.setQueryData(booked, removeBookedJob('a'))
    expect(client.getQueryData(booked)).toEqual([{ contact_id: 'server-1' }, { contact_id: 'b' }])
    client.setQueryData(booked, removeBookedJob('b'))
    expect(client.getQueryData(booked)).toEqual([{ contact_id: 'server-1' }])
  })

  it('removes one row only, so a job the server booked meanwhile stays booked', () => {
    const client = new QueryClient()
    client.setQueryData(booked, [{ contact_id: 'a' }])
    client.setQueryData(booked, addBookedJob('a'))
    expect(client.getQueryData(booked)).toEqual([{ contact_id: 'a' }, { contact_id: 'a' }])
    client.setQueryData(booked, removeBookedJob('a'))
    expect(client.getQueryData(booked)).toEqual([{ contact_id: 'a' }])
    client.setQueryData(booked, removeBookedJob('never-added'))
    expect(client.getQueryData(booked)).toEqual([{ contact_id: 'a' }])
  })

  it('puts the row back after the write only when a reload wiped it', () => {
    const client = new QueryClient()
    client.setQueryData(booked, [{ contact_id: 'a' }])
    client.setQueryData(booked, ensureBookedJob('a'))
    expect(client.getQueryData(booked)).toEqual([{ contact_id: 'a' }])
    client.setQueryData(booked, [{ contact_id: 'server-1' }])
    client.setQueryData(booked, ensureBookedJob('a'))
    expect(client.getQueryData(booked)).toEqual([{ contact_id: 'server-1' }, { contact_id: 'a' }])
  })

  it('leaves a booked list that has not loaded yet alone, never marking it loaded', () => {
    const client = new QueryClient()
    client.getQueryCache().build(client, { queryKey: booked })
    client.setQueryData(booked, addBookedJob('a'))
    client.setQueryData(booked, ensureBookedJob('a'))
    client.setQueryData(booked, removeBookedJob('a'))
    expect(client.getQueryData(booked)).toBeUndefined()
    expect(client.getQueryState(booked)?.status).toBe('pending')
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
