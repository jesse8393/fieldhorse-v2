// Today on a phone (docs/design/2026-10-redesign/SPEC.md, section 9.2):
// the onyx stage with the headline, the next stop, what needs an answer,
// the day, the empty day and the evening.
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

async function setUp(context: BrowserContext, page: Page, { at, tables }: { at: Date; tables?: SignInOptions['tables'] }) {
  await signIn(context, { tables: { fh_schedule: SCHEDULE, ...tables } })
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
