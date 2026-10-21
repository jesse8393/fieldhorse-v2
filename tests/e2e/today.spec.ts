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

// Three visits today and one tomorrow, in UTC. The mock honors each day
// query's start_at range, as the database does, so today's query gets the
// three and tomorrow's the one. The rows carry no embedded job, so names
// and addresses come from the job rows.
const SCHEDULE = [
  { id: 's1', contact_id: 'c-job1', title: 'Pour slab, crew A', start_at: '2026-10-08T12:30:00Z', end_at: '2026-10-08T16:00:00Z' },
  { id: 's2', contact_id: 'c-lead1', title: 'Site visit and quote walk', start_at: '2026-10-08T16:30:00Z', end_at: '2026-10-08T17:30:00Z' },
  { id: 's3', contact_id: 'c-job2', title: 'Walkthrough', start_at: '2026-10-08T19:30:00Z', end_at: '2026-10-08T20:30:00Z' },
  { id: 's4', contact_id: 'c-job1', title: 'Final slab inspection', start_at: '2026-10-09T14:00:00Z', end_at: '2026-10-09T15:00:00Z' }
].map((row) => ({ user_id: 'qa-user-1', description: null, created_at: '2026-10-01T12:00:00Z', ...row }))

// Eight visits today, 7:30 am to 4:00 pm Central, more than the six the
// day query used to stop at, and the same visit tomorrow. By 2:00 pm the
// first six are over and the seventh, at 2:30, is next.
const AFTERNOON = new Date('2026-10-08T19:00:00Z') // 2:00 pm Central
const EIGHT_VISITS = [
  { id: 'e1', contact_id: 'c-job1', title: 'Pour slab, crew A', start_at: '2026-10-08T12:30:00Z', end_at: '2026-10-08T13:15:00Z' },
  { id: 'e2', contact_id: 'c-lead1', title: 'Site visit and quote walk', start_at: '2026-10-08T13:30:00Z', end_at: '2026-10-08T14:15:00Z' },
  { id: 'e3', contact_id: 'c-job2', title: 'Driveway forms', start_at: '2026-10-08T14:30:00Z', end_at: '2026-10-08T15:15:00Z' },
  { id: 'e4', contact_id: 'c-quote', title: 'Measure the lot', start_at: '2026-10-08T15:30:00Z', end_at: '2026-10-08T16:15:00Z' },
  { id: 'e5', contact_id: 'c-lead2', title: 'Wall layout', start_at: '2026-10-08T16:30:00Z', end_at: '2026-10-08T17:15:00Z' },
  { id: 'e6', contact_id: 'c-change', title: 'Kitchen walk', start_at: '2026-10-08T17:30:00Z', end_at: '2026-10-08T18:15:00Z' },
  { id: 'e7', contact_id: 'c-job2', title: 'Walkthrough', start_at: '2026-10-08T19:30:00Z', end_at: '2026-10-08T20:15:00Z' },
  { id: 'e8', contact_id: 'c-job1', title: 'Trench check', start_at: '2026-10-08T21:00:00Z', end_at: '2026-10-08T21:45:00Z' },
  { id: 'e9', contact_id: 'c-job1', title: 'Final slab inspection', start_at: '2026-10-09T14:00:00Z', end_at: '2026-10-09T15:00:00Z' }
].map((row) => ({ user_id: 'qa-user-1', description: null, created_at: '2026-10-01T12:00:00Z', ...row }))

// Twenty five leads (fh_leads rows, D55) whose follow up fell due ten days
// ago or more, each a call to make: more than the 20 that See all lists.
// The last one is the most overdue, so it is listed first.
const QUIET_LEADS = Array.from({ length: 25 }, (_, i) => ({
  id: `q-${i + 1}`,
  user_id: 'qa-user-1',
  client_id: `cl-quiet-${i + 1}`,
  title: 'Driveway',
  status: 'open',
  job_type: 'Concrete',
  notes: null,
  last_contact: null,
  quote_id: null,
  follow_up_on: new Date(Date.parse('2026-09-28T15:00:00Z') - i * 86_400_000).toISOString().slice(0, 10),
  created_at: '2026-08-01T12:00:00Z',
  updated_at: new Date(Date.parse('2026-09-28T15:00:00Z') - i * 86_400_000).toISOString(),
  fh_clients: { id: `cl-quiet-${i + 1}`, name: `Quiet lead ${i + 1}` }
}))
// Only those leads wait for an answer: no quotes, and no jobs owed money.
const ONLY_QUIET_LEADS = { fh_leads: QUIET_LEADS, fh_quotes: [], fh_contacts: [] }

