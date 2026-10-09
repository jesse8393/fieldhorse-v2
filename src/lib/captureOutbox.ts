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
// never posts as a note under another on a shared device.

import { supabase } from './supabase.ts'

const KEY = 'fh:capture-outbox'
const MAX_ITEMS = 100

// user_id is missing on captures queued before tagging existed; those
// go to whoever flushes, as they always did.
type OutboxItem = { text: string; captured_at: string; user_id?: string | null }

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
 * signed in user's id so the capture only ever lands under their account.
 */
export function pushOutbox(text: string, userId?: string | null): boolean {
  const t = (text || '').trim()
  if (!t) return false
  const items = read()
  // Full: refuse the new capture. The old write appended it and then
  // kept the oldest 100, silently dropping the one just taken.
  if (items.length >= MAX_ITEMS) return false
  const capturedAt = new Date().toISOString()
  const ok = write([...items, { text: t, captured_at: capturedAt, ...(userId ? { user_id: userId } : {}) }])
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
      let landed = false
      try {
        const { error } = await supabase.from('fh_notes').insert({
          user_id: userId,
          contact_id: null,
          text: `${item.text}${stamp}`,
          category: 'note'
        })
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
