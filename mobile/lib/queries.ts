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

// ---- Clients ----
export type Payment = Database['public']['Tables']['fh_payments']['Row']

export type ClientsBundle = {
  clients: Client[]
  jobs: Pick<Contact, 'id' | 'client_id' | 'amount' | 'stage'>[]
  payments: Pick<Payment, 'contact_id' | 'amount'>[]
}

async function fetchClientsBundle(userId: string): Promise<ClientsBundle> {
  const [clientsRes, jobsRes, paymentsRes] = await Promise.all([
    supabase.from('fh_clients').select('*').eq('user_id', userId)
      .order('last_activity_at', { ascending: false, nullsFirst: false })
      .order('created_at', { ascending: false }),
    supabase.from('fh_contacts').select('id, client_id, amount, stage').eq('user_id', userId),
    supabase.from('fh_payments').select('contact_id, amount').eq('user_id', userId)
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
    queryKey: ['clients', userId],
    queryFn: () => fetchClientsBundle(userId as string),
    enabled: !!userId
  })
}

// ---- Client detail ----
// One client plus the jobs linked to them, for the client detail screen.
export type ClientDetail = {
  client: Client | null
  jobs: Pick<Contact, 'id' | 'name' | 'job_title' | 'job_type' | 'amount' | 'stage'>[]
}

async function fetchClientDetail(id: string): Promise<ClientDetail> {
  const [c, j] = await Promise.all([
    supabase.from('fh_clients').select('*').eq('id', id).maybeSingle(),
    supabase.from('fh_contacts').select('id, name, job_title, job_type, amount, stage')
      .eq('client_id', id).order('updated_at', { ascending: false })
  ])
  return {
    client: (c.data ?? null) as Client | null,
    jobs: (j.data ?? []) as ClientDetail['jobs']
  }
}

export function useClientDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['clientDetail', id],
    queryFn: () => fetchClientDetail(id as string),
    enabled: !!id
  })
}

// Create a standalone client, then invalidate the roster.
export type NewClientInput = {
  userId: string
  name: string
  companyName?: string
  phone?: string
  email?: string
  address?: string
}

export function useCreateClient() {
  const client = useQueryClient()
  return async (input: NewClientInput) => {
    const { data, error } = await supabase.from('fh_clients').insert({
      user_id: input.userId,
      name: input.name,
      company_name: input.companyName || null,
      phone: input.phone || null,
      email: input.email || null,
      address: input.address || null
    } as any).select('id').single()
    if (!error) client.invalidateQueries({ queryKey: ['clients', input.userId] })
    return { id: (data as any)?.id as string | undefined, error }
  }
}

// Edit a client's core fields, then invalidate the client detail + roster.
export type UpdateClientInput = {
  clientId: string
  userId: string
  name?: string
  companyName?: string | null
  phone?: string | null
  email?: string | null
  address?: string | null
  notes?: string | null
}

export function useUpdateClient() {
  const client = useQueryClient()
  return async (input: UpdateClientInput) => {
    const patch: Record<string, unknown> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.companyName !== undefined) patch.company_name = input.companyName
    if (input.phone !== undefined) patch.phone = input.phone
    if (input.email !== undefined) patch.email = input.email
    if (input.address !== undefined) patch.address = input.address
    if (input.notes !== undefined) patch.notes = input.notes
    const { error } = await supabase.from('fh_clients')
      .update(patch as any)
      .eq('id', input.clientId)
    if (!error) {
      client.invalidateQueries({ queryKey: ['clientDetail', input.clientId] })
      client.invalidateQueries({ queryKey: ['clients', input.userId] })
    }
    return { error }
  }
}

// ---- Schedule (next 7 days) ----
export type ScheduleEvent =
  Database['public']['Tables']['fh_schedule']['Row'] & {
    fh_contacts: Pick<Contact, 'name' | 'stage'> | null
  }

async function fetchUpcoming(userId: string, days: number): Promise<ScheduleEvent[]> {
  const now = new Date()
  const end = new Date(now)
  end.setDate(end.getDate() + days)
  end.setHours(23, 59, 59, 999)
  const { data, error } = await supabase
    .from('fh_schedule')
    .select('*, fh_contacts(name, stage)')
    .eq('user_id', userId)
    .gte('start_at', now.toISOString())
    .lt('start_at', end.toISOString())
    .order('start_at', { ascending: true })
    .limit(100)
  if (error) throw error
  return (data ?? []) as ScheduleEvent[]
}

export function useUpcomingEvents(userId: string | undefined, days = 7) {
  return useQuery({
    queryKey: ['scheduleUpcoming', userId, days],
    queryFn: () => fetchUpcoming(userId as string, days),
    enabled: !!userId
  })
}

// ---- Job detail ----
// One job's worth of data for the detail screen: the contact row plus
// its payments, schedule, subs, and expenses. Mirrors the web
// useJobData fetch (lighter — no client lookup / change orders yet).
export type Todo = Database['public']['Tables']['fh_job_todos']['Row']
export type Note = Database['public']['Tables']['fh_notes']['Row']
export type Invoice = Database['public']['Tables']['fh_invoices']['Row']
export type ChangeOrder = Database['public']['Tables']['fh_change_orders']['Row']
export type Mileage = Database['public']['Tables']['fh_mileage']['Row']
export type Inspection = Database['public']['Tables']['fh_inspections']['Row']

export type JobDetail = {
  contact: Contact | null
  payments: Payment[]
  schedule: Database['public']['Tables']['fh_schedule']['Row'][]
  subs: Database['public']['Tables']['fh_subs']['Row'][]
  expenses: Database['public']['Tables']['fh_expenses']['Row'][]
  todos: Todo[]
  notes: Note[]
  invoices: Invoice[]
  changeOrders: ChangeOrder[]
  mileage: Mileage[]
  inspections: Inspection[]
}

