import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'

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
