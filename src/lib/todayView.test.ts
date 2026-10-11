import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { HomeDashboardBundle, HomeNextAction, HomeTodayOnSite } from './homeDashboard.ts'
import { dayHeadline, nightHeadline } from './todayHeadline.ts'
import {
  answerCopy,
  buildTodayView,
  forecastWindow,
  isEvening,
  navigateHref,
  stopTime,
  todayWeather,
  tomorrowLine,
  weatherLine,
  weekBounds,
  weekStrip
} from './todayView.ts'

// The phone and the company sit in Murfreesboro, Tennessee.
const originalTz = process.env.TZ
process.env.TZ = 'America/Chicago'
beforeAll(() => { process.env.TZ = 'America/Chicago' })
afterAll(() => {
  if (originalTz === undefined) delete process.env.TZ
  else process.env.TZ = originalTz
})

const LAT = 35.85
const LON = -86.39

/** Thursday, October 8, 2026, local time. */
function at(hours: number, minutes = 0, dayOffset = 0) {
  return new Date(2026, 9, 8 + dayOffset, hours, minutes)
}

function visit(id: string, contactId: string | null, start: Date, end: Date | null, extra: Partial<HomeTodayOnSite> = {}): HomeTodayOnSite {
  return {
    id,
    contactId,
    title: `Visit ${id}`,
    clientName: contactId ? `Job ${contactId}` : null,
    stage: 'job',
    startAt: start.toISOString(),
    endAt: end ? end.toISOString() : null,
    address: contactId ? `${id} Main St` : null,
    jobTitle: null,
    ...extra
  }
}

function action(n: number, extra: Partial<HomeNextAction> = {}): HomeNextAction {
  return {
    id: `a-${n}`,
    kind: 'followup',
    contactId: `lead-${n}`,
    verb: 'Follow up',
    contactName: `Lead ${n}`,
    contactAmount: 0,
    dueIso: at(9).toISOString(),
    dueKind: 'waited',
    title: `Follow up with Lead ${n}`,
    detail: 'Lead waiting 9 days',
    urgencyLabel: 'Follow up',
    urgencyTone: 'warn',
    urgency: n,
    tab: 'overview',
    intent: 'follow_up',
    ...extra
  }
}

function bundle(overrides: Partial<HomeDashboardBundle> = {}): HomeDashboardBundle {
  return {
    pipeline: 0,
    pipelinePrev: 0,
    dealsAtRisk: { count: 0, value: 0, followUps: 0, quotesAttention: 0 },
    jobsBehind: 0,
    invoicingWeek: 0,
    topPipeline: [],
    jobHealth: [],
    stageBreakdown: { won: 0, active: 0, lead: 0 },
    stageRail: [],
    todayOnSite: [],
    tomorrowOnSite: [],
    nextActions: [],
    photoUrlByJob: {},
    ...overrides
  }
}

function threeStops() {
  return [
    visit('v1', 'job-1', at(7, 30), at(11), { title: 'Pour slab, crew A', clientName: 'Whitcomb garage slab', address: '2210 Ridgecrest Dr' }),
    visit('v2', 'job-2', at(13, 30), at(16), { title: 'Site visit' }),
    visit('v3', 'job-3', at(16, 30), at(17, 30), { title: 'Walkthrough' })
  ]
}

function headlineStops(rows: HomeTodayOnSite[]) {
  return rows.map((row) => ({ startAt: row.startAt as string, title: row.title }))
}

describe('isEvening', () => {
  it('is true after sunset and after noon', () => {
    expect(isEvening(at(19, 40), LAT, LON)).toBe(true)
  })

  it('is false before sunrise, because it is morning', () => {
    expect(isEvening(at(5), LAT, LON)).toBe(false)
  })

  it('is false in daylight', () => {
    expect(isEvening(at(12, 30), LAT, LON)).toBe(false)
  })

  it('uses 7 pm when there is no location', () => {
    expect(isEvening(at(18, 30))).toBe(false)
    expect(isEvening(at(19, 30))).toBe(true)
  })
})

