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
