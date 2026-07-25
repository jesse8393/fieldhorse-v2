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
import { supabase } from './supabase.ts'
import { fetchCoverPhotosByJob } from './photos.ts'
import { loadPartnerDirectory } from './partners.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import type { Database } from './database.types.ts'

export type Contact = Database['public']['Tables']['fh_contacts']['Row']
export type Client = Database['public']['Tables']['fh_clients']['Row']
export type Payment = Database['public']['Tables']['fh_payments']['Row']

// The columns the Work list (and desktop rail) actually render. Keeping
// this a projection instead of `*` cuts each row to a fraction of its
// full width — fh_contacts carries big text fields (notes, scope,
// proposal HTML) that the list never shows.
export const JOB_LIST_COLUMNS =
  'id, user_id, client_id, name, phone, email, address, stage, amount, job_title, job_type, referred_by, proposal_status, follow_up_on, updated_at, created_at'

export type JobRow = Pick<
  Contact,
  | 'id' | 'user_id' | 'client_id' | 'name' | 'phone' | 'email' | 'address'
  | 'stage' | 'amount' | 'job_title' | 'job_type' | 'referred_by'
  | 'proposal_status' | 'follow_up_on' | 'updated_at' | 'created_at'
> & {
  fh_clients: Pick<Client, 'name' | 'phone' | 'email'> | null
}

export const queryKeys = {
  jobs: ['jobs'] as const,
  jobPhotos: ['jobPhotos'] as const,
  clients: ['clients'] as const,
  payments: ['payments'] as const
}

// PostgREST caps every response at the server's max-rows (Supabase
// default: 1000) even when no .limit() is set — so the "deliberately
// uncapped" aggregate fetches below were silently losing their oldest
// rows past 1000 (payments dropped from A/R sums, jobs from rollups).
// This pages through .range() windows until a short page arrives.
// Callers MUST give the query a stable order (we pass an id tiebreak)
// or pages can overlap/skip under concurrent writes.
const FETCH_PAGE = 1000
export async function fetchAllRows<T>(
  build: (from: number, to: number) => PromiseLike<{ data: unknown[] | null; error: { message: string } | null }>
): Promise<T[]> {
  const out: T[] = []
  for (let from = 0; ; from += FETCH_PAGE) {
    const { data, error } = await build(from, from + FETCH_PAGE - 1)
    if (error) throw error
    const rows = (data ?? []) as T[]
    out.push(...rows)
    if (rows.length < FETCH_PAGE) break
  }
  return out
}

// The jobs list is user-scoped so a device that switches accounts (sign
// out → sign in as someone else) can never read the prior user's cached
// list. All readers/invalidators derive the key from the current auth
// user via this helper. A bare ['jobs'] prefix still matches for broad
// invalidation (TanStack does prefix matching), but reads + optimistic
// setQueryData must use the exact user-scoped key.
export function jobsKey(userId: string | undefined) {
  return ['jobs', userId ?? null] as const
}

// ---- Jobs ----

async function fetchJobs(): Promise<JobRow[]> {
  // No JS-layer user_id filter — RLS (owner + partner-read) is the
  // enforcement layer, matching the prior Jobs.load behavior so
  // partner-shared jobs still surface. Partner-shared rows can come
  // back twice — once as the owner's row, once via the partnership
  // join — so dedupe by id before returning, mirroring the Home
  // pipeline dedupe in screens/Home.tsx.
  const { data, error } = await supabase
    .from('fh_contacts')
    .select(`${JOB_LIST_COLUMNS}, fh_clients(name, phone, email)`)
    .order('updated_at', { ascending: false })
    // Sanity ceiling: 2000 most-recently-touched deals is far beyond what
    // the list UX can present; without it one giant book turns every
    // refetch into a multi-MB payload. Older rows stay reachable via
    // search-by-detail routes and the client roster.
    .limit(2000)
  if (error) throw error
  const rows = (data ?? []) as JobRow[]
  const byId = new Map<string, JobRow>()
  for (const r of rows) {
    if (r?.id && !byId.has(r.id)) byId.set(r.id, r)
  }
  return Array.from(byId.values())
}

