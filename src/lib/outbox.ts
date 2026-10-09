// src/lib/outbox.ts
//
// Offline write queue, dead-zone insurance for every field write.
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
// Ownership: every entry is tagged with the user who queued it, and a
// flush drains only the signed in user's entries, so work queued under
// one account never replays under another on a shared device. Other
// users' entries stay queued for them.
//
// Entry kinds:
//   insert, table row insert
//   update, table .update(patch).match(match)
//   photo , storage upload (bucket/path/blob) + fh_job_files row
//
// Flush triggers: window 'online', tab becoming visible, and app start
// (wired in AppShell). Successes toast once per drain; rows the server
// rejects for good are reported with an error toast, never as synced.

import { supabase } from './supabase.ts'
import { toastError, toastSuccess } from './toast.ts'

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
  // The signed in user who queued the entry. Missing on entries queued
  // before tagging existed; entryOwner() falls back to the row's user_id.
  userId?: string | null
}

// Optional on every enqueue call. Without it the owner is read from the
// current session, then from the row's user_id.
export type OutboxWriteOptions = { userId?: string | null }

// ------------------------------------------------------------ storage

export type OutboxStore = {
  all(): Promise<OutboxEntry[]>
  put(e: OutboxEntry): Promise<void>
  remove(key: string): Promise<void>
  count(): Promise<number>
  clear(): Promise<void>
}

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

const idbStore: OutboxStore = {
  all: () => tx<OutboxEntry[]>('readonly', (s) => s.getAll()).then((rows) => rows || []),
  put: (e) => tx('readwrite', (s) => s.put(e)).then(() => undefined),
  remove: (key) => tx('readwrite', (s) => s.delete(key)).then(() => undefined),
  count: () => tx<number>('readonly', (s) => s.count()),
  clear: () => tx('readwrite', (s) => s.clear()).then(() => undefined),
}

let store: OutboxStore = idbStore

/** Test seam: swap IndexedDB for an in memory store; null restores it. */
export function setOutboxStoreForTests(next: OutboxStore | null) {
  store = next ?? idbStore
}

async function allEntries(): Promise<OutboxEntry[]> {
  try {
    const rows = await store.all()
    return rows.slice().sort((a, b) => (a.created_at < b.created_at ? -1 : 1))
  } catch {
    return []
  }
}

// Returns false when the entry could NOT be parked (queue full or IDB
// unavailable) so callers can report failure instead of a false "saved".
async function putEntry(e: OutboxEntry): Promise<boolean> {
  try {
    // Count, don't load: getAll() would deserialize every queued photo
    // Blob just to compare a length, a growing stall per offline photo.
    if ((await store.count()) >= MAX_ITEMS) return false
    await store.put(e)
    emit()
    return true
  } catch {
    /* IDB unavailable (private mode quota etc.) */
    return false
  }
}

const QUEUE_FULL = { message: "Offline storage is full, this didn't save. Reconnect to sync your queued work, then try again." }

async function deleteEntry(key: string) {
  try {
    await store.remove(key)
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
    return await store.count()
  } catch {
    return 0
  }
}

// ----------------------------------------------------- offline detect

// Supabase-js surfaces transport failures as "TypeError: Failed to
// fetch" (Chrome), "Load failed" (iOS Safari), "NetworkError…"
// (Firefox). Anything with an HTTP status is a real server answer and
// must NOT be queued, retrying a 400 forever helps nobody.
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

// ------------------------------------------------------------ owners

/**
 * Who an entry belongs to: its tag, else the user_id its row or match
 * carries (entries queued before tagging), else null when nothing says.
 */
export function entryOwner(e: Pick<OutboxEntry, 'userId' | 'row' | 'match'>): string | null {
  if (e.userId) return e.userId
  const fromRow = e.row?.user_id ?? e.match?.user_id
  return typeof fromRow === 'string' && fromRow ? fromRow : null
}

/**
 * Does a flush by this user drain the entry? Legacy entries with no
 * owner at all go to whoever is signed in, as they always did.
 */
export function belongsToUser(e: Pick<OutboxEntry, 'userId' | 'row' | 'match'>, userId: string): boolean {
  const owner = entryOwner(e)
  return owner === null || owner === userId
}

// The signed in user's id from the stored session. Bounded: with an
// expired token getSession() attempts a refresh, which can hang on a
// dead connection, and an offline write must never wait on that.
async function sessionUserId(timeoutMs: number): Promise<string | null> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      supabase.auth.getSession().then(
        ({ data }) => data.session?.user?.id ?? null,
        () => null
      ),
      new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), timeoutMs) }),
    ])
  } catch {
    return null
  } finally {
    if (timer) clearTimeout(timer)
  }
}

// The row's user_id comes first: every caller stamps it from the signed
// in user, and reading it costs nothing, while offline with an expired
// token each session lookup would stall a queued write for the timeout.
async function ownerForNewEntry(
  explicit: string | null | undefined,
  hint: Pick<OutboxEntry, 'row' | 'match'>
): Promise<string | null> {
  return explicit || entryOwner(hint) || (await sessionUserId(1500))
}

