// Phase 8, Task 15: small behavior fixes (PHASE8_PLAN.md). One describe per
// fix, each with the smallest check that shows the old behavior was wrong:
// Reopen asks first (deal card, job page, next action card and closeout
// record) with a second tap on the same button (Phase 9, D57; the armed
// button takes focus so the keyboard answers it), a second tap that goes
// with its screen when the back button leaves the page (and leaves the
// next screen taking taps), field roles get no New lead, the job header and
// the desktop facts panel pick the maps app by device, the Spine shows
// every note and hides a broken thumbnail, the Jobs list reads a narrow
// window of visits, no borrowed forecast without a location (and Set
// location lands on the location card, even from Settings, but never shows
// when the profile could not be read), palette shortcuts that leave Option
// to type accents on a Mac, key caps that follow the platform, the quote
// rows that need a line or wait while lines, the email or a switch are
// loading or saving, the quote email found (fresh) on the linked client,
// and said to be unchecked, never missing, when that read fails, the
// approval that starts from the same email, the optional switch held while
// it saves without losing focus, a reset password notice that is
// announced, and focus that comes back to whatever opened a sheet.
//
// Nothing here sends anything: every send route is answered by a stub.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

const NOW = Date.now()
const DAY = 86400000
const iso = (ms: number) => new Date(ms).toISOString()

const MAC_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36'
const IPHONE_UA = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1'
const IPAD_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15'

// A tiny PNG standing in for a signed job photo.
const PIXEL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64')

const isPhone = (name: string) => name.startsWith('mobile')

/** Bodies of the PATCH writes the page sends to one table. */
function watchPatches(page: Page, table: string): string[] {
  const bodies: string[] = []
  page.on('request', (req) => {
    if (req.method() === 'PATCH' && new URL(req.url()).pathname.endsWith(`/rest/v1/${table}`)) bodies.push(req.postData() || '')
  })
  return bodies
}

/** Every write the page sends to the mocked database: "METHOD table body". */
function watchWrites(page: Page): string[] {
  const writes: string[] = []
  page.on('request', (req) => {
    const url = new URL(req.url())
    if (!['PATCH', 'DELETE', 'POST'].includes(req.method()) || !url.pathname.includes('/rest/v1/')) return
    writes.push(`${req.method()} ${url.pathname.split('/rest/v1/')[1]} ${req.postData() || ''}`.trim())
  })
  return writes
}

/** A route change inside the app, the way a link does it: the query cache stays. */
async function goInApp(page: Page, path: string) {
  await page.evaluate((to) => {
    window.history.pushState({}, '', to)
    window.dispatchEvent(new PopStateEvent('popstate'))
  }, path)
}

/** Every request for a forecast, answered so nothing waits on the network. */
async function watchForecasts(context: BrowserContext): Promise<string[]> {
  const urls: string[] = []
  await context.route('https://api.open-meteo.com/**', (route) => {
    urls.push(route.request().url())
    return route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ current: { temperature_2m: 71, weather_code: 2 } })
    })
  })
  return urls
}

/** Stubs every route that could send, so a test can never send for real. */
async function stubSends(context: BrowserContext) {
  await context.route(/\/api\/(send-|docusign-send)/, (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) }))
}

/**
 * Records what a send route was asked to send, and answers it with a stub.
 * Also lets the quote's send reach its route: the proposal PDF uploads to
 * storage first, and handleSend counts the base lines with a HEAD read
 * whose content-range header the mock never exposes (as in quote.spec.ts).
 */
async function recordSends(context: BrowserContext): Promise<{ url: string; body: string }[]> {
  const sends: { url: string; body: string }[] = []
  await context.route(/\/api\/(send-|docusign-send)/, (route) => {
    sends.push({ url: route.request().url(), body: route.request().postData() || '' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await context.route('**/storage/v1/object/**', (route) =>
    route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'job-files/test.pdf' }) }))
  await context.route((url) => url.pathname.includes('/rest/v1/fh_quote_items'), (route) => {
    if (route.request().method() !== 'HEAD') return route.fallback()
    return route.fulfill({
      status: 200,
      headers: { 'content-range': '0-1/2', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }
    })
  })
  return sends
}

async function openJobs(page: Page) {
  await page.goto('/work', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible({ timeout: 30_000 })
}

async function openJob(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fhj-page')).toBeVisible({ timeout: 30_000 })
}

async function openDesktopJob(page: Page, path: string) {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('[data-build-screen="SnowJobDetailBuild"]')).toBeVisible({ timeout: 30_000 })
}

// The quote screen (Phase 9, Task 10): the mock's quote q-quote on fh_quotes.
async function openQuote(page: Page) {
  await page.goto('/quotes/q-quote', { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fhqt-page')).toBeVisible({ timeout: 30_000 })
}

function quoteItem(id: string, description: string, over: Record<string, unknown> = {}) {
  return {
    id, user_id: 'qa-user-1', quote_id: 'q-quote', contact_id: null, section: null, description, qty: 1, unit: null, rate: 0, amount: 0,
    notes: null, is_optional: false, is_excluded: false, sort_order: 0, created_at: iso(NOW - DAY), updated_at: iso(NOW - DAY), ...over
  }
}

// Two base lines ($3,150.00) and one optional line ($4,950.00).
const QUOTE_ITEMS = [
  quoteItem('qi1', 'Excavate and grade', { qty: 1100, unit: 'sq ft', rate: 2, amount: 2200, sort_order: 0 }),
  quoteItem('qi2', 'Pump truck', { qty: 1, unit: 'day', rate: 950, amount: 950, sort_order: 1 }),
  quoteItem('qi3', 'Stamped ashlar, charcoal release', { qty: 1, rate: 4950, amount: 4950, is_optional: true, sort_order: 2 })
]

// The rows of the quote screen's Share or download list.
const SHARE_ROWS = ['Open the PDF', 'Download the PDF', 'Copy a share link', 'Send for electronic signature']
const shareRows = (page: Page) => page.getByRole('list', { name: 'Share or download' })

/** Holds every save to the quote lines until release(), recording each body. */
async function holdQuoteItemPatches(context: BrowserContext) {
  let release: () => void = () => {}
  const held = new Promise<void>((resolve) => { release = resolve })
  const patches: string[] = []
  await context.route((u) => u.pathname.endsWith('/rest/v1/fh_quote_items'), async (route) => {
    if (route.request().method() === 'PATCH') {
      patches.push(route.request().postData() || '')
      await held
    }
    return route.fallback()
  })
  return { patches, release: () => release() }
}

/** Answers the linked client's email read with a server error while failing() is true. */
async function failEmailReads(context: BrowserContext, failing: () => boolean) {
  await context.route((u) => u.pathname.endsWith('/rest/v1/fh_clients') && u.searchParams.get('select') === 'email', (route) => {
    if (!failing()) return route.fallback()
    return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'upstream timeout' }) })
  })
}

