import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { USER } from '../../scripts/qa-mock.mjs'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'

test('phone note actions fit, support keyboard archive and confirm both delete paths', async ({ context, page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone report actions')
  await page.setViewportSize({ width: 320, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const notes = ['Visible deletion', 'Swipe deletion', 'Keyboard archive'].map((text, index) => ({
    id: `action-note-${index}`, user_id: USER.id, text, contact_id: null,
    created_at: new Date().toISOString(), done: false, parsed: null,
  }))
  await signIn(context, { tables: { fh_notes: notes } })
  const deleted: string[] = []
  const archived: Record<string, unknown>[] = []
  page.on('request', request => {
    if (!request.url().includes('/rest/v1/fh_notes')) return
    if (request.method() === 'DELETE') deleted.push(request.url())
    if (request.method() === 'PATCH') archived.push(request.postDataJSON())
  })
  await page.goto('/notes')
  const history = page.getByRole('group', { name: 'Recent activity' })
  const visibleRow = history.getByRole('article').filter({ hasText: 'Visible deletion' })
  const deleteButton = visibleRow.getByRole('button', { name: 'Delete note', exact: true })
  await expect(deleteButton).toBeVisible()
  const bounds = await deleteButton.boundingBox()
  expect(bounds?.width).toBeGreaterThanOrEqual(44)
  expect(bounds?.height).toBeGreaterThanOrEqual(44)
  await deleteButton.click()
  await expect(visibleRow.getByRole('button', { name: 'Tap again to delete', exact: true })).toBeVisible()
  expect(deleted).toHaveLength(0)
  await nothingRunsOffTheSide(page, 'Armed note deletion at 320 pixels')
  await visibleRow.getByRole('button', { name: 'Tap again to delete', exact: true }).click()
  await expect(visibleRow).toHaveCount(0)
  expect(deleted).toHaveLength(1)

  const swipeRow = history.getByRole('article').filter({ hasText: 'Swipe deletion' })
  await swipeRow.scrollIntoViewIfNeeded()
  const swipeBounds = await swipeRow.boundingBox()
  expect(swipeBounds).not.toBeNull()
  const startX = swipeBounds!.x + swipeBounds!.width - 70
  const startY = swipeBounds!.y + 20
  await page.mouse.move(startX, startY)
  await page.mouse.down()
  await page.mouse.move(startX - 120, startY, { steps: 12 })
  await page.mouse.up()
  const revealed = swipeRow.locator('..').locator('..').locator('[aria-hidden="false"]')
  await revealed.getByRole('button', { name: 'Delete note', exact: true }).click()
  await expect(swipeRow.getByRole('button', { name: 'Tap again to delete', exact: true })).toBeVisible()
  expect(deleted).toHaveLength(1)
  await swipeRow.getByRole('button', { name: 'Tap again to delete', exact: true }).click()
  await expect(swipeRow).toHaveCount(0)
  expect(deleted).toHaveLength(2)

  const archiveRow = history.getByRole('article').filter({ hasText: 'Keyboard archive' })
  await archiveRow.getByRole('button', { name: 'Archive note', exact: true }).press('Enter')
  await expect(archiveRow).toHaveCount(0)
  expect(archived).toEqual([{ done: true }])
})

test('desktop customer directory reaches every record while preserving search and filter', async ({ context, page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-chrome', 'Desktop directory formerly capped at 60')
  const clients = Array.from({ length: 153 }, (_, index) => ({
    id: `client-${index + 1}`, user_id: USER.id, name: `Customer ${String(index + 1).padStart(3, '0')}`,
    phone: null, email: null, created_at: new Date().toISOString(), last_activity_at: new Date().toISOString(),
  }))
  await signIn(context, { tables: { fh_clients: clients, fh_contacts: [], fh_leads: [], fh_quotes: [] } })
  await page.goto('/clients?filter=recent&q=Customer')
  const rows = page.locator('.fh-build-table__row.is-clients')
  await expect(rows).toHaveCount(60)
  await page.getByRole('button', { name: 'Load more clients' }).click()
  await expect(rows).toHaveCount(120)
  await page.getByRole('button', { name: 'Load more clients' }).click()
  await expect(rows).toHaveCount(153)
  await expect(page.getByRole('button', { name: 'Load more clients' })).toHaveCount(0)
  await expect(page.getByRole('searchbox', { name: 'Search clients' }).or(page.getByRole('textbox', { name: 'Search clients' }))).toHaveValue('Customer')
  await expect(page).toHaveURL(/filter=recent&q=Customer/)
  await page.getByLabel('Search clients', { exact: true }).fill('Customer 153')
  await expect(rows).toHaveCount(1)
  await expect(rows.first()).toContainText('Customer 153')
  await page.reload()
  await expect(rows).toHaveCount(1)
  await expect(page.getByLabel('Search clients', { exact: true })).toHaveValue('Customer 153')
})

test('report history reaches past 80 reports, searches old scope and expands full text on both layouts', async ({ context, page }, testInfo) => {
  const fullText = `Report 84. ${'Inspection detail. '.repeat(30)}Final hidden instruction: check north footing.`
  const jobs = [
    { id: 'job-one', user_id: USER.id, name: 'Sam Lane', job_title: 'Roof repairs', address: '10 Oak Street', stage: 'job' },
    { id: 'job-two', user_id: USER.id, name: 'Sam Lane', job_title: 'Drainage', address: '20 Oak Street', stage: 'job' },
  ]
  const notes = Array.from({ length: 84 }, (_, index) => ({
    id: `note-${String(index + 1).padStart(3, '0')}`, user_id: USER.id,
    text: index === 83 ? fullText : `Report ${index + 1}. Site check completed.`,
    contact_id: index === 83 ? null : index === 82 ? 'job-two' : 'job-one',
    created_at: new Date(Date.now() - (index + 1) * 86400000).toISOString(), done: false,
    parsed: index === 83 ? { summary: 'Earlier inspection', risks: ['Rain could delay concrete'], materials_needed: ['Copper pipe'] } : null,
  }))
  await signIn(context, { tables: { fh_notes: notes, fh_contacts: jobs } })
  await page.goto('/notes')
  const history = page.getByRole(testInfo.project.name === 'desktop-chrome' ? 'region' : 'group', { name: testInfo.project.name === 'desktop-chrome' ? 'Latest reports' : 'Recent activity' })
  await expect(history.locator('details')).toHaveCount(12)
  await expect(page.getByText('Showing 12 of 84 reports. Newest first.', { exact: true })).toBeVisible()
  await expect(page.getByLabel('Field report', { exact: true })).toBeVisible()
  const picker = page.getByRole('combobox', { name: /Link.*job/ })
  await picker.fill('Sam Lane')
  await expect(page.getByRole('option', { name: /Roof repairs.*10 Oak Street/ })).toBeVisible()
  await expect(page.getByRole('option', { name: /Drainage.*20 Oak Street/ })).toBeVisible()
  await picker.press('Escape')
  if (testInfo.project.name === 'desktop-chrome') {
    await expect(page.locator('.fh-build-mini').filter({ hasText: 'Unlinked, all reports' }).locator('strong')).toHaveText('1')
  }
  await page.getByRole('button', { name: 'Load more reports' }).click()
  await expect(history.locator('details')).toHaveCount(24)
  await page.getByRole('searchbox', { name: 'Search reports' }).fill('copper')
  await expect(history.locator('details')).toHaveCount(1)
  await history.getByText('Read full report', { exact: true }).click()
  await expect(history.locator('details')).toHaveAttribute('open', '')
  await expect(history.locator('details')).toContainText('Final hidden instruction: check north footing.')
  await expect(history.locator('details').getByText('Copper pipe', { exact: true })).toBeVisible()
  await page.getByRole('searchbox', { name: 'Search reports' }).fill('20 Oak Street')
  await expect(history.locator('details')).toHaveCount(1)
  await expect(history).toContainText('Report 83.')
  await page.getByRole('searchbox', { name: 'Search reports' }).fill('no matching text')
  await expect(history).toContainText('No reports match your search.')
  await expect(page.getByRole('button', { name: 'Load more reports' })).toHaveCount(0)
})

test('Estimates exposes quotes and finds a saved template by search plus job type', async ({ context, page }) => {
  const templates = Array.from({ length: 64 }, (_, index) => ({
    id: `template-${index}`, user_id: USER.id, name: index === 63 ? 'Copper drainage detail' : `Saved scope ${index}`,
    description: 'Reusable site work', job_type: index === 63 ? 'Drainage' : 'Concrete',
    line_items: [{ name: index === 63 ? 'Copper pipe' : 'Concrete', qty: 1, unit: 'ft', rate_low: 10, rate_high: 20 }],
    total_low: 10, total_high: 20, created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-10T12:00:00Z',
  }))
  await signIn(context, { tables: { fh_estimate_templates: templates } })
  await page.goto('/bid')
  await expect(page.getByRole('heading', { level: 1, name: 'Estimates', exact: true })).toBeVisible()
  await expect(page.getByRole('link', { name: 'All quotes', exact: true })).toHaveAttribute('href', '/bid?view=quotes')
  await expect(page.getByRole('link', { name: 'New quote', exact: true })).toHaveAttribute('href', '/quotes/new')
  await page.getByRole('button', { name: 'Browse all', exact: true }).click()
  await page.getByRole('searchbox', { name: 'Search templates' }).fill('copper')
  const browser = page.locator('#estimate-template-browser')
  await expect(browser.getByRole('listitem')).toHaveCount(1)
  await page.getByRole('combobox', { name: 'Template job type' }).selectOption('Concrete')
  await expect(browser).toContainText('No templates match.')
  await page.getByRole('combobox', { name: 'Template job type' }).selectOption('Drainage')
  await expect(browser.getByRole('listitem')).toHaveCount(1)
  await expect(browser).toContainText('Units: ft')
  await browser.getByRole('button', { name: 'Load', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Estimate scope' })).toHaveValue('Loaded from template: Copper drainage detail')
})

test('Import explains its destination and keeps developer setup collapsed', async ({ context, page }) => {
  await signIn(context, { tables: { fh_leads: [] } })
  await page.goto('/import')
  await expect(page.getByRole('link', { name: 'Open lead workspace', exact: true }).first()).toHaveAttribute('href', '/jobs?stage=leads')
  const setup = page.locator('details').filter({ hasText: 'Automation and developer setup' })
  await expect(setup).not.toHaveAttribute('open')
  await expect(setup.getByText('Example lead details')).not.toBeVisible()
  await page.locator('input[type="file"]').setInputFiles({ name: 'leads.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Phone,Job Title\nJeff Roy,555-0101,New drainage\n') })
  await page.getByRole('button', { name: 'Import 1 contact', exact: true }).click()
  await expect(page.getByRole('link', { name: 'View imported leads', exact: true })).toHaveAttribute('href', '/jobs?stage=leads')
})


test('customer directory restores loaded rows, sorting and position after opening a customer', async ({ context, page }, testInfo) => {
  const desktop = testInfo.project.name === 'desktop-chrome'
  // Distinct activity times put customer 070 in the second window on both
  // layouts; equal times fall back to ID ordering, not the displayed name.
  const latestActivity = Date.UTC(2026, 9, 27, 12)
  const clients = Array.from({ length: 153 }, (_, index) => ({
    id: `return-client-${index + 1}`, user_id: USER.id, name: `Return customer ${String(index + 1).padStart(3, '0')}`,
    created_at: new Date(latestActivity - index * 60_000).toISOString(),
    last_activity_at: new Date(latestActivity - index * 60_000).toISOString(),
  }))
  await signIn(context, { tables: { fh_clients: clients, fh_contacts: [], fh_leads: [], fh_quotes: [] } })
  await page.goto('/clients?q=Return')
  if (desktop) await page.getByRole('button', { name: 'Sort by Client', exact: true }).click()
  await page.getByRole('button', { name: desktop ? 'Load more clients' : 'Load more customers', exact: true }).click()
  const target = page.getByRole('button', { name: /Return customer 070/ })
  await target.scrollIntoViewIfNeeded()
  const scrollBefore = await page.evaluate(() => window.scrollY)
  await target.click()
  await expect(page).toHaveURL(/clients\/return-client-70$/)
  await page.goBack()
  await expect(target).toBeVisible()
  await expect.poll(async () => Math.abs(await page.evaluate(() => window.scrollY) - scrollBefore)).toBeLessThan(100)
  if (desktop) await expect(page.getByRole('button', { name: 'Sort by Client', exact: true })).toHaveAccessibleDescription('Sorted ascending')
})

test('report history filters by local dates, linkage and a specific job', async ({ context, page }, testInfo) => {
  const jobs = [{ id: 'history-job', user_id: USER.id, name: 'Sam Lane', job_title: 'Footing', address: '10 Oak Street', stage: 'job' }]
  const notes = [
    { id: 'one', user_id: USER.id, text: 'October linked report', contact_id: 'history-job', created_at: '2026-10-15T15:00:00Z' },
    { id: 'two', user_id: USER.id, text: 'October unlinked report', contact_id: null, created_at: '2026-10-20T15:00:00Z' },
    { id: 'three', user_id: USER.id, text: 'September report', contact_id: 'history-job', created_at: '2026-09-20T15:00:00Z' },
  ]
  await signIn(context, { tables: { fh_notes: notes, fh_contacts: jobs } })
  await page.goto('/notes')
  const history = page.getByRole(testInfo.project.name === 'desktop-chrome' ? 'region' : 'group', { name: testInfo.project.name === 'desktop-chrome' ? 'Latest reports' : 'Recent activity' })
  await page.getByLabel('From date', { exact: true }).fill('2026-10-01')
  await page.getByLabel('Through date', { exact: true }).fill('2026-10-31')
  await expect(history.locator('details')).toHaveCount(2)
  await page.getByRole('combobox', { name: 'Job link', exact: true }).selectOption('unlinked')
  await expect(history.locator('details')).toHaveCount(1)
  await expect(history).toContainText('October unlinked report')
  await page.reload()
  await expect(history.locator('details')).toHaveCount(1)
  await page.getByRole('button', { name: 'Clear history filters' }).click()
  await page.getByRole('combobox', { name: 'History job', exact: true }).fill('Footing')
  await page.getByRole('option', { name: /Sam Lane.*Footing/ }).click()
  await expect(history.locator('details')).toHaveCount(2)
  await expect(history).not.toContainText('October unlinked report')
})


test('failed job lookup does not classify every report as an unavailable job', async ({ context, page }, testInfo) => {
  const job = { id: 'lookup-job', user_id: USER.id, name: 'Sam Lane', job_title: 'Footing', address: '10 Oak Street', stage: 'job' }
  await signIn(context, { tables: { fh_contacts: [job], fh_notes: [{ id: 'lookup-note', user_id: USER.id, text: 'Preserved footing report', contact_id: job.id, created_at: '2026-10-15T15:00:00Z' }] } })
  let fail = true
  await context.route('**/rest/v1/fh_contacts?**', route => {
    const select = new URL(route.request().url()).searchParams.get('select') || ''
    if (fail && select.replace(/\s/g, '') === 'id,name,job_title,address,updated_at') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'lookup failed' }) })
    return route.fallback()
  })
  await page.goto('/notes?linkage=unavailable')
  const history = page.getByRole(testInfo.project.name === 'desktop-chrome' ? 'region' : 'group', { name: testInfo.project.name === 'desktop-chrome' ? 'Latest reports' : 'Recent activity' })
  await expect(page.getByRole('button', { name: 'Retry job lookup', exact: true })).toBeVisible()
  await expect(page.getByRole('combobox', { name: 'History job', exact: true })).toBeDisabled()
  await expect(history).toContainText('Unavailable job filtering is paused.')
  await expect(history.locator('details')).toHaveCount(1)
  fail = false
  await page.getByRole('button', { name: 'Retry job lookup', exact: true }).click()
  await expect(page.getByRole('combobox', { name: 'History job', exact: true })).toBeEnabled()
  await expect(history.locator('details')).toHaveCount(0)
})
