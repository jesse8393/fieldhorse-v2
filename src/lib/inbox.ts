// src/lib/inbox.ts
//
// Everything the Inbox (spec 9.8, decision D9) reads and writes, on the
// Growth Engine contracts in database.types.ts: the fh_v_inbox view, the
// fh_messages and fh_agent_runs tables, fh_org_settings.engine_enabled,
// and the four functions fh_send_message, fh_conversation_mark_read,
// fh_agent_run_approve and fh_agent_run_reject.
//
// The first half is pure (thread order, hold reasons in words, day and
// time labels, which channel a reply goes out on) and unit tested. The
// second half is the data: hooks for the engine switch, the list and a
// thread, and mutations for the four functions. Nothing here sends on its
// own. Every send is a function the person's tap calls, and each mutation
// refuses a second call while one is still running, so a double tap makes
// one request.

import { useCallback, useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase.ts'
import { useOrgScope } from './orgScope.ts'
import { useAuth } from '../contexts/AuthContext.tsx'
import type { Database, Json } from './database.types.ts'
import type { ChipTone } from '../components/fh/Chip.tsx'

type Tables = Database['public']['Tables']

export type InboxRow = Database['public']['Views']['fh_v_inbox']['Row']

export type ThreadMessage = Pick<
  Tables['fh_messages']['Row'],
  | 'id' | 'conversation_id' | 'client_id' | 'direction' | 'channel' | 'subject' | 'body'
  | 'status' | 'read_at' | 'hold_reason' | 'sent_by_kind' | 'agent_run_id'
  | 'created_at' | 'sent_at' | 'call_status'
>

export type AgentRunRow = Pick<
  Tables['fh_agent_runs']['Row'],
  'id' | 'conversation_id' | 'status' | 'proposal' | 'created_at'
>

/** The status of an agent run that is waiting for a person to approve it. */
export const PROPOSED_STATUS = 'proposed'

// ---------------------------------------------------------------------------
// Hold reasons in words
// ---------------------------------------------------------------------------

const HELD_FALLBACK = 'Held for review'

// The reasons the engine is known to hold a message for, matched on the
// reason with case, spaces and punctuation ignored. Anything not listed
// reads "Held for review" rather than a guess.
const HOLD_WORDS: Array<[RegExp, string]> = [
  [/^(outside_?(the_?)?(send_?)?(window|hours|business_?hours)|(send|sending)_?window|quiet_?hours|after_?hours|out_?of_?hours)$/, 'outside sending hours'],
  [/^(opted_?out|opt_?out|unsubscribed|stopped|do_?not_?(contact|text|email)|dnc)$/, 'this customer opted out'],
  [/^(no_?(sms_?|email_?)?consent|consent(_?missing|_?required)?|not_?opted_?in|missing_?consent)$/, 'no consent on file'],
  [/^(needs?_?(owner_?)?(approval|review)|approval_?required|manual_?review|review_?required|awaiting_?approval)$/, 'waiting for your approval'],
  [/^(rate_?limit(ed)?|daily_?limit|frequency_?cap|too_?many(_?messages)?)$/, 'sending limit reached'],
  [/^(no_?(phone|mobile)(_?number)?|missing_?phone)$/, 'no phone number on file'],
  [/^(no_?email(_?address)?|missing_?email)$/, 'no email address on file'],
  [/^(no_?(recipient|contact)|missing_?(recipient|contact|address))$/, 'no way to reach this customer'],
  [/^(sms_?policy|policy|messaging_?policy)$/, 'company messaging policy'],
  [/^(engine_?(off|disabled)|messaging_?(off|disabled))$/, 'messaging is off'],
  [/^(duplicate|possible_?duplicate)$/, 'it looks like a duplicate']
]

/** "Held: outside sending hours". Unknown or missing reasons read "Held for review". */
export function holdReasonWords(reason: string | null | undefined): string {
  const key = String(reason ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '')
  if (!key) return HELD_FALLBACK
  for (const [pattern, words] of HOLD_WORDS) {
    if (pattern.test(key)) return `Held: ${words}`
  }
  return HELD_FALLBACK
}

// ---------------------------------------------------------------------------
// The draft an agent proposed
// ---------------------------------------------------------------------------

const BODY_KEYS = ['body', 'text', 'message', 'draft', 'reply', 'content', 'proposed_body']
// Keys that hold something other than the words of the reply, so the
// longest string fallback never picks them.
const NOT_BODY_KEYS = new Set([
  'channel', 'subject', 'to', 'from', 'kind', 'type', 'action', 'reason', 'rationale', 'reasoning',
  'confidence', 'status', 'model', 'agent', 'agent_key', 'purpose', 'summary', 'note', 'notes'
])

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The words of an agent's proposed reply. Reads the usual keys first
 * (body, text, message, draft, reply, content), one level of nesting, and
 * otherwise the longest sentence in the proposal. Empty when there is none.
 */
export function draftText(proposal: Json | undefined): string {
  if (typeof proposal === 'string') return proposal.trim()
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return ''
  const obj = proposal as Record<string, Json | undefined>

  for (const key of BODY_KEYS) {
    const direct = asText(obj[key])
    if (direct) return direct
    const nested = obj[key]
    if (nested && typeof nested === 'object' && !Array.isArray(nested)) {
      for (const inner of BODY_KEYS) {
        const text = asText((nested as Record<string, Json | undefined>)[inner])
        if (text) return text
      }
    }
  }

  let best = ''
  for (const [key, value] of Object.entries(obj)) {
    if (NOT_BODY_KEYS.has(key)) continue
    const text = asText(value)
    if (text.length > best.length) best = text
  }
  return best
}

function draftChannel(proposal: Json | undefined): string | null {
  if (!proposal || typeof proposal !== 'object' || Array.isArray(proposal)) return null
  return asText((proposal as Record<string, Json | undefined>).channel) || null
}

// ---------------------------------------------------------------------------
// A thread in time order
// ---------------------------------------------------------------------------

/** How a message stands. Only 'sent' and 'received' may look delivered. */
export type MessageState = 'received' | 'sent' | 'sending' | 'held' | 'failed'

export type ThreadMessageItem = {
  kind: 'message'
  id: string
  /** ISO time the message was created. */
  at: string
  outgoing: boolean
  channel: string
  subject: string | null
  body: string
  state: MessageState
  /** "Held: outside sending hours" when the message is held, else null. */
  held: string | null
}

export type ThreadDraftItem = {
  kind: 'draft'
  /** The agent run's id. */
  id: string
  runId: string
  at: string
  body: string
  channel: string | null
}

export type ThreadItem = ThreadMessageItem | ThreadDraftItem

const SENDING = new Set(['queued', 'pending', 'sending', 'scheduled', 'draft'])
const FAILED = new Set(['failed', 'bounced', 'undelivered', 'error', 'rejected', 'canceled', 'cancelled'])

function messageState(m: ThreadMessage): MessageState {
  if (m.direction !== 'outbound') return 'received'
  const status = String(m.status ?? '').toLowerCase()
  if (String(m.hold_reason ?? '').trim() || status === 'held') return 'held'
  if (FAILED.has(status)) return 'failed'
  if (SENDING.has(status)) return 'sending'
  return 'sent'
}

function time(iso: string | null | undefined): number {
  const t = Date.parse(String(iso ?? ''))
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
}

/**
 * The messages of a conversation and the drafts agents proposed for it,
 * oldest first. A draft that shares a moment with a message comes after
 * it. A held message carries its reason in words in `held`, and a message
 * that is held, still sending or failed never has the state 'sent'. Runs
 * that are not waiting for approval, and drafts with no words, are left out.
 */
export function threadItems(messages: ThreadMessage[], runs: AgentRunRow[]): ThreadItem[] {
  const items: ThreadItem[] = []
  for (const m of messages) {
    const state = messageState(m)
    items.push({
      kind: 'message',
      id: m.id,
      at: m.created_at,
      outgoing: m.direction === 'outbound',
      channel: m.channel,
      subject: m.subject ?? null,
      body: m.body ?? '',
      state,
      held: state === 'held' ? holdReasonWords(m.hold_reason) : null
    })
  }
  for (const r of runs) {
    if (r.status !== PROPOSED_STATUS) continue
    const body = draftText(r.proposal)
    if (!body) continue
    items.push({ kind: 'draft', id: r.id, runId: r.id, at: r.created_at, body, channel: draftChannel(r.proposal) })
  }
  return items
    .map((item, index) => ({ item, index }))
    .sort((a, b) => {
      const dt = time(a.item.at) - time(b.item.at)
      if (dt !== 0 && !Number.isNaN(dt)) return dt
      if (a.item.kind !== b.item.kind) return a.item.kind === 'message' ? -1 : 1
      return a.index - b.index
    })
    .map(({ item }) => item)
}

// ---------------------------------------------------------------------------
// Day and time labels. All of these read the local clock.
// ---------------------------------------------------------------------------

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function startOfDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()
}