// Last night at 9:00 pm Central, and 6:30 the next morning. Last night's
// bundle read Friday's two visits as tomorrow.
const LAST_NIGHT = new Date('2026-10-09T02:00:00Z')
const NEXT_MORNING = new Date('2026-10-09T11:30:00Z')
const FRIDAY_MEASURE = { id: 's5', contact_id: 'c-job2', title: 'Castellanos site measure', start_at: '2026-10-09T18:00:00Z', end_at: '2026-10-09T19:00:00Z', user_id: 'qa-user-1', description: null, created_at: '2026-10-01T12:00:00Z' }

// What the app saved in IndexedDB for an offline cold open, read without
// creating the database when it is not there yet.
function savedCache(page: Page) {
  return page.evaluate(() => new Promise<string>((resolve) => {
    const open = indexedDB.open('keyval-store')
    open.onupgradeneeded = () => open.transaction?.abort()
    open.onerror = () => resolve('')
    open.onsuccess = () => {
      const db = open.result
      try {
        const read = db.transaction('keyval', 'readonly').objectStore('keyval').get('fh-query-cache')
        read.onsuccess = () => { db.close(); resolve(typeof read.result === 'string' ? read.result : '') }
        read.onerror = () => { db.close(); resolve('') }
      } catch {
        db.close()
        resolve('')
      }
    }
  }))
}

async function seeAllAnswers(page: Page) {
  await expect(page.getByRole('heading', { level: 1 })).toHaveText(/ 25 things before tomorrow\.$/)
  const answers = page.getByRole('region', { name: 'Needs an answer' })
  await expect(answers.getByText('25', { exact: true })).toBeVisible()
  await expect(answers.getByRole('listitem')).toHaveCount(3)
  await answers.getByRole('link', { name: 'See all' }).click()
  await expect(answers.getByRole('listitem')).toHaveCount(20)
  await expect(answers.getByText('Showing 20 of 25, most urgent first.')).toBeVisible()
  await expect(answers.getByRole('listitem').first()).toContainText('Quiet lead 25')
}

// Today loaded at 9:00 pm, then opened again at 6:30 the next morning with
// no signal. Last night's bundle listed Friday's two visits as tomorrow,
// and the forecast it saved is hours old, so neither may read as now.
async function coldOpen(context: BrowserContext, page: Page) {
  // The clock runs from 9:00 pm here, because the cache writer waits for
  // time to pass between saves and a fixed clock would stop it.
  await signIn(context, { tables: { fh_schedule: [...SCHEDULE, FRIDAY_MEASURE] } })
  await context.route('https://api.open-meteo.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecast()) })
  )
  await page.clock.setSystemTime(LAST_NIGHT)
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByRole('region', { name: 'Tomorrow' }).getByRole('listitem')).toHaveCount(2, { timeout: 30_000 })
  await expect(page.getByText('Tomorrow 68° and clear. Final slab inspection at 9:00, then Castellanos site measure at 1:00.')).toBeVisible()
  // The cache is saved a moment after the screen settles, the forecast
  // with it.
  await expect.poll(() => savedCache(page), { timeout: 20_000 }).toContain('Castellanos site measure')
  await expect.poll(() => savedCache(page), { timeout: 20_000 }).toContain('["weather",')

  // This morning neither the schedule nor the forecast can load, so Today
  // reads last night's cache.
  await context.route((url) => url.pathname.endsWith('/rest/v1/fh_schedule'), (route) => route.abort('internetdisconnected'))
  await context.route('https://api.open-meteo.com/**', (route) => route.abort('internetdisconnected'))
  await page.clock.setSystemTime(NEXT_MORNING)
  await page.reload({ waitUntil: 'domcontentloaded', timeout: 60_000 })

  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Two stops. First at 9:00.', { timeout: 30_000 })
  await expect(page.getByText('Friday, October 9')).toBeVisible()
  const day = page.getByRole('region', { name: 'Your day' })
  await expect(day.getByRole('listitem')).toHaveCount(2)
  await expect(day.getByText('Final slab inspection')).toBeVisible()
  await expect(day.getByText('Castellanos site measure')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Next stop' }).getByText('Next stop, 9:00 am')).toBeVisible()
  // Last night's forecast is hours old and this morning's never came, so
  // the stage says so instead of showing last night's temperature.
  await expect(page.getByText('Forecast unavailable right now.')).toBeVisible({ timeout: 15_000 })
  await expect(page.getByText(/\d+° and /)).toHaveCount(0)
  // And the schedule it shows is last night's, which the screen says.
  await expect(page.getByText('Today could not refresh')).toBeVisible({ timeout: 15_000 })
}

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