describe('buildTodayView', () => {
  it('at 6:40 am with three stops, shows the day headline and the first stop next', () => {
    const today = threeStops()
    const view = buildTodayView({
      bundle: bundle({ todayOnSite: today, photoUrlByJob: { 'job-1': 'https://example.test/slab.jpg' } }),
      now: at(6, 40),
      lat: LAT,
      lon: LON
    })
    expect(view.evening).toBe(false)
    expect(view.title).toEqual(dayHeadline(headlineStops(today)).title)
    expect(view.title).toEqual(['Three stops.', 'First pour at 7:30.'])
    expect(view.nextStop).toEqual({
      jobId: 'job-1',
      title: 'Whitcomb garage slab',
      startAt: today[0].startAt,
      address: '2210 Ridgecrest Dr',
      photoUrl: 'https://example.test/slab.jpg'
    })
    expect(view.day.map((row) => row.id)).toEqual(['v1', 'v2', 'v3'])
    expect(view.done).toEqual([])
  })

  it('at 3:00 pm with the first stop finished, the second is next and the first is done', () => {
    const view = buildTodayView({ bundle: bundle({ todayOnSite: threeStops() }), now: at(15), lat: LAT, lon: LON })
    expect(view.nextStop?.jobId).toBe('job-2')
    expect(view.done.map((row) => row.id)).toEqual(['v1'])
  })

  it('at 7:40 pm in Murfreesboro in October, shows the evening headline', () => {
    const answers = [action(1), action(2)]
    const view = buildTodayView({
      bundle: bundle({
        todayOnSite: threeStops(),
        tomorrowOnSite: [visit('t1', 'job-4', at(9, 0, 1), at(10, 0, 1))],
        nextActions: answers
      }),
      now: at(19, 40),
      lat: LAT,
      lon: LON
    })
    expect(view.evening).toBe(true)
    expect(view.title).toEqual(nightHeadline({ stopsToday: 3, openAnswers: 2 }).title)
    expect(view.title).toEqual(['Three stops done.', 'Two things before tomorrow.'])
    expect(view.done).toHaveLength(3)
    expect(view.nextStop).toBeNull()
    expect(view.tomorrow.map((row) => row.id)).toEqual(['t1'])
  })

  it('at 5:00 am, before sunrise, is not the evening', () => {
    const view = buildTodayView({ bundle: bundle({ todayOnSite: threeStops() }), now: at(5), lat: LAT, lon: LON })
    expect(view.evening).toBe(false)
    expect(view.title).toEqual(['Three stops.', 'First pour at 7:30.'])
  })

  it('an empty bundle is a clear day with nothing next', () => {
    const view = buildTodayView({ bundle: bundle(), now: at(8), lat: LAT, lon: LON })
    expect(view.nextStop).toBeNull()
    expect(view.answers).toEqual([])
    expect(view.answersTotal).toBe(0)
    expect(view.title).toEqual(['Clear day.', 'Nothing on the schedule.'])
    expect(view.weatherLine).toBeNull()
  })

  it('shows three answers and counts all of them', () => {
    const actions = Array.from({ length: 8 }, (_, i) => action(i + 1))
    const view = buildTodayView({ bundle: bundle({ nextActions: actions }), now: at(8) })
    expect(view.answers).toHaveLength(3)
    expect(view.answers.map((a) => a.id)).toEqual(['a-1', 'a-2', 'a-3'])
    expect(view.answersTotal).toBe(8)
  })

  it('has no photo when the job has none', () => {
    const view = buildTodayView({ bundle: bundle({ todayOnSite: threeStops(), photoUrlByJob: { 'job-9': 'x.jpg' } }), now: at(6, 40) })
    expect(view.nextStop?.photoUrl).toBeNull()
  })

  it('skips visits with no job for the next stop card, but keeps them in the day', () => {
    const today = [
      visit('v0', null, at(7), at(8), { title: 'Supplier pickup' }),
      visit('v1', 'job-1', at(9), at(10))
    ]
    const view = buildTodayView({ bundle: bundle({ todayOnSite: today }), now: at(6, 40) })
    expect(view.nextStop?.jobId).toBe('job-1')
    expect(view.day).toHaveLength(2)
  })

  it('treats a visit with no end as over once it starts', () => {
    const view = buildTodayView({ bundle: bundle({ todayOnSite: [visit('v1', 'job-1', at(9), null)] }), now: at(9, 5) })
    expect(view.nextStop).toBeNull()
    expect(view.done.map((row) => row.id)).toEqual(['v1'])
  })

  it('keeps each list to its own day, even when the bundle is from yesterday', () => {
    const view = buildTodayView({
      bundle: bundle({
        todayOnSite: [visit('old', 'job-1', at(9, 0, -1), at(10, 0, -1)), visit('v1', 'job-2', at(9), at(10))],
        tomorrowOnSite: [visit('v1', 'job-2', at(9), at(10)), visit('t1', 'job-3', at(8, 0, 1), at(9, 0, 1))]
      }),
      now: at(6)
    })
    expect(view.day.map((row) => row.id)).toEqual(['v1'])
    expect(view.tomorrow.map((row) => row.id)).toEqual(['t1'])
  })

  it('reads a cached bundle that has no tomorrow yet', () => {
    const cached = bundle()
    delete (cached as Partial<HomeDashboardBundle>).tomorrowOnSite
    expect(buildTodayView({ bundle: cached, now: at(20), lat: LAT, lon: LON }).tomorrow).toEqual([])
  })

  it('builds the weather line from the temperature, the sky and the work window', () => {
    const view = buildTodayView({
      bundle: bundle(),
      now: at(6, 40),
      weather: { tempF: 71.4, code: 2, window: { status: 'go', label: 'Clear to work until 3 pm' } }
    })
    expect(view.weatherLine).toBe('71° and partly cloudy. Clear to work until 3 pm.')
  })
})

