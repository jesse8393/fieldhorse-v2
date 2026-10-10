#!/usr/bin/env node
// Side by side review images for the redesign (Phase 2 plan Task 14 and
// the review task that closes each later phase): our build on the left,
// the approved render on the right, both scaled to the same height, one
// PNG per screen and theme.
//
// It starts nothing itself. Run the dev server against the mocked
// Supabase project first (the env in playwright.config.ts webServer):
//
//   VITE_SUPABASE_URL=https://qa-mock.supabase.co \
//   VITE_SUPABASE_ANON_KEY=<the mock key in playwright.config.ts> npm run dev
//   node scripts/compare-renders.mjs
//
// Env: BASE_URL (default http://127.0.0.1:5173), PHASE (a phase number,
// to capture only that phase's shots; writes to phase<N>-review),
// OUT_DIR (override the output folder; without PHASE it defaults to
// final-review), PW_EXECUTABLE_PATH to use a specific Chromium binary,
// ONLY to capture a comma separated subset by name.
//
// The mock has no job photos, so job c-job1 gets a placeholder: the slab
// cut from the g-job render, served through a mocked storage bucket. It
// shows where photos land and how they are framed, not real content.
// Callbacks passed to the page run in the browser.
/* global document, localStorage, window */
import { mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { chromium } from '@playwright/test'
import sharp from 'sharp'
import { installMock, session } from './qa-mock.mjs'

const ROOT = join(import.meta.dirname, '..')
const RENDERS = join(ROOT, 'docs/design/2026-10-redesign')
const PHASE = process.env.PHASE ? Number(process.env.PHASE) : null
const OUT = process.env.OUT_DIR || join(RENDERS, PHASE ? `phase${PHASE}-review` : 'final-review')
const BASE = process.env.BASE_URL || 'http://127.0.0.1:5173'
const ONLY = process.env.ONLY ? new Set(process.env.ONLY.split(',')) : null

// The renders are set in Murfreesboro, so the clock and the sun follow it.
const TIMEZONE = 'America/Chicago'
const LAT = 35.84
const LON = -86.36

const PHONE = { width: 390, height: 844, scale: 2, mobile: true, outHeight: 1200 }
const DESKTOP = { width: 1440, height: 900, scale: 1, mobile: false, outHeight: 900 }

// One entry per image. Fields: name, phase, title, path, mode (day or
// night), clock ([hour, minute] local), render (a file under the design
// folder), view (PHONE by default), action (a named step in `steps`),
// tables (a function from the frozen clock to extra mock tables), public
// (a signed out screen: `setup(context)` mocks it, `ready` is the selector
// to wait for).
const SHOTS = [
  { phase: 2, name: 'today-day', path: '/', mode: 'day', render: 'glamor/g-today.jpg' },
  { phase: 2, name: 'today-night', path: '/', mode: 'night', render: 'glamor/g-today.jpg' },
  { phase: 2, name: 'evening-night', path: '/', mode: 'night', clock: [19, 40], render: 'base/night.jpg' },
  { phase: 2, name: 'jobs-day', path: '/work', mode: 'day', render: 'base/jobs.jpg' },
  { phase: 2, name: 'jobs-night', path: '/work', mode: 'night', render: 'base/jobs.jpg' },
  { phase: 2, name: 'job-day', path: '/jobs/c-job1', mode: 'day', render: 'glamor/g-job.jpg' },
  { phase: 2, name: 'job-night', path: '/jobs/c-job1', mode: 'night', render: 'glamor/g-job.jpg' },
  { phase: 2, name: 'capture-day', path: '/', mode: 'day', action: 'capture', render: 'base/capture.jpg' },
  { phase: 2, name: 'capture-night', path: '/', mode: 'night', action: 'capture', render: 'base/capture.jpg' },
  { phase: 3, name: 'money-day', path: '/invoices', mode: 'day', render: 'glamor/g-money.jpg', tables: moneyTables },
  { phase: 3, name: 'money-night', path: '/invoices', mode: 'night', render: 'glamor/g-money.jpg', tables: moneyTables },
  { phase: 3, name: 'quote-day', path: '/quotes/c-quote?tab=quote', mode: 'day', render: 'glamor/g-quote.jpg', tables: quoteTables },
  { phase: 3, name: 'quote-night', path: '/quotes/c-quote?tab=quote', mode: 'night', render: 'glamor/g-quote.jpg', tables: quoteTables },
  { phase: 4, name: 'schedule-day', title: 'Schedule, Day', path: '/schedule', mode: 'day', view: DESKTOP, weekday: 4, clock: [9, 0], render: 'base/desktop-schedule.jpg', tables: weekTables },
  { phase: 4, name: 'deskhome-day', title: 'Today on a desktop, Day', path: '/', mode: 'day', view: DESKTOP, weekday: 4, render: 'glamor/g-today.jpg' },
  { phase: 4, name: 'deskmoney-day', title: 'Money on a desktop, Day', path: '/invoices', mode: 'day', view: DESKTOP, weekday: 4, render: 'glamor/g-money.jpg', tables: moneyTables },
  { phase: 4, name: 'deskjob-day', title: 'Job, Day', path: '/jobs/c-job1', mode: 'day', view: DESKTOP, weekday: 4, render: 'glamor/g-desktop-job.jpg' },
  { phase: 4, name: 'palette-day', title: 'Command palette, Day', path: '/schedule', mode: 'day', view: DESKTOP, weekday: 4, clock: [9, 0], action: 'palette', render: 'base/desktop-command.jpg', tables: paletteTables },
  { phase: 6, name: 'thread-day', title: 'Inbox thread, Day', path: '/inbox/conv-priya', mode: 'day', clock: [8, 20], render: 'base/inbox.jpg', tables: inboxTables },
  { phase: 6, name: 'thread-night', title: 'Inbox thread, Night', path: '/inbox/conv-priya', mode: 'night', clock: [8, 20], render: 'base/inbox.jpg', tables: inboxTables },
  { phase: 5, name: 'portal-day', path: '/p/t1', mode: 'day', public: true, ready: 'h1', setup: portalSetup, render: 'glamor/g-portal.jpg' },
  { phase: 5, name: 'portal-approve-day', title: 'Portal, end of page, Day', path: '/p/t1', mode: 'day', public: true, ready: 'h1', setup: portalSetup, action: 'scrollEnd', render: 'glamor/g-portal.jpg' },
  { phase: 5, name: 'portal-night', path: '/p/t1', mode: 'night', public: true, ready: 'h1', setup: portalSetup, render: 'glamor/g-portal.jpg' },
  { phase: 5, name: 'login-none', title: 'Login, no photo', path: '/login', mode: 'day', public: true, ready: '.fha', setup: loginSetup(false), render: 'glamor/g-welcome.jpg' },
  { phase: 5, name: 'login-photo', title: 'Login, with a photo', path: '/login', mode: 'day', public: true, ready: '.fha', setup: loginSetup(true), render: 'glamor/g-welcome.jpg' }
]

// Phase 6 Inbox: the engine is on, and Priya's thread has the render's
// words, with the AI draft waiting. Times are relative to the frozen day
// (yesterday 4:48 pm and 5:02 pm, today 8:14 am).
function inboxTables(clock) {
  const at = (minutes) => new Date(clock.getTime() + minutes * 60e3).toISOString()
  const yesterdayFour48 = -(13 * 60 + 52)
  const message = (props) => ({
    org_id: 'org-1', conversation_id: 'conv-priya', client_id: 'cl-priya', channel: 'sms', subject: null,
    status: 'received', read_at: null, hold_reason: null, sent_by_kind: 'contact', agent_run_id: null,
    sent_at: null, call_status: null, direction: 'inbound', ...props
  })
  const conversation = (props) => ({
    org_id: 'org-1', company_name: null, last_channel: 'sms', unread_count: 0, pending_drafts: 0, held_messages: 0,
    starred: false, status: 'open', snoozed_until: null, email: null, phone: '555-0142', ...props
  })
  const ask = 'Can we push to 11:30? Daycare pickup ran long. Also wanted to ask about adding a ceiling fan in the patio cover.'
  return {
    fh_org_settings: [{ engine_enabled: true }],
    fh_v_inbox: [
      conversation({ conversation_id: 'conv-priya', client_id: 'cl-priya', client_name: 'Priya Rangarajan', last_preview: ask, last_message_at: at(94), unread_count: 1, pending_drafts: 1, latest_stage: 'quote' }),
      conversation({ conversation_id: 'conv-marcus', client_id: 'cl-marcus', client_name: 'Marcus Bell', last_preview: 'Thanks, the crew did great work.', last_message_at: at(-(10 * 60)), latest_stage: 'job', last_channel: 'email', email: 'marcus@example.com' }),
      conversation({ conversation_id: 'conv-tessa', client_id: 'cl-tessa', client_name: 'Tessa Holloway', last_preview: 'We can start Monday if the weather holds.', last_message_at: at(-(3 * 1440)), held_messages: 1, latest_stage: 'lead' })
    ],
    fh_messages: [
      message({ id: 'm1', direction: 'outbound', status: 'sent', sent_by_kind: 'user', read_at: at(yesterdayFour48), created_at: at(yesterdayFour48), body: "Hi Priya, Jesse with Parker Construction. We're set for Thursday at 11:00 to look at the patio cover. I'll bring material samples." }),
      message({ id: 'm2', created_at: at(yesterdayFour48 + 14), read_at: at(yesterdayFour48 + 17), body: 'Perfect, thank you!' }),
      message({ id: 'm3', created_at: at(94), body: ask })
    ],
    fh_agent_runs: [
      { id: 'run-1', org_id: 'org-1', conversation_id: 'conv-priya', client_id: 'cl-priya', agent_id: 'agent-1', status: 'proposed', created_at: at(95), proposal: { channel: 'sms', body: "Of course, 11:30 works. I'll bring a fan option so we can see where the power run would go. See you then." } }
    ],
    fh_contacts: [
      { id: 'c-priya', user_id: session.user.id, client_id: 'cl-priya', stage: 'quote', name: 'Priya Rangarajan', job_title: 'Rangarajan patio cover', amount: 14800, updated_at: at(-1440), created_at: at(-14 * 1440), proposal_status: 'sent', fh_clients: { name: 'Priya Rangarajan', phone: '555-0142', email: null } }
    ]
  }
}

// Phase 3 money screen: an overdue invoice, two due soon, a sent and a
// viewed quote, and payments this week and last, all relative to the
// frozen morning so the groups fill the same way on any day.
function moneyTables(clock) {
  const day = (offset) => {
    const d = new Date(clock.getTime() + offset * 86400e3)
    const parts = Object.fromEntries(
      new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit' })
        .formatToParts(d).map((p) => [p.type, p.value])
    )
    return `${parts.year}-${parts.month}-${parts.day}`
  }
  const at = (offset) => new Date(clock.getTime() + offset * 86400e3).toISOString()
  const client = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' }
  const contact = (p) => ({
    user_id: session.user.id, client_id: 'cl-1', phone: '555-0101', email: 'x@y.com', address: '412 Burkitt Station Rd',
    notes: null, scope_text: null, milestones: [], created_at: at(-30), updated_at: at(-5), proposal_status: null,
    follow_up_on: null, completed_at: null, invoice_no: null, cost: null, fh_clients: client, ...p
  })
  const invoice = (p) => ({
    user_id: session.user.id, description: null, notes: null, status: 'sent', sequence_number: 1,
    issued_at: at(-12), created_at: at(-12), updated_at: at(-12), ...p
  })
  const payment = (p) => ({ user_id: session.user.id, method: 'check', reference: null, invoice_id: null, kind: null, ...p })
  return {
    fh_contacts: [
      contact({ id: 'c-rosa', stage: 'job', name: 'Rosa Delgado', email: 'rosa@example.com', job_title: 'Concrete steps', amount: 8000 }),
      contact({ id: 'c-lorraine', stage: 'job', name: 'Lorraine Beasley', job_title: 'Bath retile', amount: 9000 }),
      contact({ id: 'c-gail', stage: 'job', name: 'Gail Abernathy', job_title: 'Roof repair', amount: 6000 }),
      contact({ id: 'c-darnell', stage: 'closed', name: 'Darnell Whitcomb', job_title: 'Garage slab', amount: 9600, cost: 6960, completed_at: at(-9) }),
      contact({ id: 'c-marco', stage: 'quote', name: 'Marco Castellanos', job_title: 'Pool deck pour', amount: 18458, proposal_status: 'sent', quote_sent_at: at(-1) }),
      contact({ id: 'c-chidi', stage: 'quote', name: 'Chidi Okafor', job_title: 'Ridge vent and shingle repair', amount: 3180, proposal_status: 'viewed', quote_sent_at: at(-4) })
    ],
    fh_invoices: [
      invoice({ id: 'i-rosa', contact_id: 'c-rosa', title: 'Final', amount: 1240, sequence_number: 2, due_at: day(-6) }),
      invoice({ id: 'i-lorraine', contact_id: 'c-lorraine', title: 'Final balance', amount: 4850, due_at: day(1) }),
      invoice({ id: 'i-gail', contact_id: 'c-gail', title: 'Balance', amount: 2960, due_at: day(5) }),
      invoice({ id: 'i-paid', contact_id: 'c-darnell', title: 'Deposit', amount: 6187.5, status: 'paid', due_at: day(-9) })
    ],
    fh_payments: [
      payment({ id: 'p-dep', contact_id: 'c-darnell', amount: 6187.5, paid_on: day(-8), kind: 'deposit', invoice_id: 'i-paid', created_at: at(-8) }),
      payment({ id: 'p-gail', contact_id: 'c-gail', amount: 620, paid_on: day(-4), created_at: at(-4) }),
      payment({ id: 'p-rosa', contact_id: 'c-rosa', amount: 3000, paid_on: day(-2), created_at: at(-2) })
    ]
  }
}

// Phase 3 quote editor: the render's pool deck quote. Five base lines and
// one optional upgrade on the sent quote contact c-quote.
function quoteTables(clock) {
  const at = new Date(clock.getTime() - 86400e3).toISOString()
  const item = (id, description, over = {}) => ({
    id, user_id: session.user.id, contact_id: 'c-quote', section: null, description, qty: 1, unit: null,
    rate: 0, amount: 0, notes: null, is_optional: false, is_excluded: false, sort_order: 0,
    created_at: at, updated_at: at, ...over
  })
  return {
    fh_quote_items: [
      item('qi1', 'Excavate and grade', { qty: 1100, unit: 'sq ft', rate: 2, amount: 2200, sort_order: 0 }),
      item('qi2', 'Rebar, #4 at 18 in on center', { qty: 1100, unit: 'sq ft', rate: 2.6, amount: 2860, sort_order: 1 }),
      item('qi3', '4 in slab, 4,000 psi fiber mix', { qty: 1100, unit: 'sq ft', rate: 8.5, amount: 9350, notes: 'broom finish', sort_order: 2 }),
      item('qi4', 'Expansion and control joints', { qty: 160, unit: 'lf', rate: 4, amount: 640, sort_order: 3 }),
      item('qi5', 'Pump truck', { qty: 1, unit: 'day', rate: 950, amount: 950, sort_order: 4 }),
      item('qi6', 'Stamped ashlar, charcoal release', { qty: 1, rate: 4950, amount: 4950, is_optional: true, sort_order: 5 })
    ]
  }
}

// Phase 4 desktop schedule: a working week of visits around a Thursday,
// and three jobs with no visit yet for the Unscheduled tray. `clock` is
// the frozen Thursday, so offsets are in days from it.
function weekTables(clock) {
  const at = (days, hour, minute = 0) => {
    const d = new Date(clock.getTime() + days * 86400e3)
    d.setTime(d.getTime() + ((hour * 60 + minute) - (6 * 60 + 40)) * 60e3)
    return d.toISOString()
  }
  const client = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' }
  const contact = (p) => ({
    user_id: session.user.id, client_id: 'cl-1', phone: '555-0101', email: 'x@y.com', address: '2210 Ridgecrest Dr',
    notes: null, scope_text: null, milestones: [], created_at: at(-30, 9), updated_at: at(-5, 9), proposal_status: null,
    follow_up_on: null, completed_at: null, invoice_no: null, cost: null, client_name: client.name, fh_clients: client, ...p
  })
  const visit = (id, contactId, title, days, from, to) => ({
    id, user_id: session.user.id, contact_id: contactId, title, description: null,
    start_at: at(days, ...from), end_at: at(days, ...to), created_at: at(-14, 9)
  })
  return {
    fh_contacts: [
      contact({ id: 'c-job1', stage: 'job', name: 'Darnell Whitcomb', job_title: 'Whitcomb garage slab', amount: 12375 }),
      contact({ id: 'c-job2', stage: 'job', name: 'Lorraine Beasley', job_title: 'Beasley bath retile', amount: 9700 }),
      contact({ id: 'c-job3', stage: 'job', name: 'Anya Kowalczyk', job_title: 'Kowalczyk covered patio', amount: 27800 }),
      contact({ id: 'c-job4', stage: 'job', name: 'Chidi Okafor', job_title: 'Okafor ridge vent repair', amount: 3180 }),
      contact({ id: 'c-job5', stage: 'job', name: 'Hollis Tran', job_title: 'Tran fence and gate', amount: 5400 }),
      contact({ id: 'c-quote', stage: 'quote', name: 'Marco Castellanos', job_title: 'Castellanos pool deck', amount: 18458, proposal_status: 'sent' }),
      contact({ id: 'c-lead1', stage: 'lead', name: 'Priya Rangarajan', job_title: 'Rangarajan patio cover', amount: 6200 })
    ],
    fh_schedule: [
      visit('w1', 'c-job2', 'Beasley bath retile', -3, [8, 0], [16, 0]),
      visit('w2', 'c-job2', 'Beasley bath retile', -2, [8, 0], [13, 0]),
      visit('w3', 'c-job1', 'Whitcomb garage slab', -1, [7, 0], [14, 0]),
      visit('w4', 'c-job1', 'Whitcomb inspection', -1, [16, 0], [17, 0]),
      visit('w5', 'c-job1', 'Whitcomb garage slab', 0, [7, 30], [10, 30]),
      visit('w6', 'c-lead1', 'Rangarajan patio cover', 0, [11, 30], [12, 30]),
      visit('w7', 'c-job2', 'Beasley walkthrough', 0, [14, 30], [15, 30]),
      visit('w8', 'c-job1', 'Whitcomb final inspection', 1, [9, 0], [9, 30]),
      visit('w9', 'c-quote', 'Castellanos pool deck', 1, [13, 0], [14, 0])
    ]
  }
}

// The palette shot: the mock ignores search filters, so keep only the one
// job the search typed in the shot would find, and its visits.
function paletteTables(clock) {
  const week = weekTables(clock)
  return {
    fh_contacts: week.fh_contacts.filter((c) => c.id === 'c-job1'),
    fh_schedule: week.fh_schedule.filter((v) => v.contact_id === 'c-job1')
  }
}

// Named steps that run after the page has loaded.
const STEPS = {
  // The end of the page, where the portal's approve capsule sits.
  async scrollEnd(page) {
    await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight))
    await page.waitForTimeout(600)
  },
  async capture(page) {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: /Capture/ }).click()
    await page.waitForTimeout(900)
    await page.getByRole('dialog').getByRole('textbox').first()
      .fill('Remind me to call the inspector tomorrow morning about the Bellevue slab final.')
    await page.getByRole('button', { name: 'File it' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).waitFor({ timeout: 15_000 })
    await page.waitForTimeout(500)
  },
  async palette(page) {
    await page.keyboard.press('Control+K')
    await page.getByRole('dialog').getByRole('combobox').fill('whit')
    await page.waitForTimeout(900)
  }
}

