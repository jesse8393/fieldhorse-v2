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

// OPS-05: the bell shows for every role, so every role can open the screen.
for (const role of ['manager', 'foreman', 'crew']) {
  test(`a ${role} can open notifications from the bell`, async ({ context, page }) => {
    await signIn(context, { role, tables: { fh_notifications: [APPROVED] } })
    await open(page, '/notifications', '.fhn')
    await expect(page).toHaveURL(/\/notifications$/)
    await expect(page.getByText('MMC Properties approved the quote')).toBeVisible()
  })
}

// OPS-12: the bell kept the old count after Mark all read.
test('after Mark all read the bell no longer shows the old count', async ({ context, page }) => {
  await signIn(context, { tables: { fh_notifications: [APPROVED] } })
  // The mock keeps no write, so once the row is marked read the unread
  // count answers 0, as the database would.
  let marked = false
  await context.route((url) => url.pathname === '/rest/v1/fh_notifications', (route) => {
    const request = route.request()
    if (request.method() === 'PATCH') marked = true
    else if (marked && new URL(request.url()).searchParams.get('read_at') === 'is.null') {
      return route.fulfill({ status: 200, contentType: 'application/json', headers: { 'content-range': '*/0' }, body: '[]' })
    }
    return route.fallback()
  })
  await open(page, '/work', '.fhs-header')
  await page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }).click()
  await expect(page).toHaveURL(/\/notifications$/)
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click()
  await expect(page.getByText('All caught up.')).toBeVisible()
  await page.getByRole('button', { name: 'Back', exact: true }).click()
  await expect(page).toHaveURL(/\/(work|jobs)/)
  await expect(page.getByRole('button', { name: 'Notifications', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: /unread/ })).toHaveCount(0)
})

// OPS-13: a failed write used to read as success.
test('a failed Mark all read puts the rows back and says so', async ({ context, page }) => {
  await signIn(context, { tables: { fh_notifications: [APPROVED] } })
  await context.route((url) => url.pathname === '/rest/v1/fh_notifications', (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server error' }) })
    return route.fallback()
  })
  await open(page, '/notifications', '.fhn')
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click()
  await expect(page.getByText(/Couldn't mark/).first()).toBeVisible()
  await expect(page.getByText('1 new notification.')).toBeVisible()
  await expect(page.getByText('All caught up.')).toHaveCount(0)
})

test('a failed mark read on opening a row puts the row back to unread', async ({ context, page }) => {
  await signIn(context, { tables: { fh_notifications: [{ ...APPROVED, link: null }] } })
  await context.route((url) => url.pathname === '/rest/v1/fh_notifications', (route) => {
    if (route.request().method() === 'PATCH') return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server error' }) })
    return route.fallback()
  })
  await open(page, '/notifications', '.fhn')
  await page.getByRole('button', { name: /MMC Properties approved the quote/ }).click()
  await expect(page.getByText(/Couldn't mark/).first()).toBeVisible()
  await expect(page.getByText('1 new notification.')).toBeVisible()
})

// DATA-16: past 100 rows the list stopped, and Mark all read cleared rows
// never shown.
test('the list pages past 100, and Mark all read marks only the rows on screen', async ({ context, page }) => {
  const many = Array.from({ length: 130 }, (_, n) => note(`nt-${String(n).padStart(3, '0')}`, 'quote_approved', `Approved quote ${n}`, null, {
    created_at: iso(Date.now() - (n + 1) * HOUR)
  }))
  await signIn(context, { tables: { fh_notifications: many } })
  const patches: string[] = []
  await context.route((url) => url.pathname === '/rest/v1/fh_notifications', (route) => {
    if (route.request().method() === 'PATCH') patches.push(decodeURIComponent(route.request().url()))
    return route.fallback()
  })
  await open(page, '/notifications', '.fhn')
  await expect(page.getByText('Approved quote 99')).toBeVisible()
  await expect(page.getByText('Approved quote 100')).toHaveCount(0)
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click()
  await expect.poll(() => patches.length).toBe(1)
  expect(patches[0]).toContain('id=in.(')
  expect(patches[0]).toContain('nt-099')
  expect(patches[0]).not.toContain('nt-100')
  await page.getByRole('button', { name: 'Show older notifications', exact: true }).click()
  await expect(page.getByText('Approved quote 129')).toBeVisible()
  await expect(page.getByText('30 new notifications.')).toBeVisible()
})
