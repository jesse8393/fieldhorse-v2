import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Bell, Check, Inbox, Users, ClipboardCheck, DollarSign, Calendar, MessageSquare, Eye, ShieldCheck, FileEdit } from 'lucide-react'
import { Drawer, DrawerContent, DrawerHeader, DrawerTitle, DrawerDescription } from '@/components/ui/drawer'
import { useAuth } from '../contexts/AuthContext.tsx'
import { supabase } from '../lib/supabase.ts'
import { fetchInbox, markRead, markAllRead, fmtAge } from '../lib/notifications.ts'
import { hapticTap } from '../lib/haptics.ts'

// Map notification kind → icon + accent color. Add cases as new kinds
// are introduced server-side; default falls back to Inbox + steel.
const KIND_META: Record<string, any> = {
  partner_accepted:   { Icon: Users,           color: 'var(--ink-strong)' },
  inspection_logged:  { Icon: ClipboardCheck,  color: 'var(--signal-green)' },
  payment_received:   { Icon: DollarSign,      color: 'var(--signal-green)' },
  schedule_change:    { Icon: Calendar,        color: 'var(--ink-strong)' },
  sub_responded:      { Icon: MessageSquare,   color: 'var(--ink-strong)' },
  public_link_viewed: { Icon: Eye,             color: 'var(--ink-strong)' },
  quote_approved:     { Icon: ShieldCheck,     color: 'var(--signal-green)' },
  change_order_added: { Icon: FileEdit,        color: 'var(--ink-strong)' }
}
function metaFor(kind: any) {
  return KIND_META[kind] || { Icon: Inbox, color: 'var(--ink-muted)' }
}

