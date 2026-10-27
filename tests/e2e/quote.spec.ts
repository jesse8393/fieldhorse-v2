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
    await page.getByRole('button', { name: 'Tap again to delete' }).click()
    await expect(page).toHaveURL(/\/quotes$/, { timeout: 15_000 })
    expect(writes).toContain('/rest/v1/fh_quote_items')
    expect(writes).toContain('/rest/v1/fh_quotes')

    // The approved quote opens in a fresh browser context, so no cache from
    // the draft can stand in for it.
    const approvedContext = await browser.newContext(contextOptions)
    try {
      const approved = await approvedContext.newPage()
      await signIn(approvedContext, { tables: { fh_quote_items: ITEMS, fh_quotes: [quoteRow({ status: 'approved' })] } })
      await openQuote(approved)
      await expect(approved.getByRole('button', { name: 'Delete draft quote' })).toHaveCount(0)
      await expect(approved.getByText('Approved quotes cannot be deleted. Create a revision instead.')).toBeVisible()
    } finally {
      await approvedContext.close()
    }
  })

  test('Make this a job lands on the new job', async ({ context, page }) => {
    await signIn(context, { tables: { fh_quote_items: ITEMS } })
    const calls = await watchSends(context)
    // The mock answers an insert with the first row of the table, which is
    // a moved row here; answer with the job the database would make.
    const inserted: Record<string, unknown>[] = []
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_contacts'), (route) => {
      const request = route.request()
      if (request.method() !== 'POST') return route.fallback()
      inserted.push(request.postDataJSON())
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify({ id: 'job-new', ...request.postDataJSON() }) })
    })
    const copies: Record<string, unknown>[][] = []
    await context.route((url) => url.pathname.endsWith('/rest/v1/fh_quote_items'), (route) => {
      const request = route.request()
      if (request.method() !== 'POST') return route.fallback()
      copies.push(request.postDataJSON())
      return route.fulfill({ status: 201, contentType: 'application/json', body: JSON.stringify(request.postDataJSON()) })
    })
    const linked = page.waitForRequest((r) => r.method() === 'PATCH' && r.url().includes('/rest/v1/fh_quotes'))
    await openQuote(page)

    await page.getByRole('button', { name: 'Make this a job' }).click()
    await expect(page).toHaveURL(/\/jobs\/job-new$/, { timeout: 30_000 })

    // The job copies the quote's client, title, scope and the base price (D61).
    expect(inserted).toHaveLength(1)
    expect(inserted[0]).toMatchObject({ stage: 'job', client_id: 'cl-1', name: 'Jeff Roy', job_title: 'Parking lot repour', amount: 3150 })
    // Every line goes onto the job, and the quote points at the job.
    expect(copies).toHaveLength(1)
    expect(copies[0]).toHaveLength(3)
    for (const row of copies[0]) expect(row).toMatchObject({ contact_id: 'job-new', quote_id: null })
    expect((await linked).postDataJSON()).toEqual({ job_id: 'job-new' })
    expect(calls.send).toEqual([])
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
