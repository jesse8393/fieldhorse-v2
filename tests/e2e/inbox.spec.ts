// The Inbox (docs/design/2026-10-redesign/SPEC.md, section 9.8, decision
// D9): it shows up in the dock and the sidebar only when the company's
// messaging engine is on, lists conversations with a Draft ready chip, and
// opens a thread where an agent's draft is sent only by the person's tap.
// Every test runs against the mock, so nothing is ever really sent.
import { expect, test, type Page } from '@playwright/test'
import { signIn, type SignInOptions } from './helpers/signIn.ts'

// The mock company is in Tennessee, so the phone runs on Central time and
// the clock is fixed: Saturday, October 10, 2026, 10:00 am.
test.use({ timezoneId: 'America/Chicago' })
const MORNING = new Date('2026-10-10T15:00:00Z')

const ENGINE_ON = { fh_org_settings: [{ engine_enabled: true }] }

// Four conversations. Priya wrote this morning and has a draft waiting,
// Marcus wrote yesterday, Tessa has a reply that is held back, and Gus
// wrote in September. Times are UTC; the phone shows them in Central.
function conversation(partial: Record<string, unknown>) {
  return {
    org_id: 'org-1',
    company_name: null,
    last_channel: 'sms',
    unread_count: 0,
    pending_drafts: 0,
    held_messages: 0,
    starred: false,
    status: 'open',
    snoozed_until: null,
    email: null,
    phone: '555-0142',
    ...partial
  }
}

const INBOX = [
  conversation({
    conversation_id: 'conv-priya', client_id: 'cl-priya', client_name: 'Priya Rangarajan',
    last_preview: 'Can we push to 11:30? Daycare pickup ran long.', last_message_at: '2026-10-10T13:14:00Z',
    unread_count: 1, pending_drafts: 1, latest_stage: 'quote'
  }),
  conversation({
    conversation_id: 'conv-marcus', client_id: 'cl-marcus', client_name: 'Marcus Bell',
    last_preview: 'Thanks, the crew did great work.', last_message_at: '2026-10-09T21:30:00Z',
    latest_stage: 'job', last_channel: 'email', email: 'marcus@example.com'
  }),
  conversation({
    conversation_id: 'conv-tessa', client_id: 'cl-tessa', client_name: 'Tessa Holloway',
    last_preview: 'We can start Monday if the weather holds.', last_message_at: '2026-10-07T15:00:00Z',
    held_messages: 1, latest_stage: 'lead'
  }),
  conversation({
    conversation_id: 'conv-gus', client_id: 'cl-gus', client_name: 'Gus Okafor',
    last_preview: 'Still thinking about the retaining wall.', last_message_at: '2026-09-20T15:00:00Z',
    latest_stage: 'closed'
  })
]

async function open(page: Page, path: string) {
  await page.clock.setFixedTime(MORNING)
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fh-app')).toBeVisible({ timeout: 30_000 })
}

async function start(
  context: Parameters<typeof signIn>[0],
  page: Page,
  path: string,
  options: SignInOptions = {}
) {
  await signIn(context, options)
  await open(page, path)
}

test.describe('the engine switch on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'Phone dock')

  test('Schedule keeps the fifth dock slot while the engine is off', async ({ context, page }) => {
    await start(context, page, '/')
    const dock = page.getByRole('navigation', { name: 'Primary' })
    await expect(dock.getByRole('link', { name: 'Schedule' })).toBeVisible()
    await expect(dock.getByRole('link', { name: 'Inbox' })).toHaveCount(0)
  })

  test('Schedule keeps the slot when the settings row says the engine is off', async ({ context, page }) => {
    await start(context, page, '/', { tables: { fh_org_settings: [{ engine_enabled: false }] } })
    const dock = page.getByRole('navigation', { name: 'Primary' })
    await expect(dock.getByRole('link', { name: 'Schedule' })).toBeVisible()
    await expect(dock.getByRole('link', { name: 'Inbox' })).toHaveCount(0)
  })

  test('Inbox takes the fifth slot once the engine is on', async ({ context, page }) => {
    await start(context, page, '/', { tables: ENGINE_ON })
    const dock = page.getByRole('navigation', { name: 'Primary' })
    await expect(dock.getByRole('link', { name: 'Inbox' })).toBeVisible()
    await expect(dock.getByRole('link', { name: 'Schedule' })).toHaveCount(0)
    for (const label of ['Today', 'Jobs', 'Money']) {
      await expect(dock.getByRole('link', { name: label })).toBeVisible()
    }
  })

  test('a crew member keeps Schedule even with the engine on, because the Inbox is not theirs', async ({ context, page }) => {
    await start(context, page, '/crew', { tables: ENGINE_ON, role: 'crew' })
    const dock = page.getByRole('navigation', { name: 'Primary' })
    await expect(dock.getByRole('link', { name: 'Schedule' })).toBeVisible()
    await expect(dock.getByRole('link', { name: 'Inbox' })).toHaveCount(0)
  })
})

test.describe('the engine switch on a desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop sidebar')

  test('the sidebar lists Inbox after Money only when the engine is on', async ({ context, page }) => {
    await start(context, page, '/', { tables: ENGINE_ON })
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('button', { name: 'Inbox' })).toBeVisible()
    const labels = await nav.locator('.fhs-side__list').first().locator('li').allInnerTexts()
    expect(labels.map((l) => l.trim())).toEqual(['Today', 'Schedule', 'Jobs', 'Money', 'Inbox', 'Customers', 'Reports'])
  })

  test('the sidebar has no Inbox while the engine is off', async ({ context, page }) => {
    await start(context, page, '/')
    const nav = page.getByRole('navigation', { name: 'Primary' })
    await expect(nav.getByRole('button', { name: 'Today' })).toBeVisible()
    await expect(nav.getByRole('button', { name: 'Inbox' })).toHaveCount(0)
  })
})

