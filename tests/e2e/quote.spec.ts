// The quote screen (docs/design/2026-10-redesign/PHASE9_PLAN.md Task 10,
// decisions D53 to D61): a quote is its own record on fh_quotes with its
// lines on fh_quote_items by quote_id. The screen shows the client, the
// title, the lines (tap one to edit it in place, a plus row adds one), the
// total and the deposit sentence, Scope and terms, Preview, Send, Share link
// and Make this a job. Nothing opens in a sheet (D57): every flow is a route
// with Back.
//
// Nothing here may send anything. Every send route and every share link
// insert is spied on through context.route, and the routes that would
// carry a real send answer with a canned reply.
import { expect, test, type BrowserContext, type Page } from '@playwright/test'
import { signIn } from './helpers/signIn.ts'

const NOW = Date.now()
const DAY = 86400000
const iso = (ms: number) => new Date(ms).toISOString()

// The mock's client, Jeff Roy, so "Preview as Jeff" and the approval's name.
const CLIENT = { id: 'cl-1', name: 'Jeff Roy', phone: '555-0101', email: 'jeff@roy.com' }

function item(id: string, description: string, over: Record<string, unknown> = {}) {
  return {
    id,
    user_id: 'qa-user-1',
    quote_id: 'q-quote',
    contact_id: null,
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
function quoteRow(over: Record<string, unknown> = {}) {
  return {
    id: 'q-quote',
    user_id: 'qa-user-1',
    client_id: 'cl-1',
    origin_contact_id: 'c-quote',
    lead_id: null,
    job_id: null,
    title: 'Parking lot repour',
    amount: 46200,
    status: 'sent',
    sent_at: iso(NOW - DAY),
    expires_at: null,
    scope_text: null,
    terms_text: null,
    exclusions_text: null,
    job_type: null,
    change_request_note: null,
    change_requested_at: null,
    approved_version_id: null,
    created_at: iso(NOW - 28 * DAY),
    updated_at: iso(NOW - DAY),
    fh_clients: CLIENT,
    ...over
  }
}

// The client as the mock's fh_clients table holds it: the quote screen reads
// the client's email from here, fresh, the way Money does.
function clientRow(over: Record<string, unknown> = {}) {
  return { ...CLIENT, user_id: 'qa-user-1', company_name: null, address: '412 Burkitt Station Rd', created_at: iso(NOW - 60 * DAY), ...over }
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

async function openQuote(page: Page, path = '/quotes/q-quote') {
  await page.goto(path, { waitUntil: 'domcontentloaded', timeout: 60_000 })
  await expect(page.locator('.fhqt-page')).toBeVisible({ timeout: 30_000 })
}

function failOnPageErrors(page: Page) {
  const errors: string[] = []
  page.on('pageerror', (error) => errors.push(error.message))
  return () => expect(errors, errors.join('\n')).toEqual([])
}

const total = (page: Page) => page.locator('.fhqt-total')
const lines = (page: Page) => page.getByRole('list', { name: 'Line items' })

test.describe('the quote screen', () => {
  test('a quote opens with its lines and no sheet', async ({ context, page }) => {
    const noErrors = failOnPageErrors(page)
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)

    // The client, the title and the status.
    await expect(page.getByRole('heading', { level: 1, name: 'Parking lot repour' })).toBeVisible()
    await expect(page.locator('.fhqt-client')).toContainText('Jeff Roy')
    await expect(page.locator('.fhqt-head').getByText('Sent', { exact: true })).toBeVisible()

    // The lines with their money, and the optional panel.
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    await expect(lines(page).getByText('1,100 sq ft at $2.00')).toBeVisible()
    await expect(lines(page).getByText('$2,200.00')).toBeVisible()
    await expect(lines(page).getByText('1 day at $950.00')).toBeVisible()
    await expect(lines(page).getByText('Stamped ashlar')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add a line' })).toBeVisible()
    await expect(page.locator('.fhqt-optional').getByText('Stamped ashlar, charcoal release')).toBeVisible()
    await expect(page.locator('.fhqt-optional').getByText('Adds $4,950.00')).toBeVisible()

    // The total and the deposit sentence, and the one gold Send.
    await expect(total(page).getByText('Total', { exact: true })).toBeVisible()
    await expect(total(page).getByText('$3,150.00', { exact: true })).toBeVisible()
    await expect(total(page).getByText('Deposit $1,575.00 at approval')).toBeVisible()
    await expect(total(page).getByRole('button', { name: 'Send for approval' })).toBeEnabled()
    await expect(page.locator('.fhc-btn--primary')).toHaveCount(1)

    // The rows that lead on: scope and terms, the preview, approving by hand.
    await expect(page.getByRole('link', { name: /Scope and terms/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Preview as Jeff/ })).toBeVisible()
    await expect(page.getByRole('link', { name: /Approve quote/ })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Make this a job' })).toBeVisible()

    // No sheet, drawer or dialog anywhere (D57).
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.locator('[data-vaul-drawer]')).toHaveCount(0)
    noErrors()
  })

  test('the screen reads as one column on a desktop', async ({ context, page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('desktop'), 'Desktop layout')
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    await expect(page.getByRole('link', { name: /Preview as Jeff/ })).toBeVisible()
    await expect(page.locator('.fhj-capsule')).toHaveCount(0)
    const width = await page.locator('.fhqt-page').evaluate((el) => el.getBoundingClientRect().width)
    expect(width).toBeLessThanOrEqual(640)
  })

  test('the dock keeps off the last row', async ({ context, page }, testInfo) => {
    test.skip(!testInfo.project.name.startsWith('mobile'), 'Phone layout')
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)
    // The lines land after the quote; scroll once they are on the page, and
    // read the geometry until the scroll has settled.
    await expect(lines(page).getByText('Excavate and grade')).toBeVisible()
    const dock = page.getByRole('navigation', { name: 'Primary' })
    await expect(dock).toBeVisible()
    await expect.poll(async () => {
      await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }))
      const dockTop = await dock.evaluate((el) => el.getBoundingClientRect().top)
      const contentBottom = await page.locator('.fhqt-page').evaluate((el) => el.getBoundingClientRect().bottom)
      return contentBottom - dockTop
    }).toBeLessThanOrEqual(0)
  })

  test('preview never sends', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const calls = await watchSends(context)
    await openQuote(page)

    await page.getByRole('link', { name: /Preview as Jeff/ }).click()
    await expect(page).toHaveURL(/\/quotes\/q-quote\/preview$/)
    const preview = page.getByRole('group', { name: 'Proposal preview' })
    await expect(preview).toBeVisible()
    // The customer's view: the lines and the money, drawn in the app.
    await expect(preview.getByText('Excavate and grade').first()).toBeVisible({ timeout: 15_000 })
    await expect(page.getByText('This is what Jeff sees. Nothing is sent.')).toBeVisible()
    await page.waitForTimeout(500)

    expect(calls.send).toEqual([])
    expect(calls.publicLinks).toBe(0)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('optional switch', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const calls = await watchSends(context)
    await openQuote(page)

    const toggle = page.getByRole('switch', { name: 'Include Stamped ashlar, charcoal release in the total' })
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    await expect(total(page).getByText('$3,150.00', { exact: true })).toBeVisible()

    // The save goes through updateItem, which patches the row.
    const saved = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/rest/v1/fh_quote_items'))
    await toggle.click()
    // The total moves at once. The mock does not store writes, so this is
    // the optimistic total, not the value after a refetch.
    await expect(total(page).getByText('$8,100.00', { exact: true })).toBeVisible()
    await expect(total(page).getByText('Deposit $4,050.00 at approval')).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'true')
    const request = await saved
    expect(request.url()).toContain('id=eq.qi3')
    expect(request.postDataJSON()).toEqual({ is_optional: false })

    // And back.
    await toggle.click()
    await expect(total(page).getByText('$3,150.00', { exact: true })).toBeVisible()
    await expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(calls.send).toEqual([])
  })

  test('empty quote', async ({ context, page }) => {
    await signIn(context)
    await openQuote(page)
    await expect(total(page).getByRole('button', { name: 'Send for approval' })).toBeDisabled()
    await expect(total(page).getByText('Add at least one line')).toBeVisible()
    // No line has a price, so the quote's own amount ($46,200 in the mock)
    // stands in, as it does on the customer page (decision D31).
    await expect(total(page).getByText('$46,200.00', { exact: true })).toBeVisible()
    await expect(total(page).getByText('Deposit $23,100.00 at approval')).toBeVisible()
    await expect(page.getByText('No lines yet.')).toBeVisible()
  })

  test('the deposit follows the terms', async ({ context, page }) => {
    await signIn(context, {
      tables: {
        fh_quote_items: ITEMS,
        fh_quotes: [quoteRow({ terms_text: '$2,500 deposit on signing, balance at completion.' })]
      }
    })
    await openQuote(page)
    await expect(total(page).getByText('$3,150.00', { exact: true })).toBeVisible()
    await expect(total(page).getByText('Deposit $2,500.00 at approval')).toBeVisible()
  })

  for (const [terms, note] of [
    ['No deposit required. Net 30 after completion.', 'No deposit'],
    ['50% down at rough in, 50% at completion.', 'Payment follows the terms']
  ]) {
    test(`terms that name no deposit read "${note}"`, async ({ context, page }) => {
      await signIn(context, { tables: { fh_quote_items: ITEMS, fh_quotes: [quoteRow({ terms_text: terms })] } })
      await openQuote(page)
      await expect(total(page).getByText('$3,150.00', { exact: true })).toBeVisible()
      await expect(total(page).getByText(note, { exact: true })).toBeVisible()
      await expect(total(page).getByText(/^Deposit /)).toHaveCount(0)
    })
  }

  test('only optional lines cannot be sent', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: [ITEMS[2]] } })
    await openQuote(page)
    await expect(total(page).getByRole('button', { name: 'Send for approval' })).toBeDisabled()
    await expect(total(page).getByText('Add at least one line')).toBeVisible()
    await expect(total(page).getByText('$0.00', { exact: true })).toBeVisible()
    await expect(page.locator('.fhqt-optional').getByText('Stamped ashlar, charcoal release')).toBeVisible()
  })

  test('send for approval emails the proposal when the client has an email', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const calls = await watchSends(context)
    // The proposal PDF uploads to storage before the send; the mock answers 404.
    await context.route('**/storage/v1/object/**', (route) =>
      route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ Key: 'job-files/test.pdf' }) }))
    await openQuote(page)

    await expect(total(page).getByText('Copies a link')).toHaveCount(0)
    await total(page).getByRole('button', { name: 'Send for approval' }).click()
    await expect.poll(() => calls.send.length, { timeout: 30_000 }).toBe(1)
    const body = JSON.parse(calls.send[0].body)
    expect(calls.send[0].url).toContain('/api/send-quote')
    // The quote id goes along, and the email is the client's (lib/customerEmail.ts).
    expect(body).toMatchObject({ quote_id: 'q-quote', recipient_email: 'jeff@roy.com' })
    expect(calls.publicLinks).toBe(0)
  })

  test('copying an approval link preserves draft status until delivery is acknowledged', async ({ context, page }) => {
    await signIn(context, {
      tables: {
        fh_quotes: [quoteRow({ status: 'draft', sent_at: null, fh_clients: { ...CLIENT, email: null } })],
        fh_clients: [clientRow({ email: null })],
        fh_quote_items: ITEMS,
        // The mock answers an insert with the first row of the table.
        fh_public_links: [{ id: 'l1', user_id: 'qa-user-1', contact_id: null, quote_id: 'q-quote', kind: 'proposal', token: 'abc123', created_at: iso(NOW) }]
      }
    })
    const calls = await watchSends(context)
    let stored = quoteRow({ status: 'draft', sent_at: null, fh_clients: { ...CLIENT, email: null } })
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_quotes'), async (route) => {
      const request = route.request()
      if (request.method() === 'PATCH') {
        const url = new URL(request.url())
        if (url.searchParams.get('status') !== `eq.${stored.status}` || url.searchParams.get('job_id') !== 'is.null') {
          return route.fulfill({ status: 200, contentType: 'application/json', body: 'null' })
        }
        stored = { ...stored, ...request.postDataJSON() }
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(stored) })
      }
      if (request.method() === 'GET') {
        const single = request.headers().accept?.includes('vnd.pgrst.object')
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(single ? stored : [stored]) })
      }
      return route.fallback()
    })
    await openQuote(page)

    await expect(total(page).getByText('Copies a link')).toBeVisible()
    await expect(page.locator('.fhqt-page').getByText(/No email on file/)).toBeVisible()
    const patches: object[] = []
    page.on('request', (r) => { if (r.method() === 'PATCH' && r.url().includes('/rest/v1/fh_quotes')) patches.push(r.postDataJSON()) })
    await total(page).getByRole('button', { name: 'Copy approval link' }).click()
    await expect.poll(() => calls.publicLinks, { timeout: 30_000 }).toBe(1)
    await expect(page.getByText(/Share link (copied|ready)/).first()).toBeVisible()
    expect(patches).toEqual([])
    await expect(page.locator('.fhqt-head').getByText('Draft', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: /^Mark as sent/ }).click()
    await expect.poll(() => patches.length).toBe(1)
    expect(patches[0]).toMatchObject({ status: 'sent' })
    await expect(page.getByText('Quote marked as sent', { exact: true })).toBeVisible()
    await expect(page.locator('.fhqt-head').getByText('Sent', { exact: true })).toBeVisible()
    expect(calls.send).toEqual([])
  })

  test('a customer name saved in sentence case shows whole in the labels', async ({ context, page }) => {
    // Read as a person only by recasing it, "Elite pools" is a guess, so the
    // labels in the app keep the name as it was saved.
    const client = { ...CLIENT, name: 'Elite pools', email: null }
    await signIn(context, {
      tables: {
        fh_quotes: [quoteRow({ fh_clients: client })],
        fh_clients: [clientRow({ name: 'Elite pools', email: null })],
        fh_quote_items: ITEMS
      }
    })
    await openQuote(page)

    await expect(page.getByRole('link', { name: 'Preview as Elite pools' })).toBeVisible()
    await expect(page.getByRole('heading', { name: 'Optional for Elite pools' })).toBeVisible()
    await expect(page.locator('.fhqt-page').getByText('No email on file for Elite pools.', { exact: false })).toBeVisible()
  })

  test('changes requested', async ({ context, page }) => {
    await signIn(context)
    await openQuote(page, '/quotes/q-change')
    const head = page.locator('.fhqt-head')
    await expect(head.getByText('Changes requested', { exact: true })).toBeVisible()
    const panel = page.getByRole('region', { name: 'Customer requested changes' })
    await expect(panel.getByText('Please separate the cabinet allowance.')).toBeVisible()
    await expect(panel.getByText(/Approval stays paused until the revision is sent/)).toBeVisible()
    // Approving by hand is not offered while the customer waits on a revision.
    await expect(page.getByRole('link', { name: /approve quote/i })).toHaveCount(0)
    // Make this a job stays: Jesse decides, not the software (D61).
    await expect(page.getByRole('button', { name: 'Make this a job' })).toBeVisible()
  })

  test('approving by hand is one tap away and a screen of its own', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)
    const approve = page.getByRole('link', { name: /approve quote/i })
    await expect(approve).toHaveCount(1)
    await approve.click()
    await expect(page).toHaveURL(/\/quotes\/q-quote\/approve$/)
    await expect(page.getByRole('heading', { name: 'Lock the approved quote.' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // The approval starts from the client's email and names the quote.
    await expect(page.getByLabel('Email (optional)')).toHaveValue('jeff@roy.com')
    await expect(page.getByLabel('Approved by')).toHaveValue('Jeff Roy')
  })

  test('editing a line happens in place', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)

    await lines(page).getByRole('button', { name: /Pump truck/ }).click()
    // The row opens into the editor where it stands: no dialog, same URL.
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page).toHaveURL(/\/quotes\/q-quote$/)
    const editor = page.getByRole('form', { name: 'Edit line' })
    await expect(editor).toBeVisible()
    await expect(editor.getByLabel('Description')).toHaveValue('Pump truck')
    await expect(editor.getByLabel('Rate')).toHaveValue('950')

    // The amount follows quantity and rate while it still equals their product.
    await editor.getByLabel('Rate').fill('1000')
    await expect(editor.getByLabel('Amount')).toHaveValue('1000')

    const saved = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/rest/v1/fh_quote_items'))
    await editor.getByRole('button', { name: 'Save changes' }).click()
    const request = await saved
    expect(request.url()).toContain('id=eq.qi2')
    expect(request.postDataJSON()).toMatchObject({ description: 'Pump truck', rate: 1000, amount: 1000, is_optional: false, is_excluded: false })
    await expect(editor).toBeHidden()
    await expect(lines(page).getByRole('button', { name: /Excavate and grade/ })).toBeVisible()
  })

  // Audit finding M-09: the estimator saves 3 at $333.33 for $1,000.00.
  test('a line from the estimator follows a new quantity', async ({ context, page }) => {
    const estimated = item('qi-est', 'Form and pour', { qty: 3, unit: 'ea', rate: 333.33, amount: 1000, sort_order: 0 })
    await signIn(context, { tables: { fh_quote_items: [estimated] } })
    await openQuote(page)
    await lines(page).getByRole('button', { name: /Form and pour/ }).click()
    const editor = page.getByRole('form', { name: 'Edit line' })
    await editor.getByLabel('Quantity').fill('4')
    await expect(editor.getByLabel('Amount')).toHaveValue('1333.32')
    const saved = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/rest/v1/fh_quote_items'))
    await editor.getByRole('button', { name: 'Save changes' }).click()
    expect((await saved).postDataJSON()).toMatchObject({ qty: 4, rate: 333.33, amount: 1333.32 })
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
    const editor = page.getByRole('form', { name: 'Add a line' })
    await expect(editor).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    // A line needs a description, and the error says what to do.
    await editor.getByRole('button', { name: 'Add line', exact: true }).click()
    await expect(editor.getByText('Add a description, such as Excavate and grade.')).toBeVisible()

    await editor.getByLabel('Description').fill('Haul off spoils')
    await editor.getByLabel('Quantity').fill('2')
    await editor.getByLabel('Unit').fill('loads')
    await editor.getByLabel('Rate').fill('390')
    await expect(editor.getByLabel('Amount')).toHaveValue('780')

    const saved = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/rest/v1/fh_quote_items'))
    await editor.getByRole('button', { name: 'Add line', exact: true }).click()
    const request = await saved
    // The line belongs to the quote, not to a job.
    expect(request.postDataJSON()).toMatchObject({
      quote_id: 'q-quote',
      contact_id: null,
      description: 'Haul off spoils',
      qty: 2,
      unit: 'loads',
      rate: 390,
      amount: 780,
      is_optional: false,
      is_excluded: false
    })
    await expect(editor).toBeHidden()
    await expect(lines(page).getByText('Haul off spoils')).toBeVisible()
    await expect(lines(page).getByText('2 loads at $390.00')).toBeVisible()
    await expect(total(page).getByText('$3,930.00', { exact: true })).toBeVisible()
  })

  // Audit findings DATA-23 and S12: a failed add keeps what was typed.
  test('a line that fails to save stays in the editor with what was typed', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await context.route((url) => url.pathname.includes('/rest/v1/fh_quote_items'), (route) => {
      if (route.request().method() !== 'POST') return route.fallback()
      return route.abort('internetdisconnected')
    })
    await openQuote(page)
    await page.getByRole('button', { name: 'Add a line' }).click()
    const editor = page.getByRole('form', { name: 'Add a line' })
    await editor.getByLabel('Description').fill('Haul off spoils')
    await editor.getByLabel('Quantity').fill('2')
    await editor.getByLabel('Rate').fill('390')
    await editor.getByRole('button', { name: 'Add line', exact: true }).click()
    await expect(page.getByText("Couldn't add the line")).toBeVisible()
    await expect(page.getByText(/TypeError|Failed to fetch/)).toHaveCount(0)
    await expect(editor).toBeVisible()
    await expect(editor.getByLabel('Description')).toHaveValue('Haul off spoils')
    await expect(editor.getByLabel('Amount')).toHaveValue('780')
    await expect(lines(page).getByText('Haul off spoils')).toHaveCount(0)
    await expect(total(page).getByText('$3,150.00', { exact: true })).toBeVisible()
  })

  test('a new quote lands with its first line open', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: [] } })
    await openQuote(page, '/quotes/q-quote?lines=new')
    const editor = page.getByRole('form', { name: 'Add a line' })
    await expect(editor).toBeVisible()
    await expect(editor.getByLabel('Description')).toBeFocused()
    await expect(page).toHaveURL(/\/quotes\/q-quote$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('scope and terms are a screen and set the deposit', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)

    await page.getByRole('link', { name: /Scope and terms/ }).click()
    await expect(page).toHaveURL(/\/quotes\/q-quote\/terms$/)
    await expect(page.getByRole('dialog')).toHaveCount(0)
    for (const label of ['Scope of work', 'Exclusions', 'Payment terms', 'Quote expires']) {
      await expect(page.getByLabel(label)).toBeVisible()
    }
    const terms = '30% deposit on signing, 70% on completion.'
    await page.getByLabel('Payment terms').fill(terms)
    // The mock keeps no writes, so once the terms are saved every read of
    // the quote answers with them, as the database would.
    let savedTerms = false
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_quotes'), (route) => {
      if (route.request().method() === 'GET' && savedTerms) {
        return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify([quoteRow({ terms_text: terms })]) })
      }
      return route.fallback()
    })
    const saved = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/rest/v1/fh_quotes'))
    await page.getByRole('button', { name: 'Save terms' }).click()
    const request = await saved
    expect(request.url()).toContain('id=eq.q-quote')
    expect(request.postDataJSON()).toMatchObject({ terms_text: terms })
    savedTerms = true
    // Saving goes back to the quote, where the deposit follows what the terms say.
    await expect(page).toHaveURL(/\/quotes\/q-quote$/)
    await expect(total(page).getByText('Deposit $945.00 at approval')).toBeVisible()
  })

  test('sharing, downloading and electronic signature stay reachable, with no sheet', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)
    const share = page.getByRole('list', { name: 'Share or download' })
    for (const name of ['Open the PDF', 'Download the PDF', 'Copy a share link', 'Send for electronic signature']) {
      await expect(share.getByRole('button', { name: new RegExp(name) })).toBeEnabled()
    }
    await expect(page.getByRole('dialog')).toHaveCount(0)
  })

  test('a draft can be deleted with a second tap, an approved quote cannot', async ({ browser, contextOptions, context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS, fh_quotes: [quoteRow({ status: 'draft', sent_at: null })] } })
    const writes: string[] = []
    page.on('request', (req) => {
      if (req.method() === 'DELETE' && req.url().includes('/rest/v1/')) writes.push(new URL(req.url()).pathname)
    })
    await openQuote(page)
    const remove = page.getByRole('button', { name: 'Delete draft quote' })
    await expect(remove).toBeVisible()
    // The first tap asks in place (D57); nothing is deleted yet.
    await remove.click()
    await expect(page.getByRole('button', { name: 'Tap again to delete' })).toBeVisible()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    await expect(page.getByRole('alertdialog')).toHaveCount(0)
    expect(writes).toEqual([])
    // A tap that follows the arming one at once is the same double tap, not a decision (S04).
    await page.getByRole('button', { name: 'Tap again to delete' }).click()
    await expect(page.getByRole('button', { name: 'Tap again to delete' })).toBeVisible()
    expect(writes).toEqual([])
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Tap again to delete' }).click()
    await expect(page).toHaveURL(/\/quotes$/, { timeout: 15_000 })
    // One delete of the quote; its lines go with it in the database (DATA-19).
    expect(writes).toEqual(['/rest/v1/fh_quotes'])

    // The approved quote opens in a fresh browser context, so no cache from
    // the draft can stand in for it.
    const approvedContext = await browser.newContext(contextOptions)
    try {
      const approved = await approvedContext.newPage()
      await signIn(approvedContext, { tables: { fh_quote_items: ITEMS, fh_quotes: [quoteRow({ status: 'approved' })] } })
      await openQuote(approved)
      await expect(approved.getByRole('button', { name: 'Delete draft quote' })).toHaveCount(0)
      await expect(approved.getByText('Approved quotes cannot be deleted.', { exact: true })).toBeVisible()
    } finally {
      await approvedContext.close()
    }
  })

  test('Make this a job lands on the new job', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const calls = await watchSends(context)
    // SQL regression tests exercise the atomic copy, tenant checks and rollback.
    // Here verify the UI waits for acknowledgement and sends one RPC only.
    const requests: unknown[] = []
    let acknowledge: (() => void) | undefined
    const waiting = new Promise<void>(resolve => { acknowledge = resolve })
    await context.route((url) => url.pathname.endsWith('/rest/v1/rpc/fh_make_job_from_quote'), async route => {
      requests.push(route.request().postDataJSON())
      await waiting
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify('job-new') })
    })
    await openQuote(page)
    await page.getByRole('button', { name: 'Make this a job' }).click()
    await expect.poll(() => requests.length).toBe(1)
    await expect(page).toHaveURL(/\/quotes\/q-quote$/)
    acknowledge!()
    await expect(page).toHaveURL(/\/jobs\/job-new$/, { timeout: 30_000 })
    expect(requests).toEqual([{ p_quote_id: 'q-quote' }])
    expect(calls.send).toEqual([])
  })

  // Audit finding M-03: what the customer approved stays what it was.
  test('an approved quote keeps its lines locked until Revise quote is tapped twice', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS, fh_quotes: [quoteRow({ status: 'approved' })] } })
    const patches: { url: string; body: any }[] = []
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_quotes'), (route) => {
      const request = route.request()
      if (request.method() !== 'PATCH') return route.fallback()
      patches.push({ url: request.url(), body: request.postDataJSON() })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'q-quote' }) })
    })
    const lineWrites: string[] = []
    page.on('request', (req) => {
      if (req.method() !== 'GET' && req.url().includes('/rest/v1/fh_quote_items')) lineWrites.push(req.method())
    })
    await openQuote(page)

    // The lines read, with their money, but none opens an editor and none can be added.
    await expect(lines(page).getByText('Pump truck')).toBeVisible()
    await expect(lines(page).getByText('$950.00', { exact: true })).toBeVisible()
    await expect(lines(page).getByRole('button')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Add a line' })).toHaveCount(0)
    await expect(page.getByRole('switch', { name: /Include Stamped ashlar/ })).toBeDisabled()
    await expect(page.getByRole('form', { name: 'Edit line' })).toHaveCount(0)
    // The screen says what is true, and names the one way to change the quote.
    const panel = page.locator('.fhqt-panel').filter({ hasText: 'Quote approved' })
    await expect(panel).toContainText('The lines are locked at what the customer agreed to.')
    await expect(page.getByText('Later edits to lines, scope or terms do not change what the customer agreed to.')).toHaveCount(0)

    // One tap arms, the second sets the quote back to a draft. No dialog.
    await panel.getByRole('button', { name: 'Revise quote' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(patches).toEqual([])
    await page.waitForTimeout(600)
    await panel.getByRole('button', { name: 'Tap again to revise' }).click()
    await expect.poll(() => patches.length).toBe(1)
    expect(patches[0].body).toEqual({ status: 'draft' })
    expect(patches[0].url).toContain('id=eq.q-quote')
    expect(patches[0].url).toContain('status=eq.approved')
    expect(lineWrites).toEqual([])
  })

  test('a quote set back to draft can be edited again', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS, fh_quotes: [quoteRow({ status: 'draft', approved_version_id: 'v-1' })] } })
    await openQuote(page)
    await lines(page).getByRole('button', { name: /Pump truck/ }).click()
    await expect(page.getByRole('form', { name: 'Edit line' })).toBeVisible()
  })

  // Audit finding DATA-04: nothing may go out while a line is still saving.
  test('send, approve, the PDF and Make this a job wait for a line that is still saving', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    let release: (() => void) | undefined
    const held = new Promise<void>((resolve) => { release = resolve })
    await context.route((url) => url.pathname.includes('/rest/v1/fh_quote_items'), async (route) => {
      const request = route.request()
      if (request.method() !== 'POST') return route.fallback()
      await held
      return route.fulfill({
        status: 201,
        contentType: 'application/json',
        body: JSON.stringify({ id: 'qi-new', created_at: iso(NOW), updated_at: iso(NOW), ...request.postDataJSON() })
      })
    })
    await openQuote(page)
    await page.getByRole('button', { name: 'Add a line' }).click()
    const editor = page.getByRole('form', { name: 'Add a line' })
    await editor.getByLabel('Description').fill('Pour 6 inch slab')
    await editor.getByLabel('Rate').fill('14000')
    const posted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/rest/v1/fh_quote_items'))
    await editor.getByRole('button', { name: 'Add line', exact: true }).click()
    await posted

    // The insert has not been answered: everything that reads the saved lines waits.
    const share = page.getByRole('list', { name: 'Share or download' })
    await expect(total(page).getByRole('button', { name: 'Send for approval' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Make this a job' })).toBeDisabled()
    await expect(page.getByRole('link', { name: /approve quote/i })).toHaveCount(0)
    for (const name of ['Open the PDF', 'Download the PDF', 'Copy a share link', 'Send for electronic signature']) {
      await expect(share.getByRole('button', { name: new RegExp(name) })).toBeDisabled()
    }
    await expect(total(page).getByText('Saving a line')).toBeVisible()

    release!()
    await expect(total(page).getByRole('button', { name: 'Send for approval' })).toBeEnabled()
    await expect(page.getByRole('button', { name: 'Make this a job' })).toBeEnabled()
    await expect(page.getByRole('link', { name: /approve quote/i })).toHaveCount(1)
    await expect(total(page).getByText('$17,150.00', { exact: true })).toBeVisible()
  })

  test('an approved quote still offers Make this a job', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS, fh_quotes: [quoteRow({ status: 'approved' })] } })
    await openQuote(page)
    await expect(page.locator('.fhqt-head').getByText('Approved', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Make this a job' })).toBeEnabled()
    // Once the quote has its job, the button opens that job instead.
    await signIn(context, { tables: { fh_quote_items: ITEMS, fh_quotes: [quoteRow({ status: 'approved', job_id: 'c-job1' })] } })
    await openQuote(page)
    await expect(page.getByRole('button', { name: 'Make this a job' })).toHaveCount(0)
    const open = page.getByRole('link', { name: 'Open the job' })
    await expect(open).toBeVisible()
    await open.click()
    await expect(page).toHaveURL(/\/jobs\/c-job1$/)
  })
})