describe('weatherLine', () => {
  it('leaves out what it does not know', () => {
    expect(weatherLine({ tempF: null, code: 0, window: { status: 'go', label: 'Clear to work all day' } })).toBe('Clear. Clear to work all day.')
    expect(weatherLine({ tempF: 58, code: null, window: { status: 'stop', label: '' } })).toBe('58°.')
    expect(weatherLine(null)).toBeNull()
  })
})

// Open Meteo as getWeather returns it, trimmed to what Today reads.
function forecast({ rainFrom }: { rainFrom?: number } = {}) {
  const hours = Array.from({ length: 48 }, (_, i) => i)
  const time = hours.map((i) => `2026-10-${String(8 + Math.floor(i / 24)).padStart(2, '0')}T${String(i % 24).padStart(2, '0')}:00`)
  return {
    current: { time: '2026-10-08T06:45', temperature_2m: 71, weather_code: 2, precipitation: 0, wind_speed_10m: 5, relative_humidity_2m: 50 },
    hourly: {
      time,
      temperature_2m: hours.map(() => 68),
      precipitation: hours.map((i) => (rainFrom != null && i % 24 >= rainFrom ? 0.3 : 0)),
      precipitation_probability: hours.map(() => 10),
      wind_speed_10m: hours.map(() => 5),
      relative_humidity_2m: hours.map(() => 50),
      weather_code: hours.map((i) => (i === 36 ? 0 : 2))
    },
    daily: { time: ['2026-10-08', '2026-10-09'], temperature_2m_max: [74, 67.6], temperature_2m_min: [52, 50] }
  }
}

describe('forecastWindow and todayWeather', () => {
  it('says how long the window holds today', () => {
    expect(forecastWindow(forecast({ rainFrom: 15 }), ['concrete'])).toEqual({ status: 'go', label: 'Clear to work until 3 pm' })
  })

  it('says all day when nothing changes before midnight', () => {
    expect(forecastWindow(forecast(), ['Concrete'])).toEqual({ status: 'go', label: 'Clear to work all day' })
  })

  it('reads the current conditions', () => {
    expect(todayWeather(forecast({ rainFrom: 15 }), ['concrete'])).toEqual({
      tempF: 71,
      code: 2,
      window: { status: 'go', label: 'Clear to work until 3 pm' }
    })
    expect(todayWeather(null, [])).toBeNull()
    expect(todayWeather({}, [])).toBeNull()
  })
})