// A date in Murfreesboro at a given local time, as an instant. By default
// it is today; `weekday` (0 is Sunday) picks the most recent such day, so
// the desktop schedule can be shot on a Thursday as the render is.
function localInstant([hour, minute], weekday = null) {
  const target = new Date()
  if (weekday !== null) {
    const name = new Intl.DateTimeFormat('en-US', { timeZone: TIMEZONE, weekday: 'short' }).format(target)
    const today = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(name)
    target.setTime(target.getTime() - ((today - weekday + 7) % 7) * 86400e3)
  }
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'longOffset'
    }).formatToParts(target).map((p) => [p.type, p.value])
  )
  const offset = parts.timeZoneName.replace('GMT', '') || '+00:00'
  const hh = String(hour).padStart(2, '0')
  const mm = String(minute).padStart(2, '0')
  return new Date(`${parts.year}-${parts.month}-${parts.day}T${hh}:${mm}:00${offset}`)
}

// A calm October forecast: 71 degrees, partly cloudy, dry, light wind.
function forecast(start) {
  const hours = Array.from({ length: 7 * 24 }, (_, i) => {
    const t = new Date(start.getTime() + i * 3600e3)
    return t.toISOString().slice(0, 13) + ':00'
  })
  const days = Array.from({ length: 7 }, (_, i) => new Date(start.getTime() + i * 86400e3).toISOString().slice(0, 10))
  return {
    latitude: LAT,
    longitude: LON,
    current: {
      time: hours[0], temperature_2m: 71, relative_humidity_2m: 52, precipitation: 0,
      wind_speed_10m: 6, weather_code: 2, is_day: 1
    },
    hourly: {
      time: hours,
      temperature_2m: hours.map(() => 71),
      precipitation_probability: hours.map(() => 5),
      precipitation: hours.map(() => 0),
      wind_speed_10m: hours.map(() => 6),
      relative_humidity_2m: hours.map(() => 52),
      weather_code: hours.map(() => 2)
    },
    daily: {
      time: days,
      temperature_2m_max: days.map(() => 74),
      temperature_2m_min: days.map(() => 52),
      precipitation_probability_max: days.map(() => 5),
      precipitation_sum: days.map(() => 0),
      wind_speed_10m_max: days.map(() => 9)
    }
  }
}

