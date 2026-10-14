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
// refuses a second call while one is still running or while the thread is
// being read again after it, so a double tap makes one request.
//
// Sends happen now or not at all (Phase 8, Task 11). The mutations run
// with networkMode 'always' and refuse up front when there is no signal,
// so none ever waits offline and goes out later. Nothing under the
// 'inbox' key is saved to the offline cache (lib/queryPersistence.ts), and
// every thread read is scoped to the active company.

import { useCallback, useMemo, useRef, useState } from 'react'
import { onlineManager, useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { supabase } from './supabase.ts'
import { useOrgScope, type OrgScope } from './orgScope.ts'
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

// The keys D26 names for the words of a proposed reply, in the order they
// are read. Nothing else is ever taken for the reply: a proposal with its
// words anywhere else shows no draft, so a reason, a note or a summary
// can never be sent to a customer by mistake.
const BODY_KEYS = ['body', 'text', 'message', 'draft', 'reply'] as const

type JsonObject = Record<string, Json | undefined>

function asObject(value: Json | undefined): JsonObject | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? (value as JsonObject) : null
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * The words of an agent's proposed reply: proposal.body, then text,
 * message, draft or reply, also one level down under those same keys
 * (proposal.message.body). Empty when none of them holds words.
 */
export function draftText(proposal: Json | undefined): string {
  const obj = asObject(proposal)
  if (!obj) return ''
  for (const key of BODY_KEYS) {
    const direct = asText(obj[key])
    if (direct) return direct
    const nested = asObject(obj[key])
    if (nested) {
      for (const inner of BODY_KEYS) {
        const text = asText(nested[inner])
        if (text) return text
      }
    }
  }
  return ''
}

function proposalField(proposal: Json | undefined, key: string): string | null {
  return asText(asObject(proposal)?.[key]) || null
}

/** A channel in the two words a reply can go out by, or null when it is neither. */
export function draftChannel(channel: string | null | undefined): ReplyChannel | null {
  const c = String(channel ?? '').trim().toLowerCase()
  if (c === 'sms' || c === 'text' || c === 'mms') return 'sms'
  if (c === 'email') return 'email'
  return null
}

/** The line on a draft that says how it will go out. */
export function draftSendsLine({ channel, subject, name }: {
  channel: ReplyChannel | null
  subject: string | null | undefined
  name: string
}): string {
  if (channel === 'email') {
    const s = String(subject ?? '').trim()
    return s ? `Sends by email: ${s}` : `Sends by email to ${name}`
  }
  if (channel === 'sms') return `Sends by text to ${name}`
  return `Sends to ${name}`
}

/**
 * The subject an email reply goes out under: the latest subject in the
 * thread with "Re: " in front (once), or null when no message has one.
 */
export function replySubject(messages: Array<Pick<ThreadMessage, 'subject' | 'created_at'>>): string | null {
  let latest: { subject: string; at: number } | null = null
  for (const m of messages) {
    const subject = String(m.subject ?? '').trim()
    if (!subject) continue
    const parsed = Date.parse(m.created_at)
    const at = Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY
    if (!latest || at > latest.at) latest = { subject, at }
  }
  if (!latest) return null
  return /^re:/i.test(latest.subject) ? latest.subject : `Re: ${latest.subject}`
}

// ---------------------------------------------------------------------------
// A thread in time order
// ---------------------------------------------------------------------------

/**
 * How a message stands. Only 'sent' and 'received' may look delivered.
 * 'unsent' reads "Not sent yet": queued, scheduled, or any status this
 * screen does not know.
 */
export type MessageState = 'received' | 'sent' | 'unsent' | 'held' | 'failed'

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
  /** The channel the proposal names, as written (see draftChannel). */
  channel: string | null
  /** The email subject the proposal names, if any. */
  subject: string | null
  /** Written before the customer's newest message, so it may answer the wrong thing. */
  older: boolean
}

export type ThreadItem = ThreadMessageItem | ThreadDraftItem

const SENT = new Set(['sent', 'delivered', 'read'])
const FAILED = new Set(['failed', 'bounced', 'undelivered', 'error', 'rejected', 'canceled', 'cancelled'])

// A reply looks sent only on proof: a sent, delivered or read status, or a
// send time on file. Anything else, including a status this screen has
// never seen, reads "Not sent yet".
function messageState(m: ThreadMessage): MessageState {
  if (m.direction !== 'outbound') return 'received'
  const status = String(m.status ?? '').trim().toLowerCase()
  if (String(m.hold_reason ?? '').trim() || status === 'held') return 'held'
  if (FAILED.has(status)) return 'failed'
  if (SENT.has(status) || String(m.sent_at ?? '').trim()) return 'sent'
  return 'unsent'
}

function time(iso: string | null | undefined): number {
  const t = Date.parse(String(iso ?? ''))
  return Number.isFinite(t) ? t : Number.POSITIVE_INFINITY
}

