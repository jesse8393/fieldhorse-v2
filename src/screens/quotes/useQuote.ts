// One quote and its client, read by id (Phase 9, Task 10). The quote
// screens all read through here: the detail, the terms, the preview and the
// approval. `patch` writes fh_quotes and keeps the row on screen in step,
// rolling back with a toast when the write fails, the way the job page's
// patch does. A failed first read is `failed`, never an empty quote. Only
// the latest read sets anything (decision D49).

import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../../lib/supabase.ts'
import { toastError } from '../../lib/toast.ts'
import { QUOTE_SELECT, type QuoteWithClient } from './quoteShape.ts'
import type { Database } from '../../lib/database.types.ts'

type QuoteUpdate = Database['public']['Tables']['fh_quotes']['Update']

export type QuoteState =
  | { status: 'loading'; quote: null }
  | { status: 'ready'; quote: QuoteWithClient }
  // The id is not a quote: a moved contact id, or a row that is gone.
  | { status: 'missing'; quote: null }
  | { status: 'failed'; quote: QuoteWithClient | null; message: string }

export function useQuote(id: string | undefined) {
  const [state, setState] = useState<QuoteState>({ status: 'loading', quote: null })
  const seq = useRef(0)

  const load = useCallback(async () => {
    if (!id) { setState({ status: 'missing', quote: null }); return }
    const mine = ++seq.current
    const { data, error } = await supabase
      .from('fh_quotes')
      .select(QUOTE_SELECT)
      .eq('id', id)
      .maybeSingle()
    if (mine !== seq.current) return
    if (error) {
      setState((s) => ({ status: 'failed', quote: s.quote, message: error.message }))
      return
    }
    if (!data) { setState({ status: 'missing', quote: null }); return }
    setState({ status: 'ready', quote: data as unknown as QuoteWithClient })
  }, [id])

  useEffect(() => {
    seq.current += 1
    setState({ status: 'loading', quote: null })
    void load()
  }, [load])

  const patch = useCallback(async (updates: QuoteUpdate): Promise<{ error: { message: string } | null }> => {
    if (!id) return { error: { message: 'No quote' } }
    let before: QuoteWithClient | null = null
    setState((s) => {
      if (!s.quote) return s
      before = s.quote
      return { ...s, quote: { ...s.quote, ...updates } as QuoteWithClient }
    })
    const { error } = await supabase.from('fh_quotes').update(updates).eq('id', id)
    if (error) {
      const saved = before
      if (saved) setState((s) => (s.quote ? { ...s, quote: saved } : s))
      toastError("Couldn't save the quote", error.message)
      return { error: { message: error.message } }
    }
    return { error: null }
  }, [id])

  return { ...state, refresh: load, patch }
}