// Mock rows that put the renders' day on the schedule: three stops, the
// first a pour at 7:30, relative to the frozen clock.
function scheduleFor(clock) {
  const at = (h, m) => {
    const d = new Date(clock)
    d.setTime(clock.getTime() + ((h * 60 + m) - (6 * 60 + 40)) * 60e3)
    return d.toISOString()
  }
  const stop = (id, contactId, title, start, end) => ({
    id, user_id: session.user.id, contact_id: contactId, title, description: null,
    start_at: at(...start), end_at: at(...end), created_at: at(0, 0)
  })
  return [
    stop('s1', 'c-job1', 'Pour slab, crew A', [7, 30], [11, 30]),
    stop('s2', 'c-job2', 'Final walk', [12, 30], [13, 30]),
    stop('s3', 'c-quote', 'Site visit', [15, 0], [16, 0]),
    stop('s4', 'c-job1', 'Final slab inspection', [24 + 9, 0], [24 + 10, 0])
  ]
}

// The stand-in job photo: the slab from the g-job render, without the
// render's buttons and text.
const STAND_IN = await sharp(join(RENDERS, 'glamor/g-job.jpg'))
  .extract({ left: 250, top: 160, width: 560, height: 235 })
  .jpeg({ quality: 88 })
  .toBuffer()

