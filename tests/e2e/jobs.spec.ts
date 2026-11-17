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

  // PERF-05: jobs land before leads and quotes, which wait on the company.
  // The All list keeps its skeleton until all three are in, so rows never
  // move under a thumb when the sales records arrive above them.
  test('the All list waits for leads and quotes instead of jumping when they land', async ({ context, page }) => {
    await signIn(context)
    let release!: () => void
    const held = new Promise<void>(resolve => { release = resolve })
    await context.route(/\/rest\/v1\/fh_leads(\?|$)/, async route => {
      if (route.request().method() === 'GET') await held
      await route.fallback()
    })
    await openJobs(page, '/jobs')
    const tabs = page.getByRole('tablist', { name: 'Job stages' })
    // The jobs are in: their tab has its count.
    await expect(tabs.getByRole('tab', { name: /^Jobs\b/ }).locator('.fhjl-tab__count')).toBeVisible()
    await expect(page.getByText('Plumbing Bellevue', { exact: true })).toHaveCount(0)
    await expect(page.getByText('Loading jobs', { exact: true })).toBeAttached()
    release()
    await expect(page.getByText('Plumbing Bellevue', { exact: true })).toBeVisible()
  })

  // PERF-10: a long list draws 40 rows and Load more adds the next 40.
  test('a long jobs list draws 40 rows and Load more brings the rest', async ({ context, page }) => {
    const client = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' }
    const jobs = Array.from({ length: 60 }, (_, i) => ({
      id: `c-long-${i}`, user_id: 'qa-user-1', client_id: 'cl-1', stage: 'job', name: `Customer ${i}`, job_title: `Driveway ${i}`,
      amount: 1000 + i, phone: null, email: null, address: null, notes: null, milestones: [], completed_at: null,
      created_at: '2026-09-01T12:00:00Z', updated_at: new Date(Date.UTC(2026, 9, 1, 12, i)).toISOString(), fh_clients: client
    }))
    await signIn(context, { tables: { fh_contacts: jobs } })
    await openJobs(page, '/jobs?stage=active')
    const rows = page.locator('.fhjl-rows > li')
    await expect(rows).toHaveCount(40)
    await expect(page.getByText('Showing 40 of 60 jobs.', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Load more jobs', exact: true }).click()
    await expect(rows).toHaveCount(60)
    await expect(page.getByRole('button', { name: 'Load more jobs', exact: true })).toHaveCount(0)
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
