import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

const roster = [
  { id: 'm1', user_id: 'crew-alice', name: 'Alice Crew', role: 'crew' },
  { id: 'm2', user_id: 'crew-riley', name: 'Riley Foreman', role: 'foreman' }
]
async function setup(context: BrowserContext, page: Page, role = 'owner') {
  await signIn(context, { role, tables: { fh_schedule: [] } })
  await context.route('**/api/org-members-list', (route) => route.fulfill({ json: { ok: true, org_id: 'org-1', members: roster, invites: [], caller_role: role } }))
  await page.goto('/schedule/new')
  await page.getByLabel('Title', { exact: true }).fill('Foundation pour')
  await page.getByLabel('Date', { exact: true }).fill('2026-10-28')
  await page.getByLabel('Time', { exact: true }).fill('08:00')
}

test('searchable job picker preserves selection when search is cancelled', async ({ context, page }) => {
  await setup(context, page)
  const picker = page.getByRole('combobox', { name: 'Link to', exact: true })
  await picker.fill('bellevue')
  await expect(page.getByRole('option', { name: /Plumbing Bellevue/ })).toBeVisible()
  await picker.press('ArrowDown')
  await picker.press('Enter')
  await expect(picker).toHaveValue('Plumbing Bellevue')
  await picker.fill('unmatched record')
  await expect(page.getByText('No matching records')).toBeVisible()
  await picker.press('Escape')
  await expect(picker).toHaveValue('Plumbing Bellevue')
})

test('crew assignment saves every selected member on every recurring visit', async ({ context, page }) => {
  await setup(context, page, 'manager')
  let written: any[] = []
  await context.route('**/rest/v1/fh_schedule*', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    written = route.request().postDataJSON()
    return route.fulfill({ status: 201, json: written.map((_, index) => ({ id: `saved-${index}` })) })
  })
  await page.getByRole('checkbox', { name: /Alice Crew/ }).check()
  await page.getByRole('checkbox', { name: /Riley Foreman/ }).check()
  await page.getByRole('button', { name: 'Recurring series' }).click()
  await page.getByLabel('Total visits').fill('3')
  await page.getByRole('button', { name: 'Save event', exact: true }).click()
  await expect.poll(() => written.length).toBe(3)
  expect(written.every((row) => row.assigned_user_ids.join(',') === 'crew-alice,crew-riley')).toBe(true)
  expect(written.every((row) => row.assigned_to === 'crew-alice' && row.org_id === 'org-1')).toBe(true)
})


test('slow workspace loading cannot erase a new event draft', async ({ context, page }) => {
  await signIn(context, { role: 'manager', tables: { fh_schedule: [] } })
  let releaseMembership = () => {}
  const membershipReady = new Promise<void>((resolve) => { releaseMembership = resolve })
  await context.route('**/rest/v1/org_members*', async (route) => {
    await membershipReady
    return route.fallback()
  })
  await context.route('**/api/org-members-list', (route) => route.fulfill({
    json: { ok: true, org_id: 'org-1', members: roster, invites: [], caller_role: 'manager' }
  }))
  let written: any[] = []
  await context.route('**/rest/v1/fh_schedule*', async (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    written = route.request().postDataJSON()
    return route.fulfill({ status: 201, json: written.map((_, index) => ({ id: `saved-${index}` })) })
  })

  try {
    await page.goto('/schedule/new')
    await expect(page.getByRole('status').filter({ hasText: 'Loading your workspace' })).toBeVisible()
    await expect(page.getByLabel('Title', { exact: true })).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Save event', exact: true })).toBeDisabled()
  } finally {
    releaseMembership()
  }

  await page.getByLabel('Title', { exact: true }).fill('Foundation pour')
  await page.getByLabel('Where', { exact: true }).fill('North entrance')
  await page.getByLabel('Date', { exact: true }).fill('2026-10-28')
  await page.getByLabel('Time', { exact: true }).fill('08:00')
  await page.getByRole('checkbox', { name: /Alice Crew/ }).check()
  await page.getByRole('checkbox', { name: /Riley Foreman/ }).check()
  await page.getByRole('button', { name: 'Recurring series' }).click()
  await page.getByLabel('Total visits').fill('3')
  await page.getByRole('button', { name: 'Save event', exact: true }).click()

  await expect.poll(() => written.length).toBe(3)
  expect(written.every((row) => row.title === 'Foundation pour' && row.description === 'North entrance')).toBe(true)
  expect(written.every((row) => row.org_id === 'org-1' && row.assigned_user_ids.join(',') === 'crew-alice,crew-riley')).toBe(true)
})

