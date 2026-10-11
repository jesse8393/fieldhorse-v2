// The Quote tab on a phone (docs/design/2026-10-redesign/SPEC.md 9.6,
// PHASE3_PLAN.md Task 3.4, render glamor/g-quote.jpg): lines as hairline
// rows, optional items behind switches, the onyx capsule with the total,
// the deposit and the one gold "Send for approval".
//
// Nothing here may send anything. Every send route and every share link
// insert is spied on through context.route, and the routes that would
// carry a real send answer with a canned reply.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

const NOW = Date.now()
const DAY = 86400000
const iso = (ms: number) => new Date(ms).toISOString()

function item(id: string, description: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: 'qa-user-1',
    contact_id: 'c-quote',
    section: null,
    description,
    qty: 1,
    unit: null,
    rate: 0,
    amount: 0,
    notes: null,
    is_optional: false,
    is_excluded: false,
    sort_order: 0,
    created_at: iso(NOW - DAY),
    updated_at: iso(NOW - DAY),
    ...over
  }
}

// Two base lines ($3,150.00) and one optional line ($4,950.00).
const ITEMS = [
  item('qi1', 'Excavate and grade', { qty: 1100, unit: 'sq ft', rate: 2, amount: 2200, sort_order: 0 }),
  item('qi2', 'Pump truck', { qty: 1, unit: 'day', rate: 950, amount: 950, sort_order: 1 }),
  item('qi3', 'Stamped ashlar, charcoal release', { qty: 1, rate: 4950, amount: 4950, is_optional: true, sort_order: 2 })
]

// The mock's MMC Properties quote, written out so a test can change one field.
function quoteContact(over: Record<string, unknown> = {}) {
  const client = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' }
  return {
    id: 'c-quote',
    stage: 'quote',
    name: 'MMC Properties',
    job_title: 'Parking lot repour',
    amount: 3150,
    proposal_status: 'sent',
    quote_sent_at: iso(NOW - DAY),
    follow_up_on: null,
    user_id: 'qa-user-1',
    client_id: 'cl-1',
    phone: '555-0101',
    email: 'x@y.com',
    address: '412 Burkitt Station Rd',
    notes: null,
    scope_text: null,
    terms_text: null,
    milestones: [],
    created_at: iso(NOW - 28 * DAY),
    updated_at: iso(NOW - DAY),
    completed_at: null,
    invoice_no: null,
    client_name: client.name,
    fh_clients: client,
    ...over
  }
}

type Calls = { send: { url: string; body: string }[]; publicLinks: number }

/** Spies on every route that could send a quote, and on share link inserts. */
async function watchSends(context: BrowserContext): Promise<Calls> {
  const calls: Calls = { send: [], publicLinks: 0 }
  await context.route(/\/api\/(send-|docusign-send)/, (route) => {
    calls.send.push({ url: route.request().url(), body: route.request().postData() || '' })
    return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ ok: true }) })
  })
  await context.route((url) => url.pathname.includes('/rest/v1/fh_public_links'), (route) => {
    if (route.request().method() === 'POST') calls.publicLinks += 1
    return route.fallback()
  })
  return calls
}

async function openQuote(page: Page, path = '/quotes/c-quote?tab=quote') {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fhq-page')).toBeVisible({ timeout: 30_000 })
}

function failOnPageErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return () => expect(errors, errors.join('\n')).toEqual([])
}