/** Whole local days from `a` to `b` (positive when `a` is earlier). */
function daysBetween(a: Date, b: Date): number {
  return Math.round((startOfDay(b) - startOfDay(a)) / 86_400_000)
}

function parse(iso: string | null | undefined): Date | null {
  if (!iso) return null
  const d = new Date(iso)
  return Number.isNaN(d.getTime()) ? null : d
}

/** "4:48 pm": lower case, one plain space, no leading zero on the hour. */
export function timeLabel(iso: string | null | undefined): string {
  const d = parse(iso)
  if (!d) return ''
  const hours = d.getHours()
  const minutes = String(d.getMinutes()).padStart(2, '0')
  return `${hours % 12 || 12}:${minutes} ${hours < 12 ? 'am' : 'pm'}`
}

/** The label over a day of messages: Today, Yesterday, "Tue, Oct 6", "Dec 24, 2025". */
export function dayLabel(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parse(iso)
  if (!d) return ''
  const ago = daysBetween(d, now)
  if (ago === 0) return 'Today'
  if (ago === 1) return 'Yesterday'
  const date = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  if (d.getFullYear() !== now.getFullYear()) return `${date}, ${d.getFullYear()}`
  return `${WEEKDAYS[d.getDay()]}, ${date}`
}

/** The short time in a list row: 8:14 am today, Yesterday, Wed, Sep 20. */
export function listTimeLabel(iso: string | null | undefined, now: Date = new Date()): string {
  const d = parse(iso)
  if (!d) return ''
  const ago = daysBetween(d, now)
  if (ago <= 0) return timeLabel(iso)
  if (ago === 1) return 'Yesterday'
  if (ago < 7) return WEEKDAYS[d.getDay()]
  const date = `${MONTHS[d.getMonth()]} ${d.getDate()}`
  return d.getFullYear() === now.getFullYear() ? date : `${date}, ${d.getFullYear()}`
}

