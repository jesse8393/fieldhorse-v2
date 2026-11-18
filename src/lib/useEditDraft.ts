// An edit that survives leaving the screen (D23 for edits). The form
// follows the saved record until the person changes something; from then
// on the changes are a draft stored under fh:draft:<kind> with the saved
// value they started from. Back, a reload, a stray tab tap or the phone's
// Back keep it, and the screen restores it when it opens again, unless the
// record was saved differently in the meantime, which makes it stale.
//
// kind names the record and the field, such as edit:quote-terms:<quoteId>.
// Pass null until the record has loaded, so a draft is never compared with
// a record that is not there yet. `from` is what decides staleness when it
// is not the form itself: a new record passes a constant, so a draft
// typed for it always comes back.

import { useCallback, useEffect, useRef, useState } from 'react'
import { clearDraft, sameDraft, startEdit, writeDraft } from './drafts.ts'

const WRITE_MS = 400

type State<T> = {
  kind: string | null
  /** The person's changes, or null while the form shows the saved record. */
  form: T | null
  /** The saved value the changes started from. */
  from: unknown
  /** The changes came back from storage when the screen opened. */
  restored: boolean
  /** Values the screen filled in itself, shown while nothing is typed. */
  auto: Partial<T>
}

function init<T extends Record<string, unknown>>(kind: string | null, base: T, from: unknown): State<T> {
  const start = kind ? startEdit(kind, base, from) : null
  return start
    ? { kind, form: start.form, from, restored: true, auto: {} }
    : { kind, form: null, from: null, restored: false, auto: {} }
}

/** Only what differs from the saved form, so a fresh default (a new visit's time) is not pinned. */
function changes<T extends Record<string, unknown>>(form: T, base: T): Partial<T> {
  const out: Partial<T> = {}
  for (const key of Object.keys(form) as (keyof T)[]) {
    if (!sameDraft(form[key], base[key])) out[key] = form[key]
  }
  return out
}

export function useEditDraft<T extends Record<string, unknown>>(kind: string | null, base: T, options: { from?: unknown } = {}) {
  const from = 'from' in options ? options.from : base
  const [state, setState] = useState<State<T>>(() => init(kind, base, from))
  let current = state
  if (state.kind !== kind) {
    // Typed before the record finished loading: keep it. Another record:
    // start again from that one.
    current = state.kind === null && state.form
      ? { ...state, kind, from: state.from ?? from }
      : init(kind, base, from)
    setState(current)
  }
  const clean = { ...base, ...current.auto }
  const form = current.form ?? clean

  const latest = useRef({ base, from, kind: current.kind })
  latest.current = { base, from, kind: current.kind }

  // The change the timer has not written yet. Leaving the screen, or the
  // page going away, writes it at once, so the last words typed before
  // Back or a reload are kept.
  const pending = useRef<{ kind: string; form: Partial<T>; from: unknown } | null>(null)
  useEffect(() => {
    const before = pending.current
    if (before && before.kind !== state.kind) writeDraft(before.kind, before.form, before.from)
    pending.current = null
    if (!state.kind) return
    if (!state.form) {
      clearDraft(state.kind)
      return
    }
    const next = { kind: state.kind, form: changes(state.form, latest.current.base), from: state.from }
    pending.current = next
    const t = setTimeout(() => {
      pending.current = null
      writeDraft(next.kind, next.form, next.from)
    }, WRITE_MS)
    return () => clearTimeout(t)
  }, [state.kind, state.form, state.from])
  useEffect(() => {
    function flush() {
      const last = pending.current
      pending.current = null
      if (last) writeDraft(last.kind, last.form, last.from)
    }
    // A reload or a closed tab never unmounts the screen.
    window.addEventListener('pagehide', flush)
    return () => {
      window.removeEventListener('pagehide', flush)
      flush()
    }
  }, [])

  /** A change the person made. */
  const update = useCallback((change: (f: T) => T) => {
    setState((s) => {
      const shown = { ...latest.current.base, ...s.auto }
      const next = change(s.form ?? shown)
      // Back to what is saved: nothing left to keep.
      if (sameDraft(next, shown)) return { ...s, form: null, from: null, restored: false }
      return { ...s, form: next, from: s.form ? s.from : latest.current.from }
    })
  }, [])
  const set = useCallback(<K extends keyof T>(key: K, value: T[K]) => {
    update((f) => ({ ...f, [key]: value }))
  }, [update])
  const patch = useCallback((values: Partial<T>) => {
    update((f) => ({ ...f, ...values }))
  }, [update])
  /** A value the screen fills in itself, such as a where line from the linked job. It never counts as typed. */
  const follow = useCallback((values: Partial<T>) => {
    setState((s) => s.form ? { ...s, form: { ...s.form, ...values } } : { ...s, auto: { ...s.auto, ...values } })
  }, [])

  /** Forget the changes: when the person discards them. */
  const reset = useCallback(() => {
    pending.current = null
    if (latest.current.kind) clearDraft(latest.current.kind)
    setState((s) => ({ ...s, form: null, from: null, restored: false }))
  }, [])
  /**
   * The changes were saved: forget the stored copy. With keep, the form
   * goes on showing them (a message sent that may be sent again), and only
   * new changes are stored.
   */
  const done = useCallback((options: { keep?: boolean } = {}) => {
    pending.current = null
    if (latest.current.kind) clearDraft(latest.current.kind)
    setState((s) => ({ ...s, form: null, from: null, restored: false, auto: options.keep && s.form ? { ...s.auto, ...s.form } : s.auto }))
  }, [])

  return {
    form,
    set,
    patch,
    update,
    follow,
    /** True while the form holds changes that are not saved. */
    dirty: current.form != null,
    /** The changes were brought back when the screen opened. */
    restored: current.restored && current.form != null,
    done,
    discard: reset,
  }
}
