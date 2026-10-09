// netlify/functions/lib/punches.js
//
// Time punch rules shared by org-timesheets-list (which marks punches
// invalid) and org-punch-approve (which refuses to approve them), so the
// list and the approval can never disagree.

/**
 * Net worked minutes for a clocked out punch: wall clock time minus the
 * unpaid break, never below zero. Zero means the shift is not a valid
 * payroll row (out at or before in, or a break as long as the shift).
 */
export function netPunchMinutes(punch) {
  const inMs = new Date(punch?.punch_in_at || NaN).getTime()
  const outMs = new Date(punch?.punch_out_at || NaN).getTime()
  if (!Number.isFinite(inMs) || !Number.isFinite(outMs)) return 0
  return Math.max(0, Math.round((outMs - inMs) / 60_000) - (Number(punch.break_minutes) || 0))
}

/**
 * Split the pending punches a caller asked to approve into the ones that
 * may be approved now and the ones to skip:
 *   invalidIds: zero length shifts
 *   selfIds:    the caller's own punches, unless the caller is an owner
 *               (an admin or manager needs someone else to sign off their
 *               own hours; an owner approving their own time is normal)
 */
export function partitionApprovablePunches(punches, { callerId, callerRole }) {
  const approvable = []
  const invalidIds = []
  const selfIds = []
  for (const punch of punches || []) {
    if (!punch?.id) continue
    if (netPunchMinutes(punch) <= 0) invalidIds.push(punch.id)
    else if (callerRole !== 'owner' && punch.user_id === callerId) selfIds.push(punch.id)
    else approvable.push(punch)
  }
  return { approvable, invalidIds, selfIds }
}