// ------------------------------------------------------------ public

export type WriteResult = { queued: boolean; error: any; id: string }

/**
 * Insert that survives dead zones. Generates the row id client-side so
 * a queued copy and a retried copy are the same row. Returns
 * { queued: true } when the write was parked for later instead.
 */
export async function resilientInsert(
  table: string, row: Record<string, any>, opts: OutboxWriteOptions = {}
): Promise<WriteResult> {
  const id = row.id || newId()
  const withId = { ...row, id }
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    const { error } = await db.from(table).insert(withId)
    if (!error) return { queued: false, error: null, id }
    if (!isNetworkError(error)) return { queued: false, error, id }
  }
  const ok = await putEntry({
    key: newId(), kind: 'insert', table, row: withId,
    created_at: new Date().toISOString(), attempts: 0,
    userId: await ownerForNewEntry(opts.userId, { row: withId })
  })
  if (!ok) return { queued: false, error: QUEUE_FULL, id }
  return { queued: true, error: null, id }
}

/** Update that survives dead zones. match → .match(), patch → .update(). */
export async function resilientUpdate(
  table: string, match: Record<string, any>, patch: Record<string, any>, opts: OutboxWriteOptions = {}
): Promise<WriteResult> {
  if (typeof navigator === 'undefined' || navigator.onLine !== false) {
    const { error } = await db.from(table).update(patch).match(match)
    if (!error) return { queued: false, error: null, id: String(match.id || '') }
    if (!isNetworkError(error)) return { queued: false, error, id: String(match.id || '') }
  }
  const ok = await putEntry({
    key: newId(), kind: 'update', table, match, patch,
    created_at: new Date().toISOString(), attempts: 0,
    userId: await ownerForNewEntry(opts.userId, { match })
  })
  if (!ok) return { queued: false, error: QUEUE_FULL, id: String(match.id || '') }
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
  userId?: string | null
}): Promise<boolean> {
  return putEntry({
    key: newId(), kind: 'photo',
    bucket: args.bucket, path: args.path, blob: args.blob,
    contentType: args.contentType, row: args.row,
    created_at: new Date().toISOString(), attempts: 0,
    userId: await ownerForNewEntry(args.userId, { row: args.row })
  })
}

/**
 * Remove every queued entry, whoever queued it. Sign out calls this so
 * the next person on a shared device never inherits queued work. A drain
 * in progress stops at its next entry.
 */
export async function clearOutbox(): Promise<void> {
  generation += 1
  try {
    await store.clear()
  } catch { /* IDB unavailable: nothing was stored */ }
  emit()
}

// ------------------------------------------------------------- flush

// ok: landed. retry: no signal, keep it and stop the drain. dropped: a
// real server answer (RLS, a CHECK, a malformed row) that will never
// succeed, so it leaves the queue, and is reported rather than counted.
export type DrainOutcome = 'ok' | 'retry' | 'dropped'

function outcomeFor(error: unknown): DrainOutcome {
  if (!error) return 'ok'
  return isNetworkError(error) ? 'retry' : 'dropped'
}

let flushing = false
// Bumped by clearOutbox so a drain that is already running stops.
let generation = 0

async function drainEntry(e: OutboxEntry): Promise<DrainOutcome> {
  if (e.kind === 'insert' && e.table && e.row) {
    const { error } = await db
      .from(e.table)
      .upsert(e.row, { onConflict: 'id', ignoreDuplicates: true })
    return outcomeFor(error)
  }
  if (e.kind === 'update' && e.table && e.match && e.patch) {
    const { error } = await db.from(e.table).update(e.patch).match(e.match)
    return outcomeFor(error)
  }
  if (e.kind === 'photo' && e.bucket && e.path && e.blob && e.row) {
    const { error: upErr } = await supabase.storage
      .from(e.bucket)
      .upload(e.path, e.blob, { upsert: true, contentType: e.contentType || 'image/jpeg' })
    if (upErr) {
      // Network failure → keep the entry and retry on the next trigger.
      if (isNetworkError(upErr)) return 'retry'
      // Non-network failure (413 too large / RLS / missing bucket): the
      // object never landed, so DON'T write the fh_job_files row, that
      // would orphan a DB row pointing at storage that doesn't exist.
      // Treat as permanent (like the insert branch): drop the entry.
      console.warn('[fieldhorse] outbox photo upload failed permanently, dropping entry', upErr)
      return 'dropped'
    }
    // Upload succeeded ("already exists" upsert conflicts count as
    // success), only NOW write the DB row that points at the object.
    const { error } = await db
      .from('fh_job_files')
      .upsert(e.row, { onConflict: 'id', ignoreDuplicates: true })
    return outcomeFor(error)
  }
  return 'dropped' // unknown/corrupt entry, it can never drain
}

export type DrainResult = { synced: OutboxEntry[]; dropped: OutboxEntry[] }

