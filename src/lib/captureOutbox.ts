// src/lib/captureOutbox.ts
//
// Dead-zone insurance for Universal Capture. When a capture is taken
// with no signal, the raw text is queued in localStorage; the next time
// the app is online it lands as a note (with its original timestamp in
// the body) so nothing said in the field is ever lost. Notes only :
// money rows and schedule events need the operator's confirmed intent,
// which needs the AI round trip.
//
// Each capture is tagged with the user who took it, and a flush only
// lands the flushing user's captures, so text captured under one account
// never posts as a note under another on a shared device. A capture taken
// with the sheet open on a job keeps that job, and its note lands on the
// job (contact_id), as it would have online.

import { useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import { toastSuccess } from './toast.ts'

const KEY = 'fh:capture-outbox'
const MAX_ITEMS = 100

// user_id is missing on captures queued before tagging existed; those
// go to whoever flushes, as they always did. job_id is missing on
// captures taken with no job, and on any queued before jobs were kept;
// those land as notes on no job, as they always did.
type OutboxItem = { text: string; captured_at: string; user_id?: string | null; job_id?: string | null }

function read(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((i) => i && typeof i.text === 'string') : []
  } catch {
    return []
  }
}

function write(items: OutboxItem[]): boolean {
  try {
    if (items.length === 0) localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, JSON.stringify(items))
    return true
  } catch {
    return false
  }
}

function belongsTo(item: OutboxItem, userId: string): boolean {
  return !item.user_id || item.user_id === userId
}

function jobOf(item: OutboxItem): string | null {
  return typeof item.job_id === 'string' && item.job_id ? item.job_id : null
}

// Postgres foreign key violation: the job was deleted while the capture
// waited in the queue.
const MISSING_JOB = '23503'

// Callers that don't pass a user id get the capture tagged from the
// stored session as soon as it has been read.
function tagFromSession(capturedAt: string) {
  void supabase.auth.getSession().then(({ data }) => {
    const uid = data.session?.user?.id
    if (!uid) return
    const items = read()
    let changed = false
    for (const item of items) {
      if (!item.user_id && item.captured_at === capturedAt) {
        item.user_id = uid
        changed = true
      }
    }
    if (changed) write(items)
  }, () => { /* no session: stays untagged */ })
}

/**
 * Queue a capture taken with no signal. Returns false when it could NOT
 * be kept (the queue already holds 100 captures, or storage is blocked)
 * so the caller can report it instead of confirming a save. Pass the
 * signed in user's id so the capture only ever lands under their account,
 * and the job the sheet was opened on so its note lands on that job.
 */
export function pushOutbox(text: string, userId?: string | null, jobId?: string | null): boolean {
  const t = (text || '').trim()
  if (!t) return false
  const items = read()
  // Full: refuse the new capture. The old write appended it and then
  // kept the oldest 100, silently dropping the one just taken.
  if (items.length >= MAX_ITEMS) return false
  const capturedAt = new Date().toISOString()
  const ok = write([...items, {
    text: t,
    captured_at: capturedAt,
    ...(userId ? { user_id: userId } : {}),
    ...(jobId ? { job_id: jobId } : {})
  }])
  if (ok && !userId) tagFromSession(capturedAt)
  return ok
}

/** Queued captures; with a user id, only the ones that user's flush would land. */
export function outboxCount(userId?: string | null): number {
  const items = read()
  return userId ? items.filter((i) => belongsTo(i, userId)).length : items.length
}

/** Drop every queued capture (sign out on a shared device). */
export function clearCaptureOutbox(): void {
  generation += 1
  try { localStorage.removeItem(KEY) } catch { /* storage blocked: nothing was stored */ }
}

let flushing = false
// Bumped by clearCaptureOutbox so a running flush never writes back.
let generation = 0

/**
 * flushOutbox, drain this user's queued captures into fh_notes. Items
 * that fail to insert stay queued for the next attempt, and so do other
 * users' captures. Returns how many landed.
 */
export async function flushOutbox(userId: string): Promise<number> {
  if (flushing || !userId) return 0
  const items = read()
  if (!items.some((i) => belongsTo(i, userId))) return 0
  flushing = true
  const startGeneration = generation
  const keep: OutboxItem[] = []
  let synced = 0
  try {
    for (const item of items) {
      // Cleared mid drain (sign out): stop and write nothing back.
      if (generation !== startGeneration) return synced
      if (!belongsTo(item, userId)) {
        keep.push(item)
        continue
      }
      const when = new Date(item.captured_at)
      const stamp = Number.isNaN(when.getTime())
        ? ''
        : ` (captured offline ${when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`
      const note = { user_id: userId, contact_id: jobOf(item), text: `${item.text}${stamp}`, category: 'note' }
      let landed = false
      try {
        let { error } = await supabase.from('fh_notes').insert(note)
        // The job is gone: the words still land, as a note on no job,
        // rather than failing on every flush from now on.
        if (error?.code === MISSING_JOB && note.contact_id) {
          ({ error } = await supabase.from('fh_notes').insert({ ...note, contact_id: null }))
        }
        landed = !error
      } catch { /* transport failure: keep it queued */ }
      if (landed) synced += 1
      else keep.push(item)
    }
    if (generation === startGeneration) {
      // Captures queued while this drain awaited the network were
      // appended after the snapshot; keep them too.
      write([...keep, ...read().slice(items.length)])
    }
  } finally {
    flushing = false
  }
  return synced
}

/**
 * Syncs queued captures from whichever screen is open: on mount, and again
 * when the connection comes back. The Capture screen itself has usually
 * been left by then. The notes land on the jobs they were taken on, so a
 * job page on screen reads them at once.
 */
export function useCaptureOutboxSync(): void {
  const { user } = useAuth()
  const queryClient = useQueryClient()
  const userId = user?.id
  useEffect(() => {
    if (!userId) return
    let alive = true
    async function flush() {
      if (!navigator.onLine || outboxCount() === 0) return
      const n = await flushOutbox(userId as string)
      if (!alive || n === 0) return
      void queryClient.invalidateQueries({ queryKey: ['jobDetail'] })
      toastSuccess(`Synced ${n} offline capture${n === 1 ? '' : 's'}`, 'Saved to Notes')
    }
    void flush()
    window.addEventListener('online', flush)
    return () => {
      alive = false
      window.removeEventListener('online', flush)
    }
  }, [userId, queryClient])
}