test.describe('the quotes list', () => {
  test('lists every quote and opens one', async ({ context, page }) => {
    await signIn(context)
    await page.goto('/quotes', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Quotes' })).toBeVisible({ timeout: 30_000 })
    const rows = page.getByRole('list', { name: 'Quotes' })
    await expect(rows.getByText('Parking lot repour')).toBeVisible()
    await expect(rows.getByText('Kitchen renovation')).toBeVisible()
    await expect(rows.getByText('Changes requested', { exact: true })).toBeVisible()
    await rows.getByRole('link', { name: /Parking lot repour/ }).click()
    await expect(page).toHaveURL(/\/quotes\/q-quote$/)
    await expect(page.locator('.fhqt-page')).toBeVisible({ timeout: 30_000 })
  })
})

// Audit finding DATA-18: a write that changed no row is never reported as saved.
test.describe('a write that finds nothing to change', () => {
  test('a line edit that matched no line says so and keeps the editor', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_quote_items'), (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await openQuote(page)
    await lines(page).getByRole('button', { name: /Pump truck/ }).click()
    const editor = page.getByRole('form', { name: 'Edit line' })
    await editor.getByLabel('Rate').fill('1000')
    await editor.getByRole('button', { name: 'Save changes' }).click()
    await expect(page.getByText("Couldn't update the line")).toBeVisible()
    await expect(editor).toBeVisible()
  })

  test('scope and terms that matched no quote say so and stay on the form', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_quotes'), (route) => {
      if (route.request().method() !== 'PATCH') return route.fallback()
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await openQuote(page, '/quotes/q-quote/terms')
    await page.getByLabel('Scope of work').fill('Remove and repour the lot')
    await page.getByRole('button', { name: 'Save terms' }).click()
    await expect(page.getByText("Couldn't save the quote")).toBeVisible()
    await expect(page).toHaveURL(/\/quotes\/q-quote\/terms$/)
  })

  test('a delete that matched no quote does not say deleted', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS, fh_quotes: [quoteRow({ status: 'draft', sent_at: null })] } })
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_quotes'), (route) => {
      if (route.request().method() !== 'DELETE') return route.fallback()
      return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
    })
    await openQuote(page)
    await page.getByRole('button', { name: 'Delete draft quote' }).click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Tap again to delete' }).click()
    await expect(page.getByText("Couldn't delete the quote")).toBeVisible()
    await expect(page.getByText('Draft quote deleted')).toHaveCount(0)
    await expect(page).toHaveURL(/\/quotes\/q-quote$/)
  })
})