export function useJobs() {
  // Derive the user id here (rather than as a param) so every caller —
  // Work, the desktop DetailListRail — shares the one user-scoped key
  // without each having to thread the id through.
  const { user } = useAuth()
  return useQuery({
    queryKey: jobsKey(user?.id),
    queryFn: fetchJobs,
    enabled: !!user?.id,
    staleTime: 30_000
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
    // Debounce: a bulk stage change or import can fire many contact events
    // in a row; coalesce them into one refetch instead of one per row.
    let debounce: ReturnType<typeof setTimeout> | null = null
    const invalidate = () => {
      if (debounce) clearTimeout(debounce)
      debounce = setTimeout(() => client.invalidateQueries({ queryKey: jobsKey(userId) }), 1200)
    }
    // NO user_id filter: fetchJobs deliberately omits the user_id filter
    // so RLS can surface partner-shared jobs. A `user_id=eq.${userId}`
    // channel filter would only fire for the user's OWN rows, so a
    // partner-owned shared job changing never invalidated the list. A
    // table-level subscription (RLS still scopes which change events this
    // user receives) fixes that; the existing 1200ms debounce coalesces
    // the extra volume into one refetch.
    const channel = supabase
      .channel(`fh_contacts:jobs:${userId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'fh_contacts' },
        invalidate
      )
      .subscribe()
    return () => { if (debounce) clearTimeout(debounce); supabase.removeChannel(channel) }
  }, [userId, client])
}

// ---- Server-side deal search ----
// The list query is capped at the 2000 most-recently-touched rows; this
// hook lets the Work search box reach the WHOLE book. Runs a projected
// ilike across the fields the operator actually types (name, phone,
// email, address, title, type, source), newest first, capped at 100 hits.
// The screen merges these with the cached list (dedupe by id), so recent
// rows stay instant and older rows stream in behind them.
export function useJobSearch(term: string) {
  // PostgREST or() syntax delimits with commas/parens, and % _ \ are
  // ilike metacharacters — but simply STRIPPING them broke real
  // searches (ultrareview x5: "(615) 555-1234" became "615  555-1234",
  // which matches nothing). Instead, collapse every run of punctuation
  // or whitespace into a single % wildcard: the pattern
  // %615%555%1234% matches the stored "(615) 555-1234" regardless of
  // formatting, and "john_doe@x" still finds john_doe@x. Still
  // injection-safe: no commas/parens survive into the or() expression.
  const q = term.trim()
  const pattern = '%' + q.replace(/[,()%_\\\s]+/g, '%') + '%'
  return useQuery({
    queryKey: ['jobSearch', pattern],
    queryFn: async (): Promise<JobRow[]> => {
      const like = pattern
      const orExpr = ['name', 'phone', 'email', 'address', 'job_title', 'job_type', 'referred_by']
        .map((c) => `${c}.ilike.${like}`)
        .join(',')
      const { data, error } = await supabase
        .from('fh_contacts')
        .select(`${JOB_LIST_COLUMNS}, fh_clients(name, phone, email)`)
        .or(orExpr)
        .order('updated_at', { ascending: false })
        .limit(100)
      if (error) throw error
      return (data ?? []) as JobRow[]
    },
    enabled: q.length >= 2,
    staleTime: 30_000,
    // Keep prior hits on screen while the next keystroke's query runs.
    placeholderData: keepPreviousData
  })
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
  changeOrders: Pick<Database['public']['Tables']['fh_change_orders']['Row'], 'contact_id' | 'amount' | 'status'>[]
}

async function fetchClientsBundle(userId: string): Promise<ClientsBundle> {
  const [clientsRes, jobs, payments, changeOrders] = await Promise.all([
    supabase
      .from('fh_clients')
      .select('*')
      .eq('user_id', userId)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    fetchAllRows<ClientsBundle['jobs'][number]>((from, to) =>
      supabase
        .from('fh_contacts')
        .select('id, client_id, amount, stage')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<ClientsBundle['payments'][number]>((from, to) =>
      supabase
        .from('fh_payments')
        .select('contact_id, amount')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    // Approved change orders adjust each job's true contract — without
    // them the Clients-list "outstanding" understates any job carrying
    // a signed CO (the statement/A-R surfaces already include them).
    fetchAllRows<ClientsBundle['changeOrders'][number]>((from, to) =>
      supabase
        .from('fh_change_orders')
        .select('contact_id, amount, status')
        .eq('user_id', userId)
        .eq('status', 'approved')
        .order('id', { ascending: true })
        .range(from, to)
    )
  ])
  if (clientsRes.error) throw clientsRes.error
  return {
    clients: (clientsRes.data ?? []) as Client[],
    jobs,
    payments,
    changeOrders
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
  // True when at least one event source returned a full page — i.e. there
  // may be older rows a larger page would surface. The merged feed length
  // can exceed pageSize even when every source is exhausted (4 sources ×
  // pageSize), so the merged count is NOT a valid "has more" signal.
  hasMore: boolean
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
  for (const result of [transitions, payments, changeOrders, invoices, contacts]) {
    if (result.error) throw result.error
  }
  // "More to load" iff one of the four event sources filled its page.
  // (contacts is a lookup table, not an event source — exclude it.)
  const hasMore = [transitions, payments, changeOrders, invoices]
    .some((r) => (r.data?.length ?? 0) >= pageSize)
  return {
    transitions: (transitions.data ?? []) as ActivityBundle['transitions'],
    payments: (payments.data ?? []) as ActivityBundle['payments'],
    changeOrders: (changeOrders.data ?? []) as ActivityBundle['changeOrders'],
    invoices: (invoices.data ?? []) as ActivityBundle['invoices'],
    contacts: (contacts.data ?? []) as ActivityBundle['contacts'],
    hasMore
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
// Three datasets: jobs in the active money pipeline (with the joined
// fh_clients fallback fields), every payment (for per-job paid
// rollups + month-to-date collection pace), and — pipeline v2 — the
// first-class fh_invoices rows so the screen can list real issued
// invoices, not just per-job balances. Bundled so the screen keeps a
// single loading flag, matching its prior behavior.

// Projected — the AR screen renders identity/billing fields only; the
// wide text columns on fh_contacts (scope, notes, proposal bodies) never
// appear on this surface.
export const INVOICE_JOB_COLUMNS =
  'id, user_id, client_id, name, email, phone, address, stage, amount, job_title, job_type, completed_at, created_at, updated_at'

export type InvoiceJob = Pick<
  Contact,
  | 'id' | 'user_id' | 'client_id' | 'name' | 'email' | 'phone' | 'address'
  | 'stage' | 'amount' | 'job_title' | 'job_type' | 'completed_at'
  | 'created_at' | 'updated_at'
> & {
  fh_clients: Pick<Client, 'name' | 'email' | 'phone' | 'address'> | null
}

export type InvoiceRecord = Database['public']['Tables']['fh_invoices']['Row']

export type InvoicesBundle = {
  jobs: InvoiceJob[]
  payments: Payment[]
  invoices: InvoiceRecord[]
  changeOrders: Database['public']['Tables']['fh_change_orders']['Row'][]
}

async function fetchInvoicesBundle(userId: string): Promise<InvoicesBundle> {
  const [jobs, payments, invoicesRes, changeOrders] = await Promise.all([
    fetchAllRows<InvoiceJob>((from, to) =>
      supabase
        .from('fh_contacts')
        .select(`${INVOICE_JOB_COLUMNS}, fh_clients(name, email, phone, address)`)
        .eq('user_id', userId)
        .in('stage', ['job', 'invoice', 'closed'])
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    ),
    // Deliberately UNCAPPED, and PAGED past PostgREST's max-rows
    // (default 1000): a cap here silently drops the oldest rows —
    // exactly the most-overdue receivables — understating outstanding
    // totals and the 60+ aging bucket. A/R math must see every row.
    fetchAllRows<Payment>((from, to) =>
      supabase
        .from('fh_payments')
        .select('*')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    supabase
      .from('fh_invoices')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      // Bound the issued-invoice DISPLAY list — the Invoices screen only
      // renders these rows (invoiceRows), it does NOT compute A/R totals
      // from them (totals derive from the uncapped jobs + payments +
      // change-orders sets above). So a huge invoice history no longer
      // ships every row; the 500 most-recent cover the list.
      .limit(500),
    // Approved change orders adjust each job's true contract — needed so
    // "Who owes you" / statements don't understate a job with signed COs.
    fetchAllRows<InvoicesBundle['changeOrders'][number]>((from, to) =>
      supabase
        .from('fh_change_orders')
        .select('contact_id, amount, status')
        .eq('user_id', userId)
        .eq('status', 'approved')
        .order('id', { ascending: true })
        .range(from, to)
    )
  ])
  if (invoicesRes.error) throw invoicesRes.error
  return {
    jobs,
    payments,
    invoices: (invoicesRes.data ?? []) as InvoiceRecord[],
    changeOrders
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

// ---- Subs ----
// The subs roster plus a lightweight contacts list (id/name/job/stage)
// used to label which jobs each sub worked. Bundled into one hook so
// the screen keeps a single loading flag.

export type Sub = Database['public']['Tables']['fh_subs']['Row']
export type SubContact = Pick<Contact, 'id' | 'name' | 'job_title' | 'stage'>

export type SubsBundle = {
  subs: Sub[]
  contacts: SubContact[]
}

export const subsKey = (userId: string | undefined, orgId?: string | null) =>
  ['subs', userId, orgId ?? null] as const

async function fetchSubsBundle(userId: string, orgId?: string | null): Promise<SubsBundle> {
  let subsQuery = supabase
    .from('fh_subs')
    .select('*')
  subsQuery = orgId
    ? subsQuery.eq('org_id', orgId)
    : subsQuery.eq('user_id', userId)

  let contactsQuery = supabase
    .from('fh_contacts')
    .select('id, name, job_title, stage')
  contactsQuery = orgId
    ? contactsQuery.eq('org_id', orgId)
    : contactsQuery.eq('user_id', userId)

  const [subsRes, contactsRes] = await Promise.all([
    subsQuery.order('created_at', { ascending: false }),
    contactsQuery,
  ])
  if (subsRes.error) throw subsRes.error
  if (contactsRes.error) throw contactsRes.error
  return {
    subs: (subsRes.data ?? []) as Sub[],
    contacts: (contactsRes.data ?? []) as SubContact[]
  }
}

export function useSubsBundle(userId: string | undefined, orgId?: string | null) {
  return useQuery({
    queryKey: subsKey(userId, orgId),
    queryFn: () => fetchSubsBundle(userId as string, orgId),
    enabled: !!userId && orgId !== undefined
  })
}

export function useInvalidateSubs(userId?: string, orgId?: string | null) {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: userId ? subsKey(userId, orgId) : ['subs'] })
}

// ---- Notes ----
// The 80 most recent notes plus a slim contacts list (id/name) used to
// tag a note to a job. Bundled so the screen keeps one loading flag.
// The screen mutates optimistically via setQueryData (see useNotesBundle
// callers), so the cache is the single source of truth.

export type Note = Database['public']['Tables']['fh_notes']['Row']
export type NoteContact = Pick<Contact, 'id' | 'name'>

export type NotesBundle = {
  notes: Note[]
  contacts: NoteContact[]
}

async function fetchNotesBundle(userId: string): Promise<NotesBundle> {
  const [notesRes, contactsRes] = await Promise.all([
    supabase
      .from('fh_notes')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
      .limit(80),
    supabase
      .from('fh_contacts')
      .select('id, name')
      .eq('user_id', userId)
      .order('updated_at', { ascending: false })
  ])
  if (notesRes.error) throw notesRes.error
  if (contactsRes.error) throw contactsRes.error
  return {
    notes: (notesRes.data ?? []) as Note[],
    contacts: (contactsRes.data ?? []) as NoteContact[]
  }
}

export function notesKey(userId: string | undefined) {
  return ['notes', userId] as const
}

export function useNotesBundle(userId: string | undefined) {
  return useQuery({
    queryKey: notesKey(userId),
    queryFn: () => fetchNotesBundle(userId as string),
    enabled: !!userId
  })
}

// ---- Partners ----
// The partner directory (one row per partner, with their jobs nested)
// is assembled by loadPartnerDirectory from lib/partners.ts. Wrapped in
// a query so the screen drops its useState/load/useEffect plumbing;
// includeRevoked is fixed so revoked rows can be filtered client-side.

export function usePartnerDirectory(userId: string | undefined) {
  return useQuery({
    queryKey: ['partners', userId],
    queryFn: () => loadPartnerDirectory({ includeRevoked: true }),
    enabled: !!userId
  })
}

export function useInvalidatePartners() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ['partners'] })
}

// ---- Client detail ----
// A dependent fetch: the client row, then every job under that client,
// then the notes/files/payments scoped to those job ids. Folded into a
// single keyed query so the screen drops its two chained effects; the
// metrics (lifetime / outstanding / active) are derived in the screen.

export type ClientJob = Pick<
  Contact,
  'id' | 'name' | 'stage' | 'job_title' | 'job_type' | 'amount' | 'updated_at' | 'created_at'
>

export type ClientDetailBundle = {
  client: Client | null
  jobs: ClientJob[]
  notes: (Database['public']['Tables']['fh_notes']['Row'] & {
    fh_contacts: Pick<Contact, 'name'> | null
  })[]
  files: (Database['public']['Tables']['fh_job_files']['Row'] & {
    fh_contacts: Pick<Contact, 'name'> | null
  })[]
  payments: Pick<Payment, 'contact_id' | 'amount' | 'paid_on' | 'created_at' | 'method'>[]
  changeOrders: Pick<Database['public']['Tables']['fh_change_orders']['Row'], 'contact_id' | 'amount' | 'status'>[]
}

const EMPTY_CLIENT_DETAIL: Omit<ClientDetailBundle, 'client'> = {
  jobs: [], notes: [], files: [], payments: [], changeOrders: []
}

async function fetchClientDetail(id: string, userId: string): Promise<ClientDetailBundle> {
  const { data: client, error: clientErr } = await supabase
    .from('fh_clients')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()
  if (clientErr) throw clientErr

  if (!client) return { client: null, ...EMPTY_CLIENT_DETAIL }

  const { data: jobsData, error: jobsErr } = await supabase
    .from('fh_contacts')
    .select('id, name, stage, job_title, job_type, amount, updated_at, created_at')
    .eq('user_id', userId)
    .eq('client_id', client.id)
    .order('updated_at', { ascending: false })
  if (jobsErr) throw jobsErr

  const jobs = (jobsData ?? []) as ClientJob[]
  const jobIds = jobs.map((r) => r.id)
  if (jobIds.length === 0) {
    return { client: client as Client, ...EMPTY_CLIENT_DETAIL }
  }

  const [notesRes, filesRes, paymentsRes, coRes] = await Promise.all([
    supabase
      .from('fh_notes')
      .select('*, fh_contacts(name)')
      .eq('user_id', userId)
      .in('contact_id', jobIds)
      .order('created_at', { ascending: false })
      .limit(40),
    supabase
      .from('fh_job_files')
      .select('*, fh_contacts(name)')
      .eq('user_id', userId)
      .in('job_id', jobIds)
      .order('uploaded_at', { ascending: false })
      .limit(60),
    supabase
      .from('fh_payments')
      .select('contact_id, amount, paid_on, created_at, method')
      .eq('user_id', userId)
      .in('contact_id', jobIds),
    supabase
      .from('fh_change_orders')
      .select('contact_id, amount, status')
      .eq('user_id', userId)
      .in('contact_id', jobIds)
      .eq('status', 'approved')
  ])
  if (notesRes.error) throw notesRes.error
  if (filesRes.error) throw filesRes.error
  if (paymentsRes.error) throw paymentsRes.error

  return {
    client: client as Client,
    jobs,
    notes: (notesRes.data ?? []) as ClientDetailBundle['notes'],
    files: (filesRes.data ?? []) as ClientDetailBundle['files'],
    payments: (paymentsRes.data ?? []) as ClientDetailBundle['payments'],
    changeOrders: (coRes.data ?? []) as ClientDetailBundle['changeOrders']
  }
}

export function useClientDetail(id: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ['clientDetail', id],
    queryFn: () => fetchClientDetail(id as string, userId as string),
    enabled: !!id && !!userId
  })
}

export function useInvalidateClientDetail() {
  const client = useQueryClient()
  return (id: string | undefined) =>
    client.invalidateQueries({ queryKey: ['clientDetail', id] })
}

// ---- Analytics ----
// Six datasets feeding the KPI tiles + Reports & Insights section:
// every contact, mileage log, payments, invoices, change orders, and a
// slim client list (id/name, for the top-revenue list without N+1
// lookups). Bundled so the screen keeps one loading flag.

export type StageTransition = {
  contact_id: string
  from_stage: string | null
  to_stage: string
  transitioned_at: string
}

export type AnalyticsBundle = {
  contacts: Contact[]
  mileage: Database['public']['Tables']['fh_mileage']['Row'][]
  payments: Payment[]
  invoices: Database['public']['Tables']['fh_invoices']['Row'][]
  changeOrders: Database['public']['Tables']['fh_change_orders']['Row'][]
  clients: Pick<Client, 'id' | 'name'>[]
  stageTransitions: StageTransition[]
}

async function fetchAnalyticsBundle(userId: string): Promise<AnalyticsBundle> {
  const [c, m, p, inv, co, cli, st] = await Promise.all([
    // Explicit projection instead of `*` — fh_contacts carries wide text
    // columns (notes, scope, proposal HTML) Analytics never touches. This
    // list covers exactly the fields Analytics.tsx reads off a contact:
    // stage/amount/cost for KPIs + margin, the date fields for trends,
    // job_type for the trade breakdown, client_id/name for top-revenue,
    // and quote_sent_at for deposit-lag. follow_up_on + proposal_status
    // are included per the projection spec.
    fetchAllRows<Contact>((from, to) =>
      supabase
        .from('fh_contacts')
        .select('id, user_id, client_id, name, stage, amount, cost, created_at, completed_at, updated_at, follow_up_on, proposal_status, job_type, quote_sent_at')
        .eq('user_id', userId)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    supabase.from('fh_mileage').select('*').eq('user_id', userId).order('drove_on', { ascending: false }),
    fetchAllRows<Payment>((from, to) =>
      supabase.from('fh_payments').select('*').eq('user_id', userId).order('id', { ascending: true }).range(from, to)
    ),
    fetchAllRows<AnalyticsBundle['invoices'][number]>((from, to) =>
      supabase.from('fh_invoices').select('*').eq('user_id', userId).order('id', { ascending: true }).range(from, to)
    ),
    fetchAllRows<AnalyticsBundle['changeOrders'][number]>((from, to) =>
      supabase.from('fh_change_orders').select('*').eq('user_id', userId).order('id', { ascending: true }).range(from, to)
    ),
    supabase.from('fh_clients').select('id, name').eq('user_id', userId),
    // Funnel source — stage moves with timestamps (mig 023). Bounded at
    // 4000 rows, keeping the NEWEST: the funnel windows on the trailing
    // 90 days, so when history exceeds the cap it's the oldest rows
    // that must drop. (The old ascending+limit kept the oldest 4000 and
    // starved the funnel of exactly the recent rows it needed.)
    supabase
      .from('fh_stage_transitions')
      .select('contact_id, from_stage, to_stage, transitioned_at')
      .eq('user_id', userId)
      .order('transitioned_at', { ascending: false })
      .limit(4000)
  ])
  for (const result of [m, cli, st]) {
    if (result.error) throw result.error
  }
  // computeFunnel's days-to-decision pairing expects chronological order.
  const transitions = ((st.data ?? []) as StageTransition[])
    .slice()
    .sort((a, b) => new Date(a.transitioned_at).getTime() - new Date(b.transitioned_at).getTime())
  return {
    contacts: c,
    mileage: (m.data ?? []) as AnalyticsBundle['mileage'],
    payments: p,
    invoices: inv,
    changeOrders: co,
    clients: (cli.data ?? []) as AnalyticsBundle['clients'],
    stageTransitions: transitions
  }
}

export function useAnalyticsBundle(userId: string | undefined) {
  return useQuery({
    queryKey: ['analytics', userId],
    queryFn: () => fetchAnalyticsBundle(userId as string),
    enabled: !!userId
  })
}

export function useInvalidateAnalytics() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ['analytics'] })
}

// ---- Invoice detail ----
// One invoice's worth of data: the contact (with the fh_clients fallback
// join), its payments, the one-to-one insurance claim, and the change
// orders against the contract. The queryFn throws "Invoice not found"
// when the contact is missing so the screen can surface query.error.

export type InvoiceContact = Contact & {
  fh_clients: Pick<Client, 'name' | 'email' | 'phone' | 'address'> | null
}

export type InvoiceDetailBundle = {
  contact: InvoiceContact
  payments: Payment[]
  insurance: Database['public']['Tables']['fh_insurance_claims']['Row'] | null
  changeOrders: Database['public']['Tables']['fh_change_orders']['Row'][]
}

async function fetchInvoiceDetail(id: string): Promise<InvoiceDetailBundle> {
  const [cRes, psRes, insRes, coRes] = await Promise.all([
    supabase
      .from('fh_contacts')
      .select('*, fh_clients(name, email, phone, address)')
      .eq('id', id)
      .maybeSingle(),
    supabase.from('fh_payments').select('*').eq('contact_id', id).order('paid_on', { ascending: false }),
    supabase.from('fh_insurance_claims').select('*').eq('contact_id', id).maybeSingle(),
    supabase.from('fh_change_orders').select('*').eq('contact_id', id).order('sequence_number', { ascending: true })
  ])
  if (cRes.error) throw cRes.error
  if (psRes.error) throw psRes.error
  if (insRes.error) throw insRes.error
  if (coRes.error) throw coRes.error
  if (!cRes.data) throw new Error('Invoice not found')
  return {
    contact: cRes.data as InvoiceContact,
    payments: (psRes.data ?? []) as Payment[],
    insurance: (insRes.data ?? null) as InvoiceDetailBundle['insurance'],
    changeOrders: (coRes.data ?? []) as InvoiceDetailBundle['changeOrders']
  }
}

export function useInvoiceDetail(id: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: ['invoiceDetail', id],
    queryFn: () => fetchInvoiceDetail(id as string),
    enabled: !!id && !!userId
  })
}

export function useInvalidateInvoiceDetail() {
  const client = useQueryClient()
  return (id: string | undefined) =>
    client.invalidateQueries({ queryKey: ['invoiceDetail', id] })
}

// ---- Estimate templates (Bid screen) ----
// The saved estimate templates the bid composer can apply. RLS scopes
// the rows to the owner, so no JS user_id filter; keyed by userId so the
// query enables once auth resolves.

export type EstimateTemplate = Database['public']['Tables']['fh_estimate_templates']['Row']

async function fetchEstimateTemplates(): Promise<EstimateTemplate[]> {
  const { data, error } = await supabase
    .from('fh_estimate_templates')
    .select('*')
    .order('updated_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as EstimateTemplate[]
}

export function useEstimateTemplates(userId: string | undefined) {
  return useQuery({
    queryKey: ['estimateTemplates', userId],
    queryFn: fetchEstimateTemplates,
    enabled: !!userId
  })
}

export function useInvalidateEstimateTemplates() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ['estimateTemplates'] })
}

// ---- Sub detail ----
// One sub's rollup, keyed by the normalized phone-or-name identity. We
// pull every sub row + every sub profile for the user and match
// client-side (sub volumes are bounded), then hydrate the contact rows
// for the matching sub's job history. The profile is mutated locally
// via setQueryData (create / edit), so the cache stays authoritative.

export type Sub_Detail_Profile = Database['public']['Tables']['fh_sub_profiles']['Row']

export type SubDetailBundle = {
  subRows: Sub[]
  contacts: Record<string, SubContact>
  profile: Sub_Detail_Profile | null
}

async function fetchSubDetail(key: string, userId: string, orgId?: string | null): Promise<SubDetailBundle> {
  let subsQuery = supabase
    .from('fh_subs')
    .select('*')
  subsQuery = orgId
    ? subsQuery.eq('org_id', orgId)
    : subsQuery.eq('user_id', userId)

  let profilesQuery = supabase
    .from('fh_sub_profiles')
    .select('*')
  profilesQuery = orgId
    ? profilesQuery.eq('org_id', orgId)
    : profilesQuery.eq('user_id', userId)

  const [{ data: subs, error: subsErr }, { data: prof, error: profErr }] = await Promise.all([
    subsQuery.order('created_at', { ascending: false }),
    profilesQuery,
  ])
  if (subsErr) throw subsErr
  if (profErr && profErr.code !== 'PGRST116') {
    if (profErr.message?.includes('does not exist')) {
      throw new Error('Sub profile table is missing — run migration 017_sub_profiles.sql in Supabase')
    }
    throw profErr
  }

  const subRows = ((subs ?? []) as Sub[]).filter((r) => {
    const k = (r.phone || r.name || '').toLowerCase().trim()
    return k === key
  })

  const matchingProfile = ((prof ?? []) as Sub_Detail_Profile[]).find((p) => {
    const byPhone = (p.phone || '').toLowerCase().trim()
    const byName = (p.name || '').toLowerCase().trim()
    return byPhone === key || byName === key
  }) || null

  const ids = Array.from(new Set(subRows.map((r) => r.contact_id).filter(Boolean))) as string[]
  const contacts: Record<string, SubContact> = {}
  if (ids.length > 0) {
    let contactsQuery = supabase
      .from('fh_contacts')
      .select('id, name, job_title, stage')
      .in('id', ids)
    contactsQuery = orgId
      ? contactsQuery.eq('org_id', orgId)
      : contactsQuery.eq('user_id', userId)
    const { data: cs, error: csErr } = await contactsQuery
    if (csErr) throw csErr
    for (const c of (cs ?? []) as SubContact[]) contacts[c.id] = c
  }

  return { subRows, contacts, profile: matchingProfile }
}

export function subDetailKey(key: string | undefined, userId?: string, orgId?: string | null) {
  return ['subDetail', key, userId, orgId ?? null] as const
}

export function useSubDetail(key: string | undefined, userId: string | undefined, orgId?: string | null) {
  return useQuery({
    queryKey: subDetailKey(key, userId, orgId),
    queryFn: () => fetchSubDetail(key as string, userId as string, orgId),
    enabled: !!key && !!userId && orgId !== undefined
  })
}