// The mock's MMC Properties quote on fh_quotes, written out so a test can
// change one field. The quote screen reads the client's email from
// fh_clients itself, fresh, so the copy on the row is never what it sends to.
function quoteRow(over: Record<string, unknown> = {}) {
  return {
    id: 'q-quote', user_id: 'qa-user-1', client_id: 'cl-1', origin_contact_id: 'c-quote', lead_id: null, job_id: null,
    title: 'Parking lot repour', amount: 3150, status: 'sent', sent_at: iso(NOW - DAY), expires_at: null,
    scope_text: null, terms_text: null, exclusions_text: null, job_type: null, change_request_note: null,
    change_requested_at: null, approved_version_id: null, created_at: iso(NOW - 28 * DAY), updated_at: iso(NOW - DAY),
    fh_clients: { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' }, ...over
  }
}

// The closed job's closeout record: sign off, warranty and notes.
const CLOSEOUT = {
  id: 'co1', user_id: 'qa-user-1', contact_id: 'c-done', warranty_start_date: '2026-09-20', warranty_months: 12,
  signoff_method: 'verbal', signoff_name: 'Danielle Ortiz', notes: 'Walkthrough done.', final_amount: 9600, created_at: iso(NOW - 20 * DAY)
}

const NO_LOCATION_PROFILE = [{
  user_id: 'qa-user-1', full_name: 'Jesse Parker', company_name: 'Parker Construction Company', onboarded_at: iso(NOW - 90 * DAY),
  logo_url: null, location_lat: null, location_lon: null, services: ['Concrete'], company_email: 'office@parker.co',
  brand_accent_hex: null, preferences: { quote_follow_up: { enabled: true, days: 3 } }
}]

test.describe('Reopen asks first, like Mark lost', () => {
  test('the deal card asks with a second tap, and leaving it alone writes nothing', async ({ context, page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'Desktop deal cards')
    await signIn(context)
    const patches = watchPatches(page, 'fh_contacts')
    await page.goto('/work', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const card = page.locator('.fh-deal-card', { hasText: 'Old Mill HOA' })
    await expect(card).toBeVisible({ timeout: 30_000 })

    // Reopen in the menu arms a Tap again button on the card; no dialog.
    await card.getByRole('button', { name: 'Deal actions' }).click()
    await page.getByRole('menuitem', { name: 'Reopen' }).click()
    const again = card.getByRole('button', { name: 'Tap again to reopen' })
    await expect(again).toBeVisible()
    await expect(card).toContainText('It moves back to Leads.')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(patches).toEqual([])

    // Left alone, the button goes back to resting and nothing is written.
    await expect(again).toBeHidden({ timeout: 6000 })
    expect(patches).toEqual([])

    await card.getByRole('button', { name: 'Deal actions' }).click()
    await page.getByRole('menuitem', { name: 'Reopen' }).click()
    await card.getByRole('button', { name: 'Tap again to reopen' }).click()
    await expect.poll(() => patches.length).toBe(1)
    expect(JSON.parse(patches[0])).toEqual({ stage: 'lead' })
  })

  test('the job page asks before it reopens a lost job', async ({ context, page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'Phone job page')
    await signIn(context)
    const patches = watchPatches(page, 'fh_contacts')
    await openJob(page, '/jobs/c-lost')
    const reopen = page.locator('.fhj-capsule .fhc-btn--primary')
    await expect(reopen).toHaveText('Reopen')

    // The first tap arms the button and says where the deal goes.
    await reopen.click()
    await expect(reopen).toHaveText('Tap again to reopen')
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.locator('.fhj-capsule')).toContainText('It moves back to Leads.')
    await page.waitForTimeout(300)
    expect(patches).toEqual([])

    // Left alone, it goes back to resting and nothing is written.
    await expect(reopen).toHaveText('Reopen', { timeout: 6000 })
    expect(patches).toEqual([])

    await reopen.click()
    await reopen.click()
    await expect.poll(() => patches.length).toBe(1)
    expect(JSON.parse(patches[0])).toEqual({ stage: 'lead' })
  })

  test('a closed job says it goes back to Jobs', async ({ context, page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'Phone job page')
    await signIn(context)
    const patches = watchPatches(page, 'fh_contacts')
    await openJob(page, '/jobs/c-done')
    const reopen = page.locator('.fhj-capsule .fhc-btn--primary')
    await reopen.click()
    await expect(reopen).toHaveText('Tap again to reopen')
    await expect(page.locator('.fhj-capsule')).toContainText('It moves back to Jobs.')
    await reopen.click()
    await expect.poll(() => patches.length).toBe(1)
    expect(JSON.parse(patches[0])).toEqual({ stage: 'job' })
  })

  // The armed button appears from the deal card's menu. It has to take
  // focus once the menu has gone: the menu hands focus back to its ⋯
  // button, so without this a screen reader never hears the question and
  // Enter opens the menu again.
  test('from the keyboard, the deal card Tap again button takes focus and Enter answers it', async ({ context, page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'Desktop deal cards')
    await signIn(context)
    const patches = watchPatches(page, 'fh_contacts')
    await page.goto('/work', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const card = page.locator('.fh-deal-card', { hasText: 'Old Mill HOA' })
    await expect(card).toBeVisible({ timeout: 30_000 })
    const trigger = card.getByRole('button', { name: 'Deal actions' })

    await trigger.focus()
    await page.keyboard.press('Enter')
    const item = page.getByRole('menuitem', { name: 'Reopen' })
    await expect(item).toBeVisible()
    await item.focus()
    await page.keyboard.press('Enter')
    const again = card.getByRole('button', { name: 'Tap again to reopen' })
    await expect(again).toBeVisible()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    // Once the menu has gone and handed focus back, focus is on the armed button.
    await expect(page.locator('[data-slot="dropdown-menu-content"]')).toHaveCount(0)
    await expect(again).toBeFocused()
    await page.waitForTimeout(300)
    expect(patches).toEqual([])

    // Enter presses the armed button: the deal moves, no menu opens.
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect.poll(() => patches.length).toBe(1)
    expect(JSON.parse(patches[0])).toEqual({ stage: 'lead' })
  })

  test('by mouse, Enter then answers the Tap again button, not the menu behind it', async ({ context, page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'Desktop deal cards')
    await signIn(context)
    const patches = watchPatches(page, 'fh_contacts')
    await page.goto('/work', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const card = page.locator('.fh-deal-card', { hasText: 'Old Mill HOA' })
    await expect(card).toBeVisible({ timeout: 30_000 })
    const trigger = card.getByRole('button', { name: 'Deal actions' })

    await trigger.click()
    await page.getByRole('menuitem', { name: 'Reopen' }).click()
    const again = card.getByRole('button', { name: 'Tap again to reopen' })
    await expect(again).toBeVisible()
    await expect(page.locator('[data-slot="dropdown-menu-content"]')).toHaveCount(0)
    await expect(again).toBeFocused()
    await page.waitForTimeout(300)
    expect(patches).toEqual([])
    // Enter presses the focused armed button; no menu opens.
    await page.keyboard.press('Enter')
    await expect(page.getByRole('menu')).toHaveCount(0)
    await expect.poll(() => patches.length).toBe(1)
    expect(JSON.parse(patches[0])).toEqual({ stage: 'lead' })
  })

  // The closeout record's own Reopen deletes the record (sign off, warranty,
  // notes) and moves the job back, so it asks first as well. The record is
  // a screen of its own now (Phase 9, Task 13, D57), and the question is a
  // second tap on the same button, which goes back to resting on its own.
  test('the closeout record asks before it reopens, and keeps the record until the second tap', async ({ context, page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'Phone job page')
    await signIn(context, { tables: { fh_closeouts: [CLOSEOUT] } })
    const writes = watchWrites(page)
    await openJob(page, '/jobs/c-done')
    await page.getByRole('button', { name: 'More about this job' }).click()
    await page.getByRole('button', { name: 'Closeout record' }).click()
    await expect(page).toHaveURL(/\/jobs\/c-done\/complete$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Closeout on file' })).toBeVisible({ timeout: 15_000 })
    const reopen = page.getByRole('button', { name: 'Reopen job' })
    await expect(reopen).toBeVisible({ timeout: 15_000 })

    // The first tap only asks; the record is still on screen and nothing is written.
    await reopen.click()
    const again = page.getByRole('button', { name: 'Tap again to reopen' })
    await expect(again).toBeVisible()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await expect(page.getByText('It moves back to Jobs, and its closeout record is deleted')).toBeVisible()
    await page.waitForTimeout(400)
    expect(writes).toEqual([])

    // The second tap deletes the record, then moves the job back to Jobs.
    await again.click()
    await expect.poll(() => writes.length).toBe(2)
    expect(writes[0]).toMatch(/^DELETE fh_closeouts/)
    expect(writes[1]).toMatch(/^PATCH fh_contacts /)
    expect(JSON.parse(writes[1].replace(/^PATCH fh_contacts /, ''))).toMatchObject({ stage: 'job' })
    await expect(page).toHaveURL(/\/jobs\/c-done$/)
  })

  test('the next action card asks too', async ({ context, page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'Phone job page')
    await signIn(context)
    const patches = watchPatches(page, 'fh_contacts')
    await openJob(page, '/jobs/c-lost')
    await page.getByRole('button', { name: 'More about this job' }).click()
    const reopen = page.locator('#fhj-more-body').getByRole('button', { name: 'Reopen', exact: true })
    await expect(reopen).toBeVisible()

    // The first tap arms the card's button; nothing is written.
    await reopen.click()
    const again = page.locator('#fhj-more-body').getByRole('button', { name: 'Tap again to reopen' })
    await expect(again).toBeVisible()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await page.waitForTimeout(300)
    expect(patches).toEqual([])

    await again.click()
    await expect.poll(() => patches.length).toBe(1)
    expect(JSON.parse(patches[0])).toEqual({ stage: 'lead' })
  })
})

/**
 * The page takes taps: the body still has its pointer events, and a tap on
 * the first job row opens that job.
 */
async function expectJobsTakeTaps(page: Page) {
  expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe('none')
  const row = page.locator('.fhjl-list a').first()
  const href = await row.getAttribute('href')
  expect(href).toMatch(/^\/jobs\//)
  await row.click({ timeout: 5000 })
  await expect(page).toHaveURL(new RegExp(`${href}$`))
}

// A question asked over a sheet (the closeout record's Reopen, a sheet's
// discard question) is drawn on the page, so it outlived the sheet when the
// person went back while it was open: its answer then acted on a job that
// was no longer on screen, and put the sheet's pointer lock back on a page
// with no sheet, so every tap on the next screen did nothing.
test.describe('Leaving a page while it asks', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'Phone back button')
  })

  test('the closeout question goes with the closeout screen, and the job page still takes taps', async ({ context, page }) => {
    await signIn(context, { tables: { fh_closeouts: [CLOSEOUT] } })
    const writes = watchWrites(page)
    await openJobs(page)
    await goInApp(page, '/jobs/c-done')
    await expect(page.locator('.fhj-page')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'More about this job' }).click()
    await page.getByRole('button', { name: 'Closeout record' }).click()
    await expect(page).toHaveURL(/\/jobs\/c-done\/complete$/)
    const reopen = page.getByRole('button', { name: 'Reopen job' })
    await expect(reopen).toBeVisible({ timeout: 15_000 })
    await reopen.click()
    const again = page.getByRole('button', { name: 'Tap again to reopen' })
    await expect(again).toBeVisible()

    // The back button while it asks.
    await page.goBack()
    await expect(page.locator('.fhj-page')).toBeVisible({ timeout: 30_000 })
    // The question left with the screen it asked on, unanswered.
    await expect(again).toBeHidden()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    await page.waitForTimeout(400)
    expect(writes).toEqual([])
    // The job page takes taps.
    expect(await page.evaluate(() => getComputedStyle(document.body).pointerEvents)).not.toBe('none')
    await page.getByRole('button', { name: 'More about this job' }).click({ timeout: 5000 })
    await expect(page.locator('#fhj-more-body')).toBeVisible()
  })

  // A line being typed on the quote screen is edited in place (Phase 9,
  // D57): no sheet, so no discard question, and going back writes nothing.
  test('so does a line being typed on the quote', async ({ context, page }) => {
    await stubSends(context)
    await signIn(context, { tables: { fh_quote_items: QUOTE_ITEMS } })
    const writes = watchWrites(page)
    await openJobs(page)
    await goInApp(page, '/quotes/q-quote')
    await expect(page.locator('.fhqt-page')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Add a line', exact: true }).click()
    const editor = page.getByRole('form', { name: 'Add a line' })
    await expect(editor).toBeVisible()
    await editor.getByLabel('Description').fill('Saw cut the joints')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)

    await page.goBack()
    await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible({ timeout: 30_000 })
    await expect(editor).toBeHidden()
    await page.waitForTimeout(400)
    expect(writes).toEqual([])
    await expectJobsTakeTaps(page)
  })

  // An armed button (Reopen on the job page, the next action card, the deal
  // card) belongs to its screen, so it goes with the screen when the page
  // changes and its second tap can no longer move a job that is not shown.
  test('an armed button goes with its page, and its second tap can no longer write', async ({ context, page }) => {
    await signIn(context)
    const writes = watchWrites(page)
    await openJobs(page)
    await goInApp(page, '/jobs/c-lost')
    await expect(page.locator('.fhj-page')).toBeVisible({ timeout: 30_000 })
    await page.locator('.fhj-capsule .fhc-btn--primary').click()
    const again = page.getByRole('button', { name: 'Tap again to reopen' })
    await expect(again).toBeVisible()
    await expect(page.getByRole('alertdialog')).toHaveCount(0)

    await page.goBack()
    await expect(page.getByRole('heading', { level: 1, name: 'Jobs' })).toBeVisible({ timeout: 30_000 })
    await expect(again).toBeHidden()
    await expect(page.getByRole('button', { name: 'Reopen', exact: true })).toHaveCount(0)
    await page.waitForTimeout(400)
    expect(writes).toEqual([])
    await expectJobsTakeTaps(page)
  })
})

