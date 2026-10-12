// src/lib/queryPersistence.ts
//
// What the offline cache (PersistQueryClientProvider in main.tsx) saves to
// IndexedDB, so a cold open with no signal still shows jobs, leads and the
// schedule from the last sync.
//
// Two kinds of entry are never saved:
//   * per keystroke searches (['jobSearch', pattern]): one per pattern
//     typed, worthless offline, and they bloat the blob;
//   * everything under the 'inbox' key, reads and writes. A thread or a
//     draft read back from an old cache could be sent from as if it were
//     current, and an Inbox send saved while it waited for a signal could
//     go out long after the tap. Inbox writes also never wait for a signal
//     (networkMode 'always' in lib/inbox.ts), so there is nothing to resume.
// The messaging switch lives under its own key ('inboxEngine') and is kept,
// so an offline cold open still shows the Inbox in the dock.

type PersistableQuery = {
  queryKey: readonly unknown[]
  state: { status: string }
}

type PersistableMutation = {
  options: { mutationKey?: readonly unknown[] }
  state: { isPaused: boolean }
}

const NEVER_SAVED = new Set(['jobSearch', 'inbox'])

/** Save only settled, successful reads, and none of the Inbox's. */
export function shouldPersistQuery(query: PersistableQuery): boolean {
  return query.state.status === 'success' && !NEVER_SAVED.has(String(query.queryKey[0]))
}

/** TanStack's default (save a write that waits for a signal), minus every Inbox write. */
export function shouldPersistMutation(mutation: PersistableMutation): boolean {
  if (mutation.options.mutationKey?.[0] === 'inbox') return false
  return mutation.state.isPaused
}
