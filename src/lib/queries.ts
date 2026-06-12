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
  // partner-shared jobs still surface. Partner-shared rows can come
  // back twice — once as the owner's row, once via the partnership
  // join — so dedupe by id before returning, mirroring the Home
  // pipeline dedupe in screens/Home.tsx.
  const { data, error } = await supabase
    .from('fh_contacts')
    .select('*, fh_clients(name, phone, email)')
    .order('updated_at', { ascending: false })
  if (error) throw error
  const rows = (data ?? []) as JobRow[]
  const byId = new Map<string, JobRow>()
  for (const r of rows) {
    if (r?.id && !byId.has(r.id)) byId.set(r.id, r)
  }
  return Array.from(byId.values())
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
  if (jobsRes.error) throw jobsRes.error
  if (paymentsRes.error) throw paymentsRes.error
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
// Three datasets: jobs in the active money pipeline (with the joined
// fh_clients fallback fields), every payment (for per-job paid
// rollups + month-to-date collection pace), and — pipeline v2 — the
// first-class fh_invoices rows so the screen can list real issued
// invoices, not just per-job balances. Bundled so the screen keeps a
// single loading flag, matching its prior behavior.

export type InvoiceJob = Contact & {
  fh_clients: Pick<Client, 'name' | 'email' | 'phone' | 'address'> | null
}

export type InvoiceRecord = Database['public']['Tables']['fh_invoices']['Row']

export type InvoicesBundle = {
  jobs: InvoiceJob[]
  payments: Payment[]
  invoices: InvoiceRecord[]
}

async function fetchInvoicesBundle(userId: string): Promise<InvoicesBundle> {
  const [jobsRes, paymentsRes, invoicesRes] = await Promise.all([
    supabase
      .from('fh_contacts')
      .select('*, fh_clients(name, email, phone, address)')
      .eq('user_id', userId)
      .in('stage', ['job', 'invoice', 'closed'])
      .order('created_at', { ascending: false }),
    supabase
      .from('fh_payments')
      .select('*')
      .eq('user_id', userId),
    supabase
      .from('fh_invoices')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false })
  ])
  if (jobsRes.error) throw jobsRes.error
  if (paymentsRes.error) throw paymentsRes.error
  if (invoicesRes.error) throw invoicesRes.error
  return {
    jobs: (jobsRes.data ?? []) as InvoiceJob[],
    payments: (paymentsRes.data ?? []) as Payment[],
    invoices: (invoicesRes.data ?? []) as InvoiceRecord[]
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

async function fetchSubsBundle(userId: string): Promise<SubsBundle> {
  const [subsRes, contactsRes] = await Promise.all([
    supabase
      .from('fh_subs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('fh_contacts')
      .select('id, name, job_title, stage')
      .eq('user_id', userId)
  ])
  if (subsRes.error) throw subsRes.error
  if (contactsRes.error) throw contactsRes.error
  return {
    subs: (subsRes.data ?? []) as Sub[],
    contacts: (contactsRes.data ?? []) as SubContact[]
  }
}

export function useSubsBundle(userId: string | undefined) {
  return useQuery({
    queryKey: ['subs', userId],
    queryFn: () => fetchSubsBundle(userId as string),
    enabled: !!userId
  })
}

export function useInvalidateSubs() {
  const client = useQueryClient()
  return () => client.invalidateQueries({ queryKey: ['subs'] })
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
  'id' | 'name' | 'stage' | 'job_title' | 'job_type' | 'amount' | 'updated_at'
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
  payments: Pick<Payment, 'contact_id' | 'amount'>[]
}

const EMPTY_CLIENT_DETAIL: Omit<ClientDetailBundle, 'client'> = {
  jobs: [], notes: [], files: [], payments: []
}

async function fetchClientDetail(id: string, userId: string): Promise<ClientDetailBundle> {
  const { data: client } = await supabase
    .from('fh_clients')
    .select('*')
    .eq('id', id)
    .eq('user_id', userId)
    .maybeSingle()

  if (!client) return { client: null, ...EMPTY_CLIENT_DETAIL }

  const { data: jobsData } = await supabase
    .from('fh_contacts')
    .select('id, name, stage, job_title, job_type, amount, updated_at')
    .eq('user_id', userId)
    .eq('client_id', client.id)
    .order('updated_at', { ascending: false })

  const jobs = (jobsData ?? []) as ClientJob[]
  const jobIds = jobs.map((r) => r.id)
  if (jobIds.length === 0) {
    return { client: client as Client, ...EMPTY_CLIENT_DETAIL }
  }

  const [notesRes, filesRes, paymentsRes] = await Promise.all([
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
      .select('contact_id, amount')
      .eq('user_id', userId)
      .in('contact_id', jobIds)
  ])

  return {
    client: client as Client,
    jobs,
    notes: (notesRes.data ?? []) as ClientDetailBundle['notes'],
    files: (filesRes.data ?? []) as ClientDetailBundle['files'],
    payments: (paymentsRes.data ?? []) as ClientDetailBundle['payments']
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
    supabase.from('fh_contacts').select('*').eq('user_id', userId),
    supabase.from('fh_mileage').select('*').eq('user_id', userId).order('drove_on', { ascending: false }),
    supabase.from('fh_payments').select('*').eq('user_id', userId),
    supabase.from('fh_invoices').select('*').eq('user_id', userId),
    supabase.from('fh_change_orders').select('*').eq('user_id', userId),
    supabase.from('fh_clients').select('id, name').eq('user_id', userId),
    // Funnel source — every stage move with its timestamp (mig 023).
    supabase
      .from('fh_stage_transitions')
      .select('contact_id, from_stage, to_stage, transitioned_at')
      .eq('user_id', userId)
      .order('transitioned_at', { ascending: true })
      .limit(4000)
  ])
  return {
    contacts: (c.data ?? []) as Contact[],
    mileage: (m.data ?? []) as AnalyticsBundle['mileage'],
    payments: (p.data ?? []) as Payment[],
    invoices: (inv.data ?? []) as AnalyticsBundle['invoices'],
    changeOrders: (co.data ?? []) as AnalyticsBundle['changeOrders'],
    clients: (cli.data ?? []) as AnalyticsBundle['clients'],
    stageTransitions: (st.data ?? []) as StageTransition[]
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

async function fetchSubDetail(key: string, userId: string): Promise<SubDetailBundle> {
  const [{ data: subs, error: subsErr }, { data: prof, error: profErr }] = await Promise.all([
    supabase
      .from('fh_subs')
      .select('*')
      .eq('user_id', userId)
      .order('created_at', { ascending: false }),
    supabase
      .from('fh_sub_profiles')
      .select('*')
      .eq('user_id', userId)
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
    const { data: cs } = await supabase
      .from('fh_contacts')
      .select('id, name, job_title, stage')
      .in('id', ids)
    for (const c of (cs ?? []) as SubContact[]) contacts[c.id] = c
  }

  return { subRows, contacts, profile: matchingProfile }
}

export function subDetailKey(key: string | undefined) {
  return ['subDetail', key] as const
}

export function useSubDetail(key: string | undefined, userId: string | undefined) {
  return useQuery({
    queryKey: subDetailKey(key),
    queryFn: () => fetchSubDetail(key as string, userId as string),
    enabled: !!key && !!userId
  })
}