test.describe('New lead on the phone Jobs screen', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'Phone Jobs screen')
  })

  for (const role of ['crew', 'foreman']) {
    test(`${role} get no New lead`, async ({ context, page }) => {
      await signIn(context, { role })
      await openJobs(page)
      await expect(page.locator('.fhjl-list').getByText('Plumbing Bellevue', { exact: true })).toBeVisible()
      // Let the role settle (the screen fails closed while it loads).
      await page.waitForLoadState('networkidle')
      await page.waitForTimeout(500)
      await expect(page.getByRole('button', { name: 'New lead', exact: true })).toHaveCount(0)
    })
  }

  test('a manager keeps New lead', async ({ context, page }) => {
    await signIn(context, { role: 'manager' })
    await openJobs(page)
    await expect(page.getByRole('button', { name: 'New lead', exact: true })).toBeVisible()
  })
})

test.describe('The job header Navigate', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'Phone job header')
  })

  test('opens Google Maps off Apple devices', async ({ context, page }) => {
    await signIn(context)
    await openJob(page, '/jobs/c-job1')
    await expect(page.getByRole('link', { name: 'Navigate to 412 Burkitt Station Rd' }))
      .toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=412%20Burkitt%20Station%20Rd')
  })

  test.describe('on an iPhone', () => {
    test.use({ userAgent: IPHONE_UA })
    test('opens Apple Maps', async ({ context, page }) => {
      await signIn(context)
      await openJob(page, '/jobs/c-job1')
      await expect(page.getByRole('link', { name: 'Navigate to 412 Burkitt Station Rd' }))
        .toHaveAttribute('href', 'https://maps.apple.com/?daddr=412%20Burkitt%20Station%20Rd')
    })
  })
})

