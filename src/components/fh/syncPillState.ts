// Pure state for the SyncPill (spec 7 and 9.13), kept free of imports so
// it can be unit tested without the outboxes or Supabase.
//
//   offline                 Offline, with the queued count when there is one
//   online, something left  Syncing (the outboxes drain on reconnect)
//   online, nothing left    Synced

export type SyncStatus = 'synced' | 'syncing' | 'offline'

export type SyncPillInput = {
  /** navigator.onLine, kept current by the online and offline events. */
  online: boolean
  /** Writes waiting in lib/outbox.ts plus captures in lib/captureOutbox.ts. */
  queued: number
}

export type SyncPillState = {
  status: SyncStatus
  /** Whole, non negative queued count. */
  queued: number
  /** The word on the pill. */
  label: string
  /** The short count beside it, such as "3 queued", or null. */
  detail: string | null
  /** The full sentence a screen reader hears. */
  spoken: string
}

function changes(n: number): string {
  return n === 1 ? '1 change' : `${n} changes`
}

export function syncPillState({ online, queued }: SyncPillInput): SyncPillState {
  const n = Number.isFinite(queued) && queued > 0 ? Math.floor(queued) : 0

  if (!online) {
    return {
      status: 'offline',
      queued: n,
      label: 'Offline',
      detail: n > 0 ? `${n} queued` : null,
      spoken: n > 0
        ? `Offline. ${changes(n)} saved on this phone, they will sync when you are back.`
        : 'Offline. New changes will be saved on this phone.'
    }
  }

  if (n > 0) {
    return {
      status: 'syncing',
      queued: n,
      label: 'Syncing',
      detail: null,
      spoken: `Syncing ${changes(n)}.`
    }
  }

  return { status: 'synced', queued: 0, label: 'Synced', detail: null, spoken: 'Synced. Everything is saved.' }
}
