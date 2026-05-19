// src/lib/partners.js
//
// Partner-roster helpers for the InvitePartnerSheet "past partners"
// suggestion strip. RLS already scopes fh_job_partners to the inviter,
// so the query needs no extra owner filter — we just dedupe by email
// and prefer the most recent name/role for each partner.

import { supabase } from './supabase.js'

export const PARTNER_ROLES = ['Foreman', 'Sub', 'Estimator', 'Other']

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
