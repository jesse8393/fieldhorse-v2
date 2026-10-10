// The Spine (spec 9.4): one timeline of everything on a job, newest
// first. Pure, so the phone Job page and its tests share one source.
//
// Inputs are what the screen already loads: the activity events from
// composeActivityEvents (notes, payments, schedule, change orders, stage
// moves), the job's photo rows with their signed url (null when signing
// failed), and the inspections from useJobData.
//
// Rules:
// * Photos uploaded within 15 minutes of the one before merge into one
//   item, "3 photos", with up to three thumbnails. A photo without a url
//   still counts, but never becomes a thumbnail, so no broken image box.
// * Paid, approved and closed events and passed inspections get tone
//   success (the green marker); everything else is neutral. The title
//   always carries the word.
// * Titles and sublines the code writes never contain a hyphen, an en
//   dash or an em dash. Text people typed (notes, captions, schedule
//   titles) passes through untouched.
// * time is "7:12"; day is "today", a weekday such as "Wed" inside a
//   week, or a date such as "Sep 30" beyond it.

import type { ActivityEvent } from '../sections/composeActivityEvents.ts'
import { marginTier } from '../../../lib/stages.ts'
import { moneyCents } from '../../../lib/format.ts'

export type SpinePhoto = { src: string; alt: string }

export type SpineItem = {
  id: string
  at: Date
  time: string
  day: string
  title: string
  subline: string | null
  tone: 'success' | 'neutral'
  photos: SpinePhoto[]
}

export type SpinePhotoInput = {
  id: string
  uploaded_at: string
  caption: string | null
  url: string | null
}

export type SpineInspectionInput = {
  id: string
  result?: string | null
  inspected_at?: string | null
  type?: string | null
}

export type BuildSpineInput = {
  events: ActivityEvent[]
  photos: SpinePhotoInput[]
  inspections: SpineInspectionInput[]
  now: Date
}

const PHOTO_BATCH_MS = 15 * 60 * 1000
const MAX_THUMBS = 3
const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAY_MS = 24 * 60 * 60 * 1000

function valid(d: Date) {
  return d instanceof Date && !Number.isNaN(d.getTime())
}

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate())
}

/** "7:12", on a 12 hour clock. */
export function spineTime(at: Date): string {
  const h = at.getHours() % 12 || 12
  return `${h}:${String(at.getMinutes()).padStart(2, '0')}`
}

/** "today", "Wed" inside a week either side, otherwise "Sep 30". */
export function spineDay(at: Date, now: Date): string {
  const days = Math.round((startOfDay(at).getTime() - startOfDay(now).getTime()) / DAY_MS)
  if (days === 0) return 'today'
  if (Math.abs(days) < 7) return WEEKDAYS[at.getDay()]
  const date = `${MONTHS[at.getMonth()]} ${at.getDate()}`
  return at.getFullYear() === now.getFullYear() ? date : `${date}, ${at.getFullYear()}`
}

function item(
  id: string,
  at: Date,
  now: Date,
  title: string,
  subline: string | null,
  tone: SpineItem['tone'],
  photos: SpinePhoto[] = []
): SpineItem {
  return { id, at, time: spineTime(at), day: spineDay(at, now), title, subline, tone, photos }
}

function lowerStage(s: string) {
  return s.trim().toLowerCase()
}

// "Check · 1042" reads as "Check, 1042" in a sentence.
function joinDots(s: string | null | undefined) {
  return String(s || '').split(' · ').map((part) => part.trim()).filter(Boolean)
}

function eventItem(e: ActivityEvent, now: Date): SpineItem {
  const tone: SpineItem['tone'] = e.tone === 'green' ? 'success' : 'neutral'
  const sub = e.sub ?? null

  switch (e.kind) {
    case 'note': {
      // The note itself is the entry: typed by a person, shown as typed.
      const text = String(sub || '').trim()
      return item(e.id, e.when, now, text || 'Note added', null, 'neutral')
    }
    case 'payment': {
      const amount = typeof e.amount === 'number' ? moneyCents(e.amount) : null
      const kind = /received · (\w+)$/.exec(e.title)?.[1] ?? null
      const parts = [amount, kind, ...joinDots(sub)].filter(Boolean)
      return item(e.id, e.when, now, 'Payment received', parts.length ? parts.join(', ') : null, 'success')
    }
    case 'change_order': {
      const amount = typeof e.amount === 'number' ? e.amount : null
      const line = amount == null
        ? null
        : amount < 0
          ? `${moneyCents(Math.abs(amount))} credit`
          : `${moneyCents(amount)} added to the contract`
      return item(e.id, e.when, now, e.title, line, 'neutral')
    }
    case 'change_order_approved':
      return item(e.id, e.when, now, e.title, sub, 'success')
    case 'stage': {
      // "Quote → Job" from the stage history reads as a sentence.
      const [from, to] = e.title.split(' → ')
      if (from && to) return item(e.id, e.when, now, `Moved from ${lowerStage(from)} to ${lowerStage(to)}`, sub, tone)
      const fresh = /^New (\w+)$/.exec(e.title)
      if (fresh) return item(e.id, e.when, now, `New ${lowerStage(fresh[1])}`, sub, tone)
      const legacy = /^Stage: (\w+)$/.exec(e.title)
      if (legacy) return item(e.id, e.when, now, `Moved to ${lowerStage(legacy[1])}`, sub, tone)
      return item(e.id, e.when, now, e.title, sub, tone)
    }
    case 'schedule':
      // The time column already says when; the subline says what it is.
      return item(e.id, e.when, now, e.title, 'On the schedule', 'neutral')
    default:
      return item(e.id, e.when, now, e.title, sub, tone)
  }
}

