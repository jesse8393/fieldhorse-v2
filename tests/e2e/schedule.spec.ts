// The desktop Schedule board (docs/design/2026-10-redesign/SPEC.md,
// section 9.10, decision D10): seven day columns, the Unscheduled tray,
// drag to schedule with the mouse or the keyboard, and the refusal to
// schedule into the past.
import { expect, test, type BrowserContext, type Page, type Request } from '@playwright/test'
import { signIn, type SignInOptions } from './helpers/signIn.ts'

test.skip(({ isMobile }) => isMobile, 'Desktop Schedule board')
test.use({ timezoneId: 'America/Chicago', viewport: { width: 1440, height: 900 } })

// The mock company works in Central time. The clock is fixed to Thursday,
// October 8, 2026 at 9:00 am, so the week on the board runs Sunday Oct 4
// to Saturday Oct 10.
const NOW = new Date('2026-10-08T14:00:00Z')

// Two visits at once on Thursday (they must sit side by side), one that
// finished yesterday, and one tomorrow. Plumbing Bellevue (c-job1) has a
// visit from today on; Harold Wickham (c-job2) only had one yesterday.
const SCHEDULE = [
  { id: 's1', contact_id: 'c-job1', title: 'Pour slab, crew A', start_at: '2026-10-08T13:00:00Z', end_at: '2026-10-08T16:00:00Z' },
  { id: 's2', contact_id: 'c-lead1', title: 'Site visit', start_at: '2026-10-08T13:30:00Z', end_at: '2026-10-08T14:30:00Z' },
  { id: 's3', contact_id: 'c-job2', title: 'Driveway demo', start_at: '2026-10-07T13:00:00Z', end_at: '2026-10-07T15:00:00Z' },
  { id: 's4', contact_id: 'c-job1', title: 'Final slab inspection', start_at: '2026-10-09T14:00:00Z', end_at: '2026-10-09T15:00:00Z' }
].map((row) => ({ user_id: 'qa-user-1', description: null, created_at: '2026-10-01T12:00:00Z', ...row }))

type Write = { method: string; body: any }

// A script error on the board fails the test, not just a missing element.
let pageErrors: string[] = []
test.beforeEach(() => { pageErrors = [] })
test.afterEach(() => { expect(pageErrors, pageErrors.join('\n')).toEqual([]) })

// Open the board with the clock fixed. Every write to the schedule table
// is caught and answered the way the database would, so a test can read
// what the board sent. Routes added later win over earlier ones, so these
// go in after signIn and before the page loads.
async function setUp(
  context: BrowserContext,
  page: Page,
  tables?: SignInOptions['tables'],
  routes?: (context: BrowserContext) => Promise<void>
) {
  await signIn(context, { tables: { fh_schedule: SCHEDULE, ...tables } })
  const writes: Write[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
  await context.route('**/rest/v1/fh_schedule*', async (route) => {
    const request: Request = route.request()
    if (request.method() === 'POST') {
      const body = JSON.parse(request.postData() || 'null')
      writes.push({ method: 'POST', body })
      const rows = (Array.isArray(body) ? body : [body]).map((_, i) => ({ id: `new-${i + 1}` }))
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(rows) })
    }
    if (request.method() === 'DELETE') {
      writes.push({ method: 'DELETE', body: request.url() })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ id: 'new-1' }]) })
    }
    return route.fallback()
  })
  await routes?.(context)
  await page.clock.setFixedTime(NOW)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto('/schedule', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fh-build-weekplan')).toBeVisible({ timeout: 30_000 })
  return writes
}

function slot(page: Page, day: string, hour: number) {
  return page.locator(`[data-slot="${day}T${String(hour).padStart(2, '0')}"]`)
}

