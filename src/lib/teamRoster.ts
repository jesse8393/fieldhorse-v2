import { supabase } from './supabase.ts'
import type { OrgMembersListResponse, OrgMember, OrgInvitePending } from './orgApi.ts'

/** A read-only recovery path using the existing RLS policies from migration 058.
 * Verify this caller can read the complete roster before querying it. Field
 * roles can only read themselves and must never see that as a whole team.
 * Names, emails and pay rates are intentionally absent: their privileged
 * endpoint is unavailable, and a browser must not gain that access by fallback.
 */
export async function loadLimitedTeamRoster(orgId: string, client = supabase, signal?: AbortSignal): Promise<{ ok: true } & OrgMembersListResponse> {
  const bounded = <T extends { abortSignal: (signal: AbortSignal) => T }>(query: T): T => signal ? query.abortSignal(signal) : query
  const { data: sessionData } = await client.auth.getSession()
  const user = sessionData.session?.user
  if (!user?.id || !orgId) throw new Error('not_authenticated')
  const { data: caller, error: callerError } = await bounded(client.from('org_members')
    .select('org_id, user_id, role').eq('org_id', orgId).eq('user_id', user.id).is('revoked_at', null)).maybeSingle()
  if (callerError) throw callerError
  if (!caller || !['owner', 'admin', 'manager'].includes(caller.role)) throw new Error('roster_fallback_forbidden')
  const { data: canRead, error: permissionError } = await bounded(client.rpc('fh_can_read_org_members', { p_org_id: orgId }))
  if (permissionError || canRead !== true) throw permissionError || new Error('roster_fallback_forbidden')

  const members: OrgMember[] = []
  for (let offset = 0; ; offset += 1000) {
    const { data, error } = await bounded(client.from('org_members')
      .select('id, user_id, role, joined_at, invited_by')
      .eq('org_id', orgId).is('revoked_at', null).order('joined_at').order('id').range(offset, offset + 999))
    if (error) throw error
    for (const row of data || []) members.push({
      ...row,
      is_self: row.user_id === user.id,
      name: row.user_id === user.id ? 'You' : `Team member ${row.user_id.slice(0, 8)}`,
      company_name: null,
      email: null,
      default_hourly_rate: null,
    })
    if ((data || []).length < 1000) break
  }
  let invites: OrgInvitePending[] = []
  let invitesAvailable = false
  if (caller.role === 'owner' || caller.role === 'admin') {
    // Invite RLS permits owner/admin reads. A failure stays unknown, never zero.
    invitesAvailable = true
    for (let offset = 0; ; offset += 1000) {
      const { data, error } = await bounded(client.from('org_invites')
        .select('id, email, role, expires_at, accepted_at, created_at, invited_by')
        .eq('org_id', orgId).is('accepted_at', null).gt('expires_at', new Date().toISOString())
        .order('created_at', { ascending: false }).order('id').range(offset, offset + 999))
      if (error) { invitesAvailable = false; invites = []; break }
      invites.push(...(data || []))
      if ((data || []).length < 1000) break
    }
  }
  return { ok: true, org_id: orgId, caller_role: caller.role, members, invites, read_only: true, invites_available: invitesAvailable }
}
