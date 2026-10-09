// netlify/functions/lib/subAccess.js
//
// Which contractor orgs a signed in sub may act in through the sub portal.
//
// The portal used to match fh_sub_profiles by email alone. This project
// confirms emails automatically at sign up, so an auth email proves nothing:
// anyone could register with a sub's address, read that sub's tax id,
// insurance and payment details at every contractor, and rewrite the payment
// handle the contractor pays to. A sub now reaches a vendor profile only in
// orgs where they accepted a job invite. The invite token is emailed to the
// invited address and partner-invite-accept checks the email matches, so an
// accepted invite proves the caller controls that address for that org.
//
// The database mirrors this rule in public.fh_sub_profile_ids_for_caller()
// (migration 065), which the sub-docs storage policies use.

const MAX_PARTNER_ROWS = 500

function uniq(values) {
  return Array.from(new Set(values.filter(Boolean)))
}

/**
 * Org ids where the caller accepted a job invite.
 * Returns { orgIds } or { error }.
 */
export async function boundSubOrgIds(admin, userId) {
  const { data: partners, error: partnerErr } = await admin
    .from('fh_job_partners')
    .select('job_id')
    .eq('partner_user_id', userId)
    .eq('status', 'accepted')
    .limit(MAX_PARTNER_ROWS)
  if (partnerErr) return { error: partnerErr }

  const jobIds = uniq((partners || []).map((p) => p.job_id))
  if (jobIds.length === 0) return { orgIds: [] }

  const { data: jobs, error: jobErr } = await admin
    .from('fh_contacts')
    .select('org_id')
    .in('id', jobIds)
  if (jobErr) return { error: jobErr }

  return { orgIds: uniq((jobs || []).map((j) => j.org_id)) }
}

/** Lowercased, trimmed email, or '' when missing. */
export function normalizeEmail(email) {
  return String(email || '').trim().toLowerCase()
}

// Fields a sub may edit on their vendor profile. Name, company and email stay
// under each contractor's control, document paths change only through
// /api/sub-doc-confirm, and the contractor's private notes are never exposed.
export const SUB_EDITABLE_FIELDS = [
  'phone', 'address', 'ein', 'trades',
  'insurance_carrier', 'insurance_policy', 'insurance_expires_on',
  'license_number',
  'payment_handle', 'payment_method',
]

const MAX_TEXT = 300
const MAX_TRADES = 30

/**
 * Validate and normalize a sub portal profile patch.
 * Returns { patch } or { error, detail }.
 */
export function sanitizeSubProfilePatch(fields) {
  if (!fields || typeof fields !== 'object' || Array.isArray(fields)) {
    return { error: 'missing_fields', detail: 'Send the fields to update.' }
  }
  const patch = {}
  for (const key of SUB_EDITABLE_FIELDS) {
    if (!Object.prototype.hasOwnProperty.call(fields, key)) continue
    let v = fields[key]
    if (key === 'trades') {
      if (v === null) { patch.trades = null; continue }
      if (!Array.isArray(v)) return { error: 'invalid_trades', detail: 'Trades must be a list.' }
      patch.trades = v
        .filter((x) => typeof x === 'string')
        .map((x) => x.trim().slice(0, 60))
        .filter(Boolean)
        .slice(0, MAX_TRADES)
      continue
    }
    if (v !== null && typeof v !== 'string') {
      return { error: 'invalid_field', detail: `${key} must be text.` }
    }
    if (typeof v === 'string') v = v.trim()
    if (v === '') v = null
    if (v !== null && v.length > MAX_TEXT) {
      return { error: 'invalid_field', detail: `${key} is too long.` }
    }
    if (key === 'insurance_expires_on' && v !== null) {
      const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(v)
      const d = m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null
      if (!d || !Number.isFinite(d.getTime()) || d.getUTCDate() !== Number(m[3])) {
        return { error: 'invalid_expires', detail: 'Insurance expiry must be a valid date.' }
      }
      v = `${m[1]}-${m[2]}-${m[3]}`
    }
    patch[key] = v
  }
  if (Object.keys(patch).length === 0) {
    return { error: 'no_writable_fields', detail: 'Nothing to update.' }
  }
  return { patch }
}

// Matches the sub-docs bucket allowlist set in migration 063.
export const SUB_DOC_TYPES = {
  'application/pdf': 'pdf',
  'image/jpeg': 'jpg',
  'image/png': 'png',
}
