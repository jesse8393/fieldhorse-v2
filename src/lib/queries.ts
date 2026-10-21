// src/lib/queries.ts
//
// Typed TanStack Query hooks layer. First file in the TypeScript +
// Query migration, replaces the hand-rolled `useEffect` +
// `supabase.from().select()` + manual loading/error/refetch pattern
// that was duplicated across every screen.
//
// Each hook is keyed so mutations elsewhere can invalidate precisely.
// The realtime subscription helpers invalidate the relevant key so the
// list stays live without a manual refreshTick counter.
//
// Reuse target: these hooks are platform-agnostic (plain Supabase +
// Query), so the future Expo app imports them verbatim.

import { useCallback, useEffect, useMemo } from 'react'
import {
  useQuery,
  useQueryClient,
  keepPreviousData,
  type QueryClient
} from '@tanstack/react-query'
import { supabase } from './supabase.ts'
import { MOVED_STAGE_FILTER } from './stages.ts'
import { subMatchesKey } from './subIdentity.ts'
import { loadPartnerDirectory } from './partners.ts'
import { useOrgScope } from './orgScope.ts'
import { activeCompanyFrom, onlyActiveCompany, type ActiveCompany } from './activeCompany.ts'
import { OPEN_INVOICE_STATUSES } from './invoiceSettlement.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import type { Database } from './database.types.ts'

export type Contact = Database['public']['Tables']['fh_contacts']['Row']
export type Client = Database['public']['Tables']['fh_clients']['Row']
export type Payment = Database['public']['Tables']['fh_payments']['Row']

// The columns the Work list (and desktop rail) actually render. Keeping
// this a projection instead of `*` cuts each row to a fraction of its
// full width, fh_contacts carries big text fields (notes, scope,
// proposal HTML) that the list never shows. completed_at and
// quote_sent_at feed the phone Jobs rows ("Sent yesterday", the Done
// group's last 30 days). org_id tells the active company's jobs from a
// partner's shared ones (lib/activeCompany.ts, useCompanyJobs below).
export const JOB_LIST_COLUMNS =
  'id, user_id, org_id, client_id, name, phone, email, address, stage, amount, job_title, job_type, referred_by, proposal_status, follow_up_on, completed_at, quote_sent_at, updated_at, created_at'

export type JobRow = Pick<
  Contact,
  | 'id' | 'user_id' | 'org_id' | 'client_id' | 'name' | 'phone' | 'email' | 'address'
  | 'stage' | 'amount' | 'job_title' | 'job_type' | 'referred_by'
  | 'proposal_status' | 'follow_up_on' | 'completed_at' | 'quote_sent_at'
  | 'updated_at' | 'created_at'
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
// default: 1000) even when no .limit() is set, so the "deliberately
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

// ---- Tenant scope ----
// Members of an org share one book (RLS is org scoped), so tenant data
// is read by org_id once the membership resolves; a user with no org
// keeps the legacy user_id filter. Each hook resolves the scope itself
// through useOrgScope (lib/orgScope.ts), puts it in its query key and
// stays disabled until it is known, so screens keep passing only the
// user id. Personal data (the viewer's own notes) keeps the user filter.
export function scoped<Q extends { eq(column: string, value: string): Q }>(
  query: Q,
  userId: string,
  orgId: string | null | undefined
): Q {
  return orgId ? query.eq('org_id', orgId) : query.eq('user_id', userId)
}

// Lookups by id are chunked so a long id list never overflows the
// request URL.
const ID_CHUNK = 150
export function chunkIds(ids: string[]): string[][] {
  const out: string[][] = []
  for (let i = 0; i < ids.length; i += ID_CHUNK) out.push(ids.slice(i, i + ID_CHUNK))
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
  // No JS-layer user_id filter, RLS (owner + partner-read) is the
  // enforcement layer, matching the prior Jobs.load behavior so
  // partner-shared jobs still surface. Partner-shared rows can come
  // back twice, once as the owner's row, once via the partnership
  // join, so dedupe by id before returning, mirroring the Home
  // pipeline dedupe in screens/Home.tsx.
  const { data, error } = await supabase
    .from('fh_contacts')
    .select(`${JOB_LIST_COLUMNS}, fh_clients(name, phone, email)`)
    .not('stage', 'in', MOVED_STAGE_FILTER)
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
  // Derive the user id here (rather than as a param) so every caller :
  // Work, the desktop DetailListRail, shares the one user-scoped key
  // without each having to thread the id through.
  const { user } = useAuth()
  return useQuery({
    queryKey: jobsKey(user?.id),
    queryFn: fetchJobs,
    enabled: !!user?.id,
    staleTime: 30_000
  })
}

// ---- Jobs of the active company ----
// useJobs carries every company the person belongs to plus the jobs a
// partner shared, which the Jobs list is meant to show. Screens that act on
// a job (the Schedule tray writes visits, Money counts quotes waiting on
// approval) read this instead: the same cached list, narrowed to the
// active company (lib/activeCompany.ts). Until the company is known it
// reads as loading, so a screen never shows an empty or unfiltered list.

/** The company the screens act for, or null while it is not known. */
export function useActiveCompany(): ActiveCompany | null {
  const { user } = useAuth()
  const scope = useOrgScope(user?.id)
  const userId = user?.id
  return useMemo(() => activeCompanyFrom(userId, scope), [userId, scope])
}

export type CompanyJobs = {
  data: JobRow[] | undefined
  isPending: boolean
  isLoading: boolean
  isError: boolean
  error: Error | null
  refetch: () => Promise<unknown>
}

