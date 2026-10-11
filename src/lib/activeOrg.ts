// Which workspace (org) a signed in user is working in.
//
// A user can hold active memberships in several orgs, for example an
// owner who also accepted a crew invite from another construction company.
// The pick decides the role, the nav and the org that new rows are
// stamped with, so it has to be stable and predictable:
//   1. the workspace the user chose on this device, if they still
//      belong to it;
//   2. otherwise a workspace they own (their own business);
//   3. otherwise the most recently joined one.

import type { OrgRole } from './permissions.ts'

export const CURRENT_ORG_KEY = 'fh:currentOrgId'

export type MembershipChoice = {
  org_id: string
  role: OrgRole | string
  joined_at: string
}

function newestFirst<T extends MembershipChoice>(rows: T[]): T[] {
  return [...rows].sort((a, b) => (a.joined_at < b.joined_at ? 1 : a.joined_at > b.joined_at ? -1 : 0))
}

export function pickActiveMembership<T extends MembershipChoice>(
  rows: T[],
  preferredOrgId: string | null | undefined
): T | null {
  if (!rows.length) return null
  if (preferredOrgId) {
    const chosen = rows.find((r) => r.org_id === preferredOrgId)
    if (chosen) return chosen
  }
  const sorted = newestFirst(rows)
  return sorted.find((r) => r.role === 'owner') || sorted[0]
}

export function readStoredOrgId(): string | null {
  try {
    if (typeof window === 'undefined') return null
    return window.localStorage.getItem(CURRENT_ORG_KEY)
  } catch {
    return null
  }
}

export function writeStoredOrgId(orgId: string | null) {
  try {
    if (typeof window === 'undefined') return
    if (orgId) window.localStorage.setItem(CURRENT_ORG_KEY, orgId)
    else window.localStorage.removeItem(CURRENT_ORG_KEY)
  } catch { /* storage blocked: the in memory choice still applies */ }
}
