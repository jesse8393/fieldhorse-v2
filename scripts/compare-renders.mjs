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
/* global document, localStorage */
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
// tables (a function from the frozen clock to extra mock tables).
const SHOTS = [
  { phase: 2, name: 'today-day', path: '/', mode: 'day', render: 'glamor/g-today.jpg' },
  { phase: 2, name: 'today-night', path: '/', mode: 'night', render: 'glamor/g-today.jpg' },
  { phase: 2, name: 'evening-night', path: '/', mode: 'night', clock: [19, 40], render: 'base/night.jpg' },
  { phase: 2, name: 'jobs-day', path: '/work', mode: 'day', render: 'base/jobs.jpg' },
  { phase: 2, name: 'jobs-night', path: '/work', mode: 'night', render: 'base/jobs.jpg' },
  { phase: 2, name: 'job-day', path: '/jobs/c-job1', mode: 'day', render: 'glamor/g-job.jpg' },
  { phase: 2, name: 'job-night', path: '/jobs/c-job1', mode: 'night', render: 'glamor/g-job.jpg' },
  { phase: 2, name: 'capture-day', path: '/', mode: 'day', action: 'capture', render: 'base/capture.jpg' },
  { phase: 2, name: 'capture-night', path: '/', mode: 'night', action: 'capture', render: 'base/capture.jpg' }
]

// Named steps that run after the page has loaded.
const STEPS = {
  async capture(page) {
    await page.getByRole('navigation', { name: 'Primary' }).getByRole('button', { name: /Capture/ }).click()
    await page.waitForTimeout(900)
    await page.getByRole('dialog').getByRole('textbox').first()
      .fill('Remind me to call the inspector tomorrow morning about the Bellevue slab final.')
    await page.getByRole('button', { name: 'File it' }).click()
    await page.getByRole('button', { name: 'Save', exact: true }).waitFor({ timeout: 15_000 })
    await page.waitForTimeout(500)
  }
}

// Today's date in Murfreesboro at a given local time, as an instant.
function localInstant([hour, minute]) {
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: TIMEZONE, year: 'numeric', month: '2-digit', day: '2-digit', timeZoneName: 'longOffset'
    }).formatToParts(new Date()).map((p) => [p.type, p.value])
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
  const clock = localInstant(shot.clock || [6, 40])
  const view = shot.view || PHONE
  const context = await browser.newContext({
    viewport: { width: view.width, height: view.height },
    deviceScaleFactor: view.scale,
    isMobile: view.mobile,
    hasTouch: view.mobile,
    timezoneId: TIMEZONE,
    serviceWorkers: 'block'
  })
  const morning = localInstant([6, 40])
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
  const weather = JSON.stringify(forecast(localInstant([0, 0])))
  await context.route('https://api.open-meteo.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: weather }))
  await context.addInitScript(([saved, mode]) => {
    localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(saved))
    localStorage.setItem('fh:theme-mode', mode)
    localStorage.setItem('fh-onboarding-seen', '1')
  }, [session, shot.mode])

  const page = await context.newPage()
  await page.clock.setFixedTime(clock)
  await page.goto(BASE + shot.path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await page.locator('.fh-app').waitFor({ timeout: 30_000 })
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