/**
 * The messages of a conversation and the drafts agents proposed for it,
 * oldest first. A draft that shares a moment with a message comes after
 * it. A held message carries its reason in words in `held`, and a message
 * that is held, not sent yet or failed never has the state 'sent'. Runs
 * that are not waiting for approval, and drafts with no words, are left
 * out. A draft written before the customer's newest message is `older`.
 */
export function threadItems(messages: ThreadMessage[], runs: AgentRunRow[]): ThreadItem[] {
  const items: ThreadItem[] = []
  let newestIn = Number.NEGATIVE_INFINITY
  for (const m of messages) {
    if (m.direction === 'outbound') continue
    const at = Date.parse(m.created_at)
    if (Number.isFinite(at) && at > newestIn) newestIn = at
  }
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
    const at = Date.parse(r.created_at)
    items.push({
      kind: 'draft',
      id: r.id,
      runId: r.id,
      at: r.created_at,
      body,
      channel: proposalField(r.proposal, 'channel'),
      subject: proposalField(r.proposal, 'subject'),
      older: Number.isFinite(at) && at < newestIn
    })
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

export type InboxWrite = 'send' | 'markRead' | 'approve' | 'reject'

// Everything the Inbox reads or writes sits under 'inbox', which the
// offline cache never saves (lib/queryPersistence.ts). The engine switch
// has its own key so it is saved, and an offline cold open still shows
// the Inbox in the dock instead of saying messaging is off. Thread keys
// carry the company, so a company switch never shows another's rows.
export const inboxKeys = {
  all: ['inbox'] as const,
  engine: (orgId: string | null | undefined) => ['inboxEngine', orgId ?? null] as const,
  list: (userId: string | undefined, orgId: string | null | undefined) => ['inbox', 'list', userId ?? null, orgId ?? null] as const,
  listAll: ['inbox', 'list'] as const,
  thread: (orgId: OrgScope, conversationId: string | undefined) =>
    ['inbox', 'thread', orgId ?? null, conversationId ?? null] as const,
  messages: (orgId: OrgScope, conversationId: string | undefined) =>
    ['inbox', 'thread', orgId ?? null, conversationId ?? null, 'messages'] as const,
  runs: (orgId: OrgScope, conversationId: string | undefined) =>
    ['inbox', 'thread', orgId ?? null, conversationId ?? null, 'runs'] as const,
  conversation: (orgId: OrgScope, conversationId: string | undefined) =>
    ['inbox', 'thread', orgId ?? null, conversationId ?? null, 'conversation'] as const,
  write: (name: InboxWrite) => ['inbox', name] as const
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

/**
 * A conversation's messages and the agent drafts waiting for approval, read
 * inside the active company only, plus the conversation's own row.
 *
 * The row is read by its id without the company filter, on purpose: it is
 * how the screen learns that the open conversation belongs to another
 * company (`outside`), and then it shows "Not in this company" with no
 * actions. `runsFresh` is true once the drafts were read from the server
 * after this screen opened; drafts held in memory from an earlier visit
 * show, but cannot be sent until then.
 */
export function useThread(conversationId: string | undefined) {
  const { user } = useAuth()
  const orgId = useOrgScope(user?.id)
  const ready = !!conversationId && typeof orgId === 'string'

  const conversationQuery = useQuery({
    queryKey: inboxKeys.conversation(orgId, conversationId),
    queryFn: async (): Promise<InboxRow | null> => {
      const { data, error } = await supabase
        .from('fh_v_inbox')
        .select(INBOX_COLUMNS)
        .eq('conversation_id', conversationId as string)
        .limit(1)
      if (error) throw error
      return ((data ?? []) as InboxRow[])[0] ?? null
    },
    enabled: ready,
    staleTime: STALE_MS
  })
  const messagesQuery = useQuery({
    queryKey: inboxKeys.messages(orgId, conversationId),
    queryFn: async (): Promise<ThreadMessage[]> => {
      const { data, error } = await supabase
        .from('fh_messages')
        .select(MESSAGE_COLUMNS)
        .eq('org_id', orgId as string)
        .eq('conversation_id', conversationId as string)
        .order('created_at', { ascending: false })
        .limit(200)
      if (error) throw error
      return (data ?? []) as ThreadMessage[]
    },
    enabled: ready,
    staleTime: STALE_MS
  })
  const runsQuery = useQuery({
    queryKey: inboxKeys.runs(orgId, conversationId),
    queryFn: async (): Promise<AgentRunRow[]> => {
      const { data, error } = await supabase
        .from('fh_agent_runs')
        .select('id, conversation_id, status, proposal, created_at')
        .eq('org_id', orgId as string)
        .eq('conversation_id', conversationId as string)
        .eq('status', PROPOSED_STATUS)
        .order('created_at', { ascending: false })
        .limit(20)
      if (error) throw error
      return (data ?? []) as AgentRunRow[]
    },
    enabled: ready,
    staleTime: STALE_MS,
    // Always read the drafts again on opening, even when the copy in
    // memory is new: a draft approved or discarded elsewhere must not be
    // sendable from here.
    refetchOnMount: 'always'
  })
  const refetchMessages = messagesQuery.refetch
  const refetchRuns = runsQuery.refetch
  const refetch = useCallback(() => {
    void refetchMessages()
    void refetchRuns()
  }, [refetchMessages, refetchRuns])

  const conversation = conversationQuery.data ?? null
  const outside = !!conversation?.org_id && typeof orgId === 'string' && conversation.org_id !== orgId
  return {
    orgId,
    /** The conversation's row in fh_v_inbox, whichever company it is in; null when not found or not read yet. */
    conversation,
    /** True when the open conversation belongs to another company. */
    outside,
    messages: messagesQuery.data ?? NO_MESSAGES,
    runs: runsQuery.data ?? NO_RUNS,
    runsFresh: runsQuery.isFetchedAfterMount && !runsQuery.isError,
    // Drafts are an extra: a failed drafts read leaves the messages usable.
    isLoading: orgId === undefined || messagesQuery.isLoading,
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
  /** Another call is still running, or the thread is still being read after one. */
  | { ok: false; reason: 'busy' }
  /** No signal: nothing was sent, and nothing will be sent later. */
  | { ok: false; reason: 'offline' }
  /** The request failed or never answered, so it may or may not have gone out. */
  | { ok: false; reason: 'failed'; error: unknown }

/**
 * A mutation that runs now or not at all, and once at a time.
 *
 *   * networkMode 'always': TanStack never parks it to run when the signal
 *     comes back. With no signal, `run` refuses before calling anything.
 *   * After every attempt, failed or not, `settle` reads the thread again
 *     (onSettled), and the next call waits until that read lands, so a
 *     second Send happens only once the person can see what went out.
 *   * The mutation key is under 'inbox', which the offline cache never
 *     saves, so it is never persisted or resumed.
 *
 * `run` never throws. The caller hears the outcome as soon as the request
 * settles; `pending` stays true until the read after it lands.
 */
function useGuardedMutation<V, D>(options: {
  name: InboxWrite
  mutationFn: (vars: V) => Promise<D>
  onSuccess?: (data: D, vars: V) => void
  settle: () => Promise<unknown>
}) {
  const { name, mutationFn, onSuccess, settle } = options
  const settling = useRef<Promise<unknown>>(Promise.resolve())
  const mutation = useMutation<D, unknown, V>({
    mutationKey: inboxKeys.write(name),
    mutationFn,
    networkMode: 'always',
    retry: 0,
    onSuccess,
    // Not returned, so the outcome is not held back by the read.
    onSettled: () => {
      settling.current = settle()
    }
  })
  const { mutateAsync } = mutation
  const [busy, setBusy] = useState(false)

  const guarded = useMemo(
    () =>
      onceAtATime(async (vars: V, report: (result: ActionResult<D>) => void) => {
        setBusy(true)
        try {
          try {
            report({ ok: true, data: await mutateAsync(vars) })
          } catch (error) {
            report({ ok: false, reason: 'failed', error })
          }
          await settling.current.catch(() => undefined)
        } finally {
          setBusy(false)
        }
      }),
    [mutateAsync]
  )

  const run = useCallback(
    (vars: V) =>
      new Promise<ActionResult<D>>((resolve) => {
        if (!onlineManager.isOnline()) {
          resolve({ ok: false, reason: 'offline' })
          return
        }
        void guarded(vars, resolve).then((outcome) => {
          if (!outcome.ran) resolve({ ok: false, reason: 'busy' })
        })
      }),
    [guarded]
  )
  return { run, pending: busy || mutation.isPending }
}

/**
 * The four writes for one conversation in the active company, as guarded
 * TanStack mutations. After each, the list and the thread are read again,
 * and an approved or discarded draft leaves the cache at once so it cannot
 * be tapped twice.
 */
export function useInboxActions(conversationId: string | undefined, orgId: OrgScope) {
  const queryClient = useQueryClient()

  const settle = useCallback(() => {
    void queryClient.invalidateQueries({ queryKey: inboxKeys.listAll })
    return queryClient.invalidateQueries({ queryKey: inboxKeys.thread(orgId, conversationId) })
  }, [queryClient, orgId, conversationId])

  const dropRun = useCallback((runId: string) => {
    queryClient.setQueryData<AgentRunRow[]>(inboxKeys.runs(orgId, conversationId), (old) => old?.filter((r) => r.id !== runId))
  }, [queryClient, orgId, conversationId])

  const send = useGuardedMutation({ name: 'send', mutationFn: rpcSendMessage, settle })
  const mark = useGuardedMutation({ name: 'markRead', mutationFn: rpcMarkRead, settle })
  const approve = useGuardedMutation({
    name: 'approve',
    mutationFn: (vars: { runId: string; body: string }) => rpcApproveDraft(vars.runId, vars.body),
    onSuccess: (_id, vars) => dropRun(vars.runId),
    settle
  })
  const reject = useGuardedMutation({
    name: 'reject',
    mutationFn: (vars: { runId: string; reason?: string }) => rpcRejectDraft(vars.runId, vars.reason),
    onSuccess: (_void, vars) => dropRun(vars.runId),
    settle
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