export function useCompanyJobs(): CompanyJobs {
  const jobs = useJobs()
  const company = useActiveCompany()
  const all = jobs.data
  const data = useMemo(() => (all && company ? onlyActiveCompany(all, company) : undefined), [all, company])
  const known = company !== null
  return {
    data,
    isPending: jobs.isPending || !known,
    isLoading: jobs.isLoading || (!known && !jobs.isError),
    isError: jobs.isError,
    error: jobs.error,
    refetch: jobs.refetch
  }
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
  // ilike metacharacters, but simply STRIPPING them broke real
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
        .not('stage', 'in', MOVED_STAGE_FILTER)
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

export type ClientLeadRow = Pick<Database['public']['Tables']['fh_leads']['Row'], 'id' | 'client_id' | 'status'>
export type ClientQuoteRow = Pick<Database['public']['Tables']['fh_quotes']['Row'], 'id' | 'client_id' | 'status' | 'amount' | 'job_id'>

export type ClientsBundle = {
  clients: Client[]
  jobs: Pick<Contact, 'id' | 'client_id' | 'amount' | 'stage'>[]
  /** Leads and quotes by client (D53), for the active count. */
  leads: ClientLeadRow[]
  quotes: ClientQuoteRow[]
  payments: Pick<Payment, 'contact_id' | 'amount'>[]
  changeOrders: Pick<Database['public']['Tables']['fh_change_orders']['Row'], 'contact_id' | 'amount' | 'status'>[]
}

export const clientsKey = (userId: string | undefined, orgId?: string | null) =>
  ['clients', userId, orgId ?? null] as const

async function fetchClientsBundle(userId: string, orgId?: string | null): Promise<ClientsBundle> {
  const [clients, jobs, payments, changeOrders, leads, quotes] = await Promise.all([
    // Paged too: the org wide roster can pass max-rows (1000).
    fetchAllRows<Client>((from, to) =>
      scoped(supabase.from('fh_clients').select('*'), userId, orgId)
        .order('last_activity_at', { ascending: false, nullsFirst: false })
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<ClientsBundle['jobs'][number]>((from, to) =>
      scoped(supabase.from('fh_contacts').select('id, client_id, amount, stage'), userId, orgId)
        .not('stage', 'in', MOVED_STAGE_FILTER)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<ClientsBundle['payments'][number]>((from, to) =>
      scoped(supabase.from('fh_payments').select('contact_id, amount'), userId, orgId)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    // Approved change orders adjust each job's true contract, without
    // them the Clients-list "outstanding" understates any job carrying
    // a signed CO (the statement/A-R surfaces already include them).
    fetchAllRows<ClientsBundle['changeOrders'][number]>((from, to) =>
      scoped(supabase.from('fh_change_orders').select('contact_id, amount, status'), userId, orgId)
        .eq('status', 'approved')
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<ClientLeadRow>((from, to) =>
      scoped(supabase.from('fh_leads').select('id, client_id, status'), userId, orgId)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<ClientQuoteRow>((from, to) =>
      scoped(supabase.from('fh_quotes').select('id, client_id, status, amount, job_id'), userId, orgId)
        .order('id', { ascending: true })
        .range(from, to)
    )
  ])
  return { clients, jobs, leads, quotes, payments, changeOrders }
}

export function useClientsBundle(userId: string | undefined) {
  const orgId = useOrgScope(userId)
  return useQuery({
    queryKey: clientsKey(userId, orgId),
    queryFn: () => fetchClientsBundle(userId as string, orgId),
    enabled: !!userId && orgId !== undefined
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

export const scheduleKey = (
  userId: string | undefined,
  orgId: string | null | undefined,
  startIso: string,
  endIso: string
) => ['schedule', userId, orgId ?? null, startIso, endIso] as const

export const upcomingKey = (userId: string | undefined, orgId?: string | null) =>
  ['scheduleUpcoming', userId, orgId ?? null] as const

async function fetchScheduleRange(
  userId: string,
  startIso: string,
  endIso: string,
  orgId?: string | null
): Promise<ScheduleEvent[]> {
  const { data, error } = await scoped(supabase.from('fh_schedule').select('*, fh_contacts(name, stage)'), userId, orgId)
    .gte('start_at', startIso)
    .lt('start_at', endIso)
    .order('start_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as ScheduleEvent[]
}

export function useScheduleEvents(userId: string | undefined, startIso: string, endIso: string) {
  const orgId = useOrgScope(userId)
  return useQuery({
    queryKey: scheduleKey(userId, orgId, startIso, endIso),
    queryFn: () => fetchScheduleRange(userId as string, startIso, endIso, orgId),
    enabled: !!userId && orgId !== undefined,
    // Keep the prior range's events on screen while a view switch
    // (day→week→month) refetches, matching the old setLoading guard.
    placeholderData: keepPreviousData
  })
}

async function fetchUpcoming(userId: string, orgId?: string | null): Promise<ScheduleEvent[]> {
  const now = new Date()
  const in7 = new Date(now)
  in7.setDate(in7.getDate() + 7)
  in7.setHours(0, 0, 0, 0)
  const { data, error } = await scoped(supabase.from('fh_schedule').select('*, fh_contacts(name, stage)'), userId, orgId)
    .gte('start_at', now.toISOString())
    .lt('start_at', in7.toISOString())
    .order('start_at', { ascending: true })
    .limit(8)
  if (error) throw error
  return (data ?? []) as ScheduleEvent[]
}

export function useUpcomingEvents(userId: string | undefined) {
  const orgId = useOrgScope(userId)
  return useQuery({
    queryKey: upcomingKey(userId, orgId),
    queryFn: () => fetchUpcoming(userId as string, orgId),
    enabled: !!userId && orgId !== undefined
  })
}

// ---- Visits behind the phone Jobs list chips ----
// The Jobs list only needs which job each visit is on and when it starts,
// from 14 days back to 15 days ahead (jobsVisitWindow in lib/jobsList.ts).
// Newest first, so if the server's row cap ever cuts the list short it
// drops the oldest past visits, never a job's next one. The rows carry no
// visit id, so the list has its own prefix beside the visit caches (a
// patch by visit id never reaches it) and every schedule invalidation and
// visit delete refetches it.

export type JobVisit = { contact_id: string | null; start_at: string | null }

export const jobVisitsKey = (
  userId: string | undefined,
  orgId: string | null | undefined,
  startIso: string,
  endIso: string
) => ['scheduleJobVisits', userId ?? null, orgId ?? null, startIso, endIso] as const

async function fetchJobVisits(userId: string, startIso: string, endIso: string, orgId?: string | null): Promise<JobVisit[]> {
  const { data, error } = await scoped(supabase.from('fh_schedule').select('contact_id, start_at'), userId, orgId)
    .gte('start_at', startIso)
    .lt('start_at', endIso)
    .not('contact_id', 'is', null)
    .order('start_at', { ascending: false })
  if (error) throw error
  return (data ?? []) as JobVisit[]
}

/** Each visit's job and start in the window, newest first, for the active company. */
export function useJobVisits(userId: string | undefined, startIso: string, endIso: string) {
  const orgId = useOrgScope(userId)
  return useQuery({
    queryKey: jobVisitsKey(userId, orgId, startIso, endIso),
    queryFn: () => fetchJobVisits(userId as string, startIso, endIso, orgId),
    enabled: !!userId && orgId !== undefined,
    // The window moves at midnight; keep yesterday's chips while it loads.
    placeholderData: keepPreviousData
  })
}

// ---- A job's linked client email (the Quote tab's send) ----
// The job page reads its contact with select('*'), which carries no client.
// The Quote tab finds the customer's email the way Money does, the job's
// own and then its linked client's (lib/customerEmail.ts), so it reads the
// client's email when the job has none of its own. RLS decides who may
// read the client; a partner on a shared job gets nothing back.
//
// Always stale (staleTime 0): the address is edited on the client page,
// and a proposal must go to the address as it is now, so every mount reads
// it again, a reload included (the cache is saved for offline use). The
// Quote tab waits for that read before it sends (see emailPending there).

export const linkedClientEmailKey = (clientId: string | null | undefined) =>
  ['linkedClientEmail', clientId ?? null] as const

/** The email on the client `clientId`, or null. Pass enabled false when the job has its own. */
export function useLinkedClientEmail(clientId: string | null | undefined, enabled = true) {
  return useQuery({
    queryKey: linkedClientEmailKey(clientId),
    queryFn: async (): Promise<string | null> => {
      const { data, error } = await supabase
        .from('fh_clients')
        .select('email')
        .eq('id', clientId as string)
        .maybeSingle()
      if (error) throw error
      return (data as { email?: string | null } | null)?.email ?? null
    },
    enabled: enabled && !!clientId,
    staleTime: 0
  })
}

// ---- Jobs with a visit from today on (the desktop Unscheduled tray) ----
// Which jobs already have a date (decision D10), whatever week the board
// shows. Only contact_id is read, for every visit from the start of today
// with no end date, paged past the server's row cap, so a busy calendar
// never drops a booked job back into the tray. The rows carry no visit
// id, so the list has its own prefix beside the visit caches: a patch by
// visit id never reaches it, and useInvalidateSchedule refreshes it with
// them. The tray adds a job here optimistically while its drop saves
// (see the updaters below).

export type BookedVisit = { contact_id: string | null }

export const bookedKey = (
  userId: string | undefined,
  orgId: string | null | undefined,
  fromIso: string
) => ['scheduleBooked', userId ?? null, orgId ?? null, fromIso] as const

async function fetchBooked(userId: string, fromIso: string, orgId?: string | null): Promise<BookedVisit[]> {
  return fetchAllRows<BookedVisit>((from, to) =>
    scoped(supabase.from('fh_schedule').select('contact_id'), userId, orgId)
      .gte('start_at', fromIso)
      .not('contact_id', 'is', null)
      // A stable order so the pages never overlap or skip.
      .order('start_at', { ascending: true })
      .order('id', { ascending: true })
      .range(from, to)
  )
}

/** The job of every visit from `fromIso` on, for the active company. */
export function useBookedVisits(userId: string | undefined, fromIso: string) {
  const orgId = useOrgScope(userId)
  return useQuery({
    queryKey: bookedKey(userId, orgId, fromIso),
    queryFn: () => fetchBooked(userId as string, fromIso, orgId),
    enabled: !!userId && orgId !== undefined,
    // `fromIso` moves at midnight. Keep yesterday's list on screen while
    // today's loads, so a board left open overnight never drops to a
    // skeleton for a round trip.
    placeholderData: keepPreviousData
  })
}

// The booked list while a drop saves. Each updater takes the cached rows
// and matches them by value, never by identity: the cache rebuilds equal
// rows on every write (structural sharing), so a row kept by identity is
// lost the moment a row ahead of it goes. A list that has not loaded yet
// is left alone (an updater that returns undefined writes nothing), so it
// never turns into a short list that reads as every other job being free.

/** One more row for `jobId`, when its drop starts. */
export const addBookedJob = (jobId: string) => (rows: BookedVisit[] | undefined) =>
  rows && [...rows, { contact_id: jobId }]

/** One row for `jobId` fewer, when its drop fails. A second row (a visit the server has) stays. */
export const removeBookedJob = (jobId: string) => (rows: BookedVisit[] | undefined) => {
  if (!rows) return rows
  const at = rows.findIndex((row) => row.contact_id === jobId)
  return at < 0 ? rows : [...rows.slice(0, at), ...rows.slice(at + 1)]
}

/** A row for `jobId` if none is there, after its write, in case a reload from before the write landed without it. */
export const ensureBookedJob = (jobId: string) => (rows: BookedVisit[] | undefined) =>
  rows && (rows.some((row) => row.contact_id === jobId) ? rows : [...rows, { contact_id: jobId }])

// Invalidate every schedule query (range, upcoming, the booked list and
// the Jobs list visits) after a mutation. A fetch already in flight is
// dropped and started over, so what lands was asked for after the write.
export function useInvalidateSchedule() {
  const client = useQueryClient()
  return () => {
    client.invalidateQueries({ queryKey: ['schedule'] })
    client.invalidateQueries({ queryKey: ['scheduleUpcoming'] })
    client.invalidateQueries({ queryKey: ['scheduleBooked'] })
    client.invalidateQueries({ queryKey: ['scheduleJobVisits'] })
  }
}

// Optimistically drop a deleted event from every cached schedule query
// (range + upcoming) so it vanishes immediately, before the server
// round-trip, replaces the old setEvents/setUpcoming filters. A query that
// has not loaded yet is left alone (an empty list would read as "nothing
// scheduled" until its fetch lands). The booked list and the Jobs list
// visits hold no visit ids, so they are refetched instead: the deleted
// visit may have been its job's only one from today on, or the one its
// chip read.
export function dropScheduleEvent(client: QueryClient, evtId: string) {
  const drop = (rows: ScheduleEvent[] | undefined) =>
    rows?.filter((e) => e.id !== evtId)
  client.setQueriesData({ queryKey: ['schedule'] }, drop)
  client.setQueriesData({ queryKey: ['scheduleUpcoming'] }, drop)
  client.invalidateQueries({ queryKey: ['scheduleBooked'] })
  client.invalidateQueries({ queryKey: ['scheduleJobVisits'] })
}

export function useDropScheduleEvent() {
  const client = useQueryClient()
  return (evtId: string) => dropScheduleEvent(client, evtId)
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
  // True when at least one event source returned a full page, i.e. there
  // may be older rows a larger page would surface. The merged feed length
  // can exceed pageSize even when every source is exhausted (4 sources ×
  // pageSize), so the merged count is NOT a valid "has more" signal.
  hasMore: boolean
}

export const activityKey = (userId: string | undefined, orgId: string | null | undefined, pageSize: number) =>
  ['activity', userId, orgId ?? null, pageSize] as const

async function fetchActivity(userId: string, pageSize: number, orgId?: string | null): Promise<ActivityBundle> {
  const [transitions, payments, changeOrders, invoices, contacts] = await Promise.all([
    scoped(supabase.from('fh_stage_transitions')
      .select('id, contact_id, from_stage, to_stage, transitioned_at, user_id'), userId, orgId)
      .order('transitioned_at', { ascending: false }).limit(pageSize),
    scoped(supabase.from('fh_payments')
      .select('id, contact_id, amount, method, kind, paid_on, created_at, user_id'), userId, orgId)
      .order('paid_on', { ascending: false }).limit(pageSize),
    scoped(supabase.from('fh_change_orders')
      .select('id, contact_id, sequence_number, title, amount, status, approved_at, created_at, user_id'), userId, orgId)
      .order('created_at', { ascending: false }).limit(pageSize),
    scoped(supabase.from('fh_invoices')
      .select('id, contact_id, sequence_number, title, amount, status, issued_at, created_at, user_id'), userId, orgId)
      .order('created_at', { ascending: false }).limit(pageSize),
    scoped(supabase.from('fh_contacts')
      .select('id, name, job_title, stage'), userId, orgId)
      .not('stage', 'in', MOVED_STAGE_FILTER)
      .order('updated_at', { ascending: false }).limit(pageSize * 2)
  ])
  for (const result of [transitions, payments, changeOrders, invoices, contacts]) {
    if (result.error) throw result.error
  }
  // "More to load" iff one of the four event sources filled its page.
  // (contacts is a lookup table, not an event source, exclude it.)
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
  const orgId = useOrgScope(userId)
  return useQuery({
    queryKey: activityKey(userId, orgId, pageSize),
    queryFn: () => fetchActivity(userId as string, pageSize, orgId),
    enabled: !!userId && orgId !== undefined
  })
}

// ---- Invoices / AR ----
// Three datasets: jobs in the active money pipeline (with the joined
// fh_clients fallback fields), every payment (for per-job paid
// rollups + month-to-date collection pace), and, pipeline v2, the
// first-class fh_invoices rows so the screen can list real issued
// invoices, not just per-job balances. Bundled so the screen keeps a
// single loading flag, matching its prior behavior.
//
// Invoices are read by the company (org_id, through `scoped`) and join
// their client; a job is looked up only for an invoice whose contact_id is
// set, since an invoice can bill a client with no job at all (D62).

// Projected, the AR screen renders identity/billing fields only; the
// wide text columns on fh_contacts (scope, notes, proposal bodies) never
// appear on this surface. `cost` is one number per job; Money reads it
// for the margin on its vault card (lib/moneyView.ts).
export const INVOICE_JOB_COLUMNS =
  'id, user_id, client_id, name, email, phone, address, stage, amount, cost, job_title, job_type, completed_at, created_at, updated_at'

export type InvoiceJob = Pick<
  Contact,
  | 'id' | 'user_id' | 'client_id' | 'name' | 'email' | 'phone' | 'address'
  | 'stage' | 'amount' | 'cost' | 'job_title' | 'job_type' | 'completed_at'
  | 'created_at' | 'updated_at'
> & {
  fh_clients: Pick<Client, 'name' | 'email' | 'phone' | 'address'> | null
}

// The client an invoice bills (D62), joined on fh_invoices.client_id. An
// invoice with no job reads its customer from here; one with a job reads
// the job first and falls back to this.
export const INVOICE_CLIENT_COLUMNS = 'name, email, phone, address, company_name'
export type InvoiceClient = Pick<Client, 'name' | 'email' | 'phone' | 'address' | 'company_name'>

export type InvoiceRecord = Database['public']['Tables']['fh_invoices']['Row'] & {
  fh_clients?: InvoiceClient | null
}

// The few columns the allocator (invoiceSettlement.ts) reads from an
// invoice that is not an open bill: a draft, or a paid or void row.
export const SETTLED_INVOICE_COLUMNS = 'id, contact_id, amount, status, due_at, sequence_number, created_at'

export type SettledInvoice = Pick<
  InvoiceRecord,
  'id' | 'contact_id' | 'amount' | 'status' | 'due_at' | 'sequence_number' | 'created_at'
>

export type InvoicesBundle = {
  jobs: InvoiceJob[]
  payments: Payment[]
  /** What the lists show: the 500 newest invoices of any status, plus every open one older than those. */
  invoices: InvoiceRecord[]
  /**
   * Every open invoice (sent, viewed, overdue), with no cap. Money's groups
   * and totals read these. A bundle built by hand may leave it out; the
   * open rows of `invoices` stand in.
   */
  openInvoices?: InvoiceRecord[]
  /**
   * Every invoice that is not an open bill (draft, paid, void), a few
   * columns each, with no cap, so what an open invoice still owes never
   * depends on the display cap: a deposit draft covered by money logged
   * against the job, or a paid bill that money already took.
   */
  settledInvoices?: SettledInvoice[]
  changeOrders: Database['public']['Tables']['fh_change_orders']['Row'][]
}

export const invoicesKey = (userId: string | undefined, orgId?: string | null) =>
  ['invoices', userId, orgId ?? null] as const

export async function fetchInvoicesBundle(userId: string, orgId?: string | null): Promise<InvoicesBundle> {
  const [jobs, payments, invoicesRes, openInvoices, settledInvoices, changeOrders] = await Promise.all([
    fetchAllRows<InvoiceJob>((from, to) =>
      scoped(supabase
        .from('fh_contacts')
        .select(`${INVOICE_JOB_COLUMNS}, fh_clients(name, email, phone, address)`), userId, orgId)
        .in('stage', ['job', 'invoice', 'closed'])
        .order('created_at', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    ),
    // Deliberately UNCAPPED, and PAGED past PostgREST's max-rows
    // (default 1000): a cap here silently drops the oldest rows :
    // exactly the most-overdue receivables, understating outstanding
    // totals and the 60+ aging bucket. A/R math must see every row.
    fetchAllRows<Payment>((from, to) =>
      scoped(supabase.from('fh_payments').select('*'), userId, orgId)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    // The issued-invoice DISPLAY list: the 500 most recent cover the
    // lists, so a huge invoice history no longer ships every row. Nothing
    // is added up from it; the two uncapped reads below feed the totals.
    scoped(supabase.from('fh_invoices').select(`*, fh_clients(${INVOICE_CLIENT_COLUMNS})`), userId, orgId)
      .order('created_at', { ascending: false })
      .limit(500),
    // Every open invoice, uncapped: Money's groups, Due this week and
    // the reminders read these, so an old unpaid bill past the newest 500
    // still counts.
    fetchAllRows<InvoiceRecord>((from, to) =>
      scoped(supabase.from('fh_invoices').select(`*, fh_clients(${INVOICE_CLIENT_COLUMNS})`), userId, orgId)
        .in('status', [...OPEN_INVOICE_STATUSES])
        .order('id', { ascending: true })
        .range(from, to)
    ),
    // Every draft, paid and void invoice, a few columns each, uncapped: the
    // allocator needs them so money that already paid one bill (or covers
    // an unsent deposit draft) is never counted against another.
    fetchAllRows<SettledInvoice>((from, to) =>
      scoped(supabase.from('fh_invoices').select(SETTLED_INVOICE_COLUMNS), userId, orgId)
        .in('status', ['draft', 'paid', 'void'])
        .order('id', { ascending: true })
        .range(from, to)
    ),
    // Approved change orders adjust each job's true contract, needed so
    // "Who owes you" / statements don't understate a job with signed COs.
    fetchAllRows<InvoicesBundle['changeOrders'][number]>((from, to) =>
      scoped(supabase.from('fh_change_orders').select('contact_id, amount, status'), userId, orgId)
        .eq('status', 'approved')
        .order('id', { ascending: true })
        .range(from, to)
    )
  ])
  if (invoicesRes.error) throw invoicesRes.error
  const shown = (invoicesRes.data ?? []) as InvoiceRecord[]
  // An open invoice older than the newest 500 joins the list after them,
  // newest first, so its row can be opened, reminded and marked paid.
  const shownIds = new Set(shown.map((inv) => inv.id))
  const older = openInvoices
    .filter((inv) => !shownIds.has(inv.id))
    .sort((a, b) => String(b.created_at || '').localeCompare(String(a.created_at || '')))
  return {
    jobs,
    payments,
    invoices: [...shown, ...older],
    openInvoices,
    settledInvoices,
    changeOrders
  }
}

export function useInvoicesBundle(userId: string | undefined) {
  const orgId = useOrgScope(userId)
  return useQuery({
    queryKey: invoicesKey(userId, orgId),
    queryFn: () => fetchInvoicesBundle(userId as string, orgId),
    enabled: !!userId && orgId !== undefined
  })
}

export function useInvalidateInvoices() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ['invoices'] })
}

// ---- One invoice (D62) ----
// Everything the invoice screens (/invoices/:id and its payment, edit and
// remind screens) need: the fh_invoices row with its client, and, only when
// the invoice points at a job, that job with its client, the job's
// payments, approved change orders, insurance claim and other invoices, so
// what the invoice owes is worked out the way Money works it out. An
// invoice with no job carries just the payments linked to it.

export type InvoiceRecordBundle = {
  invoice: InvoiceRecord
  client: (InvoiceClient & { id: string }) | null
  job: InvoiceJob | null
  payments: Payment[]
  changeOrders: Database['public']['Tables']['fh_change_orders']['Row'][]
  insurance: Database['public']['Tables']['fh_insurance_claims']['Row'] | null
  /** Every invoice on the job, this one included; just this one without a job. */
  jobInvoices: InvoiceRecord[]
}

export const invoiceRecordKey = (id: string | undefined) => ['invoiceRecord', id ?? null] as const

export async function fetchInvoiceRecord(id: string): Promise<InvoiceRecordBundle> {
  const { data: invoiceRow, error } = await supabase
    .from('fh_invoices')
    .select(`*, fh_clients(id, ${INVOICE_CLIENT_COLUMNS})`)
    .eq('id', id)
    .maybeSingle()
  if (error) throw error
  if (!invoiceRow) throw new Error('Invoice not found')
  const invoice = invoiceRow as InvoiceRecord & { fh_clients?: (InvoiceClient & { id: string }) | null }
  const client = invoice.fh_clients ?? null
  const jobId = invoice.contact_id

  if (!jobId) {
    const { data: paymentRows, error: payErr } = await supabase
      .from('fh_payments')
      .select('*')
      .eq('invoice_id', id)
      .order('paid_on', { ascending: false })
    if (payErr) throw payErr
    return {
      invoice, client, job: null,
      payments: (paymentRows ?? []) as Payment[],
      changeOrders: [], insurance: null, jobInvoices: [invoice]
    }
  }

  const [jobRes, payRes, coRes, insRes, invRes] = await Promise.all([
    supabase.from('fh_contacts').select(`${INVOICE_JOB_COLUMNS}, fh_clients(name, email, phone, address)`).eq('id', jobId).maybeSingle(),
    supabase.from('fh_payments').select('*').eq('contact_id', jobId).order('paid_on', { ascending: false }),
    supabase.from('fh_change_orders').select('*').eq('contact_id', jobId).eq('status', 'approved').order('sequence_number', { ascending: true }),
    supabase.from('fh_insurance_claims').select('*').eq('contact_id', jobId).maybeSingle(),
    supabase.from('fh_invoices').select('*').eq('contact_id', jobId).order('sequence_number', { ascending: true })
  ])
  if (jobRes.error) throw jobRes.error
  if (payRes.error) throw payRes.error
  if (coRes.error) throw coRes.error
  if (insRes.error) throw insRes.error
  if (invRes.error) throw invRes.error
  const jobInvoices = (invRes.data ?? []) as InvoiceRecord[]
  return {
    invoice,
    client,
    job: (jobRes.data ?? null) as InvoiceJob | null,
    payments: (payRes.data ?? []) as Payment[],
    changeOrders: (coRes.data ?? []) as InvoiceRecordBundle['changeOrders'],
    insurance: (insRes.data ?? null) as InvoiceRecordBundle['insurance'],
    jobInvoices: jobInvoices.some((inv) => inv.id === invoice.id) ? jobInvoices : [...jobInvoices, invoice]
  }
}

export function useInvoiceRecord(id: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: invoiceRecordKey(id),
    queryFn: () => fetchInvoiceRecord(id as string),
    enabled: !!id && !!userId
  })
}

export function useInvalidateInvoiceRecord() {
  const client = useQueryClient()
  return (id: string | undefined) => {
    client.invalidateQueries({ queryKey: invoiceRecordKey(id) })
    client.invalidateQueries({ queryKey: ['invoices'] })
  }
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
  // Paged past PostgREST's max-rows: the roster rolls billed totals up
  // per sub, so a capped read would silently drop the oldest rows.
  const subs = await fetchAllRows<Sub>((from, to) =>
    scoped(supabase.from('fh_subs').select('*'), userId, orgId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
  )

  // The contacts only label the jobs each sub worked, so fetch just the
  // jobs the roster references instead of the whole (capped) book.
  const ids = Array.from(new Set(subs.map((s) => s.contact_id).filter(Boolean))) as string[]
  const labelResults = await Promise.all(
    chunkIds(ids).map((chunk) =>
      scoped(supabase.from('fh_contacts').select('id, name, job_title, stage'), userId, orgId).in('id', chunk)
    )
  )
  const contacts: SubContact[] = []
  for (const res of labelResults) {
    if (res.error) throw res.error
    contacts.push(...((res.data ?? []) as SubContact[]))
  }
  return { subs, contacts }
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
// tag a note to a job. Returned as one bundle so the screen keeps one
// loading flag. The screen mutates the notes optimistically via
// setQueryData(notesKey(userId)), so the cache is the source of truth.

export type Note = Database['public']['Tables']['fh_notes']['Row']
export type NoteContact = Pick<Contact, 'id' | 'name'>

export type NotesBundle = {
  notes: Note[]
  contacts: NoteContact[]
}

// The notes themselves stay per user: the Notes screen is the viewer's
// own notebook (its archive and delete writes are guarded by user_id).
// The cached bundle carries no contacts; useNotesBundle adds them.
async function fetchNotesBundle(userId: string): Promise<NotesBundle> {
  const { data, error } = await supabase
    .from('fh_notes')
    .select('*')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(80)
  if (error) throw error
  return { notes: (data ?? []) as Note[], contacts: [] }
}

export const noteContactsKey = (userId: string | undefined, orgId?: string | null) =>
  ['noteContacts', userId, orgId ?? null] as const

// The job picker and note labels: every job in the org (a teammate's
// job can be tagged too), paged past PostgREST's max-rows, most
// recently touched first.
async function fetchNoteContacts(userId: string, orgId?: string | null): Promise<NoteContact[]> {
  const rows = await fetchAllRows<NoteContact & { updated_at: string | null }>((from, to) =>
    scoped(supabase.from('fh_contacts').select('id, name, updated_at'), userId, orgId)
      .not('stage', 'in', MOVED_STAGE_FILTER)
      .order('id', { ascending: true })
      .range(from, to)
  )
  return rows
    .sort((a, b) => (b.updated_at || '').localeCompare(a.updated_at || ''))
    .map(({ id, name }) => ({ id, name }))
}

export function notesKey(userId: string | undefined) {
  return ['notes', userId] as const
}

export function useNotesBundle(userId: string | undefined) {
  // The org scoped job list lives in its own keyed query and is merged
  // in with `select`, so the notes cache stays at notesKey(userId),
  // which Notes.tsx patches optimistically with setQueryData.
  const orgId = useOrgScope(userId)
  const contacts = useQuery({
    queryKey: noteContactsKey(userId, orgId),
    queryFn: () => fetchNoteContacts(userId as string, orgId),
    enabled: !!userId && orgId !== undefined
  }).data
  const withContacts = useCallback(
    (bundle: NotesBundle): NotesBundle => (contacts ? { ...bundle, contacts } : bundle),
    [contacts]
  )
  return useQuery({
    queryKey: notesKey(userId),
    queryFn: () => fetchNotesBundle(userId as string),
    enabled: !!userId,
    select: withContacts
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

export type ClientLead = Pick<
  Database['public']['Tables']['fh_leads']['Row'],
  'id' | 'title' | 'status' | 'job_type' | 'follow_up_on' | 'updated_at' | 'created_at'
>
export type ClientQuote = Pick<
  Database['public']['Tables']['fh_quotes']['Row'],
  'id' | 'title' | 'status' | 'amount' | 'job_id' | 'sent_at' | 'updated_at' | 'created_at'
>
export type ClientInvoice = Pick<
  Database['public']['Tables']['fh_invoices']['Row'],
  'id' | 'contact_id' | 'title' | 'amount' | 'status' | 'due_at' | 'sequence_number' | 'updated_at' | 'created_at'
>

export type ClientDetailBundle = {
  client: Client | null
  jobs: ClientJob[]
  /** The client's leads, quotes and invoices, newest first (D53). */
  leads: ClientLead[]
  quotes: ClientQuote[]
  invoices: ClientInvoice[]
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
  jobs: [], leads: [], quotes: [], invoices: [], notes: [], files: [], payments: [], changeOrders: []
}

export const clientDetailKey = (id: string | undefined, userId: string | undefined, orgId?: string | null) =>
  ['clientDetail', id, userId, orgId ?? null] as const

async function fetchClientDetail(id: string, userId: string, orgId?: string | null): Promise<ClientDetailBundle> {
  // Org scoped: a client a teammate created must open for the owner
  // (it used to read "Client not found" because of a user_id filter).
  const { data: client, error: clientErr } = await scoped(supabase.from('fh_clients').select('*'), userId, orgId)
    .eq('id', id)
    .maybeSingle()
  if (clientErr) throw clientErr

  if (!client) return { client: null, ...EMPTY_CLIENT_DETAIL }

  const [jobsRes, leadsRes, quotesRes, invoicesRes] = await Promise.all([
    scoped(supabase
      .from('fh_contacts')
      .select('id, name, stage, job_title, job_type, amount, updated_at, created_at'), userId, orgId)
      .eq('client_id', client.id)
      .not('stage', 'in', MOVED_STAGE_FILTER)
      .order('updated_at', { ascending: false }),
    scoped(supabase
      .from('fh_leads')
      .select('id, title, status, job_type, follow_up_on, updated_at, created_at'), userId, orgId)
      .eq('client_id', client.id)
      .order('updated_at', { ascending: false }),
    scoped(supabase
      .from('fh_quotes')
      .select('id, title, status, amount, job_id, sent_at, updated_at, created_at'), userId, orgId)
      .eq('client_id', client.id)
      .order('updated_at', { ascending: false }),
    scoped(supabase
      .from('fh_invoices')
      .select('id, contact_id, title, amount, status, due_at, sequence_number, updated_at, created_at'), userId, orgId)
      .eq('client_id', client.id)
      .order('updated_at', { ascending: false })
  ])
  if (jobsRes.error) throw jobsRes.error
  if (leadsRes.error) throw leadsRes.error
  if (quotesRes.error) throw quotesRes.error
  if (invoicesRes.error) throw invoicesRes.error

  const jobs = (jobsRes.data ?? []) as ClientJob[]
  const records = {
    leads: (leadsRes.data ?? []) as ClientLead[],
    quotes: (quotesRes.data ?? []) as ClientQuote[],
    invoices: (invoicesRes.data ?? []) as ClientInvoice[]
  }
  const jobIds = jobs.map((r) => r.id)
  if (jobIds.length === 0) {
    return { client: client as Client, ...EMPTY_CLIENT_DETAIL, ...records }
  }

  const [notesRes, filesRes, paymentsRes, coRes] = await Promise.all([
    scoped(supabase.from('fh_notes').select('*, fh_contacts(name)'), userId, orgId)
      .in('contact_id', jobIds)
      .order('created_at', { ascending: false })
      .limit(40),
    scoped(supabase.from('fh_job_files').select('*, fh_contacts(name)'), userId, orgId)
      .in('job_id', jobIds)
      .order('uploaded_at', { ascending: false })
      .limit(60),
    scoped(supabase.from('fh_payments').select('contact_id, amount, paid_on, created_at, method'), userId, orgId)
      .in('contact_id', jobIds),
    scoped(supabase.from('fh_change_orders').select('contact_id, amount, status'), userId, orgId)
      .in('contact_id', jobIds)
      .eq('status', 'approved')
  ])
  if (notesRes.error) throw notesRes.error
  if (filesRes.error) throw filesRes.error
  if (paymentsRes.error) throw paymentsRes.error
  // A failed change order read must fail the bundle: resolving with no
  // COs would understate every contract and cache that as a success.
  if (coRes.error) throw coRes.error

  return {
    client: client as Client,
    jobs,
    ...records,
    notes: (notesRes.data ?? []) as ClientDetailBundle['notes'],
    files: (filesRes.data ?? []) as ClientDetailBundle['files'],
    payments: (paymentsRes.data ?? []) as ClientDetailBundle['payments'],
    changeOrders: (coRes.data ?? []) as ClientDetailBundle['changeOrders']
  }
}

export function useClientDetail(id: string | undefined, userId: string | undefined) {
  const orgId = useOrgScope(userId)
  return useQuery({
    // Starts with ['clientDetail', id], so useInvalidateClientDetail's
    // prefix still matches.
    queryKey: clientDetailKey(id, userId, orgId),
    queryFn: () => fetchClientDetail(id as string, userId as string, orgId),
    enabled: !!id && !!userId && orgId !== undefined
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

export type AnalyticsLead = Pick<Database['public']['Tables']['fh_leads']['Row'], 'id' | 'client_id' | 'status' | 'created_at' | 'updated_at'>
export type AnalyticsQuote = Pick<
  Database['public']['Tables']['fh_quotes']['Row'],
  'id' | 'client_id' | 'status' | 'amount' | 'job_id' | 'sent_at' | 'created_at' | 'updated_at'
>

export type AnalyticsBundle = {
  contacts: Contact[]
  /** Leads and quotes (D55), for the funnel and the pipeline counts. */
  leads: AnalyticsLead[]
  quotes: AnalyticsQuote[]
  mileage: Database['public']['Tables']['fh_mileage']['Row'][]
  payments: Payment[]
  invoices: Database['public']['Tables']['fh_invoices']['Row'][]
  changeOrders: Database['public']['Tables']['fh_change_orders']['Row'][]
  clients: Pick<Client, 'id' | 'name'>[]
  stageTransitions: StageTransition[]
}

export const analyticsKey = (userId: string | undefined, orgId?: string | null) =>
  ['analytics', userId, orgId ?? null] as const

async function fetchAnalyticsBundle(userId: string, orgId?: string | null): Promise<AnalyticsBundle> {
  const [c, m, p, inv, co, cli, st, leads, quotes] = await Promise.all([
    // Explicit projection instead of `*`, fh_contacts carries wide text
    // columns (notes, scope, proposal HTML) Analytics never touches. This
    // list covers exactly the fields Analytics.tsx reads off a contact:
    // stage/amount/cost for KPIs + margin, the date fields for trends,
    // job_type for the trade breakdown, client_id/name for top-revenue,
    // and quote_sent_at for deposit-lag. follow_up_on + proposal_status
    // are included per the projection spec.
    fetchAllRows<Contact>((from, to) =>
      scoped(supabase
        .from('fh_contacts')
        .select('id, user_id, client_id, name, stage, amount, cost, created_at, completed_at, updated_at, follow_up_on, proposal_status, job_type, quote_sent_at'), userId, orgId)
        .not('stage', 'in', MOVED_STAGE_FILTER)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    // Paged like the money sets: the org wide log can pass max-rows, and
    // the mileage total sums every row (newest first for the trip list).
    fetchAllRows<AnalyticsBundle['mileage'][number]>((from, to) =>
      scoped(supabase.from('fh_mileage').select('*'), userId, orgId)
        .order('drove_on', { ascending: false })
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<Payment>((from, to) =>
      scoped(supabase.from('fh_payments').select('*'), userId, orgId).order('id', { ascending: true }).range(from, to)
    ),
    fetchAllRows<AnalyticsBundle['invoices'][number]>((from, to) =>
      scoped(supabase.from('fh_invoices').select('*'), userId, orgId).order('id', { ascending: true }).range(from, to)
    ),
    fetchAllRows<AnalyticsBundle['changeOrders'][number]>((from, to) =>
      scoped(supabase.from('fh_change_orders').select('*'), userId, orgId).order('id', { ascending: true }).range(from, to)
    ),
    fetchAllRows<AnalyticsBundle['clients'][number]>((from, to) =>
      scoped(supabase.from('fh_clients').select('id, name'), userId, orgId).order('id', { ascending: true }).range(from, to)
    ),
    // Funnel source, stage moves with timestamps (mig 023). Bounded at
    // 4000 rows, keeping the NEWEST: the funnel windows on the trailing
    // 90 days, so when history exceeds the cap it's the oldest rows
    // that must drop. (The old ascending+limit kept the oldest 4000 and
    // starved the funnel of exactly the recent rows it needed.)
    scoped(supabase
      .from('fh_stage_transitions')
      .select('contact_id, from_stage, to_stage, transitioned_at'), userId, orgId)
      .order('transitioned_at', { ascending: false })
      .limit(4000),
    fetchAllRows<AnalyticsLead>((from, to) =>
      scoped(supabase.from('fh_leads').select('id, client_id, status, created_at, updated_at'), userId, orgId)
        .order('id', { ascending: true })
        .range(from, to)
    ),
    fetchAllRows<AnalyticsQuote>((from, to) =>
      scoped(supabase.from('fh_quotes').select('id, client_id, status, amount, job_id, sent_at, created_at, updated_at'), userId, orgId)
        .order('id', { ascending: true })
        .range(from, to)
    )
  ])
  if (st.error) throw st.error
  // computeFunnel's days-to-decision pairing expects chronological order.
  const transitions = ((st.data ?? []) as StageTransition[])
    .slice()
    .sort((a, b) => new Date(a.transitioned_at).getTime() - new Date(b.transitioned_at).getTime())
  return {
    contacts: c,
    leads,
    quotes,
    mileage: m,
    payments: p,
    invoices: inv,
    changeOrders: co,
    clients: cli,
    stageTransitions: transitions
  }
}

export function useAnalyticsBundle(userId: string | undefined) {
  const orgId = useOrgScope(userId)
  return useQuery({
    queryKey: analyticsKey(userId, orgId),
    queryFn: () => fetchAnalyticsBundle(userId as string, orgId),
    enabled: !!userId && orgId !== undefined
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
  // Paged: a busy company passes the 1000 row API cap on fh_subs.
  const [subs, prof] = await Promise.all([
    fetchAllRows<Sub>((from, to) => {
      const q = supabase.from('fh_subs').select('*')
      return (orgId ? q.eq('org_id', orgId) : q.eq('user_id', userId))
        .order('created_at', { ascending: false })
        .range(from, to)
    }),
    fetchAllRows<Sub_Detail_Profile>((from, to) => {
      const q = supabase.from('fh_sub_profiles').select('*')
      return (orgId ? q.eq('org_id', orgId) : q.eq('user_id', userId))
        .order('created_at', { ascending: true })
        .range(from, to)
    }).catch((profErr: any) => {
      if (profErr?.message?.includes('does not exist')) {
        throw new Error('Sub profile table is missing, run migration 017_sub_profiles.sql in Supabase')
      }
      throw profErr
    }),
  ])

  // Shared normalization with the Subs list (lib/subIdentity.ts), plus
  // legacy raw-string keys so old links keep resolving. The old exact
  // string compare meant a formatted vs digits-only phone split one sub
  // across cards, and the list's '__untitled__' card dead-ended here.
  const subRows = subs.filter((r) => subMatchesKey(r, key))

  // Which vendor profile belongs to this key, most reliable first:
  //   1. identity_key, recorded when the profile was created from this key
  //      (migration 065), so editing its phone or name no longer detaches it;
  //   2. the profile's own current phone or name key;
  //   3. a profile named exactly like the key;
  //   4. a profile with the same name or phone as this sub's job rows, which
  //      reattaches older profiles whose phone was edited.
  const lowerKey = key.toLowerCase().trim()
  const nameOf = (v: string | null | undefined) => (v || '').toLowerCase().trim()
  const digits = (v: string | null | undefined) => (v || '').replace(/\D/g, '')
  const rowNames = new Set(subRows.map((r) => nameOf(r.name)).filter(Boolean))
  const rowPhones = new Set(subRows.map((r) => digits(r.phone)).filter((d) => d.length >= 7))
  const matchingProfile =
    prof.find((p) => nameOf((p as any).identity_key) === lowerKey) ||
    prof.find((p) => subMatchesKey(p, key)) ||
    prof.find((p) => nameOf(p.name) === lowerKey) ||
    prof.find((p) => !(p as any).identity_key && (rowNames.has(nameOf(p.name)) || rowPhones.has(digits(p.phone)))) ||
    null

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

// ---- Leads and quotes (PHASE9_PLAN Task 9, SPEC D53, D55, D65) ----
// Leads live on fh_leads and quotes on fh_quotes, each pointing at a
// client. The lists carry the client so a row can show who; the detail
// hooks read one row by id. Keys: ['leads', orgId], ['lead', id],
// ['quotes', orgId], ['quote', id]. Writers invalidate ['leads'] or
// ['quotes'] and the one record they changed.

export type LeadClient = Pick<Client, 'id' | 'name' | 'phone' | 'email' | 'address'>
export type LeadRow = Database['public']['Tables']['fh_leads']['Row'] & { fh_clients: LeadClient | null }
export type QuoteRow = Database['public']['Tables']['fh_quotes']['Row'] & { fh_clients: LeadClient | null }

const RECORD_CLIENT = 'fh_clients(id, name, phone, email, address)'

export const leadsKey = (orgId: string | null | undefined) => ['leads', orgId ?? null] as const
export const leadKey = (id: string | undefined) => ['lead', id] as const
export const quotesKey = (orgId: string | null | undefined) => ['quotes', orgId ?? null] as const
export const quoteKey = (id: string | undefined) => ['quote', id] as const

async function fetchLeads(userId: string, orgId: string | null | undefined): Promise<LeadRow[]> {
  return fetchAllRows<LeadRow>((from, to) =>
    scoped(supabase.from('fh_leads').select(`*, ${RECORD_CLIENT}`), userId, orgId)
      .order('created_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
  )
}

export function useLeads(userId: string | undefined) {
  const orgId = useOrgScope(userId)
  return useQuery({
    queryKey: leadsKey(orgId),
    queryFn: () => fetchLeads(userId as string, orgId),
    enabled: !!userId && orgId !== undefined,
    staleTime: 30_000
  })
}

async function fetchLead(id: string): Promise<LeadRow | null> {
  const { data, error } = await supabase.from('fh_leads').select(`*, ${RECORD_CLIENT}`).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as LeadRow | null) ?? null
}

/** One lead by id. `data` is null when no fh_leads row has that id. */
export function useLead(id: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: leadKey(id),
    queryFn: () => fetchLead(id as string),
    enabled: !!id && !!userId
  })
}

async function fetchQuotes(userId: string, orgId: string | null | undefined): Promise<QuoteRow[]> {
  return fetchAllRows<QuoteRow>((from, to) =>
    scoped(supabase.from('fh_quotes').select(`*, ${RECORD_CLIENT}`), userId, orgId)
      .order('updated_at', { ascending: false })
      .order('id', { ascending: true })
      .range(from, to)
  )
}

export function useQuotes(userId: string | undefined) {
  const orgId = useOrgScope(userId)
  return useQuery({
    queryKey: quotesKey(orgId),
    queryFn: () => fetchQuotes(userId as string, orgId),
    enabled: !!userId && orgId !== undefined,
    staleTime: 30_000
  })
}

async function fetchQuote(id: string): Promise<QuoteRow | null> {
  const { data, error } = await supabase.from('fh_quotes').select(`*, ${RECORD_CLIENT}`).eq('id', id).maybeSingle()
  if (error) throw error
  return (data as QuoteRow | null) ?? null
}

/** One quote by id. `data` is null when no fh_quotes row has that id. */
export function useQuote(id: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: quoteKey(id),
    queryFn: () => fetchQuote(id as string),
    enabled: !!id && !!userId
  })
}

export function useInvalidateLeads() {
  const client = useQueryClient()
  return (id?: string) => {
    void client.invalidateQueries({ queryKey: ['leads'] })
    if (id) void client.invalidateQueries({ queryKey: leadKey(id) })
  }
}

/** A schedule visit booked on a lead (fh_schedule start_at against lead_id). */
export type LeadVisit = { lead_id: string | null; start_at: string | null }

async function fetchLeadVisits(userId: string, orgId: string | null | undefined, fromIso: string): Promise<LeadVisit[]> {
  const { data, error } = await scoped(supabase.from('fh_schedule').select('lead_id, start_at'), userId, orgId)
    .not('lead_id', 'is', null)
    .gte('start_at', fromIso)
    .order('start_at', { ascending: true })
  if (error) throw error
  return (data ?? []) as LeadVisit[]
}

/**
 * Visits booked on leads from the start of today on, for the "Estimate
 * booked" chip on the leads list and the Jobs screen's Leads tab.
 */
export function useLeadVisits(userId: string | undefined) {
  const orgId = useOrgScope(userId)
  const now = new Date()
  const fromIso = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString()
  return useQuery({
    queryKey: ['leadVisits', orgId ?? null, fromIso],
    queryFn: () => fetchLeadVisits(userId as string, orgId, fromIso),
    enabled: !!userId && orgId !== undefined,
    staleTime: 30_000
  })
}
