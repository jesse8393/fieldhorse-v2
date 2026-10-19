import { useCallback, useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell } from 'lucide-react'
import Icon from './fh/Icon.tsx'
import { useAuth } from '../contexts/AuthContext.tsx'
import { supabase } from '../lib/supabase.ts'
import { unreadCount } from '../lib/notifications.ts'
import { hapticTap } from '../lib/haptics.ts'

// The bell in the shared header (decision D64). It shows how many
// notifications are unread and opens the /notifications screen; the list
// itself lives there, never in a sheet (decision D57). The count follows
// the inbox in real time, as it always has.
export default function NotificationsBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [unread, setUnread] = useState(0)

  const refresh = useCallback(async () => {
    if (!user) { setUnread(0); return }
    // unreadCount answers 0 when the read fails, so the bell never throws.
    setUnread(await unreadCount(user.id))
  }, [user])

  useEffect(() => { refresh() }, [refresh])

  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`fh_notifications:bell:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fh_notifications', filter: `user_id=eq.${user.id}` },
        () => refresh()
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user, refresh])

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