// Today with its schedule held, so the loading card draws first. Returns
// the loading card's height, then the next stop's once the schedule lands.
async function loadingThenNextStop(context: BrowserContext, page: Page) {
  await signIn(context, { tables: { fh_schedule: SCHEDULE } })
  await context.route('https://api.open-meteo.com/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(forecast()) })
  )
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await context.route((url) => url.pathname.endsWith('/rest/v1/fh_schedule'), async (route) => {
    await held
    await route.fallback()
  })
  await page.clock.setFixedTime(MORNING)
  await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  const card = page.locator('.fht-card[aria-hidden="true"]')
  await expect(card).toBeVisible({ timeout: 30_000 })
  const loading = (await card.boundingBox())!.height
  release()
  const nextStop = page.getByRole('region', { name: 'Next stop' })
  await expect(nextStop.getByText('Next stop, 7:30 am')).toBeVisible({ timeout: 30_000 })
  return { loading, band: (await nextStop.boundingBox())!.height }
}

// Tabs onto the next stop's job name and reads the rings it draws: its
// own outline, and the one its ::after draws around the whole band.
async function nextStopFocus(page: Page) {
  const link = page.getByRole('region', { name: 'Next stop' }).getByRole('link', { name: 'Plumbing Bellevue' })
  await expect(link).toBeVisible()
  // Back one and forward one with the keyboard, so the focus is visible.
  await link.focus()
  await page.keyboard.press('Shift+Tab')
  await page.keyboard.press('Tab')
  await expect(link).toBeFocused()
  return link.evaluate((el) => {
    const ring = getComputedStyle(el, '::after')
    return { visible: el.matches(':focus-visible'), name: getComputedStyle(el).outlineStyle, band: `${ring.outlineStyle} ${ring.outlineWidth}` }
  })
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

  test('the next stop with no photo is a compact band, not an empty picture', async ({ context, page }) => {
    await setUp(context, page, { at: MORNING })
    const nextStop = page.getByRole('region', { name: 'Next stop' })
    await expect(nextStop.getByText('Next stop, 7:30 am')).toBeVisible()
    await expect(nextStop.getByRole('link', { name: 'Plumbing Bellevue' })).toBeVisible()
    await expect(nextStop.getByRole('link', { name: 'Navigate', exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(nextStop.locator('img')).toHaveCount(0)
    const box = await nextStop.boundingBox()
    expect(box!.height).toBeLessThanOrEqual(120)
  })

  test('the loading card is the size of the band, so the next stop does not jump when it lands', async ({ context, page }) => {
    const { loading, band } = await loadingThenNextStop(context, page)
    expect(Math.abs(loading - band), `loading ${loading}, band ${band}`).toBeLessThanOrEqual(1)
  })

  test('keyboard focus on the next stop rings the whole band, not a clipped name', async ({ context, page }) => {
    await setUp(context, page, { at: MORNING })
    expect(await nextStopFocus(page)).toEqual({ visible: true, name: 'none', band: 'solid 2px' })
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

  test('eight visits all count in the headline and the day', async ({ context, page }) => {
    await setUp(context, page, { at: MORNING, tables: { fh_schedule: EIGHT_VISITS } })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Eight stops. First pour at 7:30.')
    const day = page.getByRole('region', { name: 'Your day' })
    await expect(day.getByRole('listitem')).toHaveCount(8)
    await expect(day.getByText('Trench check')).toBeVisible()
  })

  test('with eight visits the seventh is the next stop in the afternoon', async ({ context, page }) => {
    await setUp(context, page, { at: AFTERNOON, tables: { fh_schedule: EIGHT_VISITS } })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Eight stops. First pour at 7:30.')
    const nextStop = page.getByRole('region', { name: 'Next stop' })
    await expect(nextStop.getByText('Next stop, 2:30 pm')).toBeVisible()
    await expect(nextStop.getByText('Harold Wickham')).toBeVisible()
    await expect(page.getByRole('region', { name: 'Your day' }).getByText('Done', { exact: true })).toHaveCount(6)
  })

  test('every thing waiting counts in the evening, and See all lists the 20 most urgent', async ({ context, page }) => {
    await setUp(context, page, { at: EVENING, tables: ONLY_QUIET_LEADS })
    await seeAllAnswers(page)
  })

  test('a cold open at 6:30 am shows the morning from last night\'s cache, without last night\'s weather', async ({ context, page }) => {
    await coldOpen(context, page)
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

  test('the next stop with no photo is a compact band, not an empty picture', async ({ context, page }) => {
    await setUp(context, page, { at: MORNING })
    const nextStop = page.getByRole('region', { name: 'Next stop' })
    await expect(nextStop.getByText('Next stop, 7:30 am')).toBeVisible()
    await expect(nextStop.getByRole('link', { name: 'Plumbing Bellevue' })).toBeVisible()
    await expect(nextStop.getByRole('link', { name: 'Navigate', exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(nextStop.locator('img')).toHaveCount(0)
    const box = await nextStop.boundingBox()
    expect(box!.height).toBeLessThanOrEqual(120)
  })

  test('the loading card is the size of the band, so the next stop does not jump when it lands', async ({ context, page }) => {
    const { loading, band } = await loadingThenNextStop(context, page)
    expect(Math.abs(loading - band), `loading ${loading}, band ${band}`).toBeLessThanOrEqual(1)
  })

  test('keyboard focus on the next stop rings the whole band, not a clipped name', async ({ context, page }) => {
    await setUp(context, page, { at: MORNING })
    expect(await nextStopFocus(page)).toEqual({ visible: true, name: 'none', band: 'solid 2px' })
  })

  test('eight visits all count, and the seventh is the next stop in the afternoon', async ({ context, page }) => {
    await setUp(context, page, { at: AFTERNOON, tables: { fh_schedule: EIGHT_VISITS } })
    await expect(page.getByRole('heading', { level: 1 })).toHaveText('Eight stops. First pour at 7:30.')
    const day = page.getByRole('region', { name: 'Your day' })
    await expect(day.getByRole('listitem')).toHaveCount(8)
    await expect(day.getByText('Done', { exact: true })).toHaveCount(6)
    const nextStop = page.getByRole('region', { name: 'Next stop' })
    await expect(nextStop.getByText('Next stop, 2:30 pm')).toBeVisible()
    await expect(nextStop.getByText('Harold Wickham')).toBeVisible()
    await expect(page.getByRole('region', { name: 'This week' }).getByRole('link', { name: 'Thursday, October 8, today, 8 visits' })).toBeVisible()
  })

  test('every thing waiting counts in the evening, and See all lists the 20 most urgent', async ({ context, page }) => {
    await setUp(context, page, { at: EVENING, tables: ONLY_QUIET_LEADS })
    await seeAllAnswers(page)
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
    await expect(page.getByRole('link', { name: 'New lead' })).toHaveAttribute('href', '/leads/new')
    await expect(page.getByRole('link', { name: 'New job' })).toHaveAttribute('href', '/jobs/new')
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

  test('a cold open at 6:30 am shows the morning from last night\'s cache, without last night\'s weather', async ({ context, page }) => {
    await coldOpen(context, page)
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