describe('tomorrowLine', () => {
  // Built inside each test, after the time zone is set.
  const tomorrowStops = () => [
    visit('t1', 'job-1', at(9, 0, 1), at(10, 0, 1), { title: 'Final slab inspection' }),
    visit('t2', 'job-2', at(13, 0, 1), at(14, 0, 1), { title: 'Castellanos site measure' }),
    visit('t3', 'job-3', at(15, 0, 1), at(16, 0, 1), { title: 'Walkthrough' })
  ]

  it('gives the weather and the first two stops', () => {
    expect(tomorrowLine(tomorrowStops().slice(0, 2), forecast())).toBe('Tomorrow 68° and clear. Final slab inspection at 9:00, then Castellanos site measure at 1:00.')
  })

  it('counts the rest', () => {
    expect(tomorrowLine(tomorrowStops(), null)).toBe('Tomorrow, Final slab inspection at 9:00, then Castellanos site measure at 1:00, and 1 more.')
  })

  it('says when tomorrow is clear', () => {
    expect(tomorrowLine([], forecast())).toBe('Tomorrow 68° and clear. Nothing on the schedule.')
    expect(tomorrowLine([], null)).toBe('Nothing on the schedule tomorrow.')
  })
})

describe('answerCopy', () => {
  const now = at(8)

  it('turns an overdue invoice into a sentence with money in cents', () => {
    const copy = answerCopy(action(1, {
      kind: 'inv-overdue',
      contactName: 'Delgado',
      contactAmount: 1240,
      dueIso: at(8, 0, -6).toISOString(),
      urgencyTone: 'danger',
      title: 'Invoice 6d past due',
      detail: 'Concrete steps - $1,240 - Delgado'
    }), now)
    expect(copy).toEqual({ title: 'Delgado invoice is 6 days overdue', subline: '$1,240.00, due Oct 2', actionLabel: 'Remind', dot: 'danger' })
  })

  it('nudges a quote that was read and not answered', () => {
    const copy = answerCopy(action(2, {
      kind: 'viewed-quiet',
      contactName: 'Okafor',
      contactAmount: 3180,
      dueIso: at(8, 0, -4).toISOString(),
      urgencyTone: 'warn'
    }), now)
    expect(copy).toEqual({ title: 'Okafor opened the quote, no reply', subline: '$3,180.00, viewed 4 days ago', actionLabel: 'Nudge', dot: 'neutral' })
  })

  it('replies to quote changes with the customer note', () => {
    const copy = answerCopy(action(3, {
      kind: 'quote-changes',
      contactName: 'Taylor Reed',
      detail: 'Please separate the cabinet allowance.',
      urgencyTone: 'danger'
    }), now)
    expect(copy).toMatchObject({ title: 'Taylor Reed asked for quote changes', subline: 'Please separate the cabinet allowance.', actionLabel: 'Reply' })
  })

  it('maps every kind to one of the mini actions and every tone to a dot', () => {
    const labels = (['followup', 'followup-due', 'viewed-quiet', 'quote-changes', 'co-unsigned', 'reschedule', 'invoice', 'inv-overdue'] as const)
      .map((kind) => answerCopy(action(4, { kind }), now).actionLabel)
    expect(labels).toEqual(['Nudge', 'Nudge', 'Nudge', 'Reply', 'Nudge', 'Schedule', 'Remind', 'Remind'])
    expect(answerCopy(action(5, { urgencyTone: 'success' }), now).dot).toBe('info')
    expect(answerCopy(action(5, { urgencyTone: 'danger' }), now).dot).toBe('danger')
    expect(answerCopy(action(5, { urgencyTone: 'warn' }), now).dot).toBe('neutral')
  })

  it('writes no dashes of its own', () => {
    for (const kind of ['followup', 'followup-due', 'viewed-quiet', 'co-unsigned', 'reschedule', 'invoice', 'inv-overdue'] as const) {
      const copy = answerCopy(action(6, { kind, contactAmount: 500, detail: 'x - y' }), now)
      expect(`${copy.title} ${copy.subline}`).not.toMatch(/[-–—]/)
    }
  })
})

