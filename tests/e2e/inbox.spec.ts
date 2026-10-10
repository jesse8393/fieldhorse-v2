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