// Stand ins for the two photos the renders show. The app ships neither:
// the portal cover is the job's own first photo, and decision D11 says
// Welcome and Login show onyx until a real photo is supplied.
const PORTAL_COVER = await sharp(join(RENDERS, 'glamor/g-portal.jpg'))
  .extract({ left: 180, top: 135, width: 670, height: 220 })
  .resize(1340, 440)
  .jpeg({ quality: 88 })
  .toBuffer()
const WELCOME_PHOTO = await sharp(join(RENDERS, 'glamor/g-welcome.jpg'))
  .extract({ left: 175, top: 45, width: 675, height: 740 })
  .jpeg({ quality: 88 })
  .toBuffer()

// Public screens have no sign in. Nothing may reach Supabase.
async function blockSupabase(context) {
  await context.route(/supabase\.co/, (route) => route.abort())
}

// The customer quote page for token t1, with the render's numbers.
async function portalSetup(context) {
  await blockSupabase(context)
  const line = (id, section, description, amount, extra = {}) => ({
    id, section, description, qty: 1, rate: amount, amount, is_optional: false, is_excluded: false, sort_order: Number(id.slice(1)), ...extra
  })
  const payload = {
    ok: true,
    kind: 'proposal',
    contact: {
      id: 'c-portal', name: 'Marco Castellanos', address: '1150 Cherry Blossom Ln, La Vergne', phone: '615 555 0101',
      email: 'marco@example.com', job_title: 'Pool deck pour', stage: 'quote', proposal_status: 'sent', amount: 18458,
      created_at: '2026-10-01T12:00:00.000Z', quote_sent_at: '2026-10-02T12:00:00.000Z', terms_text: ''
    },
    company: {
      name: 'Parker Construction', phone: '615 555 0100', email: 'office@parker.co',
      insured_text: 'Licensed and insured, Murfreesboro', license_number: '', logo_url: null,
      estimate_template: 'fieldhorse', payment_link: ''
    },
    items: [
      line('i1', 'Site', 'Excavate and grade, 1,100 sq ft', 2200),
      line('i2', 'Steel', 'Rebar, #4 at 18 in on center', 2860),
      line('i3', 'Concrete', '4 in slab, 4,000 psi fiber mix, broom finish', 9350),
      line('i4', 'Finish', 'Joints, pump truck and haul off', 2370),
      line('i5', 'Finish', 'Overhead and profit, 10%', 1678),
      line('i6', 'Finish', 'Stamped ashlar pattern', 4950, { is_optional: true })
    ],
    payments: [],
    changeOrders: [],
    insurance: null,
    invoices: [],
    photos: [{ url: 'https://img.example.com/cover.jpg' }]
  }
  await context.route((u) => u.pathname === '/api/public-link', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(payload) }))
  await context.route('https://img.example.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'image/jpeg', body: PORTAL_COVER }))
}

