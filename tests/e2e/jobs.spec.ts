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
    await expect(page.getByText('Plumbing Bellevue', { exact: true })).toBeVisible()
    await expect(page.getByText('Old Mill HOA', { exact: true })).toHaveCount(0)

    // The filter is a chip under the title (D57): no sheet to open or close.
    const chips = page.getByRole('group', { name: 'Filter and sort' })
    const lost = chips.getByRole('switch', { name: 'Show lost jobs' })
    await expect(lost).toHaveAttribute('aria-checked', 'false')
    await lost.click()
    await expect(lost).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('dialog')).toHaveCount(0)

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
    const list = page.locator('.fhjl-list')
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

  test('back from a job, the list keeps its own look', async ({ context, page }) => {
    await signIn(context)
    await openJobs(page)
    const stages = page.getByRole('tablist', { name: 'Job stages' })
    const look = () => stages.evaluate((el) => {
      const s = getComputedStyle(el)
      return { border: s.borderBottomWidth, rule: s.boxShadow, padding: `${s.paddingLeft} ${s.paddingRight}` }
    })
    const first = await look()
    // The job page's styles stay on the page once it has drawn.
    await page.getByText('Plumbing Bellevue', { exact: true }).click()
    await expect(page.locator('.fhj-page')).toBeVisible({ timeout: 30_000 })
    await page.goBack()
    await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible({ timeout: 30_000 })
    expect(await look()).toEqual(first)
  })
})

test.describe('tap again to delete a job', () => {
  test('a fast double tap does not delete, and the warning shows before the first tap', async ({ context, page }) => {
    await signIn(context)
    const deletes: string[] = []
    await context.route('**/rest/v1/fh_contacts*', (route) => {
      if (route.request().method() === 'DELETE') { deletes.push(route.request().url()); return route.fulfill({ status: 200, json: [{ id: 'c-job2' }] }) }
      return route.fallback()
    })
    await page.goto('/jobs/c-job2/more')
    const button = page.getByRole('button', { name: 'Delete job', exact: true })
    await expect(button).toBeVisible()
    await expect(page.getByText(/This cannot be undone\./)).toBeVisible()
    await button.dblclick()
    await page.waitForTimeout(600)
    expect(deletes).toHaveLength(0)
    await expect(page.getByRole('button', { name: 'Tap again to delete', exact: true })).toBeVisible()
  })
})

// OPS-06 and D02: crew could open the job money screens by URL and saw the
// contract price, and the More screen offered them partner and edit rows.
test.describe('job screens a field role cannot open', () => {
  for (const path of ['/jobs/c-job1/payment', '/jobs/c-job1/complete', '/jobs/c-job1/partner', '/jobs/new']) {
    test(`crew opening ${path} lands on Crew home without the contract money`, async ({ context, page }) => {
      await signIn(context, { role: 'crew' })
      await page.goto(path)
      await expect(page).toHaveURL(/\/crew$/)
      await expect(page.getByText('$33,100')).toHaveCount(0)
    })
  }

  test('the More screen offers crew no partner invite and no job edit', async ({ context, page }) => {
    await signIn(context, { role: 'crew' })
    await page.goto('/jobs/c-job1/more')
    await expect(page.getByRole('list', { name: 'More actions' })).toBeVisible()
    await expect(page.getByText('Schedule an event')).toBeVisible()
    await expect(page.getByText('Invite a partner')).toHaveCount(0)
    await expect(page.getByText('Edit job details')).toHaveCount(0)
  })

  test('a manager opens a client from Money and its statement', async ({ context, page }) => {
    await signIn(context, { role: 'manager' })
    await page.goto('/clients/cl-1')
    await expect(page).toHaveURL(/\/clients\/cl-1$/)
    await page.goto('/clients/cl-1/statement')
    await expect(page).toHaveURL(/\/clients\/cl-1\/statement$/)
  })
})

// D18: search, sort and the lost switch live in the address, so Back from
// a job and a reload bring the list back the way it was left.
test('the Jobs list keeps its search, sort and lost switch on reload and Back', async ({ context, page, isMobile }) => {
  await signIn(context)
  await openJobs(page)
  const chips = page.getByRole('group', { name: 'Filter and sort' })
  const lost = chips.getByRole('switch', { name: 'Show lost jobs' })
  const amount = chips.getByRole('radio', { name: 'Amount' })
  await lost.click()
  await amount.click()
  if (isMobile) await page.getByRole('button', { name: 'Search jobs' }).click()
  const box = page.locator('.fhjl-search input')
  await box.fill('o')
  await expect(page).toHaveURL(/[?&]q=o\b/)

  const check = async () => {
    await expect(lost).toHaveAttribute('aria-checked', 'true')
    await expect(amount).toHaveAttribute('aria-checked', 'true')
    await expect(page.locator('.fhjl-search input')).toHaveValue('o')
  }
  await page.reload({ waitUntil: 'domcontentloaded' })
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible({ timeout: 30_000 })
  await check()

  await page.goto('/jobs/c-job1', { waitUntil: 'domcontentloaded' })
  await page.goBack()
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible({ timeout: 30_000 })
  await check()
})

// D18: each control writes only its own key, on the address as it is now.
// On a slow phone the list had not drawn the sort yet when the first
// letter of a search was typed, and the search wrote ?q= over the address
// the list last drew, so the sort (and the lost switch) went back off.
test('a sort and the lost switch tapped just before a search stay on', async ({ context, page, isMobile }) => {
  await signIn(context)
  await openJobs(page)
  const chips = page.getByRole('group', { name: 'Filter and sort' })
  const lost = chips.getByRole('switch', { name: 'Show lost jobs' })
  const amount = chips.getByRole('radio', { name: 'Amount' })
  if (isMobile) await page.getByRole('button', { name: 'Search jobs' }).click()
  const box = page.locator('.fhjl-search input')
  await expect(box).toBeVisible()
  // A slow phone: the list draws each change well after the tap.
  const cpu = await context.newCDPSession(page)
  await cpu.send('Emulation.setCPUThrottlingRate', { rate: 20 })
  await lost.click()
  await amount.click()
  await box.fill('o')
  await expect(page).toHaveURL(/[?&]q=o\b/)
  await cpu.send('Emulation.setCPUThrottlingRate', { rate: 1 })

  await expect(lost).toHaveAttribute('aria-checked', 'true')
  await expect(amount).toHaveAttribute('aria-checked', 'true')
  const address = new URL(page.url()).searchParams
  expect([address.get('lost'), address.get('sort'), address.get('q')]).toEqual(['1', 'amount', 'o'])
})
