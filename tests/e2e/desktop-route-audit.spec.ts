import { expect, test, type BrowserContext, type Page, type TestInfo } from '@playwright/test'
import { installMock, session } from '../../scripts/qa-mock.mjs'

const routes = [
  { name: 'home', path: '/', ready: '[data-build-screen="SnowHomeBuild"]' },
  { name: 'work', path: '/work', ready: '.v3-screen--work' },
  { name: 'lead-detail', path: '/leads/c-lead1', ready: '[data-build-screen="SnowJobDetailBuild"]' },
  { name: 'quote-detail', path: '/quotes/c-quote?tab=quote', ready: '[data-build-screen="SnowJobDetailBuild"]' },
  { name: 'job-detail', path: '/jobs/c-job1', ready: '[data-build-screen="SnowJobDetailBuild"]' },
  { name: 'clients', path: '/clients', ready: '[data-build-screen="SnowClientsBuild"]' },
  { name: 'client-detail', path: '/clients/cl-1', ready: '[data-build-screen="SnowClientDetailBuild"]' },
  { name: 'notes', path: '/notes', ready: '[data-build-screen="SnowNotesBuild"]' },
  { name: 'schedule', path: '/schedule', ready: '[data-build-screen="SnowScheduleBuild"]' },
  { name: 'activity', path: '/activity', ready: '[data-build-screen="SnowActivityBuild"]' },
  { name: 'bid', path: '/bid', ready: '[data-build-screen="Bid"]' },
  { name: 'compose', path: '/compose', ready: '[data-build-screen="Compose"]' },
  { name: 'analytics', path: '/analytics', ready: '[data-build-screen="SnowAnalyticsBuild"]' },
  { name: 'import', path: '/import', ready: '[data-build-screen="Importer"]' },
  { name: 'settings', path: '/settings', ready: '[data-build-screen="SnowSettingsBuild"]' },
  { name: 'forecast', path: '/pour-window', ready: '[data-build-screen="SnowForecastBuild"]' },
  { name: 'subs', path: '/subs', ready: '[data-build-screen="SnowSubsBuild"]' },
  { name: 'sub-detail', path: '/subs/qa-missing', ready: '[data-build-screen="SubDetailState"]' },
  { name: 'partners', path: '/partners', ready: '[data-build-screen="SnowPartnersBuild"]' },
  { name: 'team', path: '/team', ready: '[data-build-screen="Team"]' },
  { name: 'crew', path: '/crew', ready: '[data-build-screen="Crew"]' },
  { name: 'timesheets', path: '/timesheets', ready: '[data-build-screen="Timesheets"]' },
  { name: 'tasks', path: '/tasks', ready: '[data-build-screen="Tasks"]' },
  { name: 'sub-portal', path: '/sub-portal', ready: '[data-build-screen="SubPortal"]' },
  { name: 'invoices', path: '/invoices', ready: '[data-build-screen="SnowInvoicesBuild"]' },
  { name: 'invoice-detail', path: '/invoices/c-job2', ready: '.v3-screen--invoice-detail' },
] as const

async function installSession(context: BrowserContext) {
  await installMock(context)
  await context.addInitScript((savedSession) => {
    localStorage.setItem('sb-qa-mock-auth-token', JSON.stringify(savedSession))
    localStorage.setItem('fh:theme', 'dark')
    localStorage.setItem('fh-onboarding-seen', '1')
  }, session)
}

async function capture(page: Page, testInfo: TestInfo, name: string) {
  if (process.env.QA_SCREENSHOTS !== '1') return
  await page.screenshot({
    path: testInfo.outputPath(`wide-${name}.png`),
    fullPage: true,
  })
}

test.beforeEach(async ({ context }) => {
  await installSession(context)
})

test('audits every authenticated workspace at the reported desktop size', async ({ page }, testInfo) => {
  test.setTimeout(180_000)
  test.skip(!testInfo.project.name.startsWith('desktop'), 'Wide desktop audit')
  await page.setViewportSize({ width: 2048, height: 1192 })

  const pageErrors: string[] = []
  page.on('pageerror', (error) => pageErrors.push(error.message))

  const measurements: Array<Record<string, string | number | boolean>> = []

  for (const route of routes) {
    await page.goto(route.path, { waitUntil: 'domcontentloaded', timeout: 30_000 })
    await expect(page.locator('.fh-app__main-inner')).toBeVisible()
    await expect(page.locator(route.ready).first()).toBeVisible()

    const geometry = await page.evaluate(() => {
      const inner = document.querySelector<HTMLElement>('.fh-app__main-inner')
      const root = inner?.firstElementChild as HTMLElement | null
      const sidebar = document.querySelector<HTMLElement>('.fh-desktop-sidebar')
      const innerRect = inner?.getBoundingClientRect()
      const rootRect = root?.getBoundingClientRect()
      const sidebarRect = sidebar?.getBoundingClientRect()
      return {
        rootClass: root?.className || '',
        buildScreen: root?.dataset.buildScreen || '',
        rootWidth: Math.round(rootRect?.width || 0),
        innerWidth: Math.round(innerRect?.width || 0),
        availableWidth: Math.round(window.innerWidth - (sidebarRect?.right || 0)),
        pageOverflow: Math.max(0, document.documentElement.scrollWidth - document.documentElement.clientWidth),
      }
    })

    measurements.push({ route: route.name, ...geometry })
    expect(geometry.rootWidth, `${route.path} fell back to an app-width desktop column`).toBeGreaterThanOrEqual(1200)
    expect(geometry.pageOverflow, `${route.path} overflows horizontally`).toBeLessThanOrEqual(1)
    await capture(page, testInfo, route.name)
  }

  console.table(measurements)
  expect(pageErrors, pageErrors.join('\n')).toEqual([])
})
