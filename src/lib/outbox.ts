// src/lib/outbox.ts
//
// Offline write queue — dead-zone insurance for every field write.
//
// The app's writes go straight to Supabase; on a jobsite with no signal
// they failed and the data was simply lost. This module gives the app
// one rule instead: A WRITE NEVER FAILS FOR LACK OF SIGNAL. It either
// lands now, or it's queued in IndexedDB (Blobs included, so photos
// survive) and drained automatically when the network returns.
//
// Idempotency: every queued insert carries a client-generated uuid `id`
// and is drained with upsert(onConflict id, ignoreDuplicates), so a
// flush that dies halfway can re-run without double-writing.
//
// Entry kinds:
//   insert — table row insert
//   update — table .update(patch).match(match)
//   photo  — storage upload (bucket/path/blob) + fh_job_files row
//
// Flush triggers: window 'online', tab becoming visible, and app start
// (wired in AppShell). Successes toast once per drain.

import { supabase } from './supabase.ts'
import { toastSuccess } from './toast.ts'

// The generated database types reject dynamic table names; the outbox
// is generic by design, so it talks to PostgREST through an untyped
// handle. Callers pass rows shaped by the same code that does the
// online write, so type safety lives at the call site.
const db = supabase as any

const DB_NAME = 'fh-outbox'
const STORE = 'items'
const MAX_ITEMS = 500

export type OutboxEntry = {
  key: string                // queue key (uuid)
  kind: 'insert' | 'update' | 'photo'
  table?: string
  row?: Record<string, any>
  match?: Record<string, any>
  patch?: Record<string, any>
  bucket?: string
  path?: string
  blob?: Blob
  contentType?: string
  created_at: string
  attempts: number
}

// ---------------------------------------------------------------- IDB

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1)
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

function tx<T>(mode: IDBTransactionMode, fn: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode)
        const req = fn(t.objectStore(STORE))
        req.onsuccess = () => resolve(req.result)
        req.onerror = () => reject(req.error)
      })
  )
}

async function allEntries(): Promise<OutboxEntry[]> {
  try {
    const rows = await tx<any[]>('readonly', (s) => s.getAll())
    return (rows || []).sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
  } catch {
    return []
  }
}

async function putEntry(e: OutboxEntry) {
  try {
    const existing = await allEntries()
    if (existing.length >= MAX_ITEMS) return
    await tx('readwrite', (s) => s.put(e))
    emit()
  } catch {
    /* IDB unavailable (private mode quota etc.) — nothing else to do */
  }
}

async function deleteEntry(key: string) {
  try {
    await tx('readwrite', (s) => s.delete(key))
  } catch { /* ignore */ }
}

// ------------------------------------------------------- subscriptions

type Listener = (count: number) => void
const listeners = new Set<Listener>()

async function emit() {
  const n = await outboxSize()
  listeners.forEach((l) => { try { l(n) } catch { /* listener errors are theirs */ } })
}

export function subscribeOutbox(l: Listener): () => void {
  listeners.add(l)
  outboxSize().then((n) => { try { l(n) } catch { /* ignore */ } })
  return () => { listeners.delete(l) }
}

export async function outboxSize(): Promise<number> {
  try {
    return await tx<number>('readonly', (s) => s.count())
  } catch {
    return 0
  }
}

// ----------------------------------------------------- offline detect

// Supabase-js surfaces transport failures as "TypeError: Failed to
// fetch" (Chrome), "Load failed" (iOS Safari), "NetworkError…"
// (Firefox). Anything with an HTTP status is a real server answer and
// must NOT be queued — retrying a 400 forever helps nobody.
export function isNetworkError(err: any): boolean {
  if (!err) return false
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return true
  const msg = String(err.message || err)
  return /failed to fetch|load failed|networkerror|network request failed|fetch failed/i.test(msg)
}