export type ThreadDay = { key: string; label: string; items: ThreadItem[] }

/** Items under one label per local day, in the order they arrive. */
export function groupByDay(items: ThreadItem[], now: Date = new Date()): ThreadDay[] {
  const days: ThreadDay[] = []
  for (const item of items) {
    const d = parse(item.at)
    const key = d ? `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}` : 'unknown'
    const last = days[days.length - 1]
    if (last && last.key === key) last.items.push(item)
    else days.push({ key, label: dayLabel(item.at, now), items: [item] })
  }
  return days
}

// ---------------------------------------------------------------------------
// Small pure helpers for the list and the composer
// ---------------------------------------------------------------------------

/** The job chip in a list row and a thread header: the stage in a word. */
export function stageChip(stage: string | null | undefined): { label: string; tone: ChipTone } | null {
  switch (String(stage ?? '').toLowerCase()) {
    case 'lead': return { label: 'Lead', tone: 'neutral' }
    case 'quote': return { label: 'Quote', tone: 'info' }
    case 'job':
    case 'invoice': return { label: 'Job', tone: 'success' }
    case 'closed': return { label: 'Closed', tone: 'neutral' }
    case 'lost': return { label: 'Lost', tone: 'neutral' }
    default: return null
  }
}

export type ReplyChannel = 'sms' | 'email'

