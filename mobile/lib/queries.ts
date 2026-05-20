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

async function fetchUpcoming(userId: string): Promise<ScheduleEvent[]> {
  const now = new Date()
  const in7 = new Date(now)
  in7.setDate(in7.getDate() + 7)
  in7.setHours(23, 59, 59, 999)
  const { data, error } = await supabase
    .from('fh_schedule')
    .select('*, fh_contacts(name, stage)')
    .eq('user_id', userId)
    .gte('start_at', now.toISOString())
    .lt('start_at', in7.toISOString())
    .order('start_at', { ascending: true })
    .limit(50)
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

// ---- Job detail ----
// One job's worth of data for the detail screen: the contact row plus
// its payments, schedule, subs, and expenses. Mirrors the web
// useJobData fetch (lighter — no client lookup / change orders yet).
export type JobDetail = {
  contact: Contact | null
  payments: Payment[]
  schedule: Database['public']['Tables']['fh_schedule']['Row'][]
  subs: Database['public']['Tables']['fh_subs']['Row'][]
  expenses: Database['public']['Tables']['fh_expenses']['Row'][]
}

async function fetchJobDetail(id: string): Promise<JobDetail> {
  const [c, p, sch, s, e] = await Promise.all([
    supabase.from('fh_contacts').select('*').eq('id', id).maybeSingle(),
    supabase.from('fh_payments').select('*').eq('contact_id', id).order('paid_on', { ascending: false }),
    supabase.from('fh_schedule').select('*').eq('contact_id', id).order('start_at', { ascending: true }),
    supabase.from('fh_subs').select('*').eq('contact_id', id).order('created_at', { ascending: false }),
    supabase.from('fh_expenses').select('*').eq('contact_id', id).order('expense_date', { ascending: false })
  ])
  return {
    contact: (c.data ?? null) as Contact | null,
    payments: (p.data ?? []) as Payment[],
    schedule: (sch.data ?? []) as JobDetail['schedule'],
    subs: (s.data ?? []) as JobDetail['subs'],
    expenses: (e.data ?? []) as JobDetail['expenses']
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
