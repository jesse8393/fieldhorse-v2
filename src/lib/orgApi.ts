// orgApi — typed client wrappers for the /api/org-* Netlify functions.
//
// All four endpoints accept POST + JSON body. Authenticated endpoints
// pull the supabase session at call time so the JWT is fresh after
// long idle.

import { supabase } from './supabase.ts'
import type { OrgRole } from './permissions.ts'

export type OrgInviteInfo = {
  email: string
  role: OrgRole
  expires_at: string | null
  accepted: boolean
  expired: boolean
  org_id: string
  org_name: string | null
  inviter_name: string | null
}

export type OrgMember = {
  id: string
  user_id: string
  role: OrgRole
  joined_at: string
  invited_by: string | null
  is_self: boolean
  name: string | null
  company_name: string | null
  email: string | null
}

export type OrgInvitePending = {
  id: string
  email: string
  role: OrgRole
  expires_at: string | null
  accepted_at: string | null
  created_at: string
  invited_by: string | null
}

export type OrgMembersListResponse = {
  caller_role: OrgRole
  org_id: string
  members: OrgMember[]
  invites: OrgInvitePending[]
}

async function authHeader(): Promise<Record<string, string>> {
  const { data } = await supabase.auth.getSession()
  const token = data.session?.access_token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

async function callJson<T>(path: string, body: any, opts: { auth?: boolean } = { auth: true }): Promise<T> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  if (opts.auth !== false) {
    Object.assign(headers, await authHeader())
  }
  const res = await fetch(path, {
    method: 'POST',
    headers,
    body: JSON.stringify(body || {}),
  })
  const text = await res.text()
  let parsed: any
  try { parsed = text ? JSON.parse(text) : {} } catch { parsed = {} }
  if (!res.ok) {
    const err = new Error(parsed?.error || `http_${res.status}`)
    ;(err as any).status = res.status
    ;(err as any).detail = parsed?.detail || parsed?.message || null
    throw err
  }
  return parsed as T
}

// ────────────────────────────────────────────────────────────
// public — no auth required
// ────────────────────────────────────────────────────────────

export function orgInviteInfo(token: string): Promise<{ ok: true; invite: OrgInviteInfo }> {
  return callJson('/api/org-invite-info', { token }, { auth: false })
}

// ────────────────────────────────────────────────────────────
// authenticated
// ────────────────────────────────────────────────────────────

export function orgInviteAccept(
  token: string,
): Promise<{ ok: true; org_id: string; role: OrgRole; already_member?: boolean }> {
  return callJson('/api/org-invite-accept', { token })
}

export function orgMembersList(): Promise<{ ok: true } & OrgMembersListResponse> {
  return callJson('/api/org-members-list', {})
}

export function orgInviteCreate(
  email: string,
  role: OrgRole,
): Promise<{ ok: true; id: string; token: string; accept_url: string; expires_at: string | null }> {
  return callJson('/api/org-invite-create', { email, role })
}

export function orgInviteRevoke(inviteId: string): Promise<{ ok: true }> {
  return callJson('/api/org-invite-revoke', { invite_id: inviteId })
}

// ────────────────────────────────────────────────────────────
// Timesheets
// ────────────────────────────────────────────────────────────

export type PendingPunch = {
  id: string
  user_id: string
  user_name: string | null
  user_email: string | null
  contact_id: string | null
  contact_name: string | null
  punch_in_at: string
  punch_out_at: string
  minutes: number
  hourly_rate: number | null
  cost: number | null
  break_minutes: number
  notes: string | null
  flagged: boolean
  flag_reason: string | null
}

export function orgTimesheetsList(
  opts: { from?: string; to?: string } = {},
): Promise<{ ok: true; caller_role: OrgRole; org_id: string; punches: PendingPunch[] }> {
  return callJson('/api/org-timesheets-list', opts)
}

export function orgPunchApprove(
  punchIds: string[],
): Promise<{ ok: true; approved_count: number; approved_ids: string[] }> {
  return callJson('/api/org-punch-approve', { punch_ids: punchIds })
}
