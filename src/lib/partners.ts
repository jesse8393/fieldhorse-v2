// src/lib/partners.ts
//
// Partner-roster helpers for the InvitePartnerSheet "past partners"
// suggestion strip. RLS scopes fh_job_partners to the caller's company,
// but it ALSO returns the rows where the caller is the invited partner
// on another contractor's job (fh_job_partners_partner_read). Those are
// not part of the caller's roster, so the loaders drop them (see
// withoutOwnPartnerRows); otherwise we just dedupe by email and prefer
// the most recent name/role for each partner.

import { supabase } from './supabase.ts'

async function signedInUserId(): Promise<string | null> {
  const { data } = await supabase.auth.getSession()
  return data.session?.user?.id ?? null
}

// Leave out rows where the signed in user is the partner. A pending invite
// has no partner_user_id yet, so a plain neq would drop every one of them.
function withoutOwnPartnerRows<Q extends { or(filters: string): Q }>(query: Q, uid: string | null): Q {
  return uid ? query.or(`partner_user_id.is.null,partner_user_id.neq.${uid}`) : query
}

export const PARTNER_ROLES = ['Foreman', 'Sub', 'Estimator', 'Other']

export type PartnerJob = {
  partnerId: string
  id: string | null
  name: string | null
  jobTitle: string | null
  stage: string | null
  status: string
  role: string | null
}

export type PartnerEntry = {
  email: string
  name: string
  role: string
  status: string
  lastInvitedAt: string | null
  jobs: PartnerJob[]
}

export type PastPartner = {
  email: string
  name: string
  role: string
  status: string
  lastInvitedAt: string | null
  jobCount: number
}

// Row shape from the embedded-join select below. The joined fh_contacts
// is a single related row (or null) under the FK alias.
type PartnerDirectoryRow = {
  id: string
  partner_email: string | null
  partner_name: string | null
  partner_role: string | null
  status: string | null
  invited_at: string | null
  accepted_at: string | null
  job_id: string | null
  fh_contacts: { id: string; name: string | null; job_title: string | null; stage: string | null } | null
}

// Full partner roster across every job the operator owns. Groups by
// normalized email so a single person who's on three jobs shows as
// one row with three job links. Used by the Partners directory screen.
//
// Each entry shape:
//   {
//     email,
//     name, role,             // best-known identity across rows
//     status,                 // "worst" status across jobs (pending > accepted > revoked > declined)
//     lastInvitedAt,          // ISO
//     jobs: [{ id, name, jobTitle, stage, status, role, partnerId }]
//   }
//
// Pulls every row tied to invited_by_user_id (RLS enforces tenant
// isolation). Joins fh_contacts inline for job name + stage.
export async function loadPartnerDirectory({ includeRevoked = true, limitRows = 500 }: { includeRevoked?: boolean; limitRows?: number } = {}): Promise<PartnerEntry[]> {
  const sel = [
    'id', 'partner_email', 'partner_name', 'partner_role',
    'status', 'invited_at', 'accepted_at', 'job_id',
    'fh_contacts!fh_job_partners_job_id_fkey ( id, name, job_title, stage )'
  ].join(', ')

  const uid = await signedInUserId()
  const { data, error } = await withoutOwnPartnerRows(supabase
    .from('fh_job_partners')
    .select(sel), uid)
    .order('invited_at', { ascending: false })
    .limit(limitRows)

  if (error || !Array.isArray(data)) return []

  const rows = data as unknown as PartnerDirectoryRow[]
  const byEmail = new Map<string, PartnerEntry>()
  for (const row of rows) {
    if (!row?.partner_email) continue
    if (!includeRevoked && row.status === 'revoked') continue
    const email = String(row.partner_email).toLowerCase()
    const jobEntry = {
      partnerId: row.id,
      id: row.job_id,
      name: row.fh_contacts?.name || null,
      jobTitle: row.fh_contacts?.job_title || null,
      stage: row.fh_contacts?.stage || null,
      status: row.status || 'pending',
      role: row.partner_role || null
    }
    if (!byEmail.has(email)) {
      byEmail.set(email, {
        email,
        name: row.partner_name || '',
        role: row.partner_role || '',
        status: row.status || 'pending',
        lastInvitedAt: row.invited_at || null,
        jobs: [jobEntry]
      })
    } else {
      const e = byEmail.get(email)!
      e.jobs.push(jobEntry)
      if (!e.name && row.partner_name) e.name = row.partner_name
      if (!e.role && row.partner_role) e.role = row.partner_role
      // Roll status up: prefer accepted, then pending, then revoked, then declined.
      e.status = rollupStatus(e.status, row.status)
      if (row.invited_at && (!e.lastInvitedAt || new Date(row.invited_at) > new Date(e.lastInvitedAt))) {
        e.lastInvitedAt = row.invited_at
      }
    }
  }
  return Array.from(byEmail.values())
    .sort((a, b) => new Date(b.lastInvitedAt || 0).getTime() - new Date(a.lastInvitedAt || 0).getTime())
}

function rollupStatus(a: string, b: string | null | undefined) {
  const rank: Record<string, number> = { accepted: 4, pending: 3, revoked: 2, declined: 1 }
  return (rank[b || ''] || 0) > (rank[a] || 0) ? (b as string) : a
}

// Flip a single partner row to status='revoked'. RLS keeps cross-tenant
// updates from succeeding, and it does so silently (zero rows, no error),
// so an empty result is a failure, not "Access revoked".
export async function revokePartnerRow(partnerId: string | undefined) {
  if (!partnerId) throw new Error('revokePartnerRow: partnerId required')
  const { data, error } = await supabase
    .from('fh_job_partners')
    .update({ status: 'revoked' })
    .eq('id', partnerId)
    .select('id')
  if (error) throw error
  if (!data?.length) throw new Error("That invite isn't on one of your jobs anymore. Refresh and try again.")
}

// Returns at most `limit` distinct past partners (by email), newest-first.
// Each entry: { email, name, role, lastInvitedAt, status, jobCount }.
export async function loadPastPartners({ excludeJobId = null, limit = 8 }: { excludeJobId?: string | null; limit?: number } = {}): Promise<PastPartner[]> {
  const uid = await signedInUserId()
  const { data, error } = await withoutOwnPartnerRows(supabase
    .from('fh_job_partners')
    .select('partner_email, partner_name, partner_role, status, invited_at, accepted_at, job_id'), uid)
    .order('accepted_at', { ascending: false, nullsFirst: false })
    .order('invited_at', { ascending: false })
    .limit(200)

  if (error || !Array.isArray(data)) return []

  const byEmail = new Map<string, PastPartner>()
  for (const row of data) {
    if (!row?.partner_email) continue
    if (excludeJobId && row.job_id === excludeJobId) continue
    const email = String(row.partner_email).toLowerCase()
    const prev = byEmail.get(email)
    if (!prev) {
      byEmail.set(email, {
        email,
        name: row.partner_name || '',
        role: row.partner_role || '',
        status: row.status || 'pending',
        lastInvitedAt: row.accepted_at || row.invited_at || null,
        jobCount: 1
      })
    } else {
      prev.jobCount += 1
      if (!prev.name && row.partner_name) prev.name = row.partner_name
      if (!prev.role && row.partner_role) prev.role = row.partner_role
    }
  }
  return Array.from(byEmail.values()).slice(0, limit)
}
