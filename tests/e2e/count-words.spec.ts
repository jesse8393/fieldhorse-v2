// Counts agree with their number (Phase 8 follow up A, bullets 9 to 16):
// one of a thing reads in the singular, any other number in the plural, and
// a line that prints two numbers counts the same rows in both.
import { expect, test, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

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

// ---- 9: Customers on a desktop ----------------------------------------------

test.describe('Customers on a desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop Customers')

  const JEFF = { id: 'cl-1', user_id: 'qa-user-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com', company_name: null, address: '412 Burkitt Station Rd', created_at: iso(Date.now() - 60 * 24 * HOUR) }
  // A second client with no jobs, so only Jeff has open ones.
  const ANN = { id: 'cl-2', user_id: 'qa-user-1', name: 'Ann Lee', phone: '555-0199', email: 'ann@lee.com', company_name: null, address: null, created_at: iso(Date.now() - 90 * 24 * HOUR) }

  const meta = (page: Page) => page.locator('.fh-build-topbar__meta')
  const book = (page: Page) => page.locator('.fh-build-focus p')
  const totalCard = (page: Page) => page.locator('.fh-build-rail-card').filter({ hasText: 'Total clients' })
  const filter = (page: Page, name: string) => page.locator('.fh-build-filterbar').getByRole('button', { name: new RegExp(`^${name}`) })
  const search = (page: Page) => page.getByPlaceholder('Search clients...')

  test('one client reads as one, and the book line counts only the clients it names', async ({ context, page }) => {
    await signIn(context, { tables: { fh_clients: [JEFF] } })
    await open(page, '/clients', '[data-build-screen="SnowClientsBuild"]')
    await expect(meta(page)).toContainText('1 client on file')
    await expect(book(page)).toHaveText('1 client · 1 with active work')
    await expect(totalCard(page)).toContainText('relationship in book')
    await expect(totalCard(page)).not.toContainText('relationships in book')

    // A search that finds nobody: both numbers follow it.
    await search(page).fill('zzz')
    await expect(book(page)).toHaveText('0 clients · 0 with active work')
    await search(page).fill('')
    await expect(book(page)).toHaveText('1 client · 1 with active work')

    // Each filter names its clients, in the singular for one.
    await filter(page, 'Active').click()
    await expect(book(page)).toHaveText('1 active client · 1 with active work')
    await filter(page, 'Recent').click()
    await expect(book(page)).toHaveText('0 recent clients · 0 with active work')
  })

  test('two clients read in the plural, and a search counts only the clients it finds', async ({ context, page }) => {
    await signIn(context, { tables: { fh_clients: [JEFF, ANN] } })
    await open(page, '/clients', '[data-build-screen="SnowClientsBuild"]')
    await expect(meta(page)).toContainText('2 clients on file')
    await expect(book(page)).toHaveText('2 clients · 1 with active work')
    await expect(totalCard(page)).toContainText('relationships in book')

    // Ann has no open job, so a search for her counts none.
    await search(page).fill('Ann')
    await expect(book(page)).toHaveText('1 client · 0 with active work')
    await filter(page, 'Active').click()
    await search(page).fill('')
    await expect(book(page)).toHaveText('1 active client · 1 with active work')
  })
})

// ---- 10: the notifications screen on a phone ---------------------------------
// The bell opens the /notifications screen (decision D64), whose count line
// reads "1 new notification." or "2 new notifications."

test.describe('Notifications on a phone', () => {
  test.skip(({ isMobile }) => !isMobile, 'The bell sits in the phone header')

  const note = (id: string, title: string) => ({
    id, user_id: 'qa-user-1', actor_user_id: null, kind: 'quote_approved', title,
    body: null, link: null, read_at: null, created_at: iso(Date.now() - HOUR)
  })

  for (const [rows, bell, heading] of [
    [[note('nt1', 'MMC Properties approved the quote')], 'Notifications, 1 unread', '1 new notification.'],
    [[note('nt1', 'MMC Properties approved the quote'), note('nt2', 'Taylor Reed asked for changes')], 'Notifications, 2 unread', '2 new notifications.']
  ] as const) {
    test(`the screen reads "${heading}"`, async ({ context, page }) => {
      await signIn(context, { tables: { fh_notifications: [...rows] } })
      await open(page, '/work', '.fhs-header')
      await page.getByRole('button', { name: bell, exact: true }).click()
      await expect(page).toHaveURL(/\/notifications$/)
      await expect(page.getByText(heading, { exact: true })).toBeVisible()
    })
  }
})

// ---- 11: the photo upload toast on a phone -------------------------------------

