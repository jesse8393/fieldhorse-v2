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

/**
 * Push { title, body, link, tag? } to every device the user has
 * subscribed. Never throws. `supabase` must be a service-role client.
 */
export async function sendPushToUser(supabase, userId, payload) {
  try {
    if (!userId) return
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
