// Loading and failed reads never read as empty (Phase 8 follow up A,
// bullets 1 to 8). A count, a total, an empty sentence or a status such as
// "Not clocked in" shows only after a successful read. Each screen here is
// opened with one read held open, to see what it shows while it waits, and
// with that read answered by a server error, to see what it shows when the
// read fails; then the read goes through, to check the loaded screen still
// reads as it did before.
import { expect, test, type BrowserContext, type Locator, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

const isPhone = (project: string) => project.startsWith('mobile')

// At desktop width the page hero hides its four mini tiles
// (`.fh-build-hero-row--page > .fh-build-mini-grid` in fixes-2026-07.css),
// so on a desktop their loading values are found in the page, hidden
// ones included, rather than seen. A phone shows them.
const inPage = { includeHidden: true } as const

type Matcher = (url: URL, method: string) => boolean
const anyRead: Matcher = (_url, method) => method === 'GET' || method === 'HEAD'

/** Holds the reads of one table that `match` picks until release() is called. */
async function hold(context: BrowserContext, table: string, match: Matcher = anyRead) {
  let release!: () => void
  const gate = new Promise<void>((resolve) => { release = resolve })
  const held: string[] = []
  await context.route((url) => url.pathname === `/rest/v1/${table}`, async (route) => {
    const request = route.request()
    if (match(new URL(request.url()), request.method())) {
      held.push(request.url())
      await gate
    }
    return route.fallback()
  })
  return { release, held }
}

/** Answers the reads of one table that `match` picks with a server error while `failing.on` is true. */
async function fail(context: BrowserContext, table: string, match: Matcher = anyRead) {
  const failing = { on: true, count: 0 }
  await context.route((url) => url.pathname === `/rest/v1/${table}`, (route) => {
    const request = route.request()
    if (failing.on && match(new URL(request.url()), request.method())) {
      failing.count += 1
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server error' }) })
    }
    return route.fallback()
  })
  return failing
}

// A script error fails the test, not only a missing element.
let pageErrors: string[] = []
test.beforeEach(({ page }) => {
  pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
})
test.afterEach(() => { expect(pageErrors, pageErrors.join('\n')).toEqual([]) })

/** Checks the same thing three times a quarter second apart, so a state that holds is told from a flash. */
async function holds(check: () => Promise<void>) {
  for (let pass = 0; pass < 3; pass++) {
    await check()
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

/**
 * Looks for `locator` six times a quarter second apart, without waiting for
 * it to go away, so a toast that comes and goes is caught too.
 */
async function neverShows(locator: Locator) {
  for (let pass = 0; pass < 6; pass++) {
    expect(await locator.count()).toBe(0)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

async function open(page: Page, path: string, ready: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 30_000 })
}

/**
 * Presses Try again from the keyboard, as a keyboard or screen reader user
 * does. Try again swaps its own error for a skeleton, so the test then
 * checks that focus went to the heading or region that stays on screen,
 * never back to the top of the page.
 */
async function retryFromKeyboard(page: Page, button: Locator) {
  await button.focus()
  await page.keyboard.press('Enter')
}

// ---- 1 and 2: the desktop Schedule ---------------------------------------

test.describe('desktop Schedule', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop Schedule')
  test.use({ viewport: { width: 1440, height: 900 } })

  // Thursday, October 8, 2026 at 9 am in Central time: the board shows
  // Sunday Oct 4 to Saturday Oct 10, and next week starts Oct 11.
  const NOW = new Date('2026-10-08T14:00:00Z')
  const NEXT_WEEK_FROM = 'gte.2026-10-11T05:00:00.000Z'
  const VISITS = [
    { id: 'v1', contact_id: 'c-job1', title: 'Pour slab, crew A', start_at: '2026-10-08T16:00:00Z', end_at: '2026-10-08T19:00:00Z' },
    { id: 'v2', contact_id: 'c-job2', title: 'Driveway forms', start_at: '2026-10-13T15:00:00Z', end_at: '2026-10-13T17:00:00Z' }
  ].map((row) => ({ user_id: 'qa-user-1', description: null, created_at: '2026-10-01T12:00:00Z', ...row }))

  // Up next is the only schedule read capped at 8 rows.
  const upNextRead: Matcher = (url, method) => method === 'GET' && url.searchParams.get('limit') === '8'
  // The board's read of next week, not the tray's booked list.
  const nextWeekRead: Matcher = (url, method) =>
    method === 'GET' && url.searchParams.get('select') !== 'contact_id' && url.searchParams.getAll('start_at').includes(NEXT_WEEK_FROM)

  async function openSchedule(page: Page) {
    await page.clock.setFixedTime(NOW)
    await open(page, '/schedule', '.fh-build-weekplan')
  }
  const upNext = (page: Page) => page.getByRole('region', { name: 'Up next', exact: true })
  const board = (page: Page) => page.locator('.fhsch-board')
  const nextWeek = (page: Page) => page.locator('#fh-main').getByRole('button', { name: 'Next week', exact: true })
  const emptyHint = (page: Page) => page.getByText(/Nothing scheduled this (week|day)\./)

  test('Up next shows a skeleton while it loads, never the empty sentence', async ({ context, page }) => {
    await signIn(context, { tables: { fh_schedule: VISITS } })
    const read = await hold(context, 'fh_schedule', upNextRead)
    await openSchedule(page)
    await expect.poll(() => read.held.length).toBeGreaterThan(0)
    await holds(async () => {
      await expect(upNext(page).getByRole('status')).toContainText('Loading')
      await expect(upNext(page).getByText('Nothing scheduled in the next 7 days.')).toHaveCount(0)
    })
    read.release()
    await expect(upNext(page).getByRole('button', { name: /Pour slab, crew A/ })).toBeVisible()
    await expect(upNext(page).getByRole('button', { name: /Driveway forms/ })).toBeVisible()
    await expect(upNext(page).getByRole('status')).toHaveCount(0)
  })

  test('Up next says nothing is scheduled only after a read that found nothing', async ({ context, page }) => {
    await signIn(context, { tables: { fh_schedule: [] } })
    await openSchedule(page)
    await expect(upNext(page).getByText('Nothing scheduled in the next 7 days.')).toBeVisible()
    await expect(upNext(page).getByRole('status')).toHaveCount(0)
    await expect(upNext(page).getByRole('alert')).toHaveCount(0)
  })

  test('a failed Up next read says so with Try again, never the empty sentence', async ({ context, page }) => {
    await signIn(context, { tables: { fh_schedule: VISITS } })
    const failing = await fail(context, 'fh_schedule', upNextRead)
    await openSchedule(page)
    await expect(upNext(page).getByRole('alert')).toContainText("Couldn't load", { timeout: 15_000 })
    await expect(upNext(page).getByText('Nothing scheduled in the next 7 days.')).toHaveCount(0)
    failing.on = false
    await retryFromKeyboard(page, upNext(page).getByRole('button', { name: 'Try again', exact: true }))
    await expect(upNext(page).getByRole('button', { name: /Pour slab, crew A/ })).toBeVisible()
    await expect(upNext(page).getByRole('alert')).toHaveCount(0)
    await expect(upNext(page)).toBeFocused()
  })

  test('the board shows its loading state while the next week loads, never the empty hint', async ({ context, page }) => {
    await signIn(context, { tables: { fh_schedule: VISITS } })
    const read = await hold(context, 'fh_schedule', nextWeekRead)
    await openSchedule(page)
    await expect(board(page).getByRole('button', { name: /Pour slab, crew A/ })).toBeVisible()
    await nextWeek(page).click()
    await expect(page.getByText('Oct 11 to 17, 2026', { exact: true })).toBeVisible()
    await expect.poll(() => read.held.length).toBeGreaterThan(0)
    await holds(async () => {
      await expect(board(page).getByRole('status')).toContainText('Loading schedule')
      await expect(emptyHint(page)).toHaveCount(0)
    })
    read.release()
    await expect(board(page).getByRole('button', { name: /Driveway forms/ })).toBeVisible()
    await expect(board(page).getByRole('status')).toHaveCount(0)
    await expect(emptyHint(page)).toHaveCount(0)
  })

  test('a week with no visits still says so once its read is in', async ({ context, page }) => {
    await signIn(context, { tables: { fh_schedule: [VISITS[0]] } })
    await openSchedule(page)
    await nextWeek(page).click()
    await expect(page.getByText('Oct 11 to 17, 2026', { exact: true })).toBeVisible()
    await expect(page.getByText('Nothing scheduled this week. Drag a job in from the tray, or choose New event.')).toBeVisible()
    await expect(board(page).getByRole('alert')).toHaveCount(0)
  })

  test('a failed read of the next week shows an error line with Try again, not the hint', async ({ context, page }) => {
    await signIn(context, { tables: { fh_schedule: VISITS } })
    const failing = await fail(context, 'fh_schedule', nextWeekRead)
    await openSchedule(page)
    await nextWeek(page).click()
    await expect(board(page).getByRole('alert')).toContainText("Couldn't load", { timeout: 15_000 })
    await expect(emptyHint(page)).toHaveCount(0)
    failing.on = false
    await retryFromKeyboard(page, board(page).getByRole('button', { name: 'Try again', exact: true }))
    await expect(board(page).getByRole('button', { name: /Driveway forms/ })).toBeVisible()
    await expect(board(page).getByRole('alert')).toHaveCount(0)
    await expect(emptyHint(page)).toHaveCount(0)
    await expect(board(page)).toBeFocused()
  })

  // Day view. The board shows Thursday, October 8; the next day's read
  // starts at midnight Friday in Central time.
  const NEXT_DAY_FROM = 'gte.2026-10-09T05:00:00.000Z'
  const nextDayRead: Matcher = (url, method) =>
    method === 'GET' && url.searchParams.get('select') !== 'contact_id' && url.searchParams.getAll('start_at').includes(NEXT_DAY_FROM)
  const WITH_FRIDAY = [
    ...VISITS,
    { id: 'v4', contact_id: 'c-job2', title: 'Friday walkthrough', start_at: '2026-10-09T15:00:00Z', end_at: '2026-10-09T16:00:00Z', user_id: 'qa-user-1', description: null, created_at: '2026-10-01T12:00:00Z' }
  ]
  const nextDay = (page: Page) => page.locator('#fh-main').getByRole('button', { name: 'Next day', exact: true })
  async function openDay(page: Page) {
    await openSchedule(page)
    await page.locator('.fhsch-seg').getByRole('button', { name: 'Day', exact: true }).click()
    await expect(page.locator('.fhsch-board[data-view="day"]')).toBeVisible()
    await expect(board(page).getByRole('button', { name: /Pour slab, crew A/ })).toBeVisible()
  }

  test('Day view shows its loading state while the next day loads, never the empty hint', async ({ context, page }) => {
    await signIn(context, { tables: { fh_schedule: WITH_FRIDAY } })
    const read = await hold(context, 'fh_schedule', nextDayRead)
    await openDay(page)
    await nextDay(page).click()
    await expect(page.getByText('Fri, Oct 9, 2026', { exact: true })).toBeVisible()
    await expect.poll(() => read.held.length).toBeGreaterThan(0)
    await holds(async () => {
      await expect(board(page).getByRole('status')).toContainText('Loading schedule')
      await expect(emptyHint(page)).toHaveCount(0)
      await expect(board(page).getByRole('alert')).toHaveCount(0)
    })
    read.release()
    await expect(board(page).getByRole('button', { name: /Friday walkthrough/ })).toBeVisible()
    await expect(board(page).getByRole('status')).toHaveCount(0)
    await expect(emptyHint(page)).toHaveCount(0)
  })

  test('Day view: a failed read of the next day says so with Try again, not the hint', async ({ context, page }) => {
    await signIn(context, { tables: { fh_schedule: WITH_FRIDAY } })
    const failing = await fail(context, 'fh_schedule', nextDayRead)
    await openDay(page)
    await nextDay(page).click()
    await expect(page.getByText('Fri, Oct 9, 2026', { exact: true })).toBeVisible()
    const error = board(page).getByRole('alert')
    await expect(error).toContainText("Couldn't load this day.", { timeout: 15_000 })
    await expect(emptyHint(page)).toHaveCount(0)
    failing.on = false
    await retryFromKeyboard(page, error.getByRole('button', { name: 'Try again', exact: true }))
    await expect(board(page).getByRole('button', { name: /Friday walkthrough/ })).toBeVisible()
    await expect(board(page).getByRole('alert')).toHaveCount(0)
    await expect(emptyHint(page)).toHaveCount(0)
    await expect(board(page)).toBeFocused()
  })

  // Month view. November 2026 starts on a Sunday, so its grid's read starts
  // at midnight Nov 1 in Central time.
  const NOVEMBER_FROM = 'gte.2026-11-01T05:00:00.000Z'
  const novemberRead: Matcher = (url, method) =>
    method === 'GET' && url.searchParams.get('select') !== 'contact_id' && url.searchParams.getAll('start_at').includes(NOVEMBER_FROM)
  const WITH_NOVEMBER = [
    ...VISITS,
    { id: 'v3', contact_id: 'c-job2', title: 'November walkthrough', start_at: '2026-11-12T15:00:00Z', end_at: '2026-11-12T17:00:00Z', user_id: 'qa-user-1', description: null, created_at: '2026-10-01T12:00:00Z' }
  ]
  const month = (page: Page) => page.locator('.fhsch-month')
  const nextMonth = (page: Page) => page.locator('#fh-main').getByRole('button', { name: 'Next month', exact: true })
  async function openMonth(page: Page) {
    await openSchedule(page)
    await page.locator('.fhsch-seg').getByRole('button', { name: 'Month', exact: true }).click()
    await expect(month(page)).toHaveAttribute('aria-label', 'October 2026')
    await expect(month(page).getByText(/Pour slab, crew A/)).toBeVisible()
  }

  test('Month view shows its loading state while the next month loads, never an empty month', async ({ context, page }) => {
    await signIn(context, { tables: { fh_schedule: WITH_NOVEMBER } })
    const read = await hold(context, 'fh_schedule', novemberRead)
    await openMonth(page)
    await nextMonth(page).click()
    await expect(month(page)).toHaveAttribute('aria-label', 'November 2026')
    await expect.poll(() => read.held.length).toBeGreaterThan(0)
    await holds(async () => {
      await expect(month(page).getByRole('status')).toContainText('Loading schedule')
      await expect(month(page).getByRole('alert')).toHaveCount(0)
    })
    read.release()
    await expect(month(page).getByText(/November walkthrough/)).toBeVisible()
    await expect(month(page).getByRole('status')).toHaveCount(0)
  })

  test('Month view: a failed read of the next month shows an error line with Try again, not an empty month', async ({ context, page }) => {
    await signIn(context, { tables: { fh_schedule: WITH_NOVEMBER } })
    const failing = await fail(context, 'fh_schedule', novemberRead)
    await openMonth(page)
    await nextMonth(page).click()
    await expect(month(page)).toHaveAttribute('aria-label', 'November 2026')
    const error = month(page).getByRole('alert')
    await expect(error).toContainText("Couldn't load this month.", { timeout: 15_000 })
    failing.on = false
    await retryFromKeyboard(page, error.getByRole('button', { name: 'Try again', exact: true }))
    await expect(month(page).getByText(/November walkthrough/)).toBeVisible()
    await expect(month(page).getByRole('alert')).toHaveCount(0)
    await expect(month(page)).toBeFocused()
  })

  // A range that read as empty keeps what its read found when a refresh of
  // it fails: a minute later the app comes back into view, the range is
  // stale, and the reread and its one retry fail. The board and the month
  // keep cached visits on screen without a word, so an empty range does too.
  const THIS_WEEK_FROM = 'gte.2026-10-04T05:00:00.000Z'
  // October 2026 starts on a Thursday, so its grid starts Sunday, Sep 27.
  const OCTOBER_GRID_FROM = 'gte.2026-09-27T05:00:00.000Z'
  const rangeRead = (from: string): Matcher => (url, method) =>
    method === 'GET' && url.searchParams.get('select') !== 'contact_id' && url.searchParams.getAll('start_at').includes(from)
  async function comeBackLater(page: Page) {
    await page.clock.setFixedTime(new Date(NOW.getTime() + 60_000))
    await page.evaluate(() => document.dispatchEvent(new Event('visibilitychange', { bubbles: true })))
  }

  test('a failed refresh of a week that read as empty keeps the hint, not an error', async ({ context, page }) => {
    await signIn(context, { tables: { fh_schedule: [] } })
    const failing = await fail(context, 'fh_schedule', rangeRead(THIS_WEEK_FROM))
    failing.on = false
    await openSchedule(page)
    const hint = page.getByText('Nothing scheduled this week. Drag a job in from the tray, or choose New event.')
    await expect(hint).toBeVisible()
    failing.on = true
    await comeBackLater(page)
    await expect.poll(() => failing.count, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    await holds(async () => {
      await expect(hint).toBeVisible()
      await expect(board(page).getByRole('alert')).toHaveCount(0)
      await expect(board(page).getByRole('status')).toHaveCount(0)
    })
  })

  test('a failed refresh of a month that read as empty shows no error', async ({ context, page }) => {
    await signIn(context, { tables: { fh_schedule: [] } })
    const failing = await fail(context, 'fh_schedule', rangeRead(OCTOBER_GRID_FROM))
    failing.on = false
    await openSchedule(page)
    await page.locator('.fhsch-seg').getByRole('button', { name: 'Month', exact: true }).click()
    await expect(month(page)).toHaveAttribute('aria-label', 'October 2026')
    await expect(month(page).getByRole('status')).toHaveCount(0)
    failing.on = true
    await comeBackLater(page)
    await expect.poll(() => failing.count, { timeout: 15_000 }).toBeGreaterThanOrEqual(2)
    await holds(async () => {
      await expect(month(page).getByRole('alert')).toHaveCount(0)
      await expect(month(page).getByRole('status')).toHaveCount(0)
    })
  })
})

// ---- 3: Crew home ----------------------------------------------------------

test.describe('Crew home', () => {
  // Nothing on today's schedule and no open tasks, so the loaded page has
  // every empty line the bug showed while loading.
  const TABLES = { fh_schedule: [], fh_job_todos: [] }
  const EMPTY_LINES = [
    'Not clocked in',
    'Ready when you are.',
    'None open',
    'Nothing assigned to you right now.',
    'Nothing on the books today.',
    'No shifts logged yet.'
  ]
  const clockCard = (page: Page) => page.locator('.fh-build-window-card')
  const tile = (page: Page, label: string) => page.locator('.fh-build-mini').filter({ hasText: label })
  const clockIn = (page: Page) => page.getByRole('button', { name: 'Clock in', exact: true })
  const clockOut = (page: Page) => page.getByRole('button', { name: 'Clock out', exact: true })
  const activePunchRead: Matcher = (url, method) => method === 'GET' && url.searchParams.get('punch_out_at') === 'is.null'
  // The recent shifts list: the punch read with no open shift filter.
  const recentPunchesRead: Matcher = (url, method) => method === 'GET' && !url.searchParams.has('punch_out_at')
  const anyGet: Matcher = (_url, method) => method === 'GET'

  // A shift with no job, clocked in two hours ago and still running.
  const PUNCH = {
    id: 'tp1', user_id: 'qa-user-1', contact_id: null,
    punch_in_at: new Date(Date.now() - 2 * 3600e3).toISOString(), punch_out_at: null,
    punch_in_lat: null, punch_in_lon: null, punch_in_accuracy_m: null,
    punch_out_lat: null, punch_out_lon: null, punch_out_accuracy_m: null,
    hourly_rate: null, break_minutes: 0, notes: null, flagged: false, flag_reason: null,
    approved_at: null, approved_by: null,
    created_at: new Date(Date.now() - 2 * 3600e3).toISOString(), updated_at: new Date(Date.now() - 2 * 3600e3).toISOString()
  }

  // The session is refreshed in another tab, so the page reads again.
  async function refreshSession(page: Page) {
    await page.evaluate(() => {
      const saved = JSON.parse(localStorage.getItem('sb-qa-mock-auth-token') || 'null')
      const channel = new BroadcastChannel('sb-qa-mock-auth-token')
      channel.postMessage({ event: 'TOKEN_REFRESHED', session: saved })
      channel.close()
    })
  }

  async function openCrew(page: Page) {
    await open(page, '/crew', '[data-build-screen="Crew"]')
  }

  async function expectLoaded(page: Page) {
    await expect(clockCard(page)).toContainText('Not clocked in')
    await expect(clockCard(page)).toContainText('Ready when you are.')
    await expect(clockIn(page)).toBeEnabled()
    await expect(tile(page, 'Today on the clock').locator('strong')).toHaveText('0:00')
    await expect(tile(page, "Today's events").locator('strong')).toHaveText('0')
    await expect(tile(page, 'Open tasks').locator('strong')).toHaveText('0')
    await expect(tile(page, 'Your role').locator('strong')).toHaveText('crew')
    await expect(page.getByText('None open', { exact: true })).toBeVisible()
    await expect(page.getByText('Nothing assigned to you right now.', { exact: true })).toBeVisible()
    await expect(page.getByText('Nothing on the books today.', { exact: true })).toBeVisible()
  }

  test('while the clock is read it is checking, both clock buttons wait, and nothing reads as zero or empty', async ({ context, page }, testInfo) => {
    await signIn(context, { role: 'crew', tables: TABLES })
    const read = await hold(context, 'fh_time_punches')
    await openCrew(page)
    await expect.poll(() => read.held.length).toBeGreaterThan(0)
    await holds(async () => {
      await expect(clockCard(page)).toContainText('Checking your clock')
      // A screen reader hears the eyebrow once, then that the clock is loading.
      await expect(clockCard(page).getByText('Checking your clock', { exact: true })).toHaveCount(1)
      await expect(clockCard(page).getByRole('status')).toHaveText('Loading your clock')
      await expect(clockIn(page)).toBeDisabled()
      await expect(clockOut(page)).toBeDisabled()
      for (const label of ['Today on the clock', "Today's events", 'Open tasks', 'Your role']) {
        await expect(tile(page, label).getByRole('status', inPage)).toHaveCount(1)
        if (isPhone(testInfo.project.name)) await expect(tile(page, label).getByRole('status')).toBeVisible()
      }
      await expect(tile(page, 'Today on the clock')).not.toContainText('0:00')
      await expect(page.locator('.fh-build-rail-card').filter({ hasText: 'Your tasks' }).getByRole('status')).toBeVisible()
      for (const line of EMPTY_LINES) await expect(page.getByText(line, { exact: true })).toHaveCount(0)
    })
    read.release()
    await expectLoaded(page)
    await expect(page.getByText('Checking your clock')).toHaveCount(0)
    await expect(page.locator('[data-build-screen="Crew"]').getByRole('status', inPage)).toHaveCount(0)
  })

  test('a failed clock read says so with Try again, keeps Clock in off and shows no empty line', async ({ context, page }) => {
    await signIn(context, { role: 'crew', tables: TABLES })
    const failing = await fail(context, 'fh_time_punches', activePunchRead)
    await openCrew(page)
    const error = clockCard(page).getByRole('alert')
    await expect(error).toContainText("We couldn't check your clock.", { timeout: 15_000 })
    await expect(clockIn(page)).toBeDisabled()
    await expect(clockOut(page)).toHaveCount(0)
    for (const line of EMPTY_LINES) await expect(page.getByText(line, { exact: true })).toHaveCount(0)
    await expect(tile(page, 'Today on the clock')).not.toContainText('0:00')
    await expect(tile(page, 'Open tasks')).not.toContainText('0')
    failing.on = false
    await retryFromKeyboard(page, error.getByRole('button', { name: 'Try again' }))
    await expectLoaded(page)
    await expect(page.getByText("We couldn't check your clock.")).toHaveCount(0)
    await expect(clockCard(page)).toBeFocused()
  })

  // The other reads count too: today's schedule and the open tasks.
  for (const [table, what] of [['fh_schedule', "today's schedule"], ['fh_job_todos', 'the open tasks']] as const) {
    test(`a failed read of ${what} says the clock could not be checked, with Try again, and shows no empty line`, async ({ context, page }) => {
      await signIn(context, { role: 'crew', tables: TABLES })
      const failing = await fail(context, table, (_url, method) => method === 'GET')
      await openCrew(page)
      const error = clockCard(page).getByRole('alert')
      await expect(error).toContainText("We couldn't check your clock.", { timeout: 15_000 })
      await expect(clockIn(page)).toBeDisabled()
      for (const line of EMPTY_LINES) await expect(page.getByText(line, { exact: true })).toHaveCount(0)
      await expect(tile(page, 'Open tasks')).not.toContainText('0')
      failing.on = false
      await error.getByRole('button', { name: 'Try again' }).click()
      await expectLoaded(page)
      await expect(page.getByText("We couldn't check your clock.")).toHaveCount(0)
    })
  }

  test('a failed reload keeps the shift on screen with Clock out, and says the clock could not be checked', async ({ context, page }) => {
    await signIn(context, { role: 'crew', tables: { ...TABLES, fh_time_punches: [PUNCH] } })
    const failing = await fail(context, 'fh_time_punches', activePunchRead)
    failing.on = false
    await openCrew(page)
    await expect(clockCard(page)).toContainText('On the clock')
    await expect(clockOut(page)).toBeEnabled()

    // The session is refreshed in another tab, so the page reads again,
    // and that read fails.
    failing.on = true
    await refreshSession(page)
    await expect.poll(() => failing.count).toBeGreaterThan(0)
    const error = page.getByRole('alert').filter({ hasText: "We couldn't check your clock." })
    await expect(error).toBeVisible({ timeout: 15_000 })
    await holds(async () => {
      await expect(clockCard(page)).toContainText('On the clock')
      await expect(clockOut(page)).toBeEnabled()
      await expect(clockIn(page)).toHaveCount(0)
    })

    failing.on = false
    await error.getByRole('button', { name: 'Try again' }).click()
    await expect(error).toHaveCount(0)
    await expect(clockCard(page)).toContainText('On the clock')
    await expect(clockOut(page)).toBeEnabled()
  })

  // With no shift, a reload whose clock read failed leaves Clock in off; Try
  // again then checks the clock again, never showing the older "Not clocked
  // in" with Clock in on while the new read is out.
  test('Try again after a failed clock read checks the clock, with Clock in off until a read works', async ({ context, page }) => {
    await signIn(context, { role: 'crew', tables: { ...TABLES, fh_time_punches: [] } })
    const failing = await fail(context, 'fh_time_punches', activePunchRead)
    failing.on = false
    await openCrew(page)
    await expect(clockCard(page)).toContainText('Not clocked in')
    await expect(clockIn(page)).toBeEnabled()

    failing.on = true
    await refreshSession(page)
    const error = page.getByRole('alert').filter({ hasText: "We couldn't check your clock." })
    await expect(error).toBeVisible({ timeout: 15_000 })
    await expect(clockIn(page)).toBeDisabled()

    const held = await hold(context, 'fh_time_punches', activePunchRead)
    failing.on = false
    await error.getByRole('button', { name: 'Try again' }).click()
    await expect.poll(() => held.held.length).toBeGreaterThan(0)
    await holds(async () => {
      await expect(clockCard(page)).toContainText('Checking your clock')
      await expect(clockCard(page)).not.toContainText('Not clocked in')
      await expect(clockIn(page)).toBeDisabled()
    })
    held.release()
    await expect(clockCard(page)).toContainText('Not clocked in')
    await expect(clockIn(page)).toBeEnabled()
  })

  // The shift on the card was clocked out elsewhere after Crew read it: the
  // update that ends only an open shift matches nothing, the card says so,
  // reads the clock again and shows what is true now (D49).
  test('a shift clocked out elsewhere says Already clocked out and reads the clock again', async ({ context, page }) => {
    await signIn(context, { role: 'crew', tables: { ...TABLES, fh_time_punches: [PUNCH] } })
    let ended = false
    await context.route((url) => url.pathname === '/rest/v1/fh_time_punches', (route) => {
      const request = route.request()
      if (request.method() === 'PATCH') {
        ended = true
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }
      if (ended && activePunchRead(new URL(request.url()), request.method())) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      }
      return route.fallback()
    })
    await openCrew(page)
    await expect(clockCard(page)).toContainText('On the clock')
    await clockOut(page).click()
    await expect(page.getByText('Already clocked out', { exact: true })).toBeVisible()
    await expect(clockCard(page)).toContainText('Not clocked in')
    await expect(clockIn(page)).toBeEnabled()
    await expect(page.getByText('Clock out failed', { exact: true })).toHaveCount(0)
  })

  // The first time Crew opens, one of the other reads fails while the punch
  // read finds a running shift: the shift stays on the card with Clock out,
  // since Crew home is the only place to end a shift that has no job.
  for (const [table, what, match] of [
    ['fh_schedule', "today's schedule", anyGet],
    ['fh_job_todos', 'the open tasks', anyGet],
    ['fh_time_punches', 'the recent shifts', recentPunchesRead]
  ] as const) {
    test(`a failed first read of ${what} keeps a running shift on the card with Clock out`, async ({ context, page }) => {
      await signIn(context, { role: 'crew', tables: { ...TABLES, fh_time_punches: [PUNCH] } })
      const failing = await fail(context, table, match)
      await openCrew(page)
      const error = clockCard(page).getByRole('alert')
      await expect(error).toContainText("We couldn't check your clock.", { timeout: 15_000 })
      await holds(async () => {
        await expect(clockCard(page)).toContainText('On the clock')
        await expect(clockCard(page)).toContainText('Since ')
        await expect(clockOut(page)).toBeEnabled()
        await expect(clockIn(page)).toHaveCount(0)
        for (const line of EMPTY_LINES) await expect(page.getByText(line, { exact: true })).toHaveCount(0)
        await expect(tile(page, 'Open tasks')).not.toContainText('0')
        await expect(tile(page, "Today's events")).not.toContainText('0')
      })
      failing.on = false
      await error.getByRole('button', { name: 'Try again' }).click()
      await expect(error).toHaveCount(0)
      await expect(clockCard(page)).toContainText('On the clock')
      await expect(clockOut(page)).toBeEnabled()
      await expect(page.getByText('Nothing on the books today.', { exact: true })).toBeVisible()
      await expect(page.getByText('None open', { exact: true })).toBeVisible()
    })
  }

  // Reads that overlap (a session refresh, a clock out) land in any order;
  // only the latest one decides what the card says.
  test('an older read that fails after a newer one worked does not show the error', async ({ context, page }) => {
    await signIn(context, { role: 'crew', tables: TABLES })
    // Every clock read sent while the page opens waits, then fails once a
    // newer read has worked. The page may read the clock more than once as
    // it opens (in development React mounts a screen twice and the first
    // load is retired), so all of them wait, never only the first: the last
    // load the page sent before the newer one is among them either way.
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const reads = { opening: true, held: 0, failed: 0, newer: 0 }
    await context.route((url) => url.pathname === '/rest/v1/fh_time_punches', async (route) => {
      const request = route.request()
      if (activePunchRead(new URL(request.url()), request.method())) {
        if (reads.opening) {
          reads.held += 1
          await gate
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server error' }) })
          reads.failed += 1
          return
        }
        reads.newer += 1
      }
      return route.fallback()
    })
    await openCrew(page)
    await expect.poll(() => reads.held).toBeGreaterThan(0)
    await holds(async () => {
      await expect(clockCard(page)).toContainText('Checking your clock')
    })
    // A newer read goes out and works.
    reads.opening = false
    await refreshSession(page)
    await expect.poll(() => reads.newer).toBeGreaterThan(0)
    await expectLoaded(page)
    // The reads from the opening fail only now.
    release()
    await expect.poll(() => reads.failed > 0 && reads.failed === reads.held).toBe(true)
    await holds(async () => {
      await expect(clockCard(page)).toContainText('Not clocked in')
      await expect(clockIn(page)).toBeEnabled()
      await expect(page.getByText("We couldn't check your clock.")).toHaveCount(0)
    })
  })

  test('a read from before Clock out that lands after it does not bring the shift back', async ({ context, page }) => {
    await signIn(context, { role: 'crew', tables: { ...TABLES, fh_time_punches: [PUNCH] } })
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const state = { holdNext: false, held: 0, staleAnswered: false, clockedOut: false }
    await context.route((url) => url.pathname === '/rest/v1/fh_time_punches', async (route) => {
      const request = route.request()
      if (request.method() === 'PATCH') {
        state.clockedOut = true
        return route.fallback()
      }
      if (request.method() !== 'GET') return route.fallback()
      const active = activePunchRead(new URL(request.url()), request.method())
      if (active && state.holdNext) {
        // This read went out before Clock out: it still sees the shift running.
        state.holdNext = false
        state.held += 1
        await gate
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([PUNCH]) })
        state.staleAnswered = true
        return
      }
      if (state.clockedOut) {
        // The mock keeps no write: after Clock out the shift is closed.
        const closed = { ...PUNCH, punch_out_at: new Date().toISOString() }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(active ? [] : [closed]) })
      }
      return route.fallback()
    })
    await openCrew(page)
    await expect(clockCard(page)).toContainText('On the clock')
    state.holdNext = true
    await refreshSession(page)
    await expect.poll(() => state.held).toBe(1)
    await clockOut(page).click()
    await expect(clockCard(page)).toContainText('Not clocked in')
    release()
    await expect.poll(() => state.staleAnswered).toBe(true)
    await holds(async () => {
      await expect(clockCard(page)).toContainText('Not clocked in')
      await expect(clockOut(page)).toHaveCount(0)
      await expect(clockIn(page)).toBeEnabled()
    })
  })
})