// Login, signed out. The shell asks for /welcome.jpg once; answer with a
// photo or a 404.
function loginSetup(withPhoto) {
  return async (context) => {
    await blockSupabase(context)
    await context.route('**/welcome.jpg', (route) => withPhoto
      ? route.fulfill({ status: 200, contentType: 'image/jpeg', body: WELCOME_PHOTO })
      : route.fulfill({ status: 404, contentType: 'text/plain', body: 'not found' }))
  }
}

function photoRows(clock) {
  const ago = (minutes) => new Date(clock.getTime() - minutes * 60e3).toISOString()
  const recent = [28, 32, 36].map((m, i) => ({
    id: `p${i}`, job_id: 'c-job1', kind: 'photo', storage_path: `qa/c-job1/p${i}.jpg`, filename: `p${i}.jpg`,
    uploaded_at: ago(m), caption: i === 0 ? 'Forms and rebar in, inspector signed off.' : null
  }))
  const older = Array.from({ length: 11 }, (_, i) => ({
    id: `o${i}`, job_id: 'c-job1', kind: 'photo', storage_path: `qa/c-job1/o${i}.jpg`, filename: `o${i}.jpg`,
    uploaded_at: ago((i + 3) * 1440), caption: null
  }))
  return [...recent, ...older]
}