test.describe('Photo upload', () => {
  test.skip(({ isMobile }) => !isMobile, 'The phone job page')

  // A tiny PNG standing in for a camera photo.
  const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')
  const photo = (name: string) => ({ name, mimeType: 'image/png', buffer: PIXEL })

  test('one photo reads "Photo uploaded", two read "Photos uploaded"', async ({ context, page }) => {
    await signIn(context)
    // The upload to storage goes through; the mock answers 404 otherwise.
    await context.route((url) => url.pathname.startsWith('/storage/v1/object/job-photos/'), (route) =>
      route.request().method() === 'POST'
        ? route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'job-photos/photo.jpg' }) })
        : route.fallback())
    await open(page, '/jobs/c-job1?tab=files', '#fh-job-files-panel-photos')
    const input = page.locator('#fh-job-files-panel-photos').locator('input[type="file"]')

    await input.setInputFiles([photo('slab.png')])
    const one = page.locator('[data-sonner-toast]').filter({ hasText: 'Added 1' })
    await expect(one).toBeVisible({ timeout: 15_000 })
    await expect(one).toContainText('Photo uploaded')
    await expect(one).not.toContainText('Photos uploaded')

    await input.setInputFiles([photo('forms.png'), photo('rebar.png')])
    const two = page.locator('[data-sonner-toast]').filter({ hasText: 'Added 2' })
    await expect(two).toBeVisible({ timeout: 15_000 })
    await expect(two).toContainText('Photos uploaded')
  })
})

// ---- 12 and 13: vendors on a desktop ------------------------------------------

test.describe('Vendors on a desktop', () => {
  test.skip(({ isMobile }) => isMobile, 'Desktop vendors')

  const sub = (id: string, name: string, phone: string, contactId: string) => ({
    id, user_id: 'qa-user-1', contact_id: contactId, name, phone, trade: 'Electrical',
    rate: 1200, status: null, created_at: iso(Date.now() - 5 * 24 * HOUR)
  })
  const meta = (page: Page) => page.locator('.fh-build-topbar__meta')

  test('one vendor on one job reads in the singular', async ({ context, page }) => {
    await signIn(context, { tables: { fh_subs: [sub('s1', 'Ace Electric', '615-555-0199', 'c-job1')] } })
    await open(page, '/subs', '[data-build-screen="SnowSubsBuild"]')
    await expect(meta(page)).toContainText('1 vendor in network')
    await expect(meta(page)).not.toContainText('1 vendors')
    await page.getByRole('button', { name: /Ace Electric/ }).first().click()
    await expect(page.locator('[data-build-screen="SubDetail"]')).toBeVisible({ timeout: 30_000 })
    await expect(meta(page)).toContainText('1 job link')
    await expect(meta(page)).not.toContainText('1 job links')
  })

  test('two vendors, and one vendor on two jobs, read in the plural', async ({ context, page }) => {
    await signIn(context, {
      tables: {
        fh_subs: [
          sub('s1', 'Ace Electric', '615-555-0199', 'c-job1'),
          sub('s2', 'Ace Electric', '615-555-0199', 'c-job2'),
          sub('s3', 'Bluegrass Plumbing', '615-555-0123', 'c-job1')
        ]
      }
    })
    await open(page, '/subs', '[data-build-screen="SnowSubsBuild"]')
    await expect(meta(page)).toContainText('2 vendors in network')
    await page.getByRole('button', { name: /Ace Electric/ }).first().click()
    await expect(page.locator('[data-build-screen="SubDetail"]')).toBeVisible({ timeout: 30_000 })
    await expect(meta(page)).toContainText('2 job links')
  })
})

// ---- 14: the importer --------------------------------------------------------

