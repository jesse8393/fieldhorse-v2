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
  keepPreviousData,
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

// ---- Clients ----
// The Clients screen needs three datasets to compute live rollups:
// the client roster, every job (for lifetime / active counts), and
// every payment (for outstanding). Bundled into one hook so the
// screen gets a single loading flag, matching its prior behavior.

export type ClientsBundle = {
  clients: Client[]
  jobs: Pick<Contact, 'id' | 'client_id' | 'amount' | 'stage'>[]
  payments: Pick<Payment, 'contact_id' | 'amount'>[]
}

async function fetchClientsBundle(userId: string): Promise<ClientsBundle> {
  const [clientsRes, jobsRes, paymentsRes] = await Promise.all([
    supabase
      .from('fh_clients')
      .select('*')
      .eq('user_id', userId)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase
      .from('fh_contacts')
      .select('id, client_id, amount, stage')
      .eq('user_id', userId),
    supabase
      .from('fh_payments')
      .select('contact_id, amount')
      .eq('user_id', userId)
  ])
  if (clientsRes.error) throw clientsRes.error
  return {
    clients: (clientsRes.data ?? []) as Client[],
    jobs: (jobsRes.data ?? []) as ClientsBundle['jobs'],
    payments: (paymentsRes.data ?? []) as ClientsBundle['payments']
  }
}

export function useClientsBundle(userId: string | undefined) {
  return useQuery({
    queryKey: [...queryKeys.clients, userId],
    queryFn: () => fetchClientsBundle(userId as string),
    enabled: !!userId
  })
}

export function useInvalidateClients() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: queryKeys.clients })
}

// ---- Schedule ----
// Two queries: range-scoped events for the current day/week/month grid,
// and a fixed "next 7 days" upcoming list. Range bounds are passed as
// ISO strings so the query key stays serializable.

export type ScheduleEvent =
  Database['public']['Tables']['fh_schedule']['Row'] & {
    fh_contacts: Pick<Contact, 'name' | 'stage'> | null
  }

