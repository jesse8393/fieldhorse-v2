// The Job page on a phone (docs/design/2026-10-redesign/SPEC.md 9.4,
// PHASE2_PLAN.md Task 12, render glamor/g-job.jpg): the photo header that
// falls back to the onyx band, the stage rail, the money strip, the
// section tabs with the Spine first, and the floating action capsule
// that takes the dock's place.
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

async function open(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fhj-page')).toBeVisible({ timeout: 30_000 })
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
    await expect(gold).toHaveText('Send invoice')
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
    await expect(page.getByRole('tablist', { name: 'Job sections' }).getByRole('tab', { name: 'Files', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Photos' })).toHaveAttribute('aria-selected', 'true')
  })

  test('spine first', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    await expect(page.getByRole('tab', { name: 'Spine' })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.fhj-spine').getByText('Inspector confirmed Friday.')).toBeVisible()
  })

  test('every section stays one tap away', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    const tabs = page.getByRole('tablist', { name: 'Job sections' })
    for (const name of ['Spine', 'Details', 'Selections', 'Materials', 'Change orders', 'Daily logs', 'Financials', 'Files']) {
      await expect(tabs.getByRole('tab', { name, exact: true })).toHaveCount(1)
    }
    await tabs.getByRole('tab', { name: 'Financials', exact: true }).click()
    await expect(tabs.getByRole('tab', { name: 'Financials', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/tab=financials/)

    // The quote stage keeps its Quote tab.
    await open(page, '/quotes/c-quote?tab=overview')
    await expect(page.getByRole('tablist', { name: 'Job sections' }).getByRole('tab', { name: 'Quote', exact: true })).toHaveCount(1)
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
      const panel = el.querySelector('[role="tabpanel"]')
      const last = panel?.lastElementChild ?? panel
      return last ? last.getBoundingClientRect().bottom : 0
    })
    expect(contentBottom).toBeLessThanOrEqual(capsuleTop)
  })

  test('the more menu sets a follow up', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1')
    await page.getByRole('button', { name: 'More actions for this job' }).click()
    const sheet = page.getByRole('dialog', { name: 'Slab + trench' })
    await expect(sheet.getByRole('button', { name: /Set follow up/ })).toBeVisible()
    await expect(sheet.getByRole('button', { name: /Edit job details/ })).toBeVisible()
    await sheet.getByRole('button', { name: /Set follow up/ }).click()
    const choices = page.getByRole('dialog', { name: 'Set follow up' })
    for (const name of ['Tomorrow', 'In 3 days', 'Next week']) {
      await expect(choices.getByRole('button', { name, exact: true })).toBeVisible()
    }
    await expect(choices.getByLabel('Pick a date')).toBeVisible()
    await choices.getByRole('button', { name: 'Tomorrow', exact: true }).click()
    await expect(page.getByText('Follow up set', { exact: true })).toBeVisible()
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
    await expect(page.getByRole('tablist', { name: 'Job sections' }).getByRole('tab', { name: 'Files', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Photos' })).toHaveAttribute('aria-selected', 'true')
  })

  test('deep links into the job keep working', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/jobs/c-job1?tab=files')
    await expect(page.getByRole('tablist', { name: 'Job sections' }).getByRole('tab', { name: 'Files', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByRole('tab', { name: 'Photos' })).toHaveAttribute('aria-selected', 'true')

    await open(page, '/jobs/c-job1?tab=financials&action=send_invoice')
    const cue = page.getByRole('region', { name: 'Dashboard action cue' })
    await expect(cue).toBeVisible()
    await cue.getByRole('button', { name: 'Send invoice' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
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
    await expect(facts.getByText('Balance', { exact: true })).toBeVisible()
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
    await expect(banner.getByRole('link', { name: /^Message/ })).toHaveAttribute('href', /^sms:/)
    await expect(banner.getByRole('button', { name: 'Schedule', exact: true })).toBeVisible()
    const gold = page.locator('.fhc-btn--primary')
    await expect(gold).toHaveCount(1)
    await expect(gold).toHaveText('Send invoice')
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
    await expect(page.getByRole('dialog', { name: 'Capture' })).toBeVisible()
    expect(writes).toEqual([])
  })

  test('the Spine is the first tab and every section stays one click away', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')
    const tabs = page.getByRole('tablist', { name: 'Job sections' })
    await expect(tabs.getByRole('tab', { name: 'Spine', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page.locator('.fhj-spine').getByText('Inspector confirmed Friday.')).toBeVisible()
    for (const name of ['Details', 'Selections', 'Materials', 'Change orders', 'Daily logs', 'Financials', 'Files']) {
      await expect(tabs.getByRole('tab', { name, exact: true })).toHaveCount(1)
    }
    await tabs.getByRole('tab', { name: 'Financials', exact: true }).click()
    await expect(tabs.getByRole('tab', { name: 'Financials', exact: true })).toHaveAttribute('aria-selected', 'true')
    await expect(page).toHaveURL(/tab=financials/)

    // The quote stage keeps its Quote tab, and it opens first.
    await openDesktop(page, '/quotes/c-quote')
    await expect(page.getByRole('tablist', { name: 'Job sections' }).getByRole('tab', { name: 'Quote', exact: true })).toHaveAttribute('aria-selected', 'true')
  })

  test('deep links and the action cue keep working', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1?tab=files')
    await expect(page.getByRole('tablist', { name: 'Job sections' }).getByRole('tab', { name: 'Files', exact: true })).toHaveAttribute('aria-selected', 'true')
    await openDesktop(page, '/jobs/c-job1?tab=financials&action=send_invoice')
    const cue = page.getByRole('region', { name: 'Dashboard action cue' })
    await expect(cue).toBeVisible()
  })

  test('the stage action opens the invoice sheet', async ({ context, page }) => {
    await signIn(context)
    await openDesktop(page, '/jobs/c-job1')
    await page.locator('.fhd-banner').getByRole('button', { name: 'Send invoice' }).click()
    await expect(page.getByRole('dialog')).toBeVisible()
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
    await expect(rail.getByText('$6,187.50 balance')).toBeVisible()
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
    await expect(page.getByText('Balance')).toHaveCount(0)
    await expect(page.getByText('Contract', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Margin', { exact: true })).toHaveCount(0)
    await expect(page.getByText(/\$33,100/)).toHaveCount(0)
    await expect(page.getByText(/balance/i)).toHaveCount(0)
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(0)
    await expect(page.getByRole('complementary', { name: 'Job facts' })).toBeVisible()
  })
})
