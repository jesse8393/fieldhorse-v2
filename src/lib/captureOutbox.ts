// src/lib/captureOutbox.ts
//
// Dead-zone insurance for Universal Capture. When a capture is taken
// with no signal, the raw text is queued in localStorage; the next time
// the app is online it lands as a note (with its original timestamp in
// the body) so nothing said in the field is ever lost. Notes only :
// money rows and schedule events need the operator's confirmed intent,
// which needs the AI round trip.

import { supabase } from './supabase.ts'

const KEY = 'fh:capture-outbox'

type OutboxItem = { text: string; captured_at: string }

function read(): OutboxItem[] {
  try {
    const raw = localStorage.getItem(KEY)
    const arr = raw ? JSON.parse(raw) : []
    return Array.isArray(arr) ? arr.filter((i) => i && typeof i.text === 'string') : []
  } catch {
    return []
  }
}

function write(items: OutboxItem[]) {
  try { localStorage.setItem(KEY, JSON.stringify(items.slice(0, 100))) } catch {}
}

export function pushOutbox(text: string) {
  const t = (text || '').trim()
  if (!t) return
  write([...read(), { text: t, captured_at: new Date().toISOString() }])
}

export function outboxCount(): number {
  return read().length
}

/**
 * flushOutbox, drain queued captures into fh_notes. Items that fail
 * to insert stay queued for the next attempt. Returns how many synced.
 */
export async function flushOutbox(userId: string): Promise<number> {
  const items = read()
  if (!items.length || !userId) return 0
  const remaining: OutboxItem[] = []
  let synced = 0
  for (const item of items) {
    const when = new Date(item.captured_at)
    const stamp = Number.isNaN(when.getTime())
      ? ''
      : ` (captured offline ${when.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })})`
    const { error } = await supabase.from('fh_notes').insert({
      user_id: userId,
      contact_id: null,
      text: `${item.text}${stamp}`,
      category: 'note'
    })
    if (error) remaining.push(item)
    else synced += 1
  }
  write(remaining)
  return synced
}
