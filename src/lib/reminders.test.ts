import { beforeEach, describe, expect, it, vi } from 'vitest'

// The mocked project: what fh_my_open_reminders answers, and the head
// counts the bell reads from fh_notifications with the filters it sent.
let rpcAnswer: { data: unknown; error: { code?: string; message: string } | null } = { data: [], error: null }
const counts: { filters: string[]; count: number }[] = []
let nextCount = 0
let countError: { message: string } | null = null

vi.mock('./supabase.ts', () => ({
  supabase: {
    rpc: async () => rpcAnswer,
    from: () => {
      const filters: string[] = []
      const chain = {
        select: () => chain,
        eq: (col: string, v: string) => { filters.push(`${col}=eq.${v}`); return chain },
        is: (col: string, v: null) => { filters.push(`${col}=is.${v}`); return chain },
        not: (col: string, op: string, v: string) => { filters.push(`${col}=not.${op}.${v}`); return chain },
        then: (resolve: (r: unknown) => void) => {
          counts.push({ filters, count: nextCount })
          resolve(countError ? { count: null, error: countError } : { count: nextCount, error: null })
        }
      }
      return chain
    }
  }
}))

const {
  contactLinkFor, fetchOpenReminders, groupRemindersByClient, isMissingFunction, notificationBadgeCount, tierLabel
} = await import('./reminders.ts')

type Row = Parameters<typeof groupRemindersByClient>[0][number]
let n = 0
const reminder = (client: string, kind: string, due: string, extra: Partial<Row> = {}): Row => ({
  notification_id: `nt-${++n}`, follow_up_id: `fu-${n}`, kind, record_kind: 'lead', record_id: `rec-${n}`,
  link: `/leads/rec-${n}`, client_id: `cl-${client}`, client_name: client, client_phone: '615-555-0100', client_email: null,
  headline: `${kind}: ${client}`, draft_body: 'Hi', channel: 'text', due_on: due, days_quiet: 3,
  created_at: `${due}T15:00:00Z`, read_at: null, ...extra
})

beforeEach(() => {
  rpcAnswer = { data: [], error: null }
  counts.length = 0
  nextCount = 0
  countError = null
})

describe('groupRemindersByClient', () => {
  it('gives one row per client, led by the newest reminder, newest client first', () => {
    const rows = [
      reminder('Ann', 'day3', '2026-11-01'), reminder('Ann', 'day7', '2026-11-05'), reminder('Ann', 'day14', '2026-11-12'),
      reminder('Ann', 'day30', '2026-11-10'), reminder('Bob', 'day3', '2026-11-15')
    ]
    const groups = groupRemindersByClient(rows)
    expect(groups.map((g) => g.clientName)).toEqual(['Bob', 'Ann'])
    expect(groups[1].newest.kind).toBe('day14')
    expect(groups[1].reminders).toHaveLength(4)
    expect(groups[0].reminders).toHaveLength(1)
  })

  it('thirty reminders for six customers make six rows', () => {
    const rows = []
    for (let c = 0; c < 6; c++) for (let i = 0; i < 5; i++) rows.push(reminder(`C${c}`, 'day3', `2026-11-0${i + 1}`))
    expect(groupRemindersByClient(rows)).toHaveLength(6)
  })

  it('a reminder with no client stands on its own row', () => {
    const groups = groupRemindersByClient([reminder('X', 'review_ask', '2026-11-01', { client_id: null }), reminder('Y', 'review_ask', '2026-11-01', { client_id: null })])
    expect(groups).toHaveLength(2)
  })
})

