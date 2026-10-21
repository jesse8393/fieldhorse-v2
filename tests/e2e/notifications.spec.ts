// Notifications are a screen (Phase 9, Task 2, decisions D57, D63 and D64).
// The bell in the header navigates to /notifications instead of opening a
// sheet. Each row opens its record. A reminder (follow_up_due or
// review_ask_due) shows Done and Dismiss, which call fh_follow_up_set_status
// and take the row out of the list. A failed read says so with Try again.
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'
import { rpcCalls } from './helpers/rpcCalls.ts'

// A script error fails the test, not only a missing element.
let pageErrors: string[] = []
test.beforeEach(({ page }) => {
  pageErrors = []
  page.on('pageerror', (error) => pageErrors.push(error.message))
})
test.afterEach(() => { expect(pageErrors, pageErrors.join('\n')).toEqual([]) })

async function open(page: Page, path: string, ready: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator(ready).first()).toBeVisible({ timeout: 30_000 })
}

const iso = (ms: number) => new Date(ms).toISOString()
const HOUR = 3600e3

const note = (id: string, kind: string, title: string, link: string | null, extra: Record<string, unknown> = {}) => ({
  id, user_id: 'qa-user-1', actor_user_id: null, kind, title,
  body: null, link, read_at: null, created_at: iso(Date.now() - HOUR), ...extra
})

const REMINDER = note('nt-fu1', 'follow_up_due', 'Day 7 call: Justin Bryan', '/jobs/c-job1', {
  body: 'It has been a week since the quote went out.'
})
const APPROVED = note('nt-ok1', 'quote_approved', 'MMC Properties approved the quote', '/jobs/c-job2')

test('the bell opens the notifications screen, not a sheet', async ({ context, page }) => {
  await signIn(context, { tables: { fh_notifications: [APPROVED] } })
  await open(page, '/work', '.fhs-header')
  await page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }).click()
  await expect(page).toHaveURL(/\/notifications$/)
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible()
  await expect(page.getByText('MMC Properties approved the quote')).toBeVisible()
  expect(await page.locator('[role="dialog"]').count()).toBe(0)
})

test('a reminder shows Done and Dismiss and the row leaves the list', async ({ context, page }) => {
  await signIn(context, { tables: { fh_notifications: [REMINDER, APPROVED] } })
  await open(page, '/notifications', '.fhn')
  const row = page.locator('.fhn-row').filter({ hasText: 'Day 7 call: Justin Bryan' })
  await expect(row).toBeVisible()
  await expect(row.getByRole('button', { name: 'Done', exact: true })).toBeVisible()
  await expect(row.getByRole('button', { name: 'Dismiss', exact: true })).toBeVisible()
  // A plain notification has neither.
  const other = page.locator('.fhn-row').filter({ hasText: 'MMC Properties approved the quote' })
  expect(await other.getByRole('button', { name: 'Done', exact: true }).count()).toBe(0)

  await row.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(row).toHaveCount(0)
  await expect(other).toBeVisible()
  const calls = rpcCalls(context, 'fh_follow_up_set_status')
  expect(calls.map((c) => c.body)).toEqual([{ p_notification_id: 'nt-fu1', p_status: 'done' }])
  // Still on the screen, nothing popped up.
  await expect(page).toHaveURL(/\/notifications$/)
  expect(await page.locator('[role="dialog"]').count()).toBe(0)
})

test('Dismiss closes the reminder as dismissed', async ({ context, page }) => {
  await signIn(context, { tables: { fh_notifications: [REMINDER] } })
  await open(page, '/notifications', '.fhn')
  const row = page.locator('.fhn-row').filter({ hasText: 'Day 7 call: Justin Bryan' })
  await row.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(row).toHaveCount(0)
  expect(rpcCalls(context, 'fh_follow_up_set_status').map((c) => c.body)).toEqual([
    { p_notification_id: 'nt-fu1', p_status: 'dismissed' }
  ])
  await expect(page.getByText('All caught up.')).toBeVisible()
})

test('tapping a notification opens its link', async ({ context, page }) => {
  await signIn(context, { tables: { fh_notifications: [APPROVED] } })
  await open(page, '/notifications', '.fhn')
  await page.getByRole('button', { name: /MMC Properties approved the quote/ }).click()
  await expect(page).toHaveURL(/\/jobs\/c-job2/)
})

test('a failed read says so with Try again', async ({ context, page }) => {
  await signIn(context, { tables: { fh_notifications: [APPROVED] } })
  const failing = { on: true }
  await context.route((url) => url.pathname === '/rest/v1/fh_notifications', (route) => {
    if (failing.on && route.request().method() === 'GET') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server error' }) })
    }
    return route.fallback()
  })
  await open(page, '/notifications', '.fhn')
  const error = page.getByRole('alert').filter({ hasText: "Couldn't load your notifications" })
  await expect(error).toBeVisible()
  expect(await page.getByText('All caught up.').count()).toBe(0)

  failing.on = false
  await error.getByRole('button', { name: 'Try again', exact: true }).click()
  await expect(page.getByText('MMC Properties approved the quote')).toBeVisible()
  expect(await page.getByRole('alert').count()).toBe(0)
})
