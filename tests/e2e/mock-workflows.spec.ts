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
  await capture(page, testInfo, 'settings')

  await openRoute(page, '/this-route-does-not-exist')
  await expect(page.getByText(/page not found/i)).toBeVisible()
  await capture(page, testInfo, 'not-found')

  expectNoPageErrors()
})
