// The Jobs screen on a phone (docs/design/2026-10-redesign/SPEC.md,
// section 9.3, decision D3): text tabs with counts, grouped hairline
// rows, Lost behind the filter sheet, and no money for field roles.
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

async function openJobs(page: Page, path = '/work') {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible({ timeout: 30_000 })
}

test.describe('jobs on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'Phone Jobs screen')

  test('jobs title and tabs', async ({ context, page }) => {
    await signIn(context)
    await openJobs(page)
    const tabs = page.getByRole('tablist', { name: 'Job stages' })
    for (const label of ['All', 'Leads', 'Quotes', 'Jobs', 'Done']) {
      await expect(tabs.getByRole('tab', { name: new RegExp(`^${label}\\b`) })).toBeVisible()
    }
    await expect(tabs.getByRole('tab', { name: /^All\b/ })).toHaveAttribute('aria-selected', 'true')
    // An owner sees amounts with cents, on rows and group totals.
    await expect(page.getByText('$45,900.00 in progress', { exact: true })).toBeVisible()
    await expect(page.getByText('$33,100.00', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New lead', exact: true })).toBeVisible()
    await expect(page.locator('.fh-deal-card')).toHaveCount(0)
    await expect(page.locator('.fh-fab')).toHaveCount(0)
  })

  test('lost behind the filter', async ({ context, page }) => {
    await signIn(context)
    await openJobs(page)
    await expect(page.getByText('Justin Bryan', { exact: true })).toBeVisible()
    await expect(page.getByText('Old Mill HOA', { exact: true })).toHaveCount(0)

    await page.getByRole('button', { name: 'Filter and sort' }).click()
    const sheet = page.getByRole('dialog', { name: 'Filter and sort' })
    await expect(sheet).toBeVisible()
    const lost = sheet.getByRole('switch', { name: 'Show lost jobs' })
    await expect(lost).toHaveAttribute('aria-checked', 'false')
    await lost.click()
    await expect(lost).toHaveAttribute('aria-checked', 'true')
    await sheet.getByRole('button', { name: 'Close' }).click()
    await expect(sheet).toBeHidden()

    await expect(page.getByText('Old Mill HOA', { exact: true })).toBeVisible()
  })

  test('old stage links still land on the right view', async ({ context, page }) => {
    await signIn(context)
    await openJobs(page, '/work?stage=active')
    await expect(page.getByRole('tab', { name: /^Jobs\b/ })).toHaveAttribute('aria-selected', 'true')
    await expect(page.getByText('Plumbing Bellevue', { exact: true })).toBeVisible()
    await expect(page.getByText('Justin Bryan', { exact: true })).toHaveCount(0)

    await openJobs(page, '/work?stage=lost')
    await expect(page.getByText('Old Mill HOA', { exact: true })).toBeVisible()
  })

  test('crew sees no money', async ({ context, page }) => {
    await signIn(context, { role: 'crew' })
    await openJobs(page)
    const list = page.locator('.fhj-list')
    await expect(list.getByText('Plumbing Bellevue', { exact: true })).toBeVisible()
    await expect(list.getByText('2 in progress', { exact: true })).toBeVisible()
    // Let the role settle (the screen hides money while it loads), then
    // read the list once: a retrying "not" would pass on that first frame.
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(500)
    expect(await list.innerText()).not.toMatch(/\$\d/)
    await expect(page.getByRole('tab', { name: /^Leads\b/ })).toHaveCount(0)
  })

  test('rows open the job', async ({ context, page }) => {
    await signIn(context)
    await openJobs(page)
    await page.getByText('Plumbing Bellevue', { exact: true }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1$/)
  })
})