test.describe('quote tab on a phone', () => {
  test.beforeEach(async ({ page: _page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone layout')
  })

  test('quote total and deposit', async ({ context, page }) => {
    const noErrors = failOnPageErrors(page)
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)

    const capsule = page.locator('.fhj-capsule')
    await expect(capsule.getByText('Total', { exact: true })).toBeVisible()
    await expect(capsule.getByText('$3,150.00', { exact: true })).toBeVisible()
    await expect(capsule.getByText('Deposit $1,575.00 at approval')).toBeVisible()
    const send = capsule.getByRole('button', { name: 'Send for approval' })
    await expect(send).toBeEnabled()

    // One brushed gold action on the screen, and the dock steps aside.
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(1)
    await expect(page.getByRole('navigation', { name: 'Primary' })).toBeHidden()

    // The page: status chip with its word, lines with money, the optional panel.
    await expect(page.getByRole('heading', { level: 2, name: 'Quote' })).toBeVisible()
    await expect(page.locator('.fhq-head').getByText('Sent', { exact: true })).toBeVisible()
    const lines = page.getByRole('list', { name: 'Line items' })
    await expect(lines.getByText('Excavate and grade')).toBeVisible()
    await expect(lines.getByText('1,100 sq ft at $2.00')).toBeVisible()
    await expect(lines.getByText('$2,200.00')).toBeVisible()
    await expect(lines.getByText('1 day at $950.00')).toBeVisible()
    await expect(lines.getByText('Stamped ashlar')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add a line' })).toBeVisible()
    await expect(page.locator('.fhq-optional').getByText('Stamped ashlar, charcoal release')).toBeVisible()
    await expect(page.locator('.fhq-optional').getByText('Adds $4,950.00')).toBeVisible()
    noErrors()
  })

  test('the capsule keeps off the last row', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
    await page.waitForTimeout(150)
    const capsuleTop = await page.locator('.fhj-capsule').evaluate((el) => el.getBoundingClientRect().top)
    const contentBottom = await page.locator('.fhq-page').evaluate((el) => el.getBoundingClientRect().bottom)
    expect(contentBottom).toBeLessThanOrEqual(capsuleTop)
  })

  test('preview never sends', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const calls = await watchSends(context)
    await openQuote(page)

    await page.getByRole('button', { name: 'Preview as MMC Properties' }).click()
    const preview = page.getByRole('dialog', { name: 'Proposal preview' })
    await expect(preview).toBeVisible()
    // The customer's view: the lines and the money, drawn in the app.
    await expect(preview.getByText('Excavate and grade').first()).toBeVisible({ timeout: 15_000 })
    await page.waitForTimeout(500)

    expect(calls.send).toEqual([])
    expect(calls.publicLinks).toBe(0)
  })

  test('optional switch', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const calls = await watchSends(context)
    await openQuote(page)

    const capsule = page.locator('.fhj-capsule')
    const toggle = page.getByRole('switch', { name: 'Include Stamped ashlar, charcoal release in the total' })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(capsule.getByText('$3,150.00', { exact: true })).toBeVisible()

    // The save goes through updateItem, which patches the row.
    const saved = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/rest/v1/fh_quote_items'))
    await toggle.click()
    // The total moves at once. The mock does not store writes, so this is
    // the optimistic total, not the value after a refetch.
    await expect(capsule.getByText('$8,100.00', { exact: true })).toBeVisible()
    await expect(capsule.getByText('Deposit $4,050.00 at approval')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    const request = await saved
    expect(request.url()).toContain('id=eq.qi3')
    expect(request.postDataJSON()).toEqual({ is_optional: false })

    // And back.
    await toggle.click()
    await expect(capsule.getByText('$3,150.00', { exact: true })).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(calls.send).toEqual([])
  })

  test('empty quote', async ({ context, page }) => {
    await signIn(context)
    await openQuote(page)
    const capsule = page.locator('.fhj-capsule')
    await expect(capsule.getByRole('button', { name: 'Send for approval' })).toBeDisabled()
    await expect(capsule.getByText('Add at least one line')).toBeVisible()
    await expect(capsule.getByText('$0.00', { exact: true })).toBeVisible()
    await expect(capsule.getByText('Deposit $0.00 at approval')).toBeVisible()
  })

  test('only optional lines cannot be sent', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: [ITEMS[2]] } })
    await openQuote(page)
    const capsule = page.locator('.fhj-capsule')
    await expect(capsule.getByRole('button', { name: 'Send for approval' })).toBeDisabled()
    await expect(capsule.getByText('Add at least one line')).toBeVisible()
    await expect(capsule.getByText('$0.00', { exact: true })).toBeVisible()
    await expect(page.locator('.fhq-optional').getByText('Stamped ashlar, charcoal release')).toBeVisible()
  })

  test('send for approval emails the proposal when the customer has an email', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const calls = await watchSends(context)
    // The proposal PDF uploads to storage before the send; the mock answers 404.
    await context.route('**/storage/v1/object/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'job-files/test.pdf' }) }))
    // handleSend refuses when its own count of base lines is 0. The mock's
    // content-range header never reaches the page (no CORS expose header),
    // so that count is always 0 here; answer the count query the way a real
    // project does.
    await context.route((url) => url.pathname.includes('/rest/v1/fh_quote_items'), (route) => {
      if (route.request().method() !== 'HEAD') return route.fallback()
      return route.fulfill({
        status: 200,
        headers: { 'content-range': '0-1/2', 'access-control-allow-origin': '*', 'access-control-expose-headers': 'content-range' }
      })
    })
    await openQuote(page)

    await expect(page.locator('.fhj-capsule').getByText('Copies a link')).toHaveCount(0)
    await page.getByRole('button', { name: 'Send for approval' }).click()
    await expect.poll(() => calls.send.length, { timeout: 30_000 }).toBe(1)
    const body = JSON.parse(calls.send[0].body)
    expect(calls.send[0].url).toContain('/api/send-quote')
    expect(body).toMatchObject({ contact_id: 'c-quote', recipient_email: 'x@y.com' })
    expect(calls.publicLinks).toBe(0)
  })

  test('send for approval shares a link when there is no email', async ({ context, page }) => {
    await signIn(context, {
      tables: {
        fh_contacts: [quoteContact({ email: null })],
        fh_quote_items: ITEMS,
        // The mock answers an insert with the first row of the table.
        fh_public_links: [{ id: 'l1', user_id: 'qa-user-1', contact_id: 'c-quote', kind: 'proposal', token: 'abc123', created_at: iso(NOW) }]
      }
    })
    const calls = await watchSends(context)
    await openQuote(page)

    await expect(page.locator('.fhj-capsule').getByText('Copies a link')).toBeVisible()
    await expect(page.locator('.fhq-head').getByText(/No email on file/)).toBeVisible()
    await page.getByRole('button', { name: 'Send for approval' }).click()
    await expect.poll(() => calls.publicLinks, { timeout: 30_000 }).toBe(1)
    await expect(page.getByText(/Share link (copied|ready)/).first()).toBeVisible()
    expect(calls.send).toEqual([])
  })

  test('changes requested', async ({ context, page }) => {
    await signIn(context)
    await openQuote(page, '/quotes/c-change?tab=quote')
    const head = page.locator('.fhq-head')
    await expect(head.getByText('Changes requested', { exact: true })).toBeVisible()
    const panel = page.getByRole('region', { name: 'Customer requested changes' })
    await expect(panel.getByText('Please separate the cabinet allowance.')).toBeVisible()
    await expect(panel.getByText(/Approval stays paused until the revision is sent/)).toBeVisible()
    // Approving by hand is not offered while the customer waits on a revision.
    await expect(page.getByRole('button', { name: /approve quote/i })).toHaveCount(0)
  })

  test('approving by hand stays one tap away', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)
    const approve = page.getByRole('button', { name: /approve quote/i })
    await expect(approve).toHaveCount(1)
    await approve.click()
    await expect(page.getByRole('dialog')).toBeVisible()
  })

  test('a line opens in a sheet and saves through updateItem', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)

    await page.getByRole('button', { name: /Pump truck/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Edit line' })
    await expect(sheet).toBeVisible()
    await expect(sheet.getByLabel('Description')).toHaveValue('Pump truck')
    await expect(sheet.getByLabel('Rate')).toHaveValue('950')

    // The amount follows quantity and rate while it still equals their product.
    await sheet.getByLabel('Rate').fill('1000')
    await expect(sheet.getByLabel('Amount')).toHaveValue('1000')

    const saved = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/rest/v1/fh_quote_items'))
    await sheet.getByRole('button', { name: 'Save changes' }).click()
    const request = await saved
    expect(request.url()).toContain('id=eq.qi2')
    expect(request.postDataJSON()).toMatchObject({ description: 'Pump truck', rate: 1000, amount: 1000, is_optional: false, is_excluded: false })
    await expect(sheet).toBeHidden()
  })

  test('add a line', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    // The mock answers an insert with the first row; echo the new one back instead.
    await context.route((url) => url.pathname.includes('/rest/v1/fh_quote_items'), (route) => {
      const request = route.request()
      if (request.method() !== 'POST') return route.fallback()
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'qi-new', created_at: iso(NOW), updated_at: iso(NOW), ...request.postDataJSON() })
      })
    })
    await openQuote(page)

    await page.getByRole('button', { name: 'Add a line' }).click()
    const sheet = page.getByRole('dialog', { name: 'Add a line' })
    await expect(sheet).toBeVisible()
    // A line needs a description, and the error says what to do.
    await sheet.getByRole('button', { name: 'Add line' }).click()
    await expect(sheet.getByText('Add a description, such as Excavate and grade.')).toBeVisible()

    await sheet.getByLabel('Description').fill('Haul off spoils')
    await sheet.getByLabel('Quantity').fill('2')
    await sheet.getByLabel('Unit').fill('loads')
    await sheet.getByLabel('Rate').fill('390')
    await expect(sheet.getByLabel('Amount')).toHaveValue('780')

    const saved = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/rest/v1/fh_quote_items'))
    await sheet.getByRole('button', { name: 'Add line' }).click()
    const request = await saved
    expect(request.postDataJSON()).toMatchObject({
      contact_id: 'c-quote',
      description: 'Haul off spoils',
      qty: 2,
      unit: 'loads',
      rate: 390,
      amount: 780,
      is_optional: false,
      is_excluded: false
    })
    await expect(sheet).toBeHidden()
    const lines = page.getByRole('list', { name: 'Line items' })
    await expect(lines.getByText('Haul off spoils')).toBeVisible()
    await expect(lines.getByText('2 loads at $390.00')).toBeVisible()
    await expect(page.locator('.fhj-capsule').getByText('$3,930.00', { exact: true })).toBeVisible()
  })

  test('scope and terms stay editable and set the deposit', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)

    await page.getByRole('button', { name: /Scope and terms/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Scope and terms' })
    await expect(sheet).toBeVisible()
    for (const label of ['Scope of work', 'Exclusions', 'Payment terms', 'Quote expires']) {
      await expect(sheet.getByLabel(label)).toBeVisible()
    }
    await sheet.getByLabel('Payment terms').fill('30% deposit on signing, 70% on completion.')
    const saved = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/rest/v1/fh_contacts'))
    await sheet.getByRole('button', { name: 'Save terms' }).click()
    expect((await saved).postDataJSON()).toMatchObject({ terms_text: '30% deposit on signing, 70% on completion.' })
    await expect(sheet).toBeHidden()
    // The deposit follows what the terms say.
    await expect(page.locator('.fhj-capsule').getByText('Deposit $945.00 at approval')).toBeVisible()
  })

  test('sharing, downloading and electronic signature stay reachable', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)
    await page.getByRole('button', { name: /Share or download/ }).click()
    const sheet = page.getByRole('dialog', { name: 'Share or download' })
    for (const name of ['Open the PDF', 'Download the PDF', 'Copy a share link', 'Send for electronic signature']) {
      await expect(sheet.getByRole('button', { name: new RegExp(name) })).toBeVisible()
    }
  })

  test('a draft can be deleted, an approved quote cannot', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS, fh_contacts: [quoteContact({ proposal_status: 'draft' })] } })
    await openQuote(page)
    await expect(page.getByRole('button', { name: 'Delete draft quote' })).toBeVisible()

    await signIn(context, { tables: { fh_quote_items: ITEMS, fh_contacts: [quoteContact({ proposal_status: 'approved' })] } })
    await openQuote(page)
    await expect(page.getByRole('button', { name: 'Delete draft quote' })).toHaveCount(0)
    await expect(page.getByText('Approved quotes cannot be deleted. Create a revision instead.')).toBeVisible()
  })

  test('the other tabs keep the action capsule', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)
    await page.getByRole('tablist', { name: 'Job sections' }).getByRole('tab', { name: 'Details', exact: true }).click()
    const capsule = page.locator('.fhj-capsule')
    await expect(capsule.getByRole('button', { name: /photo/i })).toBeVisible()
    await expect(capsule.getByRole('button', { name: /voice note/i })).toBeVisible()
    await expect(capsule.getByRole('button', { name: 'Approve quote' })).toBeVisible()
    await expect(capsule.getByText('Total', { exact: true })).toHaveCount(0)
  })
})

test.describe('quote tab stage actions', () => {
  test('review changes stays the stage action on the other tabs', async ({ context, page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone layout')
    await signIn(context)
    await openQuote(page, '/quotes/c-change?tab=quote')
    await page.getByRole('tablist', { name: 'Job sections' }).getByRole('tab', { name: 'Details', exact: true }).click()
    await expect(page.locator('.fhj-capsule').getByRole('button', { name: 'Review changes' })).toBeVisible()
  })
})

test.describe('quote tab on a desktop', () => {
  test('keeps the builder and the document toggle', async ({ context, page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop layout')
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await page.goto('/quotes/c-quote?tab=quote', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.locator('[data-build-screen="SnowJobDetailBuild"]')).toBeVisible({ timeout: 30_000 })
    await expect(page.getByRole('heading', { name: 'Line items' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Builder' })).toBeVisible()
    await expect(page.getByRole('tab', { name: 'Document' })).toBeVisible()
    await expect(page.locator('.fhq-page')).toHaveCount(0)
    await expect(page.locator('.fhj-capsule')).toHaveCount(0)
  })
})
