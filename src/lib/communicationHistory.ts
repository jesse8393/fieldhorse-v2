import { useInfiniteQuery } from '@tanstack/react-query'
import { useAuth } from '../contexts/AuthContext.tsx'
import { useOrgScope } from './orgScope.ts'
import { supabase } from './supabase.ts'

export type CommunicationEntry = {
  id: string
  at: string
  channel: string
  status: string
  title: string
  body: string
  recipient: string
  contactId: string | null
  conversationId: string | null
  source: 'message' | 'log'
}

type Row = Record<string, any>
const words = (value: unknown) => typeof value === 'string' ? value.trim() : ''

/** A recorded handoff is never proof of delivery. Preserve that distinction. */
export function communicationStatus(status: unknown, source: 'message' | 'log'): string {
  const key = words(status).toLowerCase()
  if (key === 'reported_sent') return 'Reported sent'
  if (key === 'delivered') return 'Delivered'
  if (key === 'sent') return 'Sent'
  if (key === 'received') return 'Received'
  if (['failed', 'undelivered', 'bounced'].includes(key)) return 'Not delivered'
  if (key === 'held') return 'Held for review'
  return source === 'message' ? 'Not sent yet' : 'Logged activity'
}

export function normalizeCommunicationNotes(rows: Row[]): CommunicationEntry[] {
  return rows.flatMap((row) => {
    const saved = row.parsed?.communication
    const structured = saved && typeof saved === 'object' && saved.version === 1
    const legacySent = row.category === 'activity' && /^Message sent to /i.test(words(row.text))
    if (!structured && !legacySent && !['email', 'text', 'call', 'communication'].includes(row.category)) return []
    return [{
      id: `note:${row.id}`, at: words(row.created_at),
      channel: structured ? words(saved.channel) : row.category === 'text' ? 'sms' : legacySent ? 'email' : words(row.category),
      status: structured ? communicationStatus(saved.status, 'log') : 'Logged activity',
      title: structured ? words(saved.subject) || 'Message' : legacySent ? 'Email activity' : 'Communication note',
      body: structured ? words(saved.body) : words(row.text),
      recipient: structured ? words(saved.to) : words(row.fh_contacts?.name),
      contactId: row.contact_id || null, conversationId: null, source: 'log' as const,
    }]
  })
}

export function normalizeCommunicationMessages(rows: Row[]): CommunicationEntry[] {
  return rows.map((row) => ({
    id: `message:${row.id}`, at: words(row.sent_at) || words(row.created_at),
    channel: words(row.channel),
    status: row.direction === 'inbound' ? 'Received' : communicationStatus(row.status, 'message'),
    title: words(row.subject) || (row.direction === 'inbound' ? 'Customer message' : 'Message'),
    body: words(row.body), recipient: words(row.to_address) || words(row.from_address),
    contactId: row.contact_id || null, conversationId: row.conversation_id || null, source: 'message' as const,
  }))
}

export function mergeCommunicationHistory(notes: CommunicationEntry[], messages: CommunicationEntry[]): CommunicationEntry[] {
  const unique = new Map([...notes, ...messages].map((entry) => [entry.id, entry]))
  return [...unique.values()].sort((a, b) => {
    const aTime = Date.parse(a.at) || 0
    const bTime = Date.parse(b.at) || 0
    return bTime - aTime || a.id.localeCompare(b.id)
  })
}

const PAGE_SIZE = 50
const NOTE_FILTER = 'category.in.(email,text,call,communication),and(category.eq.activity,text.ilike.Message sent to *)'

/** Both sources remain scoped to the current company. Each paginates independently. */
export function useCommunicationHistory(contactId?: string, clientId?: string | null) {
  const { user } = useAuth()
  const orgId = useOrgScope(user?.id)
  const notes = useInfiniteQuery({
    queryKey: ['inbox', 'communicationNotes', user?.id, orgId, contactId || null],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let query = supabase.from('fh_notes').select('id,created_at,category,text,parsed,contact_id,fh_contacts(name)')
      query = orgId ? query.eq('org_id', orgId) : query.eq('user_id', user!.id)
      if (contactId) query = query.eq('contact_id', contactId)
      const { data, error } = await query.or(NOTE_FILTER).order('created_at', { ascending: false }).order('id').range(pageParam, pageParam + PAGE_SIZE - 1)
      if (error) throw error
      return data || []
    },
    getNextPageParam: (last, pages) => last.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
    enabled: !!user && orgId !== undefined,
    staleTime: 10_000,
  })
  const messages = useInfiniteQuery({
    queryKey: ['inbox', 'communicationMessages', user?.id, orgId, contactId || null, clientId || null],
    initialPageParam: 0,
    queryFn: async ({ pageParam }) => {
      let query = supabase.from('fh_messages').select('id,created_at,sent_at,channel,direction,status,subject,body,contact_id,conversation_id,to_address,from_address').eq('org_id', orgId as string)
      // Client threads may not carry a job id. Reading by the selected job's
      // client includes those replies without showing another customer's thread.
      if (contactId) query = clientId ? query.eq('client_id', clientId) : query.eq('contact_id', contactId)
      const { data, error } = await query.order('created_at', { ascending: false }).order('id').range(pageParam, pageParam + PAGE_SIZE - 1)
      if (error) throw error
      return data || []
    },
    getNextPageParam: (last, pages) => last.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
    enabled: !!user && typeof orgId === 'string',
    staleTime: 10_000,
  })
  return {
    entries: mergeCommunicationHistory(normalizeCommunicationNotes(notes.data?.pages.flat() || []), normalizeCommunicationMessages(messages.data?.pages.flat() || [])),
    loading: orgId === undefined || notes.isLoading || messages.isLoading,
    failedSources: [notes.isError && 'Communication log', messages.isError && 'Connected messages'].filter(Boolean) as string[],
    hasMore: notes.hasNextPage || messages.hasNextPage,
    loadingMore: notes.isFetchingNextPage || messages.isFetchingNextPage,
    loadMore: () => { if (notes.hasNextPage) void notes.fetchNextPage(); if (messages.hasNextPage) void messages.fetchNextPage() },
    refresh: () => { void notes.refetch(); if (typeof orgId === 'string') void messages.refetch() },
  }
}
