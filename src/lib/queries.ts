// src/lib/queries.ts
//
// Typed TanStack Query hooks layer. First file in the TypeScript +
// Query migration — replaces the hand-rolled `useEffect` +
// `supabase.from().select()` + manual loading/error/refetch pattern
// that was duplicated across every screen.
//
// Each hook is keyed so mutations elsewhere can invalidate precisely.
// The realtime subscription helpers invalidate the relevant key so the
// list stays live without a manual refreshTick counter.
//
// Reuse target: these hooks are platform-agnostic (plain Supabase +
// Query), so the future Expo app imports them verbatim.

import { useEffect } from 'react'
import {
  useQuery,
  useQueryClient,
  type QueryClient
} from '@tanstack/react-query'
import { supabase } from './supabase.js'
import { fetchCoverPhotosByJob } from './photos.js'
import type { Database } from './database.types.ts'

export type Contact = Database['public']['Tables']['fh_contacts']['Row']
export type Client = Database['public']['Tables']['fh_clients']['Row']
export type Payment = Database['public']['Tables']['fh_payments']['Row']

// A job row with the embedded client contact info the Jobs list needs.
export type JobRow = Contact & {
  fh_clients: Pick<Client, 'name' | 'phone' | 'email'> | null
}

export const queryKeys = {
  jobs: ['jobs'] as const,
  jobPhotos: ['jobPhotos'] as const,
  clients: ['clients'] as const,
  payments: ['payments'] as const
}

// ---- Jobs ----

async function fetchJobs(): Promise<JobRow[]> {
  // No JS-layer user_id filter — RLS (owner + partner-read) is the
  // enforcement layer, matching the prior Jobs.load behavior so
  // partner-shared jobs still surface.
  const { data, error } = await supabase
    .from('fh_contacts')
    .select('*, fh_clients(name, phone, email)')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as JobRow[]
}

export function useJobs() {
  return useQuery({
    queryKey: queryKeys.jobs,
    queryFn: fetchJobs
  })
}

// Cover photos keyed separately so a contacts refetch doesn't re-sign
// every photo URL. userId is required to scope the storage lookup.
export function useJobPhotos(userId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.jobPhotos, userId],
    queryFn: () => fetchCoverPhotosByJob(userId as string),
    enabled: !!userId,
    staleTime: 5 * 60_000
  })
}

// Subscribe to Supabase Realtime for the user's fh_contacts and
// invalidate the jobs query on any change. Replaces the manual
// refreshTick counter in Jobs.jsx. Call once from the Jobs screen.
export function useJobsRealtime(userId: string | undefined, client: QueryClient) {
  useEffect(() => {
    if (!userId) return
    const channel = supabase
      .channel(`fh_contacts:jobs:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fh_contacts', filter: `user_id=eq.${userId}` },
        () => client.invalidateQueries({ queryKey: queryKeys.jobs })
      )
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [userId, client])
}

// Convenience: invalidate jobs from anywhere (e.g. after a mutation).
export function useInvalidateJobs() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: queryKeys.jobs })
}
