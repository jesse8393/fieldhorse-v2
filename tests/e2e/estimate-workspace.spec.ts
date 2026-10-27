import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { USER, restResponse } from '../../scripts/qa-mock.mjs'

async function openSection(page: Page, id: string) {
  await page.getByRole('combobox', { name: 'Job section', exact: true }).selectOption(id)
}

test('Estimates manages existing quotes with search, lifecycle filters and direct previews', async ({ context, page }) => {
  const base = { org_id: 'org-1', user_id: USER.id, client_id: 'cl-one', amount: 1200.49, title: 'Copper drainage', status: 'draft', updated_at: '2026-10-27T12:00:00Z', created_at: '2026-10-01T12:00:00Z', fh_clients: { id: 'cl-one', name: 'Lane family' } }
  await signIn(context, { tables: { fh_quotes: [
    { ...base, id: 'q-draft' }, { ...base, id: 'q-sent', title: 'North footing', status: 'sent' },
    { ...base, id: 'q-converted', title: 'Accepted roof', status: 'approved', job_id: 'c-job1' },
    { ...base, id: 'q-other', org_id: 'other', title: 'Other company private quote' }
  ] } })
  await page.goto('/bid?view=quotes')
  const list = page.getByRole('list', { name: 'Estimate quotes' })
  await expect(list.getByRole('listitem')).toHaveCount(3)
  await expect(list).not.toContainText('Other company private quote')
  await expect(list.getByText('$1,200.49').first()).toBeVisible()
  await page.getByRole('combobox', { name: 'Quote status' }).selectOption('waiting')
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(list).toContainText('North footing')
  await page.reload()
  await expect(page.getByRole('combobox', { name: 'Quote status' })).toHaveValue('waiting')
  await page.getByRole('combobox', { name: 'Quote status' }).selectOption('all')
  await page.getByRole('searchbox', { name: 'Search quotes' }).fill('copper')
  await expect(list.getByRole('listitem')).toHaveCount(1)
  await expect(list.getByRole('link', { name: 'Preview Copper drainage' })).toHaveAttribute('href', '/quotes/q-draft/preview')
  await expect(list.getByRole('link', { name: 'Continue editing' })).toHaveAttribute('href', '/quotes/q-draft')
  await page.getByRole('searchbox', { name: 'Search quotes' }).fill('absent')
  await expect(page.getByRole('heading', { name: 'No matching quotes' })).toBeVisible()
  await page.getByRole('button', { name: 'Clear search and status' }).click()
  await expect(list.getByRole('listitem')).toHaveCount(3)
})

test('personal favorites and imported reference classification survive reload and preserve unrelated preferences', async ({ context, page }) => {
  const profile = { user_id: USER.id, org_id: 'org-1', full_name: 'Tester', company_name: 'Field Company', onboarded_at: '2026-01-01T12:00:00Z', preferences: { quote_follow_up: { enabled: true, days: 5 } } }
  await signIn(context, { tables: { profiles: [profile], fh_estimate_templates: [
    { id: 'template-one', user_id: USER.id, name: 'Copper drainage', description: 'Reusable drainage scope', job_type: 'Concrete', line_items: [{ name: 'Copper pipe', qty: 1, unit: 'ft', rate_low: 10, rate_high: 20 }], total_low: 10, total_high: 20, created_at: '2026-01-01T12:00:00Z', updated_at: '2026-10-27T12:00:00Z' }
  ] } })
  let stored = { ...profile }
  await context.route('**/rest/v1/profiles*', async route => {
    const request = route.request()
    if (request.method() === 'PATCH') stored = { ...stored, ...request.postDataJSON() }
    const response = restResponse(request.url(), { method: request.method(), headers: request.headers(), tables: { profiles: [stored] } })
    // The generic mock does not implement JSONB equality. Apply the compare against our current profile before updating in production; unit tests cover the conflict branch.
    if (request.method() === 'PATCH') await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ user_id: USER.id }) })
    else await route.fulfill({ status: response.status, contentType: 'application/json', body: response.body })
  })
  await page.goto('/bid?view=templates')
  await page.getByRole('button', { name: 'Favorite Copper drainage', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Remove favorite Copper drainage' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('combobox', { name: 'Category for Copper drainage' }).selectOption('imported')
  await expect(page.getByRole('combobox', { name: 'Category for Copper drainage' })).toHaveValue('imported')
  await page.reload()
  await expect(page.getByRole('button', { name: 'Remove favorite Copper drainage' })).toHaveAttribute('aria-pressed', 'true')
  await page.getByRole('combobox', { name: 'Library view' }).selectOption('imported')
  await expect(page.locator('#estimate-template-browser').getByRole('listitem')).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Library view' }).selectOption('reusable')
  await expect(page.locator('#estimate-template-browser')).toContainText('No templates match.')
  expect(stored.preferences.quote_follow_up).toEqual({ enabled: true, days: 5 })
})

test('job sections open directly and keep selection on refresh without nested tablists', async ({ context, page }) => {
  await signIn(context)
  await page.goto('/jobs/c-job1')
  await openSection(page, 'tasks')
  await expect(page).toHaveURL(/tab=tasks/)
  await expect(page.getByRole('region', { name: 'Tasks workspace', exact: true })).toBeVisible()
  await expect(page.getByRole('tablist')).toHaveCount(0)
  await page.reload()
  await expect(page.getByRole('region', { name: 'Tasks workspace', exact: true })).toBeVisible()
  await openSection(page, 'draws')
  await expect(page).toHaveURL(/tab=draws/)
  await expect(page.getByRole('region', { name: 'Invoices workspace', exact: true })).toBeVisible()
  await page.goto('/jobs/c-job1?tab=files')
  await expect(page.getByRole('region', { name: 'Photos workspace', exact: true })).toBeVisible()
  await openSection(page, 'documents')
  await expect(page.getByRole('region', { name: 'Files workspace', exact: true })).toBeVisible()
})

test('field roles cannot navigate to money sections through the section selector or a deep link', async ({ context, page }) => {
  await signIn(context, { role: 'crew' })
  await page.goto('/jobs/c-job1?tab=insurance')
  await expect(page.getByRole('region', { name: 'Activity workspace', exact: true })).toBeVisible()
  const select = page.getByRole('combobox', { name: 'Job section' })
  await expect(select.locator('option[value="draws"]')).toHaveCount(0)
  await expect(select.locator('option[value="insurance"]')).toHaveCount(0)
  await expect(select.locator('option[value="financials"]')).toHaveText('Expenses')
})
