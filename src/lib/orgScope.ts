// src/lib/orgScope.ts
//
// Which tenant the data hooks read. Members of an org share one book, so
// list and rollup queries filter by org_id once the membership is known;
// a user with no org keeps the legacy user_id filter. RLS is org scoped,
// so this is the same set of rows the database already lets them see.
//
// The resolved org id is also remembered per user (memory plus
// localStorage) and reused while MembershipContext is still loading or
// when its fetch failed:
//   1. a cold open renders the persisted query cache, which is stored
//      under the org scoped key, right away instead of waiting on the
//      membership round trips;
//   2. an offline cold open, where the membership fetch fails, still
//      finds that cache instead of falling back to a user scoped key
//      with nothing in it.
// Until a first successful resolution there is nothing to reuse, so the
// scope stays undefined and hooks keep their queries disabled. That is
// what stops a user scoped fetch from firing before the org scoped one.

import { useEffect } from 'react'
import { useMembership } from '../contexts/MembershipContext.tsx'

/**
 * string: filter by org_id. null: no org, filter by user_id.
 * undefined: not known yet, keep the query disabled.
 */
export type OrgScope = string | null | undefined

export type MembershipSnapshot = {
  loading: boolean
  error: string | null
  orgId: string | null
}

const STORAGE_PREFIX = 'fh:orgScope:'
const remembered = new Map<string, string | null>()

function storage(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage
  } catch {
    return null
  }
}

/** The org this user last resolved to on this device, if any. */
export function lastKnownOrg(userId: string): string | undefined {
  if (!remembered.has(userId)) {
    let stored: string | null = null
    try { stored = storage()?.getItem(STORAGE_PREFIX + userId) ?? null } catch { /* blocked */ }
    remembered.set(userId, stored || null)
  }
  return remembered.get(userId) ?? undefined
}

/** Record a settled membership: an org id is kept, null forgets it. */
export function rememberOrg(userId: string, orgId: string | null) {
  if ((lastKnownOrg(userId) ?? null) === (orgId || null)) return
  remembered.set(userId, orgId || null)
  try {
    const s = storage()
    if (orgId) s?.setItem(STORAGE_PREFIX + userId, orgId)
    else s?.removeItem(STORAGE_PREFIX + userId)
  } catch { /* storage blocked: the in memory value still applies */ }
}

/**
 * Pure scope decision.
 *   loading                -> the last known org (undefined if none yet)
 *   fetch failed, no org   -> the last known org, else the user scope
 *   settled                -> the membership's org (null when none)
 */
export function resolveOrgScope(m: MembershipSnapshot, lastKnown: string | undefined): OrgScope {
  if (m.loading) return lastKnown
  if (m.error && !m.orgId) return lastKnown ?? null
  return m.orgId
}

/** True when the snapshot is a real answer worth remembering. */
export function isSettledMembership(m: MembershipSnapshot): boolean {
  return !m.loading && (m.orgId !== null || !m.error)
}

/**
 * The tenant scope a data hook should query with. Include the result in
 * the query key and gate `enabled` on `scope !== undefined`.
 */
export function useOrgScope(userId: string | undefined): OrgScope {
  const { loading, error, orgId } = useMembership()
  const settled = isSettledMembership({ loading, error, orgId })
  useEffect(() => {
    if (userId && settled) rememberOrg(userId, orgId)
  }, [userId, settled, orgId])
  if (!userId) return undefined
  return resolveOrgScope({ loading, error, orgId }, lastKnownOrg(userId))
}
