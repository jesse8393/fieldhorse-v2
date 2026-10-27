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

test('missing crew schema blocks allocation but permits an unassigned visit', async ({ context, page }) => {
  await signIn(context, { tables: { fh_schedule: [] } })
  await context.route('**/api/org-members-list', (route) => route.fulfill({ json: { ok: true, org_id: 'org-1', members: roster, invites: [] } }))
  let written: any[] = []
  await context.route('**/rest/v1/fh_schedule*', async (route) => {
    if (route.request().method() === 'POST') { written = route.request().postDataJSON(); return route.fulfill({ status: 201, json: [{ id: 'saved' }] }) }
    if (new URL(route.request().url()).searchParams.get('select')?.includes('assigned_user_ids')) return route.fulfill({ status: 400, json: { message: 'column does not exist', code: '42703' } })
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