// The desktop job page's facts panel has its own Navigate. An iPad in
// landscape gets the desktop layout, and has to get the same maps app it
// gets from Today and the phone header.
test.describe('The desktop job page Navigate', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'Desktop facts panel')
  })

  const navigate = (page: Page) => page.locator('.fhd-nav')

  test('opens Google Maps off Apple devices', async ({ context, page }) => {
    await signIn(context)
    await openDesktopJob(page, '/jobs/c-job1')
    await expect(navigate(page)).toHaveAccessibleName('Navigate to 412 Burkitt Station Rd, opens in a new tab')
    await expect(navigate(page))
      .toHaveAttribute('href', 'https://www.google.com/maps/dir/?api=1&destination=412%20Burkitt%20Station%20Rd')
  })

  test.describe('on an iPad in landscape', () => {
    // iPadOS asks for the desktop site: a Macintosh user agent with touch.
    test.use({ userAgent: IPAD_UA })
    test('opens Apple Maps', async ({ context, page }) => {
      await context.addInitScript(() => {
        Object.defineProperty(Navigator.prototype, 'maxTouchPoints', { configurable: true, get: () => 5 })
      })
      await signIn(context)
      await openDesktopJob(page, '/jobs/c-job1')
      await expect(navigate(page)).toHaveAttribute('href', 'https://maps.apple.com/?daddr=412%20Burkitt%20Station%20Rd')
    })
  })
})

test.describe('The Spine', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'Phone job page')
  })

  test('shows every note in full, and Show N more counts the rest', async ({ context, page }) => {
    const long = 'Called the inspector about the footing depth. He wants twelve inches at the east wall, not ten, because the soil report came back soft near the drain line.'
    const notes = Array.from({ length: 12 }, (_, i) => ({
      id: `n${i}`, user_id: 'qa-user-1', contact_id: 'c-job1', category: 'note',
      text: i === 11 ? long : `Site note ${i + 1}`, created_at: iso(NOW - (i + 1) * 3600e3)
    }))
    // Twelve notes, Job created and the stage marker: fourteen entries.
    await signIn(context, { tables: { fh_notes: notes, fh_schedule: [] } })
    await openJob(page, '/jobs/c-job1')
    const spine = page.locator('.fhj-spine')
    await expect(spine.getByText('Site note 1', { exact: true })).toBeVisible()
    await expect(spine.locator('.fhj-spine__list > li')).toHaveCount(10)
    const more = spine.getByRole('button', { name: 'Show 4 more' })
    await expect(more).toBeVisible()
    await more.click()
    await expect(spine.locator('.fhj-spine__list > li')).toHaveCount(14)
    await expect(spine.getByText(long, { exact: true })).toBeVisible()
  })

  test('hides a thumbnail that fails to load', async ({ context, page }) => {
    const files = [
      { id: 'f1', job_id: 'c-job1', kind: 'photo', storage_path: 'u/c-job1/f1.jpg', filename: 'f1.jpg', uploaded_at: iso(NOW - 3600e3), caption: 'Forms and rebar in' },
      { id: 'f2', job_id: 'c-job1', kind: 'photo', storage_path: 'u/c-job1/f2.jpg', filename: 'f2.jpg', uploaded_at: iso(NOW - 3600e3 - 60e3), caption: null }
    ]
    await signIn(context, { tables: { fh_job_files: files } })
    await context.route((u) => u.hostname === 'qa-mock.supabase.co', async (route) => {
      const req = route.request()
      const url = new URL(req.url())
      if (url.pathname.endsWith('/storage/v1/object/sign/job-photos') && req.method() === 'POST') {
        const { paths = [] } = JSON.parse(req.postData() || '{}')
        const signed = paths.map((path: string) => ({ path, signedURL: `/object/sign/job-photos/${path}?token=qa`, error: null }))
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(signed) })
      }
      if (url.pathname.includes('/storage/v1/object/sign/job-photos/')) {
        // f1 is gone from storage; f2 loads.
        return url.pathname.endsWith('/f2.jpg')
          ? route.fulfill({ status: 200, contentType: 'image/png', body: PIXEL })
          : route.fulfill({ status: 404, contentType: 'text/plain', body: 'missing' })
      }
      return route.fallback()
    })
    await openJob(page, '/jobs/c-job1')
    const batch = page.locator('.fhj-spine .fhc-spine', { hasText: '2 photos' })
    await expect(batch).toBeVisible()
    await expect(batch.locator('img')).toHaveCount(1)
    await expect(batch.locator('img')).toHaveAttribute('src', /f2\.jpg/)
    // The batch still says how many photos there are.
    await expect(batch.getByText('2 photos', { exact: true })).toBeVisible()
  })
})

