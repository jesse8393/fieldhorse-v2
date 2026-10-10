import { useEffect, useState } from 'react'
import { subscribeOutbox } from '../../lib/outbox.ts'
import { outboxCount } from '../../lib/captureOutbox.ts'
import { syncPillState } from './syncPillState.ts'
import type { SyncPillInput, SyncStatus } from './syncPillState.ts'
import { cx } from './cx.ts'

export { syncPillState } from './syncPillState.ts'
export type { SyncPillInput, SyncPillState, SyncStatus } from './syncPillState.ts'

// Sync pill (spec 7 and 9.13): Synced, Syncing, or Offline with the count
// of changes saved on this phone. It reads the real queues:
//
// * lib/outbox.ts, the IndexedDB write queue, through subscribeOutbox,
//   which reports its size on every enqueue and after every drain;
// * lib/captureOutbox.ts, captures kept in localStorage, which has no
//   subscription, so it is re-read on reconnect, when the write queue
//   changes, when the tab comes back, on storage events from other tabs,
//   and every few seconds;
// * navigator.onLine, with the online and offline events.
//
// The counts cover everything queued on this device, which is what the
// offline band promises ("3 changes are saved on this phone").
//
// It works on paper and on an onyx stage (inside .fh-onyx-scope).

export type SyncPillProps = {
  /** Pin a state instead of reading the queues, for the design sheet and tests. */
  status?: SyncStatus
  /** With `status`, the queued count to show. */
  queued?: number
  className?: string
}

const CAPTURE_POLL_MS = 4000

function readOnline(): boolean {
  return typeof navigator === 'undefined' || navigator.onLine !== false
}

function readCaptures(): number {
  try {
    return outboxCount()
  } catch {
    return 0
  }
}

/**
 * Live input for syncPillState: connectivity plus both queues. Pass
 * enabled false to skip the listeners (a pill with a pinned status).
 */
export function useSyncInput(enabled = true): SyncPillInput {
  const [online, setOnline] = useState(readOnline)
  const [writes, setWrites] = useState(0)
  const [captures, setCaptures] = useState(() => (enabled ? readCaptures() : 0))

  useEffect(() => {
    if (!enabled) return
    const update = () => setOnline(readOnline())
    update()
    window.addEventListener('online', update)
    window.addEventListener('offline', update)
    return () => {
      window.removeEventListener('online', update)
      window.removeEventListener('offline', update)
    }
  }, [enabled])

  useEffect(() => (enabled ? subscribeOutbox((n) => setWrites(n)) : undefined), [enabled])

  useEffect(() => {
    if (!enabled) return
    const refresh = () => setCaptures(readCaptures())
    const onVisible = () => {
      if (document.visibilityState === 'visible') refresh()
    }
    window.addEventListener('storage', refresh)
    document.addEventListener('visibilitychange', onVisible)
    const timer = window.setInterval(refresh, CAPTURE_POLL_MS)
    return () => {
      window.removeEventListener('storage', refresh)
      document.removeEventListener('visibilitychange', onVisible)
      window.clearInterval(timer)
    }
  }, [enabled])

  // Reconnecting drains both queues, and a drain reports through the write
  // queue, so re-read the captures whenever either moves.
  useEffect(() => {
    if (enabled) setCaptures(readCaptures())
  }, [enabled, online, writes])

  return { online, queued: writes + captures }
}

function pinnedInput(status: SyncStatus, queued = 0): SyncPillInput {
  if (status === 'offline') return { online: false, queued }
  if (status === 'syncing') return { online: true, queued: Math.max(1, queued) }
  return { online: true, queued: 0 }
}

export default function SyncPill({ status, queued, className }: SyncPillProps) {
  const live = useSyncInput(!status)
  const state = syncPillState(status ? pinnedInput(status, queued) : live)

  return (
    <span className={cx('fhc-sync', `fhc-sync--${state.status}`, className)} role="status" aria-live="polite">
      <span className="fhc-sync__dot" aria-hidden="true" />
      <span className="fhc-sync__label" aria-hidden="true">{state.label}</span>
      {state.detail && (
        <span className="fhc-sync__detail" aria-hidden="true">{state.detail}</span>
      )}
      <span className="fhc-vh">{state.spoken}</span>
    </span>
  )
}
