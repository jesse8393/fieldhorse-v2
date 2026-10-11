// Today (docs/design/2026-10-redesign/SPEC.md, section 9.2): the onyx stage
// with the headline, the next stop, what needs an answer, the day, the
// empty day and the evening. First on a phone, then on a desktop, where the
// left column holds the stage, the next stop and the day, and the right
// column holds what needs an answer and the week strip.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { signIn, type SignInOptions } from './helpers/signIn.ts'

// The mock company sits in Murfreesboro, Tennessee, so the phone runs on
// Central time and the clock is fixed: Thursday, October 8, 2026.
test.use({ timezoneId: 'America/Chicago' })
const MORNING = new Date('2026-10-08T11:40:00Z') // 6:40 am Central
const EVENING = new Date('2026-10-09T00:40:00Z') // 7:40 pm Central

// Three visits today and one tomorrow, in UTC. The mock returns every row
// for both day queries; the screen keeps each to its own day. The rows
// carry no embedded job, so names and addresses come from the job rows.
const SCHEDULE = [
  { id: 's1', contact_id: 'c-job1', title: 'Pour slab, crew A', start_at: '2026-10-08T12:30:00Z', end_at: '2026-10-08T16:00:00Z' },
  { id: 's2', contact_id: 'c-lead1', title: 'Site visit and quote walk', start_at: '2026-10-08T16:30:00Z', end_at: '2026-10-08T17:30:00Z' },
  { id: 's3', contact_id: 'c-job2', title: 'Walkthrough', start_at: '2026-10-08T19:30:00Z', end_at: '2026-10-08T20:30:00Z' },
  { id: 's4', contact_id: 'c-job1', title: 'Final slab inspection', start_at: '2026-10-09T14:00:00Z', end_at: '2026-10-09T15:00:00Z' }
].map((row) => ({ user_id: 'qa-user-1', description: null, created_at: '2026-10-01T12:00:00Z', ...row }))

// Open Meteo as getWeather asks for it: 71 and partly cloudy now, rain
// from 3 pm that stops a concrete pour, 68 and clear tomorrow.
function forecast() {
  const hours = Array.from({ length: 7 * 24 }, (_, i) => i)
  const time = hours.map((i) => new Date(Date.UTC(2026, 9, 8) + i * 3_600_000).toISOString().slice(0, 13) + ':00')
  const rain = (i: number) => (i < 24 && i % 24 >= 15 ? 0.3 : 0)
  return {
    timezone: 'America/Chicago',
    current: { time: '2026-10-08T06:30', temperature_2m: 71, relative_humidity_2m: 55, precipitation: 0, wind_speed_10m: 6, weather_code: 2, is_day: 1 },
    hourly: {
      time,
      temperature_2m: hours.map(() => 70),
      precipitation_probability: hours.map((i) => (rain(i) ? 80 : 10)),
      precipitation: hours.map(rain),
      wind_speed_10m: hours.map(() => 6),
      relative_humidity_2m: hours.map(() => 55),
      weather_code: hours.map((i) => (i >= 24 && i < 48 ? 0 : 2))
    },
    daily: {
      time: Array.from({ length: 7 }, (_, d) => `2026-10-${String(8 + d).padStart(2, '0')}`),
      temperature_2m_max: [74, 67.6, 70, 71, 69, 72, 73],
      temperature_2m_min: [52, 50, 51, 53, 50, 52, 54],
      precipitation_probability_max: [80, 0, 10, 10, 10, 10, 10],
      precipitation_sum: [0.6, 0, 0, 0, 0, 0, 0],
      wind_speed_10m_max: [8, 6, 7, 7, 6, 6, 7]
    }
  }
}

async function setUp(
  context: BrowserContext,
  page: Page,
  { at, tables, role }: { at: Date; tables?: SignInOptions['tables']; role?: string }
) {
  await signIn(context, { role, tables: { fh_schedule: SCHEDULE, ...tables } })
  await context.route('https://api.open-meteo.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecast()) })
  )
  await page.clock.setFixedTime(at)
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fh-app')).toBeVisible({ timeout: 30_000 })
}

