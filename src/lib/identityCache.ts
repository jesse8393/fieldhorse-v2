// The signed in person's last profile row and workspace (membership)
// read, kept on this device so a repeat open renders at once and the
// reads revalidate in the background instead of holding the whole app
// on a network round trip.
//
// One person at a time: saving for one user drops whatever was saved for
// any other, and sign out or an account change clears the prefix with
// the other per user keys (contexts/AuthContext.tsx, clearUserStorage).

export const IDENTITY_CACHE_PREFIX = 'fh:identity:'

export type IdentityKind = 'profile' | 'membership'

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

function keyFor(kind: IdentityKind, userId: string) {
  return `${IDENTITY_CACHE_PREFIX}${kind}:${userId}`
}

/** What was saved for this person, or null when nothing (usable) was. */
export function readSavedIdentity<T>(kind: IdentityKind, userId: string): T | null {
  try {
    const raw = storage()?.getItem(keyFor(kind, userId))
    if (!raw) return null
    const parsed = JSON.parse(raw) as { userId?: unknown; value?: T }
    return parsed && parsed.userId === userId && parsed.value != null ? parsed.value : null
  } catch {
    return null
  }
}

/** Save (or with null, forget) this person's copy, dropping anyone else's. */
export function saveIdentity<T>(kind: IdentityKind, userId: string, value: T | null) {
  try {
    const s = storage()
    if (!s) return
    const own = `:${userId}`
    const others: string[] = []
    for (let i = 0; i < s.length; i++) {
      const key = s.key(i)
      if (key && key.startsWith(IDENTITY_CACHE_PREFIX) && !key.endsWith(own)) others.push(key)
    }
    for (const key of others) s.removeItem(key)
    if (value == null) s.removeItem(keyFor(kind, userId))
    else s.setItem(keyFor(kind, userId), JSON.stringify({ userId, value }))
  } catch { /* storage blocked or full: the next open reads from the server */ }
}