async function fetchJobDetail(id: string): Promise<JobDetail> {
  const [c, p, sch, s, e, t, n, inv, co, mi, insp] = await Promise.all([
    supabase.from('fh_contacts').select('*').eq('id', id).maybeSingle(),
    supabase.from('fh_payments').select('*').eq('contact_id', id).order('paid_on', { ascending: false }),
    supabase.from('fh_schedule').select('*').eq('contact_id', id).order('start_at', { ascending: true }),
    supabase.from('fh_subs').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
    supabase.from('fh_expenses').select('*').eq('contact_id', id).order('expense_date', { ascending: false }),
    supabase.from('fh_job_todos').select('*').eq('job_id', id).order('done', { ascending: true }).order('created_at', { ascending: true }),
    supabase.from('fh_notes').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
    supabase.from('fh_invoices').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
    supabase.from('fh_change_orders').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
    supabase.from('fh_mileage').select('*').eq('contact_id', id).order('drove_on', { ascending: false }),
    supabase.from('fh_inspections').select('*').eq('contact_id', id).order('created_at', { ascending: false })
  ])
  return {
    contact: (c.data ?? null) as Contact | null,
    payments: (p.data ?? []) as Payment[],
    schedule: (sch.data ?? []) as JobDetail['schedule'],
    subs: (s.data ?? []) as JobDetail['subs'],
    expenses: (e.data ?? []) as JobDetail['expenses'],
    todos: (t.data ?? []) as Todo[],
    notes: (n.data ?? []) as Note[],
    invoices: (inv.data ?? []) as Invoice[],
    changeOrders: (co.data ?? []) as ChangeOrder[],
    mileage: (mi.data ?? []) as Mileage[],
    inspections: (insp.data ?? []) as Inspection[]
  }
}

export function useJobDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['jobDetail', id],
    queryFn: () => fetchJobDetail(id as string),
    enabled: !!id
  })
}

// Log a payment against a job, then invalidate the detail + lists so
// balances refresh everywhere. Returns the supabase error (or null).
export function useLogPayment() {
  const client = useQueryClient()
  return async (input: { contactId: string; userId: string; amount: number; method?: string; paidOn?: string }) => {
    const { error } = await supabase.from('fh_payments').insert({
      user_id: input.userId,
      contact_id: input.contactId,
      amount: input.amount,
      method: input.method || 'check',
      paid_on: input.paidOn || new Date().toISOString().slice(0, 10)
    } as any)
    if (!error) {
      client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
      client.invalidateQueries({ queryKey: ['invoiceDetail', input.contactId] })
      client.invalidateQueries({ queryKey: ['invoicesOverview', input.userId] })
      client.invalidateQueries({ queryKey: ['activityFeed', input.userId] })
      client.invalidateQueries({ queryKey: queryKeys.jobs })
    }
    return { error }
  }
}

// Update a job's pipeline stage, then invalidate the detail + lists so
// the new stage shows everywhere. Returns the supabase error (or null).
export function useUpdateStage() {
  const client = useQueryClient()
  return async (input: { contactId: string; stage: string }) => {
    const { error } = await supabase.from('fh_contacts')
      .update({ stage: input.stage } as any)
      .eq('id', input.contactId)
    if (!error) {
      client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
      client.invalidateQueries({ queryKey: queryKeys.jobs })
    }
    return { error }
  }
}

// Edit a job's core fields, then invalidate the detail + lists.
export type UpdateJobInput = {
  contactId: string
  name?: string
  jobTitle?: string | null
  phone?: string | null
  email?: string | null
  amount?: number | null
  notes?: string | null
  address?: string | null
  clientId?: string | null
}

export function useUpdateJob() {
  const client = useQueryClient()
  return async (input: UpdateJobInput) => {
    const patch: Record<string, unknown> = {}
    if (input.name !== undefined) patch.name = input.name
    if (input.jobTitle !== undefined) patch.job_title = input.jobTitle
    if (input.phone !== undefined) patch.phone = input.phone
    if (input.email !== undefined) patch.email = input.email
    if (input.amount !== undefined) patch.amount = input.amount
    if (input.notes !== undefined) patch.notes = input.notes
    if (input.address !== undefined) patch.address = input.address
    if (input.clientId !== undefined) patch.client_id = input.clientId
    const { error } = await supabase.from('fh_contacts')
      .update(patch as any)
      .eq('id', input.contactId)
    if (!error) {
      client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
      client.invalidateQueries({ queryKey: queryKeys.jobs })
    }
    return { error }
  }
}

// ---- Subs (subcontractors) ----
export type NewSubInput = {
  userId: string
  contactId: string
  name: string
  trade?: string
  phone?: string
  rate?: number
}

