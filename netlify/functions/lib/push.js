// netlify/functions/lib/push.js
//
// Server side of web push. Shared by any function that needs to reach
// the contractor's lock screen. VAPID keys live in fh_app_config
// (service-role-only table) so no dashboard env setup is required.
//
// sendPushToUser is FIRE-AND-FORGET by design: a dead push subscription
// must never fail the business action (approval, payment, new lead)
// that triggered it. Dead endpoints (404/410) are pruned as found.

import webpush from 'web-push'

let vapidLoaded = false

async function loadVapid(supabase) {
  if (vapidLoaded) return true
  const { data, error } = await supabase
    .from('fh_app_config')
    .select('key, value')
    .in('key', ['vapid_public_key', 'vapid_private_key', 'vapid_subject'])
  if (error || !data) return false
  const cfg = Object.fromEntries(data.map((r) => [r.key, r.value]))
  if (!cfg.vapid_public_key || !cfg.vapid_private_key) return false
  webpush.setVapidDetails(
    cfg.vapid_subject || 'mailto:notifications@fieldhorse.io',
    cfg.vapid_public_key,
    cfg.vapid_private_key
  )
  vapidLoaded = true
  return true
}

// Pushes carry customer names, so they go only to people still in the
// company. `orgId` is the company the alert is about; with none (a record
// from before companies existed) the user must still be in some company.
// A failed lookup sends nothing rather than risk reaching someone who left.
async function isActiveMember(supabase, userId, orgId) {
  let query = supabase.from('org_members').select('org_id').eq('user_id', userId).is('revoked_at', null)
  if (orgId) query = query.eq('org_id', orgId)
  const { data, error } = await query.limit(1)
  if (error) {
    console.warn('[push] membership lookup failed, not sending', error)
    return false
  }
  return (data || []).length > 0
}

/**
 * Push { title, body, link, tag? } to every device the user has
 * subscribed, while they are an active member of `orgId`. Never throws.
 * `supabase` must be a service-role client.
 * @param {any} supabase
 * @param {string | null | undefined} userId
 * @param {{ title?: string, body?: string, link?: string, tag?: string }} payload
 * @param {{ orgId?: string | null }} [options]
 */
export async function sendPushToUser(supabase, userId, payload, { orgId = null } = {}) {
  try {
    if (!userId) return
    if (!(await isActiveMember(supabase, userId, orgId))) return
    if (!(await loadVapid(supabase))) return
    const { data: subs } = await supabase
      .from('fh_push_subscriptions')
      .select('id, endpoint, p256dh, auth')
      .eq('user_id', userId)
    if (!subs?.length) return
    const body = JSON.stringify({
      title: payload.title || 'Fieldhorse',
      body: payload.body || '',
      link: payload.link || '/',
      tag: payload.tag
    })
    await Promise.allSettled(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            body
          )
        } catch (err) {
          const code = err?.statusCode
          if (code === 404 || code === 410) {
            await supabase.from('fh_push_subscriptions').delete().eq('id', s.id)
          }
        }
      })
    )
  } catch {
    /* push is best-effort, never let it break the caller */
  }
}