/**
 * Which channel a typed reply goes out on, and which the customer can be
 * reached on. It follows the last channel they used when that still works,
 * otherwise the first one on file (text before email), otherwise none.
 */
export function replyChannel(row: {
  last_channel?: string | null
  phone?: string | null
  email?: string | null
}): { channel: ReplyChannel | null; options: ReplyChannel[] } {
  const options: ReplyChannel[] = []
  if (String(row.phone ?? '').trim()) options.push('sms')
  if (String(row.email ?? '').trim()) options.push('email')
  const last = String(row.last_channel ?? '').toLowerCase()
  const preferred: ReplyChannel | null = last === 'sms' || last === 'mms' ? 'sms' : last === 'email' ? 'email' : null
  const channel = preferred && options.includes(preferred) ? preferred : options[0] ?? null
  return { channel, options }
}

/** Newest conversation first; rows with no message time go last. */
export function sortInbox(rows: InboxRow[]): InboxRow[] {
  return [...rows].sort((a, b) => {
    const ta = Date.parse(a.last_message_at ?? '')
    const tb = Date.parse(b.last_message_at ?? '')
    return (Number.isFinite(tb) ? tb : -Infinity) - (Number.isFinite(ta) ? ta : -Infinity) || 0
  })
}

// ---------------------------------------------------------------------------
// Guard: one call at a time
// ---------------------------------------------------------------------------

export type Once<T> = { ran: true; value: T } | { ran: false }

/**
 * Wraps an async function so a second call made while the first is still
 * running does nothing (it resolves `{ ran: false }`). The first call runs
 * right away, so two taps in the same moment make one request. A failure
 * rethrows and frees the next call.
 */
export function onceAtATime<A extends unknown[], T>(fn: (...args: A) => Promise<T>) {
  let busy = false
  return async (...args: A): Promise<Once<T>> => {
    if (busy) return { ran: false }
    busy = true
    try {
      return { ran: true, value: await fn(...args) }
    } finally {
      busy = false
    }
  }
}

// ---------------------------------------------------------------------------
// Query keys
// ---------------------------------------------------------------------------

export const inboxKeys = {
  all: ['inbox'] as const,
  engine: (orgId: string | null | undefined) => ['inbox', 'engine', orgId ?? null] as const,
  list: (userId: string | undefined, orgId: string | null | undefined) => ['inbox', 'list', userId ?? null, orgId ?? null] as const,
  listAll: ['inbox', 'list'] as const,
  thread: (conversationId: string | undefined) => ['inbox', 'thread', conversationId ?? null] as const,
  messages: (conversationId: string | undefined) => ['inbox', 'thread', conversationId ?? null, 'messages'] as const,
  runs: (conversationId: string | undefined) => ['inbox', 'thread', conversationId ?? null, 'runs'] as const
}

// A short stale time so coming back to the app, or to the tab, refetches
// (the query client refetches on window focus). There is no realtime here.
const STALE_MS = 10_000

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * Whether the company has turned the messaging engine on
 * (fh_org_settings.engine_enabled). undefined while it is still loading.
 * A missing settings row, no company, or a failed read all mean off, so
 * the Inbox never shows up by accident.
 */