async function dragHandleToSlot(page: Page, handleName: RegExp, day: string, hour: number) {
  const handle = page.getByRole('button', { name: handleName })
  const target = slot(page, day, hour)
  await target.scrollIntoViewIfNeeded()
  const from = (await handle.boundingBox())!
  const to = (await target.boundingBox())!
  await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2)
  await page.mouse.down()
  await page.mouse.move(from.x + from.width / 2 - 20, from.y + from.height / 2 + 10, { steps: 4 })
  await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 12 })
  await page.mouse.up()
}

test.describe('week board', () => {
  test('shows seven day columns, the Unscheduled heading and the toolbar', async ({ context, page }) => {
    await setUp(context, page)
    await expect(page.locator('.fh-build-weekplan__day')).toHaveCount(7)
    await expect(page.getByRole('heading', { level: 1, name: 'Schedule' })).toBeVisible()
    await expect(page.getByText('Oct 4 to 10, 2026', { exact: true })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Unscheduled' })).toBeVisible()
    // The sidebar has its own Today link, so look inside the page.
    const main = page.locator('#fh-main')
    for (const name of ['Today', 'Previous week', 'Next week', 'Day', 'Week', 'Month', 'New job']) {
      await expect(main.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(page.getByRole('button', { name: 'Week', exact: true })).toHaveAttribute('aria-pressed', 'true')
    // The Crew view stays hidden until a visit is assigned to someone.
    await expect(page.getByRole('button', { name: 'Crew', exact: true })).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Crew this week' })).toHaveCount(0)
  })

  test('tints today, marks it with a word, and draws the now line', async ({ context, page }) => {
    await setUp(context, page)
    const today = page.locator('.fh-build-weekplan__day.is-today')
    await expect(today).toHaveCount(1)
    await expect(today.getByRole('button', { name: /Thu 8, today/ })).toBeVisible()
    await expect(page.locator('.fhsch-now')).toHaveCount(1)
  })

  test('puts two visits at the same time side by side, never on top of each other', async ({ context, page }) => {
    await setUp(context, page)
    const thursday = page.locator('.fh-build-weekplan__day.is-today')
    const pour = thursday.getByRole('button', { name: /Pour slab, crew A/ })
    const visit = thursday.getByRole('button', { name: /Site visit/ })
    const a = (await pour.boundingBox())!
    const b = (await visit.boundingBox())!
    expect(a.x + a.width).toBeLessThanOrEqual(b.x + 1)
    expect(Math.abs(a.width - b.width)).toBeLessThan(2)
  })

  test('marks finished visits and live visits with a word, and opens a visit to edit it', async ({ context, page }) => {
    await setUp(context, page)
    const done = page.locator('.fh-build-weekplan__day').nth(3).getByRole('button', { name: /Driveway demo/ })
    await expect(done).toContainText('Done')
    const live = page.locator('.fh-build-weekplan__day.is-today').getByRole('button', { name: /Pour slab, crew A/ })
    await expect(live).toContainText('On site')
    await live.click()
    await expect(page.getByRole('heading', { name: 'Edit event' })).toBeVisible()
  })
})

test.describe('unscheduled tray', () => {
  test('lists jobs with no visit from today on, and a job whose only visit was yesterday', async ({ context, page }) => {
    await setUp(context, page)
    const tray = page.getByRole('region', { name: 'Unscheduled jobs' })
    await expect(tray.getByText('Harold Wickham', { exact: true })).toBeVisible()
    await expect(tray.getByText('Plumbing Bellevue', { exact: true })).toHaveCount(0)
    // Leads, quotes, closed and lost work never wait for a date.
    for (const name of ['Justin Bryan', 'MMC Properties', 'Danielle Ortiz', 'Old Mill HOA']) {
      await expect(tray.getByText(name, { exact: true })).toHaveCount(0)
    }
  })

  test('shows Plumbing Bellevue when the schedule is empty, and its Schedule button opens the event sheet with the job selected', async ({ context, page }) => {
    await setUp(context, page, { fh_schedule: [] })
    const tray = page.getByRole('region', { name: 'Unscheduled jobs' })
    const card = tray.locator('.fhsch-card', { hasText: 'Plumbing Bellevue' })
    await expect(card).toBeVisible()
    await card.getByRole('button', { name: 'Schedule', exact: true }).click()
    const sheet = page.getByRole('dialog')
    await expect(sheet.getByRole('heading', { name: 'Add event' })).toBeVisible()
    await expect(sheet.getByLabel('Link to job')).toHaveValue('c-job1')
    await expect(sheet.getByLabel('Title *')).toHaveValue('Plumbing Bellevue')
  })
})

test.describe('drag to schedule', () => {
  test('dropping a card on a future slot writes the visit with the job, the company and the hour', async ({ context, page }) => {
    const writes = await setUp(context, page, { fh_schedule: [] })
    await dragHandleToSlot(page, /Drag Plumbing Bellevue/, '2026-10-09', 13)
    await expect.poll(() => writes.filter((w) => w.method === 'POST').length).toBe(1)
    const row = writes.find((w) => w.method === 'POST')!.body[0]
    expect(row).toMatchObject({
      org_id: 'org-1',
      user_id: 'qa-user-1',
      contact_id: 'c-job1',
      title: 'Plumbing Bellevue',
      // Friday 1 pm to 2 pm Central daylight time.
      start_at: '2026-10-09T18:00:00.000Z',
      end_at: '2026-10-09T19:00:00.000Z'
    })
    await expect(page.getByText('Scheduled Plumbing Bellevue', { exact: false })).toBeVisible()
  })

  test('dropping on a slot that has already passed refuses with a toast and writes nothing', async ({ context, page }) => {
    const writes = await setUp(context, page, { fh_schedule: [] })
    // Wednesday 8 am is yesterday morning.
    await dragHandleToSlot(page, /Drag Plumbing Bellevue/, '2026-10-07', 8)
    await expect(page.getByText('Pick a time from now on.', { exact: true })).toBeVisible()
    await page.waitForTimeout(400)
    expect(writes).toEqual([])
    // The card stays in the tray.
    await expect(page.getByRole('region', { name: 'Unscheduled jobs' }).getByText('Plumbing Bellevue', { exact: true })).toBeVisible()
  })

  test('works from the keyboard alone, one slot per arrow key', async ({ context, page }) => {
    const writes = await setUp(context, page, { fh_schedule: [] })
    await page.getByRole('button', { name: /Drag Plumbing Bellevue/ }).focus()
    await page.keyboard.press('Space')
    // The first arrow lands on today at the next full hour (Thursday 10 am);
    // each arrow after that is one day or one hour.
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowRight')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('ArrowDown')
    await expect(page.locator('[data-slot="2026-10-09T12"]')).toHaveClass(/is-over/)
    await page.keyboard.press('Space')
    await expect.poll(() => writes.filter((w) => w.method === 'POST').length).toBe(1)
    expect(writes[0].body[0]).toMatchObject({
      contact_id: 'c-job1',
      start_at: '2026-10-09T17:00:00.000Z',
      end_at: '2026-10-09T18:00:00.000Z'
    })
  })

  test('refuses a past slot from the keyboard too', async ({ context, page }) => {
    const writes = await setUp(context, page, { fh_schedule: [] })
    await page.getByRole('button', { name: /Drag Plumbing Bellevue/ }).focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    // The first arrow lands on today at the next full hour (Thursday 10 am);
    // the left arrow moves to Wednesday 10 am, which has passed. Wait for the
    // highlight before dropping, so a slow runner never drops too early.
    await expect(page.locator('[data-slot="2026-10-08T10"]')).toHaveClass(/is-over/)
    await page.keyboard.press('ArrowLeft')
    await expect(page.locator('[data-slot="2026-10-07T10"]')).toHaveClass(/is-over/)
    await page.keyboard.press('Space')
    await expect(page.getByText('Pick a time from now on.', { exact: true })).toBeVisible()
    expect(writes).toEqual([])
  })

  test('Escape drops nothing', async ({ context, page }) => {
    const writes = await setUp(context, page, { fh_schedule: [] })
    await page.getByRole('button', { name: /Drag Plumbing Bellevue/ }).focus()
    await page.keyboard.press('Space')
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Escape')
    await page.waitForTimeout(300)
    expect(writes).toEqual([])
    await expect(page.getByText('Pick a time from now on.', { exact: true })).toHaveCount(0)
  })
})

test.describe('crew this week', () => {
  test('appears below the tray, with hours, only when visits carry assigned_to', async ({ context, page }) => {
    await setUp(context, page, {
      fh_schedule: SCHEDULE.map((row) => (row.id === 's1' || row.id === 's4' ? { ...row, assigned_to: 'crew-1' } : row))
    }, async (ctx) => {
      await ctx.route('**/api/org-members-list', (route) => route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          ok: true,
          caller_role: 'owner',
          org_id: 'org-1',
          invites: [],
          members: [
            { id: 'm1', user_id: 'qa-user-1', role: 'owner', joined_at: '2026-01-01T00:00:00Z', invited_by: null, is_self: true, default_hourly_rate: null, name: 'Jesse Parker', company_name: null, email: 'qa@fieldhorse.local' },
            { id: 'm2', user_id: 'crew-1', role: 'crew', joined_at: '2026-01-01T00:00:00Z', invited_by: null, is_self: false, default_hourly_rate: null, name: 'Terrence Moody', company_name: null, email: 'terrence@example.com' }
          ]
        })
      }))
    })
    const crew = page.getByRole('region', { name: 'Crew this week' })
    await expect(crew.getByRole('heading', { name: 'Crew this week' })).toBeVisible()
    // Pour slab is 3 hours, the inspection 1 hour.
    await expect(crew.getByText('Terrence Moody', { exact: true })).toBeVisible()
    await expect(crew).toContainText('4 h')
    // The tray sits above it.
    const tray = (await page.getByRole('region', { name: 'Unscheduled jobs' }).boundingBox())!
    const box = (await crew.boundingBox())!
    expect(box.y).toBeGreaterThan(tray.y)
  })
})

