import { describe, expect, it } from 'vitest'
import { shouldPersistMutation, shouldPersistQuery } from './queryPersistence.ts'

// What the offline cache in main.tsx saves to IndexedDB. Settled reads are
// kept so a cold open with no signal still has jobs and the schedule. The
// Inbox is never saved: a thread or a draft read back from yesterday's
// cache could be sent from, and a send that waited in the cache could go
// out long after the tap.

function query(queryKey: readonly unknown[], status: 'success' | 'error' | 'pending' = 'success') {
  return { queryKey, state: { status } }
}

function mutation(mutationKey: readonly unknown[] | undefined, isPaused: boolean) {
  return { options: { mutationKey }, state: { isPaused } }
}

describe('shouldPersistQuery', () => {
  it('keeps settled reads', () => {
    expect(shouldPersistQuery(query(['jobs', 'org-1']))).toBe(true)
    expect(shouldPersistQuery(query(['schedule', 'org-1', '2026-10-10']))).toBe(true)
  })

  it('skips reads that have not settled, and per keystroke searches', () => {
    expect(shouldPersistQuery(query(['jobs', 'org-1'], 'error'))).toBe(false)
    expect(shouldPersistQuery(query(['jobs', 'org-1'], 'pending'))).toBe(false)
    expect(shouldPersistQuery(query(['jobSearch', 'smith']))).toBe(false)
  })

  it('never saves anything under the inbox key', () => {
    expect(shouldPersistQuery(query(['inbox', 'list', 'user-1', 'org-1']))).toBe(false)
    expect(shouldPersistQuery(query(['inbox', 'thread', 'org-1', 'conv-1', 'messages']))).toBe(false)
    expect(shouldPersistQuery(query(['inbox', 'thread', 'org-1', 'conv-1', 'runs']))).toBe(false)
    expect(shouldPersistQuery(query(['inbox', 'thread', 'org-1', 'conv-1', 'conversation']))).toBe(false)
  })

  it('keeps the messaging switch, which lives outside the inbox key', () => {
    expect(shouldPersistQuery(query(['inboxEngine', 'org-1']))).toBe(true)
  })
})

describe('shouldPersistMutation', () => {
  it('keeps a paused write from other screens, as before', () => {
    expect(shouldPersistMutation(mutation(['notes', 'add'], true))).toBe(true)
    expect(shouldPersistMutation(mutation(undefined, true))).toBe(true)
  })

  it('does not save a write that is not waiting', () => {
    expect(shouldPersistMutation(mutation(['notes', 'add'], false))).toBe(false)
  })

  it('never saves an Inbox write, even a paused one, so it can never resume later', () => {
    for (const name of ['send', 'markRead', 'approve', 'reject']) {
      expect(shouldPersistMutation(mutation(['inbox', name], true))).toBe(false)
      expect(shouldPersistMutation(mutation(['inbox', name], false))).toBe(false)
    }
  })
})
