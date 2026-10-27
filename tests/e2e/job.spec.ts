// The Job page on a phone (docs/design/2026-10-redesign/SPEC.md 9.4,
// PHASE2_PLAN.md Task 12, render glamor/g-job.jpg): the photo header that
// falls back to the onyx band, the stage rail, the money strip, the
// section tabs with the Spine first, and the floating action capsule
// that takes the dock's place.
import { expect, test, type Page, type Route } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fhj-page')).toBeVisible({ timeout: 30_000 })
}

// Opens the Spine's "More about this job" disclosure. The page can render
// again right after it mounts (its data and the viewer's role arrive), so a
// tap that landed before that is tried once more.
async function openMoreAboutJob(page: Page) {
  const toggle = page.getByRole('button', { name: 'More about this job' })
  const body = page.locator('#fhj-more-body')
  for (let attempt = 0; attempt < 3; attempt++) {
    await toggle.click()
    try {
      await expect(body).toBeVisible({ timeout: 3000 })
      return
    } catch {
      if (await toggle.getAttribute('aria-expanded') === 'true') return
    }
  }
  await expect(body).toBeVisible()
}

test.describe('job page on a phone', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone layout')
  })

  test('job header and rail', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')

    const title = page.getByRole('heading', { level: 1, name: 'Slab + trench' })
    await expect(title).toBeVisible()
    const client = page.locator('.fhj-hero').getByText('Plumbing Bellevue')
    await expect(client).toBeVisible()
    const titleBox = await title.boundingBox()
    const clientBox = await client.boundingBox()
    expect(clientBox!.y).toBeGreaterThan(titleBox!.y)

    const current = page.getByRole('list', { name: 'Stage' }).locator('[aria-current="step"]')
    await expect(current).toHaveText(/^Job/)

    await expect(page.getByText('Contract', { exact: true })).toBeVisible()
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden()

    const gold = page.locator('.fhj-capsule .fhc-btn--primary')
    await expect(gold).toHaveCount(1)
    await expect(gold).toBeVisible()
    await expect(gold).toHaveText('Invoice this')
    const box = await gold.boundingBox()
    const viewport = page.viewportSize()!
    expect(box!.x).toBeGreaterThanOrEqual(0)
    expect(box!.y).toBeGreaterThanOrEqual(0)
    expect(box!.x + box!.width).toBeLessThanOrEqual(viewport.width)
    expect(box!.y + box!.height).toBeLessThanOrEqual(viewport.height)

    // The capsule keeps Capture one tap away.
    await expect(page.locator('.fhj-capsule').getByRole('button', { name: /photo/i })).toBeVisible()
    await expect(page.locator('.fhj-capsule').getByRole('button', { name: /voice note/i })).toBeVisible()
  })

  test('job without photos', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    const hero = page.locator('.fhj-hero')
    await expect(hero.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(hero.getByText('Plumbing Bellevue')).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(hero.locator('img')).toHaveCount(0)
    await expect(hero.getByRole('button', { name: /photos/i })).toHaveCount(0)
  })

  test('photo signing fails', async ({ context, page }) => {
    // Rows exist but the mock's storage answers 404, so no url signs.
    const now = Date.now()
    await signIn(context, {
      tables: {
        fh_job_files: [
          { id: 'f1', job_id: 'c-job1', kind: 'photo', storage_path: 'u/c-job1/f1.jpg', filename: 'f1.jpg', uploaded_at: new Date(now - 60_000).toISOString(), caption: null },
          { id: 'f2', job_id: 'c-job1', kind: 'photo', storage_path: 'u/c-job1/f2.jpg', filename: 'f2.jpg', uploaded_at: new Date(now - 120_000).toISOString(), caption: null }
        ]
      }
    })
    await open(page, '/jobs/c-job1')
    const hero = page.locator('.fhj-hero')
    await expect(hero.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(page.locator('.fhj-spine').getByText('2 photos', { exact: true })).toBeVisible()
    await expect(hero.locator('img')).toHaveCount(0)
    await expect(page.locator('.fhj-spine img')).toHaveCount(0)
    // The count still opens the photos.
    await hero.getByRole('button', { name: '2 photos' }).click()
    await expect(page.getByRole('region', { name: 'Photos workspace', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue('files')
  })

  test('spine first', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue('overview')
    await expect(page.locator('.fhj-spine').getByText('Inspector confirmed Friday.')).toBeVisible()
  })

  test('every section stays one tap away', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    const sections = page.getByRole('combobox', { name: 'Job section', exact: true })
    for (const name of ['Activity', 'Milestones', 'Tasks', 'Schedule', 'Selections', 'Materials', 'Change orders', 'Daily logs', 'Contract balance', 'Invoices', 'Photos', 'Files']) {
      await expect(sections.getByRole('option', { name, exact: true })).toHaveCount(1)
    }
    await sections.selectOption('financials')
    await expect(sections).toHaveValue('financials')
    await expect(page).toHaveURL(/tab=financials/)

    // A quote is its own screen (Phase 9, D53): its lines are one tap away too.
    await page.goto('/quotes/q-quote', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.locator('.fhqt-page')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Parking lot repour' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add a line' })).toBeVisible()
  })

  test('the section selector fits a narrow phone without horizontal scrolling', async ({ context, page }) => {
    await signIn(context)
    await page.setViewportSize({ width: 320, height: 740 })
    await open(page, '/jobs/c-job1')
    const selector = page.getByRole('combobox', { name: 'Job section', exact: true })
    const box = (await selector.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(320)
    expect(box.height).toBeGreaterThanOrEqual(44)
    await expect(page.getByRole('tablist')).toHaveCount(0)
  })

  for (const id of ['change_orders', 'logs', 'financials', 'files', 'documents', 'tasks']) {
    test(`deep linked ${id} stays selected on reload`, async ({ context, page }) => {
      await signIn(context)
      await open(page, `/jobs/c-job1?tab=${id}`)
      await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue(id)
      await page.reload()
      await expect(page.locator('.fhj-page')).toBeVisible({ timeout: 30_000 })
      await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue(id)
    })
  }

  test('section selection survives membership loading', async ({ context, page }) => {
    await signIn(context)
    const isMembers = (url: URL) => url.pathname.endsWith('/rest/v1/org_members')
    let release = () => {}
    const held = new Promise<void>(resolve => { release = resolve })
    const hold = async (route: Route) => { await held; await route.fallback() }
    await context.route(isMembers, hold)
    await open(page, '/jobs/c-job1?tab=logs')
    const selector = page.getByRole('combobox', { name: 'Job section', exact: true })
    await expect(selector).toHaveValue('logs')
    await expect(selector.locator('option[value="change_orders"]')).toHaveCount(0)
    release()
    await expect(selector.locator('option[value="change_orders"]')).toHaveCount(1)
    await expect(selector).toHaveValue('logs')
    await context.unroute(isMembers, hold)
  })

  test('native keyboard selection opens a section without a second tab row', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    const selector = page.getByRole('combobox', { name: 'Job section', exact: true })
    await selector.focus()
    await page.keyboard.press('ArrowDown')
    await page.keyboard.press('Enter')
    await expect(selector).not.toHaveValue('overview')
    await expect(page.getByRole('tablist')).toHaveCount(0)
  })

  test('opened from the Jobs list, the header spans the page and the section selector fits', async ({ context, page }) => {
    await signIn(context)
    // By tapping a row, so the Jobs list's styles are already on the page
    // when the job draws: the way most people reach a job.
    await page.goto('/work', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible({ timeout: 30_000 })
    await page.getByText('Plumbing Bellevue', { exact: true }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1$/)
    await expect(page.locator('.fhj-page')).toBeVisible({ timeout: 30_000 })
    const width = page.viewportSize()!.width
    const near = (a: number, b: number) => Math.abs(a - b) <= 1

    // One column: the onyx hero spans the page and the facts sit under it.
    const hero = page.locator('.fhj-hero')
    await expect(hero.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    expect(await page.locator('.fhj-page .fhj-head').evaluate((el) => getComputedStyle(el).display)).not.toBe('flex')
    const heroBox = (await hero.boundingBox())!
    expect(near(heroBox.x, 0) && near(heroBox.width, width), `hero ${heroBox.x}, ${heroBox.width} wide`).toBe(true)
    const factsBox = (await page.locator('.fhj-facts').boundingBox())!
    expect(factsBox.y).toBeGreaterThanOrEqual(heroBox.y + heroBox.height - 1)

    const selector = page.getByRole('combobox', { name: 'Job section', exact: true })
    const box = (await selector.boundingBox())!
    expect(box.x).toBeGreaterThanOrEqual(0)
    expect(box.x + box.width).toBeLessThanOrEqual(width)
  })

  test('the page scrolls clear of the capsule', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    await expect(page.locator('.fhj-spine').getByText('Inspector confirmed Friday.')).toBeVisible()
    await page.getByRole('button', { name: 'More about this job' }).click()
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    await page.waitForTimeout(150)
    const capsuleTop = await page.locator('.fhj-capsule').evaluate((el) => el.getBoundingClientRect().top)
    const contentBottom = await page.locator('.fhj-page').evaluate((el) => {
      const panel = el.querySelector('[role="region"][aria-label$=" workspace"]')
      const last = panel?.lastElementChild ?? panel
      return last ? last.getBoundingClientRect().bottom : 0
    })
    expect(contentBottom).toBeLessThanOrEqual(capsuleTop)
  })

  test('the more menu is a screen, and sets a follow up on its own screen', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    await page.getByRole('button', { name: 'More actions for this job' }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1\/more$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(page.getByRole('link', { name: /Set follow up/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Edit job details/ })).toBeVisible()
    await page.getByRole('link', { name: /Set follow up/ }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1\/follow-up$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    for (const name of ['Tomorrow', 'In 3 days', 'Next week']) {
      await expect(page.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(page.getByLabel('Pick a date')).toBeVisible()
    await page.getByRole('button', { name: 'Tomorrow', exact: true }).click()
    await expect(page.getByText('Follow up set', { exact: true })).toBeVisible()
    // Saving lands back on the job.
    await expect(page).toHaveURL(/\/jobs\/c-job1$/)
  })

  // The sheets the job page used to open are screens of their own (D57):
  // each button changes the URL and nothing with role dialog ever mounts.
  test('the job page opens no dialog for payment, event, partner, complete or invoice', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    const steps: [string, RegExp][] = [
      ['Log payment', /\/jobs\/c-job1\/payment$/],
      ['Schedule event', /\/schedule\/new\?job=c-job1$/],
      ['Invite partner', /\/jobs\/c-job1\/partner$/],
      ['Mark complete', /\/jobs\/c-job1\/complete$/]
    ]
    for (const [name, url] of steps) {
      await openMoreAboutJob(page)
      await page.locator('#fhj-more-body').getByRole('button', { name, exact: true }).click()
      await expect(page).toHaveURL(url)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await expect(page.getByRole('button', { name: 'Back' })).toBeVisible()
      await page.goBack()
      await expect(page.locator('.fhj-page')).toBeVisible()
    }
    await page.locator('.fhj-capsule').getByRole('button', { name: 'Invoice this' }).click()
    await expect(page).toHaveURL(/\/invoices\/new\?job=c-job1$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('Invoice this opens the new invoice screen with the balance', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    await page.locator('.fhj-capsule').getByRole('button', { name: 'Invoice this' }).click()
    await expect(page).toHaveURL(/\/invoices\/new\?job=c-job1$/)
    await expect(page.getByRole('heading', { level: 1, name: 'New invoice' })).toBeVisible()
    await expect(page.getByLabel('Amount')).toHaveValue('33100')
    await expect(page.getByLabel('Description')).toHaveValue('Slab + trench')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('Delete asks with a second tap, not a sheet', async ({ context, page }) => {
    await signIn(context)
    const deletes: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/rest/v1/fh_contacts')) deletes.push(req.url())
    })
    await open(page, '/jobs/c-job1')
    await page.getByRole('button', { name: 'More actions for this job' }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1\/more$/)
    await page.getByRole('button', { name: 'Delete job' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const again = page.getByRole('button', { name: 'Tap again to delete' })
    await expect(again).toBeVisible()
    expect(deletes).toEqual([])
    await again.click()
    await expect.poll(() => deletes.length).toBe(1)
    expect(deletes[0]).toMatch(/id=eq\.c-job1/)
    await expect(page).toHaveURL(/\/(jobs|work)\b/)
    await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible({ timeout: 30_000 })
  })

  test('the capsule camera hands its photos to the Files tab', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    const camera = page.locator('.fhj-capsule input[type="file"]')
    await expect(camera).toHaveAttribute('accept', 'image/*')
    await camera.setInputFiles({
      name: 'slab.png',
      mimeType: 'image/png',
      buffer: Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
    })
    await expect(page.getByRole('region', { name: 'Photos workspace', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue('files')
  })

  test('deep links into the job keep working', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1?tab=files')
    await expect(page.getByRole('region', { name: 'Photos workspace', exact: true })).toBeVisible()
    await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue('files')

    await open(page, '/jobs/c-job1?tab=financials&action=send_invoice')
    const cue = page.getByRole('region', { name: 'Dashboard action cue' })
    await expect(cue).toBeVisible()
    await cue.getByRole('button', { name: 'Invoice this' }).click()
    await expect(page).toHaveURL(/\/invoices\/new\?job=c-job1$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('lost job', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-lost')
    const rail = page.locator('.fhc-rail')
    await expect(rail.getByText('Lost', { exact: true })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Stage' }).locator('[aria-current="step"]')).toHaveCount(0)
    await expect(page.locator('.fhj-capsule .fhc-btn--primary')).toHaveText('Reopen')
  })

  test('crew sees no money', async ({ context, page }) => {
    await signIn(context, { role: 'crew' })
    await open(page, '/jobs/c-job1')
    await expect(page.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(page.locator('.fhj-spine').getByText('Inspector confirmed Friday.')).toBeVisible()
    await expect(page.getByText('Contract', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/\$33,100/)).toHaveCount(0)
    await expect(page.locator('.fhj-capsule .fhc-btn--primary')).toHaveCount(0)
  })
})

test.describe('job page on a desktop', () => {
  test('keeps the desktop build', async ({ context, page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop layout')
    await signIn(context)
    await page.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.locator('[data-build-screen="SnowJobDetailBuild"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.locator('.fhj-page')).toHaveCount(0)
    await expect(page.locator('.fhj-capsule')).toHaveCount(0)
  })
})

// The Job page on a desktop (SPEC.md 9.11, PHASE4_PLAN.md Task 4.3, render
// glamor/g-desktop-job.jpg): the photo banner that falls back to onyx, the
// full width stage rail with notes, the composer and section tabs on the
// left, the facts panel on the right with the Balance vault card for money
// roles only, and the weather slot that reads real conditions.
test.describe('job page on a desktop, redesigned', () => {
  test.beforeEach(async ({ context }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop layout')
    // The banner reads the weather; answer it here so no test waits on the network.
    await context.route('https://api.open-meteo.com/**', (route) => route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ current: { temperature_2m: 71, weather_code: 2 } })
    }))
  })

  // A tiny PNG standing in for a signed job photo.
  const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')

  const SLAB_PHOTOS = [
    { id: 'f1', job_id: 'c-job1', kind: 'photo', storage_path: 'u/c-job1/f1.jpg', filename: 'f1.jpg', uploaded_at: '2026-10-10T11:50:00.000Z', caption: 'Forms and rebar in' },
    { id: 'f2', job_id: 'c-job1', kind: 'photo', storage_path: 'u/c-job1/f2.jpg', filename: 'f2.jpg', uploaded_at: '2026-10-10T11:45:00.000Z', caption: null }
  ]

  async function openDesktop(page: Page, path: string) {
    await page.clock.setFixedTime(new Date('2026-10-10T12:40:00.000Z'))
    await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.locator('[data-build-screen="SnowJobDetailBuild"]')).toBeVisible({ timeout: 30_000 })
  }

  // Signed urls for the job photos bucket, and what the image behind them does.
  async function mockPhotoStorage(context: import('@playwright/test').BrowserContext, image: 'ok' | 'missing') {
    await context.route((u) => u.hostname === 'qa-mock.supabase.co', async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      if (url.pathname.endsWith('/storage/v1/object/sign/job-photos') && req.method() === 'POST') {
        const { paths = [] } = JSON.parse(req.postData() || '{}')
        const signed = paths.map((path: string) => ({ path, signedURL: `/object/sign/job-photos/${path}?token=qa`, error: null }))
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(signed) })
      }
      if (url.pathname.includes('/storage/v1/object/sign/job-photos/')) {
        return image === 'ok'
          ? route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
          : route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' })
      }
      return route.fallback()
    })
  }

  test('rail, balance and weather', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')

    const rail = page.getByRole('list', { name: 'Stage' })
    await expect(rail).toBeVisible()
    await expect(rail.locator('[aria-current="step"]')).toHaveText(/^Job/)

    const facts = page.getByRole('complementary', { name: 'Job facts' })
    await expect(facts.getByText('Contract balance', { exact: true })).toBeVisible()
    await expect(facts.getByText('$33,100.00').first()).toBeVisible()
    await expect(facts.getByText('Contract', { exact: true })).toBeVisible()
    await expect(facts.getByText('Paid', { exact: true })).toBeVisible()

    await expect(page.getByText('Weather not set')).toHaveCount(0)
    await expect(page.locator('.fhd-banner').getByText(/71°/)).toBeVisible()
  })

  test('the banner, the one gold action and no key cap', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')
    const banner = page.locator('.fhd-banner')

    // Job title as the heading, the client and address under it.
    await expect(banner.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(banner.getByText('Plumbing Bellevue, 412 Burkitt Station Rd')).toBeVisible()
    await expect(banner.getByRole('link', { name: 'Back to jobs' }).or(banner.getByRole('button', { name: 'Back to jobs' }))).toBeVisible()

    // Message and Schedule are secondary; the stage action is the one gold button.
    await expect(banner.getByRole('link', { name: /^Message/ })).toHaveAttribute('href', '/compose?contact=c-job1&channel=email')
    await expect(banner.getByRole('button', { name: 'Schedule', exact: true })).toBeVisible()
    const gold = page.locator('.fhc-btn--primary')
    await expect(gold).toHaveCount(1)
    await expect(gold).toHaveText('Invoice this')
    // Shortcuts only fire inside the command palette, so the button draws no key cap.
    await expect(banner.locator('kbd')).toHaveCount(0)

    // Edit and delete stay one click away.
    await expect(banner.getByRole('button', { name: 'Edit job details' })).toBeVisible()
    await expect(banner.getByRole('button', { name: 'Delete this job' })).toBeVisible()
  })

  test('job without photos falls back to onyx', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')
    await page.waitForLoadState('networkidle')
    const banner = page.locator('.fhd-banner')
    await expect(banner.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(banner.locator('img')).toHaveCount(0)
    const bg = await banner.evaluate((el) => getComputedStyle(el).backgroundColor)
    expect(bg).not.toBe('rgba(0, 0, 0, 0)')
  })

  test('photo signing fails', async ({ context, page }) => {
    // Rows exist but the mock's storage answers 404, so no url signs.
    await signIn(context, { tables: { fh_job_files: SLAB_PHOTOS } })
    await openDesktop(page, '/jobs/c-job1')
    const banner = page.locator('.fhd-banner')
    await expect(banner.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(page.locator('.fhj-spine').getByText('2 photos', { exact: true })).toBeVisible()
    await page.waitForLoadState('networkidle')
    await expect(banner.locator('img')).toHaveCount(0)
  })

  test('the newest photo is the banner, and a photo that will not load is dropped', async ({ context, page }) => {
    await signIn(context, { tables: { fh_job_files: SLAB_PHOTOS } })
    await mockPhotoStorage(context, 'ok')
    await openDesktop(page, '/jobs/c-job1')
    const banner = page.locator('.fhd-banner')
    await expect(banner.locator('img')).toHaveCount(1)
    await expect(banner.locator('img')).toHaveAttribute('alt', 'Forms and rebar in')
    await expect(banner.getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()

    // The same job, the image behind the url gone: no broken image box.
    const second = await context.newPage()
    await mockPhotoStorage(context, 'missing')
    await second.clock.setFixedTime(new Date('2026-10-10T12:40:00.000Z'))
    await second.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(second.locator('.fhd-banner').getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible({ timeout: 30_000 })
    await second.waitForLoadState('networkidle')
    await expect(second.locator('.fhd-banner img')).toHaveCount(0)
  })

  test('the composer opens Capture on this job and writes nothing', async ({ context, page }) => {
    await signIn(context)
    const writes: string[] = []
    page.on('request', (req) => {
      if (['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method()) && req.url().includes('/rest/v1/fh_')) writes.push(req.url())
    })
    await openDesktop(page, '/jobs/c-job1')
    await page.evaluate(() => {
      const w = window as unknown as { __captureDetail?: unknown }
      window.addEventListener('fh:open-capture', (e) => { w.__captureDetail = (e as CustomEvent).detail })
    })
    await page.getByRole('button', { name: /Add a note, photos or a task/ }).click()
    expect(await page.evaluate(() => (window as unknown as { __captureDetail?: unknown }).__captureDetail)).toEqual({ jobId: 'c-job1' })
    // Capture is a screen (D57), opened on this job.
    await expect(page).toHaveURL(/\/capture\?job=c-job1$/)
    await expect(page.getByRole('heading', { level: 1, name: 'Capture' })).toBeVisible()
    expect(writes).toEqual([])
  })

  test('desktop section destinations fit without horizontal scrolling', async ({ context, page }, testInfo) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')
    const nav = page.getByRole('navigation', { name: 'Job shortcuts', exact: true })
    await expect(nav.getByRole('button', { name: 'Photos', exact: true })).toBeVisible()
    expect(await nav.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true)
    for (const button of await nav.getByRole('button').all()) {
      expect((await button.boundingBox())!.height).toBeGreaterThanOrEqual(44)
    }
    await page.screenshot({ path: testInfo.outputPath('workspace-job.png'), fullPage: true })
  })

  test('the Spine is the first tab and every section stays one click away', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')
    const nav = page.getByRole('navigation', { name: 'Job shortcuts', exact: true })
    await expect(nav.getByRole('button', { name: 'Activity', exact: true })).toHaveAttribute('aria-current', 'page')
    await expect(page.locator('.fhj-spine').getByText('Inspector confirmed Friday.')).toBeVisible()
    for (const name of ['Milestones', 'Tasks', 'Schedule', 'Selections', 'Materials', 'Change orders', 'Daily logs', 'Contract balance', 'Invoices', 'Photos', 'Files']) {
      await expect(page.getByRole('combobox', { name: 'Job section', exact: true }).getByRole('option', { name, exact: true })).toHaveCount(1)
    }
    await page.getByRole('combobox', { name: 'Job section', exact: true }).selectOption('financials')
    await expect(page.getByRole('combobox', { name: 'Job section', exact: true })).toHaveValue('financials')
    await expect(page).toHaveURL(/tab=financials/)

    // A quote is its own screen (Phase 9, D53), the same one as on a phone,
    // and its lines open first.
    await page.goto('/quotes/q-quote', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.locator('.fhqt-page')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Parking lot repour' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Add a line' })).toBeVisible()
  })

  test('deep links and the action cue keep working', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1?tab=files')
    await expect(page.getByRole('region', { name: 'Photos workspace', exact: true })).toBeVisible()
    await openDesktop(page, '/jobs/c-job1?tab=financials&action=send_invoice')
    const cue = page.getByRole('region', { name: 'Dashboard action cue' })
    await expect(cue).toBeVisible()
  })

  test('Invoice this opens the new invoice screen with the balance', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')
    await page.locator('.fhd-banner').getByRole('button', { name: 'Invoice this' }).click()
    await expect(page).toHaveURL(/\/invoices\/new\?job=c-job1$/)
    await expect(page.getByRole('heading', { level: 1, name: 'New invoice' })).toBeVisible()
    await expect(page.getByLabel('Amount')).toHaveValue('33100')
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('the job page opens no dialog for payment, event, partner, complete or invoice', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')
    const banner = page.locator('.fhd-banner')
    await banner.getByRole('button', { name: 'Schedule', exact: true }).click()
    await expect(page).toHaveURL(/\/schedule\/new\?job=c-job1$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await page.goBack()
    await expect(page.locator('[data-build-screen="SnowJobDetailBuild"]')).toBeVisible({ timeout: 30_000 })
    const steps: [string, RegExp][] = [
      ['Log payment', /\/jobs\/c-job1\/payment$/],
      ['Invite partner', /\/jobs\/c-job1\/partner$/],
      ['Mark complete', /\/jobs\/c-job1\/complete$/]
    ]
    for (const [name, url] of steps) {
      await openMoreAboutJob(page)
      await page.locator('#fhj-more-body').getByRole('button', { name, exact: true }).click()
      await expect(page).toHaveURL(url)
      await expect(page.getByRole('dialog')).toHaveCount(0)
      await page.goBack()
      await expect(page.locator('[data-build-screen="SnowJobDetailBuild"]')).toBeVisible({ timeout: 30_000 })
    }
    await banner.getByRole('button', { name: 'Invoice this' }).click()
    await expect(page).toHaveURL(/\/invoices\/new\?job=c-job1$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('Delete asks with a second tap, not a sheet', async ({ context, page }) => {
    await signIn(context)
    const deletes: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/rest/v1/fh_contacts')) deletes.push(req.url())
    })
    await openDesktop(page, '/jobs/c-job1')
    const banner = page.locator('.fhd-banner')
    await banner.getByRole('button', { name: 'Delete this job' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    const again = banner.getByRole('button', { name: 'Tap again to delete' })
    await expect(again).toBeVisible()
    expect(deletes).toEqual([])
    await again.click()
    await expect.poll(() => deletes.length).toBe(1)
    expect(deletes[0]).toMatch(/id=eq\.c-job1/)
    // The job is gone, so the page leaves it for the jobs list.
    await expect(page).toHaveURL(/\/(jobs|work)\b/)
    await expect(page.locator('[data-build-screen="SnowJobDetailBuild"]')).toHaveCount(0)
  })

  test('rail notes from the job', async ({ context, page }) => {
    const job = {
      id: 'c-job1', stage: 'job', name: 'Whitcomb', job_title: 'Garage slab', amount: 12375, source: 'website',
      user_id: 'qa-user-1', client_id: null, phone: '615 555 0148', email: 'd@w.com', address: '2210 Ridgecrest Dr',
      created_at: '2026-09-23T15:00:00.000Z', updated_at: '2026-10-09T15:00:00.000Z', completed_at: null,
      proposal_status: 'approved', milestones: [], follow_up_on: null, notes: null, scope_text: null
    }
    await signIn(context, {
      tables: {
        fh_contacts: [job],
        fh_clients: [],
        fh_payments: [{ id: 'p1', user_id: 'qa-user-1', contact_id: 'c-job1', amount: 6187.5, method: 'check', reference: '1', paid_on: '2026-09-30', created_at: '2026-09-30T15:00:00.000Z' }],
        fh_stage_transitions: [{ id: 't1', contact_id: 'c-job1', from_stage: 'quote', to_stage: 'job', transitioned_at: '2026-09-28T15:00:00.000Z', transitioned_by: null, user_id: 'qa-user-1' }],
        fh_schedule: [
          { id: 's1', user_id: 'qa-user-1', contact_id: 'c-job1', title: 'Pour slab', description: null, start_at: '2026-10-10T12:30:00.000Z', end_at: '2026-10-10T16:30:00.000Z', created_at: '2026-10-01T15:00:00.000Z' },
          { id: 's2', user_id: 'qa-user-1', contact_id: 'c-job1', title: 'Inspection', description: null, start_at: '2026-10-16T14:00:00.000Z', end_at: '2026-10-16T15:00:00.000Z', created_at: '2026-10-01T15:00:00.000Z' }
        ]
      }
    })
    await openDesktop(page, '/jobs/c-job1')
    const rail = page.getByRole('list', { name: 'Stage' })
    await expect(rail.getByText('Sep 23, website')).toBeVisible()
    await expect(rail.getByText('Approved Sep 28')).toBeVisible()
    await expect(rail.getByText('Pour slab today, Inspection Fri')).toBeVisible()
    await expect(rail.getByText('$6,187.50 contract balance')).toBeVisible()
    const facts = page.getByRole('complementary', { name: 'Job facts' })
    await expect(facts.getByText('$6,187.50').first()).toBeVisible()
    await expect(facts.getByText('$12,375.00')).toBeVisible()
  })

  test('a lost job shows the Lost chip and offers Reopen', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-lost')
    await expect(page.locator('.fhc-rail').getByText('Lost', { exact: true })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Stage' }).locator('[aria-current="step"]')).toHaveCount(0)
    await expect(page.locator('.fhc-btn--primary')).toHaveText('Reopen')
  })

  test('crew see no money and no gold action', async ({ context, page }) => {
    await signIn(context, { role: 'crew' })
    await openDesktop(page, '/jobs/c-job1')
    await expect(page.locator('.fhd-banner').getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect(page.getByRole('list', { name: 'Stage' })).toBeVisible()
    await expect(page.getByText('Contract balance')).toHaveCount(0)
    await expect(page.getByText('Contract', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Margin', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/\$33,100/)).toHaveCount(0)
    await expect(page.getByText(/balance/i)).toHaveCount(0)
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(0)
    await expect(page.getByRole('complementary', { name: 'Job facts' })).toBeVisible()
  })
})
