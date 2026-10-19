// The notifications screen (Phase 9, decisions D57, D63 and D64). The bell
// in the header brings the person here; there is no sheet. The header has
// Back, the title and a plain Mark all read. Each row is a notification:
// its kind as an icon, the title, the body on two lines at most, the age
// and a dot while it is unread. Tapping a row marks it read and opens its
// record. A reminder (follow_up_due or review_ask_due) also has Done and
// Dismiss, which close the follow up through fh_follow_up_set_status and
// take the row out of the list.
//
// Loading shows the list's skeleton, a failed read shows an error with Try
// again where the list goes, and an empty inbox says "All caught up."
// (decision D49). A failed refresh keeps what is on screen.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LucideIcon } from 'lucide-react'
import {
  Bell, BellRing, Calendar, ChevronLeft, ClipboardCheck, DollarSign, Eye, FileEdit,
  Inbox, MessageSquare, PenLine, ShieldCheck, Users
} from 'lucide-react'
import { Button, EmptyState, Icon, IconButton, SkeletonRows } from '../components/fh'
import DataErrorState from '../components/DataErrorState.tsx'
import { useAuth } from '../contexts/AuthContext.tsx'
import { supabase } from '../lib/supabase.ts'
import {
  completeFollowUp, dismissFollowUp, fetchInbox, fmtAge, markAllRead, markRead
} from '../lib/notifications.ts'
import { countNoun } from '../lib/format.ts'
import { hapticTap } from '../lib/haptics.ts'
import { toastError } from '../lib/toast.ts'
import './notifications/notifications.css'

type Notification = {
  id: string
  kind: string | null
  title: string | null
  body: string | null
  link: string | null
  read_at: string | null
  created_at: string
}

// Each notification kind has an icon and a tone. Kinds the screen does not
// know fall back to the inbox tray in the neutral tone.
type Tone = 'neutral' | 'success' | 'danger'
const KIND_META: Record<string, { icon: LucideIcon; tone: Tone }> = {
  partner_accepted:        { icon: Users,          tone: 'neutral' },
  inspection_logged:       { icon: ClipboardCheck, tone: 'success' },
  payment_received:        { icon: DollarSign,     tone: 'success' },
  schedule_change:         { icon: Calendar,       tone: 'neutral' },
  sub_responded:           { icon: MessageSquare,  tone: 'neutral' },
  public_link_viewed:      { icon: Eye,            tone: 'neutral' },
  quote_approved:          { icon: ShieldCheck,    tone: 'success' },
  quote_changes_requested: { icon: PenLine,        tone: 'danger' },
  change_order_added:      { icon: FileEdit,       tone: 'neutral' },
  follow_up_due:           { icon: BellRing,       tone: 'neutral' },
  review_ask_due:          { icon: Calendar,       tone: 'neutral' }
}
function metaFor(kind: string | null | undefined) {
  return (kind && KIND_META[kind]) || { icon: Inbox, tone: 'neutral' as Tone }
}

const REMINDER_KINDS = new Set(['follow_up_due', 'review_ask_due'])
export function isReminder(kind: string | null | undefined) {
  return !!kind && REMINDER_KINDS.has(kind)
}

