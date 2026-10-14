import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

// The job page's time clock (TimeClockCard) when the shift it shows was
// ended somewhere else first. Clock out never moves an ended shift's end
// time (D49), so the card has to say the shift is over and stop its meter,
// not keep failing on every Log time tap.

test.skip(({ isMobile }) => !isMobile, 'the time clock card is checked on a phone')

const HOUR = 3600e3
const OTHER_OWNER = 'qa-owner-2'

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
