import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'
import { expectPlain } from './helpers/rawErrors.ts'
import { holdPosts, postsTo, twoTaps } from './helpers/doubleTap.ts'

// The job page's time clock (TimeClockCard) when the shift it shows was
// ended somewhere else first. Clock out never moves an ended shift's end
// time (D49), so the card has to say the shift is over and stop its meter,
// not keep failing on every Log time tap.

test.skip(({ isMobile }) => !isMobile, 'the time clock card is checked on a phone')

const HOUR = 3600e3
const OTHER_OWNER = 'qa-owner-2'

test('crew visits, completed shifts and task links remain usable at 320 pixels', async ({ context, page }) => {
  await page.clock.setFixedTime(new Date('2026-10-31T17:00:00Z'))
  const task = 'Confirm the complete drainage plan with the homeowner before the next concrete pour'
  await signIn(context, { role: 'crew', tables: {
    fh_schedule: [{ id: 'crew-visit', org_id: 'org-1', user_id: 'qa-user-1', contact_id: 'c-job1', title: 'Long crew visit with the full site preparation instructions', start_at: '2026-10-31T15:00:00Z', end_at: '2026-10-31T18:00:00Z' }],
    fh_time_punches: [{ ...openPunch(), punch_in_at: '2026-10-30T15:00:00Z', punch_out_at: '2026-10-30T18:00:00Z' }],
    fh_job_todos: [{ id: 'crew-task', user_id: 'qa-user-1', job_id: 'c-job1', text: task, done: false, due_at: '2026-11-01T12:00:00Z' }]
  } })
  await page.setViewportSize({ width: 320, height: 844 })
  await page.goto('/crew')
  await expect(page.getByRole('region', { name: "Today's schedule" }).getByText('Long crew visit with the full site preparation instructions')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Recent shifts' }).getByText('Pending', { exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: /View timesheets/ })).toHaveCount(0)
  await expect(page.getByText('Your recent shifts are shown above. Your manager reviews and approves them.', { exact: true })).toBeVisible()
  await nothingRunsOffTheSide(page, 'crew with visits and shift history')
  const link = page.getByRole('link', { name: task, exact: true })
  await expect(link).toBeVisible()
  await link.press('Enter')
  await expect(page).toHaveURL(/\/jobs\/c-job1$/)
})

function job(ownerId: string) {
  return {
    id: 'c-job1', stage: 'job', name: 'Plumbing Bellevue', job_title: 'Slab + trench', amount: 33100,
    user_id: ownerId, client_id: null, phone: '555-0101', email: 'x@y.com', address: '412 Burkitt Station Rd',
    created_at: '2026-09-20T15:00:00.000Z', updated_at: '2026-10-09T15:00:00.000Z', completed_at: null,
    proposal_status: null, milestones: [], follow_up_on: null, notes: null, scope_text: null
  }
}

function openPunch() {
  const started = new Date(Date.now() - 2 * HOUR).toISOString()
  return {
    id: 'tp-job', user_id: 'qa-user-1', contact_id: 'c-job1',
    punch_in_at: started, punch_out_at: null,
    punch_in_lat: null, punch_in_lon: null, punch_in_accuracy_m: null,
    punch_out_lat: null, punch_out_lon: null, punch_out_accuracy_m: null,
    hourly_rate: null, break_minutes: 0, notes: null, flagged: false, flag_reason: null,
    approved_at: null, approved_by: null, created_at: started, updated_at: started
  }
}

// The shift was clocked out on another device after this page read it, so
// the update that ends only an open shift matches nothing: PostgREST answers
// an empty list. Any expense the card books is counted.
async function shiftEndedElsewhere(context: BrowserContext) {
  const writes = { punches: 0, expenses: 0 }
  await context.route((url) => url.pathname === '/rest/v1/fh_time_punches', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    writes.punches += 1
    return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
  })
  await context.route((url) => url.pathname === '/rest/v1/fh_expenses', (route) => {
    if (route.request().method() === 'POST') writes.expenses += 1
    return route.fallback()
  })
  return writes
}

