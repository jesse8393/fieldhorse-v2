import { describe, expect, it, vi, beforeAll, afterAll } from 'vitest'

// The day labels and times read the local clock. Pin Central time, where
// Jesse works, so they match on every machine and in CI (UTC). Set it as
// the file loads too, because the fixtures build local dates right away.
const originalTz = process.env.TZ
process.env.TZ = 'America/Chicago'
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

// inbox.ts builds the Supabase client on import; these checks only use
// its pure helpers, so a stub client is enough.
vi.mock('./supabase.ts', () => ({ supabase: {} }))

import {
  dayLabel,
  draftText,
  groupByDay,
  holdReasonWords,
  listTimeLabel,
  onceAtATime,
  replyChannel,
  stageChip,
  threadItems,
  timeLabel,
  type AgentRunRow,
  type ThreadMessage
} from './inbox.ts'
import { INBOX, SCHEDULE, dockFifthItem, dockRight, sidebarPrimary } from './navItems.ts'

function msg(partial: Partial<ThreadMessage> & { id: string; created_at: string }): ThreadMessage {
  return {
    conversation_id: 'conv-1',
    client_id: 'cl-1',
    direction: 'inbound',
    channel: 'sms',
    subject: null,
    body: 'Hello',
    status: 'received',
    read_at: null,
    hold_reason: null,
    sent_by_kind: 'contact',
    agent_run_id: null,
    sent_at: null,
    call_status: null,
    ...partial
  }
}

function run(partial: Partial<AgentRunRow> & { id: string; created_at: string }): AgentRunRow {
  return {
    conversation_id: 'conv-1',
    status: 'proposed',
    proposal: { body: 'Of course, 11:30 works.', channel: 'sms' },
    ...partial
  }
}

describe('threadItems', () => {
  it('puts messages and drafts in time order, whatever order they arrive in', () => {
    const items = threadItems(
      [
        msg({ id: 'm3', created_at: '2026-10-10T13:14:00Z' }),
        msg({ id: 'm1', created_at: '2026-10-09T21:48:00Z', direction: 'outbound', sent_by_kind: 'user', status: 'sent' }),
        msg({ id: 'm2', created_at: '2026-10-09T22:02:00Z' })
      ],
      [run({ id: 'r1', created_at: '2026-10-10T13:20:00Z' })]
    )
    expect(items.map((i) => `${i.kind}:${i.id}`)).toEqual(['message:m1', 'message:m2', 'message:m3', 'draft:r1'])
  })

  it('keeps a draft after the message it answers when both share a moment', () => {
    const items = threadItems(
      [msg({ id: 'm1', created_at: '2026-10-10T13:14:00Z' })],
      [run({ id: 'r1', created_at: '2026-10-10T13:14:00Z' })]
    )
    expect(items.map((i) => i.kind)).toEqual(['message', 'draft'])
  })

  it('marks which side each message is on', () => {
    const items = threadItems(
      [
        msg({ id: 'in', created_at: '2026-10-10T13:00:00Z' }),
        msg({ id: 'out', created_at: '2026-10-10T13:05:00Z', direction: 'outbound', sent_by_kind: 'user', status: 'sent' })
      ],
      []
    )
    expect(items[0]).toMatchObject({ kind: 'message', id: 'in', outgoing: false })
    expect(items[1]).toMatchObject({ kind: 'message', id: 'out', outgoing: true })
  })

  it('gives a held message its reason in words and never calls it sent', () => {
    const [item] = threadItems(
      [msg({
        id: 'h1', created_at: '2026-10-10T13:00:00Z', direction: 'outbound', sent_by_kind: 'agent',
        status: 'sent', hold_reason: 'outside_send_window'
      })],
      []
    )
    expect(item).toMatchObject({ kind: 'message', held: 'Held: outside sending hours' })
  })

  it('falls back to Held for review for a reason it does not know, or none at all', () => {
    const items = threadItems(
      [
        msg({ id: 'a', created_at: '2026-10-10T13:00:00Z', direction: 'outbound', hold_reason: 'zodiac_sign_mismatch' }),
        msg({ id: 'b', created_at: '2026-10-10T13:01:00Z', direction: 'outbound', status: 'held', hold_reason: null })
      ],
      []
    )
    expect(items[0]).toMatchObject({ held: 'Held for review' })
    expect(items[1]).toMatchObject({ held: 'Held for review' })
  })

  it('leaves held empty on a message that is not held', () => {
    const [item] = threadItems([msg({ id: 'a', created_at: '2026-10-10T13:00:00Z' })], [])
    expect(item).toMatchObject({ kind: 'message', held: null })
  })

  it('drops a draft with no text and a run that is not waiting for approval', () => {
    const items = threadItems(
      [],
      [
        run({ id: 'empty', created_at: '2026-10-10T13:00:00Z', proposal: { body: '   ' } }),
        run({ id: 'done', created_at: '2026-10-10T13:01:00Z', status: 'approved' }),
        run({ id: 'ok', created_at: '2026-10-10T13:02:00Z' })
      ]
    )
    expect(items.map((i) => i.id)).toEqual(['ok'])
  })

  it('carries the draft text and channel from the proposal', () => {
    const [item] = threadItems([], [run({ id: 'r1', created_at: '2026-10-10T13:00:00Z', proposal: { body: 'See you then.', channel: 'email' } })])
    expect(item).toMatchObject({ kind: 'draft', runId: 'r1', body: 'See you then.', channel: 'email' })
  })
})

