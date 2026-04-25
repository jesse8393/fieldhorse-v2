// Notifications client — Phase 19 / Audit Move #3.
//
// Read + write helpers around fh_notifications (migration 008).
// The in-app bell consumes these. Push delivery is a separate layer
// (Apple cert + web-push via Supabase Edge Function) wired in later.

import { supabase } from './supabase.js'

export async function fetchInbox(limit = 30) {
  const { data, error } = await supabase
    .from('fh_notifications')
    .select('id, kind, title, body, link, read_at, created_at, actor_user_id')
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

export async function unreadCount() {
  const { count, error } = await supabase
    .from('fh_notifications')
    .select('id', { count: 'exact', head: true })
    .is('read_at', null)
  if (error) return 0
  return count || 0
}

export async function markRead(id) {
  if (!id) return
  await supabase.from('fh_notifications').update({ read_at: new Date().toISOString() }).eq('id', id)
}

export async function markAllRead() {
  await supabase
    .from('fh_notifications')
    .update({ read_at: new Date().toISOString() })
    .is('read_at', null)
}

// Insert a notification for the CURRENT user. Used for self-notifications
// like "You logged a failed inspection". For cross-user notifications
// (partner accepted, sub responded), use the server-side notify() in
// Netlify functions where the service role can write to any inbox.
export async function notifySelf(userId, { kind, title, body, link, actor_user_id = null }) {
  if (!userId || !kind || !title) return
  await supabase.from('fh_notifications').insert({
    user_id: userId,
    actor_user_id,
    kind,
    title,
    body: body || null,
    link: link || null
  })
}

export function fmtAge(iso) {
  if (!iso) return ''
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60000)
  if (min < 1) return 'just now'
  if (min < 60) return `${min}m`
  const hr = Math.floor(min / 60)
  if (hr < 24) return `${hr}h`
  const d = Math.floor(hr / 24)
  if (d < 7) return `${d}d`
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}