test.describe('today on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'Phone layout')

  test('today shows the headline and the next stop', async ({ context, page }) => {
    await setUp(context, page, { at: MORNING })
    const headline = page.getByRole('heading', { level: 1 })
    await expect(headline).toHaveText(/stops?\.|Clear day\./)
    await expect(headline).toHaveText('Three stops. First pour at 7:30.')
    await expect(page.getByText('Thursday, October 8')).toBeVisible()
    await expect(page.getByText('71° and partly cloudy. Clear to work until 3 pm.')).toBeVisible()

    const nextStop = page.getByRole('region', { name: 'Next stop' })
    await expect(nextStop.getByText('Next stop, 7:30 am')).toBeVisible()
    await expect(nextStop.getByText('Plumbing Bellevue')).toBeVisible()
    const navigate = page.getByRole('link', { name: 'Navigate', exact: true })
    await expect(navigate).toBeVisible()
    await expect(navigate).toHaveAttribute('href', /412%20Burkitt%20Station%20Rd/)

    const answers = page.getByRole('region', { name: /Needs an answer/ })
    await expect(answers).toBeVisible()
    const count = await answers.getByRole('listitem').count()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(3)

    const day = page.getByRole('region', { name: 'Your day' })
    await expect(day.getByRole('listitem')).toHaveCount(3)
    await expect(day.getByRole('link', { name: 'Week' })).toHaveAttribute('href', '/schedule')
    // Tomorrow's visit stays out of today.
    await expect(day.getByText('Final slab inspection')).toHaveCount(0)

    // The old phone dashboard is gone from this view.
    await expect(page.getByText('Total pipeline')).toHaveCount(0)
    await expect(page.getByText('Quick actions')).toHaveCount(0)
  })

  test('today has one brushed gold action', async ({ context, page }) => {
    await setUp(context, page, { at: MORNING })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/stops?\./)
    expect(await page.locator('main .fhc-btn--primary').count()).toBeLessThanOrEqual(1)
  })

  test('empty day', async ({ context, page }) => {
    await setUp(context, page, { at: MORNING, tables: { fh_schedule: [], fh_contacts: [] } })
    await expect(page.getByText('Clear day.')).toBeVisible()
    await expect(page.getByText('Nothing on the schedule.')).toBeVisible()
    await expect(page.getByText('Nothing scheduled today')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Plan the week' })).toHaveAttribute('href', '/schedule')
    await expect(page.getByRole('link', { name: /Navigate/ })).toHaveCount(0)
    expect(await page.locator('main .fhc-btn--primary').count()).toBeLessThanOrEqual(1)
  })

  test('evening content', async ({ context, page }) => {
    await setUp(context, page, { at: EVENING })
    await expect(page.getByText(/Today, done|Tomorrow/).first()).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Today, done', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tomorrow', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Three stops done\./)
    await expect(page.getByText('Thursday, 7:40 pm')).toBeVisible()
    await expect(page.getByText('Tomorrow 68° and clear. Final slab inspection at 9:00.')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Today, done' }).getByText('Done', { exact: true })).toHaveCount(3)
    // The evening shows in Day mode too, and the next stop card is gone.
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light')
    await expect(page.getByRole('region', { name: 'Next stop' })).toHaveCount(0)
    expect(await page.locator('main .fhc-btn--primary').count()).toBeLessThanOrEqual(1)
  })
})

