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

test('keeps the desktop schedule planning workflow complete', async ({ page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop schedule workflow')
  const expectNoPageErrors = failOnPageErrors(page)
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.setViewportSize({ width: 1440, height: 900 })

  await openRoute(page, '/schedule')
  await expect(page.locator('.fh-build-weekplan')).toBeVisible()
  await expect(page.locator('.fh-build-weekplan__day')).toHaveCount(7)
  await capture(page, testInfo, 'desktop-schedule-week', true)

  await page.getByRole('button', { name: 'Day', exact: true }).click()
  await expect(page.locator('.fh-build-dayplan')).toBeVisible()
  const event = page.locator('.fh-build-dayplan__event').first()
  await expect(event).toContainText('Pour slab')
  await capture(page, testInfo, 'desktop-schedule-day', true)
  await event.click()
  await expect(page.getByRole('heading', { name: 'Edit event' })).toBeVisible()
  await capture(page, testInfo, 'desktop-schedule-edit', true)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  await page.getByRole('button', { name: 'Month', exact: true }).click()
  await expect(page.locator('.fh-build-cal')).toBeVisible()
  await capture(page, testInfo, 'desktop-schedule-month', true)
  await page.getByRole('button', { name: 'Week', exact: true }).click()
  await expect(page.locator('.fh-build-weekplan')).toBeVisible()

  await page.getByRole('button', { name: 'New event', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Add event' })).toBeVisible()
  await capture(page, testInfo, 'desktop-schedule-new', true)
  await page.getByRole('button', { name: 'Cancel', exact: true }).click()

  expectNoPageErrors()
})

test('uses the full desktop workspace without changing the mobile screens', async ({ page }, testInfo) => {
  const expectNoPageErrors = failOnPageErrors(page)
  const desktop = testInfo.project.name.startsWith('desktop')

  if (!desktop) {
    const mobileRoutes = [
      { path: '/activity', name: 'activity', desktopScreen: 'SnowActivityBuild' },
      { path: '/import', name: 'import', desktopScreen: 'Importer' },
      { path: '/partners', name: 'partners', desktopScreen: 'SnowPartnersBuild' },
    ]

    for (const route of mobileRoutes) {
      await openRoute(page, route.path)
      await expect(page.locator('.fh-app')).toHaveAttribute('data-layout', 'responsive')
      await expect(page.locator(`[data-build-screen="${route.desktopScreen}"]`)).toHaveCount(0)
      const dimensions = await page.evaluate(() => {
        const inner = document.querySelector('.fh-app__main-inner')
        return {
          contentWidth: inner?.getBoundingClientRect().width || 0,
          viewportWidth: window.innerWidth,
          scrollWidth: document.documentElement.scrollWidth,
        }
      })
      expect(dimensions.contentWidth).toBeLessThanOrEqual(dimensions.viewportWidth)
      expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1)
      await page.waitForTimeout(500)
      await capture(page, testInfo, `mobile-${route.name}`, true)
    }

    expectNoPageErrors()
    return
  }

  await page.setViewportSize({ width: 1440, height: 900 })
  const desktopRoutes = [
    { path: '/activity', name: 'activity', ready: '[data-build-screen="SnowActivityBuild"]', minWidth: 1000 },
    { path: '/import', name: 'import', ready: '[data-build-screen="Importer"]', minWidth: 1000 },
    { path: '/partners', name: 'partners', ready: '[data-build-screen="SnowPartnersBuild"]', minWidth: 1000 },
    { path: '/invoices/c-job2', name: 'invoice-detail', ready: '.v3-screen--invoice-detail', minWidth: 900 },
    { path: '/subs/qa-missing', name: 'sub-detail', ready: '[data-build-screen="SubDetailState"]', minWidth: 1000 },
    { path: '/sub-portal', name: 'sub-portal', ready: '[data-build-screen="SubPortal"]', minWidth: 1000 },
  ]

  for (const route of desktopRoutes) {
    await openRoute(page, route.path)
    await expect(page.locator('.fh-app')).toHaveAttribute('data-layout', 'responsive')
    await expect(page.locator(route.ready)).toBeVisible()
    const dimensions = await page.evaluate((selector) => {
      const content = document.querySelector(selector)
      return {
        contentWidth: content?.getBoundingClientRect().width || 0,
        viewportWidth: window.innerWidth,
        scrollWidth: document.documentElement.scrollWidth,
      }
    }, route.ready)
    expect(dimensions.contentWidth).toBeGreaterThan(route.minWidth)
    expect(dimensions.scrollWidth).toBeLessThanOrEqual(dimensions.viewportWidth + 1)

    if (route.name === 'invoice-detail') {
      const alignment = await page.evaluate(() => {
        const screen = document.querySelector('.v3-screen--invoice-detail')?.getBoundingClientRect()
        const actionbar = document.querySelector('.fh-invoice-actionbar')?.getBoundingClientRect()
        return {
          centerDelta: screen && actionbar
            ? Math.abs((screen.left + screen.width / 2) - (actionbar.left + actionbar.width / 2))
            : Number.POSITIVE_INFINITY,
          contained: Boolean(screen && actionbar && actionbar.left >= screen.left && actionbar.right <= screen.right),
        }
      })
      expect(alignment.centerDelta).toBeLessThanOrEqual(1)
      expect(alignment.contained).toBe(true)
    }

    if (route.name === 'activity' || route.name === 'partners') {
      const tableHeader = page.locator(route.name === 'activity'
        ? '.fh-activity-table__head'
        : '.fh-partners-table__head')
      const tableWidth = await tableHeader.evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
      }))
      expect(tableWidth.scrollWidth).toBeLessThanOrEqual(tableWidth.clientWidth + 1)
    }

    await capture(page, testInfo, `desktop-${route.name}`, true)
  }

  const sidebarOverflow = await page.locator('.fh-desktop-sidebar__nav').evaluate((element) => ({
    overflowY: getComputedStyle(element).overflowY,
    scrollbarWidth: getComputedStyle(element).scrollbarWidth,
  }))
  expect(sidebarOverflow.overflowY).toBe('auto')
  expect(sidebarOverflow.scrollbarWidth).toBe('none')

  await page.setViewportSize({ width: 1024, height: 900 })
  const compactDesktopRoutes = [
    { path: '/activity', ready: '[data-build-screen="SnowActivityBuild"]', table: '.fh-activity-table__head' },
    { path: '/partners', ready: '[data-build-screen="SnowPartnersBuild"]', table: '.fh-partners-table__head' },
    { path: '/invoices/c-job2', ready: '.v3-screen--invoice-detail', table: null },
  ]

  for (const route of compactDesktopRoutes) {
    await openRoute(page, route.path)
    await expect(page.locator(route.ready)).toBeVisible()
    const geometry = await page.evaluate(({ table }) => {
      const tableElement = table ? document.querySelector(table) : null
      const screen = document.querySelector('.v3-screen--invoice-detail')?.getBoundingClientRect()
      const actionbar = document.querySelector('.fh-invoice-actionbar')?.getBoundingClientRect()
      return {
        pageOverflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
        tableOverflow: tableElement ? tableElement.scrollWidth - tableElement.clientWidth : 0,
        invoiceCenterDelta: screen && actionbar
          ? Math.abs((screen.left + screen.width / 2) - (actionbar.left + actionbar.width / 2))
          : 0,
        invoiceContained: screen && actionbar
          ? actionbar.left >= screen.left && actionbar.right <= screen.right
          : true,
      }
    }, route)
    expect(geometry.pageOverflow).toBeLessThanOrEqual(1)
    expect(geometry.tableOverflow).toBeLessThanOrEqual(1)
    expect(geometry.invoiceCenterDelta).toBeLessThanOrEqual(1)
    expect(geometry.invoiceContained).toBe(true)
  }

  expectNoPageErrors()
})