// Audit finding DATA-13: the list shows what was just done to a quote.
test.describe('the quotes list after a change', () => {
  test('a deleted quote leaves the list at once', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS, fh_quotes: [quoteRow({ status: 'draft', sent_at: null })] } })
    // The mock keeps no writes: once the delete is sent, reads find no quotes.
    let deleted = false
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_quotes'), (route) => {
      const method = route.request().method()
      if (method === 'DELETE') deleted = true
      if (method === 'GET' && deleted) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      return route.fallback()
    })
    await page.goto('/quotes', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    const rows = page.getByRole('list', { name: 'Quotes' })
    await expect(rows.getByText('Parking lot repour')).toBeVisible({ timeout: 30_000 })
    await rows.getByRole('link', { name: /Parking lot repour/ }).click()
    await expect(page.locator('.fhqt-page')).toBeVisible({ timeout: 30_000 })
    await page.getByRole('button', { name: 'Delete draft quote' }).click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Tap again to delete' }).click()
    await expect(page).toHaveURL(/\/quotes$/, { timeout: 15_000 })
    await expect(page.getByRole('heading', { level: 1, name: 'Quotes' })).toBeVisible()
    await expect(page.getByText('Parking lot repour')).toHaveCount(0)
  })

})

// Phone sales audit findings S18, S03 and S25 on the quote screen.
test.describe('taps on the quote screen', () => {
  test('Delete line asks with a second tap (S18)', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const deletes: string[] = []
    page.on('request', (req) => { if (req.method() === 'DELETE' && req.url().includes('/rest/v1/fh_quote_items')) deletes.push(req.url()) })
    await openQuote(page)
    await lines(page).getByRole('button', { name: /Pump truck/ }).click()
    const editor = page.getByRole('form', { name: 'Edit line' })
    await editor.getByRole('button', { name: 'Delete line' }).click()
    await expect(editor.getByRole('button', { name: 'Tap again to delete line' })).toBeVisible()
    await editor.getByRole('button', { name: 'Tap again to delete line' }).click()
    expect(deletes).toEqual([])
    await page.waitForTimeout(600)
    await editor.getByRole('button', { name: 'Tap again to delete line' }).click()
    await expect.poll(() => deletes.length).toBe(1)
    expect(deletes[0]).toContain('id=eq.qi2')
  })

  test('a tap right after the line editor closes does not land on an action row (S03)', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS, fh_quotes: [quoteRow({ status: 'draft', sent_at: null })] } })
    const quoteWrites: string[] = []
    page.on('request', (req) => { if (req.method() === 'PATCH' && req.url().includes('/rest/v1/fh_quotes')) quoteWrites.push(req.url()) })
    await openQuote(page)
    await lines(page).getByRole('button', { name: /Pump truck/ }).click()
    const editor = page.getByRole('form', { name: 'Edit line' })
    await editor.getByRole('button', { name: 'Save changes' }).click()
    await expect(editor).toBeHidden()
    await page.getByRole('button', { name: /Mark as sent/ }).click()
    await page.waitForTimeout(300)
    expect(quoteWrites).toEqual([])
    // A deliberate tap a moment later works.
    await page.waitForTimeout(400)
    await page.getByRole('button', { name: /Mark as sent/ }).click()
    await expect.poll(() => quoteWrites.length).toBe(1)
  })

  test('the total goes to $0.00 after the last line is deleted (S25)', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: [ITEMS[1]] } })
    // The database keeps the quote amount equal to its lines; the mock does not.
    let gone = false
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_quote_items'), (route) => {
      if (route.request().method() === 'DELETE') gone = true
      if (route.request().method() === 'GET' && gone) return route.fulfill({ status: 200, contentType: 'application/json', body: '[]' })
      return route.fallback()
    })
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_quotes'), (route) => {
      if (route.request().method() !== 'GET' || !gone) return route.fallback()
      const row = quoteRow({ amount: 0 })
      const single = (route.request().headers()['accept'] || '').includes('vnd.pgrst.object')
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(single ? row : [row]) })
    })
    await openQuote(page)
    await expect(total(page).getByText('$950.00', { exact: true })).toBeVisible()
    await lines(page).getByRole('button', { name: /Pump truck/ }).click()
    const editor = page.getByRole('form', { name: 'Edit line' })
    await editor.getByRole('button', { name: 'Delete line' }).click()
    await page.waitForTimeout(600)
    await editor.getByRole('button', { name: 'Tap again to delete line' }).click()
    await expect(total(page).getByText('$0.00', { exact: true })).toBeVisible()
  })
})