test.describe('views', () => {
  test('Day, Week and Month all stay reachable, and the tray stays beside them', async ({ context, page }) => {
    await setUp(context, page)
    await page.getByRole('button', { name: 'Day', exact: true }).click()
    await expect(page.locator('.fhsch-board[data-view="day"]')).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Unscheduled' })).toBeVisible()
    await page.getByRole('button', { name: 'Month', exact: true }).click()
    await expect(page.locator('.fhsch-month')).toBeVisible()
    await expect(page.getByText('October 2026', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Week', exact: true }).click()
    await expect(page.locator('.fh-build-weekplan__day')).toHaveCount(7)
  })

  test('the day header opens that day, and Next week moves the board', async ({ context, page }) => {
    await setUp(context, page)
    await page.getByRole('button', { name: 'Fri 9, open day view' }).click()
    await expect(page.locator('.fhsch-board[data-view="day"]')).toBeVisible()
    await page.getByRole('button', { name: 'Week', exact: true }).click()
    await page.getByRole('button', { name: 'Next week', exact: true }).click()
    await expect(page.getByText('Oct 11 to 17, 2026', { exact: true })).toBeVisible()
    await page.locator('#fh-main').getByRole('button', { name: 'Today', exact: true }).click()
    await expect(page.getByText('Oct 4 to 10, 2026', { exact: true })).toBeVisible()
  })

  test('New job goes to the job sheet in Jobs', async ({ context, page }) => {
    await setUp(context, page)
    await page.getByRole('button', { name: 'New job', exact: true }).click()
    await expect(page).toHaveURL(/\/work/)
  })
})