describe('holdReasonWords', () => {
  it('turns the reasons it knows into plain words', () => {
    expect(holdReasonWords('outside_send_window')).toBe('Held: outside sending hours')
    expect(holdReasonWords('Quiet hours')).toBe('Held: outside sending hours')
    expect(holdReasonWords('opted_out')).toBe('Held: this customer opted out')
    expect(holdReasonWords('no_consent')).toBe('Held: no consent on file')
    expect(holdReasonWords('needs_approval')).toBe('Held: waiting for your approval')
  })

  it('never invents a reason', () => {
    expect(holdReasonWords('something_new')).toBe('Held for review')
    expect(holdReasonWords('')).toBe('Held for review')
    expect(holdReasonWords(null)).toBe('Held for review')
  })

  it('writes no dashes', () => {
    for (const reason of ['outside_send_window', 'opted_out', 'no_consent', 'needs_approval', 'rate_limit', 'no_phone', 'x']) {
      expect(holdReasonWords(reason)).not.toMatch(/[-\u2013\u2014]/)
    }
  })
})

describe('draftText', () => {
  it('reads the usual keys first', () => {
    expect(draftText({ body: 'One' })).toBe('One')
    expect(draftText({ text: 'Two' })).toBe('Two')
    expect(draftText({ message: { body: 'Three' } })).toBe('Three')
    expect(draftText('Four')).toBe('Four')
  })

  it('falls back to the longest sentence when the keys are unfamiliar', () => {
    expect(draftText({ reply_text: 'Of course, 11:30 works. See you then.', channel: 'sms', kind: 'reply' }))
      .toBe('Of course, 11:30 works. See you then.')
  })

  it('returns nothing for a proposal with no words in it', () => {
    expect(draftText(null)).toBe('')
    expect(draftText({ channel: 'sms' })).toBe('')
    expect(draftText({ body: '  ' })).toBe('')
    expect(draftText(42)).toBe('')
  })
})

describe('day and time labels (Central time)', () => {
  const now = new Date('2026-10-10T15:00:00Z') // Saturday 10 am

  it('names today and yesterday, then the date', () => {
    expect(dayLabel('2026-10-10T13:14:00Z', now)).toBe('Today')
    expect(dayLabel('2026-10-09T21:48:00Z', now)).toBe('Yesterday')
    expect(dayLabel('2026-10-06T15:00:00Z', now)).toBe('Tue, Oct 6')
    expect(dayLabel('2025-12-24T15:00:00Z', now)).toBe('Dec 24, 2025')
  })

  it('uses the local day, not the UTC day', () => {
    // 11 pm Friday in Chicago is already Saturday in UTC.
    expect(dayLabel('2026-10-10T04:00:00Z', now)).toBe('Yesterday')
  })

  it('writes the time in lower case with no stray spaces', () => {
    expect(timeLabel('2026-10-09T21:48:00Z')).toBe('4:48 pm')
    expect(timeLabel('2026-10-10T13:14:00Z')).toBe('8:14 am')
    expect(timeLabel('2026-10-10T17:00:00Z')).toBe('12:00 pm')
    expect(timeLabel('2026-10-10T05:05:00Z')).toBe('12:05 am')
  })

  it('shortens the list time by how old it is', () => {
    expect(listTimeLabel('2026-10-10T13:14:00Z', now)).toBe('8:14 am')
    expect(listTimeLabel('2026-10-09T21:48:00Z', now)).toBe('Yesterday')
    expect(listTimeLabel('2026-10-07T15:00:00Z', now)).toBe('Wed')
    expect(listTimeLabel('2026-09-20T15:00:00Z', now)).toBe('Sep 20')
    expect(listTimeLabel(null, now)).toBe('')
  })

  it('groups a thread under one label per day', () => {
    const items = threadItems(
      [
        msg({ id: 'a', created_at: '2026-10-09T21:48:00Z' }),
        msg({ id: 'b', created_at: '2026-10-09T22:02:00Z' }),
        msg({ id: 'c', created_at: '2026-10-10T13:14:00Z' })
      ],
      [run({ id: 'r', created_at: '2026-10-10T13:20:00Z' })]
    )
    const groups = groupByDay(items, now)
    expect(groups.map((g) => g.label)).toEqual(['Yesterday', 'Today'])
    expect(groups.map((g) => g.items.map((i) => i.id))).toEqual([['a', 'b'], ['c', 'r']])
  })
})

