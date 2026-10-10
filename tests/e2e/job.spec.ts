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
