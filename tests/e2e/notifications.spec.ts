// Notifications are a screen (Phase 9, Task 2, decisions D57, D63 and D64).
// The bell in the header navigates to /notifications instead of opening a
// sheet. Each row opens its record. A failed read says so with Try again.
//
// Reminders (AUTO-09): with fh_my_open_reminders the screen opens with a
// Reminders section, one row per client, and the bell counts those rows plus
// the other unread notifications. Until that migration is applied the
// function is missing (PGRST202) and the screen keeps the flat list, where a
// reminder (follow_up_due or review_ask_due) shows Done and Dismiss.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
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

// What fh_my_open_reminders answers in this context: rows, or the error
// PostgREST gives for a function the database does not have yet.
async function remindersRpc(context: BrowserContext, rows: object[] | 'missing') {
  await context.route((url) => url.pathname === '/rest/v1/rpc/fh_my_open_reminders', (route) => route.fulfill(
    rows === 'missing'
      ? { status: 404, contentType: 'application/json', body: JSON.stringify({ code: 'PGRST202', details: null, hint: null, message: 'Could not find the function public.fh_my_open_reminders without parameters in the schema cache' }) }
      : { status: 200, contentType: 'application/json', body: JSON.stringify(rows) }
  ))
}

let seq = 0
const open1 = (client: string, kind: string, daysAgo: number, extra: Record<string, unknown> = {}) => {
  const n = ++seq
  const due = new Date(Date.now() - daysAgo * 24 * HOUR).toISOString().slice(0, 10)
  return {
    notification_id: `nt-r${n}`, follow_up_id: `fu-r${n}`, kind, record_kind: 'lead', record_id: `l-${n}`, link: `/leads/l-${n}`,
    client_id: `cl-${client.replace(/\W/g, '')}`, client_name: client, client_phone: '615-555-0142', client_email: null,
    headline: `Reminder ${n}: ${client}`, draft_body: `Hi ${client}, checking in.`, channel: 'text', due_on: due,
    days_quiet: 3, created_at: iso(Date.now() - daysAgo * 24 * HOUR), read_at: null, ...extra
  }
}
// The stored notification behind an open reminder, as fetchInbox reads it.
const asNote = (r: ReturnType<typeof open1>) =>
  note(r.notification_id, 'follow_up_due', r.headline, r.link, { body: r.draft_body, read_at: r.read_at })

test('the bell opens the notifications screen, not a sheet', async ({ context, page }) => {
  await signIn(context, { tables: { fh_notifications: [APPROVED] } })
  await open(page, '/work', '.fhs-header')
  await page.getByRole('button', { name: 'Notifications, 1 unread', exact: true }).click()
  await expect(page).toHaveURL(/\/notifications$/)
  await expect(page.getByRole('heading', { name: 'Notifications', exact: true })).toBeVisible()
  await expect(page.getByText('MMC Properties approved the quote')).toBeVisible()
  expect(await page.locator('[role="dialog"]').count()).toBe(0)
})

