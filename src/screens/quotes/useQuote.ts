// One quote and its client, read by id (Phase 9, Task 10). The quote
// screens all read through here: the detail, the terms, the preview and the
// approval. `patch` writes fh_quotes and keeps the row on screen in step,
// rolling back with a toast when the write fails, the way the job page's
// patch does. A failed first read is `failed`, never an empty quote. Only
// the latest read sets anything (decision D49).
//
// The read is a TanStack query under the same key the rest of the app
// invalidates (['quote', id]), so it is kept in the offline cache. It runs
// on every open, as before, but whatever is cached shows meanwhile: this
// quote from an earlier open, or its row in the quotes list, so opening a
// quote from the list never waits on the network. It reads once, with no
// retry and no refetch on focus, so a failed read says so at once and a
// form on screen is never swapped for an error behind the user's back.

import { useCallback } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from '../../lib/supabase.ts'
import { toastError } from '../../lib/toast.ts'
import { invalidateAfterQuoteWrite } from '../../lib/quotes.ts'
import { quoteKey } from '../../lib/queries.ts'
import { QUOTE_SELECT, type QuoteWithClient } from './quoteShape.ts'
import type { Database } from '../../lib/database.types.ts'
import { plainError } from '../../lib/serviceErrors.ts'

type QuoteUpdate = Database['public']['Tables']['fh_quotes']['Update']

export type QuoteState =
  | { status: 'loading'; quote: null }
  | { status: 'ready'; quote: QuoteWithClient }
  // The id is not a quote: a moved contact id, or a row that is gone.
  | { status: 'missing'; quote: null }
  | { status: 'failed'; quote: QuoteWithClient | null; message: string }

async function fetchQuote(id: string): Promise<QuoteWithClient | null> {
  const { data, error } = await supabase
    .from('fh_quotes')
    .select(QUOTE_SELECT)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  return (data as unknown as QuoteWithClient | null) ?? null
}

/** The quote's row in a cached quotes list, with when that list was read. */
export function quoteFromCachedList(queryClient: QueryClient, id: string): { quote: QuoteWithClient; updatedAt: number } | null {
  for (const [key, rows] of queryClient.getQueriesData<QuoteWithClient[]>({ queryKey: ['quotes'] })) {
    const quote = Array.isArray(rows) ? rows.find((row) => row?.id === id) : undefined
    if (quote) return { quote, updatedAt: queryClient.getQueryState(key)?.dataUpdatedAt ?? 0 }
  }
  return null
}

export function useQuote(id: string | undefined) {
  const queryClient = useQueryClient()
  const query = useQuery({
    queryKey: quoteKey(id),
    queryFn: () => fetchQuote(id as string),
    enabled: !!id,
    // The list's row stands in until this quote's own read lands.
    initialData: () => (id ? quoteFromCachedList(queryClient, id)?.quote : undefined),
    initialDataUpdatedAt: () => (id ? quoteFromCachedList(queryClient, id)?.updatedAt : undefined),
    refetchOnMount: 'always',
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    retry: false,
  })

  const { refetch } = query
  const refresh = useCallback(async () => { await refetch() }, [refetch])

  const patch = useCallback(async (updates: QuoteUpdate): Promise<{ error: { message: string } | null }> => {
    if (!id) return { error: { message: 'No quote' } }
    const key = quoteKey(id)
    // A read already on its way would land on top of the change on screen.
    await queryClient.cancelQueries({ queryKey: key })
    const before = queryClient.getQueryData<QuoteWithClient | null>(key) ?? null
    if (before) queryClient.setQueryData<QuoteWithClient | null>(key, { ...before, ...updates } as QuoteWithClient)
    const { data, error } = await supabase.from('fh_quotes').update(updates).eq('id', id).select('id')
    // A write that matched no row saved nothing: the quote was deleted or
    // changed elsewhere, so it is never reported as saved.
    const message = error ? plainError(error, 'The change was not saved. Try again.') : !data || data.length === 0 ? 'This quote changed on another device. Check it and try again.' : null
    if (message) {
      if (before) queryClient.setQueryData<QuoteWithClient | null>(key, (current) => (current ? before : current))
      toastError("Couldn't save the quote", message)
      return { error: { message } }
    }
    invalidateAfterQuoteWrite(queryClient, { quoteId: id, leadId: before?.lead_id, clientId: before?.client_id })
    return { error: null }
  }, [id, queryClient])

  return { ...stateOf(id, query), refresh, patch }
}

function stateOf(
  id: string | undefined,
  query: { data: QuoteWithClient | null | undefined; error: Error | null; isError: boolean }
): QuoteState {
  if (!id) return { status: 'missing', quote: null }
  if (query.isError) return { status: 'failed', quote: query.data ?? null, message: query.error?.message || "Couldn't load the quote" }
  if (query.data === undefined) return { status: 'loading', quote: null }
  if (query.data === null) return { status: 'missing', quote: null }
  return { status: 'ready', quote: query.data }
}