// ---- 4: Reports ------------------------------------------------------------

test.describe('Reports', () => {
  // The mock's active job stages add up to $45,900. Its leads and quotes
  // live in fh_leads and fh_quotes, which Reports reads from Task 15 on.
  const PIPELINE = '$46K'

  test('while the numbers load nothing reads as zero, empty or not connected', async ({ context, page }, testInfo) => {
    await signIn(context)
    const read = await hold(context, 'fh_mileage')
    if (isPhone(testInfo.project.name)) {
      await open(page, '/analytics', 'h1.v3-h1')
      await expect.poll(() => read.held.length).toBeGreaterThan(0)
      await holds(async () => {
        await expect(page.getByRole('status').filter({ hasText: 'Loading' }).first()).toBeVisible()
        await expect(page.getByText('Not enough data yet.', { exact: true })).toHaveCount(0)
      })
      read.release()
      await expect(page.getByText('Owner KPIs', { exact: true })).toBeVisible()
      await expect(page.getByText('Not enough data yet.', { exact: true })).toHaveCount(0)
      return
    }
    await open(page, '/analytics', '[data-build-screen="SnowAnalyticsBuild"]')
    await expect.poll(() => read.held.length).toBeGreaterThan(0)
    const pipeline = page.locator('.fh-build-mini').filter({ hasText: 'Pipeline' })
    await holds(async () => {
      await expect(page.getByText(/\$0 won/)).toHaveCount(0)
      await expect(pipeline.getByRole('status', inPage)).toHaveCount(1)
      await expect(pipeline).not.toContainText('$0')
      await expect(page.locator('.fh-build-focus').getByRole('status')).toBeVisible()
      await expect(page.locator('.fh-build-kpi-strip')).not.toContainText('Not connected')
      await expect(page.locator('.fh-build-kpi-strip').getByRole('status').first()).toBeVisible()
      await expect(page.locator('.fh-build-rail-card').filter({ hasText: 'Largest stage' }).getByRole('status')).toBeVisible()
      await expect(page.locator('.fh-build-rail-card').filter({ hasText: 'Active leads' })).not.toContainText('0')
    })
    read.release()
    await expect(pipeline.locator('strong')).toHaveText(PIPELINE)
    await expect(page.locator('.fh-build-focus')).toContainText(' won · ')
    await expect(page.locator('.fh-build-kpi-strip')).not.toContainText('Not connected')
    await expect(page.locator('[data-build-screen="SnowAnalyticsBuild"]').getByRole('status', inPage)).toHaveCount(0)
  })

  test('a failed read shows the error with Try again, never an empty book', async ({ context, page }, testInfo) => {
    await signIn(context)
    const failing = await fail(context, 'fh_mileage')
    await page.goto('/analytics', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const error = page.getByRole('alert').filter({ hasText: "Couldn't load your reports" })
    await expect(error).toBeVisible({ timeout: 30_000 })
    await expect(page.getByText('Not enough data yet.', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/\$0 won/)).toHaveCount(0)
    failing.on = false
    await retryFromKeyboard(page, error.getByRole('button', { name: 'Try again' }))
    await expect(error).toHaveCount(0)
    if (isPhone(testInfo.project.name)) {
      await expect(page.getByText('Owner KPIs', { exact: true })).toBeVisible()
    } else {
      await expect(page.locator('.fh-build-mini').filter({ hasText: 'Pipeline' }).locator('strong')).toHaveText(PIPELINE)
    }
    // The whole screen was the error: focus waits on the page's main region.
    await expect(page.locator('#fh-main')).toBeFocused()
  })
})

// ---- 5: Customers ----------------------------------------------------------

test.describe('Customers', () => {
  test('while the book loads its counts and totals wait', async ({ context, page }, testInfo) => {
    await signIn(context)
    const read = await hold(context, 'fh_clients')
    if (isPhone(testInfo.project.name)) {
      await open(page, '/clients', '.fh-clients__cockpit')
      const cockpit = page.locator('.fh-clients__cockpit')
      await expect.poll(() => read.held.length).toBeGreaterThan(0)
      await holds(async () => {
        await expect(cockpit.getByText('Lifetime billed', { exact: true })).toBeVisible()
        await expect(cockpit.getByRole('status').first()).toBeVisible()
        await expect(cockpit).not.toContainText('$0')
        await expect(cockpit).not.toContainText('0 accounts')
      })
      read.release()
      await expect(cockpit).toContainText('1 account')
      await expect(cockpit.getByRole('status')).toHaveCount(0)
      return
    }
    await open(page, '/clients', '[data-build-screen="SnowClientsBuild"]')
    await expect.poll(() => read.held.length).toBeGreaterThan(0)
    const meta = page.locator('.fh-build-topbar__meta')
    const focus = page.locator('.fh-build-focus')
    const tiles = page.locator('.fh-build-mini-grid')
    const rail = page.locator('.fh-build-rail--page')
    await holds(async () => {
      await expect(meta).not.toContainText('on file')
      await expect(meta.getByRole('status')).toBeVisible()
      await expect(focus.getByText('Book of business', { exact: true })).toBeVisible()
      await expect(focus).not.toContainText('with open jobs')
      await expect(focus.getByRole('status')).toBeVisible()
      await expect(tiles.getByRole('status', inPage)).toHaveCount(4)
      await expect(tiles).not.toContainText('$0')
      await expect(rail).not.toContainText('relationships in book')
      await expect(rail.getByRole('status')).toHaveCount(5)
    })
    read.release()
    await expect(meta).toContainText('on file')
    await expect(focus).toContainText('with open jobs')
    await expect(page.locator('.fh-build-mini').filter({ hasText: 'Total clients' }).locator('strong')).toHaveText('1')
    await expect(page.locator('[data-build-screen="SnowClientsBuild"]').getByRole('status', inPage)).toHaveCount(0)
  })

  test('a failed read shows the error with Try again, never an empty book', async ({ context, page }, testInfo) => {
    await signIn(context)
    const failing = await fail(context, 'fh_clients')
    await page.goto('/clients', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const error = page.getByRole('alert').filter({ hasText: "Couldn't load clients" })
    await expect(error).toBeVisible({ timeout: 30_000 })
    for (const line of [/clients? on file/, /\b0 accounts?\b/, /No accounts yet/, /with open jobs/]) {
      await expect(page.getByText(line)).toHaveCount(0)
    }
    failing.on = false
    await retryFromKeyboard(page, error.getByRole('button', { name: 'Try again', exact: true }))
    await expect(error).toHaveCount(0)
    if (isPhone(testInfo.project.name)) {
      await expect(page.locator('.fh-clients__cockpit')).toContainText('1 account')
    } else {
      await expect(page.locator('.fh-build-topbar__meta')).toContainText('1 client on file')
    }
    await expect(page.locator('#fh-main')).toBeFocused()
  })
})

// ---- 6: the job's Files tab ------------------------------------------------

test.describe('Job Files tab', () => {
  // The sub tab panels, by id: the job's own Files tab is a tabpanel named Files too.
  const panel = (page: Page, name: 'Photos' | 'Files') => page.locator(`#fh-job-files-panel-${name.toLowerCase()}`)
  const subTab = (page: Page, name: 'Photos' | 'Files') =>
    page.getByRole('tablist', { name: 'Files sub-tabs' }).getByRole('tab', { name, exact: true })
  const kindRead = (kind: 'photo' | 'file'): Matcher => (url, method) => method === 'GET' && url.searchParams.get('kind') === `eq.${kind}`

  for (const [kind, name, count, empty] of [
    ['photo', 'Photos', '0 photos', 'Photos tell the story'],
    ['file', 'Files', '0 files', 'No files yet']
  ] as const) {
    test(`${name}: no count while the read is out, and the loaded tab reads as before`, async ({ context, page }) => {
      await signIn(context)
      const read = await hold(context, 'fh_job_files', kindRead(kind))
      await open(page, '/jobs/c-job1?tab=files', '[role="tablist"][aria-label="Files sub-tabs"]')
      if (name === 'Files') await subTab(page, 'Files').click()
      await expect.poll(() => read.held.length).toBeGreaterThan(0)
      await holds(async () => {
        await expect(panel(page, name).getByRole('status').first()).toBeVisible()
        await expect(panel(page, name)).not.toContainText(count)
        await expect(panel(page, name)).not.toContainText(empty)
      })
      read.release()
      await expect(panel(page, name).getByText(count, { exact: true })).toBeVisible()
      await expect(panel(page, name)).toContainText(empty)
      await expect(panel(page, name).getByRole('status')).toHaveCount(0)
    })

    test(`${name}: a failed read shows an error with Try again, not the empty card`, async ({ context, page }) => {
      await signIn(context)
      const failing = await fail(context, 'fh_job_files', kindRead(kind))
      await open(page, '/jobs/c-job1?tab=files', '[role="tablist"][aria-label="Files sub-tabs"]')
      if (name === 'Files') await subTab(page, 'Files').click()
      const error = panel(page, name).getByRole('alert')
      await expect(error).toContainText("Couldn't load", { timeout: 15_000 })
      await expect(panel(page, name)).not.toContainText(count)
      await expect(panel(page, name)).not.toContainText(empty)
      failing.on = false
      await retryFromKeyboard(page, error.getByRole('button', { name: 'Try again' }))
      await expect(panel(page, name).getByText(count, { exact: true })).toBeVisible()
      await expect(panel(page, name)).toContainText(empty)
      await expect(panel(page, name).getByRole('alert')).toHaveCount(0)
      await expect(panel(page, name)).toBeFocused()
    })
  }

  // A tiny PNG standing in for a camera photo or a scanned permit.
  const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
  const fileRow = (id: string, kind: 'photo' | 'file', filename: string) => ({
    id, user_id: 'qa-user-1', job_id: 'c-job1', filename, storage_path: `qa-user-1/c-job1/${id}`,
    mime_type: kind === 'photo' ? 'image/jpeg' : 'application/pdf', size_bytes: 1024, kind,
    caption: null, section_tag: null, uploaded_at: '2026-10-01T12:00:00Z'
  })

  for (const [kind, name, bucket, first, second, added] of [
    ['photo', 'Photos', 'job-photos', 'Slab pour.jpg', 'Forms set.jpg', 'rebar.png'],
    ['file', 'Files', 'job-files', 'Permit.pdf', 'Site plan.pdf', 'rebar.png']
  ] as const) {
    test(`${name}: a reread keeps what is on screen instead of the skeleton`, async ({ context, page }) => {
      await signIn(context, { tables: { fh_job_files: [fileRow('jf1', kind, first), fileRow('jf2', kind, second)] } })
      // Uploads go through, and photos get a signed address so each tile shows its name.
      await context.route((url) => url.pathname.startsWith(`/storage/v1/object/${bucket}/`), (route) =>
        route.request().method() === 'POST'
          ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: `${bucket}/upload` }) })
          : route.fallback())
      await context.route((url) => url.pathname === `/storage/v1/object/sign/${bucket}`, (route) => {
        const { paths = [] } = JSON.parse(route.request().postData() || '{}')
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(paths.map((path: string) => ({ path, signedURL: `/object/sign/${bucket}/${path}?token=qa`, error: null })))
        })
      })
      // Once the tab is open, the next read of this kind waits until released.
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const reread = { hold: false, held: 0 }
      await context.route((url) => url.pathname === '/rest/v1/fh_job_files', async (route) => {
        const url = new URL(route.request().url())
        if (reread.hold && route.request().method() === 'GET' && url.searchParams.get('kind') === `eq.${kind}`) {
          reread.held += 1
          await gate
        }
        return route.fallback()
      })
      await open(page, '/jobs/c-job1?tab=files', '[role="tablist"][aria-label="Files sub-tabs"]')
      if (name === 'Files') await subTab(page, 'Files').click()
      const shown = (label: string) => kind === 'photo'
        ? panel(page, name).getByRole('img', { name: label })
        : panel(page, name).getByText(label, { exact: true })
      const counted = (n: number) => panel(page, name).getByText(`${n} ${kind === 'photo' ? 'photos' : 'files'}`, { exact: true })
      await expect(shown(first)).toBeVisible()
      await expect(counted(2)).toBeVisible()

      reread.hold = true
      await panel(page, name).locator('input[type="file"]').setInputFiles([{ name: added, mimeType: 'image/png', buffer: PIXEL }])
      await expect.poll(() => reread.held).toBeGreaterThan(0)
      await holds(async () => {
        await expect(shown(first)).toBeVisible()
        await expect(shown(second)).toBeVisible()
        await expect(counted(2)).toBeVisible()
        await expect(panel(page, name).getByRole('status')).toHaveCount(0)
      })
      release()
      // The mock keeps no upload, so the reread brings the same two back.
      await expect(panel(page, name).getByRole('status')).toHaveCount(0)
      await expect(counted(2)).toBeVisible()
      await expect(shown(first)).toBeVisible()
      await expect(shown(second)).toBeVisible()
    })

    // Rereads that overlap land in any order; only the latest one decides
    // what the tab says. On a flaky connection an upload's reread is slow
    // and fails, while a delete made right after it reads again quickly.
    test(`${name}: an older reread that fails after a newer one worked does not say the refresh failed`, async ({ context, page }) => {
      await signIn(context, { tables: { fh_job_files: [fileRow('jf1', kind, first), fileRow('jf2', kind, second)] } })
      // Uploads and deletes go through, and photos get a signed address so each tile shows its name.
      await context.route((url) => url.pathname.startsWith(`/storage/v1/object/${bucket}`), (route) => {
        const method = route.request().method()
        if (method === 'POST') return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: `${bucket}/upload` }) })
        if (method === 'DELETE') return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
        return route.fallback()
      })
      await context.route((url) => url.pathname === `/storage/v1/object/sign/${bucket}`, (route) => {
        const { paths = [] } = JSON.parse(route.request().postData() || '{}')
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify(paths.map((path: string) => ({ path, signedURL: `/object/sign/${bucket}/${path}?token=qa`, error: null })))
        })
      })
      // Once the tab is open, the tab's next read of this kind waits and
      // then fails; after the delete its reads find only the first one left
      // (the mock keeps no write). The job header's own photo read, which
      // names its columns, is left alone.
      let release!: () => void
      const gate = new Promise<void>((resolve) => { release = resolve })
      const reads = { holdNext: false, held: 0, staleAnswered: false, deleted: false }
      await context.route((url) => url.pathname === '/rest/v1/fh_job_files', async (route) => {
        const request = route.request()
        if (request.method() === 'DELETE') {
          reads.deleted = true
          return route.fallback()
        }
        const query = new URL(request.url()).searchParams
        if (request.method() !== 'GET' || query.get('kind') !== `eq.${kind}` || query.get('select') !== '*') return route.fallback()
        if (reads.holdNext) {
          reads.holdNext = false
          reads.held += 1
          await gate
          await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server error' }) })
          reads.staleAnswered = true
          return
        }
        if (reads.deleted) {
          return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([fileRow('jf1', kind, first)]) })
        }
        return route.fallback()
      })
      await open(page, '/jobs/c-job1?tab=files', '[role="tablist"][aria-label="Files sub-tabs"]')
      if (name === 'Files') await subTab(page, 'Files').click()
      const shown = (label: string) => kind === 'photo'
        ? panel(page, name).getByRole('img', { name: label })
        : panel(page, name).getByText(label, { exact: true })
      const counted = (text: string) => panel(page, name).getByText(text, { exact: true })
      await expect(shown(second)).toBeVisible()
      await expect(counted(`2 ${kind === 'photo' ? 'photos' : 'files'}`)).toBeVisible()

      // An upload: its reread waits.
      reads.holdNext = true
      await panel(page, name).locator('input[type="file"]').setInputFiles([{ name: added, mimeType: 'image/png', buffer: PIXEL }])
      await expect.poll(() => reads.held).toBe(1)

      // A delete right after it: its reread works and finds one left.
      if (kind === 'photo') {
        await shown(second).click()
        await page.getByRole('button', { name: 'Delete photo', exact: true }).click()
      } else {
        await panel(page, name).getByRole('listitem').filter({ hasText: second }).getByRole('button', { name: 'Delete file' }).click()
      }
      const confirm = page.getByRole('dialog', { name: `Delete this ${kind}?` })
      await confirm.getByRole('button', { name: `Delete ${kind}`, exact: true }).click()
      await expect(counted(`1 ${kind}`)).toBeVisible()
      await expect(shown(second)).toHaveCount(0)

      // The upload's reread fails only now.
      release()
      await expect.poll(() => reads.staleAnswered).toBe(true)
      await holds(async () => {
        await expect(panel(page, name).getByRole('alert')).toHaveCount(0)
        await expect(counted(`1 ${kind}`)).toBeVisible()
        await expect(shown(first)).toBeVisible()
        await expect(shown(second)).toHaveCount(0)
      })
    })
  }
})