export function useAddSub() {
  const client = useQueryClient()
  return async (input: NewSubInput) => {
    const { error } = await supabase.from('fh_subs').insert({
      user_id: input.userId,
      contact_id: input.contactId,
      name: input.name,
      trade: input.trade || null,
      phone: input.phone || null,
      rate: input.rate ?? null,
      status: 'active'
    } as any)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

export function useDeleteSub() {
  const client = useQueryClient()
  return async (input: { id: string; contactId: string }) => {
    const { error } = await supabase.from('fh_subs').delete().eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

// ---- Job photos ----
// Photos live in the PRIVATE `job-photos` Storage bucket and are indexed
// in fh_job_files (kind='photo'), same as the web app. We fetch the rows
// then batch-sign their URLs (1h TTL) so they can render in <Image>.
const PHOTO_BUCKET = 'job-photos'
const PHOTO_SIGN_TTL = 3600

export type JobPhoto = { id: string; path: string; url: string; uploadedAt: string | null }

async function fetchJobPhotos(jobId: string): Promise<JobPhoto[]> {
  const { data: rows, error } = await supabase
    .from('fh_job_files')
    .select('id, storage_path, uploaded_at')
    .eq('job_id', jobId)
    .eq('kind', 'photo')
    .order('uploaded_at', { ascending: false })
  if (error || !rows || rows.length === 0) return []
  const paths = rows.map((r) => r.storage_path)
  const { data: signed } = await supabase.storage.from(PHOTO_BUCKET).createSignedUrls(paths, PHOTO_SIGN_TTL)
  const urlByPath = new Map<string, string>()
  for (const s of signed ?? []) {
    if (s?.path && s.signedUrl && !s.error) urlByPath.set(s.path, s.signedUrl)
  }
  return rows
    .map((r) => ({ id: r.id, path: r.storage_path, url: urlByPath.get(r.storage_path) || '', uploadedAt: r.uploaded_at }))
    .filter((p) => p.url)
}

export function useJobPhotos(jobId: string | undefined) {
  return useQuery({
    queryKey: ['jobPhotos', jobId],
    queryFn: () => fetchJobPhotos(jobId as string),
    enabled: !!jobId
  })
}

export function useUploadPhoto() {
  const client = useQueryClient()
  return async (input: { userId: string; jobId: string; uri: string }) => {
    const pathId = `${Date.now()}-${Math.random().toString(36).slice(2, 10)}`
    const path = `${input.userId}/${input.jobId}/${pathId}.jpg`
    const arrayBuffer = await fetch(input.uri).then((r) => r.arrayBuffer())
    const { error: upErr } = await supabase.storage
      .from(PHOTO_BUCKET)
      .upload(path, arrayBuffer, { contentType: 'image/jpeg', upsert: false })
    if (upErr) return { error: upErr }
    const { error: insErr } = await supabase.from('fh_job_files').insert({
      user_id: input.userId,
      job_id: input.jobId,
      filename: `${pathId}.jpg`,
      storage_path: path,
      mime_type: 'image/jpeg',
      size_bytes: (arrayBuffer as ArrayBuffer).byteLength,
      kind: 'photo'
    } as any)
    if (!insErr) client.invalidateQueries({ queryKey: ['jobPhotos', input.jobId] })
    return { error: insErr }
  }
}

export function useDeletePhoto() {
  const client = useQueryClient()
  return async (input: { id: string; path: string; jobId: string }) => {
    await supabase.storage.from(PHOTO_BUCKET).remove([input.path])
    const { error } = await supabase.from('fh_job_files').delete().eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['jobPhotos', input.jobId] })
    return { error }
  }
}

// ---- Create lead ----
// Insert a new fh_contacts row at a chosen stage, then invalidate the
// jobs list. Mirrors the web NewLeadSheet's minimal create path.
export type NewLeadInput = {
  userId: string
  name: string
  phone?: string
  email?: string
  jobType?: string
  amount?: number
  stage?: string
}

export function useCreateLead() {
  const client = useQueryClient()
  return async (input: NewLeadInput) => {
    const { data, error } = await supabase.from('fh_contacts').insert({
      user_id: input.userId,
      name: input.name,
      phone: input.phone || null,
      email: input.email || null,
      job_type: input.jobType || null,
      amount: input.amount ?? null,
      stage: input.stage || 'lead'
    } as any).select('id').single()
    if (!error) client.invalidateQueries({ queryKey: queryKeys.jobs })
    return { id: (data as any)?.id as string | undefined, error }
  }
}

// ---- Create schedule event ----
// Insert a new fh_schedule row, then invalidate the upcoming list so the
// Schedule screen reflects it. Mirrors the web schedule create path.
export type NewEventInput = {
  userId: string
  title: string
  startAt: string
  endAt?: string
  contactId?: string
}

export function useCreateEvent() {
  const client = useQueryClient()
  return async (input: NewEventInput) => {
    const { data, error } = await supabase.from('fh_schedule').insert({
      user_id: input.userId,
      title: input.title,
      start_at: input.startAt,
      end_at: input.endAt ?? null,
      contact_id: input.contactId ?? null
    } as any).select('id').single()
    if (!error) client.invalidateQueries({ queryKey: ['scheduleUpcoming', input.userId] })
    return { id: (data as any)?.id as string | undefined, error }
  }
}

// ---- Expenses ----
// Log an expense against a job, then invalidate the job detail so the
// expense list + totals refresh.
export type NewExpenseInput = {
  userId: string
  contactId: string
  amount: number
  category?: string
  description?: string
  expenseDate?: string
}

export function useAddExpense() {
  const client = useQueryClient()
  return async (input: NewExpenseInput) => {
    const { error } = await supabase.from('fh_expenses').insert({
      user_id: input.userId,
      contact_id: input.contactId,
      amount: input.amount,
      category: input.category || null,
      description: input.description || null,
      expense_date: input.expenseDate || new Date().toISOString().slice(0, 10)
    } as any)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

// ---- Deletes ----
// Each delete invalidates the lists it affects. Job/event/payment/expense
// deletes are scoped by id; client delete also refreshes the roster.
export function useDeleteJob() {
  const client = useQueryClient()
  return async (contactId: string) => {
    const { error } = await supabase.from('fh_contacts').delete().eq('id', contactId)
    if (!error) client.invalidateQueries({ queryKey: queryKeys.jobs })
    return { error }
  }
}

export function useDeleteEvent() {
  const client = useQueryClient()
  return async (input: { id: string; userId: string }) => {
    const { error } = await supabase.from('fh_schedule').delete().eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['scheduleUpcoming', input.userId] })
    return { error }
  }
}

export function useUpdateEvent() {
  const client = useQueryClient()
  return async (input: { id: string; userId: string; title?: string; startAt?: string; contactId?: string | null }) => {
    const patch: Record<string, unknown> = {}
    if (input.title !== undefined) patch.title = input.title
    if (input.startAt !== undefined) patch.start_at = input.startAt
    if (input.contactId !== undefined) patch.contact_id = input.contactId
    const { error } = await supabase.from('fh_schedule').update(patch as any).eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['scheduleUpcoming', input.userId] })
    return { error }
  }
}

export function useDeletePayment() {
  const client = useQueryClient()
  return async (input: { id: string; contactId: string }) => {
    const { error } = await supabase.from('fh_payments').delete().eq('id', input.id)
    if (!error) {
      client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
      client.invalidateQueries({ queryKey: queryKeys.jobs })
    }
    return { error }
  }
}