async function openClock(page: Page) {
  await page.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await page.getByRole('button', { name: 'More about this job' }).click()
  const clockOut = page.getByRole('button', { name: 'Clock out', exact: true })
  await expect(clockOut).toBeVisible({ timeout: 15_000 })
  return clockOut
}

test('a crew member whose shift ended elsewhere is told so, and the meter stops', async ({ context, page }) => {
  await signIn(context, { tables: { fh_contacts: [job(OTHER_OWNER)], fh_time_punches: [openPunch()] } })
  const writes = await shiftEndedElsewhere(context)
  await (await openClock(page)).click()
  await page.getByRole('button', { name: 'Log time', exact: true }).click()

  await expect(page.getByText('Already clocked out', { exact: true })).toBeVisible()
  await expect(page.getByText('Not clocked in', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Clock in', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Log time', exact: true })).toHaveCount(0)
  await expect(page.getByText("Couldn't log time", { exact: true })).toHaveCount(0)
  expect(writes.punches).toBe(1)
  expect(writes.expenses).toBe(0)
  // The meter is no longer kept on this device either.
  expect(await page.evaluate(() => localStorage.getItem('fh:timeclock:c-job1:start'))).toBeNull()
})

test("the job's owner still logs the meter, and is told the shift had already ended", async ({ context, page }) => {
  await signIn(context, { tables: { fh_contacts: [job('qa-user-1')], fh_time_punches: [openPunch()] } })
  const writes = await shiftEndedElsewhere(context)
  await (await openClock(page)).click()
  await page.getByRole('button', { name: 'Log time', exact: true }).click()

  await expect(page.getByText('Time logged', { exact: true })).toBeVisible()
  await expect(page.getByText(/had already been clocked out/)).toBeVisible()
  await expect(page.getByText('Not clocked in', { exact: true })).toBeVisible()
  expect(writes.punches).toBe(1)
  expect(writes.expenses).toBe(1)
})

// OPS-01: crew clocking out on the job page used to type their own pay
// rate (prefilled at $65). Anyone who is not the job's owner now books the
// rate their manager set, as the /crew clock does, and sees no money.
test('a crew member clocking out on the job page books their own set rate and sees no pay fields', async ({ context, page }) => {
  await signIn(context, { role: 'crew', tables: {
    fh_contacts: [job(OTHER_OWNER)],
    fh_time_punches: [openPunch()],
    org_members: [{ id: 'm1', org_id: 'org-1', user_id: 'qa-user-1', role: 'crew', revoked_at: null, joined_at: '2026-08-01T00:00:00Z', default_hourly_rate: 28, status: 'active' }]
  } })
  let patch: Record<string, unknown> | null = null
  await context.route((url) => url.pathname === '/rest/v1/fh_time_punches', (route) => {
    if (route.request().method() !== 'PATCH') return route.fallback()
    patch = route.request().postDataJSON()
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ ...openPunch(), ...patch }]) })
  })
  await (await openClock(page)).click()
  await expect(page.getByRole('button', { name: 'Log time', exact: true })).toBeVisible()
  await expect(page.getByText('Hourly rate', { exact: true })).toHaveCount(0)
  await expect(page.getByText('Billable', { exact: true })).toHaveCount(0)
  await page.getByRole('button', { name: 'Log time', exact: true }).click()
  await expect.poll(() => patch).not.toBeNull()
  expect(patch!.hourly_rate).toBe(28)
})