// ---- 7: Field reports ------------------------------------------------------

test.describe('Field reports', () => {
  test('while the reports load the counts and the all clear lines wait', async ({ context, page }, testInfo) => {
    await signIn(context)
    const read = await hold(context, 'fh_notes')
    if (isPhone(testInfo.project.name)) {
      await open(page, '/notes', 'textarea.fh-notes-textarea')
      const actions = page.locator('.v3-section').filter({ hasText: 'AI action items' })
      const recent = page.locator('.v3-section').filter({ hasText: 'Recent activity' })
      await expect.poll(() => read.held.length).toBeGreaterThan(0)
      await holds(async () => {
        await expect(actions.getByRole('status')).toBeVisible()
        await expect(actions).not.toContainText('No action items yet.')
        await expect(recent.getByRole('status')).toBeVisible()
        await expect(recent.getByRole('status')).toHaveAttribute('aria-busy', 'true')
        await expect(recent.getByRole('status')).toContainText('Loading')
        await expect(recent).not.toContainText('Nothing logged yet.')
      })
      read.release()
      await expect(actions).toContainText('No action items yet.')
      await expect(actions.getByRole('status')).toHaveCount(0)
      await expect(recent.getByRole('status')).toHaveCount(0)
      await expect(page.getByText('Inspector confirmed Friday.').first()).toBeVisible()
      return
    }
    await open(page, '/notes', '[data-build-screen="SnowNotesBuild"]')
    await expect.poll(() => read.held.length).toBeGreaterThan(0)
    const rail = page.locator('.fh-build-rail--page')
    await holds(async () => {
      await expect(page.locator('.fh-build-topbar__meta')).not.toContainText('captured')
      await expect(page.locator('.fh-build-topbar__meta').getByRole('status')).toBeVisible()
      await expect(page.locator('.fh-build-focus')).not.toContainText('captured in 24h')
      await expect(page.locator('.fh-build-focus').getByRole('status')).toBeVisible()
      await expect(page.locator('.fh-build-mini-grid').getByRole('status', inPage)).toHaveCount(4)
      await expect(rail).not.toContainText('All clear')
      await expect(rail).not.toContainText('All linked')
      await expect(rail.getByRole('status')).toHaveCount(4)
    })
    read.release()
    await expect(page.locator('.fh-build-topbar__meta')).toContainText('1 report captured')
    await expect(rail).toContainText('All clear')
    await expect(rail).toContainText('All linked')
    await expect(page.locator('[data-build-screen="SnowNotesBuild"]').getByRole('status', inPage)).toHaveCount(0)
  })

  test('a failed read shows the error with Try again, never an all clear', async ({ context, page }, testInfo) => {
    await signIn(context)
    const failing = await fail(context, 'fh_notes')
    await page.goto('/notes', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const error = page.getByRole('alert').filter({ hasText: "Couldn't load your field reports" })
    await expect(error).toBeVisible({ timeout: 30_000 })
    // Inside the reports card it is the compact error, as in Crew, Photos and Files.
    await expect(error).toHaveClass(/fh-data-error--compact/)
    for (const line of ['All clear', 'All linked', 'No action items yet.', 'Nothing logged yet.', 'reports captured']) {
      await expect(page.getByText(line)).toHaveCount(0)
    }
    failing.on = false
    await retryFromKeyboard(page, error.getByRole('button', { name: 'Try again' }))
    await expect(error).toHaveCount(0)
    if (isPhone(testInfo.project.name)) {
      await expect(page.getByText('Inspector confirmed Friday.').first()).toBeVisible()
      await expect(page.getByRole('group', { name: 'Recent activity' })).toBeFocused()
    } else {
      await expect(page.locator('.fh-build-topbar__meta')).toContainText('1 report captured')
      await expect(page.getByRole('region', { name: 'Latest reports' })).toBeFocused()
    }
  })

  test('a failed read keeps the composer, so a report can still be written and saved', async ({ context, page }, testInfo) => {
    await signIn(context)
    const failing = await fail(context, 'fh_notes')
    // What gets saved (the mock answers the write but keeps no new row).
    const saved: Record<string, unknown>[] = []
    await context.route((url) => url.pathname === '/rest/v1/fh_notes', (route) => {
      if (route.request().method() === 'POST') saved.push(JSON.parse(route.request().postData() || '{}'))
      return route.fallback()
    })
    await page.goto('/notes', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const error = page.getByRole('alert').filter({ hasText: "Couldn't load your field reports" })
    await expect(error).toBeVisible({ timeout: 30_000 })
    const phone = isPhone(testInfo.project.name)
    const composer = page.locator(phone ? 'textarea.fh-notes-textarea' : 'textarea.fh-build-capture__textarea')
    await expect(composer).toBeVisible()
    for (const line of ['All clear', 'All linked', 'No action items yet.', 'Nothing logged yet.', 'reports captured', 'No reports yet']) {
      await expect(page.getByText(line)).toHaveCount(0)
    }
    await composer.fill('Rebar delivery moved to Thursday.')
    await page.getByRole('button', { name: phone ? 'Save Note' : 'Save report', exact: true }).click()
    await expect(page.getByText('Note saved')).toBeVisible({ timeout: 15_000 })
    expect(saved).toEqual([expect.objectContaining({ text: 'Rebar delivery moved to Thursday.' })])
    await expect(error).toBeVisible()
    failing.on = false
    await error.getByRole('button', { name: 'Try again' }).click()
    await expect(error).toHaveCount(0)
    await expect(page.getByText('Inspector confirmed Friday.').first()).toBeVisible()
  })
})

// ---- 8: quote lines ----------------------------------------------------------

// The quote screen (Phase 9, Task 10, tests/e2e/quote.spec.ts): the same
// column on a phone and a desktop, its lines edited in place, the preview
// and the approval screens of their own.
test.describe('Quote lines', () => {
  const NOW = Date.now()
  const iso = (ms: number) => new Date(ms).toISOString()
  function item(id: string, description: string, over: Record<string, unknown> = {}) {
    return {
      id, user_id: 'qa-user-1', quote_id: 'q-quote', contact_id: null, section: null, description,
      qty: 1, unit: null, rate: 0, amount: 0, notes: null, is_optional: false, is_excluded: false,
      sort_order: 0, created_at: iso(NOW - 86400000), updated_at: iso(NOW - 86400000), ...over
    }
  }
  const ITEMS = [
    item('qi1', 'Excavate and grade', { qty: 1100, unit: 'sq ft', rate: 2, amount: 2200, sort_order: 0 }),
    item('qi2', 'Pump truck', { qty: 1, unit: 'day', rate: 950, amount: 950, sort_order: 1 }),
    item('qi3', 'Stamped ashlar, charcoal release', { rate: 4950, amount: 4950, is_optional: true, sort_order: 2 })
  ]
  const COULD_NOT = "We couldn't load the lines."
  const QUOTE = '/quotes/q-quote'

  // Nothing may send: every send route answers here and is counted.
  async function noSends(context: BrowserContext) {
    const sends: string[] = []
    await context.route(/\/api\/(send-|docusign-send)/, (route) => {
      sends.push(route.request().url())
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
    })
    return sends
  }

  const screen = (page: Page) => page.locator('.fhqt-page')
  const lines = (page: Page) => page.getByRole('list', { name: 'Line items' })
  const total = (page: Page) => page.locator('.fhqt-total')
  const send = (page: Page) => total(page).getByRole('button', { name: 'Send for approval' })
  // Approve quote is a link while it can be taken, a disabled row while it waits.
  const approveLink = (page: Page) => page.getByRole('link', { name: /^Approve quote/ })
  const approveWaiting = (page: Page) => page.getByRole('button', { name: /^Approve quote/ })
  const preview = (page: Page) => page.getByRole('group', { name: 'Proposal preview' })
  // The base lines, top to bottom, by their descriptions.
  async function lineOrder(page: Page) {
    const texts = await lines(page).locator('> li').allInnerTexts()
    return ['Excavate and grade', 'Pump truck']
      .map((name) => ({ name, at: texts.findIndex((text) => text.includes(name)) }))
      .filter((line) => line.at >= 0)
      .sort((a, b) => a.at - b.at)
      .map((line) => line.name)
  }

  test('while the lines load nothing says there are none, and Approve, Send and the preview wait', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const sends = await noSends(context)
    // Every read of the lines waits.
    const read = await hold(context, 'fh_quote_items')
    await open(page, QUOTE, '.fhqt-page')
    await expect.poll(() => read.held.length).toBeGreaterThan(0)
    await holds(async () => {
      await expect(screen(page).getByRole('status').filter({ hasText: 'Loading the quote lines' })).toBeVisible()
      await expect(page.getByText('No lines yet.', { exact: true })).toHaveCount(0)
      await expect(page.getByText(/Add at least one line/)).toHaveCount(0)
      await expect(page.getByText(COULD_NOT)).toHaveCount(0)
      await expect(approveWaiting(page)).toBeDisabled()
      await expect(approveLink(page)).toHaveCount(0)
      await expect(send(page)).toBeDisabled()
    })
    // The preview waits for the lines too, and draws no proposal without them.
    await page.getByRole('link', { name: /^Preview as/ }).click()
    await expect(page).toHaveURL(/\/quotes\/q-quote\/preview$/)
    await holds(async () => {
      await expect(preview(page).getByText('Loading preview…')).toBeVisible()
      await expect(preview(page).getByText('$0.00')).toHaveCount(0)
      await expect(preview(page).getByRole('alert')).toHaveCount(0)
    })
    read.release()
    await expect(preview(page).getByText('Excavate and grade').first()).toBeVisible()
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(page).toHaveURL(/\/quotes\/q-quote$/)
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    await expect(send(page)).toBeEnabled()
    await expect(approveLink(page)).toBeVisible()
    expect(sends).toEqual([])
  })

  test('a failed first read shows the error with Try again, and Approve and Send wait', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const sends = await noSends(context)
    const failing = await fail(context, 'fh_quote_items')
    await open(page, QUOTE, '.fhqt-page')
    const error = screen(page).getByRole('alert').filter({ hasText: "Couldn't load the lines" })
    await expect(error).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('No lines yet.', { exact: true })).toHaveCount(0)
    await expect(approveWaiting(page)).toBeDisabled()
    await expect(approveWaiting(page)).toContainText(COULD_NOT)
    await expect(send(page)).toBeDisabled()
    await expect(total(page).getByText(COULD_NOT, { exact: true })).toBeVisible()
    await expect(page.getByText(/Add at least one line/)).toHaveCount(0)
    failing.on = false
    await retryFromKeyboard(page, error.getByRole('button', { name: 'Try again' }))
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    await expect(send(page)).toBeEnabled()
    await expect(approveLink(page)).toBeVisible()
    await expect(page.getByText(COULD_NOT)).toHaveCount(0)
    await expect(screen(page).getByRole('heading', { level: 1 })).toBeFocused()
    expect(sends).toEqual([])
  })

  // Approve quote opens the approval screen, which reads the lines again
  // for its snapshot.
  test('the approval screen says a failed line read, with Try again, and approving waits', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const sends = await noSends(context)
    await open(page, QUOTE, '.fhqt-page')
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()

    const failing = await fail(context, 'fh_quote_items')
    await approveLink(page).click()
    await expect(page).toHaveURL(/\/quotes\/q-quote\/approve$/)
    await expect(page.getByRole('heading', { name: 'Lock the approved quote.' })).toBeVisible()
    const error = screen(page).getByRole('alert').filter({ hasText: COULD_NOT })
    await expect(error).toBeVisible({ timeout: 15_000 })
    await expect(screen(page).getByText(/Add at least one line/)).toHaveCount(0)
    await expect(screen(page).getByText(/0 base/)).toHaveCount(0)
    await expect(screen(page).getByText('$0.00', { exact: true })).toHaveCount(0)
    const approve = page.getByRole('button', { name: 'Approve quote', exact: true })
    await expect(approve).toBeDisabled()

    failing.on = false
    await retryFromKeyboard(page, error.getByRole('button', { name: 'Try again' }))
    await expect(screen(page).getByText(/^2 base, 1 optional/)).toBeVisible()
    await expect(screen(page).getByText('$3,150.00', { exact: true })).toBeVisible()
    await expect(approve).toBeEnabled()
    await expect(screen(page).getByRole('alert')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Lock the approved quote.' })).toBeFocused()
    expect(sends).toEqual([])
  })

  test('a failed reread after an edit keeps the lines and their order, and says so', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await noSends(context)
    // A new line comes back as the row that was sent, with an id.
    const added: Record<string, unknown>[] = []
    await context.route((url) => url.pathname === '/rest/v1/fh_quote_items', (route) => {
      const request = route.request()
      if (request.method() !== 'POST') return route.fallback()
      const body = JSON.parse(request.postData() || '{}')
      added.push(body)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...body, id: 'qi-new' }) })
    })
    const failing = await fail(context, 'fh_quote_items', (_url, method) => method === 'GET')
    failing.on = false
    await open(page, QUOTE, '.fhqt-page')
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()

    // The connection drops; an edit saves, and the reread after it fails.
    failing.on = true
    await lines(page).getByRole('button', { name: /Pump truck/ }).click()
    const editor = page.getByRole('form', { name: 'Edit line' })
    await editor.getByLabel('Notes').fill('Half day minimum')
    await editor.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText("Couldn't refresh the lines")).toBeVisible({ timeout: 15_000 })
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    await expect(lines(page).getByText('Pump truck')).toBeVisible()
    await expect(page.getByText('No lines yet.', { exact: true })).toHaveCount(0)

    // The next line still goes after the last one.
    await page.getByRole('button', { name: 'Add a line', exact: true }).click()
    const adding = page.getByRole('form', { name: 'Add a line' })
    await adding.getByLabel('Description').fill('Saw cut joints')
    await adding.getByLabel('Rate').fill('100')
    await adding.getByRole('button', { name: 'Add line', exact: true }).click()
    await expect.poll(() => added.length).toBe(1)
    expect(added[0]).toMatchObject({ description: 'Saw cut joints', sort_order: 3, quote_id: 'q-quote' })
  })

  // Rereads that overlap land in any order; only the latest one decides.
  // Two optional switches flip one after the other: the first one's reread
  // is slow and fails after the second one's has worked.
  test('an older reread that fails after a newer one worked does not say the lines could not refresh', async ({ context, page }) => {
    const WITH_SEALER = [...ITEMS, item('qi4', 'Sealer, two coats', { rate: 600, amount: 600, is_optional: true, sort_order: 3 })]
    await signIn(context, { tables: { fh_quote_items: WITH_SEALER } })
    const sends = await noSends(context)
    let release!: () => void
    const gate = new Promise<void>((resolve) => { release = resolve })
    const reads = { holdNext: false, held: 0, newer: 0, staleAnswered: false }
    // The editor's reads of this quote's lines, not the line suggestions.
    const linesRead: Matcher = (url, method) =>
      method === 'GET' && url.searchParams.get('select') === '*' && url.searchParams.get('quote_id') === 'eq.q-quote'
    await context.route((url) => url.pathname === '/rest/v1/fh_quote_items', async (route) => {
      if (!linesRead(new URL(route.request().url()), route.request().method())) return route.fallback()
      if (reads.holdNext) {
        reads.holdNext = false
        reads.held += 1
        await gate
        await route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server error' }) })
        reads.staleAnswered = true
        return
      }
      if (reads.held > 0) reads.newer += 1
      return route.fallback()
    })
    await open(page, QUOTE, '.fhqt-page')
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    const ashlar = page.getByRole('switch', { name: 'Include Stamped ashlar, charcoal release in the total' })
    const sealer = page.getByRole('switch', { name: 'Include Sealer, two coats in the total' })

    // The first switch saves, and the reread after it waits.
    reads.holdNext = true
    await ashlar.click()
    await expect.poll(() => reads.held).toBe(1)
    // The second one saves, and the reread after it works.
    await sealer.click()
    await expect.poll(() => reads.newer).toBeGreaterThan(0)
    await expect(sealer).not.toHaveAttribute('aria-disabled', 'true')

    // The first reread fails only now.
    release()
    await expect.poll(() => reads.staleAnswered).toBe(true)
    await neverShows(page.getByText("Couldn't refresh the lines"))
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    await expect(lines(page).getByText('Pump truck')).toBeVisible()
    expect(sends).toEqual([])
  })

  // New lines are answered with the row that was sent, with an id, and kept.
  async function recordAdds(context: BrowserContext) {
    const added: Record<string, unknown>[] = []
    await context.route((url) => url.pathname === '/rest/v1/fh_quote_items', (route) => {
      const request = route.request()
      if (request.method() !== 'POST') return route.fallback()
      const body = JSON.parse(request.postData() || '{}')
      added.push(body)
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ ...body, id: `qi-new-${added.length}` }) })
    })
    return added
  }

  /** Answers the writes of the lines with `method` with a server error while `failing.on` is true. */
  async function failWrites(context: BrowserContext, method: 'DELETE' | 'PATCH') {
    const failing = { on: true, count: 0 }
    await context.route((url) => url.pathname === '/rest/v1/fh_quote_items', (route) => {
      if (!failing.on || route.request().method() !== method) return route.fallback()
      failing.count += 1
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server error' }) })
    })
    return failing
  }

  test('a failed first read offers no Add a line, so no line goes in at sort order 0', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const sends = await noSends(context)
    const added = await recordAdds(context)
    const failing = await fail(context, 'fh_quote_items')
    await open(page, QUOTE, '.fhqt-page')
    const error = screen(page).getByRole('alert').filter({ hasText: "Couldn't load the lines" })
    await expect(error).toBeVisible({ timeout: 15_000 })

    // The lines are unknown, so nothing offers to add one in front of them.
    await holds(async () => {
      await expect(page.getByRole('button', { name: 'Add a line', exact: true })).toHaveCount(0)
      await expect(page.getByRole('form', { name: 'Add a line' })).toHaveCount(0)
      await expect(error).toBeVisible()
    })
    await page.waitForTimeout(500)
    expect(added).toEqual([])

    // Once a read works the lines show, and the new line goes after the last one.
    failing.on = false
    await error.getByRole('button', { name: 'Try again' }).click()
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    await page.getByRole('button', { name: 'Add a line', exact: true }).click()
    const editor = page.getByRole('form', { name: 'Add a line' })
    await editor.getByLabel('Description').fill('Saw cut joints')
    await editor.getByRole('button', { name: 'Add line', exact: true }).click()
    await expect.poll(() => added.length).toBe(1)
    expect(added[0]).toMatchObject({ description: 'Saw cut joints', sort_order: 3 })
    expect(sends).toEqual([])
  })

  test('Send waits when the lines read fails, even when a count read works', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const sends = await noSends(context)
    // The list read fails; a base line count (a HEAD read) would still answer 2.
    const failing = await fail(context, 'fh_quote_items', (_url, method) => method === 'GET')
    await open(page, QUOTE, '.fhqt-page')
    const error = screen(page).getByRole('alert').filter({ hasText: "Couldn't load the lines" })
    await expect(error).toBeVisible({ timeout: 15_000 })
    await holds(async () => {
      await expect(send(page)).toBeDisabled()
      await expect(page.getByText(COULD_NOT, { exact: true }).first()).toBeVisible()
    })
    failing.on = false
    await error.getByRole('button', { name: 'Try again' }).click()
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    await expect(send(page)).toBeEnabled()
    await expect(page.getByText(COULD_NOT)).toHaveCount(0)
    expect(sends).toEqual([])
  })

  test('a count read that fails after the lines landed leaves Send to the lines on screen', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const sends = await noSends(context)
    // Every base line count read fails, two seconds late: after the lines are in.
    await context.route((url) => url.pathname === '/rest/v1/fh_quote_items', async (route) => {
      if (route.request().method() !== 'HEAD') return route.fallback()
      await new Promise((resolve) => setTimeout(resolve, 2000))
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server error' }) })
    })
    await open(page, QUOTE, '.fhqt-page')
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    await page.waitForTimeout(2500)
    await holds(async () => {
      await expect(lines(page).getByText('Pump truck')).toBeVisible()
      await expect(send(page)).toBeEnabled()
      await expect(page.getByText(COULD_NOT)).toHaveCount(0)
    })
    expect(sends).toEqual([])
  })

  test('the preview says a failed line read, with Try again, never a proposal with no lines, and Send waits meanwhile', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const sends = await noSends(context)
    const failing = await fail(context, 'fh_quote_items')
    await open(page, QUOTE, '.fhqt-page')
    await expect(screen(page).getByRole('alert').filter({ hasText: "Couldn't load the lines" })).toBeVisible({ timeout: 15_000 })
    await expect(send(page)).toBeDisabled()
    await page.getByRole('link', { name: /^Preview as/ }).click()
    await expect(page).toHaveURL(/\/quotes\/q-quote\/preview$/)
    const error = preview(page).getByRole('alert').filter({ hasText: "Couldn't load the lines" })
    await expect(error).toBeVisible({ timeout: 15_000 })
    await expect(preview(page).getByText('Loading preview…')).toHaveCount(0)
    await expect(preview(page).getByText('$0.00')).toHaveCount(0)
    failing.on = false
    await retryFromKeyboard(page, error.getByRole('button', { name: 'Try again' }))
    await expect(preview(page).getByText('Excavate and grade').first()).toBeVisible()
    await expect(preview(page).getByRole('alert')).toHaveCount(0)
    await expect(preview(page)).toBeFocused()
    // Back on the quote, the lines read works and Send is on.
    await page.getByRole('button', { name: 'Back' }).click()
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    await expect(send(page)).toBeEnabled()
    expect(sends).toEqual([])
  })

  // After a save the lines are read again, quietly: the ones on screen stay,
  // with no skeleton in their place, and a reread that fails says so in a
  // toast instead of taking them away.
  test('a reread after a save keeps the lines on screen', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const sends = await noSends(context)
    const reads = await fail(context, 'fh_quote_items', (_url, method) => method === 'GET')
    reads.on = false
    await open(page, QUOTE, '.fhqt-page')
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    const reread = await hold(context, 'fh_quote_items', (_url, method) => method === 'GET')
    await page.getByRole('switch', { name: 'Include Stamped ashlar, charcoal release in the total' }).click()
    await expect.poll(() => reread.held.length, { timeout: 15_000 }).toBeGreaterThan(0)
    await holds(async () => {
      await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
      await expect(screen(page).getByRole('status').filter({ hasText: 'Loading the quote lines' })).toHaveCount(0)
    })
    reread.release()
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    await expect(send(page)).toBeEnabled()
    expect(sends).toEqual([])
  })

  test('a failed reread after a save keeps the lines, says so, and leaves Send on', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const sends = await noSends(context)
    const failing = await fail(context, 'fh_quote_items', (_url, method) => method === 'GET')
    failing.on = false
    await open(page, QUOTE, '.fhqt-page')
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    failing.on = true
    await page.getByRole('switch', { name: 'Include Stamped ashlar, charcoal release in the total' }).click()
    await expect(page.getByText("Couldn't refresh the lines")).toBeVisible({ timeout: 15_000 })
    expect(failing.count).toBeGreaterThan(0)
    await holds(async () => {
      await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
      await expect(screen(page).getByRole('alert').filter({ hasText: "Couldn't load the lines" })).toHaveCount(0)
      await expect(page.getByText(COULD_NOT)).toHaveCount(0)
      await expect(send(page)).toBeEnabled()
    })
    expect(sends).toEqual([])
  })

  test('a failed delete whose reread fails too puts the line back where it was', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await noSends(context)
    const reads = await fail(context, 'fh_quote_items', (_url, method) => method === 'GET')
    reads.on = false
    const deletes = await failWrites(context, 'DELETE')
    await open(page, QUOTE, '.fhqt-page')
    await expect(lines(page).getByText('Pump truck')).toBeVisible()
    reads.on = true
    await lines(page).getByRole('button', { name: /Pump truck/ }).click()
    await page.getByRole('form', { name: 'Edit line' }).getByRole('button', { name: 'Delete line' }).click()
    await expect(page.getByText("Couldn't delete item")).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => deletes.count).toBeGreaterThan(0)
    await holds(async () => {
      await expect(lines(page).getByText('Pump truck')).toBeVisible()
      expect(await lineOrder(page)).toEqual(['Excavate and grade', 'Pump truck'])
      await expect(page.locator('.fhqt-optional').getByText('Stamped ashlar, charcoal release')).toBeVisible()
    })
  })

  test('a failed move whose reread fails too puts the lines back in their order', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await noSends(context)
    const reads = await fail(context, 'fh_quote_items', (_url, method) => method === 'GET')
    reads.on = false
    const moves = await failWrites(context, 'PATCH')
    await open(page, QUOTE, '.fhqt-page')
    await expect(lines(page).getByText('Pump truck')).toBeVisible()
    reads.on = true
    await lines(page).getByRole('button', { name: /Excavate and grade/ }).click()
    const editor = page.getByRole('form', { name: 'Edit line' })
    await editor.getByRole('button', { name: 'Move down' }).click()
    await expect(page.getByText("Couldn't reorder")).toBeVisible({ timeout: 15_000 })
    await expect.poll(() => moves.count).toBeGreaterThan(0)
    await editor.getByRole('button', { name: 'Cancel' }).click()
    await holds(async () => {
      expect(await lineOrder(page)).toEqual(['Excavate and grade', 'Pump truck'])
    })
  })
})