export function useDeleteExpense() {
  const client = useQueryClient()
  return async (input: { id: string; contactId: string }) => {
    const { error } = await supabase.from('fh_expenses').delete().eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

export function useDeleteClient() {
  const client = useQueryClient()
  return async (input: { id: string; userId: string }) => {
    const { error } = await supabase.from('fh_clients').delete().eq('id', input.id)
    if (!error) {
      client.invalidateQueries({ queryKey: ['clients', input.userId] })
      client.invalidateQueries({ queryKey: queryKeys.jobs })
    }
    return { error }
  }
}

// ---- Todos ----
export function useAddTodo() {
  const client = useQueryClient()
  return async (input: { userId: string; jobId: string; text: string }) => {
    const { error } = await supabase.from('fh_job_todos').insert({
      user_id: input.userId, job_id: input.jobId, text: input.text, done: false
    } as any)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.jobId] })
    return { error }
  }
}

export function useToggleTodo() {
  const client = useQueryClient()
  return async (input: { id: string; jobId: string; done: boolean }) => {
    const { error } = await supabase.from('fh_job_todos')
      .update({ done: input.done, completed_at: input.done ? new Date().toISOString() : null } as any)
      .eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.jobId] })
    return { error }
  }
}

export function useDeleteTodo() {
  const client = useQueryClient()
  return async (input: { id: string; jobId: string }) => {
    const { error } = await supabase.from('fh_job_todos').delete().eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.jobId] })
    return { error }
  }
}