// Signed URLs for the job photos bucket, and the image behind them. The
// Today cover read embeds fh_job_files in fh_contacts, which the mock
// does not join, so that one request is answered here too.
async function mockPhotos(context, rows) {
  await context.route((u) => u.hostname === 'qa-mock.supabase.co', async (route) => {
    const req = route.request()
    const url = new URL(req.url())
    if (url.pathname.endsWith('/rest/v1/fh_contacts') && (url.searchParams.get('select') || '').includes('fh_job_files')) {
      const newest = rows[0]
      return route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify([{ id: 'c-job1', fh_job_files: [{ storage_path: newest.storage_path, uploaded_at: newest.uploaded_at }] }])
      })
    }
    if (url.pathname.endsWith('/storage/v1/object/sign/job-photos') && req.method() === 'POST') {
      const { paths = [] } = JSON.parse(req.postData() || '{}')
      const signed = paths.map((path) => ({ path, signedURL: `/object/sign/job-photos/${path}?token=qa`, error: null }))
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(signed) })
    }
    if (url.pathname.includes('/storage/v1/object/sign/job-photos/')) {
      return route.fulfill({ status: 200, contentType: 'image/jpeg', body: STAND_IN })
    }
    return route.fallback()
  })
}

// The capture model's answer for the typed sentence, so the sheet shows
// its confirm phase as the render does.
function captureReply(clock) {
  const tomorrow = new Date(clock.getTime() + 86400e3).toISOString().slice(0, 10)
  return {
    kind: 'todo',
    summary: 'Call the inspector about the slab final',
    text: 'Call the inspector about the slab final',
    job_id: 'c-job1',
    due_at: tomorrow,
    confidence: 0.9
  }
}

