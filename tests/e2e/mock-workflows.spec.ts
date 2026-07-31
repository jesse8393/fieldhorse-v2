import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { installMock, session } from '../../scripts/qa-mock.mjs'

async function installSession(context: BrowserContext) {
  await installMock(context)
  await context.addInitScript((savedSession) => {
    localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(savedSession))
    localStorage.setItem('fh:theme', 'dark')
    localStorage.setItem('fh-onboarding-seen', '1')
  }, session)
}

function failOnPageErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return () => expect(errors, errors.join('\n')).toEqual([])
}

async function openRoute(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 20_000 })
}

async function capture(page: Page, testInfo: TestInfo, name: string, fullPage = false) {
  if (process.env.QA_SCREENSHOTS !== '1') return
  await page.screenshot({
    path: testInfo.outputPath(`${name}.png`),
    fullPage
  })
}

test.beforeEach(async ({ context }) => {
  await installSession(context)
})

test('keeps the work lifecycle action ready', async ({ page }, testInfo) => {
  const expectNoPageErrors = failOnPageErrors(page)

  await openRoute(page, '/work')
  await expect(page.getByRole('heading', { name: /work & deals/i })).toBeVisible()
  await expect(page.getByText('Justin Bryan', { exact: true })).toBeVisible()
  await expect(page.getByText('MMC Properties', { exact: true })).toBeVisible()
  await expect(page.getByText('Plumbing Bellevue', { exact: true })).toBeVisible()
  await capture(page, testInfo, 'work')

  await openRoute(page, '/leads/c-lead1')
  await expect(page.getByRole('button', { name: /convert to quote/i })).toBeVisible()
  await capture(page, testInfo, 'lead')

  await openRoute(page, '/quotes/c-quote?tab=quote')
  await expect(page.getByRole('button', { name: /approve quote/i })).toBeVisible()
  await expect(page.getByText(/follow up [a-z]{3} \d{1,2}/i).first()).toBeVisible()
  await capture(page, testInfo, 'quote')

  await openRoute(page, '/jobs/c-job1')
  const sendInvoice = page.getByRole('button', { name: /send invoice/i }).first()
  await expect(sendInvoice).toBeVisible()
  await capture(page, testInfo, 'job')
  await sendInvoice.click()
  await expect(page.getByText(/create invoice|send invoice/i).last()).toBeVisible()
  await capture(page, testInfo, 'send-invoice')

  expectNoPageErrors()
})

test('keeps money, schedule, settings, and missing routes usable', async ({ page }, testInfo) => {
  const expectNoPageErrors = failOnPageErrors(page)

  await openRoute(page, '/')
  await expect(page.locator('body')).toContainText(/pipeline|owner queue|today/i)
  const pipelineButton = page.getByRole('button', { name: 'Open pipeline' })
  if (await pipelineButton.count()) {
    await expect(pipelineButton.locator('.v3-skeleton')).toHaveCount(0)
  }
  if (testInfo.project.name.startsWith('desktop')) {
    await expect(page.getByText(/collected this week/i)).toHaveCount(1)
  }
  await expect(page.getByText(/\+?0(?:\.0)?%\s*[·•]\s*7d/i)).toHaveCount(0)
  if (testInfo.project.name.startsWith('mobile')) {
    await expect(page.getByText('Job Behind', { exact: true })).toBeVisible()
    await expect(page.getByText('Jobs Behind', { exact: true })).toHaveCount(0)
  }
  await capture(page, testInfo, 'home', true)

  await openRoute(page, '/invoices')
  await expect(page.getByText('Progress draw 1', { exact: true })).toBeVisible()
  await capture(page, testInfo, 'invoices')

  await openRoute(page, '/schedule')
  await expect(page.getByText(/pour slab/i).first()).toBeVisible()
  await capture(page, testInfo, 'schedule')

  await openRoute(page, '/settings')
  await expect(page.getByRole('button', { name: /save changes/i })).toBeVisible()
  const quoteReminderSetting = page.getByText('Set reminder when quote is sent', { exact: true })
  await expect(quoteReminderSetting).toBeVisible()
  await expect(page.getByLabel('Quote reminder delay')).toHaveValue('3')
  await capture(page, testInfo, 'settings')
  await quoteReminderSetting.scrollIntoViewIfNeeded()
  await capture(page, testInfo, 'settings-quote-follow-up')

  await openRoute(page, '/this-route-does-not-exist')
  await expect(page.getByText(/page not found/i)).toBeVisible()
  await capture(page, testInfo, 'not-found')

  expectNoPageErrors()
})

