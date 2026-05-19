// src/lib/partners.js
//
// Partner-roster helpers for the InvitePartnerSheet "past partners"
// suggestion strip. RLS already scopes fh_job_partners to the inviter,
// so the query needs no extra owner filter — we just dedupe by email
// and prefer the most recent name/role for each partner.

import { supabase } from './supabase.js'

export const PARTNER_ROLES = ['Foreman', 'Sub', 'Estimator', 'Other']

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
export async function loadPartnerDirectory({ includeRevoked = true, limitRows = 500 } = {}) {
  const sel = [
    'id', 'partner_email', 'partner_name', 'partner_role',
    'status', 'invited_at', 'accepted_at', 'job_id',
    'fh_contacts!fh_job_partners_job_id_fkey ( id, name, job_title, stage )'
  ].join(', ')

  const { data, error } = await supabase
    .from('fh_job_partners')
    .select(sel)
    .order('invited_at', { ascending: false })
    .limit(limitRows)

  if (error || !Array.isArray(data)) return []

  const byEmail = new Map()
  for (const row of data) {
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
      const e = byEmail.get(email)
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
    .sort((a, b) => new Date(b.lastInvitedAt || 0) - new Date(a.lastInvitedAt || 0))
}

function rollupStatus(a, b) {
  const rank = { accepted: 4, pending: 3, revoked: 2, declined: 1 }
  return (rank[b] || 0) > (rank[a] || 0) ? b : a
}

// Flip a single partner row to status='revoked'. RLS keeps cross-tenant
// updates from succeeding; we still scope by partnerId only because the
// caller already proved ownership by being signed in.
export async function revokePartnerRow(partnerId) {
  if (!partnerId) throw new Error('revokePartnerRow: partnerId required')
  const { error } = await supabase
    .from('fh_job_partners')
    .update({ status: 'revoked' })
    .eq('id', partnerId)
  if (error) throw error
}

// Returns at most `limit` distinct past partners (by email), newest-first.
// Each entry: { email, name, role, lastInvitedAt, status, jobCount }.
export async function loadPastPartners({ excludeJobId = null, limit = 8 } = {}) {
  const { data, error } = await supabase
    .from('fh_job_partners')
    .select('partner_email, partner_name, partner_role, status, invited_at, accepted_at, job_id')
    .order('accepted_at', { ascending: false, nullsFirst: false })
    .order('invited_at', { ascending: false })
    .limit(200)

  if (error || !Array.isArray(data)) return []

  const byEmail = new Map()
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