function photoItems(photos: SpinePhotoInput[], now: Date): SpineItem[] {
  const dated = photos
    .map((p) => ({ ...p, at: new Date(p.uploaded_at) }))
    .filter((p) => valid(p.at))
    .sort((a, b) => b.at.getTime() - a.at.getTime())

  const groups: (typeof dated)[] = []
  for (const p of dated) {
    const group = groups[groups.length - 1]
    const last = group?.[group.length - 1]
    if (group && last && last.at.getTime() - p.at.getTime() <= PHOTO_BATCH_MS) group.push(p)
    else groups.push([p])
  }

  return groups.map((group) => {
    const count = group.length
    const caption = group.find((p) => p.caption && p.caption.trim())?.caption?.trim() ?? null
    const thumbs = group
      .filter((p) => typeof p.url === 'string' && p.url.length > 0)
      .slice(0, MAX_THUMBS)
      .map((p) => ({ src: p.url as string, alt: p.caption?.trim() || 'Job photo' }))
    return item(
      `photos:${group[0].id}`,
      group[0].at,
      now,
      count === 1 ? '1 photo' : `${count} photos`,
      caption,
      'neutral',
      thumbs
    )
  })
}

function inspectionItem(i: SpineInspectionInput, now: Date): SpineItem | null {
  const at = new Date(i.inspected_at ?? '')
  if (!i.inspected_at || !valid(at)) return null
  const result = String(i.result ?? '').toLowerCase()
  const passed = result === 'pass' || result === 'passed'
  const failed = result === 'fail' || result === 'failed'
  const title = passed ? 'Inspection passed' : failed ? 'Inspection failed' : 'Inspection logged'
  const type = i.type?.trim() || null
  return item(`inspection:${i.id}`, at, now, title, type, passed ? 'success' : 'neutral')
}

export function buildSpine({ events, photos, inspections, now }: BuildSpineInput): SpineItem[] {
  const out: SpineItem[] = []
  for (const e of events || []) {
    if (valid(e.when)) out.push(eventItem(e, now))
  }
  out.push(...photoItems(photos || [], now))
  for (const i of inspections || []) {
    const entry = inspectionItem(i, now)
    if (entry) out.push(entry)
  }
  // Newest first; equal times keep the order they were added in.
  return out
    .map((entry, index) => ({ entry, index }))
    .sort((a, b) => b.entry.at.getTime() - a.entry.at.getTime() || a.index - b.index)
    .map(({ entry }) => entry)
}

export type JobMoney = {
  contract: string
  paid: string
  balance: string
  marginChip: { label: string; tone: 'success' | 'neutral' | 'danger' } | null
}

const MARGIN_TONE = { good: 'success', warn: 'neutral', thin: 'danger' } as const

/**
 * The money strip on the Job page: contract, paid and balance with
 * cents, and a margin chip that always carries its number (green from 30
 * percent, neutral from 15, red below). A negative margin says "loss"
 * rather than writing a minus sign.
 */
export function jobMoney({ contractTotal, paid, balance, marginPct }: {
  contractTotal: number
  paid: number
  balance: number
  marginPct: number | null
}): JobMoney {
  let marginChip: JobMoney['marginChip'] = null
  if (marginPct != null && Number.isFinite(marginPct)) {
    const rounded = Math.round(Math.abs(marginPct) * 10) / 10
    marginChip = marginPct < 0 && rounded > 0
      ? { label: `${rounded.toFixed(1)}% loss`, tone: 'danger' }
      : { label: `${rounded.toFixed(1)}% margin`, tone: MARGIN_TONE[marginTier(marginPct)] }
  }
  return {
    contract: moneyCents(contractTotal),
    paid: moneyCents(paid),
    balance: moneyCents(balance),
    marginChip
  }
}