export default function NotificationsBell() {
  const { user } = useAuth()
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const [rows, setRows] = useState<any[]>([])
  const [loading, setLoading] = useState(false)

  // Single source of truth: badge count derives from rows so the
  // bell badge can't say "1" while the drawer says "All caught up."
  // Audit caught the divergence — used to be two parallel state vars.
  const unread = useMemo(() => rows.filter((r) => !r.read_at).length, [rows])

  // Pull inbox on mount + whenever auth user changes. Realtime
  // channel below keeps rows fresh on every insert/update without polling.
  const refresh = useCallback(async () => {
    if (!user) { setRows([]); return }
    try {
      const list = await fetchInbox(40, user.id)
      setRows(list)
    } catch {
      // RLS denial / table missing → silently zero out so the bell never
      // throws. Migration 008 may not have been applied yet.
      setRows([])
    }
  }, [user])

  useEffect(() => { refresh() }, [refresh])

  // Realtime — any change to the recipient's inbox refreshes both the
  // count badge and (if open) the drawer list.
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

  // Reload list when the drawer opens so the user sees the freshest
  // version even if realtime missed an update.
  useEffect(() => {
    if (!open || !user) return
    setLoading(true)
    refresh().finally(() => setLoading(false))
  }, [open, user, refresh])

  async function handleTap(row: any) {
    hapticTap()
    if (!row.read_at && user) {
      // Optimistic update — badge falls automatically since it's
      // derived from rows.
      setRows((prev) => prev.map((r) => r.id === row.id ? { ...r, read_at: new Date().toISOString() } : r))
      await markRead(row.id, user.id)
    }
    if (row.link) {
      setOpen(false)
      navigate(row.link)
    }
  }

  async function handleMarkAll() {
    hapticTap()
    if (!user) return
    setRows((prev) => prev.map((r) => r.read_at ? r : { ...r, read_at: new Date().toISOString() }))
    await markAllRead(user.id)
  }

  return (
    <>
      <button
        type="button"
        aria-label={unread > 0 ? `Notifications — ${unread} unread` : 'Notifications'}
        onClick={() => { hapticTap(); setOpen(true) }}
        className="fh-header-search-btn"
        style={{
          // Matches the search + notes trio in AppHeader at 44/r11/16 —
          // the full minimum touch target. Unread dot stays 14×14 and
          // sits 3px in from the top-right corner.
          width: 44,
          height: 44,
          minWidth: 44,
          borderRadius: 11,
          background: 'var(--v3-glass-tint)',
          border: '1px solid var(--v3-border-mid)',
          backdropFilter: 'blur(8px)',
          WebkitBackdropFilter: 'blur(8px)',
          display: 'grid',
          placeItems: 'center',
          color: 'var(--ink-strong)',
          cursor: 'pointer',
          padding: 0,
          position: 'relative',
          transition: 'color 160ms ease, background 160ms ease, border-color 160ms ease'
        }}
      >
        <Bell size={16} />
        {unread > 0 && (
          <span
            aria-hidden="true"
            style={{
              position: 'absolute',
              top: 3,
              right: 3,
              minWidth: 14,
              height: 14,
              padding: '0 4px',
              borderRadius: 7,
              background: 'var(--alert-red)',
              color: '#fff',
              fontFamily: 'var(--font-display)',
              fontSize: 9,
              fontWeight: 700,
              letterSpacing: '0.04em',
              lineHeight: '14px',
              textAlign: 'center',
              boxShadow: '0 0 0 2px var(--surface-1)'
            }}
          >
            {unread > 9 ? '9+' : unread}
          </span>
        )}
      </button>

      <Drawer open={open} onOpenChange={setOpen}>
        <DrawerContent
          className="ui:max-w-full ui:overflow-x-hidden"
          style={{ maxWidth: '100%', overflowX: 'hidden' }}
        >
          <DrawerHeader className="ui:text-left" style={{ maxWidth: '100%', minWidth: 0, boxSizing: 'border-box' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
              <div>
                <div style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 10, fontWeight: 700, letterSpacing: '0.18em', textTransform: 'uppercase', color: 'var(--v3-text-muted)' }}>
                  <Inbox size={12} />
                  Inbox
                </div>
                <DrawerTitle asChild>
                  <h2
                    className="fh-font-serif"
                    style={{ margin: '6px 0 0', fontSize: 'clamp(22px, 6vw, 28px)', lineHeight: 1.1, letterSpacing: '-0.02em', fontWeight: 400, fontStyle: 'normal', color: 'var(--ink-strong)' }}
                  >
                    {unread > 0 ? <>{unread} new <em style={{ fontStyle: 'normal', fontWeight: 600 }}>notifications.</em></> : <>All <em style={{ fontStyle: 'normal', fontWeight: 600 }}>caught up.</em></>}
                  </h2>
                </DrawerTitle>
              </div>
              {unread > 0 && (
                <button
                  type="button"
                  onClick={handleMarkAll}
                  style={{ flexShrink: 0, display: 'inline-flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--rule)', color: 'var(--ink-strong)', fontFamily: 'var(--font-body)', fontSize: 12, fontWeight: 700, cursor: 'pointer' }}
                >
                  <Check size={12} />
                  Mark all read
                </button>
              )}
            </div>
            <DrawerDescription
              style={{ margin: '8px 0 0', fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', lineHeight: 1.45 }}
            >
              {rows.length === 0 && !loading ? 'You\'ll see partner replies, inspections, payments, and schedule changes here.' : 'Tap any item to open the related job.'}
            </DrawerDescription>
          </DrawerHeader>

          <div style={{ padding: '6px 20px 24px', maxHeight: '60dvh', overflowY: 'auto' }}>
            {loading && rows.length === 0 && (
              <div style={{ padding: '24px 0', textAlign: 'center', fontSize: 12, color: 'var(--ink-muted)' }}>Loading…</div>
            )}
            {!loading && rows.length === 0 && (
              <div style={{ padding: '32px 16px', borderRadius: 14, background: 'var(--surface-2)', border: '1px dashed var(--rule)', textAlign: 'center', color: 'var(--ink-muted)', fontFamily: 'var(--font-body)' }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--ink-strong)', marginBottom: 4 }}>No notifications yet.</div>
                <div style={{ fontSize: 12 }}>Quiet inbox. Check back after partners or subs respond.</div>
              </div>
            )}

            {rows.length > 0 && (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                {rows.map((r) => {
                  const meta = metaFor(r.kind)
                  const I = meta.Icon
                  const isUnread = !r.read_at
                  return (
                    <li key={r.id}>
                      <button
                        type="button"
                        onClick={() => handleTap(r)}
                        style={{
                          width: '100%',
                          textAlign: 'left',
                          display: 'flex',
                          alignItems: 'flex-start',
                          gap: 10,
                          padding: '12px 14px 12px 18px',
                          borderRadius: 12,
                          // User feedback: gold-tinted unread rows read as
                          // yellow noise on the inbox. The colored left
                          // stripe + bold title already signal "unread"
                          // adequately. Now uses a neutral lift instead
                          // of gold gradient.
                          background: isUnread
                            ? 'linear-gradient(180deg, var(--v3-glass-tint), var(--v3-glass-tint))'
                            : 'var(--surface-2)',
                          border: isUnread ? '1px solid var(--v3-border-mid)' : '1px solid var(--rule)',
                          cursor: 'pointer',
                          color: 'var(--ink-strong)',
                          position: 'relative',
                          overflow: 'hidden'
                        }}
                      >
                        {isUnread && (
                          <span
                            aria-hidden="true"
                            style={{
                              position: 'absolute',
                              left: 0,
                              top: 10,
                              bottom: 10,
                              width: 3,
                              borderRadius: '0 3px 3px 0',
                              background: meta.color,
                              boxShadow: `0 0 8px ${meta.color}99`
                            }}
                          />
                        )}
                        <span aria-hidden="true" style={{ flexShrink: 0, width: 30, height: 30, borderRadius: 9, display: 'grid', placeItems: 'center', background: `${meta.color}22`, border: `1px solid ${meta.color}44`, color: meta.color }}>
                          <I size={14} />
                        </span>
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 8 }}>
                            <span style={{ fontFamily: 'var(--font-body)', fontSize: 13, fontWeight: isUnread ? 700 : 600, color: 'var(--ink-strong)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.title}
                            </span>
                            <span style={{ flexShrink: 0, fontSize: 10, color: 'var(--ink-faint)', fontFamily: 'var(--font-body)' }}>
                              {fmtAge(r.created_at)}
                            </span>
                          </div>
                          {r.body && (
                            <div style={{ marginTop: 2, fontSize: 12, color: 'var(--ink-muted)', fontFamily: 'var(--font-body)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {r.body}
                            </div>
                          )}
                        </div>
                      </button>
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
        </DrawerContent>
      </Drawer>
    </>
  )
}