test.describe('The Jobs list visits', () => {
  test('read only the job and the start, from 14 days back, newest first', async ({ context, page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'Phone Jobs screen')
    await signIn(context)
    const reads: URL[] = []
    page.on('request', (req) => {
      const url = new URL(req.url())
      if (req.method() === 'GET' && url.pathname.endsWith('/rest/v1/fh_schedule')) reads.push(url)
    })
    await openJobs(page)
    await expect(page.getByText('Plumbing Bellevue', { exact: true })).toBeVisible()
    await expect.poll(() => reads.filter((u) => u.searchParams.getAll('start_at').some((v) => v.startsWith('gte.'))).length).toBeGreaterThan(0)
    const from = await page.evaluate(() => {
      const n = new Date()
      return new Date(n.getFullYear(), n.getMonth(), n.getDate() - 14).toISOString()
    })
    // The Leads tab reads visits booked on leads too (lead_id, from today);
    // this test pins the job visits read, so pick the reads that name the job.
    const visits = reads.filter((u) => u.searchParams.getAll('start_at').some((v) => v.startsWith('gte.')))
      .filter((u) => (u.searchParams.get('select') || '').includes('contact_id'))
    expect(visits.length).toBeGreaterThan(0)
    for (const url of visits) {
      expect(url.searchParams.get('select')).toBe('contact_id,start_at')
      expect(url.searchParams.getAll('start_at')).toContain(`gte.${from}`)
      expect(url.searchParams.get('order')).toBe('start_at.desc')
      expect(url.searchParams.get('org_id')).toBe('eq.org-1')
    }
  })
})

