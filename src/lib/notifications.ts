// Notifications client, Phase 19 / Audit Move #3.
//
// Read + write helpers around fh_notifications (migration 008).
// The in-app bell consumes these. Push delivery is a separate layer
// (Apple cert + web-push via Supabase Edge Function) wired in later.

import { supabase } from './supabase.ts'

/**
 * One page of the inbox, newest first. Pass the created_at of the last
 * row shown as `before` for the next page.
 */
export async function fetchInbox(limit = 30, userId?: string, before?: string | null) {
  if (!userId) return []
  let query = supabase
    .from('fh_notifications')
    .select('id, kind, title, body, link, read_at, created_at, actor_user_id')
    .eq('user_id', userId)
  if (before) query = query.lt('created_at', before)
  const { data, error } = await query
    .order('created_at', { ascending: false })
    .limit(limit)
  if (error) throw error
  return data || []
}

/** The unread count, or null when it could not be read (never a false 0). */
export async function unreadCount(userId?: string): Promise<number | null> {
  if (!userId) return 0
  const { count, error } = await supabase
    .from('fh_notifications')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .is('read_at', null)
  if (error) return null
  return count || 0
}

// The bell listens for this so its count follows a read on the
// notifications screen without waiting for a realtime event, which a
// phone with a dropped socket never gets (OPS-12).
export const NOTIFICATIONS_CHANGED = 'fh:notifications-changed'

function announceChange() {
  if (typeof window !== 'undefined') window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED))
}

export type MarkResult = { ok: true } | { ok: false; error: string }

/** Mark one notification read. Says whether the write worked (OPS-13). */
export async function markRead(id: string | undefined, userId: string | undefined): Promise<MarkResult> {
  return markIdsRead(id ? [id] : [], userId)
}

/**
 * Mark the given notifications read: the rows on screen, never ones the
 * person has not seen (DATA-16). Says whether the write worked.
 */
export async function markIdsRead(ids: string[], userId: string | undefined): Promise<MarkResult> {
  if (!userId || ids.length === 0) return { ok: true }
  try {
    const { error } = await supabase
      .from('fh_notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .in('id', ids)
      .is('read_at', null)
    if (error) return { ok: false, error: 'Check your connection and try again.' }
    return { ok: true }
  } catch {
    return { ok: false, error: 'Check your connection and try again.' }
  } finally {
    announceChange()
  }
}

// Insert a notification for the CURRENT user. Used for self-notifications
// like "You logged a failed inspection". For cross-user notifications
// (partner accepted, sub responded), use the on the server notify() in
// Netlify functions where the service role can write to any inbox.
export async function notifySelf(userId: string | undefined, { kind, title, body, link, actor_user_id = null }: { kind?: string; title?: string; body?: string | null; link?: string | null; actor_user_id?: string | null }) {
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

export function fmtAge(iso: string | null | undefined) {
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

// A reminder (kind follow_up_due or review_ask_due) can be marked Done or
// Dismissed from the notifications screen (decision D63). The RPC
// fh_follow_up_set_status (migration 090) closes the fh_follow_ups row that
// the notification stands for and marks the notification read. The app says
// 'dismissed'; the database stores that as 'skipped', the status its check
// constraint allows.
export type FollowUpStatus = 'done' | 'dismissed'

export async function setFollowUpStatus(notificationId: string, status: FollowUpStatus) {
  const { error } = await supabase.rpc('fh_follow_up_set_status', {
    p_notification_id: notificationId,
    p_status: status
  })
  if (error) throw error
}

export function completeFollowUp(notificationId: string) {
  return setFollowUpStatus(notificationId, 'done')
}

export function dismissFollowUp(notificationId: string) {
  return setFollowUpStatus(notificationId, 'dismissed')
}