export function useEngineEnabled(): boolean | undefined {
  const { user } = useAuth()
  const orgId = useOrgScope(user?.id)
  const query = useQuery({
    queryKey: inboxKeys.engine(orgId),
    queryFn: async (): Promise<boolean> => {
      const { data, error } = await supabase
        .from('fh_org_settings')
        .select('engine_enabled')
        .eq('org_id', orgId as string)
        .maybeSingle()
      if (error) throw error
      return data?.engine_enabled === true
    },
    enabled: typeof orgId === 'string',
    staleTime: 5 * 60_000
  })
  if (orgId === undefined) return undefined
  if (orgId === null) return false
  if (query.data !== undefined) return query.data
  return query.isError ? false : undefined
}

const INBOX_COLUMNS =
  'conversation_id, client_id, client_name, company_name, last_preview, last_message_at, last_channel, unread_count, pending_drafts, held_messages, latest_stage, starred, status, snoozed_until, email, phone, org_id'

/** The conversations, newest first. Pass `enabled: false` while the engine is off. */
export function useInbox({ enabled = true }: { enabled?: boolean } = {}) {
  const { user } = useAuth()
  const orgId = useOrgScope(user?.id)
  return useQuery({
    queryKey: inboxKeys.list(user?.id, orgId),
    queryFn: async (): Promise<InboxRow[]> => {
      const { data, error } = await supabase
        .from('fh_v_inbox')
        .select(INBOX_COLUMNS)
        .eq('org_id', orgId as string)
        .order('last_message_at', { ascending: false, nullsFirst: false })
        .limit(300)
      if (error) throw error
      return sortInbox((data ?? []) as InboxRow[])
    },
    enabled: enabled && !!user?.id && typeof orgId === 'string',
    staleTime: STALE_MS
  })
}

const MESSAGE_COLUMNS =
  'id, conversation_id, client_id, direction, channel, subject, body, status, read_at, hold_reason, sent_by_kind, agent_run_id, created_at, sent_at, call_status'

const NO_MESSAGES: ThreadMessage[] = []
const NO_RUNS: AgentRunRow[] = []

/** A conversation's messages, plus the agent drafts waiting for approval. */
export function useThread(conversationId: string | undefined) {
  const messagesQuery = useQuery({
    queryKey: inboxKeys.messages(conversationId),
    queryFn: async (): Promise<ThreadMessage[]> => {
      const { data, error } = await supabase
        .from('fh_messages')
        .select(MESSAGE_COLUMNS)
        .eq('conversation_id', conversationId as string)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as ThreadMessage[]
    },
    enabled: !!conversationId,
    staleTime: STALE_MS
  })
  const runsQuery = useQuery({
    queryKey: inboxKeys.runs(conversationId),
    queryFn: async (): Promise<AgentRunRow[]> => {
      const { data, error } = await supabase
        .from('fh_agent_runs')
        .select('id, conversation_id, status, proposal, created_at')
        .eq('conversation_id', conversationId as string)
        .eq('status', PROPOSED_STATUS)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data ?? []) as AgentRunRow[]
    },
    enabled: !!conversationId,
    staleTime: STALE_MS
  })
  const refetchMessages = messagesQuery.refetch
  const refetchRuns = runsQuery.refetch
  const refetch = useCallback(() => {
    void refetchMessages()
    void refetchRuns()
  }, [refetchMessages, refetchRuns])
  return {
    messages: messagesQuery.data ?? NO_MESSAGES,
    runs: runsQuery.data ?? NO_RUNS,
    // Drafts are an extra: a failed drafts read leaves the messages usable.
    isLoading: messagesQuery.isLoading,
    isError: messagesQuery.isError,
    refetch
  }
}

// ---------------------------------------------------------------------------
// Writes: the four functions
// ---------------------------------------------------------------------------

export type SendMessageArgs = {
  body: string
  channel: ReplyChannel
  clientId: string
  contactId?: string
  subject?: string
}

