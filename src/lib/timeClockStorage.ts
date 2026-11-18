// The time clock values kept on this device by TimeClockCard: the start of
// a running clock per job (fh:timeclock:<job>:start) and the person's
// hourly rate (fh:timeclock:hourlyRate). They belong to the person whose
// session was open when they were written, recorded in fh:timeclockOwner.
//
// A session that ends on its own keeps them, so the same person finds
// their rate and clock again after signing back in. Anyone else's session
// removes them before it is shown, and a Sign out the person chose clears
// them (AuthContext purgeLocalData), as lib/drafts.ts does for drafts.

export const TIMECLOCK_PREFIX = 'fh:timeclock:'
const OWNER_KEY = 'fh:timeclockOwner'

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null } catch { return null }
}

function removeAll(store: Storage) {
  const keys: string[] = []
  for (let i = 0; i < store.length; i++) {
    const key = store.key(i)
    if (key && key.startsWith(TIMECLOCK_PREFIX)) keys.push(key)
  }
  keys.push(OWNER_KEY)
  for (const key of keys) {
    try { store.removeItem(key) } catch { /* non-fatal */ }
  }
}

/**
 * A session was published. Values another person left are removed; values
 * kept before they had an owner are adopted by this person, since every
 * purge removed those until now. No session changes nothing.
 */
export function setTimeClockOwner(userId: string | null) {
  const store = storage()
  if (!userId || !store) return
  try {
    const owner = store.getItem(OWNER_KEY)
    if (owner && owner !== userId) removeAll(store)
    store.setItem(OWNER_KEY, userId)
  } catch { /* storage blocked: nothing was kept either */ }
}

/**
 * Removes the time clock values. keepOwned keeps those with an owner, for
 * a session that ended without the person choosing to sign out; values
 * with no owner go, since nobody can be sure whose they are.
 */
export function clearTimeClock({ keepOwned }: { keepOwned: boolean }) {
  const store = storage()
  if (!store) return
  try {
    if (keepOwned && store.getItem(OWNER_KEY)) return
    removeAll(store)
  } catch { /* storage blocked: nothing was kept either */ }
}
