// What the Today screen shows (spec 9.2), as plain data built from the
// home dashboard bundle, the clock and the forecast. Pure, so the screen
// stays a layout and every rule here is unit tested.
//
// Evening is decided by the sun at the company's location, not by the
// display mode: Night mode at noon still shows the day view, and the
// evening view shows in Day mode after sunset.

import type { HomeDashboardBundle, HomeNextAction, HomeTodayOnSite } from './homeDashboard.ts'
import { clockTime, dayHeadline, nightHeadline } from './todayHeadline.ts'
import { dayWindows, resolveTheme } from './themeMode.ts'
import { hourlyStrip, weatherLabel, workWindow } from './weather.ts'
import { moneyCents } from './format.ts'

const DAY_MS = 86_400_000

export type TodayWorkWindow = { status: 'go' | 'warn' | 'stop'; label: string }
export type TodayWeather = { tempF: number | null; code: number | null; window: TodayWorkWindow }

export type TodayNextStop = {
  jobId: string
  title: string
  startAt: string
  address: string | null
  photoUrl: string | null
}

export type TodayView = {
  evening: boolean
  title: [string, string]
  weatherLine: string | null
  nextStop: TodayNextStop | null
  answers: HomeNextAction[]
  answersTotal: number
  day: HomeTodayOnSite[]
  done: HomeTodayOnSite[]
  tomorrow: HomeTodayOnSite[]
}

export type TodayViewInput = {
  bundle: HomeDashboardBundle
  now: Date
  lat?: number | null
  lon?: number | null
  weather?: TodayWeather | null
}

/** After sunset at the location (7 pm without one), and past noon. */
export function isEvening(now: Date, lat?: number | null, lon?: number | null): boolean {
  if (now.getHours() < 12) return false
  return resolveTheme('auto', now.getTime(), dayWindows(now, lat, lon)).theme === 'dark'
}