test('a new conflict found while saving prevents all writes', async ({ context, page }) => {
  await setup(context, page)
  await page.getByRole('checkbox', { name: /Alice Crew/ }).check()
  let posts = 0
  await context.route('**/rest/v1/fh_schedule*', async (route) => {
    if (route.request().method() === 'POST') { posts++; return route.fulfill({ status: 201, json: [{ id: 'unexpected' }] }) }
    return route.fulfill({ json: [{ id: 'other-visit', org_id: 'org-1', title: 'Other site', assigned_to: 'crew-alice', assigned_user_ids: ['crew-alice'], start_at: '2026-10-28T13:00:00Z', end_at: '2026-10-28T14:00:00Z' }] })
  })
  await page.getByRole('button', { name: 'Save event', exact: true }).click()
  await expect(page.getByText('A selected crew member has a scheduling conflict. Choose another time or crew.').first()).toBeVisible()
  expect(posts).toBe(0)
  await expect(page).toHaveURL(/\/schedule\/new$/)
})

const isAvailabilityRead = (url: string) => /\/rest\/v1\/fh_schedule/.test(url) && (new URL(url).searchParams.get('select') || '').includes('assigned_user_ids')

test('a company of one sees no crew picker and still saves a visit', async ({ context, page }) => {
  await signIn(context, { tables: { fh_schedule: [] } })
  await context.route('**/api/org-members-list', (route) => route.fulfill({ json: { ok: true, org_id: 'org-1', members: roster.slice(0, 1), invites: [] } }))
  let written: any[] = []
  await context.route('**/rest/v1/fh_schedule*', async (route) => {
    if (route.request().method() === 'POST') { written = route.request().postDataJSON(); return route.fulfill({ status: 201, json: [{ id: 'saved' }] }) }
    if (isAvailabilityRead(route.request().url())) return route.fulfill({ status: 400, json: { message: 'column fh_schedule.assigned_user_ids does not exist', code: '42703' } })
    return route.fallback()
  })
  const rosterRead = page.waitForResponse('**/api/org-members-list')
  await page.goto('/schedule/new')
  await rosterRead
  await page.getByLabel('Title', { exact: true }).fill('Solo inspection')
  await expect(page.getByLabel('Duration in minutes')).toBeVisible()
  await expect(page.getByRole('region', { name: 'Crew allocation' })).toHaveCount(0)
  await expect(page.getByText(/Crew scheduling unavailable|Availability could not be verified/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Save event', exact: true }).click()
  await expect.poll(() => written.length).toBe(1)
  expect(written[0]).not.toHaveProperty('assigned_user_ids')
})

test('a missing crew column hides the crew picker without a warning and the visit still saves', async ({ context, page }) => {
  await signIn(context, { tables: { fh_schedule: [] } })
  await context.route('**/api/org-members-list', (route) => route.fulfill({ json: { ok: true, org_id: 'org-1', members: roster, invites: [] } }))
  let written: any[] = []
  await context.route('**/rest/v1/fh_schedule*', async (route) => {
    if (route.request().method() === 'POST') { written = route.request().postDataJSON(); return route.fulfill({ status: 201, json: [{ id: 'saved' }] }) }
    if (isAvailabilityRead(route.request().url())) return route.fulfill({ status: 400, json: { message: 'column fh_schedule.assigned_user_ids does not exist', code: '42703' } })
    return route.fallback()
  })
  const availabilityRead = page.waitForResponse((response) => isAvailabilityRead(response.url()))
  await page.goto('/schedule/new')
  await page.getByLabel('Title', { exact: true }).fill('Unassigned inspection')
  await availabilityRead
  await expect(page.getByRole('region', { name: 'Crew allocation' })).toHaveCount(0)
  await expect(page.getByText(/Crew scheduling unavailable|Availability could not be verified/)).toHaveCount(0)
  await page.getByRole('button', { name: 'Save event', exact: true }).click()
  await expect.poll(() => written.length).toBe(1)
  expect(written[0]).not.toHaveProperty('assigned_user_ids')
})

// Production lacks the crew column until its migration is applied. Each
// date or time change asked again and logged a 400 (vibe audit console-3).
test('a missing crew column is asked about once while a visit is set up', async ({ context, page }) => {
  await signIn(context, { tables: { fh_schedule: [] } })
  await context.route('**/api/org-members-list', (route) => route.fulfill({ json: { ok: true, org_id: 'org-1', members: roster, invites: [] } }))
  let asked = 0
  await context.route('**/rest/v1/fh_schedule*', async (route) => {
    if (!isAvailabilityRead(route.request().url())) return route.fallback()
    asked += 1
    return route.fulfill({ status: 400, json: { message: 'column fh_schedule.assigned_user_ids does not exist', code: '42703' } })
  })
  const failures: string[] = []
  page.on('console', (message) => { if (message.type() === 'error' && /status of 400/.test(message.text())) failures.push(message.text()) })
  const availabilityRead = page.waitForResponse((response) => isAvailabilityRead(response.url()))
  await page.goto('/schedule/new')
  await page.getByLabel('Title', { exact: true }).fill('Unassigned inspection')
  await availabilityRead
  for (const day of ['2026-12-01', '2026-12-02', '2026-12-03']) {
    await page.getByLabel('Date', { exact: true }).fill(day)
    await page.waitForTimeout(600)
  }
  for (const time of ['08:00', '09:30']) {
    await page.getByLabel('Time', { exact: true }).fill(time)
    await page.waitForTimeout(600)
  }
  await expect(page.getByRole('region', { name: 'Crew allocation' })).toHaveCount(0)
  expect(asked).toBe(1)
  expect(failures.length).toBeLessThanOrEqual(1)
})

test('a failed availability read for a team still says so and permits an unassigned visit', async ({ context, page }) => {
  await signIn(context, { tables: { fh_schedule: [] } })
  await context.route('**/api/org-members-list', (route) => route.fulfill({ json: { ok: true, org_id: 'org-1', members: roster, invites: [] } }))
  let written: any[] = []
  await context.route('**/rest/v1/fh_schedule*', async (route) => {
    if (route.request().method() === 'POST') { written = route.request().postDataJSON(); return route.fulfill({ status: 201, json: [{ id: 'saved' }] }) }
    if (isAvailabilityRead(route.request().url())) return route.fulfill({ status: 500, json: { message: 'upstream request timeout' } })
    return route.fallback()
  })
  await page.goto('/schedule/new')
  await page.getByLabel('Title', { exact: true }).fill('Unassigned inspection')
  await expect(page.getByText(/Crew scheduling unavailable/)).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Alice Crew/ })).toBeDisabled()
  await page.getByRole('button', { name: 'Save event', exact: true }).click()
  await expect.poll(() => written.length).toBe(1)
  expect(written[0]).not.toHaveProperty('assigned_user_ids')
})

test('crew role cannot allocate teammates', async ({ context, page }) => {
  await setup(context, page, 'crew')
  await expect(page.getByText('Only an owner, admin or manager can assign crew or move an assigned visit.')).toBeVisible()
  await expect(page.getByRole('checkbox', { name: /Alice Crew/ })).toBeDisabled()
})