// ---- Notes ----
export function useAddNote() {
  const client = useQueryClient()
  return async (input: { userId: string; contactId: string; text: string; category?: string }) => {
    const { error } = await supabase.from('fh_notes').insert({
      user_id: input.userId, contact_id: input.contactId, text: input.text, category: input.category || 'note'
    } as any)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

export function useDeleteNote() {
  const client = useQueryClient()
  return async (input: { id: string; contactId: string }) => {
    const { error } = await supabase.from('fh_notes').delete().eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

// ---- Invoices ----
export function useCreateInvoice() {
  const client = useQueryClient()
  return async (input: { userId: string; contactId: string; amount: number; title?: string; dueAt?: string }) => {
    const { error } = await supabase.from('fh_invoices').insert({
      user_id: input.userId,
      contact_id: input.contactId,
      amount: input.amount,
      title: input.title || null,
      due_at: input.dueAt || null,
      status: 'draft',
      issued_at: new Date().toISOString()
    } as any)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

export function useUpdateInvoiceStatus() {
  const client = useQueryClient()
  return async (input: { id: string; contactId: string; status: string }) => {
    const { error } = await supabase.from('fh_invoices')
      .update({ status: input.status } as any)
      .eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

export function useDeleteInvoice() {
  const client = useQueryClient()
  return async (input: { id: string; contactId: string }) => {
    const { error } = await supabase.from('fh_invoices').delete().eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

// ---- Quote / estimate line items ----
export type QuoteItem = Database['public']['Tables']['fh_quote_items']['Row']

export function useQuoteItems(jobId: string | undefined) {
  return useQuery({
    queryKey: ['quoteItems', jobId],
    queryFn: async () => {
      const { data } = await supabase.from('fh_quote_items').select('*')
        .eq('contact_id', jobId as string)
        .order('sort_order', { ascending: true })
        .order('created_at', { ascending: true })
      return (data ?? []) as QuoteItem[]
    },
    enabled: !!jobId
  })
}

export type QuoteItemInput = {
  description: string
  qty: number
  rate: number
  unit?: string
  section?: string
  isOptional?: boolean
  isExcluded?: boolean
}

export function useAddQuoteItem() {
  const client = useQueryClient()
  return async (input: { userId: string; jobId: string; item: QuoteItemInput }) => {
    const { item } = input
    const { error } = await supabase.from('fh_quote_items').insert({
      user_id: input.userId,
      contact_id: input.jobId,
      description: item.description,
      qty: item.qty,
      rate: item.rate,
      amount: item.qty * item.rate,
      unit: item.unit || null,
      section: item.section || null,
      is_optional: item.isOptional ?? false,
      is_excluded: item.isExcluded ?? false
    } as any)
    if (!error) client.invalidateQueries({ queryKey: ['quoteItems', input.jobId] })
    return { error }
  }
}

export function useUpdateQuoteItem() {
  const client = useQueryClient()
  return async (input: { id: string; jobId: string; item: QuoteItemInput }) => {
    const { item } = input
    const { error } = await supabase.from('fh_quote_items').update({
      description: item.description,
      qty: item.qty,
      rate: item.rate,
      amount: item.qty * item.rate,
      unit: item.unit || null,
      section: item.section || null,
      is_optional: item.isOptional ?? false,
      is_excluded: item.isExcluded ?? false
    } as any).eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['quoteItems', input.jobId] })
    return { error }
  }
}

export function useDeleteQuoteItem() {
  const client = useQueryClient()
  return async (input: { id: string; jobId: string }) => {
    const { error } = await supabase.from('fh_quote_items').delete().eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['quoteItems', input.jobId] })
    return { error }
  }
}

// Push the quote's base total onto the job's contract amount.
export function useApplyQuoteTotal() {
  const client = useQueryClient()
  return async (input: { jobId: string; amount: number }) => {
    const { error } = await supabase.from('fh_contacts')
      .update({ amount: input.amount } as any)
      .eq('id', input.jobId)
    if (!error) {
      client.invalidateQueries({ queryKey: ['jobDetail', input.jobId] })
      client.invalidateQueries({ queryKey: queryKeys.jobs })
    }
    return { error }
  }
}

// ---- Business profile ----
export type Profile = Database['public']['Tables']['profiles']['Row']

export function useProfile(userId: string | undefined) {
  return useQuery({
    queryKey: ['profile', userId],
    queryFn: async () => {
      const { data } = await supabase.from('profiles').select('*').eq('user_id', userId as string).maybeSingle()
      return (data ?? null) as Profile | null
    },
    enabled: !!userId
  })
}

export type UpdateProfileInput = {
  userId: string
  companyName?: string | null
  companyPhone?: string | null
  companyEmail?: string | null
  companyAddress?: string | null
  companyWebsite?: string | null
  licenseNumber?: string | null
  fullName?: string | null
}

export function useUpdateProfile() {
  const client = useQueryClient()
  return async (input: UpdateProfileInput) => {
    const patch: Record<string, unknown> = {}
    if (input.companyName !== undefined) patch.company_name = input.companyName
    if (input.companyPhone !== undefined) patch.company_phone = input.companyPhone
    if (input.companyEmail !== undefined) patch.company_email = input.companyEmail
    if (input.companyAddress !== undefined) patch.company_address = input.companyAddress
    if (input.companyWebsite !== undefined) patch.company_website = input.companyWebsite
    if (input.licenseNumber !== undefined) patch.license_number = input.licenseNumber
    if (input.fullName !== undefined) patch.full_name = input.fullName
    const { error } = await supabase.from('profiles')
      .update(patch as any)
      .eq('user_id', input.userId)
    if (!error) client.invalidateQueries({ queryKey: ['profile', input.userId] })
    return { error }
  }
}

// ---- Change orders ----
export function useAddChangeOrder() {
  const client = useQueryClient()
  return async (input: { userId: string; contactId: string; title: string; amount: number; description?: string }) => {
    const { error } = await supabase.from('fh_change_orders').insert({
      user_id: input.userId,
      contact_id: input.contactId,
      title: input.title,
      amount: input.amount,
      description: input.description || null,
      status: 'pending'
    } as any)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

export function useUpdateChangeOrderStatus() {
  const client = useQueryClient()
  return async (input: { id: string; contactId: string; status: string }) => {
    const { error } = await supabase.from('fh_change_orders')
      .update({ status: input.status, approved_at: input.status === 'approved' ? new Date().toISOString() : null } as any)
      .eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

export function useDeleteChangeOrder() {
  const client = useQueryClient()
  return async (input: { id: string; contactId: string }) => {
    const { error } = await supabase.from('fh_change_orders').delete().eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

// ---- Mileage ----
export function useAddMileage() {
  const client = useQueryClient()
  return async (input: { userId: string; contactId: string; miles: number; purpose?: string; droveOn?: string }) => {
    const { error } = await supabase.from('fh_mileage').insert({
      user_id: input.userId,
      contact_id: input.contactId,
      miles: input.miles,
      purpose: input.purpose || null,
      drove_on: input.droveOn || new Date().toISOString().slice(0, 10)
    } as any)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

export function useDeleteMileage() {
  const client = useQueryClient()
  return async (input: { id: string; contactId: string }) => {
    const { error } = await supabase.from('fh_mileage').delete().eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

// ---- Inspections ----
export function useAddInspection() {
  const client = useQueryClient()
  return async (input: { userId: string; contactId: string; trade: string; inspector?: string; result?: string }) => {
    const { error } = await supabase.from('fh_inspections').insert({
      user_id: input.userId,
      contact_id: input.contactId,
      trade: input.trade,
      inspector: input.inspector || null,
      result: input.result || 'pending'
    } as any)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

export function useUpdateInspectionResult() {
  const client = useQueryClient()
  return async (input: { id: string; contactId: string; result: string }) => {
    const { error } = await supabase.from('fh_inspections')
      .update({ result: input.result } as any)
      .eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

export function useDeleteInspection() {
  const client = useQueryClient()
  return async (input: { id: string; contactId: string }) => {
    const { error } = await supabase.from('fh_inspections').delete().eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['jobDetail', input.contactId] })
    return { error }
  }
}

// ---- Notifications ----
export type Notification = Database['public']['Tables']['fh_notifications']['Row']

export function useNotifications(userId: string | undefined) {
  return useQuery({
    queryKey: ['notifications', userId],
    queryFn: async () => {
      const { data } = await supabase.from('fh_notifications').select('*')
        .eq('user_id', userId as string)
        .order('created_at', { ascending: false })
        .limit(100)
      return (data ?? []) as Notification[]
    },
    enabled: !!userId
  })
}

export function useMarkNotificationRead() {
  const client = useQueryClient()
  return async (input: { id: string; userId: string }) => {
    const { error } = await supabase.from('fh_notifications')
      .update({ read_at: new Date().toISOString() } as any)
      .eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['notifications', input.userId] })
    return { error }
  }
}

export function useMarkAllNotificationsRead() {
  const client = useQueryClient()
  return async (userId: string) => {
    const { error } = await supabase.from('fh_notifications')
      .update({ read_at: new Date().toISOString() } as any)
      .eq('user_id', userId)
      .is('read_at', null)
    if (!error) client.invalidateQueries({ queryKey: ['notifications', userId] })
    return { error }
  }
}

// ---- Home: recent activity (recent payments with the job/contact name) ----
export type ActivityItem = {
  id: string
  amount: number
  name: string | null
  date: string | null
  kind: string | null
}

export function useRecentActivity(userId: string | undefined) {
  return useQuery({
    queryKey: ['recentActivity', userId],
    queryFn: async (): Promise<ActivityItem[]> => {
      const { data } = await supabase
        .from('fh_payments')
        .select('id, amount, paid_on, created_at, kind, fh_contacts(name)')
        .eq('user_id', userId as string)
        .order('created_at', { ascending: false })
        .limit(6)
      return ((data ?? []) as any[]).map((p) => ({
        id: p.id,
        amount: Number(p.amount || 0),
        name: p.fh_contacts?.name ?? null,
        date: p.paid_on || p.created_at || null,
        kind: p.kind ?? null
      }))
    },
    enabled: !!userId
  })
}

// ---- Home: agenda (today's events + overdue events) ----
export type AgendaEvent = ScheduleEvent
export type Agenda = { today: AgendaEvent[]; overdue: AgendaEvent[] }

export function useAgenda(userId: string | undefined) {
  return useQuery({
    queryKey: ['agenda', userId],
    queryFn: async (): Promise<Agenda> => {
      const now = new Date()
      const startToday = new Date(now); startToday.setHours(0, 0, 0, 0)
      const endToday = new Date(now); endToday.setHours(23, 59, 59, 999)
      const from = new Date(now); from.setDate(from.getDate() - 45)
      const { data } = await supabase
        .from('fh_schedule')
        .select('*, fh_contacts(name, stage)')
        .eq('user_id', userId as string)
        .gte('start_at', from.toISOString())
        .lte('start_at', endToday.toISOString())
        .order('start_at', { ascending: true })
        .limit(100)
      const rows = (data ?? []) as AgendaEvent[]
      const today: AgendaEvent[] = []
      const overdue: AgendaEvent[] = []
      for (const e of rows) {
        if (!e.start_at) continue
        const t = new Date(e.start_at)
        if (t >= startToday && t <= endToday) today.push(e)
        else if (t < startToday) overdue.push(e)
      }
      overdue.reverse() // most recent overdue first
      return { today, overdue }
    },
    enabled: !!userId
  })
}

// ---- Cover photos (latest photo per job, batch-signed) ----
// Mirrors the web fetchCoverPhotosByJob: one query for all the user's
// photos + ONE batch signed-URL call. Returns jobId -> signed URL.
export function useCoverPhotos(userId: string | undefined) {
  return useQuery({
    queryKey: ['coverPhotos', userId],
    queryFn: async (): Promise<Record<string, string>> => {
      const { data: photos } = await supabase
        .from('fh_job_files')
        .select('job_id, storage_path, uploaded_at')
        .eq('user_id', userId as string)
        .eq('kind', 'photo')
        .order('uploaded_at', { ascending: false })
      if (!photos || photos.length === 0) return {}
      const pathByJob = new Map<string, string>()
      for (const p of photos as any[]) {
        if (p.job_id && p.storage_path && !pathByJob.has(p.job_id)) pathByJob.set(p.job_id, p.storage_path)
      }
      const uniquePaths = Array.from(new Set(pathByJob.values()))
      if (uniquePaths.length === 0) return {}
      const { data: signed } = await supabase.storage.from('job-photos').createSignedUrls(uniquePaths, 3600)
      const urlByPath = new Map<string, string>()
      for (const s of signed ?? []) { if (s?.path && s.signedUrl && !s.error) urlByPath.set(s.path, s.signedUrl) }
      const out: Record<string, string> = {}
      for (const [jobId, path] of pathByJob.entries()) { const u = urlByPath.get(path); if (u) out[jobId] = u }
      return out
    },
    enabled: !!userId
  })
}

// ---- Invoices & Payments overview (all invoices across jobs) ----
export type InvoiceRow = {
  id: string
  contactId: string | null
  name: string | null
  email: string | null
  amount: number
  status: string
  issuedAt: string | null
  dueAt: string | null
  sequence: number | null
  ageDays: number
}
export type InvoicesOverview = {
  invoices: InvoiceRow[]
  totalOutstanding: number
  current: number
  late: number
  overdue: number
  collectedThisMonth: number
  outstandingCount: number
}

export function useInvoicesOverview(userId: string | undefined) {
  return useQuery({
    queryKey: ['invoicesOverview', userId],
    queryFn: async (): Promise<InvoicesOverview> => {
      const [invRes, payRes] = await Promise.all([
        supabase.from('fh_invoices').select('id, contact_id, amount, status, issued_at, due_at, sequence_number, fh_contacts(name, email)').eq('user_id', userId as string).order('issued_at', { ascending: false }),
        supabase.from('fh_payments').select('amount, paid_on').eq('user_id', userId as string)
      ])
      const now = Date.now()
      const monthStart = new Date(); monthStart.setDate(1); monthStart.setHours(0, 0, 0, 0)
      const invoices: InvoiceRow[] = ((invRes.data ?? []) as any[]).map((i) => {
        const issued = i.issued_at ? new Date(i.issued_at).getTime() : now
        return {
          id: i.id, contactId: i.contact_id, name: i.fh_contacts?.name ?? null, email: i.fh_contacts?.email ?? null,
          amount: Number(i.amount || 0), status: i.status || 'draft', issuedAt: i.issued_at, dueAt: i.due_at,
          sequence: i.sequence_number ?? null, ageDays: Math.max(0, Math.floor((now - issued) / 86400000))
        }
      })
      let current = 0, late = 0, overdue = 0, totalOutstanding = 0
      for (const inv of invoices) {
        if (inv.status === 'paid' || inv.status === 'void') continue
        totalOutstanding += inv.amount
        if (inv.ageDays <= 30) current += inv.amount
        else if (inv.ageDays <= 60) late += inv.amount
        else overdue += inv.amount
      }
      const collectedThisMonth = ((payRes.data ?? []) as any[]).reduce((s, p) => {
        const d = p.paid_on ? new Date(p.paid_on).getTime() : 0
        return d >= monthStart.getTime() ? s + Number(p.amount || 0) : s
      }, 0)
      return {
        invoices, totalOutstanding, current, late, overdue, collectedThisMonth,
        outstandingCount: invoices.filter((i) => i.status !== 'paid' && i.status !== 'void').length
      }
    },
    enabled: !!userId
  })
}

export function useMarkInvoicePaid() {
  const client = useQueryClient()
  return async (input: { id: string; userId: string }) => {
    const { error } = await supabase.from('fh_invoices').update({ status: 'paid' } as any).eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['invoicesOverview', input.userId] })
    return { error }
  }
}

// ---- Unified activity feed (across payments, leads, invoices, COs, notes) ----
export type FeedKind = 'payment' | 'lead' | 'invoice' | 'change_order' | 'note'
export type FeedItem = {
  id: string
  kind: FeedKind
  title: string
  sub: string | null
  amount: number | null
  contactId: string | null
  contactName: string | null
  date: string
}

export function useActivityFeed(userId: string | undefined) {
  return useQuery({
    queryKey: ['activityFeed', userId],
    queryFn: async (): Promise<FeedItem[]> => {
      const uid = userId as string
      const [pays, leads, invs, cos, notes] = await Promise.all([
        supabase.from('fh_payments').select('id, amount, kind, paid_on, created_at, contact_id, fh_contacts(name)').eq('user_id', uid).order('created_at', { ascending: false }).limit(25),
        supabase.from('fh_contacts').select('id, name, stage, amount, created_at').eq('user_id', uid).order('created_at', { ascending: false }).limit(25),
        supabase.from('fh_invoices').select('id, amount, status, sequence_number, created_at, contact_id, fh_contacts(name)').eq('user_id', uid).order('created_at', { ascending: false }).limit(25),
        supabase.from('fh_change_orders').select('id, amount, title, status, created_at, contact_id, fh_contacts(name)').eq('user_id', uid).order('created_at', { ascending: false }).limit(25),
        supabase.from('fh_notes').select('id, text, created_at, contact_id, fh_contacts(name)').eq('user_id', uid).order('created_at', { ascending: false }).limit(25)
      ])
      const items: FeedItem[] = []
      for (const p of (pays.data ?? []) as any[]) items.push({
        id: `pay-${p.id}`, kind: 'payment', title: 'Payment received', sub: p.kind ? String(p.kind).replace(/_/g, ' ') : null,
        amount: Number(p.amount || 0), contactId: p.contact_id, contactName: p.fh_contacts?.name ?? null, date: p.paid_on || p.created_at || ''
      })
      for (const l of (leads.data ?? []) as any[]) items.push({
        id: `lead-${l.id}`, kind: 'lead', title: 'New lead added', sub: l.stage ? String(l.stage).replace(/_/g, ' ') : null,
        amount: l.amount ? Number(l.amount) : null, contactId: l.id, contactName: l.name ?? null, date: l.created_at || ''
      })
      for (const i of (invs.data ?? []) as any[]) items.push({
        id: `inv-${i.id}`, kind: 'invoice', title: `Invoice ${i.status === 'paid' ? 'paid' : 'created'}`, sub: i.sequence_number ? `#${i.sequence_number}` : null,
        amount: Number(i.amount || 0), contactId: i.contact_id, contactName: i.fh_contacts?.name ?? null, date: i.created_at || ''
      })
      for (const c of (cos.data ?? []) as any[]) items.push({
        id: `co-${c.id}`, kind: 'change_order', title: c.title || 'Change order', sub: c.status ? String(c.status).replace(/_/g, ' ') : null,
        amount: Number(c.amount || 0), contactId: c.contact_id, contactName: c.fh_contacts?.name ?? null, date: c.created_at || ''
      })
      for (const n of (notes.data ?? []) as any[]) items.push({
        id: `note-${n.id}`, kind: 'note', title: 'Note added', sub: n.text ? String(n.text).slice(0, 80) : null,
        amount: null, contactId: n.contact_id, contactName: n.fh_contacts?.name ?? null, date: n.created_at || ''
      })
      return items.filter((i) => i.date).sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 60)
    },
    enabled: !!userId
  })
}

// ---- Partners roster (people you've shared jobs with) ----
export type PartnerEntry = {
  email: string
  name: string | null
  role: string | null
  jobs: { id: string; name: string | null; status: string }[]
  accepted: number
  pending: number
}

export function usePartners(userId: string | undefined) {
  return useQuery({
    queryKey: ['partners', userId],
    queryFn: async (): Promise<PartnerEntry[]> => {
      const { data } = await supabase
        .from('fh_job_partners')
        .select('id, partner_email, partner_name, partner_role, status, accepted_at, job_id, fh_contacts(name)')
        .eq('invited_by_user_id', userId as string)
        .order('invited_at', { ascending: false })
      const map = new Map<string, PartnerEntry>()
      for (const r of (data ?? []) as any[]) {
        const key = (r.partner_email || '').toLowerCase()
        if (!key) continue
        let e = map.get(key)
        if (!e) { e = { email: r.partner_email, name: r.partner_name ?? null, role: r.partner_role ?? null, jobs: [], accepted: 0, pending: 0 }; map.set(key, e) }
        if (!e.name && r.partner_name) e.name = r.partner_name
        if (!e.role && r.partner_role) e.role = r.partner_role
        const accepted = !!r.accepted_at || r.status === 'accepted'
        e.jobs.push({ id: r.job_id, name: r.fh_contacts?.name ?? null, status: r.status })
        if (accepted) e.accepted += 1; else e.pending += 1
      }
      return Array.from(map.values()).sort((a, b) => b.jobs.length - a.jobs.length)
    },
    enabled: !!userId
  })
}

// ---- Estimates / proposals list (current proposal state per job) ----
export type EstimateRow = {
  id: string
  name: string | null
  amount: number
  status: string
  sentAt: string | null
  expiresAt: string | null
  expired: boolean
}
export type EstimatesBundle = {
  rows: EstimateRow[]
  openValue: number
  acceptedValue: number
  winRate: number
}

const ACCEPTED = new Set(['accepted', 'approved', 'won', 'signed'])
const DECLINED = new Set(['declined', 'rejected', 'lost'])

export function useEstimates(userId: string | undefined) {
  return useQuery({
    queryKey: ['estimates', userId],
    queryFn: async (): Promise<EstimatesBundle> => {
      const { data } = await supabase
        .from('fh_contacts')
        .select('id, name, amount, proposal_status, quote_sent_at, quote_expires_at')
        .eq('user_id', userId as string)
        .order('quote_sent_at', { ascending: false, nullsFirst: false })
      const now = Date.now()
      const rows: EstimateRow[] = ((data ?? []) as any[])
        .filter((c) => c.proposal_status || c.quote_sent_at)
        .map((c) => {
          const status = (c.proposal_status || (c.quote_sent_at ? 'sent' : 'draft')).toLowerCase()
          const expired = !!c.quote_expires_at && new Date(c.quote_expires_at).getTime() < now && !ACCEPTED.has(status)
          return { id: c.id, name: c.name, amount: Number(c.amount || 0), status, sentAt: c.quote_sent_at, expiresAt: c.quote_expires_at, expired }
        })
      let openValue = 0, acceptedValue = 0, decided = 0, won = 0
      for (const r of rows) {
        if (ACCEPTED.has(r.status)) { acceptedValue += r.amount; decided++; won++ }
        else if (DECLINED.has(r.status)) { decided++ }
        else if (!r.expired) openValue += r.amount
      }
      return { rows, openValue, acceptedValue, winRate: decided ? Math.round((won / decided) * 100) : 0 }
    },
    enabled: !!userId
  })
}

// ---- Notes screen (global capture + feed, grouped by job) ----
export type NoteRow = {
  id: string
  text: string | null
  contactId: string | null
  createdAt: string | null
  category: string | null
}
export type NotesScreenData = {
  notes: NoteRow[]
  contacts: { id: string; name: string | null }[]
}

export function useNotesScreen(userId: string | undefined) {
  return useQuery({
    queryKey: ['notesScreen', userId],
    queryFn: async (): Promise<NotesScreenData> => {
      const uid = userId as string
      const [nRes, cRes] = await Promise.all([
        supabase.from('fh_notes').select('id, text, contact_id, created_at, category, done').eq('user_id', uid).order('created_at', { ascending: false }).limit(200),
        supabase.from('fh_contacts').select('id, name').eq('user_id', uid).order('name', { ascending: true })
      ])
      const notes: NoteRow[] = ((nRes.data ?? []) as any[])
        .filter((n) => !n.done)
        .map((n) => ({ id: n.id, text: n.text, contactId: n.contact_id, createdAt: n.created_at, category: n.category }))
      const contacts = ((cRes.data ?? []) as any[]).map((c) => ({ id: c.id, name: c.name }))
      return { notes, contacts }
    },
    enabled: !!userId
  })
}

export function useSaveNote() {
  const client = useQueryClient()
  return async (input: { userId: string; text: string; contactId: string | null }) => {
    const { error } = await supabase.from('fh_notes').insert({
      user_id: input.userId, text: input.text, contact_id: input.contactId, category: 'note'
    } as any)
    if (!error) {
      client.invalidateQueries({ queryKey: ['notesScreen', input.userId] })
      client.invalidateQueries({ queryKey: ['activityFeed', input.userId] })
    }
    return { error }
  }
}

export function useArchiveNote() {
  const client = useQueryClient()
  return async (input: { id: string; userId: string }) => {
    const { error } = await supabase.from('fh_notes').update({ done: true } as any).eq('id', input.id)
    if (!error) client.invalidateQueries({ queryKey: ['notesScreen', input.userId] })
    return { error }
  }
}

export function useDeleteNoteGlobal() {
  const client = useQueryClient()
  return async (input: { id: string; userId: string }) => {
    const { error } = await supabase.from('fh_notes').delete().eq('id', input.id)
    if (!error) {
      client.invalidateQueries({ queryKey: ['notesScreen', input.userId] })
      client.invalidateQueries({ queryKey: ['activityFeed', input.userId] })
    }
    return { error }
  }
}

// ---- Subs directory (roster rolled up from fh_subs) ----
export type SubRowRaw = {
  id: string
  name: string | null
  trade: string | null
  phone: string | null
  rate: number | null
  status: string | null
  contactId: string | null
  createdAt: string | null
}
export type SubsRoster = {
  subs: SubRowRaw[]
  contacts: Record<string, { id: string; name: string | null; jobTitle: string | null }>
}

export function useSubsRoster(userId: string | undefined) {
  return useQuery({
    queryKey: ['subsRoster', userId],
    queryFn: async (): Promise<SubsRoster> => {
      const uid = userId as string
      const [sRes, cRes] = await Promise.all([
        supabase.from('fh_subs').select('id, name, trade, phone, rate, status, contact_id, created_at').eq('user_id', uid).order('created_at', { ascending: false }),
        supabase.from('fh_contacts').select('id, name, job_title').eq('user_id', uid)
      ])
      const subs: SubRowRaw[] = ((sRes.data ?? []) as any[]).map((s) => ({
        id: s.id, name: s.name, trade: s.trade, phone: s.phone, rate: s.rate, status: s.status, contactId: s.contact_id, createdAt: s.created_at
      }))
      const contacts: SubsRoster['contacts'] = {}
      for (const c of (cRes.data ?? []) as any[]) contacts[c.id] = { id: c.id, name: c.name, jobTitle: c.job_title }
      return { subs, contacts }
    },
    enabled: !!userId
  })
}

export function useAddSubGlobal() {
  const client = useQueryClient()
  return async (input: { userId: string; name: string; trade: string | null; phone: string | null }) => {
    const { error } = await supabase.from('fh_subs').insert({
      user_id: input.userId, contact_id: null, name: input.name, trade: input.trade, phone: input.phone
    } as any)
    if (!error) client.invalidateQueries({ queryKey: ['subsRoster', input.userId] })
    return { error }
  }
}

// ---- Invoice detail (per-job billing summary) ----
export type InvoiceDetailData = {
  contact: { id: string; name: string | null; jobTitle: string | null; stage: string | null; amount: number; email: string | null; phone: string | null; createdAt: string | null }
  payments: { id: string; amount: number; method: string | null; reference: string | null; paidOn: string | null }[]
  amount: number
  paid: number
  balance: number
  pctPaid: number
  ageDays: number
}

export function useInvoiceDetail(id: string | undefined) {
  return useQuery({
    queryKey: ['invoiceDetail', id],
    queryFn: async (): Promise<InvoiceDetailData | null> => {
      const cid = id as string
      const [cRes, pRes] = await Promise.all([
        supabase.from('fh_contacts').select('id, name, job_title, stage, amount, email, phone, created_at').eq('id', cid).single(),
        supabase.from('fh_payments').select('id, amount, method, reference, paid_on').eq('contact_id', cid).order('paid_on', { ascending: false })
      ])
      if (!cRes.data) return null
      const c = cRes.data as any
      const payments = ((pRes.data ?? []) as any[]).map((p) => ({ id: p.id, amount: Number(p.amount || 0), method: p.method, reference: p.reference, paidOn: p.paid_on }))
      const amount = Number(c.amount || 0)
      const paid = payments.reduce((s, p) => s + p.amount, 0)
      const balance = Math.max(0, amount - paid)
      const ageDays = c.created_at ? Math.floor((Date.now() - new Date(c.created_at).getTime()) / 86400000) : 0
      return {
        contact: { id: c.id, name: c.name, jobTitle: c.job_title, stage: c.stage, amount, email: c.email, phone: c.phone, createdAt: c.created_at },
        payments, amount, paid, balance,
        pctPaid: amount > 0 ? Math.max(0, Math.min(100, (paid / amount) * 100)) : 0,
        ageDays
      }
    },
    enabled: !!id
  })
}
