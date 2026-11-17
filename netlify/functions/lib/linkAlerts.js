// netlify/functions/lib/linkAlerts.js
//
// Who hears about a customer's action on a link (viewed, approved, signed,
// asked for changes), and the alert itself.
//
// Alerts used to go only to whoever made the link, by user id, even after
// that person was removed from the company, and three of them were written
// with no org_id, which the bell's read policy (org_id in my companies and
// user_id = me) matches for nobody. Now:
//   * the person who made the link hears while they are an active member,
//   * every active owner of the company hears too,
//   * each bell row carries the company's org_id.
// A link from before companies existed (no org_id) still alerts its maker.

import { sendPushToUser } from './push.js'

/**
 * The user ids to alert for a row owned by `orgId` and made by `creatorId`.
 * Never throws: a failed lookup falls back to no one rather than to a
 * person who may have left.
 */
export async function linkAlertRecipients(supabase, { orgId, creatorId }) {
  if (!orgId) return creatorId ? [creatorId] : []
  const { data, error } = await supabase
    .from('org_members')
    .select('user_id, role')
    .eq('org_id', orgId)
    .is('revoked_at', null)
  if (error) {
    console.error('[linkAlerts] membership lookup failed', error)
    return []
  }
  const out = []
  for (const m of data || []) {
    if (!m?.user_id || out.includes(m.user_id)) continue
    if (m.user_id === creatorId || m.role === 'owner') out.push(m.user_id)
  }
  return out
}

/**
 * Write the bell row and send the push to everyone linkAlertRecipients
 * names. `notification` is the fh_notifications row less user_id and
 * org_id; `push` is the sendPushToUser payload. Best effort: never throws.
 */
export async function alertLinkRecipients(supabase, { orgId, creatorId, notification, push }) {
  try {
    const recipients = await linkAlertRecipients(supabase, { orgId, creatorId })
    if (recipients.length === 0) return
    if (notification) {
      const { error } = await supabase
        .from('fh_notifications')
        .insert(recipients.map((userId) => ({ ...notification, user_id: userId, org_id: orgId || null })))
      if (error) console.warn('[linkAlerts] notification insert failed', error)
    }
    if (push) {
      await Promise.allSettled(recipients.map((userId) => sendPushToUser(supabase, userId, push)))
    }
  } catch (e) {
    console.warn('[linkAlerts] alert failed', e)
  }
}