// Phone sales audit finding S22: the quote screens speak in plain sentences.
test.describe('errors on the quote screens', () => {
  test('a share link that fails offline says so in words', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await context.route((url) => url.pathname.includes('/rest/v1/fh_public_links'), (route) => route.abort('internetdisconnected'))
    await openQuote(page)
    await page.getByRole('list', { name: 'Share or download' }).getByRole('button', { name: /Copy a share link/ }).click()
    await expect(page.getByText('Check your connection and try again.')).toBeVisible()
    await expect(page.getByText(/TypeError|Failed to fetch/)).toHaveCount(0)
  })

  test('a negative rate gets the form\'s own message, not the browser bubble', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    await openQuote(page)
    await page.getByRole('button', { name: 'Add a line' }).click()
    const editor = page.getByRole('form', { name: 'Add a line' })
    await editor.getByLabel('Description').fill('Credit')
    await editor.getByLabel('Rate').fill('-5')
    await editor.getByRole('button', { name: 'Add line', exact: true }).click()
    await expect(editor.getByText('Enter a number, 0 or more.').first()).toBeVisible()
  })

  test('New quote offline says so in words', async ({ context, page }) => {
    await signIn(context)
    await context.route(/\/rest\/v1\/fh_quotes(\?|$)/, (route) =>
      route.request().method() === 'POST' ? route.abort('internetdisconnected') : route.fallback())
    await page.goto('/quotes/new?client=cl-1', { waitUntil: 'domcontentloaded', timeout: 60_000 })
    await expect(page.getByLabel('Client')).toHaveValue('Jeff Roy', { timeout: 30_000 })
    await page.getByRole('button', { name: 'Save quote' }).click()
    await expect(page.getByText('Could not save this quote. Check your connection and try again.')).toBeVisible()
    await expect(page.getByText(/TypeError|Failed to fetch/)).toHaveCount(0)
  })
})

