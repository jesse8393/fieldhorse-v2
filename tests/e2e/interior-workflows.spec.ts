import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

const NOW = '2026-11-02T14:00:00.000Z'
const quotes = ['draft', 'sent', 'approved', 'changes_requested', 'sent'].map((status, i) => ({
  id: `interior-q${i}`, org_id: 'org-1', user_id: 'qa-user-1', client_id: 'cl-1',
  title: ['Patio scope', 'Roof replacement', 'Kitchen remodel', 'Framing revision', 'Expired deck'][i],
  scope_text: i === 0 ? 'Cedar framing and trim' : 'Defined project scope',
  amount: 1000 + i * 500, status, created_at: NOW, updated_at: NOW, sent_at: status === 'draft' ? null : NOW,
  expires_at: i === 2 || i === 4 ? '2026-11-01T14:00:00.000Z' : null,
  fh_clients: { id: 'cl-1', name: 'Morgan Davis' }
}))

test('quote filters, search, URL restoration and clear action use real inventory', async ({ context, page }) => {
  await signIn(context, { tables: { fh_quotes: quotes } })
  await page.clock.setFixedTime(new Date(NOW))
  await page.goto('/quotes')
  const rows = page.getByRole('list', { name: 'Quotes', exact: true })
  await expect(rows.locator('li')).toHaveCount(5)
  await page.getByRole('group', { name: 'Filter quotes' }).getByRole('button', { name: /^Needs attention/ }).click()
  await expect(rows.locator('li')).toHaveCount(2)
  await expect(rows).toContainText('Framing revision')
  await expect(rows).toContainText('Expired deck')
  await page.getByRole('searchbox', { name: 'Search quotes' }).fill('expired')
  await expect(rows.locator('li')).toHaveCount(1)
  await page.reload()
  await expect(page.getByRole('searchbox', { name: 'Search quotes' })).toHaveValue('expired')
  await expect(rows.locator('li')).toHaveCount(1)
  await page.getByRole('searchbox', { name: 'Search quotes' }).fill('nothing matches')
  await expect(page.getByText('No matching quotes', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click()
  await expect(page.getByRole('searchbox', { name: 'Search quotes' })).toBeFocused()
  await expect(rows.locator('li')).toHaveCount(5)
  await page.getByRole('group', { name: 'Filter quotes' }).getByRole('button', { name: /^Approved/ }).click()
  await expect(rows).toContainText('Kitchen remodel')
})

test('failed quote reads show recovery instead of an empty inventory', async ({ context, page }) => {
  await signIn(context, { tables: { fh_quotes: quotes } })
  let fail = true
  // A server read failure exercises recovery without the SDK's separate 503 backoff.
  await context.route('**/rest/v1/fh_quotes?*', route => fail ? route.fulfill({ status: 500, json: { message: 'Temporarily unavailable' } }) : route.fallback())
  await page.goto('/quotes')
  await expect(page.getByText('Could not load quotes', { exact: true })).toBeVisible()
  await expect(page.getByText('No quotes yet.', { exact: true })).toHaveCount(0)
  fail = false
  await page.getByRole('button', { name: /Try again|Retry/ }).click()
  await expect(page.getByRole('list', { name: 'Quotes', exact: true }).locator('li')).toHaveCount(5)
})

test('workspace checklist reads saved records and opens the matching work', async ({ context, page }) => {
  await signIn(context, { tables: { fh_contacts: [], fh_schedule: [] } })
  await page.goto('/learn')
  const checklist = page.getByRole('region', { name: 'Ready for your next workday.' })
  await expect(checklist.getByText('1 of 3 ready')).toBeVisible()
  await checklist.getByRole('link', { name: 'Start: Give your work a home' }).click()
  await expect(page.getByRole('heading', { name: 'New job', exact: true })).toBeVisible()
})

test('setup steps reflect entered details and support keyboard navigation', async ({ context, page }) => {
  await signIn(context, { tables: { profiles: [{ user_id: 'qa-user-1', company_name: '', onboarded_at: null, services: [] }] } })
  await page.goto('/onboarding')
  const steps = page.getByRole('navigation', { name: 'Workspace setup sections' })
  await expect(steps.getByRole('link', { name: 'Company Required' })).toBeVisible()
  await page.getByLabel('Company name', { exact: true }).fill('Oak & Stone')
  await expect(steps.getByRole('link', { name: 'Company Added' })).toBeVisible()
  await steps.getByRole('link', { name: 'Services Required' }).focus()
  await page.keyboard.press('Enter')
  await expect(page.locator('#setup-services')).toBeFocused()
  await page.getByRole('button', { name: 'Framing', exact: true }).click()
  await expect(steps.getByRole('link', { name: 'Services Added' })).toBeVisible()
  await expect(steps.getByRole('link', { name: 'Location Optional' })).toBeVisible()
  await expect(page.getByLabel('Company name', { exact: true })).toHaveValue('Oak & Stone')
})

test('field roles receive guides without owner checklist queries', async ({ context, page }) => {
  await signIn(context, { role: 'crew' })
  const reads: string[] = []
  page.on('request', request => { if (/rest\/v1\/fh_(contacts|schedule|quotes)/.test(request.url())) reads.push(request.url()) })
  await page.goto('/learn?guide=day')
  await expect(page.getByRole('heading', { name: 'Build a day that works.', exact: true })).toBeVisible()
  await expect(page.locator('#workspace-checklist')).toHaveCount(0)
  expect(reads).toEqual([])
})

test('new invoice and calendar creation stay within existing forms', async ({ context, page }) => {
  await signIn(context)
  await page.goto('/invoices')
  await page.getByRole('link', { name: 'New invoice', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'New invoice', exact: true })).toBeVisible()
  await page.goto('/schedule')
  const toolbar = page.locator('.fhsch-toolbar, .fhs-screen-head')
  await toolbar.getByRole('button', { name: 'New event', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Add event', exact: true })).toBeVisible()
})

test('phone date navigation can return directly to today', async ({ context, page }) => {
  await signIn(context)
  await page.setViewportSize({ width: 390, height: 844 })
  await page.clock.setFixedTime(new Date(NOW))
  await page.goto('/schedule?d=2026-11-09')
  await expect(page.locator('.fhs-screen-head').locator('..')).toHaveCSS('opacity', '1')
  await page.getByRole('button', { name: 'Today', exact: true }).click()
  await expect(page.locator('.fhev-week-strip button[aria-pressed="true"]')).toContainText('2')
})

test('next stop photos keep project text and actions readable', async ({ context, page }, testInfo) => {
  await signIn(context, { tables: { fh_schedule: [{ id: 'photo-visit', user_id: 'qa-user-1', org_id: 'org-1', contact_id: 'c-job1', title: 'Framing review', start_at: '2026-11-02T15:30:00Z', end_at: '2026-11-02T16:30:00Z' }] } })
  await page.clock.setFixedTime(new Date(NOW))
  await context.route('**/rest/v1/fh_contacts?*', route => {
    if (!new URL(route.request().url()).searchParams.get('select')?.includes('fh_job_files')) return route.fallback()
    return route.fulfill({ json: [{ id: 'c-job1', fh_job_files: [{ storage_path: 'qa/site.webp', uploaded_at: NOW }] }] })
  })
  await context.route('**/storage/v1/object/sign/job-photos', route => route.fulfill({ json: [{ path: 'qa/site.webp', signedURL: '/object/sign/job-photos/qa/site.webp?token=sample', error: null }] }))
  await context.route('**/storage/v1/object/sign/job-photos/qa/site.webp?*', route => route.fulfill({ contentType: 'image/webp', body: readFileSync('public/media/fieldhorse-craft.webp') }))
  await page.goto('/')
  const card = page.getByRole('region', { name: 'Next stop' })
  await expect.poll(() => card.locator('img').evaluate(img => (img as HTMLImageElement).naturalWidth)).toBeGreaterThan(0)
  const text = await card.locator('.fhc-photo__text').boundingBox()
  expect(text!.width).toBeGreaterThan(150)
  for (const name of ['Open job', 'Navigate']) {
    const button = card.getByRole('link', { name, exact: true })
    await expect(button).toBeVisible()
    const box = await button.boundingBox()
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(page.viewportSize()!.width)
  }
  await card.screenshot({ path: testInfo.outputPath('next-stop-photo.png') })
  await card.getByRole('link', { name: 'Open job', exact: true }).click()
  await expect(page).toHaveURL(/\/jobs\/c-job1$/)
})

test('photo batch feedback tracks actual processing and confirmed writes', async ({ context, page }) => {
  await signIn(context)
  const rows: Record<string, unknown>[] = []
  let release: () => void = () => {}
  const gate = new Promise<void>(resolve => { release = resolve })
  await context.route(url => url.pathname.startsWith('/storage/v1/object/job-photos/'), async route => {
    await gate
    await route.fulfill({ status: 200, json: { Key: 'job-photos/photo.jpg' } })
  })
  await context.route('**/rest/v1/fh_job_files?*', route => route.request().method() === 'GET' ? route.fulfill({ json: rows }) : route.fallback())
  await context.route('**/rest/v1/fh_job_files', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    rows.push({ ...route.request().postDataJSON(), uploaded_at: NOW })
    await route.fulfill({ status: 201, json: rows.slice(-1) })
  })
  await page.goto('/jobs/c-job1?tab=files')
  const panel = page.locator('#fh-job-files-panel-photos')
  await expect(panel).toBeVisible()
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64')
  await panel.locator('input[type="file"]').setInputFiles([{ name: 'one.png', mimeType: 'image/png', buffer: bytes }, { name: 'two.png', mimeType: 'image/png', buffer: bytes }])
  await expect(page.getByText('Processing photo 1 of 2', { exact: true })).toBeVisible()
  await expect(page.getByRole('progressbar', { name: 'Photo batch progress' })).toHaveAttribute('value', '0')
  expect(rows).toHaveLength(0)
  release()
  await expect.poll(() => rows.length).toBe(2)
  await expect(page.getByRole('progressbar', { name: 'Photo batch progress' })).toHaveCount(0)
  await expect(panel.getByRole('button', { name: 'Add Photos', exact: true })).toBeEnabled()
})

for (const mode of ['day', 'night'] as const) {
  test(`interior controls fit 320px in ${mode} with reduced motion`, async ({ context, page }) => {
    await signIn(context, { mode, tables: { fh_quotes: quotes } })
    await page.setViewportSize({ width: 320, height: 740 })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    for (const route of ['/quotes', '/jobs', '/schedule', '/invoices', '/learn?guide=quote']) {
      await page.goto(route)
      await expect(page.getByRole('heading', { level: 1 }).first()).toBeVisible()
      expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(320)
      for (const control of await page.locator('.fh-quote-filters button, .fh-workspace-help summary, .fh-workspace-checklist a').all()) {
        if (!(await control.isVisible())) continue
        const box = await control.boundingBox()
        expect(box?.height).toBeGreaterThanOrEqual(44)
        expect(box?.x).toBeGreaterThanOrEqual(0)
        expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(320)
      }
    }
  })
}