test.describe('today on a desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop layout')

  test('shows the stage, the next stop, what needs an answer and the day', async ({ context, page }) => {
    await setUp(context, page, { at: MORNING })
    const headline = page.getByRole('heading', { level: 1 })
    await expect(headline).toHaveText('Three stops. First pour at 7:30.')
    await expect(page.getByText('Thursday, October 8')).toBeVisible()
    await expect(page.getByText('71° and partly cloudy. Clear to work until 3 pm.')).toBeVisible()

    const nextStop = page.getByRole('region', { name: 'Next stop' })
    await expect(nextStop.getByText('Next stop, 7:30 am')).toBeVisible()
    await expect(nextStop.getByText('Plumbing Bellevue')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Navigate', exact: true })).toHaveAttribute('href', /412%20Burkitt%20Station%20Rd/)

    const answers = page.getByRole('region', { name: /Needs an answer/ })
    await expect(answers).toBeVisible()
    const count = await answers.getByRole('listitem').count()
    expect(count).toBeGreaterThan(0)
    expect(count).toBeLessThanOrEqual(3)

    const day = page.getByRole('region', { name: 'Your day' })
    await expect(day.getByRole('listitem')).toHaveCount(3)
    await expect(day.getByRole('link', { name: 'Week' })).toHaveAttribute('href', '/schedule')
    // Tomorrow's visit stays out of today.
    await expect(day.getByText('Final slab inspection')).toHaveCount(0)
  })

  test('the week strip shows seven days with their visits, today marked, each linking to the schedule', async ({ context, page }) => {
    await setUp(context, page, { at: MORNING })
    const week = page.getByRole('region', { name: 'This week' })
    await expect(week).toBeVisible()
    const days = week.getByRole('link')
    await expect(days).toHaveCount(7)

    const today = week.getByRole('link', { name: 'Thursday, October 8, today, 3 visits' })
    await expect(today).toBeVisible()
    await expect(today).toHaveAttribute('aria-current', 'date')
    await expect(today).toHaveAttribute('href', '/schedule?d=2026-10-08')
    await expect(today.getByText('3 visits')).toBeVisible()

    const friday = week.getByRole('link', { name: 'Friday, October 9, 1 visit' })
    await expect(friday).toHaveAttribute('href', '/schedule?d=2026-10-09')
    await expect(week.getByRole('link', { name: 'Sunday, October 4, no visits' })).toBeVisible()
    await expect(week.getByRole('link', { name: 'Saturday, October 10, no visits' })).toBeVisible()
    await expect(week.locator('[aria-current="date"]')).toHaveCount(1)

    await friday.click()
    await expect(page).toHaveURL(/\/schedule/)
  })

  test('the old dashboard tiles and the revenue layer are gone', async ({ context, page }) => {
    await setUp(context, page, { at: MORNING })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/stops?\./)
    for (const text of [
      'On site today',
      'Open deals',
      'Queued actions',
      'Collected this week',
      'Pipeline at a glance',
      'Revenue overview',
      'Lead to cash',
      'Saved views',
      'Owner queue',
      'Revenue opportunities',
      'Job health preview'
    ]) {
      await expect(page.getByText(text, { exact: true }), text).toHaveCount(0)
    }
    // No abbreviated money such as $43K anywhere on the screen.
    expect(await page.locator('.fh-build-page').innerText()).not.toMatch(/\$\d[\d,.]*\s?[KkMm]\b/)
    expect(await page.locator('.fh-build-page').innerText()).not.toMatch(/[\u2013\u2014]/)
  })

  test('the quick actions stay reachable and the page has no brushed gold action on a full day', async ({ context, page }) => {
    await setUp(context, page, { at: MORNING })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/stops?\./)
    await expect(page.getByRole('link', { name: 'New lead' })).toHaveAttribute('href', '/work?new=1')
    await expect(page.getByRole('link', { name: 'New job' })).toHaveAttribute('href', '/work?new=1&asStage=job')
    await expect(page.locator('main .fhc-btn--primary')).toHaveCount(0)
  })

  test('empty day', async ({ context, page }) => {
    await setUp(context, page, { at: MORNING, tables: { fh_schedule: [], fh_contacts: [] } })
    await expect(page.getByText('Clear day.')).toBeVisible()
    await expect(page.getByText('Nothing on the schedule.')).toBeVisible()
    await expect(page.getByText('Nothing scheduled today')).toBeVisible()
    await expect(page.getByRole('link', { name: 'Plan the week' })).toHaveAttribute('href', '/schedule')
    await expect(page.getByRole('link', { name: /Navigate/ })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'Next stop' })).toHaveCount(0)
    // The week strip still draws, with no visits in it.
    await expect(page.getByRole('region', { name: 'This week' }).getByRole('link')).toHaveCount(7)
    expect(await page.locator('main .fhc-btn--primary').count()).toBeLessThanOrEqual(1)
  })

  test('evening content', async ({ context, page }) => {
    await setUp(context, page, { at: EVENING })
    await expect(page.getByRole('heading', { name: 'Today, done', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Tomorrow', exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { level: 1 })).toHaveText(/^Three stops done\./)
    await expect(page.getByText('Thursday, 7:40 pm')).toBeVisible()
    await expect(page.getByText('Tomorrow 68° and clear. Final slab inspection at 9:00.')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Today, done' }).getByText('Done', { exact: true })).toHaveCount(3)
    await expect(page.getByRole('region', { name: 'Next stop' })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'This week' })).toBeVisible()
    expect(await page.locator('main .fhc-btn--primary').count()).toBeLessThanOrEqual(1)
  })

  test('crew never see money on Today, they are sent to their own home', async ({ context, page }) => {
    await signIn(context, { role: 'crew', tables: { fh_schedule: SCHEDULE } })
    await context.route('https://api.open-meteo.com/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecast()) })
    )
    await page.clock.setFixedTime(MORNING)
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page).toHaveURL(/\/crew/, { timeout: 30_000 })
    await expect(page.getByRole('region', { name: /Needs an answer/ })).toHaveCount(0)
    await expect(page.getByRole('region', { name: 'This week' })).toHaveCount(0)
  })
})