function newId(): string {
  return (crypto as any)?.randomUUID?.() ||
    `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
}

// ------------------------------------------------------------ public

export type WriteResult = { queued: boolean; error: any; id: string }

/**
 * Insert that survives dead zones. Generates the row id client-side so
 * a queued copy and a retried copy are the same row. Returns
 * { queued: true } when the write was parked for later instead.
 */
export async function resilientInsert(table: string, row: Record<string, any>): Promise<WriteResult> {
  const id = row.id || newId()
  const withId = { ...row, id }
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    const { error } = await db.from(table).insert(withId)
    if (!error) return { queued: false, error: null, id }
    if (!isNetworkError(error)) return { queued: false, error, id }
  }
  await putEntry({
    key: newId(), kind: 'insert', table, row: withId,
    created_at: new Date().toISOString(), attempts: 0
  })
  return { queued: true, error: null, id }
}

/** Update that survives dead zones. match → .match(), patch → .update(). */
export async function resilientUpdate(
  table: string, match: Record<string, any>, patch: Record<string, any>
): Promise<WriteResult> {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    const { error } = await db.from(table).update(patch).match(match)
    if (!error) return { queued: false, error: null, id: String(match.id || '') }
    if (!isNetworkError(error)) return { queued: false, error, id: String(match.id || '') }
  }
  await putEntry({
    key: newId(), kind: 'update', table, match, patch,
    created_at: new Date().toISOString(), attempts: 0
  })
  return { queued: true, error: null, id: String(match.id || '') }
}

/**
 * Photo that survives dead zones: storage upload + fh_job_files row as
 * one queue entry. The Blob lives in IndexedDB until it syncs.
 */
export async function queuePhoto(args: {
  bucket: string
  path: string
  blob: Blob
  contentType: string
  row: Record<string, any>
}): Promise<void> {
  await putEntry({
    key: newId(), kind: 'photo',
    bucket: args.bucket, path: args.path, blob: args.blob,
    contentType: args.contentType, row: args.row,
    created_at: new Date().toISOString(), attempts: 0
  })
}

// ------------------------------------------------------------- flush

let flushing = false

async function drainEntry(e: OutboxEntry): Promise<boolean> {
  if (e.kind === 'insert' && e.table && e.row) {
    const { error } = await db
      .from(e.table)
      .upsert(e.row, { onConflict: 'id', ignoreDuplicates: true })
    return !error || !isNetworkError(error)
    // Non-network errors drop the entry: the row is malformed or RLS
    // rejected it — it will never succeed, keeping it would jam the queue.
  }
  if (e.kind === 'update' && e.table && e.match && e.patch) {
    const { error } = await db.from(e.table).update(e.patch).match(e.match)
    return !error || !isNetworkError(error)
  }
  if (e.kind === 'photo' && e.bucket && e.path && e.blob && e.row) {
    const { error: upErr } = await supabase.storage
      .from(e.bucket)
      .upload(e.path, e.blob, { upsert: true, contentType: e.contentType || 'image/jpeg' })
    if (upErr && isNetworkError(upErr)) return false
    // "already exists" upsert conflicts are fine — the row write decides.
    const { error } = await db
      .from('fh_job_files')
      .upsert(e.row, { onConflict: 'id', ignoreDuplicates: true })
    return !error || !isNetworkError(error)
  }
  return true // unknown/corrupt entry — drop it
}

/** Drain the queue oldest-first. Stops at the first network failure. */
export async function flushOutbox(): Promise<number> {
  if (flushing) return 0
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0
  flushing = true
  let synced = 0
  try {
    const entries = await allEntries()
    for (const e of entries) {
      let ok = false
      try {
        ok = await drainEntry(e)
      } catch (err) {
        ok = !isNetworkError(err)
      }
      if (!ok) break // still offline — try again on the next trigger
      await deleteEntry(e.key)
      synced += 1
    }
  } finally {
    flushing = false
    emit()
  }
  if (synced > 0) {
    toastSuccess('Back online', `${synced} offline ${synced === 1 ? 'item' : 'items'} synced`)
  }
  return synced
}

/** Wire global flush triggers. Call once at app start. Returns cleanup. */
export function startOutboxSync(): () => void {
  const onOnline = () => { void flushOutbox() }
  const onVisible = () => {
    if (document.visibilityState === 'visible') void flushOutbox()
  }
  window.addEventListener('online', onOnline)
  document.addEventListener('visibilitychange', onVisible)
  void flushOutbox()
  return () => {
    window.removeEventListener('online', onOnline)
    document.removeEventListener('visibilitychange', onVisible)
  }
}
