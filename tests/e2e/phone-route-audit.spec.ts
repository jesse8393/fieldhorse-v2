import { expect, test } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { nothingRunsOffTheSide } from './helpers/overflow.ts'

// This runs in ordinary CI. Screenshot baselines are an optional visual
// comparison; clipping a form or a record must fail the normal release gate.
const routes = [
  '/', '/jobs', '/jobs/c-job1', '/leads', '/leads/l-lead1',
  '/quotes', '/quotes/q-quote', '/clients', '/clients/cl-1',
  '/invoices', '/invoices/inv1', '/schedule', '/analytics', '/notes',
  '/settings', '/crew', '/team', '/timesheets', '/tasks', '/subs',
  '/partners', '/activity', '/compose', '/bid', '/import', '/pour-window',
  '/capture', '/workspace', '/notifications',
  '/jobs/new', '/leads/new', '/quotes/new', '/clients/new', '/invoices/new',
  '/schedule/new', '/invoices/inv1/payment', '/invoices/inv1/remind'
]

test('every phone workspace and core form stays usable at 320 px', async ({ context, page }, testInfo) => {
  test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone route audit')
  test.setTimeout(240_000)
  await signIn(context)
  await page.setViewportSize({ width: 320, height: 844 })
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  for (const route of routes) {
    await page.goto(route, { waitUntil: 'domcontentloaded' })
    const main = page.locator('#fh-main')
    await expect(main).toBeVisible()
    await expect(main.locator('h1').first()).toBeVisible()
    await expect(main.locator('[aria-busy="true"]')).toHaveCount(0)
    await nothingRunsOffTheSide(page, route)
    const tinyInputs = await main.locator('input:not([type="checkbox"]):not([type="radio"]):not([type="hidden"]),textarea,select').evaluateAll(elements => elements.filter(element => {
      const bounds = element.getBoundingClientRect()
      return bounds.width > 0 && bounds.height > 0 && Number.parseFloat(getComputedStyle(element).fontSize) < 16
    }).map(element => element.getAttribute('aria-label') || element.id || element.tagName))
    expect(tinyInputs, `${route}: inputs must stay legible without iOS focus zoom`).toEqual([])
  }
  expect(errors).toEqual([])
})