/**
 * Drain entries oldest first for one user. The effects are injected so
 * the bookkeeping can be tested without IndexedDB or a network:
 *   ok      → removed, counted as synced
 *   dropped → removed (it can never land), reported, not counted
 *   retry   → stop here, still offline; the rest waits for next time
 * Entries that belong to another user are skipped and left in place.
 */
export async function drainQueue(
  entries: OutboxEntry[],
  userId: string,
  deps: {
    drain: (e: OutboxEntry) => Promise<DrainOutcome>
    remove: (key: string) => Promise<void>
    cancelled?: () => boolean
  }
): Promise<DrainResult> {
  const synced: OutboxEntry[] = []
  const dropped: OutboxEntry[] = []
  for (const e of entries) {
    if (deps.cancelled?.()) break
    if (!belongsToUser(e, userId)) continue
    let outcome: DrainOutcome
    try {
      outcome = await deps.drain(e)
    } catch (err) {
      outcome = isNetworkError(err) ? 'retry' : 'dropped'
    }
    if (outcome === 'retry') break
    await deps.remove(e.key)
    if (outcome === 'ok') synced.push(e)
    else dropped.push(e)
  }
  return { synced, dropped }
}

const ITEM_LABELS: Record<string, [string, string]> = {
  fh_notes: ['note', 'notes'],
  fh_contacts: ['lead', 'leads'],
  fh_job_todos: ['task', 'tasks'],
  fh_expenses: ['expense', 'expenses'],
  fh_schedule: ['schedule event', 'schedule events'],
  fh_subs: ['sub entry', 'sub entries'],
  fh_job_files: ['photo', 'photos'],
}

function itemLabel(e: OutboxEntry): [string, string] {
  if (e.kind === 'photo') return ['photo', 'photos']
  if (e.kind === 'update') return ['edit', 'edits']
  return (e.table && ITEM_LABELS[e.table]) || ['item', 'items']
}

/** Error toast copy for entries the server rejected for good. */
export function describeDropped(dropped: OutboxEntry[]): { title: string; description: string } {
  const counts = new Map<string, { n: number; many: string }>()
  for (const e of dropped) {
    const [one, many] = itemLabel(e)
    const c = counts.get(one) || { n: 0, many }
    c.n += 1
    counts.set(one, c)
  }
  const parts = Array.from(counts.entries()).map(([one, c]) => (c.n === 1 ? `1 ${one}` : `${c.n} ${c.many}`))
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}` : parts[0]
  const n = dropped.length
  // One rejected note or task: quote its start so it can be retyped.
  const text = n === 1 && typeof dropped[0].row?.text === 'string' ? dropped[0].row.text.trim() : ''
  const quote = text ? ` ("${text.length > 40 ? `${text.slice(0, 40).trimEnd()}…` : text}")` : ''
  return {
    title: n === 1 ? "1 offline item didn't sync" : `${n} offline items didn't sync`,
    description: `The server rejected ${list}${quote}. Please enter ${n === 1 ? 'it' : 'them'} again.`,
  }
}

/**
 * Drain the signed in user's queue oldest-first. Stops at the first
 * network failure. Returns how many entries actually landed.
 */
export async function flushOutbox(): Promise<number> {
  if (flushing) return 0
  if (typeof navigator !== 'undefined' && navigator.onLine === false) return 0
  flushing = true
  const startGeneration = generation
  let result: DrainResult = { synced: [], dropped: [] }
  try {
    // Every tab focus lands here; an empty queue needs no session read
    // and no getAll() of queued blobs.
    if ((await outboxSize()) === 0) return 0
    // No session, no drain: every entry waits for its owner.
    const userId = await sessionUserId(5000)
    if (!userId) return 0
    result = await drainQueue(await allEntries(), userId, {
      drain: drainEntry,
      remove: deleteEntry,
      cancelled: () => generation !== startGeneration,
    })
  } finally {
    flushing = false
    emit()
  }
  const { synced, dropped } = result

  // Contacts whose cost rollup must be recomputed after draining :
  // an expense/sub that synced from the outbox otherwise leaves
  // fh_contacts.cost (and margin) stale until an unrelated recalc.
  const recalcContacts = new Map<string, string>() // contactId → userId
  for (const e of synced) {
    if (e.kind === 'insert' && (e.table === 'fh_expenses' || e.table === 'fh_subs') && e.row?.contact_id && e.row?.user_id) {
      recalcContacts.set(e.row.contact_id, e.row.user_id)
    }
  }
  if (recalcContacts.size > 0) {
    try {
      const { recalcCost } = await import('./stages.ts')
      for (const [contactId, uid] of recalcContacts) {
        await recalcCost(contactId, uid).catch(() => {})
      }
    } catch { /* non-fatal */ }
  }
  if (synced.length > 0) {
    const n = synced.length
    toastSuccess('Back online', `${n} offline ${n === 1 ? 'item' : 'items'} synced`)
  }
  if (dropped.length > 0) {
    console.warn('[fieldhorse] outbox entries rejected by the server, dropped', dropped)
    const { title, description } = describeDropped(dropped)
    toastError(title, description)
  }
  return synced.length
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