function dayKey(date: Date): string {
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`
}

function parse(iso: string | null | undefined): number {
  return iso ? Date.parse(iso) : Number.NaN
}

// The queries already ask for one local day each. Checking again here
// keeps a bundle cached before midnight from showing yesterday as today.
// A visit with no start stays where its query put it.
function onDay(item: HomeTodayOnSite, key: string): boolean {
  const start = parse(item.startAt)
  return Number.isNaN(start) || dayKey(new Date(start)) === key
}

function byStart(a: HomeTodayOnSite, b: HomeTodayOnSite): number {
  const x = parse(a.startAt)
  const y = parse(b.startAt)
  if (Number.isNaN(x)) return Number.isNaN(y) ? 0 : 1
  if (Number.isNaN(y)) return -1
  return x - y
}

// A visit with no end is over once it starts.
function isOver(item: HomeTodayOnSite, nowMs: number): boolean {
  const end = parse(item.endAt ?? item.startAt)
  return !Number.isNaN(end) && end <= nowMs
}

/** "71° and partly cloudy. Clear to work until 3 pm." */
export function weatherLine(weather: TodayWeather | null | undefined): string | null {
  if (!weather) return null
  const temp = weather.tempF != null && Number.isFinite(weather.tempF) ? `${Math.round(weather.tempF)}°` : ''
  const sky = weatherLabel(weather.code).trim().toLowerCase()
  const now = temp && sky ? `${temp} and ${sky}.`
    : temp ? `${temp}.`
    : sky ? `${sky.charAt(0).toUpperCase()}${sky.slice(1)}.`
    : ''
  const window = weather.window?.label?.trim().replace(/\.$/, '')
  const line = [now, window ? `${window}.` : ''].filter(Boolean).join(' ')
  return line || null
}

export function buildTodayView({ bundle, now, lat, lon, weather }: TodayViewInput): TodayView {
  const nowMs = now.getTime()
  const todayKey = dayKey(now)
  const tomorrowKey = dayKey(new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1))

  const day = (bundle.todayOnSite ?? []).filter((item) => onDay(item, todayKey)).sort(byStart)
  // A bundle cached by an older build has no tomorrow yet.
  const tomorrow = (bundle.tomorrowOnSite ?? []).filter((item) => onDay(item, tomorrowKey)).sort(byStart)
  const done = day.filter((item) => isOver(item, nowMs))

  // The card links to a job and opens maps, so visits with no job or no
  // start time stay in the day list only.
  const next = day.find((item) => item.contactId && item.startAt && !isOver(item, nowMs))
  const nextStop: TodayNextStop | null = next
    ? {
        jobId: next.contactId as string,
        title: next.clientName || next.title,
        startAt: next.startAt as string,
        address: next.address ?? null,
        photoUrl: bundle.photoUrlByJob?.[next.contactId as string] ?? null
      }
    : null

  const actions = bundle.nextActions ?? []
  const evening = isEvening(now, lat, lon)
  const title = evening
    ? nightHeadline({ stopsToday: done.length, openAnswers: actions.length }).title
    : dayHeadline(day.map((item) => ({ startAt: item.startAt ?? '', title: item.title }))).title

  return {
    evening,
    title,
    weatherLine: weatherLine(weather),
    nextStop,
    answers: actions.slice(0, 3),
    answersTotal: actions.length,
    day,
    done,
    tomorrow
  }
}

/* ---------------- The week strip (desktop) ---------------- */

export type WeekStripDay = {
  /** The local day as "2026-10-08", for keys and the Schedule link. */
  key: string
  weekday: string
  dayOfMonth: number
  count: number
  today: boolean
  /** "3 visits", "1 visit" or "None", for the cell. */
  countText: string
  /** The whole cell for a screen reader: "Thursday, October 8, today, 3 visits". */
  label: string
}

function startOfWeekSunday(now: Date): Date {
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() - now.getDay())
}

/**
 * The week the desktop strip draws and the range to fetch for it: local
 * midnight on Sunday up to the next Sunday, the same seven days as the
 * desktop Schedule board.
 */
export function weekBounds(now: Date): { start: Date; end: Date } {
  const start = startOfWeekSunday(now)
  return { start, end: new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7) }
}

function pad2(n: number): string {
  return String(n).padStart(2, '0')
}

/**
 * Seven days, Sunday to Saturday around today, each with its number of
 * visits. A visit counts on the local day it starts; rows with no start
 * or from another week are left out, so a range query that returns more
 * than the week still counts right.
 */
export function weekStrip(visits: { start_at?: string | null }[], now: Date): WeekStripDay[] {
  const first = startOfWeekSunday(now)
  const todayKey = dayKey(now)
  const counts = new Map<string, number>()
  for (const visit of visits) {
    const start = parse(visit.start_at)
    if (Number.isNaN(start)) continue
    const key = dayKey(new Date(start))
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  return Array.from({ length: 7 }, (_, i) => {
    const date = new Date(first.getFullYear(), first.getMonth(), first.getDate() + i)
    const count = counts.get(dayKey(date)) ?? 0
    const today = dayKey(date) === todayKey
    const countText = count === 0 ? 'None' : `${count} ${count === 1 ? 'visit' : 'visits'}`
    const spoken = count === 0 ? 'no visits' : countText
    const long = date.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric' })
    return {
      key: `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`,
      weekday: date.toLocaleDateString('en-US', { weekday: 'short' }),
      dayOfMonth: date.getDate(),
      count,
      today,
      countText,
      label: `${long}, ${today ? 'today, ' : ''}${spoken}`
    }
  })
}

/* ---------------- Times ---------------- */

/** "7:30" and "am", for the time column and the next stop label. */
export function stopTime(iso: string | null | undefined): { time: string; suffix: 'am' | 'pm' } | null {
  const ms = parse(iso)
  if (Number.isNaN(ms)) return null
  const date = new Date(ms)
  return { time: clockTime(date), suffix: date.getHours() < 12 ? 'am' : 'pm' }
}

/* ---------------- Forecast ---------------- */

type ForecastSnapshot = {
  time?: string
  temperature_2m?: number | null
  weather_code?: number | null
  precipitation?: number | null
  wind_speed_10m?: number | null
  relative_humidity_2m?: number | null
}

// The parts of getWeather's Open Meteo response that Today reads.
type Forecast = {
  current?: ForecastSnapshot
  hourly?: { time?: string[]; weather_code?: (number | null)[] } & Record<string, unknown>
  daily?: { time?: string[]; temperature_2m_max?: (number | null)[] }
}

function asForecast(value: unknown): Forecast | null {
  return value && typeof value === 'object' ? (value as Forecast) : null
}

function finite(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n)
}

/** "3 pm" from an Open Meteo hour such as "2026-10-09T15:00", local to the forecast. */
function hourLabel(slot: string): string {
  const hour = Number(slot.slice(11, 13))
  return `${hour % 12 || 12} ${hour < 12 ? 'am' : 'pm'}`
}

function trades(services: string[] | null | undefined): string[] {
  return (services ?? []).map((service) => String(service).toLowerCase())
}

/**
 * The work window right now for the company's trades, and how long it
 * holds today: "Clear to work until 3 pm", "Stand down all day".
 */
export function forecastWindow(forecast: unknown, services?: string[] | null): TodayWorkWindow | null {
  const f = asForecast(forecast)
  if (!f?.current) return null
  const picked = trades(services)
  const current = workWindow(f.current, picked)
  const strip = hourlyStrip(f.hourly, picked, 24, f.current.time ?? Date.now())
  const today = (f.current.time ?? strip[0]?.time ?? '').slice(0, 10)
  const change = strip.slice(1).find((slot) => slot.time.slice(0, 10) === today && slot.status !== current.status)
  return { status: current.status, label: change ? `${current.label} until ${hourLabel(change.time)}` : `${current.label} all day` }
}

/** The current conditions for the day view's weather line. */
export function todayWeather(forecast: unknown, services?: string[] | null): TodayWeather | null {
  const f = asForecast(forecast)
  const window = forecastWindow(f, services)
  if (!f?.current || !window) return null
  return {
    tempF: finite(f.current.temperature_2m) ? f.current.temperature_2m : null,
    code: finite(f.current.weather_code) ? f.current.weather_code : null,
    window
  }
}

/**
 * The evening line under the headline: tomorrow's high and sky, then the
 * first two stops. "Tomorrow 68° and clear. Final slab inspection at
 * 9:00, then Castellanos site measure at 1:00."
 */
export function tomorrowLine(tomorrow: HomeTodayOnSite[], forecast?: unknown): string {
  const f = asForecast(forecast)
  let sky = ''
  const date = f?.daily?.time?.[1]
  const high = f?.daily?.temperature_2m_max?.[1]
  if (date && finite(high)) {
    const noon = f?.hourly?.time?.indexOf(`${date}T12:00`) ?? -1
    const label = weatherLabel(noon >= 0 ? f?.hourly?.weather_code?.[noon] : null).trim().toLowerCase()
    sky = label ? `Tomorrow ${Math.round(high)}° and ${label}.` : `Tomorrow ${Math.round(high)}°.`
  }

  const stops = tomorrow.slice(0, 2).map((item) => {
    const start = stopTime(item.startAt)
    return start ? `${item.title} at ${start.time}` : item.title
  })
  const more = tomorrow.length - stops.length
  const plan = stops.length ? `${stops.join(', then ')}${more > 0 ? `, and ${more} more` : ''}.` : ''

  if (sky) return `${sky} ${plan || 'Nothing on the schedule.'}`
  return plan ? `Tomorrow, ${plan}` : 'Nothing on the schedule tomorrow.'
}

/* ---------------- Needs an answer ---------------- */

export type AnswerAction = 'Remind' | 'Nudge' | 'Reply' | 'Schedule' | 'Close job'
export type AnswerDot = 'danger' | 'neutral' | 'info'
export type AnswerCopy = { title: string; subline: string; actionLabel: AnswerAction; dot: AnswerDot }

const DOT: Record<HomeNextAction['urgencyTone'], AnswerDot> = {
  danger: 'danger',
  warn: 'neutral',
  success: 'info'
}

function dayCount(n: number): string {
  return n === 1 ? '1 day' : `${n} days`
}

function sentence(parts: (string | null | false)[]): string {
  const text = parts.filter(Boolean).join(', ')
  return text.charAt(0).toUpperCase() + text.slice(1)
}

/**
 * The row for one next action, in the screen's own words: a title, a
 * subline with money in cents, the one mini action and the status dot.
 * The bundle's own title and detail stay as they are for the desktop.
 */
export function answerCopy(action: HomeNextAction, now: Date): AnswerCopy {
  const name = action.contactName
  const money = action.contactAmount > 0 ? moneyCents(action.contactAmount) : null
  const elapsed = (now.getTime() - parse(action.dueIso)) / DAY_MS
  const days = dayCount(Math.max(1, Math.round(Number.isNaN(elapsed) ? 1 : elapsed)))
  const dot = DOT[action.urgencyTone] ?? 'neutral'

  switch (action.kind) {
    case 'inv-overdue': {
      const due = new Date(parse(action.dueIso))
      const dueOn = Number.isNaN(due.getTime()) ? null : `due ${due.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`
      return { title: `${name} invoice is ${days} overdue`, subline: sentence([money, dueOn]), actionLabel: 'Remind', dot }
    }
    case 'invoice':
      return { title: `${name} is ready to bill`, subline: sentence([money && `${money} still owed`, 'work is done']), actionLabel: 'Remind', dot }
    case 'followup':
      return { title: `Follow up with ${name}`, subline: sentence([money, `quiet for ${days}`]), actionLabel: 'Nudge', dot }
    case 'followup-due': {
      const late = Math.round(Number.isNaN(elapsed) ? 0 : elapsed)
      return {
        title: `Call ${name}`,
        subline: sentence([money, late <= 0 ? 'follow up is due today' : `follow up was due ${dayCount(late)} ago`]),
        actionLabel: 'Nudge',
        dot
      }
    }
    case 'viewed-quiet':
      return { title: `${name} opened the quote, no reply`, subline: sentence([money, `viewed ${days} ago`]), actionLabel: 'Nudge', dot }
    case 'quote-changes':
      // The customer's own note, shown as they wrote it.
      return { title: `${name} asked for quote changes`, subline: action.detail, actionLabel: 'Reply', dot }
    case 'co-unsigned':
      return { title: `${name} has not signed the change order`, subline: sentence([money, `sent ${days} ago`]), actionLabel: 'Nudge', dot }
    case 'reschedule':
      return { title: `${name} is behind schedule`, subline: 'Set a new date and tell the client.', actionLabel: 'Schedule', dot }
    default:
      return { title: action.title, subline: action.detail, actionLabel: 'Reply', dot }
  }
}

/* ---------------- Maps ---------------- */

/** Directions to an address: Apple Maps on iPhone and iPad, Google Maps elsewhere. */
export function navigateHref(address: string, userAgent = '', maxTouchPoints = 0): string {
  const destination = encodeURIComponent(address)
  const apple = /iPad|iPhone|iPod/.test(userAgent) || (/Macintosh/.test(userAgent) && maxTouchPoints > 1)
  return apple
    ? `https://maps.apple.com/?daddr=${destination}`
    : `https://www.google.com/maps/dir/?api=1&destination=${destination}`
}