test.describe('Weather without a company location', () => {
  test('an owner sees Set location in the job banner, and no borrowed forecast', async ({ context, page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'Desktop job banner')
    await signIn(context, { tables: { profiles: NO_LOCATION_PROFILE } })
    const forecasts = await watchForecasts(context)
    await openDesktopJob(page, '/jobs/c-job1')
    const banner = page.locator('.fhd-banner')
    await expect(banner.getByRole('link', { name: 'Set location' })).toHaveAttribute('href', '/settings#location')
    await page.waitForTimeout(1000)
    await expect(banner.getByText(/°/)).toHaveCount(0)
    await expect(banner.getByText('Weather unavailable')).toHaveCount(0)
    expect(forecasts).toEqual([])
  })

  test('a manager sees no weather at all in the banner', async ({ context, page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'Desktop job banner')
    await signIn(context, { role: 'manager', tables: { profiles: NO_LOCATION_PROFILE } })
    const forecasts = await watchForecasts(context)
    await openDesktopJob(page, '/jobs/c-job1')
    await expect(page.locator('.fhd-banner').getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await page.waitForTimeout(1000)
    await expect(page.locator('.fhd-weather')).toHaveCount(0)
    await expect(page.locator('.fhd-banner').getByText(/°/)).toHaveCount(0)
    expect(forecasts).toEqual([])
  })

  // A profile that did not load (an offline cold open, a server error) says
  // nothing about the location: the owner may well have pinned one.
  test('an owner whose profile did not load is not told to set a location', async ({ context, page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'Desktop job banner')
    await signIn(context)
    const forecasts = await watchForecasts(context)
    let profileErrors = 0
    await context.route((u) => u.pathname.endsWith('/rest/v1/profiles'), (route) => {
      if (route.request().method() !== 'GET') return route.fallback()
      profileErrors += 1
      return route.fulfill({ status: 500, contentType: 'application/json', body: JSON.stringify({ message: 'upstream timeout' }) })
    })
    await openDesktopJob(page, '/jobs/c-job1')
    await expect(page.locator('.fhd-banner').getByRole('heading', { level: 1, name: 'Slab + trench' })).toBeVisible()
    await expect.poll(() => profileErrors).toBeGreaterThan(0)
    await page.waitForTimeout(1000)
    await expect(page.locator('.fhd-banner').getByRole('link', { name: 'Set location' })).toHaveCount(0)
    await expect(page.locator('.fhd-weather')).toHaveCount(0)
    expect(forecasts).toEqual([])
  })

  test('Set location on the Settings page itself goes to the location card', async ({ context, page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'Desktop topbar')
    await signIn(context, { tables: { profiles: NO_LOCATION_PROFILE } })
    await watchForecasts(context)
    await page.goto('/settings', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const card = page.locator('#location')
    await expect(card).toBeAttached({ timeout: 30_000 })
    await expect(card).not.toBeInViewport()
    await page.locator('.fh-build-topbar').getByRole('link', { name: 'Set location' }).click()
    await expect(page).toHaveURL(/\/settings#location$/)
    await expect(card).toBeInViewport({ timeout: 10_000 })
  })

  test('Today asks for no forecast and offers the location instead', async ({ context, page }) => {
    // Morning: after sunset Today shows the evening line, not the button.
    await page.clock.setFixedTime(new Date('2026-10-12T14:30:00Z')) // 9:30 am Central
    await signIn(context, { tables: { profiles: NO_LOCATION_PROFILE } })
    const forecasts = await watchForecasts(context)
    await page.goto('/', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const useLocation = page.getByRole('button', { name: 'Use my location for the forecast' })
    await expect(useLocation).toBeVisible({ timeout: 30_000 })
    await page.waitForLoadState('networkidle')
    await page.waitForTimeout(1000)
    // Still there once the day has loaded, not only while it loads.
    await expect(useLocation).toBeVisible()
    expect(forecasts).toEqual([])
  })

  test('with a location the banner still shows the forecast', async ({ context, page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'Desktop job banner')
    await signIn(context)
    const forecasts = await watchForecasts(context)
    await openDesktopJob(page, '/jobs/c-job1')
    await expect(page.locator('.fhd-banner').getByText(/71°/)).toBeVisible()
    expect(forecasts.every((u) => u.includes('latitude=35.84'))).toBe(true)
  })
})

test.describe('Key caps follow the keyboard', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    test.skip(isPhone(testInfo.project.name), 'Desktop key caps')
  })

  const PALETTE_JOB = {
    id: 'c-job1', stage: 'job', name: 'Plumbing Bellevue', job_title: 'Slab + trench', amount: 33100, phone: '555-0101',
    email: 'x@y.com', address: '412 Burkitt Station Rd', user_id: 'qa-user-1', client_id: 'cl-1',
    created_at: '2026-10-01T12:00:00Z', updated_at: '2026-10-09T12:00:00Z'
  }
  const PALETTE_CLIENT = { id: 'cl-1', user_id: 'qa-user-1', name: 'Jeff Roy', company_name: null, phone: '555-0101', email: 'jeff@roy.com' }

  async function openPalette(page: Page) {
    await page.goto('/schedule', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.locator('.fh-app')).toBeVisible({ timeout: 30_000 })
    await page.keyboard.press('Control+k')
    const palette = page.getByRole('dialog', { name: 'Command palette' })
    await expect(palette).toBeVisible()
    await palette.getByRole('combobox').fill('Plumb')
    await expect(palette.getByRole('option', { name: /Add a note to Slab \+ trench/ })).toBeVisible()
    return palette
  }

  test('older search bars print Ctrl K on Windows', async ({ context, page }) => {
    await signIn(context)
    await page.goto('/clients', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.locator('.fh-build-search kbd')).toHaveText('Ctrl K', { timeout: 30_000 })
    await page.goto('/team', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const search = page.getByRole('button', { name: 'Open command palette' })
    await expect(search.locator('kbd')).toHaveText('Ctrl K', { timeout: 30_000 })
    await expect(search).toHaveAttribute('aria-keyshortcuts', 'Control+K')
  })

  test('the palette shortcuts stay Alt on Windows', async ({ context, page }) => {
    await signIn(context, { tables: { fh_contacts: [PALETTE_JOB], fh_clients: [PALETTE_CLIENT] } })
    const palette = await openPalette(page)
    const note = palette.getByRole('option', { name: /Add a note to Slab \+ trench/ })
    await expect(note.locator('kbd')).toHaveText(['Alt', 'N'])
    await expect(note).toHaveAttribute('aria-keyshortcuts', 'Alt+N')
    // AltGr is Control with Alt on Windows and types characters: no shortcut.
    await page.keyboard.press('Control+Alt+KeyN')
    await page.waitForTimeout(300)
    await expect(palette).toBeVisible()
    await expect(page).not.toHaveURL(/\/capture/)
  })

  test.describe('on a Mac', () => {
    test.use({ userAgent: MAC_UA })

    test('older search bars print the command key', async ({ context, page }) => {
      await signIn(context)
      await page.goto('/clients', { waitUntil: 'domcontentloaded', timeout: 60_000 })
      await expect(page.locator('.fh-build-search kbd')).toHaveText('⌘K', { timeout: 30_000 })
      await page.goto('/team', { waitUntil: 'domcontentloaded', timeout: 60_000 })
      const search = page.getByRole('button', { name: 'Open command palette' })
      await expect(search.locator('kbd')).toHaveText('⌘K', { timeout: 30_000 })
      await expect(search).toHaveAttribute('aria-keyshortcuts', 'Meta+K')
    })

    test('Option and a letter types, Control Option and the letter runs the action', async ({ context, page }) => {
      await signIn(context, { tables: { fh_contacts: [PALETTE_JOB], fh_clients: [PALETTE_CLIENT] } })
      const palette = await openPalette(page)
      const note = palette.getByRole('option', { name: /Add a note to Slab \+ trench/ })
      await expect(note.locator('kbd')).toHaveText(['⌃⌥', 'N'])
      await expect(note).toHaveAttribute('aria-keyshortcuts', 'Control+Alt+N')

      // Option N is how a Mac starts ñ: the palette leaves it alone.
      await page.keyboard.press('Alt+KeyN')
      await page.waitForTimeout(300)
      await expect(palette).toBeVisible()
      await expect(page).not.toHaveURL(/\/capture/)

      await page.keyboard.press('Control+Alt+KeyN')
      await expect(palette).toBeHidden()
      // Capture is a screen (D57), opened on the job.
      await expect(page).toHaveURL(/\/capture\?job=c-job1$/)
      await expect(page.getByText('Attached to Slab + trench.')).toBeVisible()
    })
  })
})

// The quote screen (Phase 9, Task 10) is the same on a phone and a desktop.
test.describe('The quote screen', () => {
  test.beforeEach(async ({ context }) => {
    await stubSends(context)
  })

  test('a quote with no lines cannot open a PDF or copy a link', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: [] } })
    await openQuote(page)
    await expect(page.getByText('No lines yet.')).toBeVisible()
    for (const name of ['Open the PDF', 'Download the PDF', 'Copy a share link']) {
      const row = shareRows(page).getByRole('button', { name: new RegExp(`^${name}`) })
      await expect(row).toBeDisabled()
      await expect(row).toContainText('Add at least one line')
    }
  })

  test('finds the customer email on the linked client, as Money does', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: QUOTE_ITEMS } })
    const sends = await recordSends(context)
    await openQuote(page)
    await expect(page.getByText('Excavate and grade')).toBeVisible()
    await expect(page.getByText(/No email on file/)).toHaveCount(0)
    await expect(page.locator('.fhqt-total').getByText('Copies a link')).toHaveCount(0)
    await expect(shareRows(page).getByRole('button', { name: /^Send for electronic signature/ })).toContainText('jeff@roy.com')

    // The proposal goes to the client's address, and names the quote.
    await page.locator('.fhqt-total').getByRole('button', { name: 'Send for approval' }).click()
    await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
    expect(sends[0].url).toContain('/api/send-quote')
    expect(JSON.parse(sends[0].body)).toMatchObject({ quote_id: 'q-quote', recipient_email: 'jeff@roy.com' })
  })

  // The client's email can change on the client page while the job page is
  // closed. Coming back reads it again, so a send never goes by the copy
  // read a minute ago (or saved for offline use before a reload).
  test('reads the linked client email again when the quote opens again', async ({ context, page }) => {
    await signIn(context, {
      tables: {
        fh_clients: [{ id: 'cl-1', user_id: 'qa-user-1', name: 'Jeff Roy', phone: '555-0101', email: null }],
        fh_quote_items: QUOTE_ITEMS
      }
    })
    let clientEmail: string | null = null
    await context.route((u) => u.pathname.endsWith('/rest/v1/fh_clients') && u.searchParams.get('select') === 'email', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([{ email: clientEmail }]) }))
    await openQuote(page)
    await expect(page.getByText(/No email on file/)).toBeVisible()

    // The office adds the client's email elsewhere, then opens the quote again.
    clientEmail = 'jeff@roy.com'
    await goInApp(page, '/quotes')
    await expect(page.getByRole('heading', { level: 1, name: 'Quotes' })).toBeVisible({ timeout: 30_000 })
    await goInApp(page, '/quotes/q-quote')
    await expect(page.locator('.fhqt-page')).toBeVisible({ timeout: 30_000 })
    const send = page.locator('.fhqt-total').getByRole('button', { name: 'Send for approval' })
    await expect(send).toBeEnabled()
    await expect(page.getByText(/No email on file/)).toHaveCount(0)
    await expect(page.locator('.fhqt-total').getByText('Copies a link')).toHaveCount(0)
  })

  test('says so when the client has no email', async ({ context, page }) => {
    await signIn(context, {
      tables: {
        fh_clients: [{ id: 'cl-1', user_id: 'qa-user-1', name: 'Jeff Roy', phone: '555-0101', email: null }],
        fh_quote_items: QUOTE_ITEMS
      }
    })
    await openQuote(page)
    await expect(page.getByText('No email on file for Jeff.', { exact: false })).toBeVisible()
  })

  // A read that fails says nothing about whether there is an email. It used
  // to read as "no email", and Send for approval then copied a share link
  // and marked the quote sent instead of emailing a client who has one.
  test('a failed read of the client email says it could not check, and Send waits for a read that works', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: QUOTE_ITEMS } })
    const sends = await recordSends(context)
    const quotePatches = watchPatches(page, 'fh_quotes')
    let failing = true
    await failEmailReads(context, () => failing)
    await openQuote(page)
    await expect(page.getByText('Excavate and grade')).toBeVisible()
    const send = page.locator('.fhqt-total').getByRole('button', { name: 'Send for approval' })
    await expect(page.getByText("Couldn't check the email for Jeff.", { exact: false })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText(/No email on file/)).toHaveCount(0)
    await expect(page.locator('.fhqt-total').getByText('Copies a link')).toHaveCount(0)
    await expect(send).toBeDisabled()
    await expect(shareRows(page).getByRole('button', { name: /^Send for electronic signature/ })).toBeDisabled()
    await expect(shareRows(page).getByText('Add a customer email first.')).toHaveCount(0)

    // Try again reads it, and this time the read works.
    failing = false
    await page.getByRole('button', { name: 'Try again' }).click()
    await expect(send).toBeEnabled()
    await expect(page.getByText("Couldn't check the email", { exact: false })).toHaveCount(0)
    await send.click()
    await expect.poll(() => sends.length, { timeout: 30_000 }).toBe(1)
    expect(sends[0].url).toContain('/api/send-quote')
    expect(JSON.parse(sends[0].body)).toMatchObject({ recipient_email: 'jeff@roy.com' })
    // No share link marked the quote sent along the way.
    expect(quotePatches.filter((body) => body.includes('"status"'))).toEqual([])
  })

  // The approval screen and the approved copy take the customer's email the
  // way the quote sends: the client's, read fresh. The approval names the
  // quote (fn_approve_quote_version takes p_quote_id, Task 11).
  test('Approve quote starts from the client email too, and keeps it on the approved copy', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: QUOTE_ITEMS } })
    const approvals: Record<string, any>[] = []
    page.on('request', (req) => {
      if (req.method() === 'POST' && new URL(req.url()).pathname.endsWith('/rpc/fn_approve_quote_version')) {
        approvals.push(JSON.parse(req.postData() || '{}'))
      }
    })
    await openQuote(page)
    await expect(page.getByText('Excavate and grade')).toBeVisible()
    await page.getByRole('link', { name: /^Approve quote/ }).click()
    await expect(page).toHaveURL(/\/quotes\/q-quote\/approve$/)
    await expect(page.getByRole('heading', { name: 'Lock the approved quote.' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByLabel('Email (optional)')).toHaveValue('jeff@roy.com')
    await expect(page.getByText(/^2 base, 1 optional/)).toBeVisible()
    await page.getByRole('button', { name: 'Approve quote' }).click()
    await expect.poll(() => approvals.length).toBe(1)
    expect(approvals[0].p_quote_id).toBe('q-quote')
    expect(approvals[0].p_approved_by_email).toBe('jeff@roy.com')
    expect(approvals[0].p_snapshot?.contact?.email).toBe('jeff@roy.com')
  })

  test('the optional switch and Send for approval wait while a switch saves', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: QUOTE_ITEMS } })
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    const patches: string[] = []
    await context.route((u) => u.pathname.endsWith('/rest/v1/fh_quote_items'), async (route) => {
      if (route.request().method() === 'PATCH') {
        patches.push(route.request().postData() || '')
        await held
      }
      return route.fallback()
    })
    await openQuote(page)
    const toggle = page.getByRole('switch', { name: 'Include Stamped ashlar, charcoal release in the total' })
    const send = page.locator('.fhqt-total').getByRole('button', { name: 'Send for approval' })
    await expect(toggle).toBeEnabled()
    await expect(send).toBeEnabled()

    await toggle.click()
    await expect.poll(() => patches.length).toBe(1)
    await expect(toggle).toBeDisabled()
    await expect(send).toBeDisabled()
    // A second tap while the first save is out changes nothing.
    await toggle.click({ force: true })
    await page.waitForTimeout(200)
    expect(patches).toHaveLength(1)

    release()
    await expect(toggle).toBeEnabled()
    await expect(send).toBeEnabled()
  })

  // An approved quote's new version is a snapshot of the lines, so it waits
  // too: taken during the save, it froze the lines from before the switch.
  // The row leads to the approval screen while it can, and waits as a
  // disabled row while it cannot.
  test('Approve a new version waits while a switch saves', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quotes: [quoteRow({ status: 'approved' })], fh_quote_items: QUOTE_ITEMS } })
    const save = await holdQuoteItemPatches(context)
    await openQuote(page)
    const toggle = page.getByRole('switch', { name: 'Include Stamped ashlar, charcoal release in the total' })
    await expect(page.getByRole('link', { name: /^Approve a new version/ })).toBeVisible()

    await toggle.click()
    await expect.poll(() => save.patches.length).toBe(1)
    await expect(page.getByRole('button', { name: /^Approve a new version/ })).toBeDisabled()
    await expect(page.getByRole('link', { name: /^Approve a new version/ })).toHaveCount(0)

    save.release()
    await expect(page.getByRole('link', { name: /^Approve a new version/ })).toBeVisible()
  })

  // A disabled control that has focus drops it to the page: the switch
  // waits with aria-disabled instead, so a keyboard or switch access user
  // stays on it through the save.
  test('the optional switch keeps keyboard focus while it saves', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: QUOTE_ITEMS } })
    const save = await holdQuoteItemPatches(context)
    await openQuote(page)
    const toggle = page.getByRole('switch', { name: 'Include Stamped ashlar, charcoal release in the total' })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')

    await toggle.focus()
    await page.keyboard.press('Space')
    await expect.poll(() => save.patches.length).toBe(1)
    await expect(toggle).toBeDisabled()
    await expect(toggle).toBeFocused()
    // Space again while the save is out changes nothing.
    await page.keyboard.press('Space')
    await page.waitForTimeout(200)
    expect(save.patches).toHaveLength(1)
    await expect(toggle).toHaveAttribute('aria-checked', 'true')

    save.release()
    await expect(toggle).toBeEnabled()
    await expect(toggle).toBeFocused()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
  })

  test('Share or download waits while a switch saves', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: QUOTE_ITEMS } })
    const save = await holdQuoteItemPatches(context)
    await openQuote(page)
    await page.getByRole('switch', { name: 'Include Stamped ashlar, charcoal release in the total' }).click()
    await expect.poll(() => save.patches.length).toBe(1)

    // The PDF is built from the saved lines, so nothing goes out with the
    // total that is still saving.
    for (const name of SHARE_ROWS) await expect(shareRows(page).getByRole('button', { name: new RegExp(`^${name}`) })).toBeDisabled()

    save.release()
    for (const name of SHARE_ROWS) await expect(shareRows(page).getByRole('button', { name: new RegExp(`^${name}`) })).toBeEnabled()
  })

  test('Share or download waits while the lines and the email load, and says nothing wrong', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: QUOTE_ITEMS } })
    let release: () => void = () => {}
    const held = new Promise<void>((resolve) => { release = resolve })
    // Hold the line read and the linked client's email read.
    await context.route((u) => u.pathname.endsWith('/rest/v1/fh_quote_items')
      || (u.pathname.endsWith('/rest/v1/fh_clients') && u.searchParams.get('select') === 'email'), async (route) => {
      if (route.request().method() === 'GET') await held
      return route.fallback()
    })
    await openQuote(page)
    await expect(page.locator('.fhqt-loading')).toBeVisible()
    // Approve quote waits too, without claiming there is no line.
    const approve = page.getByRole('button', { name: /^Approve quote/ })
    await expect(approve).toBeDisabled()
    await expect(approve).toContainText('Record that the customer said yes.')

    for (const name of SHARE_ROWS) await expect(shareRows(page).getByRole('button', { name: new RegExp(`^${name}`) })).toBeDisabled()
    // Neither line is known yet, so neither is said.
    await expect(shareRows(page).getByText('Add at least one line')).toHaveCount(0)
    await expect(shareRows(page).getByText('Add a customer email first.')).toHaveCount(0)

    release()
    for (const name of SHARE_ROWS) await expect(shareRows(page).getByRole('button', { name: new RegExp(`^${name}`) })).toBeEnabled()
    await expect(shareRows(page).getByRole('button', { name: /^Send for electronic signature/ })).toContainText('jeff@roy.com')
  })

  test('a failed read of the client email does not say there is none', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: QUOTE_ITEMS } })
    await failEmailReads(context, () => true)
    await openQuote(page)
    await expect(page.getByText("Couldn't check the email for Jeff.", { exact: false })).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('Add a customer email first', { exact: false })).toHaveCount(0)
    await expect(page.getByText(/No email on file/)).toHaveCount(0)
    await expect(page.locator('.fhqt-total').getByRole('button', { name: 'Send for approval' })).toBeDisabled()
  })
})