async function capture(browser, shot) {
  const clock = localInstant(shot.clock || [6, 40], shot.weekday ?? null)
  const view = shot.view || PHONE
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.scale,
    isMobile: view.mobile,
    hasTouch: view.mobile,
    timezoneId: TIMEZONE,
    serviceWorkers: 'block'
  })
  const morning = localInstant([6, 40], shot.weekday ?? null)
  if (shot.public) {
    await shot.setup(context)
    await context.addInitScript((mode) => localStorage.setItem('fh:theme-mode', mode), shot.mode)
  } else {
    const photos = photoRows(morning)
    await installMock(context, {
      supabaseHosts: ['qa-mock.supabase.co', 'pnmhblvslftdzfcdezbw.supabase.co'],
      tables: { fh_schedule: scheduleFor(morning), fh_job_files: photos, ...(shot.tables ? shot.tables(morning) : {}) }
    })
    await mockPhotos(context, photos)
    await context.route('**/api/claude', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(captureReply(clock)) }] })
    }))
    const weather = JSON.stringify(forecast(localInstant([0, 0], shot.weekday ?? null)))
    await context.route('https://api.open-meteo.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: weather }))
    await context.addInitScript(([saved, mode]) => {
      localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(saved))
      localStorage.setItem('fh:theme-mode', mode)
      localStorage.setItem('fh-onboarding-seen', '1')
    }, [session, shot.mode])
  }

  const page = await context.newPage()
  await page.clock.setFixedTime(clock)
  await page.goto(BASE + shot.path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator(shot.ready || '.fh-app').first().waitFor({ timeout: 30_000 })
  await page.waitForLoadState('load')
  await page.evaluate(() => document.fonts.ready)
  await page.waitForTimeout(1500)
  if (shot.action) await STEPS[shot.action](page)
  const png = await page.screenshot({ animations: 'disabled' })
  await context.close()
  return png
}