test('keeps customer quote change requests in the workflow', async ({ page }, testInfo) => {
  const expectNoPageErrors = failOnPageErrors(page)
  let submitted: any = null

  await page.route((url) => url.pathname === '/api/public-link' && url.searchParams.get('token') === 'qa-proposal', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      headers: { 'Cache-Control': 'no-store' },
      body: JSON.stringify({
        ok: true,
        kind: 'proposal',
        contact: {
          id: 'public-quote-1',
          name: 'Taylor Reed',
          email: 'taylor@example.com',
          address: '14 Market Street',
          job_title: 'Kitchen renovation',
          stage: 'quote',
          proposal_status: submitted ? 'changes_requested' : 'sent',
          quote_change_request_note: submitted?.request_text || null,
          quote_change_requested_at: submitted ? '2026-07-30T12:00:00.000Z' : null,
          amount: 18400,
          created_at: '2026-07-20T12:00:00.000Z',
          quote_sent_at: '2026-07-29T12:00:00.000Z',
        },
        company: {
          name: 'Parker Construction Company',
          email: 'office@parker.co',
          estimate_template: 'classic',
        },
        items: [{
          id: 'item-1',
          section: 'Cabinetry',
          description: 'Cabinet allowance',
          qty: 1,
          rate: 18400,
          amount: 18400,
          is_optional: false,
          is_excluded: false,
        }],
        payments: [],
        changeOrders: [],
        insurance: null,
        invoices: [],
        photos: [],
      }),
    })
  })
  await page.route('**/api/public-link-request-changes', async (route) => {
    submitted = route.request().postDataJSON()
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({
        ok: true,
        requested_by: submitted.requester_name,
        requested_at: '2026-07-30T12:00:00.000Z',
      }),
    })
  })

  await openRoute(page, '/p/qa-proposal')
  await page.getByRole('button', { name: 'Request changes' }).click()
  await page.getByLabel('Changes needed').fill('Please separate the cabinet allowance.')
  await page.getByRole('button', { name: 'Send request' }).click()

  await expect(page.getByRole('heading', { name: 'Your feedback is with the contractor.' })).toBeVisible()
  await capture(page, testInfo, 'quote-change-request-confirmation', true)
  expect(submitted).toEqual({
    token: 'qa-proposal',
    requester_name: 'Taylor Reed',
    request_text: 'Please separate the cabinet allowance.',
  })
  const refreshedLink = page.waitForResponse((response) => (
    response.url().includes('/api/public-link?token=qa-proposal')
  ))
  await page.reload({ waitUntil: 'domcontentloaded' })
  const refreshedPayload = await (await refreshedLink).json()
  expect(refreshedPayload.contact).toMatchObject({
    proposal_status: 'changes_requested',
    quote_change_request_note: 'Please separate the cabinet allowance.',
  })
  await expect(page.getByText('Please separate the cabinet allowance.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Request changes' })).toHaveCount(0)
  await capture(page, testInfo, 'quote-change-requested-customer', true)

  await openRoute(page, '/quotes/c-change?tab=quote')
  await expect(page.getByRole('button', { name: 'Review changes' }).first()).toBeVisible()
  await expect(page.getByText('Please separate the cabinet allowance.', { exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /approve quote/i })).toHaveCount(0)
  await capture(page, testInfo, 'quote-change-requested-operator', true)

  expectNoPageErrors()
})