export default function Notifications() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [rows, setRows] = useState<Notification[]>([])
  const [status, setStatus] = useState<'loading' | 'ready' | 'failed'>('loading')
  // Rows whose Done or Dismiss is on its way to the server.
  const [busy, setBusy] = useState<Set<string>>(() => new Set())
  // Only the latest read decides what the screen says (D49).
  const readSeq = useRef(0)

  const titleRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => { titleRef.current?.focus({ preventScroll: true }) }, [])

  const unread = useMemo(() => rows.filter((r) => !r.read_at).length, [rows])

  const load = useCallback(async (first: boolean) => {
    if (!user) return
    const seq = ++readSeq.current
    if (first) setStatus('loading')
    try {
      const list = (await fetchInbox(100, user.id)) as Notification[]
      if (seq !== readSeq.current) return
      setRows(list)
      setStatus('ready')
    } catch {
      if (seq !== readSeq.current) return
      // A failed refresh keeps what is on screen; only the first read fails
      // the screen.
      setStatus((prev) => (prev === 'ready' ? 'ready' : 'failed'))
    }
  }, [user])

  useEffect(() => { void load(true) }, [load])

  // Real time: any change to this inbox refreshes the list, as the bell did.
  useEffect(() => {
    if (!user) return
    const channel = supabase
      .channel(`fh_notifications:screen:${user.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fh_notifications', filter: `user_id=eq.${user.id}` },
        () => void load(false)
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [user, load])

  function goBack() {
    hapticTap()
    const idx = (window.history.state as { idx?: number } | null)?.idx ?? 0
    if (idx > 0) navigate(-1)
    else navigate('/')
  }

  async function handleOpen(row: Notification) {
    hapticTap()
    if (!row.read_at && user) {
      setRows((prev) => prev.map((r) => (r.id === row.id ? { ...r, read_at: new Date().toISOString() } : r)))
      void markRead(row.id, user.id)
    }
    if (row.link) navigate(row.link)
  }

  async function handleMarkAll() {
    hapticTap()
    if (!user || unread === 0) return
    setRows((prev) => prev.map((r) => (r.read_at ? r : { ...r, read_at: new Date().toISOString() })))
    await markAllRead(user.id)
  }

  async function handleFollowUp(row: Notification, action: 'done' | 'dismissed') {
    hapticTap()
    if (busy.has(row.id)) return
    setBusy((prev) => new Set(prev).add(row.id))
    try {
      if (action === 'done') await completeFollowUp(row.id)
      else await dismissFollowUp(row.id)
      // The follow up is closed and the notification read: the row leaves.
      setRows((prev) => prev.filter((r) => r.id !== row.id))
    } catch {
      toastError(action === 'done' ? 'Could not mark the reminder done.' : 'Could not dismiss the reminder.')
    } finally {
      setBusy((prev) => { const next = new Set(prev); next.delete(row.id); return next })
    }
  }

  return (
    <div className="fhn">
      <header className="fhn-head">
        <IconButton aria-label="Back" icon={ChevronLeft} variant="plain" size={44} onClick={goBack} />
        <h1 className="fhn-title" ref={titleRef} tabIndex={-1}>Notifications</h1>
        <Button variant="quiet" size="mini" onClick={handleMarkAll} disabled={status !== 'ready' || unread === 0}>
          Mark all read
        </Button>
      </header>

      {status === 'ready' && rows.length > 0 && (
        <p className="fhn-count">
          {unread > 0 ? `${unread} new ${countNoun(unread, 'notification')}.` : 'All caught up.'}
        </p>
      )}

      <div className="fhn-body">
        {status === 'loading' ? (
          <SkeletonRows rows={6} label="Loading notifications" />
        ) : status === 'failed' ? (
          <DataErrorState
            title="Couldn't load your notifications"
            message="Check your connection and try again."
            actionLabel="Try again"
            onRetry={() => void load(true)}
          />
        ) : rows.length === 0 ? (
          <EmptyState icon={Bell} title="All caught up." />
        ) : (
          <ul className="fhn-rows">
            {rows.map((row) => {
              const meta = metaFor(row.kind)
              const isUnread = !row.read_at
              const reminder = isReminder(row.kind)
              const isBusy = busy.has(row.id)
              return (
                <li key={row.id} className={`fhn-row${isUnread ? ' is-unread' : ''}${reminder ? ' has-actions' : ''}`}>
                  <button type="button" className="fhn-row__main" onClick={() => handleOpen(row)}>
                    {isUnread && <span className="fhn-row__dot" aria-hidden="true" />}
                    <span className={`fhn-row__kind fhn-row__kind--${meta.tone}`} aria-hidden="true">
                      <Icon icon={meta.icon} size={18} />
                    </span>
                    <span className="fhn-row__text">
                      <span className="fhn-row__top">
                        <span className="fhn-row__title">
                          {isUnread && <span className="fhc-vh">Unread. </span>}
                          {row.title}
                        </span>
                        <span className="fhn-row__age">{fmtAge(row.created_at)}</span>
                      </span>
                      {row.body && <span className="fhn-row__body">{row.body}</span>}
                    </span>
                  </button>
                  {reminder && (
                    <div className="fhn-row__actions">
                      <Button variant="secondary" size="mini" loading={isBusy} onClick={() => void handleFollowUp(row, 'done')}>
                        Done
                      </Button>
                      <Button variant="quiet" size="mini" disabled={isBusy} onClick={() => void handleFollowUp(row, 'dismissed')}>
                        Dismiss
                      </Button>
                    </div>
                  )}
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