function label(text, width) {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="48">
    <style>text { font: 600 22px sans-serif; fill: #3D3830; }</style>
    <text x="0" y="32">${text}</text></svg>`
  return Buffer.from(svg)
}

async function sideBySide(ours, renderPath, title, HEIGHT) {
  const left = await sharp(ours).resize({ height: HEIGHT }).toBuffer({ resolveWithObject: true })
  const right = await sharp(renderPath).resize({ height: HEIGHT }).toBuffer({ resolveWithObject: true })
  const gap = 32
  const pad = 24
  const top = 56
  const width = pad + left.info.width + gap + right.info.width + pad
  return sharp({ create: { width, height: top + HEIGHT + pad, channels: 3, background: '#EDE7DC' } })
    .composite([
      { input: label(`${title}, our build`, left.info.width), left: pad, top: 4 },
      { input: label('Approved render', right.info.width), left: pad + left.info.width + gap, top: 4 },
      { input: left.data, left: pad, top },
      { input: right.data, left: pad + left.info.width + gap, top }
    ])
    .png({ palette: true, quality: 90, compressionLevel: 9 })
    .toBuffer()
}

const browser = await chromium.launch(process.env.PW_EXECUTABLE_PATH ? { executablePath: process.env.PW_EXECUTABLE_PATH } : {})
mkdirSync(OUT, { recursive: true })
try {
  for (const shot of SHOTS) {
    if (PHASE && shot.phase !== PHASE) continue
    if (ONLY && !ONLY.has(shot.name)) continue
    const ours = await capture(browser, shot)
    const [screen] = shot.name.split('-')
    const title = shot.title || `${screen[0].toUpperCase()}${screen.slice(1)}, ${shot.mode === 'day' ? 'Day' : 'Night'}`
    const out = join(OUT, `${shot.name}.png`)
    await sharp(await sideBySide(ours, join(RENDERS, shot.render), title, (shot.view || PHONE).outHeight)).toFile(out)
    console.log('wrote', out)
  }
} finally {
  await browser.close()
}