async function fetchScheduleRange(userId: string, startIso: string, endIso: string): Promise<ScheduleEvent[]> {
  const { data, error } = await supabase
    .from('fh_schedule')
    .select('*, fh_contacts(name, stage)')
    .eq('user_id', userId)
    .gte('start_at', startIso)
    .lt('start_at', endIso)
    .order('start_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ScheduleEvent[]
}

export function useScheduleEvents(userId: string | undefined, startIso: string, endIso: string) {
  return useQuery({
    queryKey: ['schedule', userId, startIso, endIso],
    queryFn: () => fetchScheduleRange(userId as string, startIso, endIso),
    enabled: !!userId,
    // Keep the prior range's events on screen while a view switch
    // (day→week→month) refetches, matching the old setLoading guard.
    placeholderData: keepPreviousData
  })
}

async function fetchUpcoming(userId: string): Promise<ScheduleEvent[]> {
  const now = new Date()
  const in7 = new Date(now)
  in7.setDate(in7.getDate() + 7)
  in7.setHours(0, 0, 0, 0)
  const { data, error } = await supabase
    .from('fh_schedule')
    .select('*, fh_contacts(name, stage)')
    .eq('user_id', userId)
    .gte('start_at', now.toISOString())
    .lt('start_at', in7.toISOString())
    .order('start_at', { ascending: true })
    .limit(8)
  if (error) throw error
  return (data ?? []) as ScheduleEvent[]
}

export function useUpcomingEvents(userId: string | undefined) {
  return useQuery({
    queryKey: ['scheduleUpcoming', userId],
    queryFn: () => fetchUpcoming(userId as string),
    enabled: !!userId
  })
}

// Invalidate both schedule queries (range + upcoming) after a mutation.
export function useInvalidateSchedule() {
  const client = useQueryClient()
  return () => {
    client.invalidateQueries({ queryKey: ['schedule'] })
    client.invalidateQueries({ queryKey: ['scheduleUpcoming'] })
  }
}

// Optimistically drop a deleted event from every cached schedule query
// (range + upcoming) so it vanishes immediately, before the server
// round-trip — replaces the old setEvents/setUpcoming filters.
export function useDropScheduleEvent() {
  const client = useQueryClient()
  return (evtId: string) => {
    const drop = (rows: ScheduleEvent[] | undefined) =>
      (rows ?? []).filter((e) => e.id !== evtId)
    client.setQueriesData({ queryKey: ['schedule'] }, drop)
    client.setQueriesData({ queryKey: ['scheduleUpcoming'] }, drop)
  }
}

// ---- Activity feed ----
// Global cross-job event feed. The hook fetches the 5 raw datasets;
// the screen maps them into display events (with icon components) in a
// useMemo so React component refs stay out of the query cache.

export type ActivityBundle = {
  transitions: Database['public']['Tables']['fh_stage_transitions']['Row'][]
  payments: Database['public']['Tables']['fh_payments']['Row'][]
  changeOrders: Database['public']['Tables']['fh_change_orders']['Row'][]
  invoices: Database['public']['Tables']['fh_invoices']['Row'][]
  contacts: Pick<Contact, 'id' | 'name' | 'job_title' | 'stage'>[]
}

async function fetchActivity(userId: string, pageSize: number): Promise<ActivityBundle> {
  const [transitions, payments, changeOrders, invoices, contacts] = await Promise.all([
    supabase.from('fh_stage_transitions')
      .select('id, contact_id, from_stage, to_stage, transitioned_at, user_id')
      .eq('user_id', userId).order('transitioned_at', { ascending: false }).limit(pageSize),
    supabase.from('fh_payments')
      .select('id, contact_id, amount, method, kind, paid_on, created_at, user_id')
      .eq('user_id', userId).order('paid_on', { ascending: false }).limit(pageSize),
    supabase.from('fh_change_orders')
      .select('id, contact_id, sequence_number, title, amount, status, approved_at, created_at, user_id')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(pageSize),
    supabase.from('fh_invoices')
      .select('id, contact_id, sequence_number, title, amount, status, issued_at, created_at, user_id')
      .eq('user_id', userId).order('created_at', { ascending: false }).limit(pageSize),
    supabase.from('fh_contacts')
      .select('id, name, job_title, stage')
      .eq('user_id', userId).order('updated_at', { ascending: false }).limit(pageSize * 2)
  ])
  return {
    transitions: (transitions.data ?? []) as ActivityBundle['transitions'],
    payments: (payments.data ?? []) as ActivityBundle['payments'],
    changeOrders: (changeOrders.data ?? []) as ActivityBundle['changeOrders'],
    invoices: (invoices.data ?? []) as ActivityBundle['invoices'],
    contacts: (contacts.data ?? []) as ActivityBundle['contacts']
  }
}

export function useActivityFeed(userId: string | undefined, pageSize = 60) {
  return useQuery({
    queryKey: ['activity', userId, pageSize],
    queryFn: () => fetchActivity(userId as string, pageSize),
    enabled: !!userId
  })
}

// ---- Invoices / AR ----
// Two datasets: jobs in the active money pipeline (with the joined
// fh_clients fallback fields) and every payment (for per-job paid
// rollups + month-to-date collection pace). Bundled so the screen
// keeps a single loading flag, matching its prior behavior.

export type InvoiceJob = Contact & {
  fh_clients: Pick<Client, 'name' | 'email' | 'phone' | 'address'> | null
}

export type InvoicesBundle = {
  jobs: InvoiceJob[]
  payments: Payment[]
}

async function fetchInvoicesBundle(userId: string): Promise<InvoicesBundle> {
  const [jobsRes, paymentsRes] = await Promise.all([
    supabase
      .from('fh_contacts')
      .select('*, fh_clients(name, email, phone, address)')
      .eq('user_id', userId)
      .in('stage', ['job', 'invoice', 'closed'])
      .order('created_at', { ascending: false }),
    supabase
      .from('fh_payments')
      .select('*')
      .eq('user_id', userId)
  ])
  if (jobsRes.error) throw jobsRes.error
  if (paymentsRes.error) throw paymentsRes.error
  return {
    jobs: (jobsRes.data ?? []) as InvoiceJob[],
    payments: (paymentsRes.data ?? []) as Payment[]
  }
}

export function useInvoicesBundle(userId: string | undefined) {
  return useQuery({
    queryKey: ['invoices', userId],
    queryFn: () => fetchInvoicesBundle(userId as string),
    enabled: !!userId
  })
}

export function useInvalidateInvoices() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ['invoices'] })
}