// OPS-18: a failed clock in on Crew home showed the database's own words.
test('a failed clock in on Crew home says so in plain words', async ({ context, page }) => {
  await signIn(context, { role: 'crew', tables: { fh_time_punches: [] } })
  await context.route((url) => url.pathname === '/rest/v1/fh_time_punches', (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    return route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ code: '42501', message: 'new row violates row-level security policy for table "fh_time_punches"' }) })
  })
  await page.goto('/crew')
  await page.getByRole('button', { name: /Clock in/ }).first().click()
  const toaster = page.locator('[data-sonner-toaster]')
  await expect(toaster).toContainText('Clock in failed')
  await expect(toaster).toContainText('Check your connection and try again.')
  await expect(toaster).not.toContainText('row-level security')
})

// raw-errors-11: Crew home said a failed clock in plainly, but the job
// page's clock still showed "TypeError: Failed to fetch".
test('a failed clock in on the job page says so in plain words', async ({ context, page }) => {
  await signIn(context, { tables: { fh_contacts: [job('qa-user-1')], fh_time_punches: [] } })
  await context.route((url) => url.pathname === '/rest/v1/fh_time_punches', (route) => route.request().method() === 'POST' ? route.abort('failed') : route.fallback())
  await page.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await page.getByRole('button', { name: 'More about this job' }).click()
  const clockIn = page.getByRole('button', { name: /^Clock in/ })
  await expect(clockIn).toBeVisible({ timeout: 15_000 })
  await clockIn.click()
  const toaster = page.locator('[data-sonner-toaster]')
  await expectPlain(toaster, "Couldn't clock in")
  await expectPlain(toaster, 'No signal right now. Try again when the signal is back.')
})

// OPS-22: Log time and Keep running were 36 pixels high.
test('the job clock buttons are at least 44 pixels high', async ({ context, page }) => {
  await signIn(context, { tables: { fh_contacts: [job('qa-user-1')], fh_time_punches: [openPunch()] } })
  const clockOut = await openClock(page)
  expect((await clockOut.boundingBox())!.height).toBeGreaterThanOrEqual(44)
  await clockOut.click()
  for (const name of ['Log time', 'Keep running']) {
    const box = await page.getByRole('button', { name, exact: true }).boundingBox()
    expect(box!.height, name).toBeGreaterThanOrEqual(44)
  }
})

// A double tap on Clock in on the job card, while the location wait and the
// insert are still out, made a second punch. The one active shift index
// refused it and the card showed the running meter next to "Already on the
// clock". One tap is one punch, and the card says it is working.
test('a double tap on Clock in on the job card makes one punch and no false error', async ({ context, page }) => {
  test.setTimeout(60_000)
  await signIn(context, { tables: { fh_contacts: [job('qa-user-1')], fh_time_punches: [] } })
  const posts = postsTo(context, '/rest/v1/fh_time_punches')
  const started = new Date().toISOString()
  await holdPosts(context, '**/rest/v1/fh_time_punches*', 1200, (n) => n === 1
    ? { status: 201, json: { ...openPunch(), id: 'tp-new', punch_in_at: started, created_at: started, updated_at: started } }
    : { status: 409, json: { code: '23505', details: null, hint: null, message: 'duplicate key value violates unique constraint "fh_time_punches_one_active_per_user"' } })
  await page.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded', timeout: 20_000 })
  await page.getByRole('button', { name: 'More about this job' }).click()
  const clockIn = page.getByRole('button', { name: 'Clock in', exact: true })
  await expect(clockIn).toBeVisible({ timeout: 15_000 })
  await twoTaps(page, clockIn)
  // While the punch is out the button says so and takes no tap.
  const busy = page.getByRole('button', { name: 'Clocking in…', exact: true })
  const busyWhileOut = (await busy.count()) === 1 && await busy.isDisabled()
  await expect(page.getByRole('button', { name: 'Clock out', exact: true })).toBeVisible({ timeout: 15_000 })
  await page.waitForTimeout(1500)
  expect(posts.length, 'one tap, one punch').toBe(1)
  await expect(page.getByText('Already on the clock', { exact: true })).toHaveCount(0)
  expect(busyWhileOut, 'Clock in shows it is working').toBe(true)
})