test('keeps estimating and dispatch desktop-native while preserving their mobile forms', async ({ page }, testInfo) => {
  const expectNoPageErrors = failOnPageErrors(page)
  const desktop = testInfo.project.name.startsWith('desktop')

  if (!desktop) {
    for (const route of [
      { path: '/bid', ready: '.fh-bid-workspace__scope' },
      { path: '/compose', ready: '.fh-compose-workspace__input' },
    ]) {
      const path = route.path
      await openRoute(page, path)
      await expect(page.locator(route.ready)).toBeVisible()
      await expect(page.locator('[data-build-screen]')).toHaveCount(0)
      const geometry = await page.evaluate(() => ({
        viewportWidth: window.innerWidth,
        pageWidth: document.documentElement.scrollWidth,
        rootWidth: document.querySelector('.fh-app__main-inner')?.firstElementChild?.getBoundingClientRect().width || 0,
      }))
      expect(geometry.rootWidth).toBeLessThanOrEqual(geometry.viewportWidth)
      expect(geometry.pageWidth).toBeLessThanOrEqual(geometry.viewportWidth + 1)
      await page.waitForTimeout(500)
      await capture(page, testInfo, `mobile-${path.slice(1)}`, true)
    }
    expectNoPageErrors()
    return
  }

  await page.setViewportSize({ width: 1440, height: 900 })

  await openRoute(page, '/bid')
  await expect(page.locator('.fh-bid-workspace')).toBeVisible()
  const bidWide = await page.evaluate(() => {
    const root = document.querySelector('.fh-bid-workspace')?.getBoundingClientRect()
    const scope = document.querySelector('.fh-bid-workspace__scope')?.getBoundingClientRect()
    const result = document.querySelector('.fh-bid-workspace__result')?.getBoundingClientRect()
    return {
      rootWidth: root?.width || 0,
      sideBySide: Boolean(scope && result && result.left >= scope.right),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(bidWide.rootWidth).toBeGreaterThan(1000)
  expect(bidWide.sideBySide).toBe(true)
  expect(bidWide.overflow).toBeLessThanOrEqual(1)
  await capture(page, testInfo, 'desktop-bid-workspace', true)

  await openRoute(page, '/compose')
  await expect(page.locator('[data-build-screen="Compose"]')).toBeVisible()
  const composeWide = await page.evaluate(() => {
    const input = document.querySelector('.fh-compose-workspace__input')?.getBoundingClientRect()
    const output = document.querySelector('.fh-compose-workspace__output')?.getBoundingClientRect()
    return {
      inputTop: input?.top || Number.POSITIVE_INFINITY,
      sideBySide: Boolean(input && output && output.left >= input.right),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(composeWide.inputTop).toBeLessThan(260)
  expect(composeWide.sideBySide).toBe(true)
  expect(composeWide.overflow).toBeLessThanOrEqual(1)
  await capture(page, testInfo, 'desktop-compose-workspace', true)

  await page.setViewportSize({ width: 1024, height: 900 })
  await openRoute(page, '/bid')
  await expect(page.locator('.fh-bid-workspace__scope')).toBeVisible()
  await expect(page.locator('.fh-bid-workspace__result')).toBeVisible()
  const bidCompact = await page.evaluate(() => {
    const scope = document.querySelector('.fh-bid-workspace__scope')?.getBoundingClientRect()
    const result = document.querySelector('.fh-bid-workspace__result')?.getBoundingClientRect()
    return {
      stacked: Boolean(scope && result && result.top >= scope.bottom),
      overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    }
  })
  expect(bidCompact.stacked).toBe(true)
  expect(bidCompact.overflow).toBeLessThanOrEqual(1)

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