test.describe('Reset password', () => {
  test('keeps its status in the page, so the notice is announced', async ({ context, page }) => {
    await signIn(context)
    await page.goto('/reset-password', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Reset your password.' })).toBeVisible({ timeout: 30_000 })
    const form = page.locator('form.fha-form')
    await expect(form).toBeVisible()
    // The live region is there before anything happens, and empty.
    const status = form.locator('[role="status"]')
    await expect(status).toHaveCount(1)
    await expect(status).toHaveText('')
    await status.evaluate((el) => el.setAttribute('data-first', 'yes'))

    await page.getByLabel('New password', { exact: true }).fill('correct horse')
    await page.getByLabel('Confirm password', { exact: true }).fill('correct horse')
    await page.getByRole('button', { name: 'Update password' }).click()
    // The same region carries the notice.
    await expect(form.locator('[role="status"][data-first="yes"]')).toHaveText('Password updated. Redirecting…')
    await expect(form.locator('[role="status"]')).toHaveCount(1)
  })
})

test.describe('Focus stays where the keyboard put it', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    test.skip(!isPhone(testInfo.project.name), 'Phone screens')
  })

  // The Jobs filter is a chip in the header (Phase 9, D57): Enter toggles
  // it in place and focus never leaves the chip, so there is no sheet to
  // come back from.
  test('Enter toggles the lost jobs chip and keeps focus on it', async ({ context, page }) => {
    await signIn(context)
    await openJobs(page)
    const lost = page.getByRole('group', { name: 'Filter and sort' }).getByRole('switch', { name: 'Show lost jobs' })
    await expect(lost).toHaveAttribute('aria-checked', 'false')
    await lost.focus()
    await page.keyboard.press('Enter')
    await expect(lost).toHaveAttribute('aria-checked', 'true')
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(lost).toBeFocused()
    await page.keyboard.press('Enter')
    await expect(lost).toHaveAttribute('aria-checked', 'false')
    await expect(lost).toBeFocused()
  })

  // The quote's line editor opens in place (Phase 9, D57): Escape closes it
  // and focus comes back to the button that opened it, the same way.
  test('the same holds for a row that opens the line editor in place', async ({ context, page }) => {
    await stubSends(context)
    await signIn(context, { tables: { fh_quote_items: QUOTE_ITEMS } })
    await openQuote(page)
    const add = page.getByRole('button', { name: 'Add a line', exact: true })
    await add.focus()
    await page.keyboard.press('Enter')
    const editor = page.getByRole('form', { name: 'Add a line' })
    await expect(editor).toBeVisible()
    await expect(editor.getByLabel('Description')).toBeFocused()
    await page.keyboard.press('Escape')
    await expect(editor).toBeHidden()
    await expect(add).toBeFocused()
  })
})