describe('contactLinkFor', () => {
  it('calls, texts or emails as the reminder asks, with what is on file', () => {
    expect(contactLinkFor(reminder('A', 'day7', '2026-11-01', { channel: 'call' }))).toEqual({ label: 'Call', href: 'tel:6155550100' })
    expect(contactLinkFor(reminder('A', 'day3', '2026-11-01'))).toEqual({ label: 'Text', href: 'sms:6155550100' })
    expect(contactLinkFor(reminder('A', 'day30', '2026-11-01', { channel: 'email', client_email: 'a@example.com' })))
      .toEqual({ label: 'Email', href: 'mailto:a@example.com' })
    expect(contactLinkFor(reminder('A', 'day3', '2026-11-01', { client_phone: null, client_email: 'a@example.com' })))
      .toEqual({ label: 'Email', href: 'mailto:a@example.com' })
    expect(contactLinkFor(reminder('A', 'day30', '2026-11-01', { channel: 'email', client_email: null }))).toEqual({ label: 'Call', href: 'tel:6155550100' })
    expect(contactLinkFor(reminder('A', 'day3', '2026-11-01', { client_phone: null }))).toBeNull()
  })
})

describe('tierLabel', () => {
  it('names each tier in plain words', () => {
    expect(['day3', 'day7', 'day14', 'day30', 'review_ask', 'other'].map(tierLabel))
      .toEqual(['Day 3 touch', 'Day 7 call', 'Day 14 close out ask', 'Day 30 revival', 'Review ask', 'Reminder'])
  })
})

describe('fetchOpenReminders', () => {
  it('answers null when the database does not have the function yet', async () => {
    expect(isMissingFunction({ code: 'PGRST202', message: 'Could not find the function' })).toBe(true)
    expect(isMissingFunction({ code: '42883', message: 'function does not exist' })).toBe(true)
    expect(isMissingFunction({ code: '42501', message: 'permission denied' })).toBe(false)
    expect(isMissingFunction(null)).toBe(false)
    rpcAnswer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    expect(await fetchOpenReminders()).toBeNull()
    rpcAnswer = { data: null, error: { code: '42883', message: 'function does not exist' } }
    expect(await fetchOpenReminders()).toBeNull()
  })

  it('throws any other failure and returns the rows otherwise', async () => {
    rpcAnswer = { data: null, error: { code: '500', message: 'Server error' } }
    await expect(fetchOpenReminders()).rejects.toMatchObject({ message: 'Server error' })
    const rows = [reminder('Ann', 'day3', '2026-11-01')]
    rpcAnswer = { data: rows, error: null }
    expect(await fetchOpenReminders()).toEqual(rows)
  })
})

describe('notificationBadgeCount', () => {
  it('counts customers with open reminders plus other unread notifications, as the screen does', async () => {
    rpcAnswer = { data: [reminder('Ann', 'day3', '2026-11-01'), reminder('Ann', 'day7', '2026-11-08'), reminder('Bob', 'day3', '2026-11-02')], error: null }
    nextCount = 1
    expect(await notificationBadgeCount('u1')).toBe(3)
    expect(counts[0].filters).toEqual(['user_id=eq.u1', 'read_at=is.null', 'kind=not.in.(follow_up_due,review_ask_due)'])
  })

  it('falls back to every unread notification while the function is missing', async () => {
    rpcAnswer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    nextCount = 86
    expect(await notificationBadgeCount('u1')).toBe(86)
    expect(counts[0].filters).toEqual(['user_id=eq.u1', 'read_at=is.null'])
  })

  it('answers 0 with no user and never throws', async () => {
    expect(await notificationBadgeCount(undefined)).toBe(0)
    rpcAnswer = { data: null, error: { code: '500', message: 'Server error' } }
    nextCount = 2
    expect(await notificationBadgeCount('u1')).toBe(2)
  })

  it('answers null when the unread count cannot be read, so the bell keeps its last count', async () => {
    countError = { message: 'Server error' }
    rpcAnswer = { data: [reminder('Ann', 'day3', '2026-11-01')], error: null }
    expect(await notificationBadgeCount('u1')).toBeNull()
    rpcAnswer = { data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }
    expect(await notificationBadgeCount('u1')).toBeNull()
  })
})
