// netlify/functions/lib/orgAccess.js
//
// Shared tenant check for the authenticated send-* functions
// (send-quote, send-invoice, send-certificate, send-statement,
// send-message, docusign-send, partner-invite).
//
// Before the 2026-10-09 audit every one of them looked the row up with
// .eq('user_id', caller), so in a company with more than one person only
// the row's creator could send anything; an admin or manager opening a job
// a teammate created got 403 forbidden_or_not_found on every send.
//
// Rule: the caller may act on a row when they created it, or when they are
// an active owner, admin or manager of the row's org (the same roles that
// src/lib/permissions.ts allows to create financial documents and talk to
// clients). Crew and foreman members are refused, matching the money table
// policies in migration 064.

export const SENDER_ROLES = ['owner', 'admin', 'manager']

/**
 * Pure decision used by loadAccessibleRow; exported for unit tests.
 * row: { user_id, org_id }, membership: { role } | null
 */
export function canActOnRow(row, callerId, membership, roles = SENDER_ROLES) {
  if (!row || !callerId) return false
  if (row.user_id && row.user_id === callerId) return true
  if (!row.org_id || !membership) return false
  return roles.includes(String(membership.role || ''))
}

/**
 * Load one row by id with the service role client and decide whether the
 * caller may act on it. `select` must not include user_id or org_id; they
 * are always added.
 *
 * Returns { row } on success or { error: 'forbidden_or_not_found' }.
 */
export async function loadAccessibleRow(supabase, { table, id, callerId, select, roles = SENDER_ROLES }) {
  const columns = Array.from(new Set(['id', 'user_id', 'org_id', ...String(select || '').split(',').map((s) => s.trim()).filter(Boolean)])).join(', ')
  const { data: row, error } = await supabase
    .from(table)
    .select(columns)
    .eq('id', id)
    .maybeSingle()
  if (error) {
    console.error(`[orgAccess] ${table} lookup failed`, error)
    return { error: 'lookup_failed' }
  }
  if (!row) return { error: 'forbidden_or_not_found' }
  if (row.user_id === callerId) return { row }
  if (!row.org_id) return { error: 'forbidden_or_not_found' }
  const { data: membership } = await supabase
    .from('org_members')
    .select('role')
    .eq('org_id', row.org_id)
    .eq('user_id', callerId)
    .is('revoked_at', null)
    .maybeSingle()
  return canActOnRow(row, callerId, membership, roles) ? { row } : { error: 'forbidden_or_not_found' }
}

/**
 * Whose profile supplies the company name, logo, reply-to and pay link for
 * an outgoing document: the earliest active owner of the row's org, falling
 * back to the row's creator. Documents then carry the company's branding no
 * matter which teammate pressed Send.
 */
export async function brandingUserIdFor(supabase, row) {
  if (row?.org_id) {
    const { data: owner } = await supabase
      .from('org_members')
      .select('user_id')
      .eq('org_id', row.org_id)
      .eq('role', 'owner')
      .is('revoked_at', null)
      .order('joined_at', { ascending: true })
      .limit(1)
      .maybeSingle()
    if (owner?.user_id) return owner.user_id
  }
  return row?.user_id || null
}
