// mobile/lib/queries.ts
//
// RN query hooks — same shapes as the web app's src/lib/queries.ts.
// The only difference is the supabase import (RN client w/ AsyncStorage)
// and no cover-photo signing (mobile uses a separate native image flow).
//
// In the monorepo extraction these and the web hooks collapse into one
// packages/shared/queries.ts that both apps import — the queryFns are
// already platform-agnostic; only the client import differs.

import { useEffect } from 'react'
import { useQuery, useQueryClient, type QueryClient } from '@tanstack/react-query'
import { supabase } from './supabase'
import type { Database } from './database.types'

export type Contact = Database['public']['Tables']['fh_contacts']['Row']
export type Client = Database['public']['Tables']['fh_clients']['Row']

export type JobRow = Contact & {
  fh_clients: Pick<Client, 'name' | 'phone' | 'email'> | null
}

export const queryKeys = {
  jobs: ['jobs'] as const,
  clients: ['clients'] as const
}

async function fetchJobs(): Promise<JobRow[]> {
  const { data, error } = await supabase
    .from('fh_contacts')
    .select('*, fh_clients(name, phone, email)')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as JobRow[]
}

export function useJobs() {
  return useQuery({ queryKey: queryKeys.jobs, queryFn: fetchJobs })
}

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