test.describe('Importer', () => {
  const csv = (rows: string[]) => ({
    name: 'leads.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(['Name,Phone,Email', ...rows].join('\n') + '\n')
  })

  test('one row reads "Import 1 contact", two read "Import 2 contacts"', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/import', 'text=CSV upload')
    // The picker takes a CSV by its extension or its type (importer fixes D04, D10, D11).
    const file = page.locator('input[type="file"][accept=".csv,text/csv"]')
    await file.setInputFiles(csv(['Ana Ruiz,615-555-0142,ana@ruiz.com']))
    await expect(page.getByRole('button', { name: 'Import 1 contact', exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Import 1 contacts', exact: true })).toHaveCount(0)
    await file.setInputFiles(csv(['Ana Ruiz,615-555-0142,ana@ruiz.com', 'Ben Cole,615-555-0177,ben@cole.com']))
    await expect(page.getByRole('button', { name: 'Import 2 contacts', exact: true })).toBeVisible()
  })
})

// ---- 15: Compose, written by hand ----------------------------------------------

test.describe('Compose', () => {
  test('the counter in Write manually agrees with its numbers', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/compose', 'button:has-text("Generate draft")')
    // The mock's AI answers nothing, so drafting fails and offers Write manually.
    await page.getByRole('button', { name: 'Generate draft' }).click()
    await page.getByRole('button', { name: /Write manually/ }).click()
    const message = page.getByRole('textbox', { name: 'Message', exact: true })
    await message.fill('a')
    await expect(page.getByText('1 word · 1 char', { exact: true })).toBeVisible()
    await message.fill('Pour is on')
    await expect(page.getByText('3 words · 10 chars', { exact: true })).toBeVisible()
  })
})

// ---- 16: Settings, removing sample data ------------------------------------------

test.describe('Settings', () => {
  for (const [removed, line, toastLine] of [
    [1, 'Removed 1 sample row.', '1 demo row cleared'],
    [3, 'Removed 3 sample rows.', '3 demo rows cleared']
  ] as const) {
    test(`removing ${removed} sample ${removed === 1 ? 'row' : 'rows'} says "${line}"`, async ({ context, page }) => {
      await signIn(context)
      // The demo clients delete reports how many rows it removed; nothing
      // else is sample data.
      await context.route((url) => url.pathname === '/rest/v1/fh_clients', (route) => {
        if (route.request().method() !== 'DELETE') return route.fallback()
        return route.fulfill({
          status: 200,
          contentType: 'application/json',
          headers: { 'content-range': `*/${removed}`, 'access-control-expose-headers': 'Content-Range' },
          body: '[]'
        })
      })
      await open(page, '/settings?section=account', 'text=Clears the example clients')
      // The first press asks; the second, beside Cancel, removes.
      await page.getByRole('button', { name: 'Remove sample data', exact: true }).click()
      await expect(page.getByRole('button', { name: 'Cancel', exact: true })).toBeVisible()
      await page.getByRole('button', { name: 'Remove sample data', exact: true }).click()
      await expect(page.getByText(line, { exact: true })).toBeVisible()
      await expect(page.locator('[data-sonner-toast]').filter({ hasText: 'Sample data removed' })).toContainText(toastLine)
    })
  }
})

// ---- formats-7: vendors' rates and the importer's amounts read as money ------

test.describe('Money written by hand reads like money (formats-7)', () => {
  const sub = (id: string, contactId: string, rate: number) => ({
    id, user_id: 'qa-user-1', contact_id: contactId, name: 'Ace Electric', phone: '615-555-0199', trade: 'Electrical',
    rate, status: null, created_at: iso(Date.now() - 5 * 24 * HOUR)
  })

  test('a vendor billed $42.50 and $1,000 reads "$42.50" and "$1,042.50", on the list and its page', async ({ context, page, isMobile }) => {
    await signIn(context, { tables: { fh_subs: [sub('s1', 'c-job1', 42.5), sub('s2', 'c-job2', 1000)] } })
    await page.emulateMedia({ reducedMotion: 'reduce' })
    await page.goto('/subs', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const shown = (re: RegExp) => page.getByText(re).filter({ visible: true }).first()
    const row = page.getByRole('button', { name: /Ace Electric/ }).first()
    await expect(row).toBeVisible({ timeout: 30_000 })
    await expect(row).toContainText('$1,042.50')
    await row.click()
    if (isMobile) {
      // The phone row opens in place with each job's rate, then the profile.
      await expect(shown(/^\$42\.50$/)).toBeVisible()
      await expect(shown(/^\$1,000\.00$/)).toBeVisible()
      await page.getByRole('link', { name: 'View vendor profile' }).click()
    }
    await expect(page).toHaveURL(/\/subs\/.+/)
    await expect(shown(/\$42\.50/)).toBeVisible({ timeout: 30_000 })
    await expect(shown(/\$1,000\.00/)).toBeVisible()
    // The phone page leads with what the vendor billed in all.
    if (isMobile) await expect(shown(/\$1,042\.50/)).toBeVisible()
    const text = await page.locator('main').innerText()
    expect(text).not.toMatch(/\$42\.5(?!0)/)
    expect(text).not.toMatch(/\$1,042\.5(?!0)/)
  })

  test('the importer previews an amount with cents', async ({ context, page }) => {
    await signIn(context)
    await open(page, '/import', 'text=CSV upload')
    const file = page.locator('input[type="file"][accept=".csv,text/csv"]')
    await file.setInputFiles({ name: 'jobs.csv', mimeType: 'text/csv', buffer: Buffer.from('Name,Phone,Email,Amount\nAna Ruiz,615-555-0142,ana@ruiz.com,1000.5\n') })
    await expect(page.getByText('$1,000.50', { exact: true })).toBeVisible({ timeout: 15_000 })
  })
})
