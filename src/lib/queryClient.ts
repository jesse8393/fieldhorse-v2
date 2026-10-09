// src/lib/queryClient.ts
//
// Single TanStack Query client for the app. Mounted at the root via
// QueryClientProvider in main.jsx. Defaults tuned for a Supabase-backed
// field tool: data is fresh for 30s (avoids refetch storms while a
// contractor taps around), cached 5min, retries once, and refetches on
// window focus so coming back to the PWA shows current data.
//
// Adopting Query incrementally, screens migrate off the manual
// useEffect + fetchAll pattern one at a time. See src/lib/queries.ts
// for the typed hooks.

import { QueryClient } from '@tanstack/react-query'

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      // Seven days, matching the persister's maxAge in main.tsx. TanStack's
      // persistence guidance is gcTime at least as long as maxAge, or a
      // query collected from memory drops out of the next persisted
      // snapshot and an offline cold open finds nothing. Memory cost is
      // modest: these are row lists, not blobs.
      gcTime: 7 * 24 * 60 * 60 * 1000,
      retry: 1,
      refetchOnWindowFocus: true,
      refetchOnReconnect: true
    },
    mutations: {
      retry: 0
    }
  }
})