async function rpcSendMessage(args: SendMessageArgs): Promise<string> {
  const { data, error } = await supabase.rpc('fh_send_message', {
    p_body: args.body,
    p_channel: args.channel,
    p_client_id: args.clientId,
    ...(args.contactId ? { p_contact_id: args.contactId } : {}),
    ...(args.subject ? { p_subject: args.subject } : {})
  })
  if (error) throw error
  return data as string
}

async function rpcMarkRead(conversationId: string): Promise<void> {
  const { error } = await supabase.rpc('fh_conversation_mark_read', { p_conversation_id: conversationId })
  if (error) throw error
}

async function rpcApproveDraft(runId: string, body: string): Promise<string> {
  const { data, error } = await supabase.rpc('fh_agent_run_approve', { p_agent_run_id: runId, p_body: body })
  if (error) throw error
  return data as string
}

async function rpcRejectDraft(runId: string, reason?: string): Promise<void> {
  const { error } = await supabase.rpc('fh_agent_run_reject', {
    p_agent_run_id: runId,
    ...(reason ? { p_reason: reason } : {})
  })
  if (error) throw error
}

export type ActionResult<T = void> =
  | { ok: true; data: T }
  | { ok: false; skipped: true }
  | { ok: false; skipped?: false; error: unknown }

/**
 * A mutation that refuses a second call while one is running. `run` never
 * throws: it resolves { ok: true, data }, { ok: false, skipped: true } for
 * a call made mid flight, or { ok: false, error }.
 */
function useGuardedMutation<V, D>(options: {
  mutationFn: (vars: V) => Promise<D>
  onSuccess?: (data: D, vars: V) => void
}) {
  const mutation = useMutation<D, unknown, V>({ mutationFn: options.mutationFn, onSuccess: options.onSuccess })
  const { mutateAsync } = mutation
  const guarded = useMemo(() => onceAtATime((vars: V) => mutateAsync(vars)), [mutateAsync])
  const run = useCallback(async (vars: V): Promise<ActionResult<D>> => {
    try {
      const result = await guarded(vars)
      return result.ran ? { ok: true, data: result.value } : { ok: false, skipped: true }
    } catch (error) {
      return { ok: false, error }
    }
  }, [guarded])
  return { run, pending: mutation.isPending }
}

/**
 * The four writes for one conversation, as guarded TanStack mutations.
 * After each, the list and the thread are fetched again, and an approved
 * or discarded draft leaves the cache at once so it cannot be tapped twice.
 */
export function useInboxActions(conversationId: string | undefined) {
  const queryClient = useQueryClient()

  const refresh = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: inboxKeys.listAll })
    void queryClient.invalidateQueries({ queryKey: inboxKeys.thread(conversationId) })
  }, [queryClient, conversationId])

  const dropRun = useCallback((runId: string) => {
    queryClient.setQueryData<AgentRunRow[]>(inboxKeys.runs(conversationId), (old) => old?.filter((r) => r.id !== runId))
  }, [queryClient, conversationId])

  const send = useGuardedMutation({ mutationFn: rpcSendMessage, onSuccess: refresh })
  const mark = useGuardedMutation({ mutationFn: rpcMarkRead, onSuccess: refresh })
  const approve = useGuardedMutation({
    mutationFn: (vars: { runId: string; body: string }) => rpcApproveDraft(vars.runId, vars.body),
    onSuccess: (_id, vars) => { dropRun(vars.runId); refresh() }
  })
  const reject = useGuardedMutation({
    mutationFn: (vars: { runId: string; reason?: string }) => rpcRejectDraft(vars.runId, vars.reason),
    onSuccess: (_void, vars) => { dropRun(vars.runId); refresh() }
  })

  return {
    sendMessage: send.run,
    sending: send.pending,
    markRead: mark.run,
    approveDraft: (runId: string, body: string) => approve.run({ runId, body }),
    approving: approve.pending,
    rejectDraft: (runId: string, reason?: string) => reject.run({ runId, reason }),
    rejecting: reject.pending
  }
}
