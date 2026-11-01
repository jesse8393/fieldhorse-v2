// mobile/lib/queryClient.ts, same defaults as the web client.
import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      gcTime: 5 * 60_000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true,
      // The root retry boundary renders failed initial reads instead of screens
      // silently substituting empty arrays and $0. Stale data remains visible.
      throwOnError: (_error, query) => query.state.data === undefined
    },
    mutations: { retry: 0 }
  }
})