describe('stageChip', () => {
  it('words every stage and keeps the job and quote tones apart', () => {
    expect(stageChip('lead')).toEqual({ label: 'Lead', tone: 'neutral' })
    expect(stageChip('quote')).toEqual({ label: 'Quote', tone: 'info' })
    expect(stageChip('job')).toEqual({ label: 'Job', tone: 'success' })
    expect(stageChip('invoice')).toEqual({ label: 'Job', tone: 'success' })
    expect(stageChip('closed')).toEqual({ label: 'Closed', tone: 'neutral' })
    expect(stageChip(null)).toBeNull()
    expect(stageChip('')).toBeNull()
  })
})

describe('replyChannel', () => {
  it('follows the last channel when the customer can be reached that way', () => {
    expect(replyChannel({ last_channel: 'email', phone: '555', email: 'a@b.co' })).toEqual({ channel: 'email', options: ['sms', 'email'] })
    expect(replyChannel({ last_channel: 'sms', phone: '555', email: 'a@b.co' })).toEqual({ channel: 'sms', options: ['sms', 'email'] })
    expect(replyChannel({ last_channel: 'mms', phone: '555', email: null })).toEqual({ channel: 'sms', options: ['sms'] })
  })

  it('falls back to what is on file, and to nothing when there is nothing', () => {
    expect(replyChannel({ last_channel: 'call', phone: null, email: 'a@b.co' })).toEqual({ channel: 'email', options: ['email'] })
    expect(replyChannel({ last_channel: 'webchat', phone: '555', email: 'a@b.co' }).channel).toBe('sms')
    expect(replyChannel({ last_channel: null, phone: null, email: null })).toEqual({ channel: null, options: [] })
  })
})

describe('onceAtATime', () => {
  it('ignores a second call while the first is still running', async () => {
    let calls = 0
    let finish: (value: string) => void = () => {}
    const guarded = onceAtATime((): Promise<string> => {
      calls += 1
      return new Promise((resolve) => { finish = resolve })
    })
    const first = guarded()
    const second = guarded()
    expect(calls).toBe(1)
    finish('ok')
    expect(await first).toEqual({ ran: true, value: 'ok' })
    expect(await second).toEqual({ ran: false })
    // Once the first has finished, the next call goes through.
    const third = guarded()
    expect(calls).toBe(2)
    finish('again')
    expect(await third).toEqual({ ran: true, value: 'again' })
  })

  it('lets the next call through after a failure', async () => {
    let calls = 0
    const guarded = onceAtATime(async () => {
      calls += 1
      throw new Error('nope')
    })
    await expect(guarded()).rejects.toThrow('nope')
    await expect(guarded()).rejects.toThrow('nope')
    expect(calls).toBe(2)
  })
})

describe('the engine switch in the navigation', () => {
  it('keeps Schedule in the fifth dock slot until the engine is on', () => {
    expect(dockFifthItem(false)).toBe(SCHEDULE)
    expect(dockFifthItem(undefined)).toBe(SCHEDULE)
    expect(dockFifthItem(true)).toBe(INBOX)
  })

  it('puts Money and the fifth item on the right of the coin', () => {
    expect(dockRight(false).map((i) => i.label)).toEqual(['Money', 'Schedule'])
    expect(dockRight(undefined).map((i) => i.label)).toEqual(['Money', 'Schedule'])
    expect(dockRight(true).map((i) => i.label)).toEqual(['Money', 'Inbox'])
  })

  it('adds Inbox to the sidebar after Money only when the engine is on', () => {
    expect(sidebarPrimary(false).map((i) => i.label)).toEqual(['Today', 'Schedule', 'Jobs', 'Money', 'Customers', 'Reports'])
    expect(sidebarPrimary(undefined).map((i) => i.label)).toEqual(['Today', 'Schedule', 'Jobs', 'Money', 'Customers', 'Reports'])
    expect(sidebarPrimary(true).map((i) => i.label)).toEqual(['Today', 'Schedule', 'Jobs', 'Money', 'Inbox', 'Customers', 'Reports'])
  })

  it('lights Inbox on the thread route too', () => {
    expect(INBOX.to).toBe('/inbox')
    expect(INBOX.match?.('/inbox')).toBe(true)
    expect(INBOX.match?.('/inbox/conv-1')).toBe(true)
    expect(INBOX.match?.('/invoices')).toBe(false)
  })
})