test.describe('the Inbox list', () => {
  test('lists the conversations with their chips when the engine is on', async ({ context, page }) => {
    await start(context, page, '/inbox', { tables: { ...ENGINE_ON, fh_v_inbox: INBOX } })
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible()

    const rows = page.locator('.fhi-rows > li')
    await expect(rows).toHaveCount(4)
    // Newest first.
    await expect(rows.nth(0)).toContainText('Priya Rangarajan')
    await expect(rows.nth(1)).toContainText('Marcus Bell')
    await expect(rows.nth(3)).toContainText('Gus Okafor')

    const priya = rows.nth(0)
    await expect(priya).toContainText('Can we push to 11:30?')
    await expect(priya).toContainText('8:14 am')
    await expect(priya.getByText('Draft ready', { exact: true })).toBeVisible()
    await expect(priya.getByText('Quote', { exact: true })).toBeVisible()
    // An unread conversation says so in words as well as with a dot.
    await expect(priya.getByText('Unread', { exact: false })).toHaveCount(1)

    await expect(rows.nth(1)).toContainText('Yesterday')
    await expect(rows.nth(1).getByText('Job', { exact: true })).toBeVisible()
    await expect(rows.nth(1).getByText('Draft ready')).toHaveCount(0)
    await expect(rows.nth(3)).toContainText('Sep 20')
    await expect(page.getByText('Draft ready', { exact: true })).toHaveCount(1)
  })

  test('a conversation with a held reply says so on its row', async ({ context, page }) => {
    await start(context, page, '/inbox', { tables: { ...ENGINE_ON, fh_v_inbox: INBOX } })
    const tessa = page.locator('.fhi-rows > li').filter({ hasText: 'Tessa Holloway' })
    await expect(tessa.getByText('Held', { exact: true })).toBeVisible()
    await expect(page.locator('.fhi-rows > li').filter({ hasText: 'Marcus Bell' }).getByText('Held')).toHaveCount(0)
  })

  test('the list has no gold button', async ({ context, page }) => {
    await start(context, page, '/inbox', { tables: { ...ENGINE_ON, fh_v_inbox: INBOX } })
    await expect(page.locator('.fhi-rows > li')).toHaveCount(4)
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(0)
  })

  test('an empty inbox says so in one line', async ({ context, page }) => {
    await start(context, page, '/inbox', { tables: ENGINE_ON })
    await expect(page.getByText('No conversations yet.', { exact: true })).toBeVisible()
  })

  test('with the engine off it explains itself and points to Settings', async ({ context, page }, testInfo) => {
    await start(context, page, '/inbox')
    await expect(page.getByRole('heading', { level: 1, name: 'Inbox' })).toBeVisible()
    await expect(page.getByText('Inbox turns on with messaging', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open Settings' })).toHaveAttribute('href', '/settings')
    await expect(page.locator('.fhi-rows')).toHaveCount(0)
    if (testInfo.project.name.startsWith('mobile')) {
      // And the dock still has Schedule, not Inbox.
      const dock = page.getByRole('navigation', { name: 'Primary' })
      await expect(dock.getByRole('link', { name: 'Schedule' })).toBeVisible()
      await expect(dock.getByRole('link', { name: 'Inbox' })).toHaveCount(0)
    }
  })

  test('a manager is told to ask an owner when the engine is off', async ({ context, page }) => {
    await start(context, page, '/inbox', { role: 'manager' })
    await expect(page.getByText('Inbox turns on with messaging', { exact: true })).toBeVisible()
    await expect(page.getByRole('link', { name: 'Open Settings' })).toHaveCount(0)
    await expect(page.getByText('Ask an owner or an admin to turn it on.')).toBeVisible()
  })

  test('field roles cannot open the Inbox', async ({ context, page }) => {
    await start(context, page, '/inbox', { tables: { ...ENGINE_ON, fh_v_inbox: INBOX }, role: 'foreman' })
    await expect(page).toHaveURL(/\/crew$/)
    await expect(page.getByText('Priya Rangarajan')).toHaveCount(0)
  })

  test('the Inbox lights up in the dock and opens a conversation from a row', async ({ context, page }, testInfo) => {
    await start(context, page, '/inbox', { tables: { ...ENGINE_ON, fh_v_inbox: INBOX } })
    if (testInfo.project.name.startsWith('mobile')) {
      const dock = page.getByRole('navigation', { name: 'Primary' })
      await expect(dock.getByRole('link', { name: 'Inbox' })).toHaveAttribute('aria-current', 'page')
    }
    await page.locator('.fhi-rows > li').first().getByRole('link').click()
    await expect(page).toHaveURL(/\/inbox\/conv-priya$/)
  })

  test('on a desktop the list sits beside the open conversation', async ({ context, page }, testInfo) => {
    test.skip(testInfo.project.name.startsWith('mobile'), 'Two columns need a desktop')
    await start(context, page, '/inbox', { tables: { ...ENGINE_ON, fh_v_inbox: INBOX } })
    const list = page.getByRole('complementary', { name: 'Conversations' })
    await expect(list).toBeVisible()
    await expect(list.locator('.fhi-rows > li')).toHaveCount(4)
    await expect(page.getByText('Choose a conversation to read it.')).toBeVisible()

    await list.locator('.fhi-rows > li').nth(1).getByRole('link').click()
    await expect(page).toHaveURL(/\/inbox\/conv-marcus$/)
    // The list stays while the conversation opens beside it.
    await expect(list.locator('.fhi-rows > li')).toHaveCount(4)
    const box = await list.boundingBox()
    expect(box?.x).toBeGreaterThan(200)
    expect(box?.width).toBeLessThan(480)
  })
})