describe('stopTime and navigateHref', () => {
  it('splits a start into the time and am or pm', () => {
    expect(stopTime(at(7, 30).toISOString())).toEqual({ time: '7:30', suffix: 'am' })
    expect(stopTime(at(13, 5).toISOString())).toEqual({ time: '1:05', suffix: 'pm' })
    expect(stopTime(null)).toBeNull()
  })

  it('opens Apple Maps on an iPhone and Google Maps elsewhere', () => {
    const iphone = 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15'
    const android = 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36'
    expect(navigateHref('412 Burkitt Station Rd', iphone)).toBe('https://maps.apple.com/?daddr=412%20Burkitt%20Station%20Rd')
    expect(navigateHref('412 Burkitt Station Rd', android)).toBe('https://www.google.com/maps/dir/?api=1&destination=412%20Burkitt%20Station%20Rd')
    // iPadOS reports a Mac, with touch.
    expect(navigateHref('A & B', 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)).toBe('https://maps.apple.com/?daddr=A%20%26%20B')
  })
})

describe('weekBounds and weekStrip', () => {
  const row = (start: Date | null) => ({ start_at: start ? start.toISOString() : null })

  it('runs Sunday to the next Sunday around today, as the desktop Schedule does', () => {
    const { start, end } = weekBounds(at(6, 40))
    expect(start.getFullYear()).toBe(2026)
    expect([start.getMonth(), start.getDate(), start.getHours()]).toEqual([9, 4, 0])
    expect([end.getMonth(), end.getDate(), end.getHours()]).toEqual([9, 11, 0])
  })

  it('has seven days, Sunday to Saturday, with today marked once', () => {
    const days = weekStrip([], at(6, 40))
    expect(days.map((d) => d.weekday)).toEqual(['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'])
    expect(days.map((d) => d.dayOfMonth)).toEqual([4, 5, 6, 7, 8, 9, 10])
    expect(days.filter((d) => d.today).map((d) => d.weekday)).toEqual(['Thu'])
    expect(days.map((d) => d.key)).toEqual(['2026-10-04', '2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-10'])
  })

  it('counts the visits on each local day and ignores other weeks and rows with no start', () => {
    const days = weekStrip(
      [
        row(at(7, 30)),
        row(at(13, 30)),
        row(at(23, 50)),
        row(at(9, 0, 1)),
        row(at(9, 0, -5)),
        row(at(9, 0, 3)),
        row(null)
      ],
      at(6, 40)
    )
    expect(days.map((d) => d.count)).toEqual([0, 0, 0, 0, 3, 1, 0])
  })

  it('puts a late night visit on the day it starts in local time, not in UTC', () => {
    const days = weekStrip([row(at(21, 30))], at(6, 40))
    expect(days.find((d) => d.today)?.count).toBe(1)
    expect(days.find((d) => d.key === '2026-10-09')?.count).toBe(0)
  })

  it('words each day for a screen reader and for the cell', () => {
    const days = weekStrip([row(at(7, 30)), row(at(9, 0, 1)), row(at(13, 0, 1))], at(6, 40))
    const thu = days.find((d) => d.today)
    expect(thu?.label).toBe('Thursday, October 8, today, 1 visit')
    expect(thu?.countText).toBe('1 visit')
    const fri = days.find((d) => d.key === '2026-10-09')
    expect(fri?.label).toBe('Friday, October 9, 2 visits')
    expect(fri?.countText).toBe('2 visits')
    const sat = days.find((d) => d.key === '2026-10-10')
    expect(sat?.label).toBe('Saturday, October 10, no visits')
    expect(sat?.countText).toBe('None')
  })

  it('writes no dashes of its own', () => {
    for (const day of weekStrip([row(at(7, 30))], at(6, 40))) {
      expect(day.label).not.toMatch(/[-\u2013\u2014]/)
      expect(day.countText).not.toMatch(/[-\u2013\u2014]/)
    }
  })

  it('starts the week on Sunday when today is Sunday and ends it on Saturday when today is Saturday', () => {
    const sunday = weekStrip([], new Date(2026, 9, 4, 8))
    expect(sunday[0].today).toBe(true)
    const saturday = weekStrip([], new Date(2026, 9, 10, 8))
    expect(saturday[6].today).toBe(true)
    expect(saturday[0].dayOfMonth).toBe(4)
  })
})
