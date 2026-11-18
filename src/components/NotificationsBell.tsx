import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import Icon from './fh/Icon.tsx'
import { useAuth } from '../contexts/AuthContext.tsx'
import { supabase } from '../lib/supabase.ts'
import { NOTIFICATIONS_CHANGED } from '../lib/notifications.ts'
import { notificationBadgeCount } from '../lib/reminders.ts'
import { hapticTap } from '../lib/haptics.ts'

// The bell in the shared header (decision D64). It shows how many
// notifications are unread and opens the /notifications screen; the list
// itself lives there, never in a sheet (decision D57). The count follows
// the inbox in real time, as it always has. It counts what the screen
// lists: clients with an open reminder plus the other unread notifications
// (audit finding AUTO-09), or every unread one until the reminders
// migration is applied.
export default function NotificationsBell() {
  const { user } = useAuth()
  // Keyed on the id, not the user object: the same person published again
  // must not read the count again or rebuild the realtime channel.
  const userId = user?.id ?? null
  const navigate = useNavigate()
  const [unread, setUnread] = useState(0)

  const refresh = useCallback(async () => {
    if (!userId) { setUnread(0); return }
    // notificationBadgeCount never throws, so the bell never does. A failed
    // read answers null and keeps the last count rather than a false 0.
    const count = await notificationBadgeCount(userId)
    if (count != null) setUnread(count)
  }, [userId])

  useEffect(() => { refresh() }, [refresh])

  // Follow reads made on the notifications screen, and catch up when the
  // app comes back to the front, since a phone's realtime socket can drop
  // without a word (OPS-12).
  useEffect(() => {
    const onChange = () => { void refresh() }
    const onVisible = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener(NOTIFICATIONS_CHANGED, onChange)
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      window.removeEventListener(NOTIFICATIONS_CHANGED, onChange)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh])

  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`fh_notifications:bell:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fh_notifications', filter: `user_id=eq.${userId}` },
        () => refresh()
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, refresh])

  return (
    <button
      type="button"
      aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
      onClick={() => { hapticTap(); navigate('/notifications') }}
      className="fhs-icon-btn"
    >
      <Icon icon={Bell} size={22} />
      {unread > 0 && (
        <span aria-hidden="true" className="fhs-icon-btn__badge">
          {unread > 9 ? '9+' : unread}
        </span>
      )}
    </button>
  )
}