test('without the reminders function a reminder shows Done and Dismiss and the row leaves the list', async ({ context, page }) => {
  await signIn(context, { tables: { fh_notifications: [REMINDER, APPROVED] } })
  await remindersRpc(context, 'missing')
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

test('without the reminders function Dismiss closes the reminder as dismissed', async ({ context, page }) => {
  await signIn(context, { tables: { fh_notifications: [REMINDER] } })
  await remindersRpc(context, 'missing')
  await open(page, '/notifications', '.fhn')
  const row = page.locator('.fhn-row').filter({ hasText: 'Day 7 call: Justin Bryan' })
  await row.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(row).toHaveCount(0)
  expect(rpcCalls(context, 'fh_follow_up_set_status').map((c) => c.body)).toEqual([
    { p_notification_id: 'nt-fu1', p_status: 'dismissed' }
  ])
  await expect(page.getByText('All caught up.')).toBeVisible()
  // The missing function is not an error the person sees.
  expect(await page.getByRole('alert').count()).toBe(0)
})

test('tapping a notification opens its link', async ({ context, page }) => {
  await signIn(context, { tables: { fh_notifications: [APPROVED] } })
  await open(page, '/notifications', '.fhn')
  await page.getByRole('button', { name: /MMC Properties approved the quote/ }).click()
  await expect(page).toHaveURL(/\/jobs\/c-job2/)
})

// dead-ends-6: change order and partner notifications open the section they
// name. Rows already sent carry ?tab=quote and ?tab=partners, which open
// Change orders and Partner access too, and a new change order writes a row
// that names Change orders.
test('change order and partner notifications open the section they name', async ({ context, page }) => {
  const signed = note('nt-co', 'change_order_signed', 'Change order signed', '/jobs/c-job1?tab=quote')
  const joined = note('nt-pa', 'partner_accepted', 'Partner joined your job', '/jobs/c-job1?tab=partners')
  const co = { id: 'co-1', org_id: 'org-1', user_id: 'qa-user-1', contact_id: 'c-job1', sequence_number: 1, title: 'Extra footing', description: null, amount: 1800, status: 'draft', created_at: iso(Date.now() - HOUR) }
  await signIn(context, { tables: { fh_notifications: [signed, joined], fh_change_orders: [co] } })
  for (const [title, section] of [['Change order signed', 'Change orders'], ['Partner joined your job', 'Partner access']]) {
    await open(page, '/notifications', '.fhn')
    await page.getByRole('button', { name: new RegExp(title) }).click()
    await expect(page).toHaveURL(/\/jobs\/c-job1\?tab=/)
    await expect(page.getByRole('region', { name: `${section} workspace`, exact: true })).toBeVisible({ timeout: 30_000 })
  }

  const written: Record<string, unknown>[] = []
  await context.route((url) => url.pathname.endsWith('/rest/v1/fh_notifications'), (route) => {
    if (route.request().method() !== 'POST') return route.fallback()
    written.push(route.request().postDataJSON())
    return route.fulfill({ status: 201, contentType: 'application/json', body: '[]' })
  })
  await open(page, '/jobs/c-job1?tab=change_orders', '.fh-app-header')
  await page.getByRole('button', { name: 'Add', exact: true }).click()
  await page.getByPlaceholder("Rot at SW corner. Replace ~8' bottom plate").fill('Extra footing')
  await page.locator('input[inputmode="decimal"]').first().fill('1800')
  await page.getByRole('button', { name: 'Add change order', exact: true }).click()
  await expect.poll(() => written.length).toBe(1)
  expect(written[0]).toMatchObject({ kind: 'change_order_added', link: '/jobs/c-job1?tab=change_orders' })
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

test('30 reminders show one row per client, with the other notifications below', async ({ context, page }) => {
  const clients = ['Jeff Roy', 'Ana Ortiz', 'Bo Lane', 'Cy Diaz', 'Di West', 'Ed Pruitt']
  const reminders = clients.flatMap((c, i) => [9, 7, 5, 3, 1].map((d) => open1(c, 'day3', d + i)))
  await signIn(context, { tables: { fh_notifications: [...reminders.map(asNote), APPROVED] } })
  await remindersRpc(context, reminders)
  await open(page, '/notifications', '.fhn')
  const section = page.getByRole('region', { name: 'Reminders' })
  await expect(section.locator('.fhn-row')).toHaveCount(6)
  for (const c of clients) await expect(section.locator('.fhn-row').filter({ hasText: c })).toHaveCount(1)
  // The row leads with the newest reminder and says how many are open.
  const jeff = section.locator('.fhn-row').filter({ hasText: 'Jeff Roy' })
  await expect(jeff).toContainText('5 reminders')
  // No reminder is listed twice: the other list has only the other notification.
  const others = page.getByRole('region', { name: 'Other notifications' })
  await expect(others.locator('.fhn-row')).toHaveCount(1)
  await expect(others).toContainText('MMC Properties approved the quote')
  await expect(page.getByText('6 customers to follow up and 1 new notification.', { exact: true })).toBeVisible()
  expect(await page.locator('[role="dialog"]').count()).toBe(0)
})

test('the bell counts what the screen lists', async ({ context, page }) => {
  const reminders = [open1('Jeff Roy', 'day3', 4), open1('Jeff Roy', 'day7', 1, { read_at: iso(Date.now() - HOUR) }), open1('Ana Ortiz', 'day3', 2)]
  await signIn(context, { tables: { fh_notifications: [...reminders.map(asNote), APPROVED] } })
  await remindersRpc(context, reminders)
  await open(page, '/work', '.fhs-header')
  await page.getByRole('button', { name: 'Notifications, 3 unread', exact: true }).click()
  await expect(page.getByText('2 customers to follow up and 1 new notification.', { exact: true })).toBeVisible()
  await expect(page.getByRole('region', { name: 'Reminders' }).locator('.fhn-row')).toHaveCount(2)
})

// The app publishes the same signed in person more than once (the saved
// session, then the auth listener's own copy), and the bell read its count
// again for each copy, twice on every app reopen (vibe audit console-1).
// Here the auth client hears the same session again, the way another tab's
// token refresh reaches it, and the bell must not read again.
test('the bell reads its count once for the same person, however often the session is published', async ({ context, page }) => {
  await signIn(context, { tables: { fh_notifications: [APPROVED] } })
  const reads: string[] = []
  page.on('request', (request) => {
    const url = request.url()
    if (url.includes('/rest/v1/rpc/fh_my_open_reminders') || (url.includes('/rest/v1/fh_notifications') && url.includes('read_at=is.null'))) reads.push(`${request.method()} ${url}`)
  })
  await open(page, '/work', '.fhs-header')
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread', exact: true })).toBeVisible()
  await page.waitForTimeout(1000)
  const settled = reads.length
  expect(settled).toBeGreaterThan(0)
  await page.evaluate(() => {
    const key = 'sb-qa-mock-auth-token'
    const session = JSON.parse(localStorage.getItem(key) || 'null')
    const channel = new BroadcastChannel(key)
    channel.postMessage({ event: 'TOKEN_REFRESHED', session })
    channel.postMessage({ event: 'SIGNED_IN', session: { ...session, user: { ...session.user } } })
    channel.close()
  })
  await page.waitForTimeout(1500)
  await expect(page.getByRole('button', { name: 'Notifications, 1 unread', exact: true })).toBeVisible()
  expect(reads.slice(settled)).toEqual([])
})

test('a reminder row offers Text, Done closes every reminder for that client and the row leaves', async ({ context, page }) => {
  const reminders = [open1('Jeff Roy', 'day3', 4), open1('Jeff Roy', 'day7', 1, { headline: 'Day 7 call: Jeff Roy' }), open1('Ana Ortiz', 'day3', 2)]
  await signIn(context, { tables: { fh_notifications: reminders.map(asNote) } })
  await remindersRpc(context, reminders)
  await open(page, '/notifications', '.fhn')
  const row = page.getByRole('region', { name: 'Reminders' }).locator('.fhn-row').filter({ hasText: 'Jeff Roy' })
  await expect(row).toContainText('Day 7 call: Jeff Roy')
  await expect(row.getByRole('link', { name: 'Text Jeff Roy', exact: true })).toHaveAttribute('href', 'sms:6155550142')
  await row.getByRole('button', { name: 'Done', exact: true }).click()
  await expect(row).toHaveCount(0)
  const calls = rpcCalls(context, 'fh_follow_up_set_status').map((c) => c.body)
  expect(calls).toEqual(expect.arrayContaining([
    { p_notification_id: reminders[0].notification_id, p_status: 'done' },
    { p_notification_id: reminders[1].notification_id, p_status: 'done' }
  ]))
  expect(calls).toHaveLength(2)
  await expect(page.getByRole('region', { name: 'Reminders' }).locator('.fhn-row')).toHaveCount(1)
})

test('Dismiss on a reminder row asks for a second tap', async ({ context, page }) => {
  const reminders = [open1('Bo Lane', 'day14', 3)]
  await signIn(context, { tables: { fh_notifications: reminders.map(asNote) } })
  await remindersRpc(context, reminders)
  await open(page, '/notifications', '.fhn')
  const row = page.getByRole('region', { name: 'Reminders' }).locator('.fhn-row').filter({ hasText: 'Bo Lane' })
  await row.getByRole('button', { name: 'Dismiss', exact: true }).click()
  await expect(row).toBeVisible()
  expect(rpcCalls(context, 'fh_follow_up_set_status')).toHaveLength(0)
  await row.getByRole('button', { name: 'Tap again to dismiss', exact: true }).click()
  await expect(row).toHaveCount(0)
  expect(rpcCalls(context, 'fh_follow_up_set_status').map((c) => c.body)).toEqual([
    { p_notification_id: reminders[0].notification_id, p_status: 'dismissed' }
  ])
  await expect(page.getByText('All caught up.').first()).toBeVisible()
  expect(await page.locator('[role="dialog"]').count()).toBe(0)
})

test('a read that fails to save is put back as unread', async ({ context, page }) => {
  await signIn(context, { tables: { fh_notifications: [APPROVED] } })
  await remindersRpc(context, [])
  await context.route((url) => url.pathname === '/rest/v1/fh_notifications', (route) => {
    if (route.request().method() === 'PATCH') {
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'Server error' }) })
    }
    return route.fallback()
  })
  await open(page, '/notifications', '.fhn')
  await expect(page.getByText('1 new notification.', { exact: true })).toBeVisible()
  const patched = page.waitForResponse((r) => r.url().includes('/rest/v1/fh_notifications') && r.request().method() === 'PATCH')
  await page.getByRole('button', { name: 'Mark all read', exact: true }).click()
  await patched
  await expect(page.getByText('1 new notification.', { exact: true })).toBeVisible()
  await expect(page.locator('.fhn-row.is-unread')).toHaveCount(1)
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
