// netlify/functions/lib/membership.js
//
// Which org membership an org-* function acts on.
//
// Before the 2026-10-09 audit every org-* function took the caller's most
// recently joined membership. An owner of company A who accepted an invite
// to help company B then had every Team and Timesheets call land in B:
// their own roster disappeared, invites failed with insufficient_role, and
// a mutation sent while the screen showed A would have changed B.
//
// Rule now:
//   * The app sends org_id for the workspace on screen. The caller must
//     hold an active membership in exactly that org, else 403.
//   * Clients that send no org_id (older builds, the mobile app) get the
//     caller's owner membership when they have one, else the newest.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * org_id from a JSON body. Absent or empty gives { orgId: null }; anything
 * that is not a uuid string gives { invalid: true }.
 */
export function parseOrgId(body) {
  const raw = body?.org_id
  if (raw === undefined || raw === null || raw === '') return { orgId: null, invalid: false }
  if (typeof raw !== 'string' || !UUID_RE.test(raw.trim())) return { orgId: null, invalid: true }
  return { orgId: raw.trim().toLowerCase(), invalid: false }
}

/**
 * Default membership when the request names no org: an owner membership
 * first, then the most recently joined. `rows` are active memberships.
 */
export function pickDefaultMembership(rows) {
  const joinedMs = (m) => {
    const t = new Date(m?.joined_at || 0).getTime()
    return Number.isFinite(t) ? t : 0
  }
  const newestFirst = (rows || []).filter(Boolean).sort((a, b) => joinedMs(b) - joinedMs(a))
  return newestFirst.find((m) => m.role === 'owner') || newestFirst[0] || null
}

/**
 * Resolve the caller's active membership for this request with the service
 * role client. Returns { membership: { org_id, role, joined_at } } or
 * { status, error, message } for the caller to send back as is. Database
 * errors are logged here and never reach the client.
 */
export async function resolveCallerMembership(admin, userId, body) {
  const { orgId, invalid } = parseOrgId(body)
  if (invalid) {
    return { status: 400, error: 'invalid_org_id', message: 'That workspace could not be found.' }
  }

  let query = admin
    .from('org_members')
    .select('org_id, role, joined_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
  if (orgId) query = query.eq('org_id', orgId)
  const { data, error } = await query.order('joined_at', { ascending: false }).limit(50)

  if (error) {
    console.error('[membership] lookup failed', error)
    return { status: 500, error: 'membership_lookup_failed', message: 'Could not load your membership. Try again shortly.' }
  }
  const membership = orgId ? (data || [])[0] || null : pickDefaultMembership(data)
  if (!membership) {
    return {
      status: 403,
      error: 'no_membership',
      message: orgId ? 'You are not an active member of this workspace.' : 'You are not a member of a workspace yet.'
    }
  }
  return { membership }
}