// Phone sales audit finding S13, the quote half: a quote can be closed as
// lost and opened again, and a lost quote does not offer Send.
test.describe('a lost quote', () => {
  async function watchQuotePatches(context: BrowserContext) {
    const patches: { url: string; body: any }[] = []
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_quotes'), (route) => {
      const request = route.request()
      if (request.method() !== 'PATCH') return route.fallback()
      patches.push({ url: request.url(), body: request.postDataJSON() })
      return route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ id: 'q-quote' }) })
    })
    return patches
  }

  test('Mark as lost asks with a second tap', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const patches = await watchQuotePatches(context)
    await openQuote(page)
    await page.getByRole('button', { name: 'Mark as lost' }).click()
    await expect(page.getByRole('dialog')).toHaveCount(0)
    expect(patches).toEqual([])
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Tap again to mark lost' }).click()
    await expect.poll(() => patches.length).toBe(1)
    expect(patches[0].body).toEqual({ status: 'lost' })
    expect(patches[0].url).toContain('status=eq.sent')
  })

  test('a lost quote cannot be sent and can be reopened', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS, fh_quotes: [quoteRow({ status: 'lost' })] } })
    const patches = await watchQuotePatches(context)
    await openQuote(page)
    await expect(total(page).getByRole('button', { name: 'Send for approval' })).toBeDisabled()
    await expect(total(page).getByText('Reopen the quote to send it')).toBeVisible()
    await expect(page.getByRole('button', { name: 'Mark as lost' })).toHaveCount(0)
    await page.getByRole('button', { name: 'Reopen quote' }).click()
    await page.waitForTimeout(600)
    await page.getByRole('button', { name: 'Tap again to reopen' }).click()
    await expect.poll(() => patches.length).toBe(1)
    expect(patches[0].body).toEqual({ status: 'draft' })
    expect(patches[0].url).toContain('status=eq.lost')
  })
})

