import { readFileSync } from 'node:fs'
import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { expectPlain, FAIL } from './helpers/rawErrors.ts'

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

// raw-errors-12: a new company's first screen said "TypeError: Failed to
// fetch" when making the workspace failed on a weak signal.
test('making the workspace on a weak signal says so in plain words', async ({ context, page }) => {
  await signIn(context, { tables: {
    profiles: [{ user_id: 'qa-user-1', full_name: null, company_name: null, onboarded_at: null, logo_url: null, location_lat: null, location_lon: null, services: [], preferences: {} }],
    org_members: [], organizations: []
  } })
  let answer: 'check' | 'drop' = 'check'
  await context.route((url) => url.pathname === '/rest/v1/rpc/create_own_org', (route) => answer === 'drop'
    ? route.abort('failed')
    : route.fulfill({ status: FAIL.check('organizations', 'organizations_name_check').status, contentType: 'application/json', body: FAIL.check('organizations', 'organizations_name_check').body }))
  await page.goto('/onboarding')
  await page.getByLabel('Company name', { exact: true }).fill('Fresh Concrete Co')
  await page.getByRole('group', { name: 'Trade services' }).getByRole('button').first().click()
  await page.getByRole('button', { name: 'Start with sample data' }).click()
  // No control is named Start, so the sentence names none (raw-errors-12).
  await expectPlain(page.getByRole('alert'), 'Your workspace was not made yet. Try again.')
  answer = 'drop'
  await page.getByRole('button', { name: 'Start with sample data' }).click()
  await expectPlain(page.getByRole('alert'), 'Your workspace was not made yet. No signal right now. Your work is still here, so try again when the signal is back.')
  await expect(page.getByLabel('Company name', { exact: true })).toHaveValue('Fresh Concrete Co')
})

// A new sign up on a weak signal: while the profile and membership reads
// are out, onboarding paints the same dark loading stage the sign in
// screens use, not a blank white page.
test('onboarding shows the loading stage while its reads are slow', async ({ context, page }) => {
  await signIn(context, { tables: { profiles: [], org_members: [], organizations: [] } })
  let release = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  await context.route('**/rest/v1/profiles**', async (route) => { await held; return route.fallback() })
  await page.goto('/onboarding', { waitUntil: 'domcontentloaded' })
  const stage = page.locator('main.fha[aria-busy="true"]')
  await expect(stage).toBeVisible()
  const background = await page.evaluate(() => getComputedStyle(document.querySelector('main.fha') as Element).backgroundColor)
  expect(background).not.toBe('rgba(0, 0, 0, 0)')
  expect(background).not.toBe('rgb(255, 255, 255)')
  release()
  await expect(page.getByLabel('Company name', { exact: true })).toBeVisible()
  await expect(stage).toHaveCount(0)
})

// The only way to start without sample data was 12 px underlined text in
// a 26 px tall target. It is a real secondary button now: at least 44 px
// tall with 16 px text, and still not the primary.
test('onboarding Skip and start empty is a full size secondary button', async ({ context, page }) => {
  await signIn(context, { tables: { profiles: [{ user_id: 'qa-user-1', company_name: '', onboarded_at: null, services: [] }] } })
  await page.goto('/onboarding')
  const skip = page.getByRole('button', { name: 'Skip and start empty', exact: true })
  await expect(skip).toBeVisible()
  const box = await skip.boundingBox()
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44)
  const size = await skip.evaluate((el) => parseFloat(getComputedStyle(el).fontSize))
  expect(size).toBeGreaterThanOrEqual(16)
  await expect(skip).not.toHaveClass(/primary/)
  await expect(page.getByRole('button', { name: 'Start with sample data', exact: true })).toHaveClass(/primary/)
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
  await expect(panel.getByRole('button', { name: 'Add photos', exact: true })).toBeEnabled()
})

// DATA-24: one failed photo used to end the batch, and the photos after
// it were never tried.
test('a photo batch keeps going past a photo that fails, and names it', async ({ context, page }) => {
  await signIn(context)
  const rows: Record<string, unknown>[] = []
  const removed: string[] = []
  await context.route(url => url.pathname.startsWith('/storage/v1/object/job-photos/'), route => route.fulfill({ status: 200, json: { Key: 'job-photos/photo.jpg' } }))
  await context.route(url => url.pathname === '/storage/v1/object/job-photos', route => {
    if (route.request().method() === 'DELETE') removed.push(...(route.request().postDataJSON()?.prefixes ?? []))
    return route.fulfill({ status: 200, json: [] })
  })
  await context.route('**/rest/v1/fh_job_files?*', route => route.request().method() === 'GET' ? route.fulfill({ json: rows }) : route.fallback())
  await context.route('**/rest/v1/fh_job_files', async route => {
    if (route.request().method() !== 'POST') return route.fallback()
    const row = route.request().postDataJSON()
    // Refused for good: this job is no longer theirs to add to.
    if (row.filename === 'two.png') return route.fulfill({ status: 403, json: { code: '42501', message: 'new row violates row-level security policy for table "fh_job_files"' } })
    // The signal drops while this row is on its way.
    if (row.filename === 'three.png') return route.abort('internetdisconnected')
    rows.push({ ...row, uploaded_at: NOW })
    await route.fulfill({ status: 201, json: [row] })
  })
  await page.goto('/jobs/c-job1?tab=files')
  const panel = page.locator('#fh-job-files-panel-photos')
  await expect(panel).toBeVisible()
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aX1sAAAAASUVORK5CYII=', 'base64')
  await panel.locator('input[type="file"]').setInputFiles(['one.png', 'two.png', 'three.png', 'four.png'].map(name => ({ name, mimeType: 'image/png', buffer: bytes })))
  await expect.poll(() => rows.map(row => row.filename)).toEqual(['one.png', 'four.png'])
  await expect(page.getByText("1 photo didn't upload", { exact: true })).toBeVisible()
  await expect(page.getByText('two.png. Add it again to try once more.', { exact: true })).toBeVisible()
  await expect(page.getByText('1 photo will upload when signal returns', { exact: true })).toBeVisible()
  await expect(page.getByText('Upload failed', { exact: true })).toHaveCount(0)
  // The refused photo's image does not stay up with nothing pointing at it.
  await expect.poll(() => removed.length).toBe(1)
  await expect(panel.getByRole('button', { name: 'Add photos', exact: true })).toBeEnabled()
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
